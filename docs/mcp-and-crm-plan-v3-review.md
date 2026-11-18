# Goldfish Review Report: mcp-and-crm-plan-v3

**Target:** `docs/mcp-and-crm-plan-v3.md` (782 lines, full document)
**Prior review checked:** `docs/mcp-and-crm-plan-final-review.md` (3 blockers, 17 majors)
**Date:** 2026-11-18. The plan was not edited.

## Reviewer Status

| Reviewer | Status |
| --- | --- |
| `egm-structural` | completed |
| `egm-design` | completed (checked against code) |
| `egm-zoom-out` | completed |
| `egm-implementation-readiness` | completed |
| `egm-codebase-details` | completed (read the real code) |
| `egm-comprehension` | completed |
| `egm-style` | completed |

## Verdict

- **Prior findings.** All 3 prior blockers are fixed in design. Of the 17 majors, 14 are fully fixed. Three are only partly fixed: credits (12), caps (11) and the worker (13). Those three are the source of the new C1 findings below.
- **M1 (MCP) can start**, once the D3 numbers are recorded. Build only after fixing B1 below, which is a small plan edit. D1 gates shipping M1, not starting it.
- **C1 (Salesforce) cannot start.**
  - S0 (D1, D3, D9) is unsigned.
  - R1 (Salesforce facts) is unresolved, and the plan counts it both "before C1" and inside C1's 12 days.
  - C1 depends on M1 pieces while the plan says it does not (B2).
  - The credit and cap design has gaps (B3).
- **The 25-day figure is not credible.** The estimates were M1 14-18, C1 20-25 and C2 4-5, roughly 38-45 in total. The plan's own "+20% = 30" is still too low.
- The plan's cited code lines are accurate. The codebase reviewer confirmed the `auth_middleware`, `run.py`, `credits.py`, `main.py` and migration references.

## Prior findings status

| Prior item | Status |
| --- | --- |
| Blocker 1, MCP key reaches every `/v1` path | Fixed in design (kind, path check, hop secret, `run.py` `extra_headers`). One residual hole: B1. |
| Blocker 2, live role not enforced | Fixed (`effective_access`, 30 s cache, owner-inactive and null-owner refusal). Gap: M2. |
| Blocker 3, migration plumbing | Fixed. One id per phase, with `create_all`, `run_migrations` and `ensure_tenancy` in the right order. Test claim is wrong: M6. |
| Majors 4, 5, 7, 8, 9, 10, 14, 15, 16, 17, 18, 19 | Fixed. |
| Major 5 (contact data leaks) | Fixed in intent, but the field names do not match the real routes (M3). |
| Major 6 (limits bypass) | Mostly fixed. Residuals in M9. |
| Majors 11, 12, 13 (caps, credits, worker) | Partly fixed. See B3, M10, M11. |
| Major 20 (cross-references) | Not fixed. Several are still wrong: M14. |

## Blockers

### B1. MCP key restriction: the hop marker opens every `/v1` path, and tool ids are not validated (M1)
- **Lenses:** design, codebase-details
- **Scope:** plan 6.1 (L162-170), 6.6 schemas (L256-265), `public_api/run.py` L246-263
- **Gap:**
  - With a valid marker the middleware lets an MCP key reach any `/v1/...` path.
  - The only limit is the path `_dispatch` builds. `_dispatch` rejects `/` and `?` in an id but not `..`, `%2F`, `%2e%2e` or `#`.
  - `get_search_results` and `company_people` take free-string ids.
  - A prompt-injected AI could send `..` and reach `/v1/leads` (`lead.list`). That bypasses the tool table and its input rules. The marker lets it through.
- **Fix:**
  1. `mcp_tools.py` exports the exact `(method, path-pattern)` set. The middleware accepts the marker only for those.
  2. Put `^[A-Za-z0-9_-]{1,64}$` on every id in the schemas.
  3. URL-quote ids in `_dispatch` and reject `.`, `%` and `#`.
  4. Add acceptance tests for `..`, `%2e%2e`, `%2F` and `#`.
- **Related, Major:** an acceptance test should enumerate every registered `/v1` route and assert that an MCP key gets 403 on all except `/v1/mcp`. Today the list names only some paths.

