# Handoff: FSB bid and Find Leads work (17-18 November 2026)

For a new chat picking this up. Everything below was checked against the repo on 18 Nov 2026. What is deployed on the server is NOT known from the repo: see section 9.

## 1. The goal
Parth is preparing the FSB bid and demo for AIVHub's Outreach platform (Find Leads over a Companies House based register, 6.7M rows).
Appendix 1 of the bid reports contact counts for FSB's population: Companies House companies in 30 BN postcode districts, status exactly "Active", after exclusions.

FSB's rules (their document "FSB exclusion rules - for developers", 17 Nov 2026):
- Districts (30): BN1, BN2, BN3, BN5-BN18, BN20-BN27, BN41-BN44, BN50. **BN50, not BN45.** (An early draft wrongly used BN45; any answer saying "BN41-BN45" is wrong.)
- Status exactly "Active". Companies House companies only (8-character company number).
- Exclusions in order: company type (Charitable Incorporated Organisation, Scottish CIO, Registered Society, Royal Charter Company, Other company type) -> Charity Commission register -> any of 53 SIC codes (exact, any of up to 4 codes) -> name words (charit*, church, parish, mosque, synagogue, temple, casino*, credit union, nhs, hospital, school, college, university, academy trust, shopping centre, bureau de change, tourist information, weighbridge*). "driving school" and "dance school" stay in.
- Constants live in `backend/app/services/business_records.py` (FSB_TYPES, FSB_SIC, FSB_NAME_WORDS, FSB_NAME_KEEP, `_fsb_exclusions`). Boss's figures: 65,214 before exclusions, 59,366 after. Ours: 65,210 / 59,349 (17-company gap never explained).
- Parth's instruction for the CSV load: "forget all my boss said and do only what I am asking". Do not add unrequested features or panels. Keep answers short and direct.

## 2. Server and how to run things
- Contabo VPS, `/opt/flow`, `docker compose`. Containers: `aivhub_backend`, `aivhub_postgres`, `aivhub_redis`.
- Run a script: `docker cp X.py aivhub_backend:/tmp/X.py` then `docker exec -i -e PYTHONPATH=/app -w /app aivhub_backend python /tmp/X.py`.
- The container's `/tmp` is wiped on rebuild. A rebuild restarts the backend and kills running jobs. No `ps`/`kill` in the container: to stop a job use `docker exec aivhub_backend sh -c 'kill <PID>'`.
- Local tests: `cd backend; venv/Scripts/python.exe -m pytest tests/<file> -q` (Windows venv at `backend/venv`). Tests marked db are skipped without Postgres. Frontend: `cd frontend; npx vitest run src/plugins/leadgen`.

