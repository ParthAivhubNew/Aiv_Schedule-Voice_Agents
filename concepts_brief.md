# Concept brief: Outreach as an installable extension (snippet, popup sign-in, browser extension)

**Author:** EGM Synthesizer (six reviewers: design, codebase details, scope, comprehension, implementation readiness, structure)
**Date:** 2026-11-04
**Mode:** BRAINSTORM
**Status:** Concept. Nothing here is built. Claims about code were checked by reviewers unless marked "unverified".

---

## 1. Overview

Outreach becomes something other software installs, in two forms:

1. **In-app embed.** A partner pastes one snippet into their own app:
   `<script src=".../embed.js" data-key="pk_...">` plus `<div data-outreach="leads">`. Colours, logo, font and radius come from `data-*` attributes on the same tag.
2. **Browser extension.** An Outreach side panel on any website, like Apollo's.

Becoming a partner is one click in test mode. Staff only review go-live. The partner downloads one zip with the keys, config, snippet and extension. An end user signs in once through an Outreach-hosted popup. The partner's code never touches the sign-in.

### Terms used in this brief (the concept never defined them)

| Term | Meaning here |
| --- | --- |
| Partner | A company that puts Outreach inside its own software or tool. The integrator, not the end customer. |
| End user | A person using the partner's software who now also uses Outreach. Has (or creates) an Outreach account. |
| Embed | The Outreach screen shown inside an iframe on the partner's page. |
| Browser extension | The side-panel product installed in a browser. Separate from the embed, same screens. |
| Link (`PartnerLink`) | A database row tying one partner to one Outreach org (and optionally an `external_id`). Created when the end user agrees. |
| `pk_` | Public key. Identifies the partner. Safe to put in a web page. Today this is `Partner.client_id`. |
| `psk_` | Partner secret key. Server-only. Used only by the optional signed server upgrade. |
| `whsec_` | Webhook signing secret. Not needed for snippet-only. |
| `sk_live_` / `sk_test_` | Per-account API keys for `/v1`. The concept's "per-user sk_" and this are the same family. Not part of this feature. |
| Embed token | Short-lived signed token (`typ=embed`, 15 min) that lets one iframe call only one screen's API paths. |
| Test mode | The partner is not live. Follows `partner.status != "live"` (`services/embed.py:187`). It does not follow the key. |

---

## 2. Analysis (critique first)

### 2.1 The three most serious problems

**Objection 1. The origin allowlist is not a security control, and the concept treats it as one.**
- Today the allowlist only feeds the CSP `frame-ancestors` header (`api/embed.py:93-105`, `services/embed.py:210`, `frontend/nginx.conf:15-22`). That stops other sites from framing the page. It does not stop anyone from calling the API.
- Calls from inside the iframe carry `Origin` = the Outreach host, never the partner's. The server never sees the partner's origin on API calls.
- `pk_` is public by design (`embed.js:340`). `Origin` is forgeable by curl or an extension.
- Today the real gate is the partner's server holding `psk_` and deciding who the user is. Snippet-only removes that gate. Nothing replaces it yet.
- Fix: say plainly that the allowlist is (a) a browser-enforced anti-framing and anti-misuse control and (b) a server check at the one endpoint where the partner page's `Origin` is visible (`/embed/start`, called by `embed.js` from the partner page). The real credential is the end user's own sign-in with a password and consent. A forged origin gets an attacker a sign-in page, not data.
- Also: `check_origin` (`services/partners.py:132-138`) lets requests with no `Origin` through. Do not reuse it as is for the new endpoints.

**Objection 2. "Sign in once, we remember them" cannot be built the way it is written, and removing the partner's connect token opens new holes.**
- Remembering across visits assumes a cookie or localStorage in an iframe on the partner's site. Safari, Firefox and Chrome partition or block that. A cookie set in the popup (first party to Outreach) is not sent from the iframe.
- Today `embed_connect.py` needs a connect token minted by the partner's server with `psk_`, and it rejects any request with an `Origin` header (`embed_connect.py:49-50`). That token is the partner vouching "this is my user 42". Without it:
  - Any page holding the public `pk_` can open the popup and name any `external_id`. An attacker can pre-claim "user 42", and the real user 42 later gets a 409 from `_finish` (`embed_connect.py:157-171`).
  - A malicious site can use another partner's `pk_` to show a consent screen "as Acme".