### B2. C1 depends on M1 artefacts, but the plan says "M1 is not required" (C1)
- **Lenses:** implementation-readiness, structural, zoom-out
- **Scope:** plan L355 and 7.1; 7.6 L484, 7.10 L586, 7.11, 7.1 `enabled()`, L706 (parallel claim), L716 (LT1)
- **Gap:** C1 uses these M1 pieces:
  - the `api_key_usage` table (preview metering)
  - the `key_scope` contextvar (worker)
  - `housekeeping_loop` (retention sweeps)
  - the `ALLOW_INSECURE_DEV` guard (`crm.enabled()`)
  - the M1 migration `2026_11_27_mcp_keys`

  Both tracks also edit `main.py`, `models.py`, `migrations.py`, `auth_middleware.py` and `tenancy.py`.
- **Fix:** name a shared foundation slice (guard, `housekeeping_loop`, `api_key_usage`, `key_scope`, about 0.5 to 1 day) that C1 requires. Or drop those uses from C1. Correct L355 and the "can run in parallel" claim.

### B3. C1 credits, caps and worker: the design has gaps that cause overspend and duplicate work (C1)
- **Lenses:** design, codebase-details, implementation-readiness, structural
- **Scope:** plan 7.7 (L505-511), 7.9, 7.10 (L584-589), section 12
- **Gaps (each is a Major on its own; together they block C1):**
  1. **`W >= b` is asserted, not enforced.**
     - `W` is computed at job creation. The worker re-reads the CRM and re-runs the gates.
     - A record unchanged at preview time can need a patch later, so `b > W` is possible.
     - Then the final charge, the monthly cap and `reserved` are all exceeded.
     - Fix: stop writing once `created + updated` reaches `reserved`, and mark the rest `over_reserved`.
     - Also state that `POST /api/crm/push` recomputes `W` server-side and ignores any client count. Say what happens if it differs from the preview.
  2. **`credits._take` never raises on a short balance** (`credits.py` L378-381).
     - It books the shortfall as org debt. The `unpaid` path will almost never fire, and the "unverified" item in section 12 is now answerable.
     - Restate 7.7 around debt, with `unpaid` triggered by negative balance or debt.
     - Reuse `_OWED`, `pay_owed` and `confirm_safely` (L584-610).
     - `_already_charged` is private. Use `charged_recently` or accept the import.
  3. **Ordering of reservation and hold is unspecified.**
     - `hold()` fails open and does `db.rollback()` on internal error (L523-529).
     - If it shares the reservation transaction, the job row and reservation are silently dropped.
     - Fix: commit the `queued` job with `reserved` first. Then call `hold` in a separate step. If the hold is refused, mark the job `cancelled` and set `reserved` to 0.
     - The end step must also say how it detects "no hold exists".
  4. **The cap sum covers only `queued`, `running`, `done` and `unpaid`.**
     - A `dead`, `failed` or `cancelled` job that already wrote records frees its room.
     - Dead or failed jobs release the hold, so partial sends are free even though created records are billable (L506).
     - `paused` and `failed` are in the status enum, but nothing sets them.
     - Fix: set `reserved` to the real billable count on every terminal state. Remove the unused statuses or describe the transitions. Decide whether a failed or dead job is charged.
  5. **The worker lease is too short for its work.**
     - A 5-minute lease is extended only per 50-record batch. A batch makes several CRM calls, each with a 30 s timeout, plus the 2 s refresh wait.
     - A slow batch can outlive the lease, so the reaper requeues a job a live worker still runs. That causes double patches and double charges.
     - The loop appears to process a job inline, which blocks claims, the reaper and C2.
     - Fix: heartbeat before each HTTP call. Check lease ownership before every progress write. Run each job as its own task with a concurrency cap.
  6. **Retry accounting.** The claim increments `attempts`. "Re-queue without counting an attempt" on a 429 needs an explicit `attempts - 1`.
  7. **Stranded jobs.**
     - Jobs behind a `needs_reauth` or `disconnected` connection stay `queued` forever.
     - They keep counting toward caps and keep holding credits. The hold TTL is 6 hours.
     - Fix: cancel and release after N days, and on disconnect.

## Majors

