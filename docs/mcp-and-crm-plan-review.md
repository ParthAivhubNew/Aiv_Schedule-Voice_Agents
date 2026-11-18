# Goldfish Review Report

**Target:** `docs/mcp-and-crm-plan.md` (lines 1-130)

Plan edited: no. Findings are deduplicated across lenses. Code references were checked by the codebase-details and design reviewers against `backend/` and `frontend/`.

## Reviewer Status

| Reviewer | Status |
| --- | --- |
| `egm-structural` | completed |
| `egm-design` | completed (partly checked against code: core.py, secret_box.py, mail.py, tenancy.py) |
| `egm-zoom-out` | completed |
| `egm-implementation-readiness` | completed (did not read code) |
| `egm-codebase-details` | completed |
| `egm-comprehension` | completed |
| `egm-style` | completed |

Severity breakdown: 11 Blocker, 17 Major, 9 Nit.

Verified accurate (no action): `run.py` ACTIONS and `under_shared_rules` (in `public_api/core.py`), `numbers.py` pattern, `developer_keys.py`, `tenancy.py`, `social_oauth/social_tokens/meeting_rooms/secret_box`, `LeadAccount`, `DoNotContact`, `ConsentDeclaration`, `save_accounts`, `connections.emit/subscribe`, events `call.completed`, `meeting.booked`, `campaign.reply`, `lead.created`, `credits.py` primitives, `workflows.py`, `brand.test.js`, `aiv_pytest`, `estimate_only` (exists), in-memory limiter, migration id `2026_11_27_crm_integration` is the next free id. No MCP or CRM code exists.

---

## Blockers

### 1. Existing `full_access` keys would silently get `crm:*` and every new write scope - Blocker
* **Reviewer Lens:** `egm-design`, `egm-codebase-details`
* **Affected Scope:** Section 3 "Sign-in" (L32), 4.5 (L71)
* **Discrepancy:** `public_api/core.py` `has_scope()` returns True for any scope when the key has `full_access` or no scopes (default is `["full_access"]`). Only `mail:` is excluded. Adding `crm:write` as a normal scope lets every legacy key push company data to a CRM, which is the no-downloads risk.
* **Recommendation:** Extend the `mail:` carve-out to `crm:` and any MCP write or confirm scope. Make MCP keys a distinct key type, never `full_access`. Map `crm:*` in `SCOPE_TO_SERVICE` (`services/entitlement.py`). Add a test that a legacy key cannot call `crm.*`.

### 2. Scope names in the plan do not exist - Blocker
* **Reviewer Lens:** `egm-codebase-details`, `egm-implementation-readiness`, `egm-style`
* **Affected Scope:** Section 3 (L32)
* **Discrepancy:** Real scopes are `voice:calls`, `leads:search`, `social:publish`, `mail:*`, `wallets:read`, `email:write`, `social:write` (different meaning), `calendar:book`, `company:write`. `leads:read`, `leads:write`, `social:read`, `voice:*` are not defined. Read/write pairs and `voice:*` are inconsistent. The tool-to-scope map and the 4.5 action-to-scope mapping (is `match.preview` read? `pull` write?) are not given.
* **Recommendation:** Replace the list with real ids plus `crm:read` and `crm:write`. Add a table: tool or action, `/v1/run` action, scope, role required, spends credits, result cap. State that OAuth tokens and keys carry the same scopes.

### 3. The no-downloads sign-off gates all CRM work but is item 1 of a list at the end - Blocker
* **Reviewer Lens:** `egm-structural`, `egm-zoom-out`, `egm-design`, `egm-comprehension`, `egm-implementation-readiness`
* **Affected Scope:** 3 "Rules carried over" (L38), 4.9 (L88), 5 (L96-110), 7.1
* **Discrepancy:** The rule is stated as absolute, yet CRM push is data leaving the product. The memory note with the rule's wording is missing, so compatibility cannot be shown. C0-C3 are scheduled with no gate. The 4.9 guardrails only price the export: pull plus push allows round-trips, an AI can loop pushes in chunks up to the daily cap, "fields revealed or paid for" is undefined per field, and MCP paging (`page_args`, max 100) lets a client page through everything, so a per-call cap is not an export control.
* **Recommendation:** Make this Step 0 with a hard gate: no C0 merge before the owner signs off. Quote the rule in the plan. Define a per-object pushable-field allowlist, DB-enforced per-plan daily and monthly caps, cumulative per-key per-day read quotas for MCP, anomaly alert and auto-pause, and push provenance on each link. Never push records the user did not own or reveal.