- A popup opened on page load is blocked by browsers. It must start from a click, so a visible "Connect Outreach" button is required.
- Fix: see Decisions D3 and D4. In short: the popup ends in a one-time code sent by `postMessage` to the opener with a pinned target origin. "Remember" lives in Outreach's own first-party cookie, so a returning user clicks "Connect", the popup recognises them and closes itself with no password. In snippet-only mode the identity key is the Outreach account, not an `external_id` the page supplies.

**Objection 3. The browser extension contradicts the allowlist and the frame model, and "an extension build per partner in the zip" does not work for real users.**
- An extension works on any site. "Only works on web addresses the partner lists" cannot hold for it. One of the two statements has to go, or be restated.
- An iframe injected into LinkedIn or GitHub has an ancestor that is not in anyone's allowlist. `frame-ancestors` would refuse it, and loosening it to `*` removes clickjacking protection for every partner. Strict-CSP sites also block foreign iframes with their own `frame-src`.
- The side panel (`chrome.sidePanel`) is an extension page with origin `chrome-extension://<id>`. `clean_origins` (`services/partners.py:102`) and `frame_ancestors` (`services/embed.py:212`) drop anything that is not http(s).
- A Chrome user cannot install a zip. Per-partner store listings do not scale, and each extension build gets a different ID unless a `key` is pinned in the manifest. Store review (days to weeks, justification for broad host permissions) clashes with "no approval wait".
- Fix: one Outreach-published extension, not one per partner. The zip carries a small pairing config and an unpacked build for the partner's own team only. See D5 to D7.

### 2.2 Other serious findings

- **Existing partners would break.** `embed.js` requires `data-pass` and calls the partner's server (`embed.js:340-388`). Live partners ship kits that depend on this. Keep the pass flow as is. The new path is used only when `data-pass` is absent.
- **"Test and live keys side by side" is a data-model change, not a UI change.** `Partner` has one `client_id`, one `secret_hash` (`models.py:2136, 2147-2148`) and a unique `owner_org_id` (`models.py:2134`). It also conflicts with "test mode follows `partner.status`". If a test key could reach a live partner, live data leaks into test mode. Pick one source of truth. This brief picks `partner.status`.
- **`psk_` acting for linked users through an `Outreach-Account` header** does not exist in the code (no match in `backend/app`). It widens `psk_` into cross-account impersonation, and it is only needed by the deferred signed-call upgrade. Not in scope.
- **"Drop return URLs" is not safe as stated.** `/request-live` requires them (`api/partners.py:252-253`), and `/v1/run` sign-up tests depend on them (`test_partner.py:60-62`). Drop them for the embed and extension only. Keep them for the legacy `/v1/run` flow.
- **The starter kit cannot be "snippet only" today.** Each of the five stack kits includes a server route template for `data-pass`, a `.env.example` with `psk_`, `check.mjs` and `START-HERE.txt` (`partner_kit/templates/`). `build()` reads text only, substitutes `{{NAME}}` and raises on any leftover placeholder (`partner_kit/__init__.py:61-76`). It cannot carry icons or a compiled bundle.
- **Partner creation requires staff today.** `Partner` rows are created only in `admin_portal.partner_approve` (`admin_portal.py:1284-1285`). `PT.usable()` requires `terms_accepted_at` (`services/partners.py:127`), so one-click start must also record terms acceptance.
- **`data-*` theming is a bigger change than described.** `embed.js` reads only `data-key`, `data-host`, `data-pass`, `data-appearance` (`embed.js:369-374`). `data-appearance` is passed as a raw string to `lookFor`, which accepts only `"auto"` or an object, so a JSON attribute does not work today. A logo URL from an attribute is untrusted input (IP leak, content from anywhere). Reuse `TH.problems` and `cleanLogo` in `services/embed_theme.py`.
- **The popup page is framable today.** `/embed/*` gets a frame policy that allows the partner to frame it. The password and consent screen must refuse framing by everyone (`frame-ancestors 'none'`). It is only ever a top-level window. `SecurityHeadersMiddleware` (`main.py:892-899`) already sets `X-Frame-Options: DENY` on backend responses that lack one, so check nginx versus backend for each new route.
- **CORS is `allow_origins=["*"]` with `allow_credentials=True`** (`main.py:913-918`). Fine for bearer tokens. It means CORS gives no origin protection for the new unauthenticated endpoints, so the check must be in the handler. Do not add cookie-authenticated API endpoints on top of it.
- **Test mode must not cost real money.** One-click partner creation plus voice and email components is an abuse path unless test mode is blocked from the real suppliers. Whether it is blocked today is **unverified**. This is a prerequisite for S2, not a deferral.
- **`voice` in an embed lets a user place calls with no partner server to throttle them.** Add per-link daily ceilings server-side before go-live is allowed.
- **Revocation and token cache.** Embed tokens are cached 5 s per process (`services/embed.py:58-59, 146-153`), and `forget()` clears one process only. Multi-worker revocation lags up to the cache TTL. `_load` also writes `last_login_at` on every uncached call. Debounce it.
- **No traceability for support.** There is no request id from loader to backend, no audit row for token mint or origin denial, and `/embed/frame-policy` does a database lookup per page view with no cache (`api/embed.py:97-104`). A blank panel on a partner site cannot be diagnosed today.
- **Org isolation is unchanged and holds.** `org_scope(emb["org_id"])` is set from the signed token, never from a header (`auth_middleware.py:~342`). `partners`, `partner_links` and `partner_audit` are not in `TENANT_TABLES` (`core/tenancy.py:35-53`), so every query touching them must filter explicitly or run in `system_scope()`. The new endpoints must not read them unfiltered.
- **Working tree conflict.** `core/tenancy.py` and `core/auth_middleware.py` have uncommitted human-calls edits. Expect merge friction in S3 and S4.