### M1. 25-day estimate is not credible (zoom-out, implementation-readiness)
- **Scope:** plan section 9, 6.15, 7.16, 8
- M1 at 10 days is thin: it carries key kinds, a hop secret, a live-role check, a new counter table, a JSON-RPC handler, 8 tools with output filters, a React screen, a ledger migration, sweeps and a package. A realistic estimate is 14-18 days.
- C1 at 12 days carries OAuth with PKCE, sealed tokens, an SSRF-restricted client, a 12-method adapter and a Fake, a worker with a reaper, credits, caps, four tables, UI states, an admin screen and erasure. It also absorbs six Salesforce unknowns and a first live integration. A realistic estimate is 20-25 days.
- C2 at 3 days is more like 4-5.
- "No buffer" is not a plan. About ten unverified facts feed the estimate (section 12).
- **Recommendation:**
  - Quote ranges: M1 14-18, C1 20-25, C2 4-5.
  - Give two separate commitments, because M1 and C1 are independent deliverables with different risk.
  - Make R1 a timeboxed spike done before committing to C1.
  - Remove "no buffer".

### M2. Live-role check ignores view versus full (codebase-details, design)
- **Scope:** plan 6.2 step 3; `core/permissions.py` L16-18, L63-66, L164-167
- The plan refuses only when the level is `none`. The real levels are `none`, `view` and `full`, which resolves the "middle level names" item in section 12.
- `find_companies` is a POST that creates a job. A Viewer role could start searches through MCP, which the app refuses.
- **Fix:**
  - Map `find_companies` to FULL on `leadgen` and the read tools to VIEW.
  - Cache the full `effective_access` result and look up the section per call.
  - Hook the cache into the existing `auth_middleware.forget(operator_id)`. It is already called on role and disable changes, so same-worker changes apply at once.
  - State that a null `created_by_id` on an MCP key is a hard refusal.

### M3. Output allow-list field names do not exist in the route outputs (codebase-details, implementation-readiness)
- **Scope:** plan 6.6, 6.7; `leads.py` L329-346, L630-639
- `_lead()` returns `industry`, `address`, `postcode`, `website`, `phone`, `email`, `registration_number` and `status`.
- `_company_card` returns `industry`, `domain`, `website` and `saved` as an object `{id, stage}`.
- No route emits `sector`, `region`, `country`, `has_email`, `has_phone`, `eligibility_group` or a boolean `saved`.
- **Fix:**
  - Add one mapping table: tool input, route body, response field, output field.
  - Say which values need a second database read.
  - Add a test that fails when a mapped source key is missing.
  - Do the half-day spike before writing `mcp_tools.py` and `mcp_output.py`.
- Input names are already known, so section 12 can shrink:
  - `SearchIn` has `keyword`, `sector`, `sic_codes`, `towns`, `postcode_prefixes`, `limit` (max 200), `contacts` and `checks`.
  - There is no `query` or `country`, and the route returns 422 `need_a_filter` without a filter.
  - `lookup` takes `domain` and `name` (name capped at 120), not `website`.

### M4. `list_calls` does not match the Voice goal (codebase-details)
- **Scope:** plan 6.6 and Goal 1; `voice.py` L210, L295-297; `calls_view.py` L69-94
- `voice.call.list` returns only `call_meta` objects, which are written only by `POST /voice/calls`. Ordinary app calls never appear.
- MCP cannot place calls, so the tool shows only calls made by standard keys.
- There is no `summary` field. `load_call` returns `answers`, `transcript` and `outcome`, and `to` when a brief exists. `answers` is free text from contacts.
- **Fix:** build a real call-log read, or drop the tool and the Voice claim from M1. Define "short summary" from real fields.

### M5. `find_saved_companies` is an email-search oracle (codebase-details)
- **Scope:** plan 6.6, 6.7; `leads.py` L525-527
- `list_leads` filters `name | domain | email` with `ilike`. An AI can grow a substring one character at a time and recover email addresses from which names match, though addresses are never returned.
- Zero-row results add nothing to `rows`, so the row cap does not help. The call cap allows 30 calls a minute per key.
- **Fix:**
  - Post-filter in `mcp_output` so matches count only on name or domain.
  - Or reject `q` containing `@` or digits.
  - Count empty results against a separate limit.

### M6. The proposed `TENANT_TABLES` test cannot pass (codebase-details, design)
- **Scope:** plan 6.12 and 7.15
- "Every model with an `org_id` column is in `TENANT_TABLES`" fails on day one. `Operator` (models L31), `ApiKey` (L117, deliberately read cross-org under `system_scope`) and others at L82, L755, L2120, L2138 and L2249 are not in `tenancy.py` L35-54.
- **Fix:** use an explicit exempt list with reasons.
- Test fixtures run `create_all` and `ensure_tenancy` only (`conftest.py` L48-55). The migration step (ALTERs, partial index) is never exercised. Add a test that runs `run_migrations` on a legacy-shaped database.
- State that the `kind` and limit columns use `ADD COLUMN IF NOT EXISTS ... NOT NULL DEFAULT 'standard'`, and that the step is idempotent.

