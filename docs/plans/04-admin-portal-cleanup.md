# Plan D — Admin portal: Platform Keys by plugin, client removal, Staff layout

## Background (confirmed in code, not guessed)
- **Telnyx AI Assistant**: one shared assistant for every company today. `TELNYX_MANAGED_ASSISTANTS`
  is off; turning it on switches to one assistant per user/org (`backend/app/services/voice_assistants.py:9`).
  No change needed unless the business wants per-user assistants — that's a feature flag flip, not
  a bug.
- **Embeddings**: self-hosted (`BAAI/bge-small-en-v1.5` via fastembed, `embedding_service.py:11-12`),
  shared across all orgs, scoped per-org by `knowledge_chunks.org_id`. No key required for the
  default. No change needed.
- **Platform AI** (`backend/app/api/admin_portal.py:942-961`) is scoped to Post Scheduler only
  (writing + image AI, Main/Backup). It reads its available providers from whatever's saved on
  Platform Keys (`_saved_ai_keys`) — it's a routing preference on top of Platform Keys, not a
  duplicate store. Voice and Leadgen have no equivalent selector today.
- **Revenue "Our cost per unit"**: manual by design — it's OutReach's own cost from its providers,
  which no external system (Stripe included) can supply. No change needed.
- **Client removal**: no delete endpoint exists. `Organization.status` (`active/inactive/suspended`)
  already exists and gives a safe archive path. Only 4 of ~48 org-scoped tables have DB-level
  cascade delete configured, so a hard delete needs an explicit, ordered routine — not a raw
  `DELETE FROM organizations`.

## 1. Reorganize Platform Keys by plugin + extend Platform AI's routing pattern to all 3

**Problem with a literal "just group by plugin" reorg**: some key categories are genuinely
plugin-specific (Email Finder → Leadgen only; Telephony/TTS/STT/Voice Orchestration → Voice only),
but others are shared infrastructure used by more than one plugin today — the single LLM key list
already powers Voice's conversation reasoning, Leadgen's enrichment reasoning, AND Scheduler's post
writing, all from the same saved key (confirmed: Platform AI pulls its text/image provider options
from the same `_saved_ai_keys` list Platform Keys populates). Splitting the LLM section three ways
would mean the same OpenAI key gets saved three separate times for no reason.

**Design**: keep one underlying key store (no change to how keys are saved/encrypted), but change
the **page layout** to plugin-first tabs, each showing only what's relevant to it, with a routing
selector (Platform AI's existing Main/Backup pattern, generalized) wherever a plugin draws on a
shared key pool:

- **Voice tab**: Telephony (Telnyx, Twilio), TTS, STT, Voice Orchestration — all Voice-exclusive,
  shown as-is. Plus a new "Conversation AI" Main/Backup selector (same UI pattern as Platform AI's
  existing text-provider dropdown) choosing which of the shared LLM keys Voice's call reasoning
  uses.
- **Leadgen tab**: Email Finder (Icypeas, Hunter, Findymail, BetterContact, LeadMagic) —
  Leadgen-exclusive, shown as-is. Plus the same "Reasoning AI" Main/Backup selector for enrichment
  LLM calls, and a "Platform mailbox" section (already Leadgen-adjacent per the current page).
- **Post Scheduler tab**: exactly what Platform AI already does today (Writing + Images,
  Main/Backup) — this tab becomes the "Platform AI" page, just relabeled and moved under Scheduler
  instead of standing alone.
- **Shared tab** (or a persistent section visible from every tab): the actual LLM/Image/Embeddings
  key list itself — where keys are entered once — since all three plugins' selectors above point at
  this same pool. Renaming the page's top-level grouping from provider-category to
  plugin-first-with-a-shared-pool avoids the saved-three-times problem while still answering "where
  do I go to change what Leadgen uses" directly.

**Backend**: generalize `app/services/platform_ai.py`'s get/put/health/test functions (currently
scoped to Scheduler's text/image choice) to take a `scope` parameter (`"scheduler"`, `"voice"`,
`"leadgen"`), each with its own saved Main/Backup choice (new rows or a `scope` column on whatever
table currently stores the Scheduler-only choice). `admin_portal.py`'s `/platform-ai` routes become
`/platform-ai/{scope}`. The actual call sites that currently hardcode which key to use for Voice
conversation reasoning and Leadgen enrichment reasoning need to start reading this new per-scope
choice instead of whatever implicit default they use today — find those call sites first (likely
in `llm_gateway.py` or wherever Voice/Leadgen pick an LLM) before wiring the new selector, so the
UI control actually does something.

## 2. Client removal

Two separate features, not one — the business needs differ:

**A. Archive (ship this first, low risk)**: a "Suspend"/"Archive" action in the Clients table that
sets `Organization.status = "suspended"`. Add a toggle next to "Include Aivhub (own company)" —
"Include archived" — off by default, so archived test orgs stop cluttering the list immediately.
Fully reversible, no data loss, can ship today with minimal risk.

**B. Hard delete ("remove from history", for genuine test-data cleanup)**: a staff-only "Delete
permanently" action, separate from Archive, with:
- A confirmation step requiring the staff member to type the organisation's exact name (standard
  pattern for irreversible actions).
- A backend transaction that explicitly deletes from every org-scoped table in FK-safe order
  (missions → prospects → email_campaigns → email_enrollments → credit_ledger → credit_grants →
  connections → operators → ... → organizations last). Building the exact table list and order is
  real work — audit `tenancy.py`'s list of the 48 RLS-enabled tables and their FK relationships
  before writing this, don't guess the order.
- Runs inside one transaction so a failure partway through rolls back cleanly rather than leaving
  the org half-deleted.
- Recommend restricting this to orgs with zero real payment history (`BillingSubscription` rows
  with actual Stripe activity) as a safety rail, so it can't be used to erase a paying customer by
  mistake.

For the 3 specific test orgs visible right now (Acme Global Testing Ltd, Acme Test Ltd, Rucha
Solanki's company): once (A) ships, archive them immediately — that already gets them out of your
way. Only build and run (B) if you specifically need them gone from the database, not just hidden.

## 3. Staff page layout

`frontend/src/adminPortal/Staff.jsx` — move the "Add staff" form row (Email / Name / Role dropdown
/ Starting password / Add staff button) above the staff table instead of below it. Purely a JSX
reorder, no logic change, no backend involved.
