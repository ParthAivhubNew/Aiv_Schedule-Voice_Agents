# Plan 10: Organisation exclusion rules, set by the organisation's admins

Status: built 2026-11-28 (not yet deployed or browser-checked). Revised after egm review (design, codebase, scope, readiness).

Built: table and model, `services/org_rules.py`, policy engine reading rules for every organisation (fail closed), the two startup steps
(`2026_12_05_org_exclusion_rules`, `2026_12_06_seed_fsb_rules`), `api/org_exclusions.py`, the Administration > Exclusions tab, removal of the
hard-coded FSB filter, brand flag and staff toggle, and rules applied to exports and journey steps. Beyond phase 1 it also has the extra rule kinds
(postcode, company number, category) and the change-history list. Not built: marking companies already in a list as "Left out by your
organisation", calling queues, a template for other customers. Unit tests pass; the database tests (marked db) have not been run here.

## Goal

An organisation admin (FSB's, or any customer's) keeps one organisation-wide exclusion list in the product. Everyone in that organisation sees
data with the list applied, and only admins can change it. The FSB rules stop being code: they become rows the FSB admin can read, edit,
switch off and extend.

## What exists today (checked in the code)

| Piece | Where | Limit |
|---|---|---|
| FSB rule set | `backend/app/services/fsb_rules.py` | Hard-coded. A change is a code release. |
| Policy engine: policy to SQL conditions, ANDed into searches, counts and the public API; cache and hash per organisation | `services/tenant_policy.py` | Reads only `Brand.policy`, edited by platform staff. An organisation with no brand gets an empty policy (`_load`). |
| Free-form items (SIC, number, postcode, word, category) | `business_records.classify_exclusions`, `_exclusion_items`, `exclusion_categories.py` | Per search, or `Brand.policy.exclusions.extra`. |
| Admin patterns to copy | `api/org_policy.py` (`_admin`, `audit.record`, `TP.invalidate`), `api/data_access.py` (`preview`), `confirmChange.confirmTwice` | |
| Tenant table registration | `suppressed_companies` model, `core/tenancy.py` `TENANT_TABLES`, `core/migrations.py` `STEPS` (pattern: `_operator_data_scope`) | |

Corrections from review: exports, lists, journeys and calling read `LeadAccount`, not `business_records.matching`, so today's policy does
not reach them. There is no Activity screen (audit rows are written, nothing shows them). `ExclusionBox.jsx` is a prop-driven control, not a
standalone box.

## Design

### 1. One source: the organisation's rules

No rule is fixed in code any more. Everything FSB's list contains, including the two register checks (status exactly "Active" and Companies
House number only), becomes a row the organisation's admin can see, edit, switch off and delete. The server enforces whatever rows are on, for
every person in the organisation, with no per-user switch.

Removed from code (not just unused):
- `fsb_rules.py` enforcement: `conditions()`, `status_condition()`, `rules_as_data()`, `sql_script_vars()` and the brand-policy path that calls them
  (`Policy.exclusion_conditions` branch for `exclusions.fsb`). The module keeps only the lists as seed data (`SEED`), used once by the migration.
- The brand `exclusions.fsb` flag and its "FSB exclusion rules" toggle in `frontend/src/adminPortal/Brands.jsx`; `exclusions.locked` and
  `exclusions.extra` in brand policy go too (organisation rules replace them). `brandLogic.js` and `clean_policy` lose those keys.
- The `fsb_exclusions` search filter (`business_records`, `lead_filters`, `FindLeadsView.jsx` `KEEP_KEYS`) and `FSB_TYPES/SIC/NAME_*` aliases in
  `business_records.py`; tests that assert on them are rewritten against rules.
- Platform staff keep geography, member suppression, restricted sources and sign-in in the brand policy. Those are not exclusion lists and are
  out of this change.

Sole traders: today's locked policy never relaxed the Companies House rule (a sole-trader search under FSB's policy finds nothing), so the
`ch_number_only` row behaves the same and has no special case. An admin who wants sole traders switches that row off. No filter lifts a rule.

### 2. Store: `org_exclusion_rules`

Tenant table (`org_id = Column(String, index=True, server_default=FetchedValue())`, added to `TENANT_TABLES`, RLS like `suppressed_companies`).

