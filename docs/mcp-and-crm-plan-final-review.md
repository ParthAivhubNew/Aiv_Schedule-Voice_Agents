# Goldfish Review Report

**Target:** `docs/mcp-and-crm-plan-final.md` (lines 1-911)

Plan edited: no. Findings are deduplicated across lenses. Code claims were checked against `backend/app` by the codebase-details reviewer (and spot-checked by design and structural). Compared against `docs/mcp-and-crm-plan-review.md`.

## Reviewer Status

| Reviewer | Status |
| --- | --- |
| `egm-structural` | completed |
| `egm-design` | completed |
| `egm-zoom-out` | completed |
| `egm-implementation-readiness` | completed |
| `egm-codebase-details` | completed (75 tool calls against code) |
| `egm-comprehension` | completed |
| `egm-style` | completed |

Severity breakdown: 3 Blocker, 17 Major, 14 Nit (after dedup).

## Were the earlier blockers and majors fixed?

Mostly yes, on paper and against code. Verified fixed: opt-in `crm:` scopes and the `full_access` carve-out (the `has_scope` claims are accurate), real scope names, separate MCP key kind, hand-written tool table with a never list, in-app approvals replacing echo-back confirm tokens, S0 sign-off gate with G1-G9, own token cipher with key ids, OAuth state nonce/expiry/single use, system-scope claim then write under the claimed row's org, safe HTTP client reusing `_check`, one credit model (release then confirm works as described), decisions table up front, per-phase files/acceptance/tests, scope cut to Salesforce push only, nav group "Setup", problem/non-goals/alternatives sections. The 35-day arithmetic adds up. Section 4 code facts (line numbers, `_SOURCES`, `save_accounts` branches, `declare`, `"save": bool(body.checks)`, `hold` fails open, `_already_charged`) are accurate.

Only partly fixed: "acts as the user with live role permissions" (stated, not enforced: Blocker 2); transport/isolation of MCP keys (Blocker 1); one-job-one-charge (Major 12); "replayed push creates 0 duplicates" (Major 8); reuse of existing loops/job pattern (earlier #12/#30, neither adopted nor rebutted: Major 17). The header claim "Fixes every finding" is therefore overstated.

---

## Blockers

### 1. MCP keys can bypass the tool table by calling `/v1/...` directly - Blocker
* **Reviewer Lens:** `egm-design`, `egm-structural`, `egm-codebase-details`, `egm-implementation-readiness`
* **Affected Scope:** 6.1 (L178), 7.1 (L242, L246), 7.2, 7.7 (L300), 4 (L107)
* **Discrepancy:** Only `/v1/run` is refused for MCP keys. `core/auth_middleware.py` L84-88 `key_may_use` allows every `/v1/*` path for any key. An MCP key with `voice:calls` can `POST /v1/voice/calls`; `leads:search` reaches `DELETE /leads/lists/{id}`; `calendar:book` and `social:write` reach delete routes too. This defeats the "tool table is the only control" claim (L107), the never list, the output caps, `untrusted` wrapping, and G9. The plan's own `_dispatch` re-enters `/v1/...` over ASGI with the same `Authorization` header (run.py L253-263), so simply blocking all of `/v1` would also break MCP, and the plan never says how an inner hop is told apart from an outside call. `_dispatch` also returns an HTTP `Response`, not data, and forwards only a fixed header list (no way to inject MCP's own idempotency key; `run.py` is missing from the 7.1 Modify list).
* **Recommendation:** Refuse MCP keys on every `/v1` path except `/v1/mcp` (in `key_may_use`/middleware). Give the inner call an unforgeable internal marker (an ASGI scope flag set by `mcp.py`, not a header). State where `api_key_usage` is counted once (not twice via `check_rate`), parse the `Response` body, add `run.py` to Modify, allow header injection for the idempotency key, and add acceptance tests: MCP key gets 403 on `/v1/leads/*`, `/v1/voice/*`, etc.

### 2. "Permissions follow the user's live role" is not enforced anywhere - Blocker
* **Reviewer Lens:** `egm-codebase-details`
* **Affected Scope:** 6.1 (L176), 6.2 (L196), 7.7 criterion "demoting blocks within 30 s" (L307)
* **Discrepancy:** The plan puts role permissions into `ctx["perms"]` in `_api_key_ctx`. Nothing in `public_api/` reads `perms`. `authorize()` (core.py L85-100) checks only type, scope and plan. The `P.required/P.allows` checks (auth_middleware L349-351, L369-372) apply to embed and user sessions, not API keys. A demotion changes `ctx["perms"]` and nothing else, so the acceptance criterion cannot pass as designed.
* **Recommendation:** Add an explicit role check in the MCP layer or in `authorize()` using `core/accounts.effective_access`; say where it lives; handle the 30 s cache; define what happens to keys when the owner is deactivated.

