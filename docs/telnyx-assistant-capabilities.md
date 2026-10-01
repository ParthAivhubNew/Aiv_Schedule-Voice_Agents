# Telnyx AI Assistant: capabilities and configuration reference

Research for rebuilding Telnyx AI Assistant setup inside OutReach by Aivhub, so clients never need to open Telnyx.

- **Researched:** 2026-10-01
- **Sources:** developers.telnyx.com only. Field data comes from the OpenAPI schemas embedded in each API-reference page (`<page>.md`). Guide text comes from the published `llms-full.txt` dumps.
- **Base URL:** `https://api.telnyx.com/v2`. Auth: `Authorization: Bearer <API key>`.
- **Not reachable:** `telnyx.com` (marketing and pricing pages) was blocked by this environment's network policy. Every price taken from telnyx.com is marked **UNCONFIRMED**.
- **UNCONFIRMED** means the Telnyx developer docs do not state it. Nothing here is guessed. Where something is inferred, the doc says "inferred" and gives the reason.

Reference URLs used throughout:

| Short name | URL |
|---|---|
| CREATE | https://developers.telnyx.com/api-reference/assistants/create-an-assistant |
| UPDATE | https://developers.telnyx.com/api-reference/assistants/update-an-assistant |
| START | https://developers.telnyx.com/api-reference/call-commands/start-ai-assistant |

---

## 1. Assistant object

### 1.1 Endpoints

| Action | Method and path | Notes | Doc |
|---|---|---|---|
| Create | `POST /ai/assistants` | Required: `name`, `instructions`. Optional `Idempotency-Key` header (1–255 chars, `[A-Za-z0-9_-]`). | CREATE |
| Update | **`POST /ai/assistants/{assistant_id}`** | Telnyx uses POST here, **not PATCH**. All fields optional. Adds `version_name` and `promote_to_main` (see 1.3). | UPDATE |
| Get / list / delete | `GET /ai/assistants/{id}`, `GET /ai/assistants`, `DELETE /ai/assistants/{id}` | | https://developers.telnyx.com/api-reference/assistants/get-an-assistant |
| Clone | `POST /ai/assistants/{id}/clone` | No body. The clone **excludes telephony and messaging settings**. | https://developers.telnyx.com/api-reference/assistants/clone-assistant |
| Import from another vendor | `POST /ai/assistants/import` | Body: `provider` (`elevenlabs` / `vapi` / `retell`, required), `api_key_ref` (integration secret, required), `import_ids` (string[], optional; omit to import all). | https://developers.telnyx.com/api-reference/assistants/import-assistants-from-external-provider |
| AI-improve the prompt | `POST /ai/assistants/{id}/instructions/enhance` | Body: `instructions` (string or null; defaults to stored), `enhancement_prompt` (string or null). | https://developers.telnyx.com/api-reference/assistants/enhance-assistant-instructions |
| Attach / detach a shared tool | `PUT` / `DELETE /ai/assistants/{id}/tools/{tool_id}` | | https://developers.telnyx.com/api-reference/assistants/add-assistant-tool |
| Tags | add-assistant-tag, remove-assistant-tag, get-all-tags | Paths UNCONFIRMED: pages listed but not opened. | https://developers.telnyx.com/api-reference/assistants/add-assistant-tag |
| Get the TeXML used | get-assistant-texml | Path UNCONFIRMED: not opened. | https://developers.telnyx.com/api-reference/assistants/get-assistant-texml |

### 1.2 Top-level fields (create and update)

Notation: `*` = required on create.

#### Model and prompt

| Field | Shape | Allowed / default / limits |
|---|---|---|
| `name`* | string | — |
| `description` | string | — |
| `instructions`* | string | System prompt. Supports `{{dynamic_variables}}`. |
| `greeting` | string | `""` = wait for the caller to speak first. `<assistant-speaks-first-with-model-generated-message>` = model writes the greeting. Supports variables. The `ai_assistant_start` call command caps the greeting at **3,000 chars** (START). SSML is allowed for `AWS.Polly.*` voices. |
| `model` | string | LLM id, see §2. If neither `model` nor `external_llm` is set, Telnyx's default is used (`moonshotai/Kimi-K2.6`, per guide). |
| `llm_api_key_ref` | string | Integration-secret `identifier` for a third-party model chosen by `model` (e.g. OpenAI). |
| `external_llm` | object | Bring your own OpenAI-compatible endpoint, see §2.3. |
| `fallback_config` | object | `{ model?, llm_api_key_ref?, external_llm? }`. Used when the primary LLM is down. |

#### Tools

| Field | Shape | Allowed / default / limits |
|---|---|---|
| `tools` | array | Inline tools (§7). **Deprecated for new integrations.** On update, a sent array **fully replaces** the existing one. |
| `tool_ids` | string[] | Shared tools from the Tools Library. This is the preferred way. |
| `mcp_servers` | `[{ id*, allowed_tools?: string[] }]` | Default `[]`. Servers created with `/ai/mcp_servers` (§7.3). |
| `a2a_agents` | array | Agent2Agent remote agents, see §7.4. Default `[]`. **Not on the update schema** (create only, per schema). |
| `integrations` | `[{ integration_id*, allowed_list?: string[] }]` | Default `[]`. Catalog: `GET /ai/integrations` (Salesforce, ServiceNow, Jira, HubSpot, Zendesk, Intercom, GitHub, Greenhouse per guide). Connected integrations: `/ai/integrations/connections`. |

#### Voice, transcription and behaviour

| Field | Shape | Allowed / default / limits |
|---|---|---|
| `voice_settings` | object | See §3. |
| `transcription` | object | See §5. |
| `interruption_settings` | object | See §6. |

#### Telephony and messaging

| Field | Shape | Allowed / default / limits |
|---|---|---|
| `telephony_settings` | object | See §6 and §9. |
| `messaging_settings` | object | See §9. |
| `enabled_features` | string[] | `telephony`, `messaging`. |

#### Analysis and privacy