| Column | Meaning |
|---|---|
| id, org_id | Row id, owner. |
| kind | Phase 1: `sic`, `company_type`, `name_word`, `charity_register`, `status_only`, `ch_number_only`. Phase 2: `postcode`, `company_number`, `category`. |
| value | The code, type or word. `''` (NOT NULL) for the three switch kinds, so the unique key works. |
| mode | `exclude` or `keep`. |
| label | Optional note. |
| enabled | Off keeps the row and stops applying it. |
| created_by, created_at, updated_at | Author and times. `updated_at` is the edit check. |

Constraints: unique (org_id, kind, value, mode); CHECK value non-empty unless the kind is a switch; CHECK mode `keep` only for `name_word`.
`status_only` keeps companies whose status is "Active"; `ch_number_only` keeps companies with an 8-character Companies House number.
Cap 500 rules per organisation (FSB seeds about 80).

Validation (422, whole request rejected with the bad items named): `sic` is 2 to 5 digits (a short one means every code starting with it, as
in `_exclusion_items`); `company_type` is trimmed and lower-cased; `name_word` is 2 to 80 characters with at least 2 letters or digits.
Duplicates in a bulk add are skipped and counted in the reply.

### 3. How rules reach a search

- `tenant_policy._load` reads the organisation's enabled rules whether or not it has a brand. Rules are read with an explicit `org_id` filter
  under system scope, because `org_effective(db=None)` opens a session with no tenant context and row security would return nothing there.
- `Policy` gets `org_rules`. `_exclusions_on`, `is_empty`, `hash()` and `summary()` all count them, so a brand-less organisation works.
- Conditions: rules become a few regexes, never one condition per row. Every value goes through `re.escape`. `sic` and `name_word` rows reuse
  `_exclusion_items` and `_leave_out_words` building blocks; `company_type`, `charity_register`, `status_only` and `ch_number_only` get small
  builders in a new `services/org_rules.py` (the replacement for the enforcement half of `fsb_rules.py`).
- `keep` rows cancel `name_word` exclusions of the same organisation, only while enabled. If a value is both exclude and keep, keep wins for that
  word. A disabled keep row cancels nothing.
- The hash is built from the rules' content (count plus a digest of rows), not a local counter, so a worker that loads new rules gets a new
  cache key. Other workers see a change within the cache time (60 s; 10 s for an organisation that has rules). `invalidate` still runs on save.
- Fail closed: if the rules cannot be read, the request fails with the same 503 as `data_access.AccessDenied`. It never falls back to an empty
  policy for an organisation that has rules. A cold cache with a failed read for an organisation with no known rules also fails, not shows all.
- `apply_policy=False` (a named-company lookup) is unchanged.

### 4. FSB: from code to data (two `STEPS`, each savepointed)

1. `2026_12_xx_org_exclusion_rules`: create the table, indexes, constraints, RLS.
2. `2026_12_xx_seed_fsb_rules`: for each organisation whose brand policy has `exclusions.fsb` true and that has no rows yet (idempotent),
   insert rows from `fsb_rules.SEED`: `status_only`, `ch_number_only`, `charity_register`, the 5 types, the SIC codes, the name words, the
   keep words. It then removes `fsb`, `locked` and `extra` from that brand's policy in the same savepoint (any `extra` items become `sic` /
   `name_word` rows first). The step skips quietly when no such organisation exists. After it, the FSB organisation's behaviour comes only from
   its rows.

Order of release: the rules code and both migrations ship together, so there is no window with the old flag removed and no rows (the seed
runs in the same startup before requests are served).

Rollback: the removed brand keys are saved in the seed step's audit row, so a downgrade script restores them and drops the table. The old code
then applies the hard-coded list again. Edits admins made after rollout are lost; the plan accepts that.

Equivalence test (must pass before the old code is deleted): a fixture of companies covering each rule (a charity type, each excluded SIC as
first and fourth code, a name word, a driving school, a non-Companies-House number, a status other than Active, a sole trader search). The old
`status_condition() + conditions()` run once against the fixture to record the expected ids, and the seeded rows must return the same ids.

### 5. API (admin only, section `team`)