### 2.3 What can be reused

| Piece | Where | Use |
| --- | --- | --- |
| Embed token, component path regexes, `may_use` | `services/embed.py:36-56, 72-77, 129-137` | Unchanged. This is the isolation gate. |
| Connect screen (password, consent, signup) | `api/embed_connect.py:124-205`, `frontend/src/embed/ConnectScreen.jsx` | Becomes the popup page. Only how it gets its start token changes. |
| `PartnerLink`, consent, revoke | `services/partners.py:209-233`, `models.py:2156-2175` | Keep. One creation function for every route. |
| Credit stamping via `partner_scope` | `services/embed.py:112-121` | Keep. New endpoints must run inside it, with a test. |
| Revocation (`_forget_keys`, `stop_all_keys`) | `services/partners.py:173-178` | Works for the extension too. |
| Audit | `PT.audit` (`services/partners.py:44`) | Add actions (see S1). |
| Frame-ancestors pattern | `services/inbound_forms.py:213` | Same pattern for another embeddable page. |
| Loader | `frontend/public/embed.js` | One file. Change only `show()` / `getPass()` (`embed.js:406-445`). |
| Theme validation | `services/embed_theme.py`, `frontend/src/embed/theme.js` | Validate snippet attributes with the same code. |

### 2.4 Where the earlier Opus plan is wrong or out of order

| Opus plan item | Verdict |
| --- | --- |
| 9 steps, 2 staff approvals | Correct (`partners.py:117-141`, `admin_portal.py:1269-1351`). |
| "sk_ handled at `auth_middleware.py` 316-326" | Half true. Embed tokens go through a different branch (`:328-343`) via `EM.context`. A popup session token must be added there, never in the `sk_` branch (`key_may_use` limits keys to `/v1`, `:84-88`). |
| `POST /partner/start` | Needed. Must do what `partner_approve` does and record terms in one step. |
| Test + live keys side by side | **Cut.** One `pk_`, mode from `partner.status`. Revisit when a partner needs staging next to production. |
| Drop return URLs | **Narrow.** Embed and extension only. |
| `/embed/start` | Needed, but it is the origin-checked entry for the popup, not a token mint for the partner's server. |
| `psk_` acting via `Outreach-Account` header | **Defer.** Optional signed upgrade. |
| Zip and extension as late items | Wrong order. Both depend on a frozen snippet contract, so the contract is step zero. |
| `psk_` and `whsec_` in the partner's first run | **Remove from the default zip.** Snippet-only needs neither. |

