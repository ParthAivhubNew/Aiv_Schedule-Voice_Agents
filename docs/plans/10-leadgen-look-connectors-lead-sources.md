# 10 — Leads: look and feel, real connectors, and showing where every lead came from

Written 2026-11-24 from a read of the code plus read-only queries on the live database.

**Status (2026-11-25, branch `company-rules-fsb-migration`, plan 11 step 6):** Phases 0–3 are done. Phase 4 items 1 and 3, the guard part of item 2, and the shared pieces of item 4 are done. Cost per source is done. The rest of Phase 4 is still to do: the deliberate colour sets (named, not merged) and dark mode. Details are in section 3.1.

**Phase 4, item 1 (2026-11-25): one source for the colours, with no visual change.**
- `tokens.js` `HEX` holds the values. `app/global.css` declares each as a CSS variable with exactly that value: `--c-ink`, `--c-teal` and so on. The accent ones are the existing `--ui-accent` / `--ui-accent-ink`, which already held the same colours.
- `C.*` now returns `var(--name, fallback)`, so every screen that uses `C` reads the variables. A brand or a theme can change a colour in one place.
- Code that needs a real colour uses `HEX`: the chart attributes in Voice analytics and Social results do. Four `${C.x}33`-style alpha strings became `color-mix()`.
- Nothing in the frontend writes these colours into outgoing HTML (e-mails are built by the backend), and no canvas uses them.
- **Item 2, guard only:** `tokens.test.js` checks that the CSS and `HEX` agree. It also fails if any Leads file gains hard-coded hex colours: there are 681 in 58 files today, counted in `plugins/leadgen/hexBaseline.json`, to be moved onto tokens and the count lowered. The codemod itself isn't done.
- **Item 3 (decision 4, left to me by the owner on 2026-11-25: "best professional looking application and good UX"): one accent across the product.**
  - Buttons, links, selected items, focus rings and phone tab bars use the shared accent (`--ui-accent`, cobalt) in every app. People learn once what is clickable and what is selected.
  - The app headers are white in Leads, Voice and Social alike (Leads used to be tinted purple and Social teal).
  - Each app's own colour (Leads purple, Voice cobalt, Social teal) stays only where it tells the apps apart: its icon tile in the sidebar and its tile on the home screen.
  - Leads' purple subscription gate, empty-state icon and saved-people icon now use the accent. `C.cobaltSoft` is now the shared `--ui-accent-soft` (`#EEF2FE`, was a near-identical `#EAEEFC`).
  - **A brand's accent replaces the accent everywhere** (`brandLogic.accentShades`, set by `BrandContext`): the colour and its hover, soft, ink, focus-ring and dark-sidebar shades. A colour too light for white button text is darkened until it passes WCAG AA (4.5:1). FSB's brand sets no accent, so FSB looks the same.
  - Purple left alone: the map's "legal" category colour, and the AI and developer settings screens outside Leads.
  - Not checked in a browser yet.
- The hard-coded colour count in Leads went from 681 to 676.

**Phase 4, item 2, first pass (2026-11-25): 82 colours moved onto tokens, with no visual change; 676 → 594 left.**
- New status tokens hold exactly the colours the screens already used: `success*`, `warning*`, `danger*`, `info*`, `neutral*`, `lineCool`, `surfaceCool` and `uiInk` (= `--ui-ink`).
- `frontend/scripts/tokens-codemod.cjs` parses each file with Babel and changes a colour only where it is styling: a style property, an icon's `color`/`fill`/`stroke`, or page CSS in a template without HTML. It changes it only when it equals a token's value exactly.
- It leaves alone:
  - white and black, which need surface / on-accent names before dark mode;
  - a colour that is already a `var(--x, #hex)` fallback;
  - files where a colour is data or leaves the app (e-mail design, web-form embeds, map pins and drawing, the vendor logos).
