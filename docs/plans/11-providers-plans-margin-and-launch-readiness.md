# 11 — Providers, plans and margin, and what to fix before a public launch

Written 2026-11-24. This follows on from [10-leadgen-look-connectors-lead-sources.md](10-leadgen-look-connectors-lead-sources.md), which covers the Connectors screen and showing lead sources in the UI.
It's based on reading the backend and frontend, plus read-only queries on the live database. No code has been changed.

It answers three questions:

1. How do we make adding a new data provider (connector) easy?
2. How do we manage plans so that buying data from providers never makes a client unprofitable on a fixed monthly price?
3. What else must change before the app goes to the general public?

---

## Part A — Adding a new provider

### A.1 How it works today

The app talks to about 40 outside services: data, AI, voice, email and payments. **Each data provider is wired in by hand, in its own way.**

| Kind of provider | How it's added today | Where |
|---|---|---|
| Registers and open-data APIs (Companies House, FSA, CQC, Charity Commission, Gender Pay Gap) | **No code needed.** Staff fill in a `DataSource` row: endpoint templates and field mapping, run by `data_source_connector.py`. | Admin portal → Data sources |
| Email finders (Icypeas, LeadMagic, Hunter, Findymail, BetterContact, Apollo) | **Code.** Add to `PROVIDERS`, `LABELS` and `ADAPTERS` and write an adapter in `enrichment_waterfall.py`. The saved key is found by **matching the provider name inside the key's name**. | backend |
| Company and contact data (Apollo, Google Places, Tavily) | **Code.** Each has its own key pool with backup keys and cool-downs (`apollo_pool.py`, `tavily_pool.py`), its own call-log table (`ApolloCall`, `TavilyCall`), and its own calls inside `company_contacts.py` and `business_lookup.py`. | backend |
| AI models | **Mostly config.** `llm_gateway.py` is generic. Usage goes to `AiUsage`. | Platform Keys |
| Bulk files we buy or scrape (BN leads, ScrapeGraph) | **One-off scripts in the repo root** (`bn_load_leads.py`, `load_scrapegraph.py`), run inside the container by hand. | — |
| Voice: telephony and numbers (Telnyx), voice engines (LiveKit, xAI, OpenAI Realtime, Vapi, Retell, "modular", custom), speech-to-text and voices | **Code.** Engines are chosen by matching words in the saved connection's name (`voice_plugin_plan._norm_engine`: "vapi" in the name → Vapi). Each engine has its own router (`vapi_router.py`, `retell_router.py`, `livekit_router.py`). **Every engine is billed at the same `voice_minute` price**, whatever it costs us. | backend + Voice settings |
| Social: networks (LinkedIn, Facebook, Instagram, X, Threads, Reddit), AI images (Fal, Stability, OpenAI…), AI video | **Code.** One OAuth and publisher per network (`social_oauth.py`, `social_publisher.py`). Listening uses each network's search API (`social_listening.py`). **X search costs money per call on the X API plan and isn't charged to the client.** | backend + Social → Connect |

To add one more email finder or company-data provider today, someone must edit **8–12 files**:

- **Backend:**
  - the adapter, the provider lists and the waterfall order,
  - the key validator (`key_validator.py`, 26 hand-written validators),
  - the balance poller (`platform_balances.py`),
  - a price row (`provider_prices`) and possibly a rate-card item (`DEFAULT_RATES`, `DEFAULT_UNIT_COSTS_USD_CENTS` in `credits.py`),
  - the export rule (`data_policy.NON_EXPORTABLE`).
- **Frontend:**
  - the connector card in `ConnectorsView.jsx`, its logo in `ConnectorLogos.jsx` and its price in `connectorPrices.js`,
  - `CONNECTOR_PROVIDES`, `EnrichmentSourcesModal.jsx`, and the source labels in `SourceMark.jsx`.
- **Usage is logged in five different places** (`EnrichmentAttempt`, `ApolloCall`, `TavilyCall`, `AiUsage`, `NumberCheck`/`PhoneScreening`). So "what did provider X cost us for client Y" can't be answered in one query.

### A.2 Target: a provider registry

**The idea:** a new provider is one file (an adapter plus its "manifest") or, for a plain JSON API, no code at all. Everything else (key form, test button, routing order, usage log, cost, export rules, source label, Connectors card, plan availability) is generated from the manifest.

```
backend/app/providers/
  base.py            # the shared wrapper (below) and the capability interfaces
  registry.py        # loads every manifest; GET /api/providers serves it to the admin portal and Connectors screen
  capabilities.py    # EmailFinder, CompanyEnricher, PhoneValidator, TpsScreener, WebSearch, RegistrySource, LLM,
                     # Telephony, VoiceEngine, SpeechToText, Voice (TTS), ImageGen, VideoGen, SocialNetwork (publish / listen)
  email/icypeas.py   # one file per provider: MANIFEST + adapter class
  email/hunter.py
  company/apollo.py
  company/google_places.py
  search/tavily.py
  generic_http.py    # a JSON API described by config only (extends today's data_source_connector)
```

**Each provider's manifest declares:**