### 4. Confirm-token design is undefined and not a real human check - Blocker
* **Reviewer Lens:** `egm-design`, `egm-implementation-readiness`, `egm-codebase-details`, `egm-structural`
* **Affected Scope:** Section 3 (L36, L42), 6 (L118), M2
* **Discrepancy:** No format, binding, TTL, storage, single use, or preview shape. Risks concedes it "needs review" while M2 is estimated at 4 days. A token echoed back through an AI that may be prompt-injected is not human consent. `confirm_token` does not exist in code, and `estimate_only` exists only on `POST /v1/leads/searches` (`numbers` uses `check.estimate`, `journeys` uses `dry_run`), so there is no generic preview mechanism. The plan lists a second preview mechanism (`estimate_only`) with unstated relation to the first.
* **Recommendation:** Specify a server-stored, single-use, minutes-long token in an RLS table, bound to org, user or key, action, normalized payload hash, resolved record-id set and estimated cost. Re-run all compliance gates (eligibility, DNC, consent, credits) on redeem and reject if cost exceeds the preview. Derive the idempotency key from the token. For outbound and bulk actions (send, call, publish, journey start, CRM push or pull above a threshold) require out-of-band human approval (signed URL or in-app queue), the same pattern as "connect returns a URL". Gate M2 on this design. State the wrapper sits above `/v1/run`.

### 5. `save_accounts(source="crm")` does not work as described - Blocker
* **Reviewer Lens:** `egm-codebase-details`
* **Affected Scope:** Section 2 (L18), 4.4 (L68), 4.8 (L83-84)
* **Discrepancy:** `lead_accounts.py` `_SOURCES = {"scout","copilot","import","manual","inbound_form"}`; any other source is stored as `"manual"` (about line 1730), so `source="crm"` is lost. Cleaning (`lead_cleaner.check_row`, `_register_match`, quarantine) and the fill-blanks path run only for `source == "import"` (lines 1663-1690, 1721). Dedupe and `eligibility.classify` run for all sources, so the plan's description is partly wrong. `MAX_PER_REQUEST = 2000`; `AccountIn` has no CRM id or owner. Updates to existing records during pull must also pass through `classify`, since CRM values (sector, legal form, country) can flip eligibility.
* **Recommendation:** Add `"crm"` to `_SOURCES` and extend the `== "import"` branches, or pull as `import` with a marker. Check readers of `LeadAccount.source`. State that updates, not only creates, re-run `classify`. Add per-job pull caps and field-length validation, and escape CRM text on render.

### 6. `ConsentDeclaration` scope `"crm"` does not exist - Blocker
* **Reviewer Lens:** `egm-codebase-details`, `egm-design`
* **Affected Scope:** 4.8 (L83), 7.6
* **Discrepancy:** `eligibility.declare()` accepts only `import`, `list`, `account` and coerces anything else to `import`. It also needs existing saved lead ids or a `list_id`, so it must run after the pull saves rows, not before. "Once per source" is the weakest consent option because a CRM list changes after consent.
* **Recommendation:** Add `"crm"` to the accepted set, `decl_out` and the UI (reuse `ConsentDeclaration.jsx`), or use `scope="list"`. State the ordering. Default to consent per pull job (or per source plus a count or hash-change threshold), logged with user, source id, count, timestamp.