- ✅ **Near-matches, first pass (2026-11-26): 34 more colours onto tokens; 590 → 556 left.**
  - Each Leads colour was measured against the nearest token (CIEDE2000). Only those under 2.5 were merged, where people can't see a difference: mostly table-header and panel greys, pale greens, the assistant's dark buttons, and the AI-draft and selected-row tints (now the accent's soft shade, so a brand's accent reaches them too).
  - **New token:** `infoBg` (`#EFF6FF`, the value the blue tone already used), so the info colours have a pale background like the others.
  - **Dead fallbacks removed:** `C.bgSoft || …` and `C.paperSoft || …` named tokens that don't exist, so the hard-coded colour was always the one shown.
  - **Left on purpose:**
    - info blues that would take a brand's colour if moved onto the accent;
    - the org chart's level palette and the connector status pills, which are sets of colours meant to go together;
    - colours 2.5 or more away from any token, which would visibly change (for example the org chart's stronger lines, the emerald filter chips and the amber filter cards). These need a design decision, not a merge.
  - Not looked at in a browser: every change is below the visible threshold. The tests and build pass.
- ✅ **Second pass (2026-11-26, you asked me to decide): 23 more uses onto tokens; 556 → 533 left.** Rather than force near colours together,
  this pass names the deliberate ones and merges only true twins:
  - **New tokens, no visible change:** `lineStrong` (the shared `--ui-line-strong`, `#CBD1D9`) for every line that has to show: the org
    chart's lines, the filter panel's group edges and footer, a pinned column, the journey arrows and the import drop box (the greys there
    were within 2.2 of it, below what people can see). `limeSoft` / `limeInk` for the "likely" / org-chart green highlight used in three
    places.
  - **Twins:** the blue notice backgrounds onto `infoBg`, the light greys onto `paper` / `paperSoft`, a Google-only chip's ink onto `infoInk`.
  - **One accent:** the Leads app's violet showed as the selected-tab underline in Forms and as an icon colour in Import. Both are now the
    product accent; the violet stays on the app's own icon, read from `hub/apps.js` instead of being typed in.
  - **Still deliberate and left as they are:** the org chart's level palette, the filter cards' amber and orange, the emerald filter
    chips, the connector status pills and the TPS dialog's tones. Merging them would change the look; naming them is the step before
    dark mode.
- ✅ **White by role (2026-11-26): 95 more uses onto tokens; 533 → 438 left.** White was left alone in the earlier passes because dark mode
  needs two different colours for it. Two new tokens, both white today:
  - `surface` (the shared `--ui-surface`): card, panel, table, input and pinned-column backgrounds, and white borders and rings. 85 uses.
  - `onAccent` (`--c-on-accent`): text and icons on a coloured fill (a filled step, a filled chip, a dark button). 10 uses.
  - Moved by `frontend/scripts/tokens-white-codemod.cjs`, which reads what each white does (the style property, or the CSS property in
    page CSS). One white whose job couldn't be told is left as it is. Nothing looks different.
  - **What's left:** about 200 of the 438 are in files where a colour is data or leaves the app (e-mail designs, form embeds, map pins,
    supplier logos) and must stay as written. The rest are the deliberate sets above and a few dark inks (`#000`, `#111`).
- ✅ **Voice, Social and the home screen, and Leads' sets named (2026-11-26): no visible change.**
  - Both scripts now take `--dirs=` and ran on `plugins/voice`, `plugins/scheduler` (Social) and `hub` (home, sign-in, profile):
    147 exact token colours and 431 whites (`surface` / `onAccent`) moved, **1,021 → 440** hard-coded colours there. Eight whites whose
    job couldn't be told were left. They reuse a `C` already imported from `app/constants.jsx`, which re-exports the same tokens.
  - Left as written: the logo (`BrandMark.jsx`), each app's own colour (`hub/apps.js`) and chart attributes in files that draw
    recharts charts, which use `HEX`.
  - `tokens.test.js` now ratchets all four folders, each with its own `hexBaseline.json` (Voice 278, Social 93, home 69).
  - **Leads' deliberate sets are named**, each colour with exactly today's value and its own CSS variable, so dark mode can give it a
    dark one: filter cards (`filterAmber`, `filterOrange`; ready / new were exactly `success` / `info`), emerald chips (`chipEmerald*`),
    connector pills (`pill*`), TPS tones (`tps*`) and org chart levels (`org*`). Leads **438 → 400**.
  - Tests 749 passed, no lint errors, build clean. Not looked at in a browser: every value is unchanged.