| Field | Shape | Allowed / default / limits |
|---|---|---|
| `insight_settings` | `{ insight_group_id: string }` | Runs that Insight Group on every conversation (§10). |
| `privacy_settings` | object | `data_retention` (bool): store conversation history and insights or not. Does not affect recordings or other account-level storage. `in_transit_data_locality` (bool, default `false`): web chat only, keeps model calls inside the org's data-locality region. |

#### Dynamic variables

| Field | Shape | Allowed / default / limits |
|---|---|---|
| `dynamic_variables` | object `{name: default}` | Default values. |
| `dynamic_variables_webhook_url` | string | Telnyx POSTs to it at conversation start. The response **must** be `{"dynamic_variables": {...}, "memory"?: {...}, "conversation_metadata"?: {...}}`. A flat object is ignored. |
| `dynamic_variables_webhook_timeout_ms` | integer | Default **1500**, range 1–10000. The Memory guide still says "1-second timeout"; the schema value is used here. |

#### Web widget

| Field | Shape | Allowed / default / limits |
|---|---|---|
| `widget_settings` | object | `theme` (`light`/`dark`); `audio_visualizer_config.color` (`verdant`/`twilight`/`bloom`/`mystic`/`flare`/`glacier`); `audio_visualizer_config.preset` (string); `start_call_text`; `default_state` (`expanded`/`collapsed`); `position` (`fixed`/`static`); `view_history_url`, `report_issue_url`, `give_feedback_url`, `logo_icon_url` (string or null); `agent_thinking_text`; `speak_to_interrupt_text`. |

#### Advanced (beta)

| Field | Shape | Allowed / default / limits |
|---|---|---|
| `observability_settings` | object | Langfuse tracing: `status` (`enabled`/`disabled`), `secret_key_ref`, `public_key_ref`, `host`, `prompt_name`, `prompt_version` (int ≥1), `prompt_label`, `prompt_sync` (`enabled`/`disabled`; auto-publishes instructions to Langfuse). |
| `tags` | string[] | Default `[]`. |
| `post_conversation_settings` | `{ enabled: bool = false }` | **Beta.** Gives the assistant one more LLM turn after hang-up so it can call webhook or function tools (e.g. send a summary). Integration, MCP and call-control tools are not available in that turn. |
| `delegation_settings` | object | **Beta.** A frontend "talking" model plus a backend "working" model. Fields: `enabled` (default `true`), `mode` (`telnyx`/`client`, default `telnyx`), `model`, `llm_api_key_ref`, `instructions`, `speak_results` (default `true`), `external_llm`. |
| `websocket_settings` | `{ enabled=false, url (ws/wss, public), auth_ref }` | **Beta.** Streams conversation events to our WebSocket and accepts injected messages. Best effort: events are dropped while the socket is down. |
| `conversation_flow` | object | Visual workflow graph, see §6.4. |

### 1.3 Versions, canary, testing, scheduling

**Versions**
- `GET /ai/assistants/{id}/versions` lists versions. Get, update and delete a specific version also exist: https://developers.telnyx.com/api-reference/assistants/get-all-versions-of-an-assistant
- `POST /ai/assistants/{id}/versions/{version_id}/promote` makes a version the main one.
- On update, two extra fields apply:
  - `version_name`: string, default `"New assistant"`, max 50 chars.
  - `promote_to_main`: bool, default `true`. Set it to `false` to save a draft version without going live.

**Canary / A-B traffic split**
- `POST /ai/assistants/{id}/canary-deploys` (get, update and delete also exist).
- Body: `rules: [{ match: [{attribute, operator: in|not_in|starts_with, values: string[≥1]}], serve: { version_id } | { rollout: [{version_id, weight 0–100}] } }]`.
- An empty `match` catches everything.
- Doc: https://developers.telnyx.com/api-reference/assistants/create-canary-deploy

**Automated tests**
- `POST /ai/assistants/tests` with body:
  - `name`* (1–255)
  - `description` (≤1000)
  - `telnyx_conversation_channel`: `phone_call`/`web_call`/`sms_chat`/`web_chat`, default `web_chat`
  - `destination`*
  - `max_duration_seconds` (1–3600)
  - `test_suite` (≤100)
  - `instructions`* (1–5000)
  - `rubric`*: `[{name, criteria}]`, at least 1 item
- Run, history and suite endpoints also exist.
- Doc: https://developers.telnyx.com/api-reference/assistants/create-a-new-assistant-test

**Scheduled calls / SMS**
- `POST /ai/assistants/{id}/scheduled_events` with body:
  - `telnyx_conversation_channel`* (`phone_call`/`sms_chat`)
  - `telnyx_end_user_target`*
  - `telnyx_agent_target`*
  - `scheduled_at_fixed_datetime`* (ISO 8601)
  - `text` (required for SMS)
  - `conversation_metadata`, `dynamic_variables`
  - `max_retries_client_errors`: 0–10, default 0, phone only
  - `retry_interval_secs`: 60–86400, phone only
  - `call_settings.sip_region`: `US`/`Europe`/`Canada`/`Australia`/`Middle East`
- Doc: https://developers.telnyx.com/api-reference/assistants/create-a-scheduled-event

**Cost of versions, tests and canary:** UNCONFIRMED. Test runs presumably bill as normal conversations, but the docs don't say.

---

## 2. Models (LLM)

### 2.1 Listing models
- **Endpoint:** `GET /ai/openai/models`. The older `GET /ai/models` is deprecated.
- **Doc:** https://developers.telnyx.com/api-reference/openai-chat/get-available-models-openai-compatible

Each item in `data[]` has these fields:

| Field | Meaning |
|---|---|
| `id` | e.g. `moonshotai/Kimi-K2.6` |
| `owned_by` | `Telnyx` for hosted models, the upstream provider for proxied ones, or the org id for fine-tunes |
| `organization` | — |
| `task` | `text-generation`, `audio-text-to-text`, `feature-extraction` |
| `context_length` | — |
| `max_completion_tokens` | — |
| `languages[]` | — |
| `parameters`, `parameters_str` | Model size |
| `tier` | `small` / `medium` / `large` / `unlisted` |
| `license` | — |
| `is_fine_tunable` | — |
| **`recommended_for_assistants`** | bool. Use this to filter the list we show clients. |
| `is_vision_supported` | — |
| `description` | — |
| **`pricing`** | Map of `prompt` / `cached_prompt` / `completion` → price string, plus `currency` and `unit`. **Use this for live per-model pricing.** |
| `regions[]` | — |
| `service_tiers[]` | `default` / `priority` / `flex` |

