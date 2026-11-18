# Plan: MCP server and CRM connections

Status: draft for review. Nothing is built. Both parts share one set of `/v1/run` actions, so they are planned together.

## 1. Goals

1. **MCP server.** Users connect their own AI (Agent CLI, Cursor, Codex, ChatGPT-style clients) to our plugins: Leads, Voice, Social. Calls use the user's own credits and subscription limits, the same as the app.
2. **CRM connections.** Salesforce first, then HubSpot, Pipedrive, Zoho, Dynamics. Push saved companies, people and activities to the CRM; pull CRM contacts into a Leads list; keep do-not-contact in step both ways.
3. **One service, three doors.** The app screens, `/v1/run` actions (and so the MCP server), and the chat assistant call the same service code.

## 2. What already exists

- `backend/app/public_api/run.py`: the `/v1/run` entry. An `ACTIONS` table forwards to `/v1/...` routes; newer plugins (`mail`, `auth`, `numbers`) are handled in place under `core.under_shared_rules`, which gives rate limits, Idempotency-Key replay, audit and one error shape.
- `public_api/numbers.py`: the pattern to copy for a new plugin (`ACTIONS` dict with plain descriptions, `handle()`, `authorize(scope, service)`, sandbox for test keys, a `_connect` that returns a signed popup URL).
- `public_api/partner_auth.py`, `api/developer_keys.py` (`AVAILABLE_SCOPES`, `SERVICE_SCOPES`): API keys and scopes.
- OAuth and tokens: `services/social_oauth.py`, `services/social_tokens.py`, `services/meeting_rooms.py`, sealed with `services/secret_box.py`.
- Tenant isolation: Postgres RLS, `core/tenancy.py` (`TENANT_TABLES`, `org_scope`, `system_scope`); migrations in `core/migrations.py`.
- Leads: `LeadAccount` (`models.py`), `api/lead_accounts.py` `save_accounts()` (the one import path with dedupe, cleaning and `eligibility.classify`), lists in `api/lead_lists.py`.
- Compliance: `services/eligibility.py`, `services/send_readiness.py`, `DoNotContact`, `ConsentDeclaration`.
- Events: `services/connections.py` (`emit`, `subscribe`), `services/workflows.py`.
- Credits: `services/credits.py` (`DEFAULT_RATES`, `charge`, `hold`/`confirm`/`settle`, `charged_recently`).
- There is no MCP code and no CRM code.

## 3. Part A: MCP server

**Shape.** A remote MCP server (streamable HTTP) mounted on the backend, for example `/mcp`. Each MCP tool maps to one `/v1/run` action, so there is no second implementation of any rule.

**Sign-in.** Two options, decision needed:
- API key per user (fast to build): the user creates a key on the Account screen and pastes it into their AI client.
- OAuth (smoother): the client opens our popup sign-in; the server issues a token bound to org and user.

Either way the call acts as that user: credits, plan limits, permissions and org isolation are enforced by the same checks as the app. Keys carry scopes (`leads:read`, `leads:write`, `crm:read`, `crm:write`, `social:read`, `social:write`, `voice:*`); a tool outside the key's scopes is not listed.

**Tool set, first release (read-only and search):** find companies, find people, company lookup, list journeys, list lists, credit balance. Every tool that spends credits returns its cost first (`estimate_only`) and refuses to run if credits are short.

**Second release (writes):** save to list, add to journey, schedule or draft a social post. Anything bulk or outbound (journey start, send, call, publish, CRM push or pull) first returns a preview and a `confirm_token`; the action runs only when the token comes back. Connecting an account always returns a URL a human must open.

**Rules carried over.** Users never download lead, list or journey data: tools return results and actions, not exports, and result sizes are capped. No supplier names in tool names, descriptions or output. Tool descriptions are plain language, since the AI reads them.

**Plugin package.** A `plugin.json` and skills in the layout Clay uses (`.agent-plugin/marketplace.json`, `plugin/skills/*`), installable with `/plugin marketplace add <repo>`. Skills teach the AI our rules: show the cost before spending, never ask for exports, confirm before outbound actions. Cursor and Codex manifests alongside.

**Open items.** Hosting path and CORS for the MCP endpoint, per-key rate limits (the existing in-memory limiter is per process), and how long confirm tokens live.

