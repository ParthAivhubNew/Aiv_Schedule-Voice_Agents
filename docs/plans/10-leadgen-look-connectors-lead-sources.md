# 10 — Leads: look and feel, real connectors, and showing where every lead came from

Written 2026-11-24 from a read of the code plus read-only queries on the live database. Nothing has been changed yet.
Adding new providers, plans and margin, and launch readiness are covered in [11-providers-plans-margin-and-launch-readiness.md](11-providers-plans-margin-and-launch-readiness.md).
The app was **not** reviewed in a browser, so the look-and-feel notes come from the code, not from screenshots.

**Voice and Social (added in the review of 2026-11-24):** the shared design tokens (`tokens.js`, `global.css`) and the dark-mode work in Phase 4 change the Voice and Social screens too, so check them in the same pass. Their connectors (voice engines, phone numbers, social networks) are on their own screens and belong in the provider registry of plan 11. Their rules (calling hours, TPS, approval) are in plan 12.

---

## 1. What we found

### 1.1 Look and feel

| Finding | Evidence |
|---|---|
| Styling is almost all inline | 2,499 `style={{…}}` objects and 618 hard-coded hex colours in `frontend/src/plugins/leadgen` alone |
| Three colour systems at once | `tokens.js` (`C.*`), CSS variables in `app/global.css` (`--ui-*`), and raw hex. They don't match: greens `#16A34A` / `#15803D` / `#166534`, blues `#3457D5` / `#2563EB` / `#1D4ED8` |
| White-label brands can't fully re-skin Leads | `BrandContext` can only change what uses `--ui-*`. The 618 hex literals ignore the brand |
| Two accent colours on one screen | Leads sidebar and header use purple `#8B5CF6` (`LeadGenerationPlugin.jsx`), but every button and chip uses cobalt `--ui-accent` |
| Shared classes get overridden by hand | e.g. the Import button restates background, border and shadow on top of `ui-btn--secondary`. The lock banner and the toast are also hand-built |
| Two tooltip styles | `SourceBadge` uses a white card and `SourceMark` a dark ink bubble, and each has its own positioning code |
| Very large screen files | `ConnectorsView.jsx` 2,606 lines / 109 KB, `AccountsViews.jsx` 1,889 / 133 KB, `FindLeadsView.jsx` 1,661 / 118 KB |
| No dark mode | `global.css` has no `prefers-color-scheme` rules. Only worth doing after the colours become tokens |

### 1.2 Connectors (`plugins/leadgen/ConnectorsView.jsx`)

The screen is mostly a static catalogue and isn't wired to the backend.

- **"Test connection" is fake.** A 550 ms `setTimeout` always returns `ok: true, status: 200, "Authentication verified"` (`ConnectorsView.jsx:1298-1320`). It reports success even when nothing is connected. **This is the most urgent fix: it tells users something false.**
- **Status, settings and custom connectors are stored only in the browser** (`localStorage`: `aivhub_connector_statuses`, `_configs`, `custom_connectors`). They aren't shared with the team, are lost when the browser is cleared, and the server never reads them.
- **16 connectors show as "Connected" by default** without asking the server. That includes 9 "AI connectors" (`lead_fit_ai`, `journey_writer_ai`, …), `os_postcodes`, `web_dossier` and `csv_pipeline`.
- **Figures that look live are hard-coded**: `latency: "32ms"`, `"5,200,000+ UK records"`, and so on.
- **The same catalogue exists four times**: `BASE_DATA_CONNECTORS`, `KEY_CONNECTORS` and `BASE_AI_CONNECTORS` (ConnectorsView), `ENRICHMENT_SOURCES` (EnrichmentSourcesModal), and `CONNECTOR_PRICING` (connectorPrices.js).
- **The screen doesn't show what the platform actually uses:**

  | Real source (database / backend) | Size | On the Connectors screen? |
  |---|---|---|
  | Companies House (DataSource, **paused**) | 5.70M records | yes (shown as "Connected", not "Paused") |
  | Food Hygiene (FSA) | 612k | yes |
  | Charity Commission | 399k | **no** |
  | CQC | 55k | yes |
  | Gender Pay Gap Service | 11.9k | **no** |
  | ScrapeGraph web scrape (`import_scrapegraph_bn`) | 24.5k | **no** |
  | BN leads file (`import_bn_leads`) | 9.4k | **no** |
  | FSB sample (`fsb_sample_2026_11`) | 500 | **no** |
  | Email finders: Icypeas, LeadMagic, Hunter, Findymail, BetterContact (`enrichment_waterfall.py`) | — | **no** |
  | Platform keys: OpenAI, DeepSeek, Tavily, Apollo, Google Places | — | yes, and **this is the only part that reads the server** (`/platform-provided`) |