| Field | Example | What uses it |
|---|---|---|
| `id`, `name`, `category`, `logo` | `hunter`, "Hunter", `email_finder` | Admin portal, Connectors screen |
| `capabilities` + `fields` | `EmailFinder`, gives `email` | Routing, Find Leads filters, "Data they provide" chips |
| `auth` | `{api_key: secret}`, optional `base_url` | Key form, encrypted storage (`secret_box`), backup keys |
| `test()` / `balance()` | the vendor's cheapest call | Real "Test connection", balance alerts |
| `pricing` | `per_call` / `per_hit` / `per_record` / `monthly_fixed` / `prepaid`, cost, currency | The cost of every call, margin checks |
| `licence` | `exportable`, `cache_days`, `share_across_clients`, `client_label`, `attribution` | Export rules, cache expiry, the shared company record, source labels |
| `limits` | requests per second, monthly cap | Throttle, budget |
| `credit_item` | `lead_lookup` | Which rate-card item the client pays for |

**Every provider call goes through one wrapper:**

```
call_provider(capability, request, org, feature)
  1. check the plan allows this provider/capability, and the org's monthly cost cap
  2. check the shared cache, honouring licence.cache_days and share_across_clients
  3. try the routing order for the capability, using the key pool (backups, cool-down) and a circuit breaker
  4. write one ProviderCall row: provider, capability, org, actor, feature/route, units, cost, hit, latency, outcome, credit ref
  5. write the provenance key on the result (feeds the source catalogue in plan 10)
```

**Generalising code that already works:**

- `apollo_pool` and `tavily_pool` become one generic key pool.
- The waterfall order (`AppSetting email_finder_order`) becomes routing per capability.
- The five usage tables are replaced by **one `ProviderCall` ledger**. Start with a database view that unions the existing tables, so reports work on day one.

**What adding a provider looks like afterwards:**

1. Write `providers/<kind>/<name>.py` (about 60–120 lines), or add a config-only `generic_http` entry.
2. In the admin portal: paste the key → **Test** (a real call) → set the price, licence flags and position in the order → choose which plans include it.
3. Done. It appears on the Connectors screen and in the source labels, its cost reports and export rules apply, and it shows in the margin report. No frontend change.

### A.3 Step 4, first part, done on the branch (2026-11-25)

- **Registry:** `backend/app/providers/` holds `base.py` (Manifest, Pricing, Licence, Provider, EmailFinder, a shared answer check)
  and `registry.py`, which finds every provider file automatically, checks its manifest, and leaves out a broken file without
  stopping the app.
- **Six providers moved onto it:** `email/icypeas.py`, `leadmagic.py`, `hunter.py`, `findymail.py`, `bettercontact.py` and
  `company/apollo.py`. Their search code is unchanged, and each now has a real `test()` (balance or status call, no paid lookup).