### M7. Hop secret check can raise a 500; `/v1/mcp` auth-source claims are false (design)
- **Scope:** plan 6.1 L169, L221; `_token_from` in `auth_middleware.py`
- `hmac.compare_digest(str, str)` raises TypeError on non-ASCII input, and headers are decoded as latin-1. A non-ASCII hop header gives a 500.
- **Fix:** compare bytes. Add a non-ASCII value to the "guessed marker" test.
- The claim "Authorization header only" is untrue: `x-api-key` and `api-key` are also accepted. Reject those on `/v1/mcp` or correct the claim.
- The claim about a `?token=` refusal is also inaccurate. The real parameter is `access_token`, accepted only for a short list of media paths.
- The hop header reaches every inner handler. Check that `public_api_audit` and logging do not record headers.

### M8. G4 "no key can start a push" depends on a config flag the tests never cover (structural)
- **Scope:** plan L99, 7.11 L599, 7.14 L634; `auth_middleware.py` L79-88
- With `API_KEY_V1_ONLY=false`, `key_may_use` returns True for every path. A standard key, which acts as an admin, could reach `/api/crm/push`.
- **Fix:**
  - `api/crm.py` handlers assert `ctx.type != "api_key"`, as the MCP key-create route does.
  - Add a test with the flag off.
  - Fix the L99 wording.

### M9. Limits table residuals (design, comprehension, implementation-readiness)
- **Scope:** plan D3, 6.3 (L196-213, L242)
- The per-user "60 calls" has no period in D3. 6.3 says per minute. State the periods, and where the defaults live. The per-user limits are constants, because no column holds them.
- "Overshoot by at most 25 rows per call in flight" is really 25 times concurrent calls, up to the 30 per minute limit. The "501st row gets 429" test cannot be exact.
- Over-limit calls still increment, because the upsert runs before the check. Check first, or document it.
- Four upserts per call (key and user, minute and day) are not listed, and the counter session scope (`org_scope`) is not named. Add a short pseudocode block.
- The "100 rows per search" cap has no storage and no test. Drop it or add it.
- The `find_companies` idempotency key includes the minute. A retry across a boundary creates a second search. Use a longer window or drop the minute.
- `company_people` is a POST, so it counts against the 30 per minute write bucket. It can also refresh from the registry and commit.
  - Say "no credits, no customer data changed" rather than "cannot change data".
  - The tool chain also breaks: `company_people` takes a `BusinessRecord` id, but `find_saved_companies` returns `LeadAccount` ids.
- The `api_key_usage` bucket enum allows `min` and `day` only. C1 preview metering (30 an hour, subject `org:<id>:crm_preview`) needs an `hour` bucket, or a separate counter.
- Say that a fixed minute window allows 2x bursts at the boundary.

### M10. Reconnect and connection-id semantics are undefined (implementation-readiness)
- **Scope:** plan 7.3 L426, 7.5, 7.8 (unique `(org_id, provider)`)
- It is not specified what happens when a row exists in `needs_reauth` or `disconnected`, or when the user connects a different Salesforce org.
- Open questions: is the row updated or replaced, which id seals the new tokens, and do `crm_links` carry over?
- **Fix:** specify upsert versus replace. Mark links `unlinked` when `external_org_id` changes.

### M11. Erasure flow cannot work as written (structural)
- **Scope:** plan 7.11 L602
- `crm_links` has no email column, and the local `LeadAccount` is gone after delete. The adapter Protocol has no delete method, and `POST /api/crm/erase` has no body.
- It is a CRM-side delete outside the guardrails and the S0 checklist, so the owner does not sign it. The Salesforce delete call is unverified.
- **Fix:** store an email hash on the link. Add `delete_lead` to the Protocol. Add the exception to G4/G7 and the S0 checklist. Or defer erasure out of C1.

### M12. C1 policy and mapping rest on unverified lookups (implementation-readiness, codebase-details)
- **Scope:** plan 7.3 L431-446, section 12
- `LeadAccount` field names, the eligibility function in `services/eligibility.py`, the `quick_choice` consent mapping and the `sanitize()` import are not pinned.
- The mask format is now answerable. It is an empty string plus `held` and `closed` flags (`reveals.py` L27-40), not a masked-looking string. The G3 wording "masked-looking values are skipped" is wrong. The policy must check for blank and unopened registry values.
- **Fix:** name the functions and fields. Default `quick_choice` to "not ready" if unsettled.

