# Plan E — Per-client Telnyx numbers, assistants and billing (Billing Group model)

Every decision below is made — this is ready to build in the order listed, no further
back-and-forth needed before starting. Model: Telnyx **Billing Group** (`TELNYX_ACCOUNT_MODE=
billing_group`, already the default, no Telnyx manager-account approval needed) — one shared
Telnyx balance, each client gets its own Billing Group, Requirement Group, number, voice profile
and assistant underneath it.

## Status recap (checked against the real code)
Already built: signup, the customer-facing verification form (`POST /telnyx/verification`,
`GET /telnyx/requirements`), Billing Group creation, number search/order, webhook-driven
approval/rejection handling, "number ready" notification, per-minute credit deduction, pause-at-zero.

Five gaps close this out. Build in this order.

---

## Step 1 — Exclude Aivhub's own org from auto-assistant creation (do first)

**Why first**: every later step turns on behavior that applies to *every* org uniformly today.
Doing this first means Aivhub's own testing never breaks as the rest rolls out.

**File**: `backend/app/services/voice_assistants.py`

Add, near `enabled()`:
```python
def enabled_for_org(org_id: str) -> bool:
    from app.core.auth_middleware import platform_org
    return enabled() and org_id != platform_org()
```

**File**: `backend/app/services/telnyx_assistant_dial.py`, line ~111 — replace:
```python
if VA.enabled():
```
with:
```python
if VA.enabled_for_org(org_id):  # org_id must already be in scope here; if not, pull via current_org()
```
Confirm `org_id` (or `current_org()`) is available at that point in the function — if it isn't
passed in already, import `from app.core.tenancy import current_org` and use that.

Grep the whole backend for any other bare `VA.enabled()` or `voice_assistants.enabled()` call sites
and switch them to `enabled_for_org(...)` the same way — don't leave a second path that still
applies to every org.

---

## Step 2 — Create the client's assistant during provisioning, not lazily on first call

**File**: `backend/app/services/telnyx_provisioning.py`, inside `ensure_setup()`, billing_group
branch (the `else:` block starting at line 121), right after `outbound_connection_id` is set
(after line 139, before `setup.connection_id = ...` on line 140):

```python
            if VA.enabled_for_org(_org()):
                from app.services import voice_assistants as VA  # deferred import, avoids the
                                                                    # circular import with this module
                await VA.assistant_for(db, "")  # "" = the organisation's own assistant
```
(Move the `from app.services import voice_assistants as VA` import to the top of this `if`, or
just above it — Python needs the import before the call either way; the existing codebase's
convention is deferred imports inside the function body specifically to dodge the circular import
between `telnyx_provisioning.py` and `voice_assistants.py` — follow that pattern, don't import at
module level.)

**Env var**: set `TELNYX_MANAGED_ASSISTANTS=true` in production config. Do this in the same deploy
as Step 1 and Step 2's code — don't flip the env var before the exclusion code is live, or
Aivhub's own org gets swept in first.

**Verify**: `assistant_for(db, "")` already uses `client_for(setup)` internally, which already
resolves to the right Telnyx client for billing_group mode (`platform_key()`) — no further wiring
needed there, it was already correct for this use case.

---

## Step 3 — Let a client's outbound-call countries be set, not stuck on GB-only

**Backend — new TelnyxClient method**. File: `backend/app/services/telnyx_client.py`, right after
`create_outbound_voice_profile` (line 147):
```python
    async def update_outbound_voice_profile(self, profile_id: str, countries: List[str]) -> Dict[str, Any]:
        return (await self._req("PATCH", f"/outbound_voice_profiles/{profile_id}",
                                json={"whitelisted_destinations": countries or ["GB"]})).get("data", {})
```

**Backend — new endpoint**. File: `backend/app/api/telnyx_numbers.py`, new route near the others:
```python
class CountriesBody(BaseModel):
    countries: List[str]

@router.put("/allowed-countries")
async def set_allowed_countries(body: CountriesBody, request: Request, db: AsyncSession = Depends(get_db)):
    ctx = _admin(request)
    setup, client = await _ready_client(db, ctx)
    countries = [c.strip().upper() for c in body.countries if c.strip()] or ["GB"]
    setup.allowed_countries = countries
    if setup.outbound_voice_profile_id:
        try:
            await client.update_outbound_voice_profile(setup.outbound_voice_profile_id, countries)
        except TelnyxError as err:
            raise HTTPException(status_code=502, detail=str(err))
    await db.commit()
    return {"countries": countries}
```

**Frontend**: on the client's Numbers page (Voice plugin), a country multi-select near the
verification form, calling this endpoint. Save it *before* or *during* verification submission so
`ensure_setup()`'s first-time voice-profile creation already picks up the chosen countries — if a
client changes countries after their profile already exists, this endpoint's PATCH call updates
the existing Telnyx profile in place (no re-creation needed).

---

## Step 4 — Monthly number rental: actually charge it, and release on non-payment

**Decisions made** (so this can just be built):
- **Billing cadence**: per-number anniversary billing, not calendar-month billing — avoids
  pro-rating and month-length edge cases entirely. Each number tracks its own next-charge date,
  30 days after the last successful charge (or 30 days after activation, for the first charge).