- **Who can see the screen is decided by hard-coded usernames.** `isFsbAccount()` checks for `fsbadmin`, `fsbuser`, `fsbdemo` and `fsboutreach`. It should be a plan or role permission.

### 1.3 Where leads come from

There are two separate questions, and the app partly answers each:

1. **Origin**: how a company got into the account. Stored in `LeadAccount.source` (+ `source_url`).
2. **Provenance**: where each detail came from. Stored in `LeadAccount.field_sources` (phone, email and website only), `BusinessRecord.raw_data` keys, `BusinessRecord.sources[]` and `CompanyContactPoint.source`.

What the live data shows:

- **Saved leads: 2,488.** `import` 2,158 · `scout` (Find Leads) 328 · `social` 1 · `copilot` 1.
- **Provenance is almost never recorded.** Of 1,450 saved leads with a phone, only 3 have a `field_sources` entry. So the "Data from" column and the shield badge show "—" or "No source is recorded" for **99.8%** of leads. The UI is built, but it has almost no data to show.
- **Some origins get the wrong label.** The backend writes `social` (`social_listening.py`, `social_engagement.py`, `book_page.py`), `inbound_call` (`connection_handlers.py:378`) and `api` (`connections.py:484`). The UI maps (`SOURCE_LABEL` in `AccountsViews.jsx:51`, `FIRST_SEEN` in `listLogic.js:4`) only know 5 values, so all of these show as **"Added by hand"**. Also, `save_accounts` turns any value outside `_SOURCES` into `manual` (`lead_accounts.py:40`).
- **Old names.** The labels still say "AI Lead Scout" and "AI Lead Copilot". The product now calls these Find Leads and AI Assistant.
- **Bulk and scraped data is presented as register data.** The BN and ScrapeGraph loaders copy website, phone and email into the company record's own fields. `contact_points.py:146-148` then tags those values with source `record` and confidence `register`, because the company is a Companies House record (`verified_registry`). The "strongest claim wins" de-dupe then hides the real source. Database check: **63,744 contact points** (ScrapeGraph 52,155, BN 11,589) count as register-published, but Companies House publishes no phones or emails. `company_profile._contact()` then labels them "On the register", and `data_policy.record_source()` returns `register` for them when they're saved to a list.
- **Possible compliance gap, needs confirming.** The BN file has Google match columns (`GoogleName`, `GoogleAddress`, `GoogleBusinessStatus`, `MatchConfidence`). If its `Website` or `Phone` values came from Google Places, they're currently treated as exportable, because `import_bn_leads` isn't in `NON_EXPORTABLE` (`data_policy.py:13`).
- **Voice call lists carry no source at all.** An uploaded call list keeps its rows as plain JSON (`CallList.rows`), so a number dialled from a list can't be traced to where it came from, and its TPS result isn't tied to a lead. Calls link to a lead only through `CallLog.lead_id`. Phase 1 should give call-list rows the same `source` / `field_sources` as saved leads.
- **Supplier names are hidden on purpose** ("Clients never see a supplier's name", `SourceMark.jsx`). The plan keeps that: clients see a category ("Licensed business data", "Web scrape"), and admins see the supplier.

---

## 2. Target design

### 2.1 One list of sources (shared by backend and frontend)

The backend owns the list and sends `{key, label, client_label, kind, exportable}`. The frontend stops keeping its own maps.

**Origin (how a lead joined): `LeadAccount.source`**

| key | Client label | Today |
|---|---|---|
| `find_leads` (was `scout`) | Find Leads search | `scout` |
| `assistant` (was `copilot`) | AI Assistant | `copilot` |
| `import` | Your file (file name in `source_url`) | ok |
| `import_match` | Import & match | — |
| `inbound_form` | Web form (form name) | ok |
| `inbound_call` | Inbound call | shown as "Added by hand" |
| `social` | Social engagement / booking page (post link) | shown as "Added by hand" |
| `api` | API / integration (which one) | shown as "Added by hand" |
| `crm_sync` | CRM sync (Salesforce, HubSpot, …) | — |
| `manual` | Added by hand | ok |

Keep reading `scout` and `copilot` as aliases, so no data migration is forced.