## 4. Part B: CRM connections

### 4.1 Architecture

New package `backend/app/services/crm/`:
- `base.py`: `CrmAdapter` protocol. Auth (`authorize_url`, `exchange`, `refresh`, `revoke`), `whoami`, `describe(object)`, `find_matches`, `upsert_batch`, `log_activity`, `pull_sources`, `fetch`, `changed_since`, `limits`, optional webhook verification. Canonical objects `Company`, `Person`, `Activity`. Errors mapped to `CrmError(kind=auth|limit|validation|duplicate|not_found|transient)`.
- Adapters: `salesforce.py`, `hubspot.py`, `pipedrive.py`, `zoho.py`, `dynamics.py`, and `fake.py` (in-memory CRM with describe, 429s, token expiry, duplicate rules; used by tests, `sk_test_` keys and a dev "Test CRM").
- `oauth.py`: connect and callback, single-use state with PKCE, refresh under a per-connection lock, daily refresh pass with staff alerts.
- `mapping.py`, `matching.py`, `policy.py`: pure functions. `policy.py` decides what may leave and what may come in (eligibility, do-not-contact, consent, the no-downloads gate).
- `sync.py`: outbox worker and pull jobs; `crm_loop()` started from `main.py`. Picks work with `FOR UPDATE SKIP LOCKED`, runs each item under `org_scope`.
- `events.py`: subscribes to `call.completed`, `meeting.booked`, `campaign.reply`, `lead.created`, stage changes; writes outbox rows when auto-push is on. Adds a `push_to_crm` Workflows action.

### 4.2 Connect and tokens
- `crm.connect` returns a hosted popup URL; callback `/api/crm/oauth/{provider}/callback` finds the org from the single-use state. Admin only; embeds use the signed popup.
- Tokens sealed in `crm_connections`; recommended: a dedicated `CRM_TOKEN_KEY` with key rotation in `secret_box` (the current fallback key is weak).
- Platform OAuth app credentials per provider are set by staff in the admin portal.

### 4.3 Sync behaviour
- Poll Salesforce every 15 minutes (`SystemModstamp`), only for linked records and the chosen pull source. HubSpot and Pipedrive: webhooks plus polling backstop. Zoho and Dynamics: polling.
- API budget: default 15% of the customer's daily Salesforce allocation; batch with sObject Collections (200 per call); on limit errors back off and pause the connection until reset. Throttling lives in the database (`next_at`), not in process memory.
- Idempotency: unique outbox `dedupe_key`; unique links on (connection, local) and (connection, remote); always match before create.
- Conflicts: CRM wins identity and ownership fields; we win activity and our own fields; pull into an existing record fills blanks. If both sides changed a two-way field, write a conflict row for the user to pick. We never delete in the CRM.

### 4.4 Data model (migration `2026_11_27_crm_integration`, all tables in `TENANT_TABLES`)
`crm_connections`, `crm_oauth_states`, `crm_field_maps`, `crm_links`, `crm_outbox`, `crm_jobs`, `crm_conflicts`. No column changes on `LeadAccount`; pulled records use `source="crm"`. `DoNotContact.source` gains `"crm"`.

### 4.5 Run actions and scopes
New `crm` plugin: `providers`, `connect`, `list`, `get`, `disconnect`, `fields`, `mapping.get/set`, `settings.set`, `match.preview`, `push`, `pull.sources`, `pull`, `activity.log`, `job.get/list`, `conflicts.list/resolve`. Scopes `crm:read`, `crm:write`. Webhooks to partners: `crm.connection.needs_reauth`, `crm.job.finished`.

### 4.6 Frontend
A "CRM" page in the Leads Setup group (`plugins/leadgen/CrmView.jsx`): connection and health, what sends automatically, field mapping, bring contacts in (preview, consent question, choose list), sync history and conflicts. Inline: "Send to CRM" in Lists and Saved with a cost preview, "In CRM" badge and link on company and person pages, "Logged in CRM" lines in the activity timeline, a Workflows action, an assistant tool action. Admin portal: provider app credentials and per-org connection health.