- **No grace period**: the moment a rental charge can't be fully paid (wallet goes into debt) or
  the number's due date is reached without enough balance, the number is released immediately in
  that same check — same rule as calls: credits exhausted or time period over, service stops right
  there, no waiting window. This matches how call credits already work (`enforce` cuts off calls
  at zero, no grace there either) — numbers now behave the same way.

**New column**. `backend/app/models/models.py`, on `OrgPhoneNumber`:
```python
rent_due_at = Column(DateTime, nullable=True)       # next time phone_number_month is owed
```
Add the matching migration step in `backend/app/core/migrations.py` (same `ALTER TABLE ... ADD
COLUMN IF NOT EXISTS` pattern as every other step in that file), and set `rent_due_at = now() +
30 days` when a number is first activated (`_activate()` in `telnyx_provisioning.py`, right where
`OrgPhoneNumber` is constructed).

**New background loop**. `backend/app/main.py`, alongside `_credits_settle_loop` and the others
already started near line 561-566 — add `_phone_rental_loop()`, same shape as
`_credits_settle_loop` (daily is enough; every 3600s or on a fixed daily tick):
```python
async def _phone_rental_loop():
    from app.database import AsyncSessionLocal
    from app.core.tenancy import org_scope
    from app.core.orgs import active_org_ids
    from app.services import credits as K
    from app.models.models import OrgPhoneNumber
    from sqlalchemy.future import select
    from datetime import datetime, timedelta
    while True:
        try:
            await asyncio.sleep(3600)
            now = datetime.utcnow()
            for org_id in await active_org_ids():
                with org_scope(org_id):
                    async with AsyncSessionLocal() as db:
                        numbers = (await db.execute(select(OrgPhoneNumber).where(
                            OrgPhoneNumber.status == "active", OrgPhoneNumber.provider == "telnyx"
                        ))).scalars().all()
                        for n in numbers:
                            if not (n.rent_due_at and n.rent_due_at <= now):
                                continue
                            await K.charge(db, "phone_number_month", 1,
                                f"rent:{n.id}:{n.rent_due_at.date()}", f"Monthly rental: {n.e164}")
                            bal = await K.wallet_balance(db, "voice")
                            if bal < 0:
                                # Credits exhausted at the due date: stop immediately, no grace.
                                from app.api.telnyx_numbers import _release_number  # extract the
                                    # body of POST /numbers/{id}/release into a callable helper if
                                    # it isn't already one, so both the endpoint and this loop can
                                    # call the same code
                                await _release_number(db, n)
                                from app.core.notify import notify
                                await notify("numbers", f"Number {n.e164} released",
                                    [f"{n.e164} was released: monthly rental couldn't be paid from your balance."])
                            else:
                                n.rent_due_at = now + timedelta(days=30)
                        await db.commit()
        except asyncio.CancelledError:
            raise
        except Exception as loop_err:
            logger.warning(f"[Phone Rental] Cycle failed: {loop_err}")
```
Register it the same way the other loops are started (`asyncio.create_task(_phone_rental_loop())`
next to the existing `asyncio.create_task(...)` calls near line 561-566).

**Refactor needed**: `POST /numbers/{id}/release` in `telnyx_numbers.py` currently only exists as
route-handler code. Extract its body into a plain function (`_release_number(db, number_row)`) that
both the route and this new loop call, instead of duplicating the release logic.

---

## Step 5 — Optional setup fee (build last, only if you confirm you still want it)

Paid in credits, not a separate one-off Stripe charge — consistent with the rest of the platform
(prepaid credits only, every paid action goes through the same rate-card mechanism, nothing free,
nothing special-cased). This also settles the refund question from before: like every other credit
charge (`lead_lookup`, `voice_minute`, `email_send`), it's non-refundable by default — no new logic
needed, it just behaves like everything else already does.

**The only remaining decision**: how many credits the charge costs. Everything else below is ready
to build once you give that number.

**Mechanism**:
- Add a new rate-card item in `backend/app/services/credits.py`'s `DEFAULT_RATES`:
  `"number_setup": {"label": "Number setup", "unit": "number", "credits": <your number>, "wallet": "voice", "charged": True}`.
- In `POST /telnyx/verification` (`telnyx_numbers.py`), before accepting the submission: call the
  same `can_start(db, "number_setup")` / `charge(db, "number_setup", 1, ref, note)` pair every other
  paid action in this codebase already uses. If the org doesn't have enough voice credits, the
  submission is refused with the same 402 pattern as everywhere else (e.g. `enrichment.py`'s
  `_can_research`) — the client simply buys voice credits first, through the Subscription page they
  already have, exactly like unlocking any other feature.
- No new Stripe integration, no new payment path — it rides entirely on the credit-purchase flow
  that already exists.

---

## Build + rollout order
1. Step 1 (exclusion) — ship alone first, verify Aivhub's own org is unaffected by anything that follows.
2. Step 2 (assistant on provisioning) + flip `TELNYX_MANAGED_ASSISTANTS=true` — same deploy.
3. Step 3 (country selection) — independent, can ship any time after Step 1.
4. Step 4 (monthly rental + release) — biggest piece; the migration (new columns) ships first,
   then the loop, then test against a throwaway test org with a real small number for a few
   billing cycles compressed down (temporarily shorten the 30-day interval in a test environment)
   before trusting it at the real 30-day cadence.
5. Step 5 (setup fee) — only after you confirm amount/refund policy.

Test every step against a real throwaway test org, never against Aivhub's own org or a paying
customer, before calling any of this done.