- ✅ **Settings and calendar (2026-11-26, later): no visible change.** 190 exact token colours and 234 whites moved, **1,111 → 686**
  there (settings 272, calendar 414), and both folders are ratcheted too.
  - Left as written: `PartnerEmbed.jsx` (it previews a partner's own theme) and `DeveloperCodeSnippets.jsx` (an always-dark code block).
  - **A guard the earlier passes lacked:** a text colour that equals a background token (light text on a dark panel) is no longer moved,
    because in dark mode that token turns dark and the text would vanish. The Voice pass had done this twice (a dark tooltip and a dark
    diagram); both are back to their own colour. The named sets are never matched elsewhere either.
  - Tests 751 passed, no lint errors, build clean.

**Phase 4, item 4, first part (2026-11-25): shared building blocks in `app/ui.jsx`.**
- **`Tooltip`:** one card for every "what is this". It opens on hover, focus or a tap and closes with Escape. It is fixed to the screen, so a table's scroll box never clips it, and it flips above its button when there's no room below. **Both source badges use it** (`SourceBadge` and `SourceMark`; the dark bubble and the native title that showed a second tooltip are gone).
- **`EmptyState`:** icon, title, text and actions. Used by Saved companies and Saved people.
- **`Banner`:** one notice with info, warn, bad, good and neutral tones on the status tokens. A "bad" one is an alert. The data-access notice (`AccessNotice`) uses it.
- `app/constants.jsx` had its own copy of `C`. It now spreads `tokens.js` `C` and keeps only its two shadow values.
- **Second part (2026-11-25):**
  - **`Pill`** is now in `app/ui.jsx`, and the staff portal re-exports it, so a label looks the same in the apps and the portal. The Leads screens take it from the shared file instead of the staff portal's.
  - **`Toast`** is shared too, and Leads uses it.
  - The Leads **"Subscription required"** notice is a `Banner`. The leftover purple background is gone.
- **Third part (2026-11-25):** `Note`, `btn`, `card`, `input`, `cell`, `th`, `when`, `useAction` and `useLoad` moved from `adminPortal/ui.jsx` into `app/ui.jsx`, unchanged. The portal imports and re-exports them. **No client screen imports the staff portal's code any more**, and a test (`app/uiBlocks.test.jsx`) keeps it so.
- **Fourth part (2026-11-25):**
  - **`StatTile`** (name on top, the number, a unit, a line under it; "alert" turns it red) replaces Voice analytics' own tile and Social results' tile. Social's tiles now put the name above the number, like Voice's.
  - Voice call permissions and the Import & match chips use the shared `Pill`. The sizes and the call-permission colours shift slightly, to the shared ones.
- **Fifth part (2026-11-25):**
  - The shared `Pill` can carry a status dot that pulses for something happening now (`ui-pulse`; still for people who ask for less motion).
  - These now use the shared pill: Connectors' status, Voice's live-call state (ringing, live, needs you, ended) and Voice's number-check status.
  - `components/Badges.jsx`, a second status badge that nothing imported, is deleted.
- ✅ **Item 4 done 2026-11-26:** Social's own `Stat` is gone. The Results figures are shared `StatTile`s, and the "Last 7 days" row uses its new `compact` form (no card frame, inside another card). `tone="accent"` marks leads and meetings from posts in the product accent instead of Social's teal.
- Tests: `app/uiBlocks.test.jsx`.
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
   - ✅ **Done 2026-11-26.** A parser moved each top-level piece unchanged and worked out each file's imports from what it uses, so no code was rewritten by hand.
     - **`accounts/`:** `accountsLogic.js` (pure helpers), `useLeadAccounts.js` (the data hook), `accountParts.jsx` (small parts and menus), `AccountsView.jsx` (the list screen), `AccountPanel.jsx` (the panel, dossier and add form) and `ImportView.jsx`.
     - **`find/`:** `findLogic.js` (the search form and filters), `findParts.jsx`, `ContactsPanel.jsx` and `FindLeadsSearch.jsx`.
     - `AccountsViews.jsx` and `FindLeadsView.jsx` now only re-export, so every existing import still works. New code should import from the folders.
     - **The search component itself, first pass (2026-11-26):** its two largest blocks of layout moved into `find/FilterPanel.jsx` (the
       filter column) and `find/ResultsCard.jsx` (the draft strip, tables, map and pager), so `FindLeadsSearch.jsx` went from 1,336 to
       967 lines.
       - **How:** a parser moved each block unchanged. It worked out every value the block uses from the component and passed it in
         under the same name, so nothing is rewritten. Lint then checks that no name is left undefined.
       - **Checked in a browser 2026-11-26:** a search on the test app looks the same as before.
       - ✅ **State grouped (2026-11-26):**
         - **Three hooks**, each moved unchanged by a parser that also checks nothing in it reaches forward to something declared
           later (which would crash at render): `find/useContactActions.js` (reveals, one-click look-ups, calls, Get contacts; it needs
           only 5 values from the screen), `find/useSelectionActions.js` (ticked companies, select-all, saving them) and
           `find/useFavourites.js`. `FindLeadsSearch.jsx` is now 828 lines.
         - **The results card's 88 values come in five named groups** (results, searching, mapArea, selection, contacts), unpacked in
           its signature, so its body is unchanged.
         - **Left in the screen on purpose:** the map-area actions. They need 20 of the search's own values (its run id, area
           bookkeeping), so a hook would only move the tangle.
         - **Checked in a browser 2026-11-26:** ticking, Favourite, Add to list, Reveal, Get contacts (opened, not confirmed), Call, Remove, paging and the map all work.