### 3. Migration and phase plumbing contradicts M1 (cannot ship M1 as written) - Blocker
* **Reviewer Lens:** `egm-implementation-readiness`, `egm-design`, `egm-comprehension`, `egm-structural`
* **Affected Scope:** 4 (L124), 7.1, 7.8, 10.2 (L644-649), 14
* **Discrepancy:** M1 needs `credit_ledger.key_id`, the `key_scope` stamp, the `api_key_usage` table (and the ledger check in M1 acceptance), but L646-649 put these in the C1 migration; L645 ships only the `api_keys` ALTERs in M1 as `2026_11_27_api_key_kinds`; L124 and the heading at L644 still say a single `2026_11_27_crm_integration`. The C1 id also spans C1a/b/c, and its partial indexes for `crm_outbox`/`action_approvals` would fail if those tables do not exist yet (ordering of `create_all` versus `STEPS` is not stated). `crm.*` acceptance criteria at L301 cannot be tested in M1 since the `crm` plugin arrives in C1c. M2 "Needs C1b" is wrong: `request_crm_push` needs `crm.push.request` (C1c).
* **Recommendation:** List per phase, per migration id, which model, ALTER, index and `TENANT_TABLES` entry lands where. Put `key_id`, `api_key_usage` in the M1 id. Fix the M1/M2 dependencies and move the `crm.*` 403 test to C1c.

---

## Major

### 4. G4 and "every push waits for a person" contradict D12 and auto-push - Major
* **Reviewer Lens:** `egm-comprehension`, `egm-design`, `egm-structural`, `egm-implementation-readiness`
* **Affected Scope:** Summary item 6 (L14), G4 (L147), D12 (L37), L212, L346, L692, L576/L787
* **Discrepancy:** D12 lets an admin switch `require_approval` off for a standard key (then `push.request` returns `{job_id}` directly); C2 `auto_push_activities` sends with no approval. G4 names only workflow rules as an exception. D12 names no route or UI to set the flag and `admin_ctx` refuses API keys.
* **Recommendation:** State one rule ("approval required except X, Y") and list D12 and auto-push as explicit guardrail exceptions the owner signs in S0, or remove D12 (zoom-out: no stated user).

### 5. Contact data leaves through read tools that are not stripped - Major
* **Reviewer Lens:** `egm-codebase-details`, `egm-design`, `egm-structural`
* **Affected Scope:** 7.2 (L255-265), 7.3, 7.7 (L305), G2/G3/G9
* **Discrepancy:** Only `lookup_company` is stripped. `get_search_results` for unsaved searches returns phone and email unmasked (leads.py L379-388). `find_saved_companies` returns saved email, phone, contacts, checks, source. `company_people` returns officer emails and cached web phones/emails even with `include_web=false` (lead_accounts.py L733-775). `list_journeys`, `list_meetings` return "as returned". Up to 500 rows a day per key of unmasked contacts is an AI-driven bulk export against the no-downloads rule. Acceptance covers only `lookup_company`.
* **Recommendation:** Hard output allow-list per tool enforced in `mcp_output.py`; mask contact fields by default (reuse `RV.mask_one`); extend acceptance tests to every tool.

### 6. Per-key limits are bypassable and the counter design is flawed - Major
* **Reviewer Lens:** `egm-design`, `egm-structural`
* **Affected Scope:** 6.1, 6.3 (L200-230), 7.3
* **Discrepancy:** Any user can create unlimited MCP keys, so per-key row/call limits are a per-key bypass; no per-user/per-org aggregate or key-count cap. The counter upsert runs inside the request's `org_scope` transaction, so failures roll the count back (free retries) and concurrent calls serialise on one row lock. `rows_per_day` counts returned rows only, while `find_companies` starts an upstream search job per call (about 43k jobs a day at 30/min). The MCP create route does not refuse callers authenticated with an API key. Spend ceilings sum ledger entries only, but holds live in the credits JSON doc, so concurrent spends pass the ceiling; `key_scope` is not set in background tasks, the CRM worker, or approval execution, so approved spend loses its `key_id`. `check_rate` also counts both the MCP hit and inner hit.
* **Recommendation:** Per-user/per-org ceilings and a live-key cap; counter in a short separate session (check before, add rows after); count search jobs and concurrent jobs; reject api_key ctx on key creation; define `key_scope` propagation.