## 3. Scripts (not part of the app)
All copied on 18 Nov to `scratch/fsb_bid_scripts/` (originals were in a temp folder that Windows may clear: `C:\Users\aivhu\AppData\Local\Temp\agent\1906bca7b0ab7dbb\74a7774d-f2e0-4d60-bff3-e4fad1d44e70\scratchpad\`).

| File | What it does |
|---|---|
| `bn_counts.sh`, `bn_appendix1.sh`, `bn_matched.sh`, `bn_info.sh`, `bn_costs.sh`, `bn_discover.sh` | Appendix 1 counts per district under FSB's rules; matched/contact counts; cost and discovery queries. `appendix1_summary.csv`, `bn_counts.csv` are outputs |
| `bn_sample500_v2.py` (current), `bn_sample500*.py`, `bn_sample.py` | The resumable 500-company enrichment sample (Tavily + free sources, no Apollo). Pause/resume via `bn_sample_ctl.py`. Server outputs: `/tmp/sample_500_rows.csv`, `/tmp/sample_500_summary.txt`, `/tmp/sample_company_numbers.json`, `/tmp/bn_population_ids.txt` (gone after a rebuild) |
| `bn_sample_fix.py`, `bn_sample_verify.py` | Fixes after the boss's feedback: verify emails, drop wrong named contacts, directors for the named-contact column, trading-only rates |
| `bn_people.py` | Loads directors/officers (`--n 60000` for the full population). Not confirmed started |
| `bn_enrich_all.py` | Bulk enrichment of the population (Tavily excluded, Apollo allowed). `--from-import` reads `fsb_import` records from the superseded loader, so it needs adjusting to read `import_bn_leads` |
| `bn_company_list.py` | Lists the required BN companies as CSV/MD/TXT from the DB |
| `bn_load_leads.py` | **Final** loader for `BN_leads_with_contacts.csv` (Downloads folder). Uses `business_records.upsert`, source id `import_bn_leads`. Already run: 9,399 companies loaded, 4,000 websites / 4,316 phones / 2,752 emails now in fields. `bn_import_leads.py` is the superseded version |
| `bn_restore.py`, `bn_store_bid.py`, `change_report.py` | Restore/storage helpers and a before/after change report |
| `exclusion_audit.py` + `exclusion_list.txt` | Read-only check of an exclusion list against the real DB for the 30 districts (per-item counts, a named company, what slipped through). **Not run yet** |
| `industry_values.py` | Read-only dump of the distinct industry values and baseline searches. **Run once**; output in `/tmp/industry_out/` on the server (summary in section 6) |
| `FSB_data_fill_plan.md`, `FSB_data_fill_plan_review.md` | The EGM-reviewed plan for filling all data with the server's APIs |

## 4. App code added or changed (all committed locally, last commit 48f89d2)
**Admin / keys / feeds (17 Nov, commits fe012f3, 067af5e)**
- `backend/app/services/tavily_pool.py`: Tavily backup-key pool; keys read fresh per search; a key is set aside 30 min on 432/429/401. Admin screens in `frontend/src/adminPortal/` (TavilyKeys.jsx, ApolloKeys.jsx, CallLog.jsx: folded call log, 10 per page).
- `backend/app/services/registry_feeds.py`: free official feeds (Companies House stream, Gazette, FCA, ONSPD), loop started in `backend/app/main.py`; admin screen RegistryFeeds.jsx. Companies House stream key not yet saved; Gazette uses urllib (httpx gets 403).

**Find Leads filters (`backend/app/services/business_records.py`, `lead_filters.py`, `frontend/src/plugins/leadgen/FindLeadsView.jsx`)**
- Filter keys: `fsb_exclusions` (backend flag, no UI control by design), `exclude_items`, `legal_form`, `record_sources`, `industry_types`, plus older `not_keyword`, `not_towns`, `not_company_category`, `exclude_charities`.
- Panel groups now: Industry & keywords (Include, Leave out, Industry picker, side activities, schools & community places), Location, Reasons now, Size / accounts type (Dormant stays here), Company (type text, chips, "Registered or sole trader", charity tick, Leave out types, Exclusion list), Status & age, Details we hold, Your lists. Sole trader hides the type chips and charity tick. The result chip for the backend FSB flag is "Standard exclusions".
- "Describe it" box at the top of the panel: sentence -> filters. Endpoint `POST /leads/understand` (`backend/app/api/lead_accounts.py`) using `lead_filters.interpret`; the AI schema now includes the leave-out fields. Fills the boxes, does not run the search.

**Exclusion lists (Leave out and Exclusion list boxes)**
- `backend/app/services/exclusion_categories.py`: maps 101 directory categories (Parth's pasted list, e.g. "Places of Worship", "Hospitals") to name words + SIC codes; plural-tolerant whole-word regex (`word_regex`); `wants_charities_out` (charity categories also use the charity register); `suggestions()`.
- Matching (`_leave_out_words` in business_records.py): name + any listed activity (sic_text, industry), NOT description (a description says who a company serves). Driving/dance schools kept unless typed. Items up to 80 chars, 300 items.
- UI `ExclusionBox.jsx`: items as chips grouped under headings (Categories, Words, SIC codes, Postcodes, Company numbers), dropdown + faint Tab-complete suggestions, comma/Enter/paste adds items, Expand window with "Edit as text". Endpoint `GET /leads/exclusion-suggestions`.

**Industry picker (18 Nov, commit 48f89d2)**
- `backend/app/services/industry_index.py`: builds the pickable industries from the real `industry` values (SIC terms and register-type terms, care-register "|" lists split, junk hidden), stored in `app_settings` key `industry_terms:v1`. Build it with `backend/scripts/refresh_industry_terms.py` (run after each import). Endpoint `GET /leads/industries`.
- New filter `industry_types` (exact type inside a "|" list). It is ORed with `sic_codes` (one Industry control means "any of these").
- Frontend `IndustryPicker.jsx` + `industryMatch.js` (matching on the page, "All <trade>" group picks that add SIC codes and types together). Falls back to the old `SicPicker` until the list is built.

**Tests added:** `backend/tests/test_fsb_exclusions.py`, `test_exclusion_categories.py`, `test_industry_index.py`; `frontend/src/plugins/leadgen/ExclusionBox.test.js`, `industryMatch.test.js`.
One unrelated existing failure: `tests/test_public_api_catalogue.py` (undocumented `/v1/leads/journeys`, `/v1/leads/lookup`, `/v1/leads/journeys/{id}/people`).

## 5. Data in the database
- `business_records` (shared, no org_id): 6,736,633 rows, 5,983,171 Active. Per-source blocks in `raw_data`; `sources` is a JSON list of `{source_id, source_type, confirmed_at}` (`ds_companies_house` 5.7M, `ds_food_hygiene` 612k, `ds_charity_commission` 399k, `ds_cqc` 55k, `ds_gender_pay_gap` 12k). `industry` and `sic_text` are identical on 5.56M rows. First SIC code is the main one on all 5.47M rows checked. No row joins activities with ", ".
- The 500-sample and the CSV load are in the DB (source `import_bn_leads` for the CSV).
- Importer: `business_records.upsert(db, source_id, source_type, confidence_tier, data)` merges on `identity_hash` (registration number first), fills only empty fields when the incoming tier <= existing.

## 6. Findings that matter
- Industry column: 1,829 distinct values. Kinds: Companies House "code - label"; register types (Charity 368k, food-hygiene types such as Restaurant/Cafe/Canteen); care register lists joined with "|" (590 combos, about 35 services); junk ("None Supplied" 231,737, empty 1,807, bare codes 123).
- Current keyword search is slow on 6.7M rows: accountants, restaurant, cafe, builders hit the statement timeout in the baseline run; many others took 7-21 s and show the 10,000 cap. `baseline.json` has the other totals (dentist, plumber, church, solicitors, tax, electrician, hairdresser, "estate agent", software capped at 10,000; "web design" 337; "care home" 7,940).
- Brighton Housing Trust ("BHT Sussex", charity 284839, company 01618610) still showed in Find Leads with the whole list in the Exclusion list. SIC 68209, type Guarantee, name has no listed word. It can only be removed via the Charity Commission register link. Whether our record carries that link is unverified: run `exclusion_audit.py`.

## 7. Known open items
1. Run `scratch/fsb_bid_scripts/exclusion_audit.py` on the server and read the BHT line and the "left in" list.
2. Check `industry ~ '(^|\|)Dentist(\||$)'` uses the trigram index on `industry` (EXPLAIN ANALYZE); if it seq-scans, switch the type filter to `IN` on the stored raw values.
3. Appendix 1 grid not re-run after the CSV load or after directors; `bn_people.py` not confirmed started; the 17-company gap vs the boss's 59,366 unexplained.
4. TPS (do-not-call) needs a Data Soap account; the adapter slot in `call_permission` is empty. Hunter/Telnyx/Data Soap key status unknown.
5. Companies House stream key not saved; Gazette "Pull now" result not confirmed.
6. `bn_enrich_all.py --from-import` needs to read `import_bn_leads`.
7. Wildcards (e.g. `charit*`) in exclusions not supported; more trade families for group picks (only 12 exist) is a small extension in `search_synonyms.py`.
8. No browser verification of any of the new UI. Frontend components were only checked by compile and unit tests of their pure logic.

## 8. Rules and decisions to keep
- Clients never see supplier names (Telnyx, xAI etc.). Users do not download lead data.
- Apollo data: internal use only unless written permission. Google Places data has storage limits. The boss's Gate A (no bulk enrichment for Appendix 1 without written approval) was overridden by Parth for the CSV load only.
- Tavily: keys read fresh per search, free plan 1,000 credits per key; social-media searches only when asked; the wrapper blocks `linkedin`.
- Parth wants: direct answers, no extra panels, filters inside the existing Find Leads panel, no checkbox for the Exclusion list (filled = on, empty = off).

## 9. Deploy state
Commits are local on `main` (head 48f89d2). The repo cannot say whether they are pushed or deployed. After a rebuild: (a) run `refresh_industry_terms.py`, (b) rerun `industry_values.py`'s baseline searches with a longer timeout for the four that timed out, (c) run `exclusion_audit.py`. The rebuild kills running jobs.