### 7. Credit model is internally contradictory and breaks on integer rounding - Blocker
* **Reviewer Lens:** `egm-comprehension`, `egm-codebase-details`, `egm-design`, `egm-implementation-readiness`, `egm-style`
* **Affected Scope:** 4.7 (L77-79), 4.9 (L88)
* **Discrepancy:** (a) 4.7 makes user-imported records free to push; 4.9 allows only fields "revealed or paid for". An imported record is free but not "paid for", so it is unclear if it may be pushed. "Data that came from us" is undefined and mixed records (own import plus our enrichment, or pull then push back) have no rule. (b) No provenance column exists (L68 says no `LeadAccount` changes), and `source` is user-controllable via CSV, so a user can launder paid records through an import. (c) `charge()` does `ceil(quantity * rate)` per call, so 0.2 per record charged one at a time costs 1 credit each (5x). (d) Holds expire after 6 hours (`HOLD_TTL`) and live in one per-org JSON doc; a job paused until the Salesforce reset outlives them, and thousands of per-record refs bloat the doc. (e) Pull "monthly allowance" and "daily cap per plan" have no numbers and no storage. (f) Failure path is `release()`, not "refund"; `settle()` is not a CRM primitive. (g) `charged_recently` is a time-window heuristic; two identical MCP calls can double-charge.
* **Recommendation:** Write a provenance table (own import / CRM pull / our data / mixed) with push allowed, price. Decide a provenance marker that survives dedupe and merge. Hold and confirm per batch or job with `quantity=N`, or price in whole credits per N records like `number_check`; one hold per job, re-hold on resume. Use a dedupe-keyed ledger entry instead of `charged_recently`. Add a counter table for allowances and caps. Define partial failure, duplicate (matched existing counts as updated: billable?), and retries after `needs_reauth`. Enforce `estimate_only` server-side. Add `crm_record_sync` to `DEFAULT_RATES` with wallet `leadgen` and `charged: True`. Run background workers under `actor_scope(operator_id)` for per-person caps.

### 8. Token encryption is not ready for CRM refresh tokens - Blocker
* **Reviewer Lens:** `egm-design`, `egm-codebase-details`, `egm-structural`
* **Affected Scope:** 4.2 (L58), C0
* **Discrepancy:** `secret_box` uses one Fernet key derived from `SECRET_KEY`. The in-file fallback string is unreachable because `config.py:30` defaults `SECRET_KEY` to `"outreachAI-secret-key-change-in-production-2026"`; that is the weak key in practice, shared with `security.py`, `approval_mail.py`, `billing.py`, `optouts.py`, `form_links.py`, `inbound_forms.py`, `email_dispatcher.py`, `mailer.py`. Sealed values are `enc:v1:` with no key id and `open_secret` returns unsealed values as plaintext. "Recommended" is not a decision, and rotation touches social, meetings and mail tokens. Ciphertext is not bound to org or connection.
* **Recommendation:** Make `CRM_TOKEN_KEY` mandatory with no fallback (refuse to enable CRM without it). Add key id (`enc:v2:<kid>:`), `MultiFernet` and a re-seal migration for existing tokens, as its own step with tests, or defer rotation and do only the dedicated key now. CRM reads must reject unsealed values. Bind ciphertext to org and connection (MAC, or per-row derivation). Seal platform OAuth app credentials the same way and never redisplay them in the admin portal.

### 9. No decision list the builder can act on; phases have no acceptance criteria - Blocker
* **Reviewer Lens:** `egm-structural`, `egm-implementation-readiness`
* **Affected Scope:** Section 7 (L120-130), 5 (L96-110), 4.11
* **Discrepancy:** Ten open decisions plus confirm-token lifetime, hosting path, CORS and per-key limits are left to the builder. No decision says which phase it blocks. Decision 8 asks "API key or OAuth first" while the build order already assumes API key in M1 and OAuth in M2. Phases are scope plus days only: no files to create or modify, no exit criteria, tests are not attached to phases, estimates (about 52 days) have no unit or assumptions.
* **Recommendation:** Move decisions before the build order. For each give question, recommended default, owner, needed-by phase. Fold resolved ones into the body. Add per-phase files (Create/Modify), exit checklist (for example "MCP client lists only tools inside key scope", "replayed push creates 0 duplicates", "failed hold is released", "429 pauses the connection until reset") and per-phase tests (token expiry mid-batch, duplicate match, DNC round trip, cross-tenant read).