- **Generated from the manifests:**
  - the waterfall's order, labels and searches,
  - which saved key belongs to which provider,
  - the export rule (Apollo's licence),
  - a Model Pricing row for a new provider (staff prices are never overwritten),
  - the Platform Keys **Test** button. That button used to accept any key of 3 or more characters for e-mail finders and Apollo.
- **Staff API:** `GET /admin-api/providers` (manifests, whether a key is saved, files left out) and
  `POST /admin-api/providers/{id}/test` (the saved key's real test).
- **Checked against the real keys on new.outreach:** Apollo, Icypeas, Hunter (50 searches left), Findymail (15 credits left) and
  BetterContact (44 credits left) all pass. LeadMagic has no key saved.
- **Adding an e-mail finder is now one file.** A test proves a new file joins the order with no other change.
- **Second part (2026-11-25):**
  - Tavily (`search/tavily.py`), Google Places (`company/google_places.py`), Telnyx number lookup (`phone/telnyx_lookup.py`) and
    Provero TPS (`phone/provero_tps.py`) are provider files too, each with its key source (`saved_key()`) and real test. All ten
    providers are now on the registry.
  - The Platform Keys Test button knows a "Google Places" key from a Gemini key. It used to check Places keys as Gemini.
  - New **Providers** page in the admin portal: every provider by category, with key saved or not, price and billing, licence,
    the credit item clients pay, and a Test button.
  - Real keys on new.outreach: **Tavily has 0 credits left this month** and **Telnyx has $6.57**. Both are the live accounts.
- **Still to do in step 4:**
  - the call sites of Tavily, Google Places, Telnyx lookup and Provero still call those vendors directly; move them behind the
    provider files,
  - ~~one generic key pool in place of `apollo_pool` and `tavily_pool`~~ **done (2026-11-25):** `app/providers/keypool.py` (main key,
    backups, set-aside per key or per kind of request, failover, one log row per request with only the key's id and label).
    `apollo_pool` and `tavily_pool` keep their names and status rules on top of it. On new.outreach, Apollo and Tavily each
    have a main key and 3 backups, so Tavily's empty main key fails over to the backups.
  - the `call_provider()` wrapper (plan and cost-cap check, shared cache, circuit breaker, one `provider_calls` table),
  - config-only providers (`generic_http`),
  - a Providers screen in the admin portal. Today it's the API only; the Connectors screen comes in plan 10, phase 3.

---

## Part B — Plans, credits and margin

### B.1 How it works today

- **Plans are credit bundles.** A `BillingPlan` gives a wallet (Voice, Leads, Social) a number of credits each month through Stripe. Every paid action spends credits from a rate card (`DEFAULT_RATES`, editable by staff). Unused plan credits expire at renewal. Top-ups never expire. New sign-ups start with 0 credits and charging switched on.
- **Live plans:**

  | Plan | Price | Credits | Price per credit |
  |---|---|---|---|
  | Leads Starter | £49.99 | 250 | 20.0p |
  | Leads Growth | £99.99 | 550 | 18.2p |
  | Social Starter / Growth | £49.99 / £99.99 | 250 / 550 | same |
  | Voice Starter / Growth | £199.99 / £399.99 | 1,320 / 3,000 | 15.2p / 13.3p |
  | Voice top-up | £12 | 60 | 20.0p |

  **There's no Leads or Social top-up**, so a Leads client who runs out can only upgrade.
- **Plan `features` are marketing text only.** Nothing checks them. Plans differ only in their number of credits. No plan says which providers or data sources it includes, how many users, exports or emails a day it allows, or how many AI assistant messages.
- **The cost side is fragmented:**
  - `revenue.py` works out cost as "units used × a cost per unit typed in by staff". It doesn't use the real vendor spend that is logged.
  - Amounts stay in their own currency: plans are in GBP, vendor costs in USD, and nothing is converted. So a true margin can't be computed.

### B.2 Is the per-action price safe? Mostly yes

Using the cheapest credit (Growth, 18.2p) and the vendor prices in `provider_prices`:

| Action | Client pays | Our cost (worst realistic) | Margin |
|---|---|---|---|
| Email found (`lead_lookup`, 5 credits) | 91p | ~11p per found email *if every search is billed*: 42 hits from 237 paid calls so far | ~85% |
| Google details view (1 credit) | 18p | $0.035 ≈ 3p | ~85% |
| Deep web search (5 credits) | 91p | $0.035 ≈ 3p | ~95% |
| Social page (2 credits) | 36p | Tavily $0.008 ≈ 1p | ~97% |
| TPS check, 5 numbers (2 credits) | 36p | 5 × $0.0053 ≈ 2p | ~94% |

These figures are before VAT, Stripe fees and fixed costs. If the £49.99 / £99.99 prices include VAT, take about 17% off what the client pays.

### B.2a Voice and Social: two actions lose money, and voice depends on the engine

Voice credits cost the client 13.3p (Growth), 15.2p (Starter) or 20p (top-up). Social credits cost 18.2–20p. $1 ≈ 79p.

| Action | Client pays | Our cost | Margin |
|---|---|---|---|
| **Phone number rent, per month** (1 credit) | 13–20p | Telnyx about **$1.00 ≈ 79p** | **loss of about 60–65p per number per month** (2 numbers rented today) |
| Voice minute, person calling from the browser (1 credit + 1 for the transcript) | 27–40p | carrier leg 0.9¢ ≈ 0.7p + speech-to-text | ~95% |
| Voice minute, Telnyx AI assistant (1 credit) | 13–20p | 5.6¢ ≈ 4.4p (`credits.default_voice_minute_cost_usd_cents`) | ~67–78% |
| Voice minute, **other engines** (LiveKit default, OpenAI Realtime, Vapi, Retell, premium voices) | 13–20p | **not measured.** Realtime models and premium voices can cost several times the Telnyx rate | **unknown: may be negative** |
| WhatsApp message (1 credit) | 13–20p | Meta $0.025 + Telnyx markup ≈ 2–3p | ~85% |
| Number setup (5 credits) | 67p–£1 | $0 | ~100% |
| AI post (2 credits) | 36–40p | a few AI calls, pennies | ~95% |
| AI image (1 credit) | 18–20p | under 1p to about 15p, depending on provider and quality | 25–95% |
| AI video (20 credits) | £3.64–£4.00 | $0.30–$3 ≈ 24p–£2.37 | 35–94% |
| Social listening on X | not charged | X API plan, a fixed monthly fee | fixed cost (B.4 item 4) |

Live data is too small to check these against real bills: 9 AI calls and 2 browser calls in 30 days.

**So the risk isn't the price of each action. It's the work we pay for that is never charged, costs we can't see, and fixed data costs.**

### B.3 Where we can lose money today

| # | Problem | Evidence |
|---|---|---|
| 1 | **Searches that find nothing cost us but aren't recorded.** The waterfall asks up to 4 providers. It records a cost only when an email is found, but several vendors bill per search. | `enrichment_waterfall.py:438` (`cost = … if email_addr else 0.0`). BetterContact: **36 calls, 0 hits**. Hunter: 67 calls, 11 hits |
| 2 | **AI is costed at $0.** DeepSeek's price row is 0 and not confirmed, so every AI call counts as free. | 766 AI calls in 30 days, all $0.00 |
| 3 | **Apollo has no price row**, so Apollo calls also count as free. | `provider_prices` has no `apollo`; 227 calls |
| 4 | **Vendor calls can't be traced to a feature.** The route is blank on all 5,833 Tavily calls and 208 of 227 Apollo calls, so client usage can't be told apart from internal bulk jobs (e.g. `bn_enrich_all.py`). | `tavily_calls.route`, `apollo_calls.route` |
| 5 | **Spend far above charges.** In 30 days the default organisation made 5,833 Tavily and 227 Apollo calls but was charged 330 Leads credits. Probably internal work, but nothing says so. | `credit_ledger` vs `tavily_calls` / `apollo_calls` |
| 6 | **No cap on AI assistant chats.** Messages are counted per organisation per day, but the limit is never checked: `_spent_today()` is never called. The chat itself costs no credits. | `api/lead_assistant.py:135` |
| 7 | **The credit check lets work through when it errors**: "if the credit check itself errors, the work runs anyway". Fine for a call in progress, risky for bulk paid lookups. | `credits.py` docstring |
| 8 | **Two organisations aren't charged** (`enforce=false`), and nothing shows when this was switched off or until when. | `app_settings credits:org_8a0a00e0b690`, `credits:org_be057ef8e279` |
| 9 | **Fixed data costs aren't modelled anywhere**: TPS licence (£2,200 + VAT a year ≈ £183/month), the BN data purchase, ScrapeGraph runs, future Experian / Market Location contracts. Credits only cover per-call cost. | — |
| 10 | **No per-client profit and loss.** Nothing compares what an organisation paid this month with what its usage cost us. | `revenue.py` |
| 11 | **Licence risk in the shared cache.** Data bought for one client is reused for others for free (`BusinessRecord`, `PersonCache`: "a verified address found earlier, for anyone"). That's good for margin, but vendors' terms (Apollo, Hunter, Google) may not allow it. Google is already purged (`purge_google_values.py`). | needs a check of each vendor's terms |
| 12 | **Phone number rent is priced below cost**: 1 credit a month against about $1. | `credits.DEFAULT_RATES["phone_number_month"]`, `DEFAULT_UNIT_COSTS_USD_CENTS` |
| 13 | **One voice price for every engine.** An organisation that picks a costly engine or premium voice pays the same 1 credit a minute. | `voice_plugin_plan.py`, `DEFAULT_RATES["voice_minute"]` |
| 14 | **Voice cost per call isn't recorded**, only the credits charged, so the real margin of a minute can't be checked. | `credit_ledger` has the minutes; no vendor cost per call |
| 15 | **X listening costs us and isn't charged.** Every search runs on our X API plan. | `social_listening.py` docstring |
| 16 | **AI image and video prices don't depend on the provider or quality chosen.** | `DEFAULT_RATES["ai_image"]`, `["ai_video"]` |

### B.3a Step 2 done on the branch (2026-11-24)

| # | Outcome |
|---|---|
| 1 | **Misses:** you confirmed the e-mail finders charge only for a find, so costing a find only was right. Each lookup price now has a billing setting ("Per find only" or "Every search", on Model Pricing). A miss is costed when a vendor bills every search. Web search, Google Places, Telnyx lookup and TPS screening are marked "Every search". |
| 2–3 | **DeepSeek and Apollo unpriced:** staff now get a `PRICE-01` alert (owner banner and e-mail, at most daily) for any provider used with no price. Model Pricing shows "N calls in 30 days counted as $0", and Apollo appears there, waiting for a price. **Still to do:** staff type in the real DeepSeek and Apollo prices. |
| 4–5 | **Vendor calls with no cause:** background jobs now log as "JOB <name>" and hand-run scripts as "script <file>". The spend was the platform's own bulk work (all of it in org_default), not client usage. |
| 6 | **Correction:** the assistant has no daily cap **on purpose** (a burst limit stays; a message costs a fraction of a penny). Make it a plan limit in step 5 if wanted. |
| 7 | **Credit check failures:** work up to 25 credits still runs (`CREDIT_CHECK_FAIL_ALLOWANCE`); larger work is refused with USR-07 until the check works. Calls keep their own rule. |
| 12 | **Phone number rent:** 15 credits a month (was 1): at least 60% margin on every plan. Help pages updated. |
| 13 | **Voice per engine:** a new `voice_minute_premium` item at 2 credits for OpenAI Realtime, Vapi, Retell or an ElevenLabs voice. A call keeps the price it started on. Browser calls and Telnyx's own AI stay at 1. |
| 14 | **Correction:** `telnyx_usage.py` already compares Telnyx's cost per organisation with the minutes billed, monthly. Other engines' costs are still not recorded. |

### B.3b Step 3 done on the branch (2026-11-25)

- **One cost ledger:** the database view `provider_calls` (`services/cost_ledger.py`) joins AI calls, e-mail finders, Tavily
  (credits × price), Apollo and Telnyx number lookups. It's rebuilt at every start and respects company scoping. On the copied
  live data it holds 7,113 calls.
- **Exchange rates:** ECB reference rates, read twice a day (`services/fx.py`), kept per day, and marked "estimated" until the
  first read. First read: $1 = £0.7635 (24 Nov 2026).
- **Profit per client** (admin portal → Revenue → "Profit by client, in pounds";
  `GET /admin-api/revenue/clients`): what each client paid, the recorded cost, the estimated cost for usage not logged per call,
  the margin, and flags (below the 60% floor, cost with no payment, calls counted as $0, unknown cost). Worst first.
- **First result:** clients paid £1,561.85 in October against £1.56 of cost (99.9% margin). The real spend is internal:
  Aivhub's own account cost £40.72 in November (6,249 calls, mostly Tavily bulk work), and 683 AI calls had no client and no price.
- **Not yet:** sharing out fixed costs (step 5), VAT and Stripe fees (decision 4), and the cost of voice engines other than
  Telnyx's AI.

### B.3c Step 5, first part, done on the branch (2026-11-25)

- **What a plan includes:** `BillingPlan.rules.providers` (none = every provider). The e-mail waterfall, the Apollo and Tavily
  key pools and Google Places use only the providers a company's live plans include. A company with no live plan isn't limited.
- **Fair-use cost cap:** `rules.cost_cap_pct`, a share of what the company paid this billing period (net of VAT when prices
  include it). At 80% the company's admins get the low-credits e-mail and staff get CAP-01; at 100% paid lookups are refused
  (USR-08) until a top-up or the next period. Calls and phone rent are never paused. Off unless a plan sets it.
- **Margin guard** (`services/margin_guard.py`):
  - shows every activity's margin at the cheapest net credit (VAT and Stripe 1.5% + 20p taken off) against its worst-case cost,
  - saving rates or a plan that puts an activity below the floor, or further below it, is refused unless staff give a reason,
    which is audited as `margin.override`,
  - a price that was already low doesn't block an unrelated change,
  - floor 60% and "prices include VAT" are settings.
- **On the Plans & pricing page:** the Margin check table, an Includes column with an editor per plan, and a "save anyway?"
  prompt with a reason.
- **What the guard found on today's prices** (cheapest net credit: Voice 10.9p, Leads and Social 14.8p):
  - **AI video clip 23%**: 39 credits needed for 60%,
  - **Phone number 53%**: 18 credits needed; the 15 set in step 2 assumed prices before VAT and fees,
  - premium voice minutes, call transcripts, AI posts and images have no known cost yet.
- **Second part (2026-11-25):**
  - **Fixed costs:** a `fixed_costs` table (vendor, amount, currency, monthly, yearly or one-off spread over 12 months, dates,
    optionally an app) with an editor on the Revenue page. Every change is audited.
  - **Client profit now shares the month's fixed costs among paying clients by what they paid** (Fixed share, After fixed).
  - **Break-even per plan:** subscribers, net price, the average usage cost per subscriber last month, what one subscriber
    leaves us, the plan's share of fixed costs and the subscribers needed. On today's plans the TPS licence alone (about £220 a
    month including VAT) needs 2 Voice Starter, 3 Leads Growth or 6 Leads Starter subscribers.
- **Third part (2026-11-25):**
  - **Plan limits** in `rules.limits`, set per plan on Plans & pricing. A company gets the highest limit any of its live plans
    sets; no plan setting one, or no live plan, means no limit. Refusals say what the plan allows (USR-09).
    - users: checked when a team member is added,
    - exports a month: counted from `export.created`,
    - e-mails a day: checked at each send's credit check, counted from the day's e-mail charges (UTC),
    - assistant messages a day: no cap unless a plan sets one, as decided earlier.
- **Still to do in step 5:**
  - Leads and Social top-ups: the mechanism exists, but they need prices.

### B.4 Target: plans that can't go below a margin floor

**1. Every call has a known cost** (fixes 1–4)
- Use the manifest's `pricing.model` (per call vs per hit) to record cost on every call, including misses.
- Price DeepSeek and Apollo now. Add an admin alert for any provider used while its price is missing or unconfirmed.
- Every `ProviderCall` carries `org`, `feature` and `internal: bool`. Bulk scripts run as an `internal` system org, so they never count against a client.
- Daily exchange rate (ECB) stored so USD costs can be shown in GBP.

**2. Plans that say what they include** (`BillingPlan` gains JSON fields; staff edit them in the admin portal)
- `includes`: which capabilities and providers this plan may use. For example, Experian or Market Location only on Growth or above; Starter uses registers + web + the cheaper email finders.
- `limits` (monthly): companies revealed, emails sent per day, exports, users, AI assistant messages per day, number checks, TPS checks.
- `fair_use_cost_cap`: the most our variable cost may reach for one organisation in a month, e.g. 40% of the plan's net price. Over it: warn at 80%, then pause paid lookups until a top-up or the next period. The client sees "monthly limit reached", never a hidden failure.
- `overage`: `block` | `topup_prompt` | `auto_topup` (with the client's consent).
- **Add Leads and Social top-ups** so heavy users pay rather than being blocked.

**2a. Voice and Social prices that follow the cost** (fixes 12–16)
- Phone number rent: at least 6 credits a month, or include one number in each Voice plan.
- Voice minute priced **per engine and voice tier** (the manifest's `pricing`). Plans say which engines they include, e.g. premium voices only on Growth.
- Record the vendor cost of every call (Telnyx usage, engine usage) in `ProviderCall`, so the margin of a minute is measured, not guessed.
- X listening: either a Social plan limit (topics × searches a day) or a credit per search. Count the X plan as a fixed cost.
- AI image and video: price per provider and quality, with the cheapest as the default.

**3. A margin guard when staff change prices**
- When a plan, top-up or rate-card item is saved, compute for every action: cheapest credit price (net of VAT and Stripe fees) − worst-case cost (manifest prices × routing depth). **Refuse, or ask for an explicit override, below a minimum margin** (e.g. 60%).
- The same check runs nightly against **real** costs from `ProviderCall` (actual hit rates). It emails staff when an action drifts below the floor, e.g. a vendor raises prices or a provider's hit rate collapses.

**4. Fixed data costs and break-even**
- New table `FixedCost` (vendor, amount per month, currency, from–to, which wallet / capability).
- Admin "Break-even" panel: fixed costs per month ÷ net margin per subscriber = **subscribers needed per plan**. Example: the TPS licence alone ≈ £183/month ≈ 5 Leads Starter clients at about £37 net margin each.

**5. Profit and loss per client** (admin portal → Revenue)
- For each organisation and month: paid (Stripe, net) − variable cost (`ProviderCall`) − share of fixed costs = margin.
- Sort by worst margin and flag anyone below the floor.
- Exceptions ("not charged", free credits) need a reason, an expiry and an audit entry (`CreditAward` is already append-only; use the same pattern).

**6. Licence-aware caching**
- `licence.share_across_clients` and `cache_days` come from the manifest and are enforced by the wrapper.
- Where a vendor allows reuse, reuse is pure margin. Where it doesn't, the cache is per client and expires.

**7. Closing the uncharged gaps**
- Enforce the assistant daily limit per plan.
- Paid bulk work fails safe when the credit check errors (allow a small per-organisation daily allowance instead of unlimited).
- Background research and checks reserve credits before they start (`hold`/`confirm` already exist; use them everywhere a paid provider is called).

---

## Part C — Before a public launch

Rated: 🔴 must fix before launch · 🟠 fix in the first weeks · 🟢 good to have.

### C.1 Security and access
| | Item | Evidence |
|---|---|---|
| 🔴 | **Logins made by code with passwords in the source code.** Every start-up recreates the FSB organisation with `fsbadmin` / `fsbuser` when it's missing, so a new database gets an Admin with a published password. On this server the password variables aren't set and neither account has changed its password, so both very likely still use the code's passwords. | `services/fsb_demo.py:37,53`, `main.py:611`, `core/migrations.py:1148` |
| 🔴 | **`fsbadmin` is exempt from the sign-in lockout**, so its password can be guessed without limit. | `api/auth.py:250` |
| 🔴 | **The FSB logins' e-mail addresses are at `outreach.com`**, a domain we don't own, so reset links and notices would go to someone else. | `services/fsb_demo.py:25,30` |
| 🟠 | **Sign-in method rules are checked by web address only.** A brand's "no password" rule doesn't apply when its user signs in on the main address. | `api/auth.py:289` |
| ✅ | ~~**Login by username takes the first match across all companies**~~ **Done on the branch 2026-11-24:** usernames are unique across companies (index `uq_operators_username_ci`), a shared e-mail is refused rather than guessed, and admins can't reuse another account's e-mail. | `api/auth.py` |
| 🟠 | **If a company's rules can't be read, none apply** (fail open), so the member list and exclusions disappear for a few seconds. | `services/tenant_policy.py` `org_effective` |
| ✅ | ~~**CORS allows every origin with credentials**~~ **Done on the branch 2026-11-24** (`core/cors.py`): our own sites, verified brand domains, partner addresses and our extension get credentialed access; `/v1`, web forms and legal pages answer any site without credentials; everything else gets nothing. Live after merge. | `main.py` |
| ✅ / 🟠 | **Ports: done live 2026-11-24.** 8000 and 8080 are bound to 127.0.0.1 (`docker-compose.override.yml`); only scanners had been using them. **Docs:** the default is off on the branch, but live `.env` sets `EXPOSE_API_DOCS=true` explicitly, so the docs stay public. **Decided 2026-11-24: keep them on for now.** | `docker-compose.override.yml`, `main.py` |
| ✅ | ~~**`.env.backup` isn't git-ignored.**~~ **Done 2026-11-24:** `.env.*` (except the example and `.env.local`) and root data files are ignored (`.gitignore` on the branch, `.git/info/exclude` live). `.env` and `.env.backup` were readable by every user on the server (644); now root only (600). | `.gitignore` |
| ✅ | ~~**Client data is lying in the app folder**~~ **Done 2026-11-24:** the 13 files with e-mails and phones moved to `/root/aivhub-private-data/repo-root-2026-11-24/` (root only, with a README). Delete them when no longer needed. | repo root |
| ✅ | ~~Feature access by **hard-coded usernames**~~ **Done on the branch 2026-11-25 (step 7):**<br>• `isFsbAccount()` and its username lists are gone. Connectors shows for everyone, and only admins can test.<br>• The FSB sidebar badge is now a brand setting: `theme.accountLink`, set for the FSB brand by migration `2026_12_11_fsb_brand_account_link`.<br>• The unused `operatorFromLogin()` "jitendra" special case is gone.<br>• The Voice call card no longer starts every account with two real phone numbers ("Jitendra Mehta", "Operations Desk"), and the template preview's sample number is an Ofcom drama number. A test keeps them out (`noBuiltInContacts.test.js`). | `hub/SidebarAccountBadge.jsx`, `brand/brandLogic.js` |
| 🟠 | Postgres, Redis and LiveKit ports: check none is reachable from outside in production (the override binds some to 127.0.0.1; base compose binds `5432` and `6379` openly). | `docker-compose.yml:17,30` |
| 🟠 | Rate limits exist only on sign-in failures and partner API keys. Add per-IP and per-organisation limits on sign-up, password reset, the assistant, and every paid action. | `api/auth.py:251` |
| 🟠 | Sign-up has email verification, but no bot protection (captcha / Turnstile) and no disposable-email check. | `api/signup.py` |

### C.2 Money
| | Item |
|---|---|
| 🔴 | Part B fixes 1, 2, 3, 6 and 8: price every provider, record cost on misses, cap the assistant, review the two uncharged organisations. |
| 🔴 | Stripe live mode: live keys only in `.env`, webhook secret set, `STRIPE_AUTOMATIC_TAX` decided (VAT), and a test purchase, renewal, downgrade and cancel on live with a real card. |
| 🟠 | Leads and Social top-ups; plan `includes` / `limits`; per-client profit and loss; margin guard (Part B.4). |
| 🟠 | Vendor budget alerts per provider (`platform_balances.py` already polls balances; add monthly spend limits per provider). |

### C.3 Data, compliance and legal (UK B2B outreach)
| | Item |
|---|---|
| 🔴 | **Check each vendor's licence**: resale and cross-client reuse (Apollo, Hunter, Icypeas, …), caching limits (Google), and whether the BN file's phones/websites came from Google (plan 10). |
| 🔴 | Data protection basics for a public SaaS: ICO registration, privacy notice and terms (pages exist; have them reviewed), a data processing agreement for clients, a list of sub-processors (every provider in Part A), a legitimate-interest assessment for B2B data (`LiaCard` exists). |
| 🟠 | PECR: TPS/CTPS screening exists, but the "block unscreened numbers" rule **only affects exports**. A person calling from the browser just gets a warning. Make the rule apply to calls (plan 12, B8), then decide whether it's the default for every new organisation. |
| 🟠 | Record retention: the 12-month review exists. Also apply retention to `raw_data`, call recordings and vendor call logs. |
| 🟠 | Provenance and Google export fixes from plan 10, Phase 0–1. |

### C.4 Client-specific code (FSB) that the public would hit
> The full design is in [12-company-rules-and-moving-fsb-to-a-real-company.md](12-company-rules-and-moving-fsb-to-a-real-company.md): every company sets its own rules for Leads, Voice and Social, and `fsbadmin` / `fsbuser` move into a real FSB company (kept, not retired).

- 19 backend and 15 frontend files mention FSB: `fsb.py`, `fsb_import`, `fsb_rules`, `fsb_matching`, `fsb_demo`, the FSB exclusion filters, `org_fsb_demo`, and the "Import & match" and "Monthly changes" screens.
- Turn each into a **general feature behind a plan or brand setting**:
  - FSB exclusions → "exclusion rule sets",
  - FSB import & match → "Match your records",
  - member suppression → "Member list".
- Or keep them for the FSB brand only, chosen by brand settings, not by username.

### C.5 Running the service
| | Item | Evidence |
|---|---|---|
| ✅ / 🔴 | **Backups: local done 2026-11-24** (`/usr/local/sbin/aivhub-db-backup`, `/etc/cron.d/aivhub-backup`): daily without the register rows (14 kept, 4 MB), weekly full (1 kept, only with disk room), weekly restore test. The first restore test matched live. **Still missing: an off-site copy.** The backups sit on the same disk as the database. | `/var/backups/aivhub` |
| 🔴 | **No error tracking or monitoring** (no Sentry or metrics). Add error tracking for backend and frontend, uptime checks, and alerts on queue backlog, failed provider calls and Stripe webhook silence (`billing.SILENT_WEBHOOK` exists; send it somewhere). | `requirements.txt` |
| ✅ / 🟠 | **CI: workflow written on the branch** (`.gitea/workflows/tests.yml`: 4 backend shards with PostgreSQL, frontend lint and tests). It runs only once Gitea Actions and a runner are set up. The 36 tests already failing on main are listed in `backend/tests/known_failures.txt` and skipped. Frontend: 703 tests pass, lint has 0 errors. | `.gitea/workflows` |
| ✅ | **Production config check: done on the branch 2026-11-25** (`services/config_check.py`, step 7).<br>• **Blocks:** a weak `SECRET_KEY`, Stripe test keys, mixed test and live keys, a Stripe key without its webhook secret, `CORS_ORIGINS=*`, and `TEST_COPY` on a production server.<br>• **Warnings:** public API docs, no `STAFF_ADMIN_EMAIL`, a public address that isn't https.<br>• At every start, each problem is logged and staff get one **CFG-01** alert. **Only with `APP_ENV=production` does a block stop the start-up.** Staff can read the list at `GET /admin-api/config-check`.<br>• **Live today (2026-11-25) would be blocked by Stripe test keys**, so don't set `APP_ENV=production` until live keys are in.<br>• Live also has no `STAFF_ADMIN_EMAIL`, so staff alerts are only shown in the admin portal, never e-mailed. |
| ✅ / 🟠 | **Root one-off scripts: copied to `backend/scripts/data_loads/` with a README on the branch 2026-11-25.** The README says which loader put which dataset into the company records. The originals are still untracked in the live folder's root. **Delete them there after the merge.** The CSVs moved out on 2026-11-24. |
| 🟢 | ~~Staging environment with a copy of production settings.~~ **Done 2026-11-24:** https://new.outreach.aivhub.com (compose project `flownew`, its own database and Redis). It holds a copy of live users and data plus the BN slice of the register, and it opens live keys only behind the `TEST_COPY` switch (`backend/app/core/test_copy.py`): outward jobs off, writes denied except cost-only providers, calls and e-mail only to allow-lists. TLS and domain check for the frontend (port 8080 is open on `0.0.0.0`; confirm a TLS proxy sits in front). |

### C.6 Product polish for strangers (not demo users)
- ✅ **First-run onboarding: done on the branch 2026-11-25 (step 7).** The "Get started" checklist (`hub/OnboardingChecklist.jsx`) had been built but wasn't shown anywhere, and its steps were for Voice only. It's now on the home screen for admins, until it's done or hidden.
  - The steps come from `GET /auth/onboarding` and follow the company's apps:
    - **Always:** describe your business, choose a plan or top up, invite your team.
    - **Leads:** find and save your first companies, connect a mailbox.
    - **Voice:** working hours, a phone number, a first call.
  - A self-sign-up with no app yet gets the Leads steps.
  - Each step is ticked from what the account really holds.
  - A line explains that credits are per app, with a link to "How credits work".
  - **Not done:** a pre-filled sample search.
- Pricing page and in-app "what this will cost" before every paid action. Cost boxes exist in places; make them consistent.
- Honest Connectors screen (plan 10, Phase 0) and real empty states.
- ✅ Help pages: checked 2026-11-25, and there's no FSB-specific wording. The Lists help now names the real origins.

---

## Part D — Order of work

| Step | What | Size |
|---|---|---|
| 1 | **Launch blockers:** no code-made logins, the lockout exemption and the FSB e-mail addresses (plan 12, step 1), CORS, close port 8000 and the docs, `.env.backup`, move the CSVs with personal data, backups, error tracking. | 3–4 days |
| 2 | **Stop silent losses:** price DeepSeek and Apollo, record cost on misses, assistant daily cap, tag internal jobs, review uncharged organisations, phone number rent above cost, a voice price per engine (B.2a). | 3–4 days |
| 3 | **`ProviderCall` ledger** (view first, then table) + daily exchange rate + per-client profit and loss report. | 4–5 days |
| 4 | **Provider registry**: manifests, shared wrapper, generic key pool, real Test/balance. Move the email finders, Apollo, Tavily and Google Places onto it. | 8–10 days |
| 5 | **Plans that say what they include**: `includes`, `limits`, fair-use cost cap, overage, Leads/Social top-ups, margin guard, fixed costs and break-even panel. | 6–8 days |
| 6 | Connectors screen on the registry API + lead-source work (plan 10, Phases 1–3). | as in plan 10 |
| 7 | Remove FSB-specific code paths, CI, production config check, onboarding. | 5–7 days |
| 8 | Look-and-feel work (plan 10, Phase 4), alongside steps 4–7. | as in plan 10 |

Steps 1–2 are the minimum before letting the public sign up. Steps 3–5 are what make a fixed monthly price safe as usage grows.

**Step 6, first part (2026-11-25, branch):** the Connectors screen is now built on the registry and the server (`GET /leadgen/connectors`, real Test), with one list of lead sources (`GET /leadgen/sources`). The BN file's Google phones and websites are now view-only. Plan 10's Phases 0–3 are done (plan 10, section 3.1). Cost per source is not done yet: look-ups need to record the lead they were for. On live, staff must run the provenance repair after deploying (dry run first).

**Step 7 (2026-11-25, branch): done, apart from what's listed as left below.**
- **Done:**
  - **FSB-only code paths:** no more username checks (C.1). The FSB badge is a brand setting. The record-matching routes are served at `/records/...` (`core/route_alias.py`), and the frontend uses them; `/fsb/...` stays for one release (plan 12, B5).
  - **Production config check** (C.5).
  - **Onboarding** (C.6).
  - **Root scripts** moved (C.5).
  - **CI:** the workflow from step 1 is in place, waiting for a Gitea runner.
- **Left:**
  - The FSB rule sets as data and the Rules screen (plan 12, steps 3–5).
  - "Create demo organisation" (plan 12, step 7).
  - Rate limits and bot protection on sign-up (C.1).
  - Off-site backups and error tracking (C.5).

---

## Part E — Decisions needed from you

1. **Margin floor:** what minimum gross margin per action and per client? (Suggest 60% per action and variable cost ≤ 40% of the plan's net price.)
2. **When a client hits their limit:** block until renewal, prompt a top-up, or auto top-up?
3. **Premium data** (Experian, Market Location, Apollo): included in higher plans, or always a paid extra?
4. **Prices:** do £49.99 / £99.99 include VAT?
5. **The two uncharged organisations:** who are they, and should they stay free (with an expiry)?
6. ~~**FSB features:** generalise for everyone, or keep for the FSB brand only?~~ **Decided 2026-11-24: generalise for every company; keep `fsbadmin` / `fsbuser` and move them into a real FSB company** (plan 12).
7. **Vendor contracts:** can you share the terms for Apollo, the email finders and the BN data, so we can set `share_across_clients` / `cache_days` correctly?
