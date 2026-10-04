# Plan H — Make every Leadgen tab real, default the Telnyx/AI cost rates, and settle the account question

## Part 1 — "What if a customer only buys Leadgen, not Voice?" (answered, no build needed)
Checked `backend/app/services/telnyx_client.py:30-35` — `platform_key()` is already a single,
platform-wide master Telnyx API key (env var `TELNYX_API_KEY`, falling back to the one saved in
the admin portal). It is **not** a per-customer credential: customers never had their own Telnyx
account, with or without Voice. Telnyx numbers/calls for every customer already run through this
one master account (Billing Group / Managed Account mode, per the existing voice architecture).

So a Leadgen-only customer needs **no new account, anywhere** to get phone-number validation via
Telnyx's Number Lookup API (Part 3 below) — it calls the same master key Voice already uses. The
cost of those lookups is paid by Aivhub and recovered through the `lead_lookup` credit charge, the
same way Telnyx's calling cost is recovered through `voice_minute` credits. This is purely a
backend-to-backend call with no customer-facing account step at all.

## Part 2 — Default the "our cost" rate-card entries, not leave them at 0
Checked `backend/app/services/revenue.py:28-35` (`unit_costs()`) — every rate-card item's "our
cost per unit" defaults to `0.0` until a staff member manually types a number into the admin
portal. Margin reporting is silently wrong (100% margin shown) until someone does that by hand.

**Decision confirmed**: pre-populate real researched defaults in code, same pattern as
`DEFAULT_RATES` already does for the customer-facing price — staff can still override every value
in the existing admin UI, this just stops the "our cost" column from starting at a lying zero.

Add a `DEFAULT_UNIT_COSTS` dict next to `DEFAULT_RATES` in `credits.py`, and have
`unit_costs()` (`revenue.py:28`) fall back to it instead of `0` when nothing is stored yet:

| Rate card item | Default "our cost" | Source |
|---|---|---|
| `voice_minute` | **$0.056** (Telnyx managed Voice AI, all-in STT+LLM+TTS) if `TELNYX_MANAGED_ASSISTANTS` is on, else **$0.009** (Call Control $0.002 + SIP ~$0.007) for the self-hosted LiveKit path | [Telnyx Voice AI pricing](https://telnyx.com/pricing/voice-ai), [Telnyx pricing](https://telnyx.com/pricing) |
| `phone_number_month` | **$1.00** (US local number) | [Telnyx number pricing](https://telnyx.com/pricing/numbers) |
| `number_setup` | **$0** (Telnyx charges no activation fee on standard local numbers; only toll-free/short codes carry one, which this app doesn't provision) | same |
| `whatsapp_message` | **$0.025** (US marketing-template ceiling; utility templates run ~$0.005 — default to the higher figure so margin is never overstated) + Telnyx's own BSP markup, which Telnyx doesn't publish a flat number for — flagged in the admin UI as "check your Telnyx invoice, this is Meta's fee only" | [WhatsApp Business API pricing](https://www.quickreply.ai/whatsapp-automation/whatsapp-business-api-pricing) |
| `lead_lookup` | **$0.003** (Telnyx Number Lookup, once Part 3 wires it in) — the LLM web-search step riding on it costs whatever model the org has configured, which isn't a fixed market price, so it's left out of the default and stays staff-editable | [Telnyx Number Lookup pricing](https://telnyx.com/pricing/number-lookup) |
| `email_send` | left at the existing default (depends entirely on which LLM the org has configured for reply drafting — not a fixed vendor price like Telnyx, so no invented number) | — |
| `ai_post`, `ai_image` | same reasoning as `email_send` — provider-dependent, left for staff to enter once they know which model they're paying for | — |

Rows with a real external vendor (Telnyx) get a real default. Rows whose cost is "whichever LLM
you configured" are left for staff to fill in — a made-up AI-token price would be actively
misleading, not a convenience default.

**Build**: additive only — `DEFAULT_UNIT_COSTS` constant, `unit_costs()` falls back to it,
`set_unit_costs()` behaviour unchanged (still overrides whatever's stored). No migration needed,
nothing breaks for staff who already typed their own numbers in (stored values always win).

## Part 3 — Every Leadgen tab, what's real today, what isn't, and the fix
Confirmed by reading `LeadGenerationPlugin.jsx` end to end (all 10 views):

| Tab | Today | Fix |
|---|---|---|
| **AI Lead Scout** (`scout`) | `handleSimulatedSearch` fabricates results client-side; real backend (`POST /enrichment/discover-accounts`) already exists and works, built on free Bing/DuckDuckGo HTML scraping (`search_open_web`) — real company names, no invented fields, but fragile against search-engine blocking | Wire the frontend to the real endpoint (Plan 07 Part 1, unchanged). **Add real Telnyx Number Lookup** (LRN + CNAM) on every candidate phone number before it's shown or charged — turns "a phone-shaped string was in the snippet" into "this is a real, callable number," using the existing master Telnyx key, no new account (Part 1) |
| **AI Lead Copilot** (`copilot`) | Chat UI was built this session (previously unrendered, now fixed) — real, already working | none needed |
| **Saved Accounts** (`accounts`) | `useState(INITIAL_DUMMY_LEADS)` only — nothing server-side, gone on refresh, invisible to teammates | Build real persistence: new `POST /prospects` endpoint + `Mission` row per search/import, Leadgen UI loads/saves through it (Plan 07 Part 3 — now **mandatory**, not optional, since Scout and Import both become pointless if their output can't be kept) |
| **Decision Makers** (`contacts`) | Reads from the same in-memory `leads` array — real once Scout + persistence are real | falls out of the two fixes above, no separate work |
| **Account Dossiers** (`dossiers`) | Same — derived view over `leads` | falls out of the two fixes above |
| **Import & Export** (`import_export`) | "Browse Files" just shows a toast (`"CSV upload simulator..."`); real backend (`POST /missions/upload-parse`) already does real CSV/XLSX parsing | Wire the button to a real file input + the real endpoint, map rows into the same shape Scout uses (Plan 07 Part 2, unchanged) |
| **Sequences** (`sequences`, `CampaignsView`) | Real — backed by the pre-existing email-outreach backend from before the Leadgen/Email merge | none needed |
| **Replies** (`replies`, `RepliesView`) | Real — same backend; this is where the earlier `email_outreach.py` reply-generation bug was fixed this session | none needed |
| **Mailboxes** (`mailboxes`, `MailboxesView`) | Real | none needed |
| **Do Not Email** (`suppression`, `DoNotEmailView`) | Real | none needed |
| **Subscription** (`subscription`) | Real, existing shared `SubscriptionPage` component (admin-only view) | none needed |

So the genuinely fake surface is exactly three things, all already scoped: **Scout's data
source**, **Import's wiring**, and **persistence** — everything else in the plugin already works.
Telnyx Number Lookup is the one new piece this message adds on top of Plan 07, and it's small
(one HTTP call per candidate number, same master key, no new account, ~$0.003/lookup against a
$0.20-0.25/lead charge to the customer).

## Build order
1. `DEFAULT_UNIT_COSTS` (Part 2) — small, isolated, immediately fixes margin reporting. Do first.
2. Persistence (`POST /prospects`, Mission-backed Saved Accounts) — unlocks everything else below.
3. Scout: real endpoint + Telnyx Number Lookup validation (Plan 07 Part 1 + this plan's addition).
4. CSV Import wiring (Plan 07 Part 2, unchanged).
5. Auto-enroll (falls out of step 2, Plan 07 Part 4, unchanged).

No new third-party vendor accounts anywhere in this plan — only the Telnyx master key (already
held) and whichever LLM key the org already configured for the web-search/opening-hook step.

## Still open from the LinkedIn/Facebook side (separate from Leadgen, not re-opened here)
Not re-researched in this plan since it was a separate thread — the Meta/LinkedIn OAuth admin UI
and its real review/approval requirements stay exactly as scoped in Plan 07's outstanding items,
picked up separately whenever you want it.