7. Optional, later: dark mode, which becomes cheap once steps 1–2 are done.

### 3.1 Done on the branch (2026-11-25)

**Phase 0 (stop showing false information): done.**
- The fake "Test connection" is gone. **Test connection** now calls `POST /leadgen/connectors/{id}/test`, which runs the provider's real check (`registry.test_key`) and shows the real result, failures included.
  - Only organisation admins can press it, at most once every 30 seconds per connector.
  - A check that spends a paid look-up (Provero, `Manifest.test_spends`) is refused for clients.
  - Clients see "It answered: it's working." or "…it isn't working right now. Aivhub has been told." The vendor's own wording and balances stay with staff, and a failure raises staff alert **CON-01**.
- The hard-coded latency figures, record counts, sample responses, "Connected" defaults and the made-up "Leads AI engines" ("Outreach-LeadReasoning-70B" and others) are gone. Companies House shows **Updates paused** while its DataSource is paused. A register whose last run failed shows **Last update failed**. Either way, its records stay searchable.
- Origins: `social`, `inbound_call` and `api` have labels. `save_accounts` keeps every known origin (`source_catalog.origin_key`): unknown values still become `manual`, and `find_leads` / `assistant` are accepted as aliases. "AI Lead Scout" and "AI Lead Copilot" are now **Find Leads** and **AI Assistant**. The frontend has one list (`originLabels.js`) in place of the four maps.
- **BN file (decision 2): its phones and websites came from Google.** Every one of the 9,367 BN rows that has a phone (4,289) or a website (4,022) also has a Google match, and the file has Google's `PhoneInternational` column. So `source_catalog.DATASETS["import_bn_leads"].google_fields = ("phone", "website")`, and `data_policy` treats those values as Google's: you can view them, but they can't be exported. The exception is a value an open source also lists, such as the company's own site or the web scrape. BN e-mails stay exportable.
  - The FSB sample run's phones are treated the same way, and so is its website when it says it came from Google Places.
  - A saved value recorded as `register` / `record` is now checked against the company record again, because older copies called BN values "register".
  - **This was live:** on main, the Salesforce update file (Import & match) labelled BN phones and websites "register" and wrote them into the file. On the branch they're left out and counted as withheld.

**Phase 1, item 1: done.** `services/source_catalog.py` holds the origins, registers, bulk datasets and provenance keys. Each has a client label, a kind, an exportable flag, and (staff only) the supplier. It is served at `GET /leadgen/sources`.

**Phase 3 (real connectors): items 1–4 done.**
- `GET /leadgen/connectors` (`services/connector_catalog.py`) builds one list from what is real:
  - **Official registers:** the DataSource rows, with their runs.
  - **Business data:** the bulk datasets that are loaded. Experian and Market Location show as coming soon.
  - **Look-ups we run for you:** one verified e-mail finder entry (staff see each finder), phone number check, TPS / CTPS screening, company websites and postcode locations.
  - **Provider keys:** the company's own key, the platform's, or none. Company rules can switch Google, enrichment data and search engines off. A plan can leave a provider out.
  - **Your own systems:** file import, web forms and the Salesforce update file are built in. CRMs, warehouses and your own AI model are coming soon.