`backend/app/api/org_exclusions.py`, prefix `/org/exclusions`, rule `^/org/exclusions` added to `core/permissions.py` next to the data-access
line, `_admin(request)` in every handler.

- `GET /org/exclusions`: rules (with `updated_at`), the floor shown as plain lines.
- `POST /org/exclusions`: `{"items": ["56101", "church", "Charity register"]}`; text goes through `classify_exclusions`; reply
  `{added, skipped, rejected: [...]}`.
- `PUT /org/exclusions/{id}`: `{value?, label?, enabled?, updated_at}`; a stale `updated_at` gets 409.
- `DELETE /org/exclusions/{id}`: hard delete; the audit row keeps the old value.
- `POST /org/exclusions/preview`: `{add: [...], remove: [ids], toggle: {id: bool}}`; returns `{before, after}` counts through the same path as
  `data_access.preview` (`BR.matching` then `BR.exact_total`).
- Every write: `audit.record("org_exclusion.added|changed|removed")` then `TP.invalidate(org_id)`.

### 6. Screen: Administration > Exclusions

New tab next to Data access; files `ExclusionRules.jsx`, `exclusionLogic.js`, tests in the style of `administration.test.jsx`. Admins only.

- Add box on top (wraps `ExclusionBox`), rules in one list with a kind label, a switch, delete, and "added by X on date".
- No locked lines: every rule, including "Active companies only" and "Companies House companies only", is a row with a switch.
- Before saving: "Leaves out about N of M companies in your area" from the preview; a warning line when it is over half. Save uses `confirmTwice`.
- Find Leads keeps the "Standing exclusions on" chip, now also lit by organisation rules.

### 7. Phases

Phase 1 (demo): table, policy change, FSB seed and equivalence test, API, screen, tests. Covers searches, counts and the public API.

Phase 2 (after the demo): lists, exports and journeys. Exports and lists read `LeadAccount`, which carries `registration_number` and
`business_record_id`, so a rule check is added there. Journeys: hook into `send_readiness.eligibility` (used by `journeys.before_step`, which
already exits an enrolment as `not_eligible`). Companies already in a list stay and are marked "Left out by your organisation", not deleted.
Also phase 2: postcode, company-number and category rules, a change-history panel from `audit_log`, a template for other customers.

## Admin walkthrough: where it lives and how it keeps working

Where: Administration (the admin screen that already holds Users, Roles and Data access) gets a fourth tab, Exclusions. Only an organisation
admin sees it; the server refuses every `/org/exclusions` call from anyone else, so hiding the tab is not the only guard.

Setting it:
1. Open Administration > Exclusions. A new organisation sees an empty list and the line "Nothing is left out yet". FSB sees its seeded rows.
2. Type or paste into the box: `85200, church, Charity register, Active companies only`. Known words turn into the right kind of rule.
3. The screen shows "Leaves out about N of M companies in your area" before anything is saved.
4. Save, confirm twice (same dialog as the other admin changes). The rules apply at once on this server and within 10 seconds on any other.
5. Later: switch a rule off to pause it, edit its value, or delete it. Each row shows who added it and when.

Keeping it working for the whole organisation: the rules belong to the organisation, not to a person or a search. Every search, count and public
API call from every user in the organisation is filtered on the server, and no screen has a switch to turn them off. New users inherit them
the moment they are created. The "Standing exclusions on" chip in Find Leads tells people the list is active. Every change is written to the
audit log. If the rules cannot be read, searches fail with an error and never show unfiltered data.

## Tests

Equivalence (above); RLS and no-tenant-context read returns the rules; brand-less organisation enforces rules; non-admin gets 403 on each
handler; invalid values give 422 and duplicates are skipped; stale `updated_at` gives 409; the hash changes when a rule is toggled; keep cancels
an organisation word; a sole-trader search finds nothing while `ch_number_only` is on; the brand policy no longer accepts `fsb`, `locked` or
`extra`; a read failure returns 503; the cap; seed step runs twice without duplicating; frontend logic and render
tests.

## Decisions I took (change any)

1. FSB's admin can edit every rule, including the two register checks (your call). Nothing is locked and no FSB rule remains in code.
2. Companies already in lists stay, hidden and skipped (phase 2).
3. No template for other customers until a second customer needs one.