### M13. C1 contract and file-list gaps (structural, implementation-readiness)
- **Scope:** plan 7.1, 7.2, 7.11
- Eleven routes have no request or response schemas. This covers `return_to`, `record_ids` versus `list_id`, `unknown_last_name`, job shapes and settings PATCH. Which check enforces "full Leads access" is not given.
- The outcome vocabulary is incomplete. `UpsertResult.outcome` lacks `flags_only`, `needs_check`, `duplicate_local`, `ambiguous`, `already_a_contact` and the skip reasons. The `progress` JSON has no defined key set. Add one enum table.
- The 7.1 Modify list omits:
  - `services/credits.py` (rate card)
  - `config.py`
  - `services/connections.py` (whether `source="crm"` is accepted is unverified)
  - `services/embed.py` and `core/tenancy.py`
  - the admin-portal route files
- C2 has no Files, Migration, Acceptance or Estimate layout.

### M14. Broken cross-references; the plan claims they were fixed (structural, comprehension)
- The startup guard is cited as 7.3 (L40, L308). It is in 6.11.
- "One id scheme (6.8)" should be 6.12 (L108). "housekeeping_loop (6.8)" should be 6.11 (L109). 6.8 is prompt-injection controls.
- G5 cites 7.6 (L131). It should be 7.9.
- "M2 only adds ceilings" (L230), and M2 is never defined as a phase. Use LT1 or define M2.
- `LT6`, `R1`, `W` and `b` are used before they are defined.
- Section 13 item 5 says "four tools are cut". 6.6 names three.
- The summary says an MCP key can call "`/v1/mcp` and nothing else". 6.1 also allows `/v1/...` with the marker. Say "for outside callers".

### M15. Status and gating are muddled (comprehension, structural, style)
- **Scope:** plan L3, L22-40, section 5
- "Ready to build after owner sign-off" is true for M1 and overstated for C1. The plan also lists about ten unverified items.
- "Three need the owner" conflicts with the four-item S0 checklist (D1, D3, D9 and the `SECRET_KEY` ops check).
- **Fix:** add one gate table with columns Start M1, Ship M1 and Start C1.

### M16. Acceptance test contradicts the caps (comprehension)
- **Scope:** plan 7.6, 7.9 and acceptance
- "A list of 1,500 records is accepted as one job within the caps" conflicts with the 500 per day cap.
- Fix the test, or say that skipped and unchanged records do not count toward caps.

### M17. Simplification candidates (zoom-out)
Cuts that would save about 4-6 days in C1 and 2-3 days in M1:
- **C1:**
  - key-id rotation format
  - the monthly cap and 80% alerts
  - the `needs_check` and `sending` machinery
  - fill-blanks patching
  - the admin-portal health list and erasure
  - preview metering
  - trim the 12-method Protocol
- **M1:**
  - the ledger `key_id` and `key_scope` stamp, which M1 does not use and which belongs to LT1
  - the per-key limit columns (nothing sets a non-default)
  - the regex output scan
  - separate `MCP_ENABLED` and `ALLOW_INSECURE_DEV` flags
  - the agent package, which should leave the estimate
- **Trust boundary.** The three-part carve-out (kind check, `key_may_use`, `has_scope` rule) is fragile. Prefer a separate auth path, and add the route-enumeration test.
- **Document altitude.** SQL, dataclass bodies and cookie flag lists belong in an appendix.
- **Demand.** Section 1 does not say which customer asked for MCP or Salesforce. LT3 sets a stricter bar than the one used here. Consider shipping M1 first and gating C1 on a named customer.

### M18. Smaller M1 and C1 items (codebase-details)
- The SECRET_KEY guard ignores `security.PUBLIC_DEFAULT_KEYS` and `configured_key_is_public()` (`security.py` L39-45, L105-106).
  - It misses `SECRET_KEY=""`, because `os.getenv` returns "" when set empty.
  - Test env uses `test-secret-key` (15 characters), so reuse would trip it and need `ALLOW_INSECURE_DEV`.
