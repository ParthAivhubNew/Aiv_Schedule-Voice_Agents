# Human calls (browser phone) - plan, version 3

Goal: a user clicks Call on a lead (or types a number) and talks to that person themselves from the browser, with no AI on the line. Telnyx supplies the browser phone (WebRTC). No new vendor. **Version 3 adds saved call transcripts (recording, speech-to-text, summary), charged in credits.**

Version 2 fixed the first draft after three reviews (design, code check, readiness). Every code claim below was checked against the repo.

## 1. What Telnyx gives us (developers.telnyx.com)

- JS SDK `@telnyx/webrtc`: browser mic and speaker, mute, hold, DTMF.
- Login flow: **credential connection** (a SIP connection, made once per org) -> **telephony credential** (a login under it) -> **token** (JWT, 24 h) -> the browser logs in with the token. The user never sees a Telnyx key.
- Outbound only for now. Inbound to a normal number is not part of this (credential calls come in only by SIP address).
- Price about $0.002/min for the browser leg plus the normal phone leg. Check the live pricing page before quoting.
- No official reseller or white-label terms found. Same resale model as our AI minutes, but get Telnyx's answer in writing (gate G1).

## 2. Go / no-go gates before any code

- **G1, owner Parth:** Telnyx confirms in writing that reselling browser-call minutes is allowed. If not, stop.
- **G2, spike on one test org with a real Telnyx key (I write the script, Parth runs it; one call to Parth's own phone):** confirm four things: (a) a credential made with a short `expires_at` stops working after it; (b) `webhook_event_url` on the credential connection delivers call events carrying the SDK's `clientState`; (c) the call can be hung up from our side, or else the credential expiry is the only hard stop; (d) the caller ID cannot be changed by the browser beyond numbers we own. (e) **recording:** whether a credential-connection call can be recorded on Telnyx's side (a `record` setting on the connection, or Call Control commands on it) and whether it saves a two-channel file (you on one channel, them on the other). If not, the fallback is recording in the browser (section 5.4). Any "no" changes section 5 as written there.

## 3. What the code already has (verified)

| Need | Where |
|---|---|
| Per-org Telnyx row: `OrgTelnyx` (id = org id; `mode`, `status` new/ready/error, `connection_id`, `outbound_voice_profile_id`, `outbound_connection_id`, `allowed_countries`, `last_error`) | `models.py` ~1034, `telnyx_provisioning.py` (`get_setup`, `client_for`, `ensure_setup`, `_create_or_reuse`, `scrub`) |
| Keys: managed account uses its own key; billing-group uses `platform_key()` | `client_for` |
| Org-owned numbers | `OrgPhoneNumber` (needs `provider == "telnyx"`, `provider_ref != ""`, `status == "active"`, as `outbound_route` checks) |
| One gate for a call: do-not-contact list, business opt-outs, contact flag, credits (`can_start`), calling hours in the callee's timezone, enforcement mode (off/warn/block) | `compliance.check_call_allowed(db, to)` (`compliance.py:291`); already used by `calls.py`, `outbound_dial.py`, `lead_calls.py` |
| Credits: hold then charge once, idempotent | `credits.reserve_call(db, call_id)`, `charge_finished_call(db, call_id, "N min")`, ref `call:{log_id_for_call}`; `settle()` also charges every `CallLog` with `channel="voice"` |
| Zero-balance switch-off | `voice_access.sync` / `_switch_off` / `_switch_on` |
| Call history | `CallLog` (required: `canonical_name`, `listed_as`, `started_at`, `ended_at`; has `lead_id`, `phone`, `our_number`, `direction`, `outcome`, `mission`, `summary`; **no user column**) |
| Webhook signature check | `telnyx_signature.py` |
| Download and keep a Telnyx recording (links expire) | `voice_takeover.save_recording` -> `call_recorder.RECORDINGS_DIR/<id>.mp3` |
| Summary of a finished call from its transcript lines | `call_summary.summarize_finished`, `summarize`, `spoken` |
| Speech-to-text engines saved as platform connections (group "Speech-to-Text": Deepgram, Telnyx Whisper) | `Connection` rows, `connections.py`, `platform_balances.py` (Deepgram balance) |
| **Transcribing a finished audio file** | **none today.** Speech-to-text exists only live inside the AI assistants. A batch step must be written (`services/transcribe.py`) |
| Recording consent / notice logic | **none** in `compliance.py` |
| Plugin key for permissions | `"calling"` (labelled Voice), route map in `permissions.py` ~139 |
| Browser phone, credentials, JWT | **none** |

## 4. Data (all tenant tables carry `org_id = Column(String, index=True, server_default=FetchedValue())` and go in `TENANT_TABLES`, `core/tenancy.py:35`)

- `OrgTelnyx`: add `credential_connection_id`, set inside `ensure_setup` so it inherits `_create_or_reuse` and the `_complete` check. In **managed-account mode there is no outbound voice profile today**: `ensure_setup` must create one on the managed key (countries from `allowed_countries`, daily spend limit mandatory, `max_destination_rate` set) and store its id. Without it the browser has no country list or spend cap.
- New table `HumanCall` (one row per call; id = `call_ref`): `org_id`, `user_id`, `lead_id`, `to_e164`, `from_e164`, `credential_id`, `state` (`started` / `ringing` / `answered` / `ended` / `abandoned`), `started_at`, `answered_at`, `ended_at`, `telnyx_session_id`, `billed_minutes`, `outcome`, `note`, `warnings` (JSON), `created_at`; for transcripts: `record` (bool, user's choice), `consent_ack` (bool), `recording_path`, `transcript_state` (`none` / `waiting` / `working` / `ready` / `failed`), `transcript_error`, `transcript_charged` (bool), `transcript_seconds`, `audio_delete_at`. The transcript text itself goes on `CallLog.transcript` (list of lines, same shape the AI calls use, speaker-labelled "You: ..." / "Them: ...") and the summary on `CallLog.summary`. `OrgTelnyx` or an org setting gets `record_default` (on/off) and `audio_keep_days` (default 30). Unique index on `id`; index on (`org_id`, `user_id`, `state`).
- No `HumanCallCredential` table: credentials are **per call** (section 5), the id lives on `HumanCall`.
- `CallLog`: one row per call, made at `/start`, id from `credits.log_id_for_call(call_ref)` so the credit ref matches; `canonical_name`/`listed_as` = lead name or the number; `channel="voice"`, `mission="human"`, `direction="outbound"`, `phone`, `our_number`, `lead_id`; `started_at`/`ended_at` filled at start and corrected at end. Who made it is on `HumanCall.user_id`.
- Migration: additive columns and one table in `core/migrations.py`, same style as earlier ones.

## 5. Backend

New `services/human_calls.py`, `api/human_calls.py` (`/human-calls/...`), registered in `main.py`; permission rule `^/human-calls(/|$)` -> `"calling"` in `permissions.py`; the Telnyx event webhook path is public but signature-checked (`telnyx_signature`) and added to `auth_middleware` public paths.

Telnyx client methods (`telnyx_client.py`): `create_credential_connection`, `find_credential_connection` (match by exact name), `create_telephony_credential(connection_id, expires_at)`, `credential_token(id)`, `delete_telephony_credential(id)`, `update_credential_connection(active=...)`. Exact bodies are fixed in the G2 spike and written into the code as constants with a test per call.

### 5.1 Setup (inside `ensure_setup`)
Credential connection named `"{org name} ({org id})"`, created with `_create_or_reuse` under the org's key (`client_for`), with `outbound_voice_profile_id = setup.outbound_voice_profile_id`, `webhook_event_url` -> our event endpoint. Before any token is issued, assert the connection's profile equals the org's profile (otherwise raise: it would bill the platform with no limits). Per-org lock (`SELECT ... FOR UPDATE` on the `OrgTelnyx` row) around first creation.

### 5.2 Routes
1. `POST /human-calls/start` `{to, from, lead_id?}`:
   - `check_call_allowed(db, to)` once (opt-outs, credits, calling hours). `block` mode -> 403 with its reasons; `warn` mode -> continues, warnings returned and saved on the row. Applies to typed numbers too, not only leads.
   - `from` must be an active `OrgPhoneNumber` of provider `telnyx` with `provider_ref` and voice capability; otherwise 400 "Get a number first" (the panel links to the numbers page).
   - country of `to` must be in `allowed_countries`.
   - one open call per user (409 if another is `started`/`ringing`/`answered`).
   - makes the `CallLog` and `HumanCall` rows, a `LiveCall` row (state "human") so the credit hold is not released by `_release_ended_call_holds`, and `credits.reserve_call` (402 when it refuses).
   - creates a credential for this call with `expires_at = now + reserve cap + 5 min`, takes its token, returns `{call_ref, token, login, client_state=call_ref, max_seconds}`. The token exists only for this call.
2. `POST /human-calls/{call_ref}/connected` `{sdk_call_id}`: sets `ringing`/`answered`; only the owning user of the row (404 otherwise).
3. `POST /human-calls/{call_ref}/end` `{outcome, note}`: owner only; sets `ended`; **duration is computed by the server** (answer time to now, later corrected by the event webhook), never taken from the browser; calls `charge_finished_call` with an "N min" string (minimum 1 minute if answered, 0 if never answered); deletes the credential; ends the `LiveCall`. Calling `/end` twice charges once (credit ref is idempotent).
4. `POST /api/human-calls/events` (Telnyx webhook, signed): on `call.answered` / `call.hangup` find the row by `clientState` = `call_ref`, set `telnyx_session_id`, the true duration and `ended`; if no open row matches, log it and (if G2c allows) hang the call up. This is the authority for duration and closes calls whose tab died. A background sweep (existing scheduler, every 5 min) marks rows `started` for more than 10 min with no event as `abandoned`, releases the hold, charges 0, deletes the credential.
5. `GET /human-calls/mine`: the user's last 20 calls for the panel (history screen is later).

Errors: every refusal returns `{error, code}` with plain wording and no supplier name (all strings pass `scrub`); Telnyx failures during `/start` roll back the rows, release the hold and delete a half-made credential.

### 5.4 Transcripts (new in version 3)

**Flow:** user ticks "Record and transcribe" (default from the org setting) and confirms the notice -> call is recorded -> after hang up the audio is fetched -> speech-to-text -> lines saved -> AI summary -> credits charged -> the panel and the lead show it.

1. **Recording source (decided by gate G2e):**
   - *Preferred:* recorded by Telnyx, two channels (you / them), saved as mp3; the events webhook gets `call.recording.saved`; `voice_takeover.save_recording` pattern downloads it at once (the links expire). Cost about $0.002/min.
   - *Fallback:* the browser records both audio tracks (your microphone and the remote voice, taken from the SDK's media streams) with `MediaRecorder` and uploads in 30-second chunks to `POST /human-calls/{call_ref}/audio` (owner only, size capped, accepted only while the call is open or within 10 min of its end), so a closed tab loses at most the last chunk. No Telnyx cost. Weaker on Safari and sleeping tabs, so it is used only if Telnyx cannot record these calls.
   - Two separate tracks means no guessing who spoke: each is transcribed alone and merged by time.
2. **Speech-to-text:** new `services/transcribe.py`, one function `transcribe(path) -> [{speaker, start, text}]`, using the engine saved under the platform's Speech-to-Text connection (Deepgram pre-recorded with multichannel, else Telnyx/Whisper). Platform key, never shown to clients. Cost to us about $0.0074/min (Deepgram) to $0.015-0.025/min (Telnyx); confirm the live rate and that the chosen engine accepts recorded files.
3. **Job:** a background task started by `/end` (and by the recording-saved event), with state in `HumanCall.transcript_state`. Retries twice with backoff; then `failed`. Idempotent: a second run on a `ready` row does nothing. `POST /human-calls/{call_ref}/transcribe` lets the owner retry a failed one.
4. **Result:** lines saved to `CallLog.transcript`; `call_summary.summarize_finished` writes the summary; calls under 2 spoken lines get no summary (`MIN_LINES`) and cost no summary credit. The outcome and note the user typed stay as they are.
5. **Credits:** new rate item `call_transcript` in `credits.py` (wallet `voice`, unit "minute of call"), default 1 credit per minute, price editable by the admin like the other items. Set it from the real cost: recording + speech-to-text + summary is roughly $0.01-0.04 per call minute, so check 1 credit against what a credit sells for. Charged **after** the transcript is saved, for the call's whole minutes (minimum 1), ref `transcript:{call_ref}` so a retry or a duplicate task never charges twice. Failed transcript: nothing charged. If the balance is too low at that point, the transcript is still saved and charged as the rest of the system does for a shortfall (debt, as `_take` already allows).
6. **Before the call:** when "record" is ticked, `/start` checks credits for both rates together (the call's `max_seconds` = balance / (`voice_minute` + `call_transcript`)); the panel shows "2 credits a minute with transcript".
7. **Consent and privacy:** the panel shows a notice the user must confirm ("I will tell the person this call is recorded and transcribed") and a line to read out. `consent_ack` is stored with the call. No consent, no recording. Recording is never on for calls to numbers on our opt-out lists (they are refused earlier anyway). Audio is deleted after `audio_keep_days` (default 30) by the existing sweep; the text stays until the lead or the call is deleted. Deleting a lead deletes its call audio and transcripts. Rules differ by country (UK: tell the person and have a lawful reason; some US states and EU countries need clear consent from every party), so the notice text and a per-country block list are an org/admin setting and are reviewed by whoever handles your legal side before launch.
8. **Access:** transcripts and audio use the same `calling` permission; audio is served through an authenticated route, never a public link.

### 5.3 Money safety
- One charging path: `voice_minute` at the existing rate through `charge_finished_call`; no new rate item (so `settle()` cannot bill the same call twice). Price changes are the admin's existing `voice_minute` price.
- The hold size sets `max_seconds`; the panel counts down and hangs up at the cap; the credential's `expires_at` is the server-side backstop (G2a).
- `voice_access._switch_off` also sets the credential connection inactive and `_switch_on` restores it, so zero credits stops browser calls in both account modes.
- Daily spend limit on the org's outbound profile is mandatory (no empty value), plus `max_destination_rate`.
- The token is the only secret that reaches the browser, is valid for one call, and its issuance is written to the process log.

## 6. Frontend (release 1)

- `plugins/voice/calling/HumanCallPanel.jsx` and `humanCallLogic.js` (+ vitest): dial field, caller ID picker, Call, mute, hang up, timer with countdown, "ringing / connected / ended" states, mic-denied message, outcome (`talked`, `no_answer`, `voicemail`, `wrong_number`, `callback_requested`, `not_interested`, `do_not_call`) and a note on hang up. `do_not_call` writes the contact flag.
- SDK event mapping: `telnyx.ready` -> can dial; `telnyx.error`/socket close -> "Connection lost" and a call to `/end`; call states `trying/requesting/ringing` -> ringing, `active` -> connected, `hangup/destroy` -> ended. `@telnyx/webrtc` loads when the panel opens (dynamic import).
- Closing the tab sends `/end` through `navigator.sendBeacon`; the webhook and sweep cover the rest.
- Entry points: a Call button on a lead (Find Leads drawer and Accounts) opening the panel in a modal, and the panel inside the Calling workspace. Gated by the `calling` plugin. Wording never names the supplier.
- Transcripts (release 1B): a "Record and transcribe" switch with the notice and a red "Recording" mark during the call; after the call the form shows "Transcript is being made" then the result. A **Transcript** view (also from the lead's call list and the Phone tab history): speaker-labelled lines with times ("You" / "Them"), the summary on top, an audio player, copy text, and a retry button when it failed. Credit cost is shown before and after ("3 min call + 3 min transcript = 6 credits").
- Not in release 1: corner dock that survives navigation, hold, keypad, device picker, history screen, extra entry points.

## 7. Releases

1. **Release 1:** gates G1-G2, setup in `ensure_setup` (including the managed-mode outbound profile), start/connected/end/events/sweep, credits, panel in a modal and the Calling workspace, Call button on leads.
1B. **Release 1B (right after 1, same gates):** recording (Telnyx or browser fallback per G2e), `transcribe.py`, transcript job, `call_transcript` credit item, consent notice, transcript view, retention sweep.
2. **Release 2:** corner dock mounted once in `App.jsx` (not behind the operator gate that `JobDock` uses), hold/keypad/device picker, history screen, "Take over in browser" for an AI call: the Call Control leg dials `sip:<login>@sip.telnyx.com` with a `client_state` marker like `voice_takeover.encode_leg`, plus hand-back.
3. **Release 3:** an automatic spoken "this call is recorded" notice played to the other person, live transcript during the call, voicemail drop, inbound to the browser (needs a number-to-browser route).

## 8. Tests

Backend (fake Telnyx HTTP client; real Postgres as in the other suites):
- setup makes one connection and reuses it; concurrent first calls make one; connection with the wrong profile refuses to issue a token; managed mode creates the outbound profile.
- `/start`: opted-out number refused; `block` vs `warn` hours; foreign country refused; caller ID not owned / not telnyx refused; no credits refused (402); second open call refused (409); Telnyx failure rolls back and releases the hold.
- `/end` and `/connected`: other user and other org get 404; duration comes from the server, a browser value is ignored; unanswered call charges 0; answered call charges at least 1 minute; double `/end` charges once; settle does not bill it again; the hold survives `_release_ended_call_holds` while the call is open.
- events webhook: bad signature refused; unknown `clientState` ignored; hangup closes and corrects duration; sweep marks abandoned and releases the hold, idempotent, and a late `/end` after it does nothing.
- `voice_access` switch-off disables the credential connection and switch-on restores it.
- RLS: org A cannot read org B's `HumanCall`.
- Transcripts (fake speech-to-text and fake recording): no consent, no recording; transcript saved speaker-labelled in time order; charged once after success (second run and retry charge nothing more); failed transcript charges nothing and can be retried; `/start` with record on needs both rates; short call (under 2 lines) has no summary; audio route refuses other users and other orgs; chunk upload size cap and late-upload window; retention sweep deletes audio but keeps text; deleting a lead removes its audio and transcripts.
Frontend: number clean-up, state machine from SDK events (SDK mocked), countdown, outcome form, panel hidden without the `calling` plugin.
Live acceptance (Parth runs, one call to his own phone): token issued, call connects both ways, hang up charges 1 minute exactly once, the row and history show the outcome, credits match, zero-credit org cannot start. I never place calls.

## 9. Risks

- G1 or G2 fail: stop or adjust before building.
- Billing-group mode shares one platform key; isolation is the per-org connection, its own profile, and the assertion in 5.1.
- Recording and storing voices is regulated (consent, retention, erasure). The notice, retention and country rules in 5.4 need review by whoever advises you on law before launch; this plan is not legal advice.
- Transcript accuracy: accents, phone-line noise and names are often wrong. The UI says "automatic transcript" and keeps the audio so it can be checked.
- Cost drift: if the speech-to-text rate changes, the `call_transcript` price must follow; the admin cost report already tracks platform spend per provider.
- UK rules: the user is responsible for who they call (TPS reminder as a static line); our own list and hours rules are enforced by `check_call_allowed`.
- Browser limits: HTTPS required (production has it), Safari/mic permissions, corporate firewalls.