### 10. MCP exposure mirrors `ACTIONS`, exposing mail and delete actions; MCP is a prompt-injection channel - Blocker
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** Section 3 (L34), 5 (L112)
* **Discrepancy:** "CRM actions appear as MCP tools automatically once C1 lands" implies any `/v1/run` action becomes a tool. `/v1/run` already has `mail.send`, `messages.delete`, `attachment.get` (`mail.py` L29-40). This contradicts the first-release list. It also lets CRM push be callable before M2 confirm tokens exist. Tool output includes third-party text (company descriptions, CRM fields, transcripts, email) that can instruct the AI to call send or push. The chat assistant is a fourth LLM-driven door with the same risk. Skills are instructions, not enforcement.
* **Recommendation:** Use an explicit per-tool allowlist, not a mirror. Exclude `mail:*` and delete-class actions unless designed. Make M2 a prerequisite for exposing any CRM write. Mark third-party text as untrusted in outputs. Enforce all rules (cost first, no exports, confirm) server side and state that a missing or edited skill weakens nothing. Apply the same gates to the chat assistant. Sign and pin the plugin package.

### 11. Worker and OAuth callback tenant isolation rely on discipline - Blocker
* **Reviewer Lens:** `egm-design`, `egm-codebase-details`
* **Affected Scope:** 4.1 `sync.py` (L53), 4.2 (L57), 4.10 (L91)
* **Discrepancy:** Picking work across orgs with `FOR UPDATE SKIP LOCKED` needs `system_scope`; the plan only says `org_scope`. `SKIP LOCKED` is new to the app. A long transaction held across external HTTP risks lock and pool exhaustion. Callback lookup of `crm_oauth_states` needs `system_scope` too (copy `social_oauth.state_owner` then `finish_oauth` under `org_scope`). State is single-use but not bound to the initiating user or browser, so login CSRF can attach an attacker's CRM to a victim org. State rows have no TTL or sweeper. `crm_loop` started from `main.py` runs once per uvicorn worker; the in-process refresh lock (`social_tokens._locks`) is not multi-worker safe.
* **Recommendation:** Claim rows in a short system-scope transaction (status, `leased_until`, `attempts`), make the HTTP call outside any transaction, write results under `org_scope(row.org_id)` using the org from the claimed row only. Add a lease reaper, dead-letter state, and a test that a poisoned `org_id` in a payload cannot cross tenants. Bind state to user id and a nonce, expire in about 10 minutes, and check the completing user matches. Use a row lock for refresh. Reuse `_pkce_pair`.

---

## Major

### 12. Scope: five adapters and two-way sync up front - Major
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:** Goal 2, 4.1, 4.3, 5 (C0-C8)
* **Discrepancy:** 18 days (C4-C7) for HubSpot, Pipedrive, Zoho, Dynamics with no cited demand; provider order is itself undecided. C3 (pull, mapping UI, two-way DNC, conflicts, 7 days) is the highest consent and compliance risk and secondary to the stated push goal. Protocol of about 13 methods, 15% budget model, `next_at` throttling, 200-record batching, contract suite across adapters, and a rich `fake.py` are premature. Cursor and Codex manifests and OAuth sign-in serve clients with no users yet.
* **Recommendation:** Commit to Salesforce only. Move C4-C7 to a "when a paying customer asks" list. Ship push only, "CRM wins identity, we never overwrite", back off on 429. Keep one safety-critical piece: inbound opt-out read at push time. If early pull is wanted, a one-shot import through `save_accounts`. Fold C0 into a thin vertical slice with `crm_connections`, `crm_links`, `crm_outbox` first; add `crm_field_maps`, `crm_conflicts`, `crm_jobs`, `crm_oauth_states` when their feature lands. Ship M1 now; defer M2 OAuth; ship one config snippet and one `plugin.json` after the endpoint is proven. Reduced plan is about 17 days versus 52. Reuse existing `main.py` loops, `connection_jobs.connections_loop`, `workflow_loop` or `PublicObject` job pattern before adding a bespoke worker.