- MCP keys use SHA-256 and do not use `SECRET_KEY`, so refusing MCP on a default key has no technical reason. Keep the guard for CRM only.
- "No CORS headers on this path" is false. `CORSMiddleware` allows `*` with credentials (`main.py` L940-946). Make CORS path-aware or drop the claim.
- `Notification` has no recipient column (`models.py` L502-512). "Notify the requester" is org-wide, so keep counts out of the text.
- `has_scope` starts with `set(ctx.get("scopes") or ["full_access"])` (`core.py` L72). The MCP branch must come before it. `auth_middleware.__call__` already uses a local named `kind` (L292).
- Admin `GET` and `PATCH /developer/keys` are not kind-aware (`developer_keys.py` L132, L231). Filter or label by `kind`.
- CRM app secret "sealed the same way": `secret_box` falls back to a different hard-coded string. State which cipher and that there is no fallback to `SECRET_KEY`.
- Embed token on `/v1/mcp` is not in the acceptance list.

## Nits

- **LT1 approvals.**
  - The `PublicObject` approval id (`apr_` plus hash) collides after a decision. Add a nonce, or rewrite the row.
  - `public_objects.kind` (`models.py` L2187) needs `approval` added.
- **Activity payload.**
  - The C2 Task payload has no allow-list and no `sanitize()` (G2 covers Lead fields only).
  - C2 rows have no audit under G6.
- **Review history.**
  - Section 13 is review history. Move it out. It also cites "42 to 25" from a document the reader lacks.
  - L38 ("D12 is dropped") contradicts "history wording removed".
  - Section 13 claims cross-references and evidence markers are unified. They are not: "recalled" and "(unverified estimate)" still appear.
  - Section 12 omits several unverified items, such as the LT1 5-6 day estimate.
- **Naming and style.**
  - The D-number order is unexplained beyond a one-line note.
  - Name "hop" in the glossary, and use "product owner" rather than a personal name.
  - Remove the hedge from the "section level" glossary entry.
  - The title omits C2, and "plugins" in the Problem statement includes Social, which M1 lacks.
  - Section 8 has no H3s, and sections 10-13 lack `---` separators.
  - Several long table cells (the 13-file row, G4, L241, L436-441, L509-510) would read better as paragraphs or lists. Dense paragraphs at L473, L584 and L736 should become lists.
  - Replace slogan wording ("Poison jobs cannot loop forever", "Strict allow-list, not a filter") with factual statements.
- **Config consistency.**
  - `crm.enabled()` has two conditions in 7.1 and three or four in 7.8. Use one version.
  - `MCP_ENABLED` returns 404, while the guard returns 503. Tabulate both.
  - Migration ids carry future dates (`2026_11_27` onward). Say they are ordering names, not schedule dates.
  - `last_used_ip` is cited but never added.
  - `last_used_at` is written twice per hop.
  - Missing JSON-RPC error mapping and 503 shape.
- **Code reuse and environment.**
  - `workflow_loop` already prunes hourly under `system_scope`, an alternative to a new `housekeeping_loop`.
  - Deployment runs a single `uvicorn` process, so multi-worker is not needed today.
  - `key_may_use` and the org-suspension check are absent on the API-key path (pre-existing).
  - `meeting.booked` has no top-level `id`, so the DB dedupe key is correct.
  - About ten "carried" facts (`secret_box`, `safe_fetch`, `save_accounts` limit, `emit` memory) should be re-read before build.
- **Facts the code now answers (update section 12).**
  - `_take` never raises.
  - Section levels are `none`, `view` and `full`.
  - `alert_staff` and `set_rates` exist, and the key screen is `settings/DeveloperApiKeysModal.jsx`.
  - The `leads.lookup` sandbox shape is confirmed.
  - `connections` signatures match.

## Ranked summary

**Blockers**
1. B1, hop rule plus unvalidated ids lets an MCP key escape the tool table (M1).
2. B2, C1 depends on M1 pieces while the plan says it does not (C1).
3. B3, C1 credits, caps and worker design gaps (C1).

**Top majors**
- M1 estimate (38-45 days, not 25)
- M2 view versus full
- M3 and M4, tool outputs and `list_calls` do not match the real routes
- M5 search oracle
- M6 test that fails on day one
- M8 G4 flag hole
- R1 and S0 gates for C1
- M10 and M11, reconnect and erasure

**Gate answers**
- **M1 start:** yes, after D3 is recorded and B1 is written into the plan. Do the half-day route and field spike first. D1 gates shipping.
- **C1 start:** no. Close S0 (D1, D3, D9), resolve R1, fix B2 and B3, and settle M10, M11 and M12. Then re-review.
