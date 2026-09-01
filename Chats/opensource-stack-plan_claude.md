# AI Voice Booking Agent — Open-Source Stack Plan (UK Market)

**Goal:** AI makes/receives calls, books appointments for clients across multiple businesses, fully automated, UK-compliant, built on free/open-source tools where possible.

---

## 1. Architecture Overview

```
Caller (PSTN) ⟷ Telephony ⟷ Orchestration Layer ⟷ [STT → LLM → TTS]
                                      ↕
                          Backend (tools/functions)
                                      ↕
                    Calendar API   +   Database   +   Queue
                                      ↕
                          Business Dashboard (frontend)
```

7 layers: **Telephony, STT, LLM, TTS, Orchestration, Backend+DB, Calendar, Frontend.**

---

## 2. Stack

| Layer | Tool | Why | Cost |
|---|---|---|---|
| Telephony | **Twilio** (pay-per-min; no full free alt for real PSTN + UK numbers) | Only reliable way to get real +44 numbers, inbound/outbound, SIP | ~£0.01–0.02/min |
| STT | **Whisper** (faster-whisper, self-hosted) or **Deepgram free tier** | Whisper = free, open, good accuracy incl. accents if tuned. Needs GPU for low latency | Free (GPU cost) / Deepgram free credits |
| LLM | **DeepSeek-V3 / DeepSeek-R1 (API)** | Cheap, strong function-calling, OpenAI-compatible API | ~$0.27/1M input tokens |
| TTS | **Piper** (fast, CPU-friendly, UK English voices) or **Coqui TTS** | Free, open, low-latency, real-time capable | Free |
| Orchestration | **Pipecat** (Daily.co, Python) | Handles STT↔LLM↔TTS streaming, barge-in/interruptions, turn-taking — the hard plumbing | Free |
| Calendar | **Cal.com (self-hosted, AGPL)** | Full control, syncs Google/Outlook, no vendor lock | Free (self-host) |
| Backend | **FastAPI (Python)** | Pairs naturally with Pipecat (same lang), exposes tool endpoints for LLM function calls | Free |
| DB | **Postgres** (self-host or Supabase free tier) + **Redis** (session state) | Postgres = permanent records, Redis = fast in-call memory | Free/low |
| Queue | **Celery + Redis** | Paces outbound calls, retries, rate-limits (legally required — see compliance) | Free |
| Storage | **MinIO (self-hosted S3-compatible)** or AWS S3 eu-west-2 | Call recordings/transcripts, UK data residency | Free/low |
| Frontend | **Next.js** | Business dashboard — bookings, logs, overrides | Free |
| Hosting | **Hetzner / OVH (UK/EU datacenters)** | Cheap VPS, GPU instances available, EU data residency | ~£20-100/mo |

**Est. monthly cost (small scale, ~500 call-mins):** £30–150 (mostly Twilio + hosting + GPU if self-hosting Whisper).

**Trade-offs:** more DevOps work (self-hosting STT/TTS/Cal.com/DB), latency needs tuning (weak GPU = laggy calls = bad UX), no vendor support line.

---

## 3. Best Model Per Task (Open-Source)

| Task | Model/Tool |
|---|---|
| Conversation LLM | DeepSeek-V3 |
| Reasoning-heavy edge cases (rescheduling logic) | DeepSeek-R1 |
| STT | Whisper (faster-whisper, self-host) |
| TTS | Piper (UK voices) |
| Orchestration | Pipecat |
| Calendar | Cal.com (self-hosted) |

---

## 4. UK Compliance Checklist (non-negotiable)

- [ ] **PECR consent** — opt-in consent required before AI outbound calls to consumers (not soft opt-out)
- [ ] **TPS screening** — check numbers against Telephone Preference Service before outbound dialing
- [ ] **Call recording notice** — state at call start: "this call may be recorded"
- [ ] **ICO registration** — register as data controller (small annual fee)
- [ ] **Valid CLI** — must show real, traceable caller ID, no spoofing
- [ ] **UK GDPR** — lawful basis for processing, right to erasure, data minimization
- [ ] **Data residency** — DB/storage in UK/EU regions (eu-west-2 London, or UK-based hosting)
- [ ] **Privacy policy** — public-facing, covers call recording + data use
- [ ] **Do-not-call handling** — honor opt-outs immediately, log them, never re-call

---

## 5. Suggested Build Order

1. Backend + DB schema (businesses, clients, appointments, call_logs)
2. Cal.com integration (check_availability, book_slot functions)
3. Pipecat pipeline: DeepSeek + Whisper/Deepgram + Piper, test latency
4. Twilio number + inbound/outbound call wiring
5. Conversation state machine (slot-filling, confirmation, barge-in handling)
6. UK compliance layer (consent flow, TPS check, recording notice)
7. Business dashboard (Next.js)
8. Pilot with 1-2 businesses → measure booking success rate, call drop rate, latency

*Next: conversation state machine design, DB schema, or Pipecat config — say which.*
