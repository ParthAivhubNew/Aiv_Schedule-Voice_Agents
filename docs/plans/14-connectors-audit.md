# 14. Connectors: audit and what to add (2026-11-27)

## Status

- **Done 2026-11-27 (commit 428c1a6):** every card on Settings → Data sources checked against the database and the real services. Four status fixes, tested and deployed to the test app (below).
- **Done 2026-11-27 (commit c31067e), the owner chose "free registers first":** the ICO register of fee payers, the Scottish Charity Register (OSCR) and NHS GP practices, dentists and pharmacies are data sources. OSCR (25,025) and NHS (27,623) were loaded into the test copy. The ICO file (1,470,567 rows) was read end to end through the real loader but not written to the test copy (it is 18 times the test database). **On live, staff press Start on each** (staff portal → Data Sources) once the branch goes live.
- A register that has never been loaded now shows "Not loaded yet", not "Connected".
- **Not added, and why:**
  - Charity Commission NI publishes no download.
  - Ofsted childcare publishes only a spreadsheet (.xlsx/.ods), which the loader doesn't read.
  - Get Information About Schools now builds its file through a three-step form, and its last step failed with a server error. It could come in as an uploaded file, as CQC does.
- **ICO caution:** most of its 1.47 million rows are sole traders, often at a home address. They are personal data, so their use in outreach needs the same legitimate-interest care as the Food Hygiene sole traders. The source is marked `personal_data`.

## 1. What each card shows, checked

Checked as FSB (`org_fsb_demo`) on the test app. The test copy holds 82,586 company records; live holds 6.7 million. The record counts on the test screen are the sample's, not live's.

| Card | Screen said | Real state | Now shows |
|---|---|---|---|
| Charity Commission | Connected | Last loaded 8 Oct; the register's file was updated today | **Out of date** |
| Companies House | Updates paused | Companies loaded 6 Oct; the *directors* job was paused on 20 Nov | Updates paused, "updates of directors and owners are paused" |
| CQC | Connected | Loaded 27 Oct; the download page answers again (was 403) | Connected |
| Food Hygiene (FSA) | Connected | Last loaded 8 Oct | **Out of date** |
| Gender Pay Gap | Connected | Loaded 27 Oct; publishes yearly | Connected |
| Licensed data, Web scrape, Research | Connected | Loaded | Connected |
| E-mail finder | Connected | Check passed: 4 of 4 answer (Icypeas, Hunter 50, Findymail 15, BetterContact 44). LeadMagic has no key | Connected |
| Phone number check | Connected | Check passed: 6.57 USD left | Connected |
| TPS & CTPS | Not connected | No Provero key saved | Not connected |
| ChatGPT, DeepSeek | Connected, no check possible | Both keys answer (free model list) | Connected, **now checkable** |
| Tavily | Switched off (FSB's rules) | **All 1,000 credits this month used**; no pay-as-you-go | Switched off for FSB; **Out of credit** for any company where it's on. Its check now fails |
| Apollo | Switched off (FSB's rules) | Check passed | Switched off |
| Google Places | Switched off (FSB's rules) | Not checked (paid) | Switched off |
| Company websites, postcodes, file import, web forms, Salesforce file | Connected | Built in; nothing outside to check | Connected |

### Fixes made
1. **Out of date:** a register whose last full load is older than its publishing cycle (45 days; Gender Pay Gap 400) shows "Out of date" and counts under "need a look".
2. **Out of credit:** a provider whose latest stored balance (`platform_balances`, polled every few hours) is zero shows "Out of credit": Tavily, the e-mail finders, the phone check.
3. **Companies House pause** says it's the directors job, not the company records.
4. **ChatGPT and DeepSeek** have a Test button (lists models: free). **Tavily's check** fails when its month's credits are gone.

### Not fixed, needs a decision
- **Tavily is out of credits on the platform key** (the live key too). Web search for companies that have it on fails until 1 Dec or a top-up.
- **Registers never refresh by themselves.** Staff press Start. A monthly job (or Companies House's free streaming API) would keep them current.
- Not checked: Google Places (paid), Provero (no key), LeadMagic (no key).

## 2. Research: what's missing

### Free official registers (fit the existing bulk loader: mostly a data-source row and a field map)
| Source | What it adds | Access |
|---|---|---|
| **ICO register of fee payers** | ~1.2 million organisations **including sole traders**, names and addresses, updated daily | Free download |
| **Scottish Charity Regulator (OSCR)** and **Charity Commission NI** | Charities outside England and Wales | Free CSV, OGL |
| **Get Information About Schools** | Every school and academy trust in England, with phone and website | Free CSV, OGL |
| **NHS ODS** | GP practices, dentists, pharmacies, care homes | Free CSV, OGL |
| **Ofsted childcare providers** | Nurseries and childminders | Free, OGL |
| **Companies House streaming API** | New companies and changes as they happen (keeps the register current) | Free key |

### Look-ups (one company at a time)
| Source | Use | Access |
|---|---|---|
| **HMRC VAT check** | Confirm a VAT number and trading name | Free API |
| **FCA Financial Services Register** | Regulated firms and people (finance, insurance, mortgages) | Free API key; no bulk export (the full extract is paid) |
| **Contracts Finder / Find a Tender** | Who wins public contracts: a buying signal | Free API, OGL |
| **The Gazette (insolvency notices)** | Leave out companies being wound up | Free |

### Paid
| Source | Gap it fills | Note |
|---|---|---|
| **E-mail verification** (ZeroBounce, MillionVerifier, NeverBounce) | Check an address *before* sending. We find e-mails but don't verify ones we already hold: the biggest gap for deliverability | Pennies per check |
| **Creditsafe** | UK SME credit scores and limits (alongside or instead of Experian) | Contract |
| **Cognism** | Verified UK mobiles, TPS-checked | Expensive (~£1.5k+ per seat a year) |
| **BuiltWith** | Which software a company's site runs | Subscription |

Skip: the VOA business rates list (its licence excludes the Open Government Licence).

### Your own systems
- **Webhooks plus Zapier / Make**: one build covers hundreds of tools.
- **Google Sheets** (read and write a list).
- **HubSpot** and **Capsule CRM** (common with UK small firms), before Dynamics, Snowflake and the rest already listed.

## 3. Suggested order
1. Top up or upgrade Tavily (owner).
2. Monthly register refresh, plus the Companies House streaming API.
3. ICO register, OSCR, CCNI, schools, NHS ODS, Ofsted: free, bulk, the loader already handles this shape.
4. E-mail verification.
5. HMRC VAT, FCA, Contracts Finder, Gazette look-ups.
6. Webhooks / Zapier, Google Sheets, HubSpot.
7. Paid data (Creditsafe, Cognism) once a client asks.

Sources: [ICO register download](https://cy.ico.org.uk/about-the-ico/what-we-do/register-of-fee-payers/download-the-register/), [FCA Register](https://fca.org.uk/firms/financial-services-register), [FCA Register Extract handbook](https://www.fca.org.uk/publication/documents/register-extract-handbook.pdf), [VOA licence note (Liverpool)](https://www.liverpool.ac.uk/geographic-data-science/news/stories/title,986082,en.php), [Cognism UK providers](https://www.cognism.com/blog/data-providers-uk), [Prospeo UK pricing](https://prospeo.io/s/b2b-data-providers-uk).