### 13. Ordering conflicts between M1, M2, C0, C1 - Major
* **Reviewer Lens:** `egm-structural`, `egm-zoom-out`
* **Affected Scope:** Section 5
* **Discrepancy:** M1 signs scopes `crm:*` that only arrive in C0. M2 OAuth is scheduled though optional per decision 8. C1 push can land before M2 confirm tokens. 
* **Recommendation:** Define M1's scope set, make OAuth conditional on decision 8, and make M2 a prerequisite of CRM write tools on MCP.

### 14. MCP OAuth has no security design - Major
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** Section 3 (L28-30), M2
* **Discrepancy:** Missing audience-bound tokens, PKCE, exact redirect allowlist, client registration abuse plan, refresh rotation and revocation, consent screen, list and revoke of connected AI clients. API keys for M1 need to be per-user, revocable, shown once, hashed, with last-used and IP.
* **Recommendation:** Pick one auth core; add these controls to M2 and re-estimate.

### 15. Key identity versus org-scoped keys; admin-only connect - Major
* **Reviewer Lens:** `egm-design`, `egm-codebase-details`, `egm-implementation-readiness`, `egm-comprehension`
* **Affected Scope:** Section 3 (L32), 4.2 (L57), 4.5
* **Discrepancy:** `authorize()` uses `ctx["org_id"]` and `is_admin`; API keys are never `is_admin`. Plan says "acts as that user". `numbers._connect` fails 403 `partner_only` unless the key came through the partner program and needs a registered `return_url`; each connect kind needs a handler in `public_api/preview.py` (`links.read_token`) and a signed token kind. `numbers.py` does not define `authorize`; it imports it from `core.py`.
* **Recommendation:** Verify keys carry a user id. Make effective scopes the intersection of key scopes and current role, re-evaluated per call (demotion kills keys). A non-admin key must not call `crm.connect`, `disconnect`, `mapping.set`, `settings.set`. Add a non-partner connect route and a `crm_connect` token kind with a `preview.py` handler.

### 16. Rate limits and runaway spend - Major
* **Reviewer Lens:** `egm-design`, `egm-codebase-details`
* **Affected Scope:** Section 3 (L42); `core.py` L121-137
* **Discrepancy:** The limiter is in-process, per-worker, lost on restart, unbounded in key count; defaults 120 per minute and 30 writes per minute will throttle a looping AI. "Credits short" refusal prevents overdraft but not an agent burning the whole balance. Optional Idempotency-Key is not sent by AI clients, risking double actions. `_idem_begin` operates outside `org_scope`; confirm `public_api_idempotency` is RLS-covered or deliberately system-scoped.
* **Recommendation:** Shared-store limits (Postgres or Redis), a per-key hourly and daily credit ceiling for MCP keys with a low default, concurrency cap, and server-derived idempotency keys. Move these into M1.

### 17. `/mcp` transport and hosting details - Major
* **Reviewer Lens:** `egm-design`, `egm-structural`, `egm-implementation-readiness`
* **Affected Scope:** Section 3 (L26, L42)
* **Discrepancy:** Path "for example `/mcp`", CORS, library, session handling, in-process versus loopback call into `/v1/run`, and file locations are unspecified. Streamable HTTP needs Origin validation, TLS only, no wildcard CORS with credentials, bearer headers not cookies, no tokens in query strings (`run.py` L153 special-cases `query`), and a multi-worker session store. A session id must never count as authentication.
* **Recommendation:** Name the library, the mount, how a call becomes a run call, and these transport rules. Add a tool table (tool, action, scope, cost, input, output, cap).

### 18. Consent and DNC rules incomplete - Major
* **Reviewer Lens:** `egm-design`, `egm-implementation-readiness`, `egm-comprehension`
* **Affected Scope:** 4.8, 7.6, 7.7
* **Discrepancy:** Eligibility, DNC and credit checks must be re-evaluated at send time by the worker, not at enqueue (rows wait hours). Auto-push default must be off and subject to the same gates and daily cap. Transcripts need per-call recording-consent state; default summary only. Two-way DNC: define that the stricter side wins, CRM can add but never remove a local block, a pulled address on the local DNC list stays blocked. Sole-trader emails "not pushed by default" implies an override; make it non-overridable or require an explicit declaration. "Outreach email status" values, per-provider opt-out field names, retention-sweep trigger and link status are undefined. Erasure: "never delete in the CRM" conflicts with an erasure duty for data we sourced; record push history per record and offer an audited admin CRM-side delete. Matching must be conservative (exact email or external id; ambiguous becomes a conflict, no write).
* **Recommendation:** Add these rules to 4.8, mark decisions 6 and 7 with recommended defaults (off; per job). Reuse `connections.add_block` and `remove_block` (note `add_block` also mirrors to do-not-call and email suppression).

