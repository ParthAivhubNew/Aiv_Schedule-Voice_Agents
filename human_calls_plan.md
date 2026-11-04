# Human calls (browser phone) - plan

Goal: a user clicks Call on a lead (or types a number) and talks to that person themselves, from the browser, with no AI on the line. Telnyx supplies the browser phone (WebRTC). No new carrier, no new vendor.

## 1. What Telnyx gives us (checked on developers.telnyx.com)

- JS SDK `@telnyx/webrtc` (browser mic and speaker, mute, hold, DTMF, device pick).
- Login flow: create a **credential connection** (once per org) -> create a **telephony credential** under it (once per user) -> request a **login token** (JWT, 24 h) -> browser logs in with the token. The user never sees a Telnyx key.
- Outbound: any number the connection's **outbound voice profile** allows, shown with a caller ID we own. On-demand credentials are for outbound; inbound is only to the credential's SIP address, so inbound to a normal number is out of scope for release 1.
- Price: about $0.002/min for the browser leg, plus the normal PSTN leg. Confirm on the live pricing page before quoting users.
- No official reseller or white-label terms found. We already resell Telnyx minutes as credits, so this is the same model. Ask Telnyx sales in writing before launch.

## 2. What the code already has (checked)

| Need | Already there | Where |
|---|---|---|
| Two account modes (own managed account, or our key + org billing group) | yes | `telnyx_provisioning.py` (`client_for`, `outbound_route`, `OrgTelnyx`) |
| Per-org outbound profile with spend limit and country list | yes | `telnyx_client.create_outbound_voice_profile` |
| Org-owned numbers | yes | `OrgPhoneNumber` |
| Credits per voice minute, reserve then charge | yes | `credits.py` (`voice_minute`, `reserve_call`, `charge_finished_call`) |
| Call history rows | yes | `CallLog` (has `lead_id`, `phone`, `our_number`, `direction`) |
| Do-not-call flag | yes | `ContactRegistry.do_not_call` |
| Take-over of an AI call by ringing the user's phone | yes, different feature | `voice_takeover.py` |
| Browser phone, credentials, JWT | **none** | no `@telnyx/webrtc`, no `telephony_credentials` anywhere |
| Calling-hours check for a call | not found in `outbound_dial.py` or `call_limits.py` (check the schedule code in the Calling workspace) | verify |

## 3. Design

### 3.1 Backend
New file `services/human_calls.py`, new routes `api/human_calls.py` (`/human-calls/...`), registered in `main.py`, `permissions.py` (voice plugin), nothing public.

Telnyx client additions (`telnyx_client.py`):
- `create_credential_connection(name, outbound_voice_profile_id)` -> POST `/credential_connections`
- `find_credential_connection(name)`
- `create_telephony_credential(connection_id, name)` -> POST `/telephony_credentials`
- `telephony_credential_token(credential_id)` -> POST `/telephony_credentials/{id}/token` (returns the JWT as plain text)
- `delete_telephony_credential(id)`

New table `HumanCallSetup` (per org, RLS, add to `TENANT_TABLES`): `connection_id`, `status`.
New table `HumanCallCredential` (per user): `user_id`, `credential_id`, `created_at`. One credential per user, created on first use, deleted when the user is removed.