**Provenance (where a detail came from): `field_sources[field]`, contact points**

| key | Client label | Exportable |
|---|---|---|
| `register:<ch\|charity\|fsa\|cqc\|gpg>` | Official register (which one) | yes |
| `website` | Company's own website | yes |
| `web` | Web search | yes |
| `scrape:<dataset>` | Web scrape | yes |
| `licensed:<dataset>` | Licensed business data | depends on the licence (set per dataset) |
| `email_finder:<provider>` | Email finder (verified) | per provider terms |
| `apollo` | Enrichment data | no |
| `google_places` | Google | no |
| `import` / `user` | Your file / You | yes |
| `check` | Number check | yes |

### 2.2 What users will see

1. **Lists → Companies / People:** a **Source** column and filter (origin), next to the existing "Data from" column (provenance). Each list row shows its main origin ("Mostly: Your file").
2. **Find Leads result rows:** small per-field source icons (phone, email, website) using the shared tooltip, and "Data from" filter options for each register and dataset.
3. **Company page: a "Where this came from" panel** listing:
   - how it joined, with date and link (file, form, post, call),
   - each detail with its source, date and confidence (Register / Confirmed on site / Found / Picked by you),
   - the registers it appears on, as chips (Companies House, Charity Commission, FSA, CQC, Gender Pay Gap).
4. **A "Lead sources" summary** (a card on Lists, plus admin detail):
   - leads by origin,
   - phone, email and website coverage by source,
   - **results by origin**, from `LeadAccount.stage`: contacted → interested → meeting → won,
   - cost per source, from `EnrichmentAttempt.cost_usd` and credits used.
   - Admins also see supplier names (BN, ScrapeGraph, Apollo, Icypeas, …).

### 2.3 Connectors

- **One catalogue, served by the backend**: `GET /leadgen/connectors`. It combines `DataSource` rows, platform keys, email-finder providers, bulk datasets, and export/CRM integrations. Each entry has:
  - a real `status`: connected / paused / error / not connected / coming soon,
  - `last_synced_at` and `last_error` (from `DataSource` and `DataSourceRun`),
  - **real counts**: records contributed (from `raw_data` keys), leads in this org that use it, and fields it filled,
  - pricing (moved out of `connectorPrices.js`).
- **Test connection checks for real**: `POST /leadgen/connectors/{id}/test`. It reuses `key_validator.py` for keys and a one-record `preview` for `DataSource` rows (admin_portal already has `/data-sources/{id}/preview`). It shows the real result, including failures.
- **Connection state is stored in the database per organisation**, not in `localStorage`. Custom connectors become real rows, or the "Add custom" option is hidden until there's a backend for it.
- Anything without a server connector shows **"Coming soon · Ask for it"** instead of "Connected" or "Connect".
- **Each connector's detail page** shows what it gave you (records, fields filled, leads), its recent runs, errors, credits used and pricing.
- **Visibility comes from a plan feature or role permission**, not `isFsbAccount()`.

---

## 3. Phased plan

Sizes: S ≈ ½–1 day, M ≈ 2–3 days, L ≈ 4–6 days.

### Phase 0: Stop showing false information (S–M, do first)
1. Replace the simulated "Test connection" with a real check. Until that exists, remove the button. (S)
2. Remove the hard-coded latency and record-count figures, and the "Connected" default for anything the server doesn't confirm. Show Companies House as **Paused** while its DataSource is paused. (S)
3. Add `social`, `inbound_call` and `api` to the origin labels, and stop `_SOURCES` turning unknown values into `manual`. Rename "AI Lead Scout" / "AI Lead Copilot" labels. (S)
4. Confirm where the BN file's Website and Phone values came from. If any came from Google, mark them non-exportable before anything else ships. (S + a decision)

### Phase 1: Accurate provenance in the data (M–L)
1. Write a central source list (`services/source_catalog.py`) with keys, labels, kind and exportability. Expose it at `GET /leadgen/sources`. (S)
2. Fix the bulk loaders (`bn_load_leads.py`, `load_scrapegraph.py`, `business_records.upsert`): record field-level provenance on the company record (new `BusinessRecord.field_sources` JSON), and stop the copied values passing as `record`/`register`. (M)
3. Fix `contact_points.py:146-148`: use the field's recorded source, and only use confidence `register` when a register really published the value. Then rebuild the contact points for the ~33k affected records. (M)
4. Fix `company_profile._contact()` and `data_policy.record_source()` to use the real source (e.g. "Web scrape", "Licensed business data") instead of "On the register". (S)
5. Backfill `LeadAccount.field_sources` for the 2,488 saved leads by matching values against `raw_data` (reusing `data_policy._held_by`). Dry run first, then apply. Add tests. (M)
6. Record origin detail on every save path: file name for imports, form id, post id, call id, API client. (S)

