# 15. How to add and switch on each data source (staff guide, 2026-11-28)

Everything here is done in the **staff portal**. Clients only see the result on Settings → Data sources and can't change anything there.

Where things live in the staff portal (left menu, **Platform** group):

| Screen | What you do there |
|---|---|
| **Platform keys → Data Sources** tab | Registers and bulk datasets: add, test, load files, start a full import, pause, stop, see runs |
| **Platform keys → Leads** tab | Keys: TPS, Apollo, Tavily, the official-register feeds (Companies House stream, FCA, Gazette, postcodes), e-mail finders, Google, AI |
| **Platform keys → Voice** tab | The Telnyx key (the phone number check uses it) |
| **Providers** | Every outside provider with its Test button; **Add an e-mail finder** (a new finder with no code) |
| **Balances** | Credit left on each provider |

The steps below are listed by source. "On live" means what still has to be pressed on the live app once this branch goes live.

---

## A. Registers already set up (just press Start)

These rows already exist: migrations create them on start-up. All you do is load them.

**Steps for each one:**
1. Staff portal → **Platform keys** → **Data Sources** tab.
2. Find the source's card and press **Test**. It should say "Test OK" or report a file it found.
3. Press **Start full import** and confirm. It runs in the background.
4. Press **Runs** to watch progress. **Pause**, **Resume** and **Stop** work at any time.
5. When it finishes, Settings → Data sources shows **Connected** with the record count.

| Source | How it loads | Tested | Last loaded (test copy) | On live |
|---|---|---|---|---|
| Companies House (company records) | Finds the monthly zip on the download page | Yes, loaded | 5.7 million, 6 Oct | Loaded 6 Oct. **Start again monthly** |
| Companies House (directors and owners) | Card's **Start reading people**: needs the Companies House API key saved on the card (**Edit** → API key). Choose how many companies, optionally BN districts first (**FSB BN areas** button) | Yes, partly | Paused 20 Nov | Paused. Press **Resume** when wanted |
| Charity Commission (England & Wales) | Direct zip link | Yes, loaded | 398,644, 8 Oct | **Out of date**: Start again |
| CQC care directory | Finds the file on the CQC page. If CQC blocks it (it returned 403 before), download the file yourself and use **Files & preview** (section C) | Yes, loaded | 57,107, 27 Oct | Start again monthly |
| Food Hygiene Ratings (FSA) | Reads the FSA's API council by council | Yes, loaded | 614,283, 8 Oct | **Out of date**: Start again |
| Gender Pay Gap | Two yearly files | Yes, loaded | 22,515, 27 Oct | Yearly; fine until 2026 data |
| **ICO register of fee payers** (new) | Finds the daily zip on the ICO page | Yes, read in full (1,470,567 rows), **not saved** to the test copy, which is too small | Not loaded | **Not on live yet.** Start after go-live. Mostly sole traders: personal data, so legitimate-interest care |
| **Scottish Charity Register (OSCR)** (new) | Direct file link | Yes, loaded | 25,025, 27 Nov | Not on live yet: Start after go-live |
| **NHS GP practices, dentists, pharmacies** (new) | Three NHS report links, active ones only | Yes, loaded | 27,623, 27 Nov | Not on live yet: Start after go-live |

Note: no register refreshes itself yet. Someone has to press Start, monthly at least (see plan 14, step 2).

---

## B. Official-register feeds (Platform keys → Leads → "Official registers")

These are built and only need a key or a press. The table at the top shows each feed's state.

| Feed | Steps | Tested | Live state |
|---|---|---|---|
| **Companies House streaming** (live changes: new companies, name, address and status changes, directors joining or leaving) | 1. Sign in at developer.company-information.service.gov.uk, create an application and choose a **Streaming API** key. 2. Paste it in "Paste the stream key" → **Save**. 3. Both feeds (companies, officers) start by themselves within five minutes; the table shows "running" | **No**: no key on test or live | "no key" |
| **The Gazette** (insolvency notices) | No key. Runs by itself every hour; **Pull the Gazette now** for the last 14 days | Yes: runs on test and live | Running (last pull 27 Nov) |
| **FCA register** (is a finance firm FCA-authorised?) | 1. Register at register.fca.org.uk/Developer. 2. Enter the registered e-mail and the key → **Save**. 3. **Run the FCA check** (200 finance companies at a time) | **No**: no key | No key |
| **ONS postcodes** (postcode to district, area, coordinates) | 1. Copy the link to the latest ONS Postcode Directory zip from the ONS Open Geography portal. 2. Paste it → **Load BN postcodes** | **No**: never loaded (0 postcodes on test and live) | Not loaded |

---

## C. Adding a new register or file (one that isn't listed)

Use this for any public dataset published as a CSV, TSV, JSON or zip file, or a JSON API that pages.