---

## 3. Goals vs Non-Goals

### Goals
- A partner reaches a working Outreach panel on their own page in one sitting: one click to start, paste one snippet, add their domain.
- The end user connects once through an Outreach-hosted popup. The partner's code never sees a password or token it does not need.
- The browser extension reuses the same screens, the same sign-in and the same token scoping. No new data path.
- Org isolation stays as it is: org id from the signed token, RLS unchanged.
- Test mode cannot spend money or reach a supplier.
- Clients never see supplier names in the zip, extension, responses or errors.
- A partner can tell why the snippet failed (wrong origin, bad key, unknown screen) from the message alone.

### Non-goals (this effort)
- Signed server-call identification (`psk_`, `Outreach-Account` header, per-user `sk_` for this path).
- Test and live key pairs.
- Partner billing and top-up (stays last).
- Journeys and social inside the extension. Start with `leads`, add the others from the `COMPONENTS` registry.
- Firefox, Edge, Safari extension builds. Chrome (MV3, `chrome.sidePanel`, Chrome 114+) first.
- Cookie-partitioned remember-me inside the iframe (kept as a later upgrade).
- Removing `data-pass` or the five stack kits for existing partners.

---

## 4. Alternatives Weighed

| Topic | Option | Verdict |
| --- | --- | --- |
| Where the allowlist is enforced | CSP only (today) | Rejected. Not an access control. |
| | Server-side `Origin` check at `/embed/start` plus popup shows the origin plus CSP | **Chosen.** Honest about what it stops. |
| | Signed partner-server call | Deferred as an upgrade. |
| How the popup hands back identity | Cookie or localStorage in iframe | Rejected. Blocked or partitioned in major browsers. |
| | `postMessage` to opener with a one-time code, exchanged for a 15 min token held in memory | **Chosen.** |
| | Token directly in `postMessage` | Rejected. Code exchange is replay-limited and binds to a state value. |
| Remembering the user | Refresh token in the partner page's localStorage | Rejected for v1. Exposed to any script on the partner's page. |
| | Outreach first-party cookie, popup auto-completes on click | **Chosen.** Works under third-party-cookie blocking, costs one click per visit. |
| | Partitioned cookie / Storage Access API in iframe | Later upgrade. |
| Identity key for a snippet-only link | Page-supplied `external_id` | Rejected. Squattable. |
| | `external_id = "outreach:<operator_id>"` set server-side after sign-in | **Chosen.** No schema change. A later signed upgrade needs a merge rule. |
| Test/live mode | Two keys | Cut. |
| | `partner.status` only | **Chosen.** |
| Extension distribution | One Outreach-published extension, partner paired by config | **Chosen.** |
| | One store listing per partner | Rejected. Does not scale. |
| | Unpacked per-partner build | Test mode and the partner's own team only. |
| Extension UI | Iframe injected into host pages | Rejected. Page CSP and ancestor problems. |
| | `chrome.sidePanel` page that frames `/embed/ext` | **Chosen.** |
| Extension sign-in | Reuse the iframe popup | Rejected. |
| | `chrome.identity.launchWebAuthFlow` to the same hosted sign-in page | **Chosen.** |
| Extension host access | `<all_urls>` | Rejected. Review and blast radius. |
| | `activeTab` plus `optional_host_permissions` | **Chosen.** |
| Zip | Five stack kits plus extension | Rejected as default. |
| | New "snippet" kit: snippet, `config.json`, README, unpacked extension | **Chosen.** Old stacks stay for the signed upgrade. |
| Theming via snippet | Free-form JSON | Rejected. Injection and fingerprinting risk. |
| | Flat attributes (`data-color-primary`, `data-radius`, `data-font` from a fixed list, `data-logo` as validated https) | **Chosen.** |

---

## 5. Key Decisions & Staging for Next Steps

### 5.1 Decisions to freeze first (S0, no code)

**Decisions that need the user's confirmation** are marked "CONFIRM".