### 7. Approval execution model is underspecified (affects C1b and M2) - Major
* **Reviewer Lens:** `egm-implementation-readiness`, `egm-design`
* **Affected Scope:** 8.1 (L339), 8.4, 13
* **Discrepancy:** `execute()` runs under `org_scope`/`actor_scope`, fine for `crm.push` service code, but M2 executors are `/v1` routes needing an auth context or key; no executor signature, no payload schema per action, no re-check of the requester's current role and key scopes at execute time; idempotency `"apr:"+id` is meaningless for service code; approver notification/email content and volume are undefined (should be counts and link only, with a per-org flood limit); `preview`/`payload`/`result` hold first-20 records (email/phone) for 400 days and are not in the erasure path (10.8); unique index on `(org_id,key_id,payload_hash)` does not dedupe app rows where `key_id` is NULL; `review_url` base undefined. The 4-day M2 estimate rests on this.
* **Recommendation:** Define executor signature and per-action payload, re-validate requester and key at execute (stale if access lost), set `key_scope`, short retention for preview/payload, fix the NULL index (use `COALESCE`), define notification content.

### 8. Replays and push matching can duplicate or crash - Major
* **Reviewer Lens:** `egm-design`, `egm-implementation-readiness`
* **Affected Scope:** 10.1 (L546-556), 10.2 `crm_links` (L603), 10.9 (L736)
* **Discrepancy:** Matching is by exact email only, so register-sourced companies without email all go to "create"; a worker killed after Salesforce returns but before the `crm_links` write creates a second Lead on retry, so "replayed job creates 0 duplicates" is false for them. Two saved leads sharing an email match one Lead and the second link insert violates the unique `(connection_id, remote_object, remote_id)`; behaviour not defined (suggest `duplicate_local` skip, handling IntegrityError). `LastName = "Unknown"` makes most register leads unusable and should be surfaced in the preview.
* **Recommendation:** Add an external-id or pre-persisted request marker with find-before-create, or exclude emailless records from auto-retry and say so; define the duplicate-local behaviour.

### 9. Opt-out is not read for already-linked records - Major
* **Reviewer Lens:** `egm-design`, `egm-structural`
* **Affected Scope:** Summary (L16), 10.1 step 1 (L546-552)
* **Discrepancy:** A linked record goes straight to update and skips `find_matches`, so CRM-side `HasOptedOutOfEmail`/`DoNotCall` is read only on the email-match path. The promise "read before each push" is broken.
* **Recommendation:** Read flags for linked records too (get-by-id) before every push.

### 10. "Fill blanks, never overwrite" has no adapter method - Major
* **Reviewer Lens:** `egm-implementation-readiness`, `egm-design`
* **Affected Scope:** 9.2 (L458-470), 10.1 (L555)
* **Discrepancy:** `upsert_leads` takes no existing values, `Match` carries only ids and flags, linked updates read nothing. The builder must invent a fetch-then-patch step; unclear whether `last_push_hash` covers the filled result. Also `optout` outbox rows (L630) have no defined creator.
* **Recommendation:** Add `get_leads(ids, fields)` (state this internal read is outside G7) or `Match.fields`; define `optout` row creation.

### 11. Caps, large lists and mid-job cap behaviour undefined - Major
* **Reviewer Lens:** `egm-design`, `egm-implementation-readiness`, `egm-comprehension`
* **Affected Scope:** G5 (L148), 10.5 (L695), 10.9 (L743), 6.3
* **Discrepancy:** Requests are capped at 200 records but `push.preview`/`push.request` take `list_id` (lists can be thousands; lists live in a JSON settings doc). Reject, truncate or chunk is unspecified. Caps are counted from `done` rows only, so two approved jobs can both pass while queued (racy; no reservation). Unclear whether `skipped`/`unchanged` rows and free activities count; whether the 501st record refuses the whole job or only the excess. `push.preview` is `crm:read`, unmetered, makes CRM calls against the customer's quota, and its per-email `ambiguous`/`already_a_contact` counts let a caller probe CRM contents.
* **Recommendation:** Define list resolution and chunking, a reservation counting `queued`+`running`, what counts, and meter/limit previews (no per-email results).