### Phase 2: Showing lead sources in the UI (M–L)
1. Replace `SOURCE_LABEL`, `SOURCE_WORDS`, `FIRST_SEEN`, `SOURCE_LABELS` and `DATA_FROM_OPTIONS` with one `useSources()` hook that reads `/leadgen/sources`. (S)
2. Add a Source column and filter to Lists → Companies / People, and extend the Find Leads "Data from" filter to registers and datasets. (M)
3. Add the "Where this came from" panel on the company page and the saved-company page. (M)
4. Add the "Lead sources" summary card (by origin, coverage, results by origin, cost) with an admin supplier view. Add a new endpoint `GET /leadgen/sources/summary`. (M)

### Phase 3: Real connectors (L)
1. Build the backend catalogue `GET /leadgen/connectors` with real status, counts and last sync. Add `POST …/test`. Store org connection state in the database. (L)
2. Rebuild `ConnectorsView` on that API. Split it into `connectors/Catalogue.jsx`, `ConnectorCard.jsx`, `ConnectorDetail.jsx`, `AddCustomConnector.jsx` and `catalogueLogic.js`, and remove the localStorage state. (M)
3. Add the missing real sources (Charity Commission, Gender Pay Gap, email finders, bulk datasets). Merge `ENRICHMENT_SOURCES` and `CONNECTOR_PRICING` into the catalogue. (S)
4. Replace the `isFsbAccount()` gate with a plan or role permission. (S)

### Phase 4: Look and feel (M–L, can run alongside Phases 1–3)
1. **One set of tokens.** CSS variables become the single source. `tokens.js` `C.*` returns `var(--ui-…)` strings so existing imports keep working. Add semantic pairs (success, warning, danger, info, neutral: each with soft background + ink) and a type scale (11 / 12 / 13 / 14 / 16 / 20 / 24). (S)
2. **Codemod the leadgen hex literals** to tokens, then add a test that fails when a new hex literal appears in `plugins/leadgen/*.jsx`. (M)
3. **One accent per app.** The shell sets `data-app="leadgen"` and `--ui-accent` follows, so the sidebar, header, buttons and chips match. Brands override it. Decide whether Leads stays purple or moves to cobalt. (S)
4. **Shared building blocks in `app/ui.jsx`:** `Tooltip`/`Popover` (used by both source badges), `Pill`, `StatusPill`, `StatTile`, `EmptyState`, `Banner` (lock / access / plan notices) and `Toast`. Replace the hand-built versions. (M)
5. **Page polish where the new features land:**
   - Connectors: card grid with status pill, filters and empty states.
   - Lists: Source column.
   - Company page: provenance panel.
   - Page headers: shorter descriptions. (M)
6. **Split the big files.** `AccountsViews.jsx` and `FindLeadsView.jsx` become feature folders. Do this alongside Phase 2 so the new code goes into the smaller files. (M)
7. Optional, later: dark mode, which becomes cheap once steps 1–2 are done.

### Suggested order
Phase 0 → Phase 1 (1–4) with Phase 4 (1, 3) in parallel → Phase 2 → Phase 3 → the rest of Phase 4.

---

## 4. Decisions needed from you

1. **Supplier names:** keep showing clients categories only ("Licensed business data", "Web scrape"), with supplier names for admins? (Recommended; it matches today's rule.)
2. **BN file:** did its Website and Phone values come from Google Places? This decides whether they can be exported.
3. **Connectors audience:** every account, admins only, or a paid-plan feature?
4. **Leads accent:** keep purple `#8B5CF6`, or use the cobalt the buttons already use?
5. **Unbuilt connectors** (Experian, Market Location, CRMs, warehouses): show as "Coming soon", or hide until they're built?

## 5. Tests to add along the way
- `sourceCatalog` contract test: every origin and provenance key the backend writes has a label (this would have caught `social`, `inbound_call` and `api`).
- Backend: bulk loader → contact points keep the real source; `record_source` never returns `register` for a scraped or licensed value.
- Backfill dry-run test on fixture records.
- Connectors: the test button shows a failure when the server says it failed. No status comes from `localStorage`.
- Lint/test guard for hex literals in leadgen.