- **D1. One `pk_` per partner. Mode follows `partner.status`.** No second key. `pk_` is public, and the snippet is identical in test and live.
- **D2. Allowlist rules.** One function, `origin_allowed(partner, origin)`, used by `/embed/start`, the popup page, `frame_ancestors` and the frame policy. Live partners: exact `https://` origins only, no wildcards, no `http://`. Test partners: also `http://localhost` and `http://127.0.0.1` with any port. Existing regex rejects `:*`, so test mode needs an explicit rule. The allowlist is entered in the dashboard before go-live. The zip is built with test-mode defaults, so it works on localhost without a dashboard visit.
- **D3. Popup protocol.**
  1. User clicks the "Connect Outreach" button that `embed.js` renders (no click, no popup).
  2. `embed.js` calls `POST /embed/start` with `pk_` and `component`. The server reads `Origin`, checks D2, records the origin and returns a `state` nonce bound to that origin (TTL a few minutes, single use).
  3. `embed.js` opens `{host}/embed/connect?state=...` as a top-level popup. The page shows the origin verbatim ("Connect Outreach to acme.com") and the partner name.
  4. After the existing password and consent steps, the popup calls `window.opener.postMessage({code}, <recorded origin>)` and closes.
  5. `embed.js` passes the code to the iframe. The iframe exchanges it at `POST /embed/exchange` for an embed token held in memory.
  - If the popup is blocked or closed, the button stays and shows a one-line message. A wrong password stays in the popup.
- **D4. Remembering.** The popup sets an Outreach first-party session cookie. On a later visit the user clicks Connect, the popup finds the session, shows no password step and closes. The consent record on `PartnerLink` already exists, so consent is not asked again. "Sign out" and "Revoke this partner" live on the Outreach side (the revoke already exists, `services/partners.py:224-233`). Different browser or device means a fresh sign-in. State this to partners.
- **D5. Extension identity model (CONFIRM).** One Outreach-published MV3 extension. It restates the allowlist: the extension works on any site the user opts into, controlled by the user, not the partner. The partner's customers get it from the store. The partner's zip contains an unpacked build and `config.json` (`pk_`, host) for their own team and for test mode. A partner who needs a locked-to-their-sites extension is out of scope and would be a custom build.
- **D6. Extension tokens.** A separate claim (`src: "ext"`) on the embed token, narrower component set, never accepted from a partner snippet and never minted for one. Partner attribution comes from the popup-recorded link, not from a string in the extension. Credit stamping uses the same `partner_scope`.
- **D7. Extension trust model.** Side panel page (`chrome-extension://<id>`) frames `/embed/ext`, a new route whose `frame-ancestors` is exactly the published extension ID (and the unpacked ID in test mode). Pin the manifest `key` so the ID is stable. No iframe injected into host pages. Content script only reads page context and talks to the service worker.
- **D8. Identity key.** `PartnerLink.external_id = "outreach:<operator_id>"`, set server-side after sign-in. Add an `identity_source` column (`pass` or `popup`) for later merge. The 409 checks in `_finish` stay.
- **D9. Snippet contract and version.** Script URL, `data-key`, `data-outreach` values (`leads`, `campaigns`, `mail`, `voice`, `social` per existing `COMPONENTS`), the flat theme attributes, and a `data-v` version. Defined once in one schema file. `embed.js`, kit templates, docs and the extension all read or are generated from it.
- **D10. Back compatibility.** `embed.js` with `data-pass` behaves as today. Without it, it uses D3. No new URL needed if the branch is attribute detection. Add a kill switch per partner (extend `suspended` to the token mint, `/embed/start` and `/embed/exchange`).
- **D11. Start abuse control.** `/partner/start` requires a signed-in, email-verified org owner. It is rate limited. Test mode runs against stubs for the telephony, voice AI, mail and enrichment suppliers.

### 5.2 Ordered build steps

Each step ships on its own. Order follows dependency, not appeal.

**S0. Freeze the contract (docs only).** Write D1-D11 and the snippet schema into `backend/docs/partners/` (new file `snippet-contract.md`). Answer the CONFIRM items. No tests.