### 12. Credit charge sequence has gaps - Major
* **Reviewer Lens:** `egm-design`, `egm-codebase-details`, `egm-implementation-readiness`
* **Affected Scope:** 11 (L775-780), 10.4
* **Discrepancy:** `confirm()` with a live hold charges the held amount and ignores `quantity`, so the plan releases first, which drops the price-fixed-at-start benefit. Between release and charge the balance can drain after the work is done; end-charge failure behaviour undefined; the end charge skips the monthly-cap check `hold` applies; `hold` fails open so caps may be the only limiter. `hold()` skips refs already charged, so "re-hold on resume" is valid only if charging happens at job end only. `n/5` quantity is undefined (record_count or billable subset). No step for hold-at-resume in 10.4. Job end can fire twice across workers (needs guarded `UPDATE ... WHERE status='running'`).
* **Recommendation:** Specify end-charge failure (e.g. job `unpaid`, block next job), which `n` is held, and where the cap check sits.

### 13. Worker claim, pause and refresh-lock bugs - Major
* **Reviewer Lens:** `egm-design`, `egm-implementation-readiness`
* **Affected Scope:** 10.4 (L673-680), 9.6 (L522)
* **Discrepancy:** The claim increments `attempts` before the paused check, and nothing pushes `next_at` back, so with a 10 s loop and 1 h pause rows hit 6 attempts and go `dead`. The reaper requeues crashed rows with no attempts check, so poison rows loop forever. Token refresh holds `SELECT ... FOR UPDATE` across an HTTP call, contradicting the plan's own rule against transactions spanning external HTTP.
* **Recommendation:** Filter paused connections in the claim query; reaper moves rows to `dead` at `attempts >= 6`; use an advisory lock or short lease for refresh.

### 14. C2 activity dedupe does not work - Major
* **Reviewer Lens:** `egm-design`, `egm-implementation-readiness`
* **Affected Scope:** 10.2 `crm_outbox` (L632), 12 (L787, L798)
* **Discrepancy:** `dedupe_key` includes `job_id`, but auto-pushed activities have no job; replay creates new keys, so "replaying creates none" cannot hold. `requested_by` for workflow-triggered jobs is undefined.
* **Recommendation:** Key activities on `connection:activity:call:<id>` without `job_id`, or define a per-event job and a system requester.

### 15. Scope lists for MCP keys are inconsistent and do not match storage - Major
* **Reviewer Lens:** `egm-implementation-readiness`, `egm-codebase-details`, `egm-comprehension`
* **Affected Scope:** 6.2 (L186-198), 7.2, 13 (L819), L264
* **Discrepancy:** `AVAILABLE_SCOPES` has no `calendar:book`, `social:write` or `email:write`, yet the MCP allow-list uses them, and the existing update validation filters by `AVAILABLE_SCOPES`, so the MCP route needs its own validation. `BUNDLE_SCOPES` expands `leads:search` to `email:write`/`email:approve` and `social:publish` to `social:write`/`social:approve`, so the MCP create route must store exact scopes with no bundle expansion. `_api_key_ctx` L450 also treats empty scopes as `full_access` and needs the same kind carve-out (specified only for `has_scope`). `crm:read` on an MCP key gives no tool (G7), `approvals.get` needs no scope though `crm:read` is said to show approvals, `social:approve` "until M2" is never added, `list_posts` needs write-class `social:write`.
* **Recommendation:** One allowed/forbidden scope table per phase; exact-scope storage; carve-out in `_api_key_ctx`.

### 16. 8.2 contradicts the never list and M2; M1 "nothing changes" is not literally true - Major
* **Reviewer Lens:** `egm-comprehension`, `egm-implementation-readiness`, `egm-design`
* **Affected Scope:** 8.2 (L348), 7.2 (L267), 7.4 (L279), M2 (L810-819)
* **Discrepancy:** 8.2 says MCP can send email, start a call, publish with approval; the never list and M2 exclude them. `find_companies` creates a search job though L279 says no tool can change anything; `find_companies_with_checks` spends up to 25 credits unapproved while 7.4 says spend/bulk needs approval. Chat-assistant approval card appears live (L346) but is built in C2. `draft_post`'s Social approval is a different mechanism from `action_approvals`.
* **Recommendation:** Align 7.2, 8.2 and M2; reword L279; state the chat card is C2.