### 19. `safe_fetch.py` cannot make CRM API calls - Major
* **Reviewer Lens:** `egm-codebase-details`
* **Affected Scope:** 4.10 (L91)
* **Discrepancy:** It is a GET-only HTML reader: no auth headers, no POST, text only, 1.5 MB cap, refuses non-HTML, 3 redirects. Only its `_check(url)` SSRF check is reusable.
* **Recommendation:** Factor out `_check` or a small `safe_client`. Specify host allowlists by suffix (`.my.salesforce.com`, `.crm*.dynamics.com`, Zoho region domains), redirects off, DNS re-check, and always take `instance_url` from the token response. Webhooks need replay protection, per-connection secrets and org resolved from the connection, not the payload.

### 20. New tables need ORM models; migration shape unclear - Major
* **Reviewer Lens:** `egm-codebase-details`, `egm-structural`, `egm-implementation-readiness`
* **Affected Scope:** 4.4 (L67-68)
* **Discrepancy:** `ensure_tenancy` runs after `create_all`; new tables come from model classes with `org_id` as `Column(String, index=True, server_default=FetchedValue())` plus `TENANT_TABLES`. `STEPS` migrations hold ALTERs and indexes only. The plan lists tables by name with no columns, keys, indexes, state machines, `dedupe_key`/`next_at` placement, field-map format or `DoNotContact.source` handling (it has no enum; `"crm"` works, but see finding 18). Lead lists live in a JSON settings doc (`leadlists:{org}`, `MAX_LISTS = 200`), not a table, which affects "choose list". Confirm-token storage has no table. `crm_oauth_states` needs a system-scope exemption. Rollback is unstated.
* **Recommendation:** List new model classes as Create in `models.py`, give columns and constraints for each table, and add a test that every new table is in `TENANT_TABLES`. Mark each file Create/Modify/Delete in 4.1 and section 5.

### 21. Event and Workflows wiring gaps - Major
* **Reviewer Lens:** `egm-codebase-details`
* **Affected Scope:** 4.1 `events.py` (L54), 4.5, 4.6
* **Discrepancy:** (a) "Stage changes" is not an event; `connected.py:279` writes `record_event("status")` only and `workflows.set_stage` does the same. (b) `save_accounts` emits `lead.created` only for `added[:200]` (line 1779), so a 2000-row import would not auto-push 1800. `connections.emit` is in-process with an in-memory `_HANDLED` set (5000); restarts can lose or replay events; failures retry 3 times then land in `PublicObject kind="dead_letter"` with no operator view. (c) `push_to_crm` must be added to `workflows.ACTION_INFO` and the editor, honouring `MAX_RULES`, `MAX_DEPTH`, `needs_lead`, `dry`. (d) `crm.connection.needs_reauth` and `crm.job.finished` must be added to `SUPPORTED_EVENTS` in `services/webhook_dispatcher.py`. (e) "Logged in CRM" timeline lines should use `connections.record_event`/`timeline`/`ContactEvent`.
* **Recommendation:** Add a stage-change hook or event, a backfill sweep, idempotent outbox rows on `dedupe_key`, and these registrations.

### 22. `crm` plugin registration and sandbox - Major
* **Reviewer Lens:** `egm-codebase-details`
* **Affected Scope:** 4.5, 4.11
* **Discrepancy:** A new plugin needs entries in `PLUGINS`, a `_crm` handler and dispatch branch in `run.py`, the `catalogue()` guard test (`tests/test_public_api_run.py`) and `frontend/src/settings/developerCatalog.js`. The `run.py` docstring (about line 278) lists plugins without whatsapp, auth, numbers. `sk_test_` sandbox branches on `is_test(ctx)` before real work (`dispatch_event(test=True)` skips `connections.emit`); `fake.py` must hook there and be unreachable for live keys. Sandbox results for `crm` and MCP are not specified.
* **Recommendation:** List these edits and the sandbox hook points.