**S1. Allowlist function, audit and metrics.** Depends on S0.
- Files: `services/partners.py` (`origin_allowed`, localhost rule, `clean_origins` stays for http(s)), `services/embed.py` (`frame_ancestors` uses it), `api/embed.py` (frame policy short cache and timeout), `services/partners.py` `PT.audit` new actions `origin_denied`, `partner_started`, `popup_signin`.
- Tests (`tests/test_embed.py`): live partner rejects localhost and `http://`; test partner accepts localhost on any port; missing `Origin` rejected on new endpoints; wildcard rejected for live; existing frame-policy tests at `:198-203` still pass.

**S2. Self-serve start.** Depends on S1 and D11.
- Files: `api/partners.py` (`POST /partner/start`), `services/partners.py` (create partner as `partner_approve` does, plus terms in one step), `frontend/src/settings/PartnerProgram.jsx` (single "Start in test mode" button, show snippet), test-mode supplier stubs (verify first what exists).
- Tests (`tests/test_partner.py`): one call creates a test-mode partner with `pk_` and terms accepted; rate limit; unverified org refused; no live behaviour before staff approval; test mode makes no supplier call (new test). Keep `/apply` and approval for legacy. Existing fixtures at `test_partner.py:44-57` keep working.

**S3. `/embed/start`, `/embed/exchange` and snippet-only loader.** Depends on S1.
- Files: `api/embed_connect.py` or new `api/embed_start.py` (do not change the existing handlers that reject `Origin`), `services/embed.py` (`mint_state`, `read_state`, `exchange_code`), `auth_middleware.py` public-route list `:53-61`, `frontend/public/embed.js` (branch in `show()`, "Connect Outreach" button, flat `data-*` theme attributes, `data-v`, loader trace id header, plain-language errors), `services/embed_theme.py` (validate attributes, reuse `cleanLogo`).
- Tests: state is single use and expires; wrong `Origin` refused; replay refused; code exchange single use; `data-pass` flow unchanged (regression, `test_embed.py`); unknown component gives a message naming the valid ones; theme attribute with bad colour or non-https logo rejected; no supplier names in responses (grep test); responses run inside `partner_scope` so credit lines carry `partner_id`.

**S4. Popup page and remembered session.** Depends on S3.
- Files: `frontend/src/embed/ConnectScreen.jsx` (accept `state`, show origin, silent complete on existing session, `window.opener.postMessage` with pinned origin; `fromParent` in `bridge.js:43-53` needs an opener variant), `frontend/nginx.conf` (own location for the top-level popup with `frame-ancestors 'none'`), `api/embed_connect.py` (popup-initiated login/signup entry that accepts `state` and sets `external_id` per D8), `models.py` and `core/migrations.py` (`partner_links.identity_source`, idempotent `ADD COLUMN IF NOT EXISTS`; no Alembic).
- Tests: framing the popup is refused for every origin; two users cannot squat an id; a different `pk_` cannot reuse a `state`; popup closed or blocked leaves a usable button; remembered session completes with no password; existing `test_embed_connect.py` cases (`:53-188`) still pass for the server-minted path; `test_one_person_cannot_be_linked_to_two_accounts` (`:107`) still holds.
- Manual matrix: Chrome with third-party cookies blocked, incognito, Safari, Firefox. Record the result in the brief's follow-up.

**S5. Snippet kit (the zip).** Depends on S2, S3, S4 contract frozen.
- Files: `partner_kit/__init__.py` (new `snippet` stack; binary entries via `z.write`; exclude placeholder check for bundled files; do not template compiled JS), `partner_kit/templates/snippet/` (README with three steps: add domain, paste snippet, test; `config.json` with `pk_` and host; `outreach-test.html`), `api/partners.py` `starter_kit`. No `psk_`, no `whsec_`, no server route.
- Tests (`tests/test_partner_kit.py`): the zip contains only `pk_`; no `psk_`/`whsec_` string; snippet matches the schema snapshot; no leftover placeholders; no supplier names; deterministic content hash. The five existing stack tests (`:22-164`) stay, because those stacks remain for the signed upgrade. `files()` at `:16-18` decodes as UTF-8, so binary entries need a separate helper.