### 17. Weight and reuse: approvals, key layer, outbox are heavy for the goal (zoom-out) - Major
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:** 8 (L323-389), 6.1-6.3, 10.4, 14
* **Discrepancy:** A generic approvals subsystem (20-column table, executor registry, stale/10% logic, sweeps, new view) is built though only CRM push is in C1 and the app's own button self-approves; M1 (read-only, 0 credits) carries credit columns, `key_scope`, `key_id` stamping that only matter from M2; `crm_jobs` and `crm_outbox` overlap and a bespoke `crm_loop`/`SKIP LOCKED` is used without checking `PublicObject` + `_run(org,id)` or `connections_loop` (earlier #12/#30 neither adopted nor rebutted); token re-seal pass and 7-day kid rule are premature; per-tool caps duplicate the daily row counter. Estimate went from 52 to 42 although scope was cut; a lean slice is possibly about 25 days. Reuse candidates: `Notification` (models.py L502), `EmailApproval` (L1401), `PublicObject` (L2181).
* **Recommendation:** Either justify these in the plan or defer: credit columns/ledger stamping to M2, approvals generality to when MCP/API push ships, per-record outbox to C2, rotation machinery to first rotation.

### 18. Supporting infrastructure missing: key-creation UI, sweeps, `ENV` guard, library choice - Major
* **Reviewer Lens:** `egm-design`, `egm-codebase-details`, `egm-implementation-readiness`
* **Affected Scope:** 6.1 (L180), 7.1 (L241, L247), 9.3 (L490), 7.5, 10.7
* **Discrepancy:** No frontend to create MCP keys (routes only). Four sweeps (`api_key_usage`, approvals expiry/deletion, OAuth states, daily re-seal) have no home outside `crm_loop`, which runs only when `crm.enabled()`, yet the `api_key_usage` sweep is needed in M1. There is no `ENV` setting in the repo (config.py has only the `SECRET_KEY` default), so the production guard at L490 never fires; compare against the known default unconditionally or add a real flag. MCP library choice (SDK vs 200-line fallback) is left to the builder; `tools/list` per-request filtering, GET handling and SSE-vs-JSON mode are unstated. `CRM_ENABLED` (L651), `CRM_TOKEN_KEYS`, `CRM_TOKEN_KID` relationship is undefined. No MCP tool input schemas, cursor format, `more_available` or `untrusted` layout are given ("as returned" is not a shape).
* **Recommendation:** Add the key-management screen, name the sweep loop, fix the guard, decide the library after a dated spike, give tool schemas, define the enable flags.

### 19. Token sealing details and OAuth `return_to` - Major
* **Reviewer Lens:** `egm-design`, `egm-implementation-readiness`
* **Affected Scope:** 9.3 (L476-488), 9.5 (L506, L514)
* **Discrepancy:** AAD uses `connection_id` but the state row (with the sealed `code_verifier`) is written before a connection exists; Salesforce refresh tokens do not rotate, so only the daily pass re-seals; no backup/recovery story for `CRM_TOKEN_KEYS` (loss orphans every connection); `token_kid` column and the in-string kid can diverge; `return_to` has no validation (open redirect). `standard-key admin` (L685-690) is undefined since a standard key's `is_admin` is `"full_access" in scopes` and `crm:write` is opt-in: check the creator's live role instead. `safe_fetch._check` is `async`.
* **Recommendation:** Generate `connection_id` first; drop one kid location; add recovery note; allow-list `return_to` to relative in-app paths; define the admin check.

### 20. Wrong cross-references and header overclaim - Major
* **Reviewer Lens:** `egm-style`, `egm-comprehension`, `egm-design`
* **Affected Scope:** L4, L52, L110, L116, L104-105, L289, L490, L773, L845
* **Discrepancy:** L52 and L116 point to "section 13" (M2) for entry rules and pull path, which are in section 15; L110 points to 10.6 for connect (it is 10.5). Body text references "the review", "the draft" that a fresh reader does not have (history belongs in section 17). Header "Fixes every finding" is not backed (see above).
* **Recommendation:** Fix references, move history to section 17, reword to "addresses".

---

## Nit

### 21. Decision table order and counts - Nit
* **Reviewer Lens:** `egm-comprehension`, `egm-style`
* D numbers are out of order (D1, D3, D9, D2...), carried over from the draft without explanation. "Only three need the owner" (L22, L39) versus an extra SECRET_KEY item and a five-item checklist (L155-159). "S0, D9" redundant in section 14.

### 22. Label collisions - Nit
* **Reviewer Lens:** `egm-style`, `egm-comprehension`
* "L1-L9" (Later items) collide with line-number cites (L225, L1730). Rename (for example LT1). Phase labels C1a-C1d are used from L103 but explained only in section 14; R1 referenced at L496 before definition at L526. Sections 12-13 lack `---` and H3s; section 8 (C1b) precedes section 9 (C1a).