- Counts:
  - Records per source come from a daily read-only job (`connector_stats`, safe in the test copy). It is slow on the full register: about 8 s for 82k records, so roughly 10 minutes for 5.7M.
  - The company's saved companies per source.
  - Look-ups in the last 30 days, from the cost ledger.
- Staff see a company's list with supplier names, each finder and the registers' last errors at `GET /admin-api/connectors?orgId=`. Nobody signs in to the platform organisation, so the client screen never shows them.
- `ConnectorsView.jsx` went from 2,606 lines to about 270. It reads only the API, keeps nothing in `localStorage`, and has no custom connectors (hidden until there's a backend). Its logic is in `connectorsLogic.js`, and the two vendor logos moved to `ConnectorLogos.jsx`. The vendor pricing panel shows only for coming-soon connectors and provider keys.
- **Decision 3 (audience), taken as the default:** every signed-in user sees Connectors, and only admins can test. `isFsbAccount()` no longer gates the screen. Say if it should be admins only or a plan feature instead.
- **Decision 5:** unbuilt connectors show as **Coming soon** with **Ask for it**.
- Tests: `tests/test_connectors.py` (14), `connectorKinds.test.js`, `connectorPrices.test.js`, `sourceBadge.test.jsx` (the screen), `listLogic.test.js` (origins).

**Phase 1, items 2–6 (second part, 2026-11-25): done.**
- **Item 2, a deliberate change from the plan:** there is no new `BusinessRecord.field_sources` column. Every value's source is worked out from the record's own `raw_data`, which already keeps what each source said. That's `data_policy._claims` / `value_source`, one list that the export rules, the contact list and the company page all use. So the bulk loaders don't need changing, and 5.7M records don't need migrating.
  - The keys are `register:<x>`, `website`, `licensed`, `scrape`, `research`, `web`, `google_places` and `apollo`.
  - An open source wins over a view-only one.
  - The research sample's `phones` / `emails` lists are now read too.
- **Item 3:** `contact_points.points_of` no longer files the record's own website, phone and email as `record` / `register`, and no longer files every bulk dataset as `register`.
  - Each value gets the source that lists it.
  - Only a register is `register`. The datasets are `licensed` / `scrape` / `research`, and the BN file's Google fields are `google_places`.
  - A value nothing lists is `record` / `found`.
  - When two sources list the same value, the strongest claim wins, then a real source over the record's own copy, then a source whose values may be exported.
  - Find Leads' "Data from" filter has a new **Business data (licensed or scraped)** option and no longer counts `record` / `register` as register data.
- **Item 4:**
  - `record_source` never returns `register` for a scraped or licensed value.
  - The company page says "On the register" only for a register. Otherwise it says "From a web scrape", "From business data we licensed", "From Google" and so on.
  - Export files and the Salesforce update file write the source without its detail (`public_source`: `register`, `website`, `scrape`, `licensed`, `research`, `web`).
- **Item 5, the repair:** `POST /admin-api/maintenance/provenance` (`services/provenance_fix.py`). It's a dry run unless `apply` is true, it's audited when applied, and it's safe to run twice. It relabels the old contact points and records a source for saved companies' values that have none: the matching source on their company record, or "Your file" for an imported company.
  - **Dry run on the test copy:** 68,469 contact points across 28,259 companies would change. That includes 7,386 Google values that were passing as register data, 57,254 web-scrape values and 3,504 licensed ones. 3,046 saved-company values would get a source (2,980 "Your file", from the FSB import), and 58 would be left alone. It takes about 50 s.
  - **On live it must be run by staff after the branch is deployed**: the dry run first, then with `apply`.
- **Item 6:** an import records its file name (`source_url = file:<name>`), a booking-page lead its post (`booking:<post>`) and an API lead its prospect (`api:<id>`). Web forms (`form:<id>`) and social engagement (the profile link) already did. An inbound call has only the caller's number, which is the lead's phone.
- New words on the screens: "Licensed business data", "Web scrape", "Research" and "Company record" (`SourceMark`, `ContactPoints`, `companyLogic.contactSourceWord`, the Lists "Data from" filter).

**Phase 2 (third part, 2026-11-25): done, apart from cost per source.**
- **Item 1:** one frontend list of origins (`originLabels.js`) replaces the four maps. It matches the server's, which `GET /leadgen/sources` serves. Pure functions such as `listStats` need the words without waiting, so it isn't a fetched hook.
- **Item 2:** Lists → Companies already had a "First seen via" column. It now has a **Came from** filter (`OriginSelect`, with a count per origin) next to "Data from". Find Leads' "Data from" got **Business data (licensed or scraped)** in Phase 1.
- **Item 3:** a **Where this came from** panel on the company page (`WhereFrom.jsx`) shows:
  - how the company joined, with its date and detail: the file it was imported from, a web form, the booking page, or a post or profile link;
  - where its website, phone and email came from: the saved company's recorded source, else the company record's own source;
  - the registers it appears on, as chips.

  The profile now carries `registers` and `mine.source_detail` / `mine.field_sources` (`source_catalog.origin_detail` / `registers_of`). The saved-company drawer keeps its existing "Data from" and origin line.
- **Item 4:** a **Lead sources** card on Lists (`LeadSources.jsx`, from `GET /leadgen/sources/summary`) shows:
  - saved companies by origin, with how many reached contacted, meeting and won;
  - for phones, emails and websites, how many have one and where they came from.

  It counts only the company's own saved companies, and it is hidden if it can't load.
  - **Cost per source: done 2026-11-25.** The Lead sources card has a **Credits** column per origin, plus a line for credits spent on searches and on companies removed since. `source_catalog.credits_by_origin` works it out from what each Leads charge already names, so history counts too:
    - a look-up for one company (`lead:<record>:<what>`, `deepsearch:<record>:<what>`) goes to that company's origin;
    - a company check run (`chk_<run>:<step>`) is split evenly over the companies it checked (`checkids:<org>:<run>`);
    - an e-mail (`email:<message>`) goes through its journey enrolment, else the saved company with that address;
    - the rest (a search, the assistant) counts as "searches".

    Credits are what the client paid. The cost to us stays in the staff cost ledger. On the test copy, Aivhub's 460 Leads credits split into 179 on companies from its own files, 23 on companies found with Find Leads, 171 on searches and 87 on companies removed since.
  - **Defence in depth:** the summary's and the Connectors counts' queries now filter by company explicitly as well as through row-level security. A script reaching the database without the request's database role had seen every company's charges; requests never did.
  - The admin supplier view isn't needed: saved values now hold categories, not supplier names. Staff see suppliers on `GET /admin-api/connectors`.
- Tests: `tests/test_connectors.py` (22 in total) and `leadSources.test.jsx`.

**Still to do:** the rest of Phase 4 (look and feel).

### Suggested order
Phase 0 → Phase 1 (1–4) with Phase 4 (1, 3) in parallel → Phase 2 → Phase 3 → the rest of Phase 4.

---

## 4. Decisions needed from you

1. **Supplier names:** keep showing clients categories only ("Licensed business data", "Web scrape"), with supplier names for admins? (Recommended; it matches today's rule.)
2. **BN file:** did its Website and Phone values come from Google Places? This decides whether they can be exported.
3. **Connectors audience:** every account, admins only, or a paid-plan feature?
4. ~~**Leads accent:** keep purple `#8B5CF6`, or use the cobalt the buttons already use?~~ **Decided 2026-11-25 (left to me): one cobalt accent across the product; each app's colour stays only in its icon and home tile; a brand's accent replaces it.**
5. **Unbuilt connectors** (Experian, Market Location, CRMs, warehouses): show as "Coming soon", or hide until they're built?

## 5. Tests to add along the way
- `sourceCatalog` contract test: every origin and provenance key the backend writes has a label (this would have caught `social`, `inbound_call` and `api`).
- Backend: bulk loader → contact points keep the real source; `record_source` never returns `register` for a scraped or licensed value.
- Backfill dry-run test on fixture records.
- Connectors: the test button shows a failure when the server says it failed. No status comes from `localStorage`.
- Lint/test guard for hex literals in leadgen.