**S6. Browser extension, unpacked, Chrome only.** Depends on S3, S4.
- Files (new `extension/` directory, committed build output so the zip copies it): `manifest.json` (MV3, `side_panel`, permissions `sidePanel`, `storage`, `identity`, `activeTab`, `optional_host_permissions` for opted-in sites, fixed `key`, `minimum_chrome_version`, no `<all_urls>` in `host_permissions`, `externally_connectable` explicit or absent), a service worker (non-persistent: tokens in `chrome.storage.session`, refresh via alarms; all network calls go through it), a side-panel page that frames `{host}/embed/ext`, a small content script (page context read only, runs in the isolated world), icons at 16/48/128. Sign-in with `chrome.identity.launchWebAuthFlow` to the hosted sign-in page, redirect `https://<id>.chromiumapp.org/`, one-time code exchanged for a token with `src: "ext"`. Backend: `/embed/ext` route and its own frame policy, token claim, `X-Outreach-Client: extension/<version>` header with a minimum version check that answers "please update".
- Tests: manifest lint (MV3, permissions allowlist, no broad hosts, icons present); `/embed/ext` frame policy allows only the pinned ID; partner snippet token refused on `/embed/ext` and ext token refused on partner routes; component scoping and cross-org denial for the ext token; kit still ships only `pk_`.
- Playwright or manual: side panel on a strict-CSP page (GitHub), service worker restart mid-session, microphone prompt for voice (also check against `HumanCallHost.jsx`, which is in progress).

**S7. Go-live review.** Depends on S1 and S2. Independent of S5 and S6.
- Files: `api/admin_portal.py:1269-1351` (show sandbox mint count, distinct origins seen, last denials, linked users to the reviewer), `api/partners.py:242` `request-live` (requires at least one live-valid origin, no localhost), per-link daily credit ceilings for `voice` enforced server-side, revocation version counter checked with a short cache (replace per-process-only `forget()` reliance), debounce `last_login_at` in `services/embed.py:175-179`.
- Tests: cannot go live with only localhost or `http://`; live flip tightens the allowlist; revoke takes effect on a second worker within the cache TTL; ceiling stops a call.

**S8. Chrome Web Store submission (non-code track, start after S6 first working build).** Needs a privacy policy URL, single-purpose statement, permission justification, support page and a stable extension ID. Plan for review lead time. Keep rollout flagged per partner.

**S9. Partner billing and top-up.** Last, as agreed.

### 5.3 Deferrals (in order)
1. Branding beyond colour, radius, font key and validated logo (e.g. per-component overrides).
2. Components beyond `leads` plus one of `email` or `voice` in the extension. `social`, `campaigns`, `mail` follow through `COMPONENTS` entries.
3. Journeys in the extension.
4. Partitioned-cookie remember-me inside the iframe.
5. Signed server-call identification (`psk_`, `Outreach-Account` header) and the merge rule with popup identities.
6. Test+live key pairs.
7. Firefox, Edge, Safari builds.
8. Removing `data-pass` and the stack kits, once no live partner uses them.

### 5.4 Cross-cutting rules for every step
- Every route that creates a link ends in the one existing `PT.connect` function and one token mint. No second path into `PartnerLink`.
- New embed-token branch only in `auth_middleware.py:328-343`.
- Run new endpoints inside `EM.partner_scope(...)`, with a test asserting `partner_id` on the credit line.
- Queries on `partners`, `partner_links`, `partner_audit` filter explicitly or run in `system_scope()`.
- Responses, errors, the zip and the extension contain no supplier names. Add a grep test over built artefacts and JSON bodies.
- Schema changes are idempotent `ADD COLUMN IF NOT EXISTS`. Rollback is "ignore the columns".
- Log redaction must cover the new `state` and `code` values (check `install_log_redaction` in `main.py`).

### 5.5 Open questions the user must answer before S0 ends
1. Is one shared Outreach extension acceptable, with "any site, user opts in" replacing "only the partner's listed addresses" for the extension (D5)?
2. Is "one click per visit, no password" an acceptable meaning of "we remember them" (D4)?
3. Which components does the extension ship with first?
4. Who owns the store listing and the privacy policy?
5. Can test mode be proven supplier-free today? If not, S2 gains a work item.