### 23. Evidence markers and undefined terms - Nit
* **Reviewer Lens:** `egm-style`, `egm-comprehension`
* "From memory", "recalled as", "name unverified" versus the single "unverified" promised at L5. Undefined: MCP (never expanded), `aiv_pytest`, "staff", embeds, `reach_other_way`, `actor_scope`, `effective_access`, "FULL on the section", `Identity`, `FieldInfo`. "org" versus "organisation".

### 24. Subjective wording - Nit
* **Reviewer Lens:** `egm-style`
* "match carefully", "conservative", "thin", "simpler and cannot be gamed" (L773), "makes repeats harmless", "plain" as filler, "Safe HTTP client" (use "restricted-host"). L39 "one thing ops can see and the repo cannot" is awkward.

### 25. Redundancy and density - Nit
* **Reviewer Lens:** `egm-style`, `egm-zoom-out`
* Section 17 repeats the Summary; glossary repeats prose definitions; dense table cells at L102, L114, L117. Build-time detail (dataclass bodies, SQL, cookie flags, 7 DDL tables, full pull path for a deferred item, G7/G8 trivially satisfied) could move to an appendix. R1 items 7 and 8 can be learned during build.

### 26. Code-fact corrections - Nit
* **Reviewer Lens:** `egm-codebase-details`
* L105: "full_access key is admin today" is true only for legacy rows; `create_api_key` (developer_keys.py L183-187) expands `full_access` to concrete scopes. L294: the real sandbox `company.lookup` return is `{"matches": [], "matched_by": "", "simulated": True}` (leads.py L653). `wallets:read` is not enforced anywhere on the route (plan says MCP checks it: fine, but note it). `crm_record_sync` has no entry in `DEFAULT_UNIT_COSTS_USD_CENTS` so the margin view shows 0 cost.

### 27. Email allow-list ambiguity and field mapping - Nit
* **Reviewer Lens:** `egm-codebase-details`
* 10.3 Email rule: `consent_basis` is exactly how a sole trader becomes contactable (models.py L1659-1665), yet the plan says no override; `quick_choice` is unhandled. `region` is not necessarily a city (maps to `City`). Country restricted-picklist skip silently drops data; surface it as a preview skip reason. For L1, `origin="pulled"` needs a `policy.py` check at push time.

### 28. Retention and risks table - Nit
* **Reviewer Lens:** `egm-design`
* `crm_outbox` has no retention sweep. No "stolen MCP key" row in risks. Skill-is-advisory claim depends on closing Blocker 1. FORCE RLS / app role ownership still unchecked (L132).

### 29. Missing test/acceptance items - Nit
* **Reviewer Lens:** `egm-design`
* Add: MCP key 403 on `/v1/leads/*`; key creation by an api_key ctx refused; stale-tab approve; middleware running twice via ASGI (double `last_used_at` and cache writes).

### 30. Tool table scope - Nit
* **Reviewer Lens:** `egm-zoom-out`
* `list_journeys`, `list_meetings`, `list_posts`, `credit_balance` have no stated need in M1; the 4-pages-per-`q` and 100-per-search rules add test surface for little protection.

### 31. Pre-existing facts the plan could use - Nit
* **Reviewer Lens:** `egm-zoom-out`
* `Notification`, `EmailApproval`, `PublicObject` already exist and are not referenced for approvals/jobs.

### 32. Sign-off wording - Nit
* **Reviewer Lens:** `egm-design`
* S0 should treat the lost no-downloads rule wording as a hard blocker on G1-G9, not only on D1.

### 33. Preview and UI messaging - Nit
* **Reviewer Lens:** `egm-implementation-readiness`
* `sk_test_` `push.request` "executed approval": say whether a row is stored. Define notification payload shape and email template.

### 34. Cross-phase ordering of sections - Nit
* **Reviewer Lens:** `egm-structural`
* Sections run M1, approvals (C1b), CRM foundation (C1a), C1 (c/d), C2, M2 and do not follow the build order.

---

## Verdict

Not ready to build as written. Fix the 3 blockers (MCP key isolation on `/v1`, live-role enforcement, per-phase migration plumbing) and the contract-level majors (4, 5, 8-10, 14, 15) first; the rest can be settled in a short revision pass. M1 could start once Blockers 1-3 and Majors 5, 6, 15, 18 are fixed. C1 should wait for S0 and Majors 7-14.