### 2.2 Telnyx-hosted models vs bring your own key

Guide table, https://developers.telnyx.com/docs/inference/ai-assistants/no-code-voice-assistant:

| Model | Key needed |
|---|---|
| `moonshotai/Kimi-K2.6` (**default**) | No (Telnyx native) |
| `moonshotai/Kimi-K2.5` | No |
| `zai-org/GLM-5.2` | No |
| `anthropic/claude-haiku-4-5` | No ("Anthropic (native)") |
| `openai/gpt-5.4-mini` | Yes, OpenAI key |
| `openai/gpt-4o` | Yes, OpenAI key |

- Not every selectable model is verified for voice. Telnyx keeps a "voice-verified models" list at `/docs/voice/conversational-ai/quickstart#voice-verified-models` (not opened).
- **Reasoning/thinking is always disabled on voice calls**, on every model.
- **Third-party key:** create an integration secret, then set `llm_api_key_ref` to its identifier.
  - Create with `POST /integration_secrets`, body `{ identifier*, type*: "bearer"|"basic", token? (bearer), username?/password? (basic) }`.
  - Doc: https://developers.telnyx.com/api-reference/integration-secrets/create-a-secret
  - Telnyx warns "Free plans are unlikely to work".

### 2.3 Custom LLM (`external_llm`)

Shape: `{ model*, base_url*, llm_api_key_ref?, authentication_method: "token"|"certificate" (default token), certificate_ref?, token_retrieval_url?, forward_metadata: bool=false }`.

- The endpoint must be OpenAI-compatible.
- `forward_metadata` sends the dynamic variables as `extra_metadata` in the request body.
- Guide: https://developers.telnyx.com/docs/inference/ai-assistants/custom-llm