### 23. Sync behaviour underspecified - Major
* **Reviewer Lens:** `egm-implementation-readiness`, `egm-comprehension`, `egm-design`
* **Affected Scope:** 4.3 (L61-65)
* **Discrepancy:** "Identity", "ownership", "our own" and "two-way" fields are not listed, yet the conflict rule is written as settled while decision 4 is open. "Pull source" is undefined (list, report, view). The daily allocation needs a `limits` call and a reset time. Polling cost: about 96 calls per day per idle org against the allocation; HubSpot app-level limits are shared across customers. Cursor storage, webhook endpoint paths, signature scheme, default mappings per provider, worker concurrency, interval, batch size, retry limit and dead-letter behaviour are not given. `4xx on refresh means needs_reauth` is too broad: social uses `_PERMANENT = (400, 401, 403)` and 429 is not permanent.
* **Recommendation:** List fields per category, define "pull source", give worker parameters, per-org idle backoff and a provider-level throttle. Reuse `social_tokens` (`ensure_fresh_token`, `refresh_expiring`, `alert_staff`, `run_daily_pass`) and `SocialOAuthApp`/`meeting_rooms.save_app` for provider app credentials.

### 24. CrmAdapter, canonical objects, run actions and previews have no shapes - Major
* **Reviewer Lens:** `egm-structural`, `egm-implementation-readiness`
* **Affected Scope:** 4.1 (L49), 4.5 (L71), 4.6
* **Discrepancy:** No method signatures, `Company`/`Person`/`Activity` fields, request or response shapes, or preview output and record limits. `mapping.get/set` is ambiguous. Frontend lacks endpoints, states (loading, error, `needs_reauth`) and per-phase placement. "Assistant tool action" and `push_to_crm` have no parameter schema.
* **Recommendation:** Write the Protocol and dataclasses, one worked Salesforce example, and the shapes. The shared contract suite depends on them.

### 25. Frontend references wrong - Major
* **Reviewer Lens:** `egm-codebase-details`
* **Affected Scope:** Section 1, 4.6, 4.2
* **Discrepancy:** The nav group is "Setup", not "Leads Setup" (`LeadGenerationPlugin.jsx` from line 267: `["Outreach","Inbound","Setup"]`). A new item needs `navItems` plus `embedIds`/`onlyEmbedViews` handling. `brand.test.js` `CLIENT_FILES` must list `plugins/leadgen/CrmView.jsx` and helpers; the test exempts lines containing "staff" and scans only string literals with whitespace and JSX text.
* **Recommendation:** Correct the name and list these edits in the phase checklist rather than only under security.

### 26. Salesforce default object and unverified external facts block C1 - Major
* **Reviewer Lens:** `egm-implementation-readiness`, `egm-structural`
* **Affected Scope:** Section 6 (L115-118), 7.2
* **Discrepancy:** Connected App versus External Client App, HubSpot install cap, Professional Edition API access are "unverified" and drive C1/C4 estimates. Lead versus Contact plus Account blocks `upsert_batch`, mapping defaults and `match.preview`. Two risks have no mitigation or owner.
* **Recommendation:** Turn each into a dated research task before C1 (and C4) with an owner. Pick a default object.

### 27. Estimates unsupported - Major
* **Reviewer Lens:** `egm-implementation-readiness`, `egm-style`, `egm-design`
* **Affected Scope:** Section 5
* **Discrepancy:** About 52 days with no unit, assumptions, test or review time, or buffer. C1 (8 days) and C3 (7) bundle many stories; M1 (5) omits security items (shared limiter, allowlist, quotas, Origin checks) and a three-client plugin package; C0 (3) includes key rotation.
* **Recommendation:** State "engineer-days, one engineer", split C1, re-estimate M1/M2/C0.