Routes:
1. `POST /human-calls/session` -> makes sure the org has a credential connection (reuse the org's outbound voice profile and key from `client_for`), makes sure the user has a credential, returns `{token, caller_ids:[...], rate, balance_minutes}`. Token is never stored.
2. `POST /human-calls/start` `{to, from, lead_id?}` -> server checks (below), creates a `CallLog` row with `direction=outbound`, `channel=voice`, `mission="human"`, reserves credits, returns `{call_ref}`. The browser then dials with the SDK.
3. `POST /human-calls/{call_ref}/end` `{duration_s, outcome, note}` -> browser reports the end; server charges the minutes and saves the outcome and note. A sweeper closes any row left open (tab closed) using the Telnyx call detail record, so credits are never silently free or double-charged.
4. `GET /human-calls` -> history for the screen.

Checks before a call (server side, because the browser is not trusted):
- user may use the voice plugin; org setup is `ready`
- number is valid E.164 and its country is on the org's outbound profile list
- number is not on `ContactRegistry.do_not_call` or the org's suppression list
- caller ID is a number the org owns (`OrgPhoneNumber`, active)
- credits cover at least 1 minute (reuse `reserve_call` logic)
- calling hours for the lead's timezone (reuse the Calling schedule rules; if none exist for single calls, warn but allow, because the person is dialling by hand)
- daily spend limit comes from the Telnyx outbound profile, which already blocks past the limit

Recording: **off in release 1.** Recording needs a spoken notice and consent rules (UK). Added later as an option with a notice played to the called party.

### 3.2 Frontend
- `plugins/voice/calling/HumanCallPanel.jsx`: dial pad, number field, caller ID picker, mute, hold, hang up, timer, mic permission prompt, "ringing / connected / ended" states, outcome and note form on hang up.
- `humanCallLogic.js` (+ vitest): number clean-up, state machine, minutes left.
- Load `@telnyx/webrtc` only when the panel opens (dynamic import), so the app bundle does not grow.
- Entry points: "Call" button on a lead card/drawer in Leads (Find Leads and Accounts), "Call yourself" in the Voice > Calling workspace, and the existing live-call card ("Take over in browser" as an alternative to ringing the user's phone; release 2).
- The panel lives in the corner dock area so a call survives moving between screens (same pattern as `JobDock`). A call in progress must stop page navigation from killing the audio: mount once in `App.jsx`.
- Plain wording, no supplier names (brand rule: clients never see Telnyx).

### 3.3 Billing
- Item `human_call_minute` in `credits.py` rates (wallet `voice`, same unit as `voice_minute` so one balance). Price set by the admin; default equal to `voice_minute`.
- Charge at the end for whole minutes used (round up), refuse to start with under 1 minute left, and hang up when the balance runs out (a timer in the panel plus a server `time_limit` is not available on browser calls, so the sweeper and the panel timer enforce it).

### 3.4 Compliance
- UK PECR / TPS: the user is responsible for who they call; we block our own do-not-call list and show a TPS/CTPS reminder on first use.
- Caller ID must be a number the org owns and can be called back on.
- Mic permission is requested only on press of Call.
- No recording in release 1.

## 4. Release order

1. **Release 1: call out from the browser.** Telnyx client methods, tables, session/start/end routes, panel, Call button on leads, credits, history. Tests with a fake Telnyx.
2. **Release 2: take over an AI call in the browser** instead of ringing a phone; link human calls into the lead timeline and journeys (task "call this person" -> Call button).
3. **Release 3: recording with notice, voicemail drop, inbound to the browser** (needs a number-to-browser route through a Call Control app, different from credentials).

## 5. Tests
- Backend (fake Telnyx): session makes one connection and one credential per user (second call reuses); DNC number refused; foreign country refused; caller ID not owned refused; no credits refused; end charges rounded-up minutes once (double `end` call charges once); sweeper closes an open row; RLS: org A cannot read org B's calls.
- Frontend: number clean-up, state machine, minutes-left, panel hidden without the voice plugin.
- Live (read-only first): `POST /human-calls/session` returns a token; the SDK logs in. Placing a real call is done by the user on a number they choose, never by me.

## 6. Risks and open questions
- Reseller terms for WebRTC minutes (ask Telnyx).
- Which mode each org is in (managed account vs billing group): the credential connection must be created under the key that owns the outbound profile. The plan uses `client_for(setup)` for both modes; confirm the billing-group mode can create credential connections on our key without leaking one org's credentials into another.
- Browser audio: corporate firewalls, Safari mic rules. The SDK needs HTTPS; the app is HTTPS in production.
- A call left open when the tab closes: handled by the sweeper, tested.
- Caller ID: a user with no number cannot call. Show "Get a number" first.