### 2.4 Pricing
- **Docs:** "Pay-per-token… Input and output priced separately; cached input tokens at a discount" (https://developers.telnyx.com/docs/inference/models/pricing). Per-model rates are on telnyx.com/pricing/inference-api, which was **not reachable (UNCONFIRMED)**. The live `pricing` field from `GET /ai/openai/models` is the authoritative source.
- **BYO-key models:** the provider bills us directly. Whether Telnyx also adds a fee is UNCONFIRMED.

---

## 3. Voices (TTS)

### 3.1 Listing voices
- **Endpoint:** `GET /text-to-speech/voices?provider=<aws|telnyx|azure|elevenlabs|minimax|resemble|xai|humain|soniox>&api_key=<only for ElevenLabs>`.
- **Returns:** `voices[]: { provider, name, voice_id, language, gender, hosted }`.
- **Doc:** https://developers.telnyx.com/api-reference/text-to-speech-commands/list-available-voices

### 3.2 Providers and `voice_settings.voice` format

Guides: https://developers.telnyx.com/docs/voice/tts/available-voices and the provider pages under `/docs/voice/tts/providers/`.

**Telnyx voices**

| Provider / model | Voice id format | Notes |
|---|---|---|
| Telnyx Kokoro | `Telnyx.KokoroTTS.<voice>`, e.g. `Telnyx.KokoroTTS.af_heart` | "Reliable and budget-friendly." |
| Telnyx Ultra | `Telnyx.Ultra.<voice>`, e.g. `Telnyx.Ultra.Clara` | Sub-100 ms. 44 languages per the overview, 38 per the Ultra page (the docs disagree). Supports `expressive_mode`. |
| Telnyx Qwen3TTS | `Telnyx.Qwen3TTS.<clone_uuid>` | Cloned voices only (§4). 11 languages. |
| Telnyx Bayan | `Telnyx.Bayan.<speaker>` | Arabic: 113 speakers across 13 dialects, plus English. |
| Telnyx Sukhan | `Telnyx.Sukhan.<voice_id>` | Urdu, 14 voices. |

**Third-party voices**

| Provider / model | Voice id format | Notes |
|---|---|---|
| xAI Grok | `xAI.<voice_id>` (`ara`, `eve`, `leo`, `rex`, `sal`) | Expressive speech tags. Higher latency than Ultra. |
| AWS Polly | `aws.Polly.<Engine>.<VoiceId>` or `aws.Polly.<VoiceId>-Neural` (examples `aws.Polly.Generative.Lucia`, `aws.Polly.Danielle-Neural`) | Engines: standard, neural, generative, long-form. SSML supported. The Call Control speak docs write it `AWS.Polly.<VoiceId>`; case-sensitivity is UNCONFIRMED. |
| Azure | `azure.<VoiceId>`, e.g. `azure.en-US-AvaMultilingualNeural` | |
| ElevenLabs | `elevenlabs.<Model>.<VoiceId>` | **Requires our own ElevenLabs key** in `voice_settings.api_key_ref`. Voices come from that ElevenLabs account. |
| Minimax | `Minimax.<model>.<voice>`, e.g. `Minimax.speech-2.8-turbo.English_radiant_girl` | Uses `language_boost`. |
| Resemble | `Resemble.Turbo.<Voice>_<locale>` | |
| Inworld | `Inworld.<ModelId>.<VoiceId>` | |
| Fish Audio | `FishAudio.<Model>.<VoiceId>` | Models s2.1-pro, s2-pro, s1. |
| Soniox | `Soniox.tts-rt-v2.<VoiceId>` | ~200 voices. Every voice speaks every supported language (60+). |

- The voice part of the id can be a dynamic variable, e.g. `Telnyx.Ultra.{{voice_id}}`, which allows a per-call voice.
- **Language:** each voice in the list API reports its `language`. For the assistant, the voice decides the spoken language. There is no separate TTS language field except `language_boost` for Minimax.

### 3.3 `voice_settings` sub-fields

| Field | Type / default / range | Applies to |
|---|---|---|
| `voice`* | string | All |
| `voice_speed` | number, default 1, range 0.25–2.0 (0.7–1.3 for Soniox) | Telnyx Natural voices and Soniox. Which Telnyx families count as "Natural" is UNCONFIRMED. |
| `api_key_ref` | string | ElevenLabs |
| `temperature` | number, default 0.5 | ElevenLabs (stability) |
| `similarity_boost` | number, default 0.75 | ElevenLabs |
| `use_speaker_boost` | bool, default true | ElevenLabs |
| `style` | number, default 0 | ElevenLabs |
| `speed` | number, default 1 | ElevenLabs |
| `language_boost` | null / `auto` / one of ~40 language names, default null | Minimax |
| `expressive_mode` | bool, default false | Telnyx Ultra (emotion tags, `[laughter]`) |
| `background_audio` | one of the shapes below | All |

`background_audio` shapes:
- `{type:"predefined_media", value:"silence"|"office", volume:0.1–1.0 (default 1)}`
- `{type:"media_url", value:"https://…mp3"}` (loops)
- `{type:"media_name", value:"<Media Storage name>"}`

**Pronunciation dictionaries:** `POST /pronunciation_dicts`. https://developers.telnyx.com/api-reference/pronunciation-dictionaries/create-a-pronunciation-dictionary. How a dictionary attaches to an assistant is UNCONFIRMED: there is no field for it in the assistant schema.

**TTS pricing:** "Per 1M characters… varies by voice/model" (models pricing page). Rates are on telnyx.com/pricing/text-to-speech: **UNCONFIRMED**. §12 covers whether TTS is bundled into the assistant per-minute rate.

---

## 4. Voice cloning and custom voices

Guide: https://developers.telnyx.com/docs/voice/voice-design-lab.

| Action | Endpoint | Body |
|---|---|---|
| Clone from audio | `POST /voice_clones/from_upload` (multipart) | `audio_file`* (WAV/MP3/FLAC/OGG/M4A), `name`* (≤255), `language`* (ISO 639-1), `gender`* (`male`/`female`/`neutral`), `ref_text` (transcript; improves quality), `label`, `provider`*, `model_id` |
| Design a voice from a text prompt | `POST /voice_designs` | `name` (required for a new design), `voice_design_id` (to add a version, max 50 versions), `text`*, `prompt`*, `language` (default `Auto`: Auto/Chinese/English/Japanese/Korean/German/French/Russian/Portuguese/Spanish/Italian), `temperature` 0–2 (0.9), `top_k` 1–1000 (50), `top_p` 0–1 (1.0), `repetition_penalty` 1–2 (1.05), `max_new_tokens` 100–4096 (2048), `provider` (`telnyx` = Qwen3TTS, or `minimax`) |
| Turn a design into a usable voice | `POST /voice_clones` | `name`*, `voice_design_id`*, `language`*, `gender`*, `provider` (`telnyx` default or `minimax`) |
| List / get / update / delete / download sample | `/voice_clones…` | Update can change `name`, `language`, `gender` |

Docs: https://developers.telnyx.com/api-reference/voice-clones/create-a-voice-clone-from-an-audio-file-upload and https://developers.telnyx.com/api-reference/voice-designs/create-or-add-a-version-to-a-voice-design

**Sample requirements**

| `provider` / `model_id` | Audio length | Max file | Response |
|---|---|---|---|
| `telnyx` / `Qwen3TTS` (default) | 3–15 s, auto-trimmed to 10 s; 5–10 s is best | 5 MB | 201, `active` |
| `telnyx` / `Ultra` | Up to 60 s | 5 MB | **202, `pending`**. Poll `GET /voice_clones/{id}` until `active`. |
| `minimax` / `speech-2.8-turbo` | 10 s – 5 min; 1–2 min is best | 20 MB | 201 |

- Recording guidance: −23 to −18 dB RMS, peaks ≤ −3 dB, quiet room, no long pauses, record in the target language.
- **Clone status values:** `active`, `pending`, `failed`, `expired`. Telnyx describes `expired` as "voice was not kept alive"; the keep-alive rules are **UNCONFIRMED**.
- **Voice id to use on the assistant:** `{Provider}.{Model}.{provider_voice_id}`. For Qwen3TTS, `provider_voice_id` is the clone UUID. Ultra uses an id assigned by Cartesia, and Minimax uses its own encoded id.
- **Consent rules:** **UNCONFIRMED.** The developer docs say nothing about speaker consent or verification. Ultra mentions a "verification timed out" failure but doesn't explain it. We should collect our own consent before uploading.
- **Price:** **UNCONFIRMED** (not in the developer docs).
- **Managed-account scope:** clones are listed as "belonging to the authenticated account". **Inferred:** a clone created with a managed account's API key belongs to that managed account. Not stated explicitly, so UNCONFIRMED.

---

## 5. Transcription (STT): `transcription` object

- **Listing models:** `GET /speech-to-text/providers?service_type=ai_assistant`. Returns `data[]: {provider, model, hosted, service_types[{type, languages[]}]}`.
  - Doc: https://developers.telnyx.com/api-reference/speech-to-text-capabilities/list-supported-stt-providers

**Fields**

| Field | Values |
|---|---|
| `model` | `deepgram/flux` (turn-taking), `deepgram/nova-3`, `deepgram/nova-2`, `azure/fast`, `assemblyai/universal-3-5-pro` (alias `assemblyai/universal-streaming`), `xai/grok-stt`, `soniox/stt-rt-v4`, `soniox/stt-rt-v5`, `nvidia/parakeet-v3`, `omi-health/omi-med-stt-v1` (English medical), `humain/realtime` (Arabic/English), `reson8/turns` (10 EU languages), `cohere/ar-stt`, `distil-whisper/distil-large-v2`, `openai/whisper-large-v3-turbo`. All Deepgram models run on Telnyx's own servers. No schema default is given. |
| `language` | Unset or `auto` = auto-detect. `deepgram/flux`: `auto`, `multi`, `en`, `es`, `fr`, `de`, `hi`, `ru`, `pt`, `ja`, `it`, `nl`. `humain/realtime`: `ar`/`en`/`codeswitch`/`auto`; defaults to `en` when unset. `reson8/turns`: `auto`, `nl`, `en`, `fr`, `fy`, `de`, `it`, `pl`, `pt`, `es`, `sv`. `cohere/ar-stt`: `ar`/`en`; defaults to `ar`. |
| `region`, `api_key_ref` | Azure only. Some regions need our own key. |

**`settings` sub-fields**

| Field | Applies to | Default / range |
|---|---|---|
| `smart_format`, `numerals` | Not stated | bool |
| `eot_threshold` | `deepgram/flux` | 0.8, range 0.5–0.9 |
| `eot_timeout_ms` | `deepgram/flux` | 5000, range 500–10000 |
| `eager_eot_threshold` | `deepgram/flux` | 0.8, range 0.3–0.9, must be ≤ `eot_threshold` |
| `keyterm` | nova-3, flux | Comma-separated list of boosted words |
| `end_of_turn_confidence_threshold` | AssemblyAI | 0.4, range 0–1 |
| `min_turn_silence` | AssemblyAI | 400 ms, range 100–5000 |
| `max_turn_silence` | AssemblyAI | 1280 ms, range 100–5000 |
| `interim_results` | Soniox | false |
| `enable_endpoint_detection` | Soniox | false |
| `max_endpoint_delay_ms` | Soniox | 500–3000 |
| `context` | Soniox | ≤10,000 chars, boosted terms |
| `language_hints` | Soniox | ISO 639-1 codes |

- **Noise suppression** lives in `telephony_settings`, not here (see §6).
- **STT price:** "Per second of audio, varies by model" (models pricing page). Rates: UNCONFIRMED.

---

## 6. Conversation behaviour

### 6.1 Interruption / barge-in: `interruption_settings`

| Field | Default / range |
|---|---|
| `enable` | true. Caller can interrupt the assistant. |
| `disable_greeting_interruption` | bool. Caller can't interrupt the greeting. |
| `start_speaking_plan.wait_seconds` | 0.4, ≥0 |
| `start_speaking_plan.transcription_endpointing_plan.on_punctuation_seconds` | 0.1 |
| `…on_no_punctuation_seconds` | 1.5 |
| `…on_number_seconds` | 0.5 |
| `interrupt_prediction_threshold` | 0 (off), range 0–1, nullable |

- These timings matter for models without built-in turn-taking. For `deepgram/flux`, use `transcription.settings.eot_*` instead.
- Guide: https://developers.telnyx.com/docs/inference/ai-assistants/interruption-settings

### 6.2 Timeouts, limits and end conditions: `telephony_settings`

| Field | Default / range | Meaning |
|---|---|---|
| `time_limit_secs` | **1800**, range 30–14400 | Maximum time the assistant stays on the call. Time after a transfer to a human doesn't count. |
| `user_idle_timeout_secs` | 10–14400, no default given | Caller silence that stops the assistant. |
| `user_idle_reply_secs` | **10**, ≥0 | Caller silence before the assistant checks in ("are you there?"). The check-in wording can't be configured in the schema: UNCONFIRMED. |
| `fallback_destination` | string (number or SIP URI) | Transfer target if the AI session **ends abnormally** (an error). Not used on normal ends, voicemail, or after a transfer. |
| `disable_dtmf` | false | Ignore keypad input. Must be `true` if a `pay` tool exists. |
| `noise_suppression` | `aicoustics` / `krisp` / `deepfilternet` / `disabled` | `aicoustics` is recommended for AI. No default given. |
| `noise_suppression_config` | — | aicoustics: `family` (`quail`), `size` (`vf`/`vf_2_0_l`), `enhancement_level` 0–1 (0.8). deepfilternet: `attenuation_limit` 0–100 (100), `mode` (`advanced`). |
| `send_message_history_updates` | bool | Sends a `call.ai_gather.message_history_updated` webhook on every turn. |
| `voicemail_detection.on_voicemail_detected` | — | `action`: `stop_assistant` / `leave_message_and_stop_assistant` / `continue_assistant`. `voicemail_message`: `{type: "prompt"|"message", prompt?, message?}`. **Only works if AMD is enabled on the outbound dial** (`MachineDetection=Enable, AsyncAmd=true, DetectionMode=Premium`). |

- **Ending the call:** the `hangup` tool, when the LLM decides to. `time_limit_secs` and `user_idle_timeout_secs` stop the assistant. There is no "end call phrase" field.
- **Voicemail detection cost:** the AMD on/off switch is on the dial (`DetectionMode=Premium`). The premium AMD price is UNCONFIRMED.

### 6.3 Filler words / dead air
- **Filler messages exist only per webhook tool or A2A agent**, as `webhook.messages[]`:
  - `{type:"request_start", content}`
  - `{type:"request_response_delayed", content, timing_ms 100–120000}`
  - Scripted text, not generated by the LLM. Works with synchronous webhooks and MCP calls.
  - Guide: https://developers.telnyx.com/docs/inference/ai-assistants/filler-messages
- There is no global "um / uh" filler-word setting: UNCONFIRMED (not found).
- **Background noise:** see `voice_settings.background_audio` (§3.3).

### 6.4 Conversation flows: `conversation_flow` (visual workflow builder)

Shape: `{ start_node_id*, nodes*[], edges[] }`. Guide: https://developers.telnyx.com/docs/inference/ai-assistants/workflows

**Node types**
- **`prompt`:** `id`*, `instructions`*, `instructions_mode` (`replace`/`append`), `shared_tool_ids[]`, `tools_mode` (`replace`/`append`), optional overrides for `model`, `llm_api_key_ref`, `external_llm`, `voice_settings` and `transcription`, plus `name` and `position{x,y}`.
- **`tool`:** `id`*, `shared_tool_id`*, `message` (said before the tool runs).
- **`speak`:** `id`*, `message`* (said word for word, supports `{{vars}}`).

**Edges:** `{ id*, start_node_id*, condition*, target* }`.
- `condition` is one of:
  - `{type:"llm", prompt}`
  - `{type:"expression", expression: AST}`. The AST supports comparison (`== != < <= > >= contains not_contains`), bool_op (`and or not`), arithmetic (`+ - * / %`), variable, and string/number/bool literals.
  - `{type:"default"}`
- `target` is one of:
  - `{type:"node", node_id}`
  - `{type:"assistant", assistant_id, voice_mode: unified|distinct}`

---

## 7. Tools

Tools go inline in `tools[]` (deprecated) or are attached as shared tools by `tool_ids`. Shared-tool CRUD lives under the "AI Tools" endpoints; their exact paths are UNCONFIRMED (only attach/detach was opened). Guide: https://developers.telnyx.com/docs/inference/ai-assistants/tools-library

### 7.1 Tool types (schema: CREATE → `tools`)

**`webhook`** (calls our HTTP API)
- `timeout_ms` (default 5000, max 60000) sits at tool level, next to `type`.
- `webhook`: `{ name*, description*, url* (may contain `{path_param}`), method (GET/POST/PUT/DELETE/PATCH, default POST) }`.
- Request parts:
  - `headers[{name, value}]`. Values support `{{#integration_secret}}id{{/integration_secret}}`.
  - `body_parameters`, `path_parameters`, `query_parameters`: JSON-schema objects.
  - `preset_body_fields`, `preset_query_params`: hidden from the LLM and take precedence.
- Behaviour:
  - `async` (false). `async_timeout_ms` (1–15000, platform default 300).
  - `store_fields_as_variables[{name, value_path}]`.
  - `messages[]`: filler messages (§6.3).

**`function`**
- `function: { name*, description, parameters }`.
- Generic function calling. How results get back without a webhook isn't explained: UNCONFIRMED.

**`client_side_tool`**
- `{ name*, description*, parameters* }`.
- Runs in the browser widget / WebRTC client.

**`retrieval`** (knowledge base, §8)
- `{ bucket_ids*: string[], max_num_results? }`.

**`handoff`** (to another assistant)
- `{ ai_assistants*: [{name, id}], voice_mode: unified|distinct }`.

**`hangup`**
- `{ description? }` (default "This tool is used to hang up the call.").

**`transfer`** (bridge to a number or SIP)
- `targets*`: `[{name?, to*, message?, extension? (DTMF after answer), sip_auth_username?, sip_auth_password?}]`, or a `"{{targets}}"` variable.
- `from`* (caller id).
- Optional fields:
  - `diversion`
  - `warm_transfer_instructions`
  - `warm_transfer_acceptance{enabled=false, end_user_target_context_mode: private|shared}`
  - `description`
  - `warm_message_delay_ms`
  - `custom_headers[]`
- `voicemail_detection`:
  - `detection_mode`: `disabled`/`premium`
  - `on_voicemail_detected.action`: `stop_transfer` / `leave_message_and_stop_transfer`
  - `voicemail_message{type: message|warm_transfer_instructions, message}`
  - `detection_config{…11 AMD timing fields with ranges}`

**`invite`** (add a third party to the call)
- `{ from*, targets ([{name, to*}] | "{{var}}" | null), custom_headers[], voicemail_detection{detection_mode, on_voicemail_detected.action: stop_invite} }`.

**`refer`** (SIP REFER)
- `targets*`: `[{name*, sip_address*, sip_auth_username?, sip_auth_password?}]`.
- `sip_headers[{name: "User-to-User"|"Diversion", value}]`, `custom_headers[]`.

**`send_dtmf`**
- `send_dtmf: {}`. No parameters.

**`send_message`** (SMS/MMS to the caller)
- `send_message: { message_template?: string|null }`.
- To and from come from the conversation automatically.

**`skip_turn`**
- `{ description? }`.
- Used for multi-party calls, so the assistant can stay silent.

**`pay`** (BETA, card payment by DTMF)
- `{ connector_name*, currency="USD", payment_method="credit-card", description? }`.
- Requires `telephony_settings.disable_dtmf=true`. Recording pauses while it runs.

**`update_dynamic_variables`**
- `{ name*, description*, updatable_variables*: [{name* (not starting with `telnyx_`), type?, description?}] (≥1) }`.

### 7.2 Testing a tool
- `test-assistant-tool` endpoint. Path UNCONFIRMED (not opened).
- https://developers.telnyx.com/api-reference/assistants/test-assistant-tool

### 7.3 MCP servers
- `POST /ai/mcp_servers` with body `{ name*, type*, url*, api_key_ref?, allowed_tools?: string[] }`. Allowed `type` values are not listed: UNCONFIRMED.
- Attach with `mcp_servers: [{id, allowed_tools?}]`.
- Doc: https://developers.telnyx.com/api-reference/mcp-servers/create-mcp-server

### 7.4 A2A agents: `a2a_agents[]`
- Item shape: `{ name* (≤43), url* (≤2048 bytes), headers[{name*, value*}], async=false, timeout_ms, poll_interval_ms (default 500), messages[] }`.
- One tool is generated per skill on the agent card, named `a2a_<name>_<skill_id>`.
- Guide: https://developers.telnyx.com/docs/inference/ai-assistants/a2a-agents

**Extra cost of tools:** none documented, except premium AMD (UNCONFIRMED price) and `pay` (UNCONFIRMED).

---

## 8. Knowledge base / RAG

1. **Upload files** to a Telnyx Storage bucket (S3-compatible API or the portal).
2. **Embed the bucket:** `POST /ai/embeddings` with body:
   - `bucket_name`*
   - `document_chunk_size` (1024)
   - `document_chunk_overlap_size` (512)
   - `embedding_model` (`thenlper/gte-large` or `intfloat/multilingual-e5-large`; the latter is the default)
   - `loader` (`default` / `intercom`)
   - This runs in the background. Check status with `GET /ai/embeddings/{task_id}`.
   - Doc: https://developers.telnyx.com/api-reference/embeddings/embed-documents
3. **Or embed a webpage:** `POST /ai/embeddings/url` with `{ url*, bucket_name* }` (the bucket must exist).
4. **Attach to the assistant:** add a `retrieval` tool `{bucket_ids:[…], max_num_results?}`, or a shared retrieval tool in flow nodes.

**File types and limits**
- Supported: PDF, HTML, txt, JSON, CSV, and audio/video (mp3, mp4, mpeg, mpga, m4a, wav, webm).
- Max 100 MB per file; this limit is stated for audio/video. Other types fall back to plain text.
- Embeddings **update automatically** when bucket files are added, changed or deleted.
- A limit on total bucket size or document count is UNCONFIRMED.

**Pricing** (confirmed, https://developers.telnyx.com/docs/inference/embedding-rag/pricing)
- Embed and persist: **$0.0015 / 1K characters**, charged once. Includes 30 days of retention.
- Storage after 30 days: **$0.60 / GiB-month**, only if extended retention is enabled.
- Similarity search: **$0.003 / search**. The first **10,000 searches per month are free**.
- Telnyx Storage bucket fees are separate: UNCONFIRMED.

**Newer option:** "AI Search" collections (`/v2/ai/knowledge/collections`) are a managed RAG product. Attaching them to an assistant is UNCONFIRMED. Use buckets.

---

## 9. Telephony and messaging

**Inbound**
- Each assistant gets a TeXML application automatically: `telephony_settings.default_texml_app_id`.
- To make a number answer with the assistant, assign the number to that TeXML app (number `connection_id`). The guide does this in the portal; the API equivalent is a phone-number update with that `connection_id` (inferred from the TeXML app model).
- **Inferred and UNCONFIRMED:** whether Telnyx exposes a number list on the assistant.

**Outbound**
- `POST /texml/ai_calls/{texml_app_id}` with `{From, To, AIAssistantId}`.
- For voicemail handling, add `MachineDetection:"Enable", AsyncAmd:true, DetectionMode:"Premium"`.
- On an existing Call Control call: `POST /calls/{id}/actions/ai_assistant_start`. Body:
  - `assistant{id*, overrides: model, instructions, greeting ≤3000, voice_settings, tools, dynamic_variables, …}`
  - `greeting`, `interruption_settings`, `transcription`
  - `message_history[]` (seed messages)
  - `send_message_history_updates`, `participants[]`, `client_state`, `command_id`
  - Doc: START

**SMS**
- `messaging_settings`:
  - `default_messaging_profile_id`: created automatically.
  - `delivery_status_webhook_url`
  - `conversation_inactivity_minutes`: 1–10,000,000. After this gap, a new conversation starts.
- Enable with `enabled_features: ["messaging"]`.
- Send as the assistant: `POST /ai/assistants/{id}/chat/sms` with `{from*, to*, text, conversation_metadata, should_create_conversation}`.

**WhatsApp**
- **Voice calls:** confirmed. WhatsApp Business Calling routes inbound WhatsApp calls through the number's voice connection, "(Voice API, SIP, TeXML, or AI agent)".
  - Outbound uses SIP URI `<dest>@whatsapp-<number>.sip.telnyx.com`.
  - Outbound is **not available for US, CA, EG, VN or NG numbers**.
  - Limit: 1,000 concurrent calls per number.
  - Doc: https://developers.telnyx.com/docs/messaging/whatsapp/business-calling
- **Text:** a `whatsapp_chat` conversation channel exists (https://developers.telnyx.com/docs/inference/ai-assistants/conversation-keying). How to configure an assistant to auto-reply on WhatsApp text is **UNCONFIRMED** (no setup guide found).

**Recording: `telephony_settings.recording_settings`**

| Field | Default / allowed |
|---|---|
| `enabled` | **`true`** |
| `channels` | `single`/`dual`, default `dual` |
| `format` | `wav`/`mp3`, default `mp3` |
| `stop_on_conversation_end` | false |

- Recording is **on by default**, which matters for UK/EU consent.
- Recording/storage price: UNCONFIRMED.

**Web calls**
- `telephony_settings.supports_unauthenticated_web_calls` (bool) is needed for the website widget.

---

## 10. Insights, post-call analysis and history

**Insight template**
- `POST /ai/conversations/insights` with `{ name*, instructions*, webhook? (default ""), json_schema? (string or object → structured output) }`.
- Doc: https://developers.telnyx.com/api-reference/conversations/create-insight-template

**Insight group**
- `POST /ai/conversations/insight-groups` with `{ name*, description?, webhook? }`.
- Assign templates to groups with the assign/unassign endpoints.
- Attach to the assistant with `insight_settings.insight_group_id`.
- Guide: https://developers.telnyx.com/docs/inference/ai-insights/insight-groups

**Built-in Telnyx-managed insights**
- "Agent Instruction Following" and "User Satisfaction", each scored Excellent / Good / Fair / Poor / N/A.
- Added to a group.
- https://developers.telnyx.com/docs/inference/ai-insights/telnyx-managed-insights

**Getting results**
- Webhook on the template or group. The payload shape is UNCONFIRMED (not opened).
- Or `GET /ai/conversations/{id}/conversations-insights`, which returns `data[{id, status: pending|in_progress|completed|failed, conversation_insights[{insight_id, result (string; stringified JSON when a schema is set)}]}]`.

**Conversations**
- `GET /ai/conversations`: PostgREST-style filters, e.g. `metadata->telnyx_end_user_target=eq.+44…`, `created_at=gte.…`.
- `GET /ai/conversations/{id}/messages`.
- `GET /ai/conversation_histories`: search.
- Conversations are also created, deleted and have metadata updated through `/ai/conversations`.
- Channels: `phone_call`, `sms_chat`, `whatsapp_chat`, `web_chat`, `websocket_call`, `web_call`.

**Summaries**
- No dedicated summary field. Make a summary insight, or use `post_conversation_settings` with a webhook tool.

**Memory**
- The dynamic-variables webhook response can include `memory: { conversation_query: "<List Conversations filter>", insight_query: "insight_ids=…" }`.
- Guide: https://developers.telnyx.com/docs/inference/ai-assistants/memory

**Live events**
- `send_message_history_updates` webhook, or `websocket_settings` (beta).
- In-call injection: `POST /calls/{id}/actions/ai_assistant_add_messages`.

**Insight cost:** UNCONFIRMED. It presumably bills as LLM tokens, but the docs don't say.

---

## 11. Multi-tenant (managed accounts)

**Confirmed**
- Managed accounts (`POST /managed_accounts`: `business_name*`, `email`, `password`, `managed_account_allow_custom_pricing`, `rollup_billing`) need Telnyx approval before use.
- Disabling one blocks calls and SMS, but calls already in progress continue.
- Doc: https://developers.telnyx.com/api-reference/managed-accounts/create-a-new-managed-account

**UNCONFIRMED**
- The docs don't explicitly say that AI Assistants, voice clones, integration secrets, embeddings buckets, insight groups or MCP servers work under a managed-account API key.
- **Inferred:** every one of these resources is described as belonging to "the authenticated account/organization". So they should be created **with the managed account's own key** and stay isolated per client.
- Nothing in the docs says any assistant feature is parent-only. **Test this with one sub-account before building on it.**
- **Model and voice licences:** ElevenLabs and BYO-LLM keys are per-org integration secrets. Each sub-account needs its own secret, or we share our key by creating the same secret in each sub-account (inferred).

---

## 12. Pricing per minute

- **Telnyx developer docs:** no per-minute assistant price. Only per-unit bases are given: LLM per 1M tokens, STT per second, TTS per 1M chars, embeddings as in §8. https://developers.telnyx.com/docs/inference/models/pricing
- **telnyx.com/pricing/voice-ai-agents:** blocked here. Third-party summaries (search results, **UNCONFIRMED**) say:
  - **$0.05/min** covers orchestration plus STT plus "several" TTS options.
  - LLM tokens are billed separately.
  - Telephony is extra (~$0.002/min Call Control plus SIP/number fees).
  - Telnyx quotes a typical all-in figure of ~$0.056/min.
  - **Verify on telnyx.com before using any of these in client pricing.**
- **LLM:** live per-model price is in `GET /ai/openai/models` → `pricing`.
- **Likely extras:** premium voices (ElevenLabs is billed by ElevenLabs on our key), premium AMD, recordings, BYO-LLM. All UNCONFIRMED.

---

## 13. What to expose to clients

| Setting | API field | Expose to end clients | Why |
|---|---|---|---|
| Assistant name | `name` | yes | Their label |
| Prompt / instructions | `instructions` | yes | Core behaviour. We can offer "Improve" via `/instructions/enhance` |
| Greeting / who speaks first | `greeting` | yes | Simple, high impact |
| LLM model | `model` | staff-only (or a short curated pick) | Cost varies per model, and not all are voice-verified |
| BYO LLM / external endpoint | `llm_api_key_ref`, `external_llm`, `fallback_config` | staff-only | Secrets and support burden |
| Voice | `voice_settings.voice` | yes (curated list from `/text-to-speech/voices`) | Main brand choice |
| Voice speed | `voice_settings.voice_speed` | yes | Harmless slider |
| ElevenLabs tuning | `temperature`, `similarity_boost`, `style`, … | staff-only | Needs our ElevenLabs key; niche |
| Expressive mode | `voice_settings.expressive_mode` | yes (Ultra voices only) | Simple toggle |
| Background audio | `voice_settings.background_audio` | yes (`silence`/`office` plus volume) | Simple |
| Voice cloning | `/voice_clones/from_upload` | yes, with our consent checkbox | Strong feature. Telnyx doesn't enforce consent, so we must |
| Voice design | `/voice_designs` | yes (later phase) | Nice to have |
| STT model | `transcription.model` | staff-only | Technical; wrong choice hurts quality |
| Language | `transcription.language` | yes (dropdown) | Clients serve different markets |
| Key terms | `transcription.settings.keyterm` / `context` | yes ("words to recognise") | Helps with names and brands |
| Turn-taking timings | `interruption_settings.*`, `eot_*` | staff-only | Easy to break |
| Allow interruptions | `interruption_settings.enable` | yes | Simple toggle |
| Noise suppression | `telephony_settings.noise_suppression` | staff-only (default `aicoustics`) | Technical |
| Max call length | `telephony_settings.time_limit_secs` | staff-only (we already cap by credits) | Tied to billing |
| Silence check-in / hang-up | `user_idle_reply_secs`, `user_idle_timeout_secs` | yes (simple seconds) | Understandable |
| Voicemail action | `telephony_settings.voicemail_detection` | yes (hang up / leave message / continue) | Common outbound need |
| Fallback number | `telephony_settings.fallback_destination` | yes | Safety net to a human |
| Recording | `telephony_settings.recording_settings` | yes (on/off), format staff-only | Legal consent varies by country |
| Transfer to human | `transfer` tool | yes (name plus number list) | Core feature |
| Hang-up tool | `hangup` tool | always on (hidden) | Needed for normal ends |
| SMS during call | `send_message` tool | yes | Common ask |
| Webhooks / API tools | `webhook` tool | staff-only (or "advanced") | Requires dev skills |
| Built-in booking tools | `webhook` tools to our API | yes, as preset toggles | We pre-build them |
| Knowledge base | `retrieval` tool plus `/ai/embeddings` | yes (upload files / URL) | High value; cheap |
| Handoff / flows | `handoff`, `conversation_flow` | staff-only (later phase) | Complex graph editor |
| MCP / A2A / integrations | `mcp_servers`, `a2a_agents`, `integrations` | staff-only | Secrets and complexity |
| Pay tool | `pay` | no (for now) | Beta; PCI concerns |
| Dynamic variables | `dynamic_variables`, webhook URL | staff-only (we fill them) | We inject contact data ourselves |
| SMS assistant | `enabled_features`, `messaging_settings` | yes (toggle) | Simple |
| Insights / summaries | `insight_settings`, insight templates | yes (pick from presets) plus staff-only custom schemas | Useful reporting |
| Data retention | `privacy_settings.data_retention` | yes | GDPR choice |
| Versions / canary / tests | versions, canary-deploys, tests | staff-only | Ops tooling |
| Scheduled events | `/scheduled_events` | no (we run our own scheduler) | Duplicates our dialler |
| Widget | `widget_settings` | yes (if we ship a web widget) | Branding |
| Observability, websocket, delegation | `observability_settings`, `websocket_settings`, `delegation_settings` | no | Beta / internal |