### 28. Undefined terms and ambiguous wording - Major
* **Reviewer Lens:** `egm-comprehension`, `egm-style`
* **Affected Scope:** Throughout
* **Discrepancy:** Undefined: "plugin" (a `/v1/run` namespace and a agent-style package), journey, Saved, "sole-trader reach another way", Outreach email status, Workflows, chat assistant, signed popup, embeds, staff, supplier names, `aiv_pytest`, `sk_test_`, "Test CRM" (also called `FakeCrm` and `fake.py`), canonical objects, "layout Clay uses" (no reference), `estimate_only` (a parameter, not defined at first use), "company lookup" versus "find companies". Tool naming (prose in 3, dotted in 4.5) has no single rule; L112 says "all CRM actions" while 17 actions exist.
* **Recommendation:** Add a short glossary or one-line definitions at first use, one naming rule (MCP tool = `/v1/run` action), and say whether all 17 CRM actions or a subset are exposed. Reword 4.7 as a table (action, condition, price, TBD where unset).

---

## Nits

### 29. Missing feature-spec sections - Nit
* **Reviewer Lens:** `egm-structural`
* No problem statement, Non-Goals (Deferred sits at the end of 5 with no reasons) or Alternatives Considered (local stdio versus hosted MCP, unified-API vendor versus own adapters, outbox versus direct calls). Add short sections and give a reason per deferred item. Extend Deferred with Pipedrive/Zoho/Dynamics, pull and conflicts, mapping UI, MCP OAuth, Cursor/Codex manifests.

### 30. Reusable code not mentioned - Nit
* **Reviewer Lens:** `egm-codebase-details`
* `social_oauth.state_owner/finish_oauth`, `_pkce_pair`, `meeting_rooms.save_app/load_creds/apps_view`, `SocialOAuthApp`, `social_tokens`, `connections.record_event/timeline/add_block/remove_block`, `eligibility.declare/QUESTION/BASES/CONFIRM`, `webhook_dispatcher.dispatch_event`, `journeys.dry_run` and `credits.can_start`, `core.page_args/page_of`, `PublicObject` plus the `leads.py` background `_run(org, id)` job pattern (alternative to `crm_jobs`).

### 31. Inaccurate wording about existing code - Nit
* **Reviewer Lens:** `egm-codebase-details`
* L14: `authorize` is imported from `core.py`, not defined in `numbers.py`. L21: `settle` and `refund` terms (use `release`). L58: "current fallback key is weak" - state the concrete weakness (finding 8).

### 32. Brand and sanitising - Nit
* **Reviewer Lens:** `egm-design`
* "No supplier names in pushed fields" conflicts with pushing "consent basis and source as text" unless sanitised. Define and test a sanitising function.

### 33. Link table and polling hygiene - Nit
* **Reviewer Lens:** `egm-design`
* Add FORCE RLS or confirm the app role is non-owner (`tenancy.py` creates a `NOBYPASSRLS` role) and a migration test for tenant coverage. Define a staff alert channel for the daily refresh pass.

### 34. Heading and format consistency - Nit
* **Reviewer Lens:** `egm-structural`, `egm-style`
* Part A uses bold lead-ins where Part B uses H3s. Status line (L3) duplicates L22; add date and owner. Split dense bullets at L13-14 and L49. Spell out RLS. Pick "org" or "organization". Make "Needs" and "Proposed" status markers consistent.

### 35. Informal or vague phrasing - Nit
* **Reviewer Lens:** `egm-style`
* "One service, three doors", "keep in step both ways", "Skills teach the AI", "a wrong tool call", "recalled, unverified", "Needs the owner's sign-off" (name the owner), memory-note trivia at L88 (state the consequence instead). State the rationale for the 15% budget and the conflict rules, and give "Zoho data-centre handling" a place in C6 scope.

### 36. Migration id date - Nit
* **Reviewer Lens:** `egm-structural`
* `2026_11_27` is a fixed future date (today is 2026-11-18). Confirmed to be next in `STEPS` order now, but recheck at build time.

### 37. Sandbox and rate-card details - Nit
* **Reviewer Lens:** `egm-codebase-details`, `egm-implementation-readiness`
* Say which actions return simulated results for `sk_test_` keys and what the fake data looks like; admin rate-card edits go through `set_rates`.