1. **Platform keys → Data Sources** → **Add a data source** (at the bottom).
2. **Name**: what staff and clients will see, e.g. "Get Information About Schools".
3. **Kind**: `api` (also right for downloads); `scrape` only for reading web pages.
4. **Auth type**: `none` for a free download; otherwise how the key is sent. Paste the **API key** if there is one.
5. **Config (JSON)**: press **Insert a file-import example**, then change it. The keys you need:
   - How to find the file. Pick one:
     - `bulk_index_url` + `bulk_link_pattern`: a page that lists the download, plus a pattern that matches the link (best when the file name changes each month).
     - `bulk_file_urls`: a list of direct links.
     - `bulk_mode: "folder"`: you upload the file yourself (next step). Use this when the site has no stable link, e.g. schools (GIAS) or a file someone has e-mailed.
     - `bulk_paged_url`: a JSON API read page by page (`{page}` in the link).
   - `bulk_field_map`: which column becomes which fact, e.g. `"name": ["EstablishmentName"]`, `"postcode": ["Postcode"]`, `"phone": ["TelephoneNum"]`, `"website": ["SchoolWebsite"]`, `"industry": ["TypeOfEstablishment (name)"]`, `"registration_number": ["URN"]`.
   - `trust_tier: "verified_registry"` for official registers.
   - Optional: `bulk_defaults` (a value on every row, e.g. status Active), `bulk_registration` (a prefix for the reference number, e.g. "URN-"), `bulk_only` (keep only some rows, e.g. open ones), `bulk_column_names` (for a file with no header row), `bulk_drop_fields` (columns never to keep, e.g. personal names), `personal_data: true` if sole traders or people are in it, `licence` and `attribution` (e.g. "Open Government Licence v3.0").
6. **Save**.
7. **Files & preview** on the new card. Upload the file there if you chose `folder`. Then press **Preview mapping**: it shows the first rows as they would be saved. Fix `bulk_field_map` with **Edit** until the preview is right.
8. **Test**, then **Start full import**.
9. The card appears on clients' Settings → Data sources under "Registers" by itself.

The loader reads `.csv .tsv .txt .json .jsonl .ndjson .zip`. It **can't read Excel** (.xlsx/.ods): open the file and save it as CSV first (Ofsted's childcare list needs this).

Waiting to be added this way (plan 14):
- **Get Information About Schools**: download "All establishment data" by hand from get-information-schools.service.gov.uk/Downloads, then use folder mode.
- **Ofsted childcare providers**: save the spreadsheet as CSV, then folder mode.
- **Charity Commission NI**: publishes no download; skip for now.

---

## D. Keys for outside providers

| Card on Settings → Data sources | Where the key goes | Steps | Tested |
|---|---|---|---|
| E-mail finder (Icypeas, Hunter, Findymail, BetterContact, LeadMagic) | Platform keys → **Leads** → "Email Finder & Discovery Keys" | The provider's card → **Set key** (or **Change**) → paste → **Test and save** | Yes: 4 of 4 answer. **LeadMagic has no key** |
| A new e-mail finder with no code | **Providers** → **Add an e-mail finder** | Fill in its URL and fields → **Save**; then paste the key on Platform keys as above; then **Test** on Providers | Built and tested, none added |
| Phone number check (Telnyx) | Platform keys → **Voice** → **Set Telnyx key** | Paste → **Test and save** | Yes: 6.57 USD left |
| TPS & CTPS screening (Provero) | Platform keys → **Leads** → "TPS and CTPS screening" | Paste the screening key → **Save key** → the check button | **No: no key**. Checks are paid, so ask before testing |
| Apollo | Platform keys → **Leads** → "Apollo" | Paste → **Add Apollo key** (a second one is kept as a backup) | Yes |
| Tavily (web search) | Platform keys → **Leads** → "Tavily" | Paste → **Add Tavily key** (backups are tried in order) | Yes. **Out of credit** (1,000 of 1,000 used): top up, or add a backup key |
| Google Places | Platform keys → **Leads** → "Business Discovery" card → **Set key** | Paste → **Test and save** | **No**: paid, not tested |
| ChatGPT, DeepSeek (research AI) | Platform keys → **Leads** → "Reasoning AI Routing" and the LLM key cards | **Set key** → **Test and save**; pick which one does research in the routing box | Yes |
| Company websites, postcodes, file import, web forms, Salesforce file | Built in | Nothing to connect | n/a |

Then check **Providers** (each row's **Test**) and **Balances** (credit left).

### Switching a source on or off for one company
This is set in the company's rules, not here: "Google", "Enrichment data" (Apollo) and "Web search engines" (Tavily). Staff set them in the staff portal → **Brands** → the brand → **Rules** → **Save the rules**; the company's own admin sees the same switches on its Company rules tab. A source switched off there shows "Switched off" on that company's screen, e.g. Tavily, Apollo and Google for FSB.

---

## E. Not built yet (needs code, not just setup)

- E-mail verification (ZeroBounce, MillionVerifier or NeverBounce): the biggest gap.
- HMRC VAT check and Contracts Finder look-ups.
- Webhooks and Zapier/Make, Google Sheets, HubSpot, Capsule. The "Coming soon" CRM cards.
- Creditsafe, Cognism and BuiltWith (paid, once a client asks).
- Automatic monthly refresh of the registers.
