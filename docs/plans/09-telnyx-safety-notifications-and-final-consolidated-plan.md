# Plan I — Telnyx safety/notifications, the number-flow audit, and the final consolidated plan

## Part 1 — Audited the whole "getting and owning a number" flow (`telnyx_numbers.py`)
Checked end to end. The core safety property already holds and needs no change: **a number
cannot be ordered until that organisation's own business verification is `approved`**
(`/numbers/order`, line 227-231 — `if not sub or sub.status != "approved": raise 409
verification_required`). Country-specific required fields come live from Telnyx's own
`/requirements` endpoint per order, not duplicated/guessed locally, so Telnyx's own rules are
always the current ones. This answers your question directly: numbers are only ever provisioned
against the actual business's own submitted and Telnyx-approved documents — confirmed, not
assumed.

One real bug found while auditing this, unrelated to safety but a fairness issue — fixing it as
part of this round:
**`POST /numbers/verification` charges the 5-credit setup fee before knowing if Telnyx accepted
the submission.** If a customer's very first attempt errors out on Telnyx's side (bad doc format,
a transient API error), they're charged for a setup that never happened, and it's never refunded
— only a *retry* avoids a second charge (because `prior` now exists), the original bad charge
stands. Fix: only charge when `sub.status != "error"` after the call, not unconditionally before.

## Part 2 — The real gap: Telnyx webhooks are silently ignored once a number is already active
Checked `refresh_order()`/`refresh_verification()` (`telnyx_provisioning.py:300,386`) — both start
with `if ... status in ("success"/"approved", "error"): return`. That's correct for *not
reprocessing old news* on a webhook retry, but it also means: **if Telnyx later suspends, holds,
or revokes a number or a business's verification after it was already approved/active, the
webhook that reports it is a no-op.** Nothing updates, nothing fires, nobody is told. This is
exactly the scenario you're asking to be protected against.

**Fix**:
1. In `refresh_order`/`refresh_verification`, only skip the no-op for statuses that genuinely
   can't change further (`"failure"` is terminal; `"success"`/`"approved"` are not — Telnyx can
   still move a live number to `"port-out"`, a suspended/compliance-hold state, etc.). Re-process
   those and update our row's status whenever Telnyx reports something different.
2. When a previously-active number or verification comes back in a bad state, call the existing
   `notify()` mechanism **twice**: once in the customer's own org (so their admins are emailed —
   this already fires correctly for "ready"/"declined" via `_activate`/`_notify_verification`,
   just needs the same call added for the new "went bad after being fine" case), and once more
   addressed to the **platform org** (so Aivhub staff get the identical email) — `notify()`
   already does exactly this (`core/notify.py`), it just needs to be called while in
   `system_scope()`/the platform org's context as a second send, not a new system. This directly
   satisfies "we and the user should also get known to it."
3. **Telnyx doesn't promise a webhook for every possible compliance action** — some holds surface
   only as failed call attempts, never a dedicated event. Close that blind spot with a cheap
   periodic check: extend the existing recurring job (the same mechanism `credits.settle()` already
   uses every 5 minutes) to occasionally re-read each org's **already-active** numbers' status
   from Telnyx too, not just pending orders — today `refresh_pending()` only ever looks at
   `status == "pending"` rows, so an active number is never checked again after activation. A
   once-an-hour sweep is enough; this isn't a thing that needs to be instant, just not silent
   forever.

Together, this means: however Telnyx reports a problem — webhook or not — it reaches both your
inbox and the affected customer's, automatically, the same day.

## Part 3 — "Our main account should never stop working" — the honest answer
No technical change can make it *impossible* for Telnyx to act against the shared account if a
customer seriously abuses it — that's Telnyx's call, not ours to override. What's actually
achievable, and already partly built:
- **Containment**: per-org spend cap and max destination rate (already enforced by Telnyx itself,
  confirmed in `telnyx_provisioning.py`) keep one org's behaviour from draining the whole balance.
- **A real kill switch that already works**: setting an org's status to `suspended` signs its
  users out and blocks all further API access immediately (`auth_middleware.py:156`) — nothing
  new to build, just needs staff to actually see a problem in time to use it.
- **Fast detection closes the "in time" gap** — that's exactly what Part 2 builds. Right now,
  staff would only find out about a problem by noticing calls failing. After Part 2, they get an
  email the moment Telnyx reports it, for the specific org causing it, and can suspend just that
  org before Telnyx has reason to escalate further.
- What this doesn't cover, by your own instruction, is for later: a signed Acceptable Use Policy
  making the *customer* contractually liable for how they use a number, which is the actual legal
  backstop. Flagged, deferred, not touched in this round.