### 4.7 Credits (proposed, decision needed)
- `crm_record_sync`: 0.2 credits per record created or updated, only for data that came from us. Records from the user's own import or from the CRM sync free.
- Activity logging free. Pull free up to a monthly allowance, then 0.1 per record.
- Bulk jobs use `hold` then `confirm` per success; `charged_recently` stops double charges; `estimate_only` everywhere.

### 4.8 Consent and compliance
- Push: do-not-contact sets the CRM opt-out fields; an "Outreach email status" field is pushed when mapped; sole-trader "reach another way" emails are not pushed by default; consent basis and source pushed as text.
- Pull: everything goes through `save_accounts(source="crm")`. First pull from a source asks the consent declaration (`scope="crm"`). CRM opt-outs become local blocks.
- Two-way do-not-contact. Retention sweep deletes our copy and unlinks; it never deletes in the CRM.
- Calls: push summary and outcome; transcript text only if the setting is on; recordings never.

### 4.9 The no-downloads rule
CRM push lets data leave the product. Proposed guardrails: only saved leads (never raw search results), only fields the org has revealed or paid for, per-record credits, a daily cap per plan, every job audited, and no "pull from us" API. Needs the owner's sign-off. The memory note `no_data_downloads_rule.md` is missing; only its index line remains.

### 4.10 Security
Every table under RLS; workers run under `org_scope`; callbacks find the org only from the single-use state. Validate instance URLs against provider host allowlists and send through `services/safe_fetch.py`. Minimum OAuth scopes, revoke on disconnect, tokens never in responses or logs, 4xx on refresh means `needs_reauth`. Inbound webhooks verify the signature then only queue. No supplier names in pushed fields; add new files to `frontend/src/brand.test.js`.

### 4.11 Testing
Pure unit tests for mapping, matching, policy, conflicts. Adapter contract tests with `httpx.MockTransport` and recorded fixtures, one shared suite run against `FakeCrm` and every adapter. Database tests on `aiv_pytest` for isolation, `SKIP LOCKED`, idempotent replay and credit hold/confirm/refund. Sandbox `sk_test_` keys give simulated results. Manual gate: a free Salesforce Developer Edition org, later HubSpot and Pipedrive developer accounts.

## 5. Build order

| Phase | Scope | Days |
|---|---|---|
| M1 | MCP server, read-only tools, API-key sign-in, plugin package | 5 |
| M2 | Write tools with confirm tokens, OAuth sign-in | 4 |
| C0 | CRM foundation: base, fake, policy/mapping/matching, tables, scopes, key rotation | 3 |
| C1 | Salesforce connect, push, outbox worker, CRM screen, Send to CRM | 8 |
| C2 | Activities, automatic push, Workflows action | 4 |
| C3 | Pull, mapping UI, two-way do-not-contact, conflicts | 7 |
| C4 | HubSpot | 5 |
| C5 | Pipedrive | 3 |
| C6 | Zoho | 4 |
| C7 | Dynamics | 6 |
| C8 | Hardening: admin health, chat tool, partner popup connect, docs | 3 |

CRM actions appear as MCP tools automatically once C1 lands. Deferred: Salesforce Change Data Capture and Bulk API, deals and opportunities, custom objects, several connections per provider, owner mapping, email message objects, marketplace listings, a pull filter builder.

## 6. Risks
- Salesforce may require customer admins to approve our connected app, and is moving to External Client Apps. Unverified; check current documentation.
- Salesforce Professional Edition has no API access without an add-on; `whoami` must detect and explain it.
- HubSpot unlisted-app install cap (recalled, unverified). Zoho needs data-centre handling; Dynamics needs tenant admin consent.
- AI-driven bulk actions: a wrong tool call could spend credits or push many records. Mitigated by estimate-first and confirm tokens, but the confirm design needs review.

## 7. Open decisions
1. Is CRM push allowed under the no-downloads rule, with the guardrails in 4.9?
2. Salesforce default object: Lead, or Contact plus Account, or ask on connect?
3. Pricing and plan tier for CRM; is activity logging free?
4. Which side wins on stage or status; do journey outcomes map to Lead Status or a custom field?
5. Push transcripts or summaries only?
6. Consent declaration once per pulled source or on every pull?
7. Auto-push default on or off?
8. MCP sign-in: API key first, or OAuth first?
9. Who creates the Salesforce Developer Edition org for the manual test?
10. Provider order after Salesforce (HubSpot proposed).
