# 12 — Every company sets its own rules (Leads, Voice, Social), and FSB becomes a normal company

Written 2026-11-24 and revised the same day after a review. This follows plans [10](10-leadgen-look-connectors-lead-sources.md) and [11](11-providers-plans-margin-and-launch-readiness.md). It's based on the code and read-only database queries. Work is on the branch `company-rules-fsb-migration`.

**Goal:**
- Everything FSB has today works for **any company**, and **that company's own admins** set it. That includes exclusion rules, a hidden member list, territory, blocked data sources, sign-in rules and call screening.
- The rules cover **Leads, Voice and Social**, not just Leads.
- A reseller brand such as FSB can still lock rules for all its organisations.
- `fsbadmin` and `fsbuser` **are kept**. They move into a real "Federation of Small Businesses" company instead of a demo, and no code creates logins any more.

---

## 0. Review: what the first version got wrong or missed

| # | Finding | Evidence | Fix |
|---|---|---|---|
| 1 | 🔴 **Both FSB logins very likely still use passwords that are written in the source code.** `FSB_DEMO_PASSWORD` / `FSB_DEMO_USER_PASSWORD` aren't set on the server, and neither account has changed its password since it was made. `fsbadmin` is also **exempt from the sign-in lockout**, so its password can be guessed without limit. | `services/fsb_demo.py:37,53`, `api/auth.py:250`, `operators.password_changed_at` empty | Remove the exemption now. Ask both users to choose a new password at their next sign-in (decision 2). |
| 2 | 🔴 **Their e-mail addresses are at `outreach.com`, a domain we don't own.** A password-reset or notice e-mail to `fsbadmin@outreach.com` goes to someone else. | `fsb_demo.py:25,30` | Replace with FSB's real addresses (decision 1). Until then, no reset mail is sent to those addresses. |
| 3 | The first version said the accounts are "recreated on every deploy". **More precisely:** the migration runs once per database. But **every start-up recreates the whole FSB organisation and both logins if the organisation is missing** (`main.py:611-617`), with the code's passwords. A **new** database (a new server, staging) gets an FSB Admin with a published password. | `core/migrations.py:1143,1148`, `main.py:611` | Step 1 removes both. |
| 4 | **The rules only reach Leads.** Voice and Social never read the policy. FSB's "block unscreened numbers" only takes numbers out of **exports**. A person can still call an unscreened number from the browser phone and only sees a warning. | `export_engine.py:198,332`; `compliance.check_call_allowed`, `call_permission.decide` don't read it | Rules gain Voice and Social sections (section 2), enforced in the call and publish gates (B8). |
| 5 | **Sign-in method rules are checked by web address only, never by the person's company.** An FSB user who signs in on the main address can use a password even when FSB has switched passwords off. | `api/auth.py:289` → `signup.brand_signin(request)` uses the host's brand | Check the person's own company rules after the account is known, for password, Google, Microsoft and refresh (B9). |
| 6 | **If the rules can't be read, the app uses no rules** (fail open): for 5 seconds the member list, exclusions and blocked sources disappear. | `tenant_policy.org_effective`, the `except` branch | Use the last known rules; if there are none, refuse with "Your company's rules couldn't be loaded" (B10). |
| 7 | **A brand's territory is lifted for the company's admins.** Today an admin "sees every postcode", even when the brand set an area. That's fine for the company's own default area, but wrong for a brand lock. | `tenant_policy.effective`, `for_user(lift_geo=True)` | Keep two lists: the brand's area (always applies) and the company's area (the default for its people) (B1). |
| 8 | The first version listed a **Role** level but gave it no data model. | — | Deferred. The Person level (Data access) already exists, and roles come later. |
| 9 | Calling hours and the do-not-call list are **already per company** (`AppSetting compliance:<org>`, `CompanyProfile.call_hours_policy`), but a brand can't lock them, and the default mode is "warn", so out-of-hours calls go ahead. | `services/compliance.py:160,237` | They become rules a brand can lock (section 2). |
| 10 | Social posts already wait for approval (`needs_approval`), but **anyone with Social access can approve, including "approve all"**. Neither a brand nor a company can say who approves, which networks are allowed, or whether AI images and video may be used. | `public_api/social.py:140`, `scheduler/approveAll.js` | Social rules (section 2). |
| 11 | The rules are cached **per server process** for 60 seconds. With more than one worker, a saved change can take up to a minute to reach the others. | `tenant_policy._CACHE` | Fine for one worker. Move the change counter to Redis before running several. |
| 12 | **Login by username picks the first match across all companies**, but usernames are only unique **within** a company. Two companies with a user called "admin" would collide. | `api/auth.py:252`, `uq_operator_org_username` | Plan 11, C.1: sign in by e-mail, or make usernames unique everywhere. |
| 13 | Money for Voice and Social was barely covered: a rented phone number is priced at 1 credit (13–20p) but costs about $1 a month, and every voice engine is billed at the same price per minute. | `credits.DEFAULT_RATES` | Added to plan 11 (B.2a, B.3 #12–16). |

---

## 1. What's FSB-only today

The rules engine is already general (`services/tenant_policy.py`). The problem is **where the rules come from, who can change them, and which products read them**:

```
today:   organisation ──► brand ──► Brand.policy        (set by Aivhub staff in the admin portal; read by Leads only)
         organisation without a brand ──► empty policy  (no rules possible)
```

| Feature | How it's switched on today | Who can change it |
|---|---|---|
| Exclusion rules: Active Companies House companies only; leave out 5 company types, 53 SIC codes, 18 name words (but keep driving and dance schools), and anything on the Charity register | Python constants in `services/fsb_rules.py`, switched on by `Brand.policy.exclusions.fsb` | Developers (code) + Aivhub staff |
| Extra exclusions; "enforced" vs "default filter" | `Brand.policy.exclusions.extra` / `.locked` | Aivhub staff |
| Hidden member list | `Brand.policy.member_suppression` + upload at `/org/member-suppression` | Staff switch it on; the company admin uploads |
| Territory (postcode districts) | `Brand.policy.geo` | Aivhub staff |
| Blocked data sources (Google, Apollo, search engines) | `Brand.policy.restricted_sources` | Aivhub staff |
| Sign-in methods | `Brand.policy.signin`, **checked by web address only** | Aivhub staff |
| Leave unscreened numbers out | `Brand.policy.screening`, **exports only** | Aivhub staff |
| Calling hours, block or warn, do-not-call list | `AppSetting compliance:<org>`, `CompanyProfile.call_hours_policy` | **Company ✓ already**, but a brand can't lock it |
| Session length | `session_policy` (org choice, capped by the platform) | **Company ✓ already** |
| Social approval | every post waits for approval; anyone with Social access approves | nobody sets who |
| Per-person limits (areas, may export, may see Google data) | `OperatorDataScope` (Leads → Administration → Data access) | **Company admin ✓ already** |
| Import & match, review queue, Monthly changes | role check (`canUseRecords`: Admin / Manager) | **already general**, but the API is at `/fsb/...` and the tables are `FsbImport*` |
| Connectors screen, sidebar badge | `isFsbAccount()`: hard-coded usernames and e-mails | Developers (code) |
| FSB organisation + `fsbadmin` / `fsbuser` | made by code (`fsb_demo.py`) with passwords from the code; remade at start-up if the organisation is missing | — |

Live data: the FSB brand has **one** organisation, `org_fsb_demo` ("Federation of Small Businesses (demo)"). Its only users are `fsbadmin` (Admin) and `fsbuser` (FSB Operator). Both signed in on 2026-11-24. It holds 3 saved leads and 1 per-person limit.

---

## 2. Who can set what

Four levels now, with roles later. **Each level can only add restrictions. It can never relax one a level above has set.**

```
Platform  — the law and the plan (PECR, licence terms, what the plan includes)
  └ Brand   — a reseller such as FSB: rules for every organisation it brings     (Aivhub staff)
     └ Company — the organisation's own rules                                       (company admins)  ← NEW
        └ Person  — personal territory, export, Google data (exists: Data access)   (company admins)
```

**The rules, by product:**

| Product | Rule | Exists? |
|---|---|---|
| Leads | Exclusions (rule sets + extra items), enforced or a default filter | yes (brand only) |
| Leads | Hidden member / customer list | yes (brand switches it on) |
| Leads | Territory | yes (brand only) |
| Leads | Data sources: Google, Apollo, web search | yes (brand only) |
| Leads | Who may export | per person only |
| Voice | Block calls (and exports) to numbers without a fresh TPS/CTPS result | exports only today |
| Voice | Calling hours: off / warn / block, plus the schedule | yes, per company; a brand can't lock it |
| Voice | AI-voiced calls only with recorded permission | always on (law), never switchable |
| Voice | Shared do-not-call list for the whole brand | later |
| Social | Posts need approval, and who may approve (role) | approval exists; "who" is new |
| Social | Networks allowed (LinkedIn, Facebook, X, Instagram, …) | new |
| Social | AI images allowed, AI video allowed | new |
| Account | Sign-in methods; two-factor required | methods exist (by address only); two-factor new |
| Account | Session length | yes, per company |

**How two levels combine** (one function, `merge_policy(upper, lower)`, unit tested):

| Rule | Combined as |
|---|---|
| Exclusion rule sets, extra exclusions | union: everything either level excludes |
| "Enforced" | enforced if any level that has exclusions enforces them |
| Hidden member / customer lists | both lists apply |
| Territory | the brand's area always applies. The company's area must sit inside it; saving one that doesn't overlap is refused. If a later brand change leaves no overlap, the search shows nothing rather than everything |
| Blocked data sources | blocked if any level blocks it |
| Sign-in methods | allowed only if every level allows it. At least one stays on (checked on save) |
| Block unscreened numbers, posts need approval | on if any level turns it on |
| Calling hours mode | the strictest: block > warn > off |
| Networks allowed | only those every level allows |
| AI images / video, exports | only if every level allows them |
| Monthly credit cap (later) | the lowest |

In the rules screen, every rule a higher level has set shows read-only with **"Set by FSB"** (or "Required by your plan").

---

## 3. Data model

1. **`Organization.policy` (JSON)**: the company's own rules, same shape as `Brand.policy`, cleaned by the same `clean_policy()`.
2. **Policy shape v2** adds two sections. Old policies without them read as "no rule".
   - `calling: {hours_mode: "" | "off" | "warn" | "block"}` (`screening.block_unscreened` stays where it is and also applies to calls).
   - `social: {approval_required: bool, approver_roles: [...], networks: [...], ai_images: bool, ai_video: bool}`.
3. **Exclusion rule sets as data, not code.** New table `exclusion_rule_sets`:
   - `id`, `owner_kind` (platform | brand | org), `owner_id`, `name`, `description`, `version`, `enforced`, `updated_by`, `updated_at`
   - `rules`: `{statuses: ["Active"], register_only: true, company_types: [...], sic_codes: [...], name_words: [...], keep_words: [...], exclude_charity_register: true, postcodes: [...], company_numbers: [...]}`
   - **Seed one platform preset, "Standard B2B exclusions"**, from today's `fsb_rules.py` constants.
   - Each set carries its own "enforced" flag. Until then the flat v1 shape has one flag for all exclusions, so mixing an enforced brand list with a company default filter enforces both. That's stricter, never looser.
4. **Policy v2 `exclusions.rule_sets: ["standard_b2b", "<org set id>"]`.** An old `exclusions.fsb: true` is read as `rule_sets: ["standard_b2b"]`, so FSB's results don't change.
5. **Brand-level hidden list:** a brand can hold one list (e.g. all FSB members) that applies to every organisation in the brand.
6. **`Brand.account_link`** `{label, url, logo}`: replaces the hard-coded FSB sidebar badge.
7. Every save writes an `AuditLog` row (`policy.changed`, before and after).

---

## 4. Backend changes

| # | Change | Files |
|---|---|---|
| B1 | `_load()` reads brand + company rules and combines them with `merge_policy`. The brand's territory is kept apart so a company admin can't lift it. Clear the cache on save. | `services/tenant_policy.py` |
| B2 | `fsb_rules.py` → `exclusion_rules.py`: build the SQL for **any** rule set from its data. Add a preview: "these rules hide N of M companies". | `services/fsb_rules.py`, `services/business_records.py`, `services/lead_filters.py` |
| B3 | API for company admins: `GET/PUT /org/rules` (returns the brand's rules, the company's own and the combined result; `GET /org/policy` stays the read-only summary for everyone). Later in step 3: rule-set CRUD and a preview. The member list opens for any company whose rules switch it on. | `api/org_policy.py` |
| B4 | Exports, data sources and Leads search already read `TP.effective()`. Check each caller. | `services/export_engine.py`, `services/data_policy.py`, `services/business_records.py` |
| B5 | Rename `/fsb/...` routes to `/records/...`, keeping the old paths for one release. | `api/fsb.py`, `main.py`, `frontend/src/api/apiClient.js` |
| B6 | **Stop code from making logins.** Remove the start-up block in `main.py` and the account-making code and passwords in `fsb_demo.py`. Already-applied migration names stay as recorded no-ops. **Remove the `fsbadmin` lockout exemption.** | `main.py`, `core/migrations.py`, `services/fsb_demo.py`, `api/auth.py` |
| B6b | **Move the FSB organisation to a real company:** one migration renames "Federation of Small Businesses (demo)" to "Federation of Small Businesses" and slug `fsb-demo` → `fsb` (when free), and renames the company profile the same way. It only touches a name that is still the demo name. The id `org_fsb_demo` stays, because it's the key on every row of FSB's data, its credit wallets and the row-level security. Users, roles, leads, data scope and credits stay as they are. | `core/migrations.py` |
| B7 | Admin portal action **"Create demo organisation"**: choose a brand or preset, sample data, an expiry date, and invite links instead of passwords. | `api/admin_portal.py` |
| B8 | **Voice and Social enforce the rules:** `compliance.check_call_allowed` refuses a call to an unscreened number when the rule is on, and takes the strictest hours mode. The social publish and approve paths check approval, approver role, networks, AI image and video. | `services/compliance.py`, `services/human_calls.py`, `public_api/social.py`, `api/scheduler.py`, `services/video_ai.py` |
| B9 | **Sign-in rules by company:** after the account is found (password, Google, Microsoft, refresh), refuse a method the person's combined rules switch off. The web-address check stays for the sign-in page itself. | `api/auth.py`, `api/signup.py` |
| B10 | **Fail closed:** if the rules can't be read and none are remembered, refuse with a clear message instead of using no rules. `source_allowed()` answers "not allowed". | `services/tenant_policy.py` |

## 5. Frontend changes

| # | Change |
|---|---|
| F1 | **One "Rules" screen for the whole company** (company settings, with links from Leads → Administration, Voice settings and Social settings), because the rules cover all three products. Sections:<br>• **Leads:** exclusions (pick rule sets, add SIC codes, company types, name words, company numbers, postcodes; "Enforced" or "Default filter"; live count "hides 5,861 of 65,210"), the hidden customer/member list, territory, data sources, exports.<br>• **Voice:** block unscreened numbers, calling hours mode (the schedule stays where it is).<br>• **Social:** approval and who approves, networks, AI images, AI video.<br>• **Sign-in:** methods, two-factor.<br>Rules set above show "Set by &lt;brand&gt;" and can't be edited. |
| F2 | Find Leads: rule-set chips instead of the `fsb_exclusions` filter, and "Your company's rules hide N companies · See rules". Voice: say "Blocked by your company's rules: check TPS first" instead of a warning. Social: hide networks and AI options the rules switch off. |
| F3 | Delete `isFsbAccount()` and its username lists. The Connectors screen depends on the plan feature + admin role. The sidebar badge comes from `brand.account_link`. Remove the "jitendra" special case in `tokens.js`. |
| F4 | Admin portal → Brands: the policy editor reuses the F1 component. |

---

## 6. Moving `fsbadmin` / `fsbuser` into the real FSB company

Nothing is deleted or disabled. Both people keep their login, their history and their data.

1. **Stop code from making or changing logins** (B6). From then on, the accounts are ordinary users that FSB's admin manages under Team.
2. **Make the organisation a real company** (B6b): "Federation of Small Businesses", slug `fsb`. It stays linked to the FSB brand, so the brand's rules still apply, and FSB's admin can now add the company's own rules (step 2).
3. **Fix the two security problems** (section 0, #1 and #2):
   - Remove the lockout exemption (done in B6).
   - Ask both users to choose a new password at their next sign-in (`must_change_password`). This changes live logins, so it needs your go-ahead (decision 2).
   - Replace the `outreach.com` addresses with FSB's real ones (decision 1).
4. **More FSB people** join by invitation to the same company. Microsoft sign-in is already allowed for them.
5. **Sales demos** use "Create demo organisation" (B7): expiring, invite links, no passwords in the code.

---

## 7. Tests

- `merge_policy`, one test per rule:
  - a company can't relax a brand rule,
  - the brand's territory survives the admin lift,
  - a territory with no overlap shows nothing,
  - at least one sign-in method always stays on,
  - an unlocked brand default filter doesn't become enforced because the company's empty default says "locked".
- **No change for FSB:** with no company rules, FSB's combined rules equal its brand rules exactly. When rule sets come (step 3), the preset must give exactly today's counts: 65,210 before exclusions → 59,349 after (`bn_funnel.txt`).
- API: a non-admin can't change rules, a company can't unlock a brand rule, an empty territory overlap is refused, and every save writes an audit row.
- Start-up on an empty database creates no FSB organisation and no `fsbadmin` / `fsbuser`.
- The move migration renames only while the demo name is still there, and changes no users.
- Voice: a human call to an unscreened number is refused when the rule is on. Social: publishing to a network the rules don't allow is refused.

## 8. Order and size

| Step | What | Size |
|---|---|---|
| 1 | B6 + B6b: no code-made logins, remove the lockout exemption, move FSB to a real company | ½ day |
| 2 | B1 + B3 + B10 + `merge_policy`: company rules on the server, with audit, failing closed | 2–3 days |
| 3 | B2: rule sets as data, Standard B2B preset, preview counts, no-change test for FSB | 2–3 days |
| 4 | B8 + B9: Voice, Social and sign-in read the combined rules | 2–3 days |
| 5 | F1 + F2: the Rules screen and the notices in Leads, Voice and Social | 4–5 days |
| 6 | F3 + B5: remove `isFsbAccount`, rename `/fsb` routes, brand account link | 1–2 days |
| 7 | B7 + F4: "Create demo organisation", shared brand/company rules editor | 1–2 days |

About three weeks in total. Steps 1–2 change nothing FSB can see, except the company name losing "(demo)".

**Status, 2026-11-25:** step 6 is done on the branch.
- F3: `isFsbAccount()` is gone. The sidebar badge comes from the brand's `theme.accountLink` (migration `2026_12_11_fsb_brand_account_link` gives FSB's brand its link), and the "jitendra" case is gone.
- B5: the `/fsb/...` routes are also served at `/records/...`, which the frontend now uses; the old paths stay for one release.

Connectors is shown to every user (plan 10, decision 3, taken as the default).

**Status, 2026-11-24:**
- Steps 1 and 2 are written on the branch `company-rules-fsb-migration`, in the worktree `.worktrees/company-rules`. That's B6, B6b, B1, B3 (rules GET/PUT) and B10.
- The work is kept out of `/opt/flow` on purpose, because the live backend runs from that folder and would pick the branch up on its next restart.
- It's not committed or deployed yet.

## 9. Decisions needed from you

1. **FSB's real e-mail addresses** for `fsbadmin` and `fsbuser`. The `outreach.com` ones aren't ours.
2. **New passwords:** may I make both choose a new password at their next sign-in? Their current ones are very likely the ones in the code.
3. **Voice:** should FSB's "block unscreened numbers" also **block calls**, not only exports? Today it only warns, so this would change what FSB's callers see.
4. Should the "Standard B2B exclusions" preset be **on by default for new companies** (as a default filter they can switch off), or off?
5. Can companies **create their own exclusion rule sets on every plan**, or only on higher plans?
6. Should brand-level member lists (FSB members hidden for all FSB organisations) be supported now, or later?