## Build order for this round
1. Fix the `number_setup` charge-before-result ordering bug (Part 1) — small, isolated.
2. Stop swallowing post-activation Telnyx webhook events; re-process and update status instead of
   no-op'ing (Part 2.1).
3. Wire the dual `notify()` call (customer org + platform org) for the "went bad after being
   fine" case (Part 2.2).
4. Add the hourly active-number health sweep as an extension of the existing recurring job
   (Part 2.3).

No new third-party services, no new accounts, nothing customer-facing changes in normal operation
— these are all failure-path additions that do nothing when everything's working, by design, so
there's no risk of this affecting any user's normal day-to-day use of the product.

---

## Final consolidated plan — everything from this entire conversation, in one place

**A. Pending from before this message, build order unchanged:**
1. Run the full backend pytest suite (real Postgres) to verify the OAuth-app security fix
   (`auth_middleware.py` + `SocialWorkspace.jsx`) already written and lint/build-clean — this is
   the one item still only "code-complete," not yet verified, from earlier in this session.
2. `DEFAULT_UNIT_COSTS` (Plan H / doc 08, Part 2) — real Telnyx-sourced default "our cost" figures
   so margin reporting stops starting from a lying zero.
3. Leadgen persistence (`POST /prospects`, Mission-backed Saved Accounts) — unlocks the rest.
4. Scout wired to the real `/enrichment/discover-accounts` endpoint + Telnyx Number Lookup
   validation on every candidate phone number (Plan H, Part 3; no new account needed anywhere,
   confirmed over several messages this session).
5. CSV Import wired to the real `/missions/upload-parse` endpoint.
6. Auto-enroll (falls out of step 3 for free).

**B. This message's additions, same priority tier as the security fix (safety, not features):**
7. Fix the `number_setup` double-jeopardy charge bug.
8. Stop dropping post-activation Telnyx webhooks; re-process suspension/hold/revocation events.
9. Dual-notify (customer + platform) when a previously-good number or verification goes bad.
10. Hourly health sweep on active numbers, closing the no-webhook blind spot.

**C. Explicitly deferred, by your own instruction, not forgotten:**
- Any Terms of Service / Acceptable Use Policy text shown to users — legal needs to write it;
  I'll wire it into the signup/consent flow once you have it, not before.

**D. The other two plugins — Voice and Post Scheduler — checked just now, so nothing is missed:**

*Voice* — one item actually just got re-verified as **already done**, correcting a 10-day-old
memory note: the modular/LiveKit engine's tool-call booking (`voice_modular.py` line ~860) is
real and wired end-to-end — a booking-intent utterance triggers `call_open_chat_llm_with_tools()`
with real schemas from `booking_tools.py`, executes, broadcasts, and folds the result back into
the conversation. All three engines (xAI, OpenAI, modular) now have working booking; no gap here.
Still genuinely open: **Voice call AI cost tracking** (doc 06) — not started, and now partly
unblocked by this session's Telnyx research: if a call runs on Telnyx's managed Voice AI
Assistant, its real per-minute cost is the $0.05-0.056/min figure found this session, not
something that needs deriving from a separate LLM response; the self-hosted LiveKit path still
needs its own capture point found in the LLM provider's own usage response, per doc 06's Step 0.

*Post Scheduler* — the OAuth-app vulnerability itself is fixed (item A1, pending test
verification), but the **proper admin UI for managing LinkedIn/Facebook/Instagram/Threads app
credentials was only researched, never built** — today staff can still only set them via `.env`
and a restart. Building it means: a staff-only "Network Apps" screen on top of the existing
`SocialOAuthApp` data layer (Client ID/Secret entry per platform, masked redisplay, a
configured/not-configured status pill), plus surfacing the real review requirements found this
session inline so whoever operates it knows what's involved before clicking anything — Meta's
API is free but gated by a 2-8 week app-review process (business verification, hosted privacy
policy, screen-recorded permission walkthroughs); LinkedIn's official Marketing Developer
Platform is realistically out of reach short-term (approval needs an established company and a
live demo with a LinkedIn reviewer, 1-4 months) — the pragmatic alternative, if LinkedIn posting
matters soon, is a unified reseller API that already holds LinkedIn partner access (Ayrshare,
~$149-299/mo), not chasing LinkedIn's own approval. Not started; your call on priority and on the
LinkedIn approach.

Also still open, lower priority, unchanged from doc 07: Embeddings/Messaging aren't yet truly
per-plugin isolated (one shared pool under the hood, unlike LLM/Image).

Want me to start at the top of A, or jump straight to B since safety was the point of this
message? Either way, D's two open items (Voice AI cost tracking, Post Scheduler's Network Apps
admin UI) are now tracked here too, not lost.
