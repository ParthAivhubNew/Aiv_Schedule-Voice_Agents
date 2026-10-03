# Plan A — Merge Leadgen + Email into one plugin ("Leadgen")

## Goal
Only 3 plugins visible in the hub: **Voice**, **Post Scheduler**, **Leadgen**. Leadgen absorbs
everything Email Outreach does today — one UI, one wallet, one subscription, one checkout flow.
Email Outreach is retired as a standalone hub app. Both must also be made to actually work
end-to-end before/while this merge happens (see Fix Checklist).

## Current state (confirmed in code)
- Leadgen: `frontend/src/plugins/leadgen/LeadGenerationPlugin.jsx`, backend
  `backend/app/api/enrichment.py`, `missions.py`, `prospects.py`,
  `backend/app/services/enrichment_waterfall.py`. Wallet `leadgen`, rate item `lead_lookup`
  (1 credit, charged on a found email) — `backend/app/services/credits.py:55`.
- Email: `frontend/src/plugins/email/EmailOutreachPlugin.jsx` + `OutreachViews.jsx`, backend
  `backend/app/api/email_outreach.py`, `email_dispatcher.py`, `email_worker.py`,
  `email_warmup_engine.py`. Wallet `email`, rate item `email_send`
  (`backend/app/services/credits.py:56` — currently `"charged": False`, but
  `email_dispatcher.py:191` calls `charge()` on send anyway; confirm which one is correct intent
  before merge, see Fix Checklist).
- `EmailEnrollment.prospect_id` (`models.py:1251`) already exists as a cross-link but nothing
  populates it today — leads reach Email only via manual CSV import
  (`parseLeads.test.js`).
- Hub registry: `frontend/src/hub/apps.js` currently lists 4 apps (voice, leadgen, email,
  scheduler). Route whitelist: `frontend/src/App.jsx:191`.
- Starter trial credits are auto-granted on signup today. Per the decision for Plan C, there is
  **no free trial at all** — this plan removes that auto-grant entirely. Every org stays locked
  until an admin actually buys credits/a plan.

## 1. Frontend: one plugin, not two
- Fold Email's views into Leadgen as sub-tabs inside `LeadGenerationPlugin.jsx`:
  - **Find Leads** (existing leadgen mission/prospect search)
  - **Enrichment** (existing leadgen enrichment results)
  - **Email Sequences** (from `EmailOutreachPlugin.jsx` / `OutreachViews.jsx` — campaigns,
    templates, enrollments, send logs, reply tracking)
  - **Mailboxes** (OAuth/SMTP connection + warmup + DNS verification, from the Email plugin)
  - **Subscription** (existing `SubscriptionPage`, admin-only)
- Delete the "Email" entry from `frontend/src/hub/apps.js`. Hub shows exactly 3 cards.
- Remove `"emailoutreach"` from the top-level route whitelist in `App.jsx:191`.
- Add a redirect: any `#/emailoutreach/*` hash rewrites to `#/leadgen/email/*` (old bookmarks
  and any external links keep working).
- `EmailOutreachPlugin.jsx`/`OutreachViews.jsx` move under
  `frontend/src/plugins/leadgen/` as sub-components rather than being deleted outright — reuse
  the existing, working UI code, just re-parent it under the Leadgen nav.

## 2. Backend: one wallet, not two
- `backend/app/services/credits.py`:
  - `WALLETS` (line 41-46): remove `email` as a distinct wallet; `leadgen` now covers both
    `lead_lookup` and `email_send`.
  - `DEFAULT_RATES` (line 50-59): change `email_send.wallet` from `"email"` to `"leadgen"` AND
    change `email_send.charged` from `False` to `True` — email sends must cost credits, same as
    `lead_lookup`. Confirm `email_dispatcher.py:191`'s `charge()` call actually deducts (it
    already calls `charge()` today, this just makes the rate-card flag match reality instead of
    contradicting it).
- **Data migration** (write as an Alembic/startup migration, same pattern as the recent
  `cbada9a` connections.org_id migration):
  1. `UPDATE credit_ledger SET wallet = 'leadgen' WHERE wallet = 'email'`
  2. `UPDATE credit_grants SET wallet = 'leadgen' WHERE wallet = 'email'` (preserves any credit
     value customers already paid for — nothing is lost)
  3. `UPDATE billing_plans SET wallet = 'leadgen' WHERE wallet = 'email'`
  4. For every `BillingSubscription` row: if `plans` JSON has both `leadgen` and `email` keys,
     keep whichever plan has the higher `credits` value under the `leadgen` key and drop the
     `email` key. Log any org this happens to for manual review (could affect what they're
     billed next cycle).
- **Auto-enroll pipeline** (this is now simple, single-wallet, no bundle logic needed):
  - Add `auto_enroll_campaign_id` (nullable FK → `email_campaigns.id`) to `Mission`.
  - Add `mission_id` (nullable FK → `missions.id`) to `EmailCampaign`.
  - In `enrichment_waterfall.py`, right after a successful `lead_lookup` charge (lines
    237/252/296): if `mission.auto_enroll_campaign_id` is set, create an `EmailEnrollment`
    (`prospect_id`, campaign id, status=`pending`). No separate credit check needed here since
    it's one wallet — if the org can afford to run leadgen, it can afford to queue the email (the
    actual `email_send` charge still only happens at dispatch time in `email_dispatcher.py`).

## 3. Remove free credits entirely — no trial
- Delete whatever signup hook currently auto-grants starter credits (the one from commit
  `54d9331`) — find it via the `STARTER_CREDITS` reference in `credits.py:71-76` and the
  signup/org-creation path that calls it. Remove it outright, don't replace it with anything.
- A brand-new org gets zero credits and no plan. Every tab stays locked (per Plan C) until an
  admin actually pays for a plan/top-up through Stripe checkout. There is no $0 option anywhere
  in the flow.

## 4. Fix Checklist — "make them functioning"
Before/alongside the merge, verify these flows end-to-end (currently reported broken/unverified).
Antigravity should run each, fix what fails, and report pass/fail per item for review:

1. Create a mission → prospect search returns results → enrichment waterfall finds an email →
   `lead_lookup` credit is actually deducted from the `leadgen` wallet ledger.
2. Found lead with `auto_enroll_campaign_id` set → `EmailEnrollment` row created automatically
   (new behavior from §2, verify it fires).
3. Connect a mailbox (OAuth and SMTP, both paths) → DNS/SPF/DKIM/DMARC verification completes →
   mailbox shows as "verified" in UI.
4. Create an email sequence with 2+ steps → enroll a lead → send fires on schedule →
   `EmailSendLog`/`EmailMessage` rows update → `email_send` credit deducted exactly once per
   send (not double-charged, not skipped) — confirms the §2 `charged: True` fix actually took
   effect.
5. A reply to a sent email is received and categorized on the `EmailMessage` row.
6. Suppression list (`EmailSuppression`) is actually honored — a suppressed address is skipped on
   enroll or send, not just stored.
7. Credits running out mid-sequence: wallet hits zero → further sends correctly blocked
   (402/held state), not silently dropped or sent for free.

Each failure found should be reported with repro steps; don't guess-fix without reproducing first.
