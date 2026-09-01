# AI Voice Booking Agent — Paid / Best-in-Market Stack Plan (UK Market)

**Goal:** AI makes/receives calls, books appointments for clients across multiple businesses, fully automated, UK-compliant, built on best-in-class managed tools for speed and reliability.

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

| Layer | Tool | Why best-in-class | Cost |
|---|---|---|---|
| Telephony | **Twilio** | Industry standard, UK numbers, reliability, compliance tooling built-in | ~£0.01-0.02/min |
| Voice orchestration (all-in-one) | **Vapi** or **Retell AI** | Wraps STT+LLM+TTS+telephony glue+interruption handling out of box — ships in days not weeks | ~$0.05-0.15/min |
| LLM | **GPT-4o** or **Claude Sonnet 4.5** | Best function-calling reliability + speed for live conversation, fewer hallucinated bookings | ~$2.50-5/1M tokens |
| STT | **Deepgram Nova-3** (built into Vapi/Retell usually) | Best-in-class streaming latency + accent robustness, used by most production voice-AI | ~$0.0043/min |
| TTS | **ElevenLabs (Turbo v2.5)** or **Cartesia Sonic** | Most natural-sounding, lowest-latency premium TTS, UK accent voices available | ~$0.10-0.30/min equiv |
| Calendar | **Cal.com (cloud)** or native **Google Calendar / Microsoft Graph API** | Managed, no ops burden, clean OAuth per business | ~£10-12/user/mo or free tier |
| Backend | **FastAPI or Node.js (NestJS)**, hosted on **Railway/Render** | Managed deploy, less ops, scales easily | ~£20-50/mo |
| DB | **Supabase (Postgres, EU region)** + **Upstash Redis** | Managed, EU data residency, auto-backups, no DBA needed | ~£20-40/mo |
| Queue | **Upstash QStash** or **Trigger.dev** | Managed job queue, no Celery ops | ~£10-20/mo |
| Storage | **AWS S3 (eu-west-2, London)** | Reliable, UK region, cheap at scale | ~£5-15/mo |
| Frontend | **Next.js on Vercel** | Zero-ops deploy, fast | Free-£20/mo |
| Monitoring | **Sentry + Twilio call logs + LangSmith (LLM traces)** | Debug convo failures, catch hallucinated bookings fast | ~£20-50/mo |

**Est. monthly cost (small scale, ~500 call-mins):** £150-400. Scales with call volume mainly via Vapi/Retell per-min + ElevenLabs.

**Trade-offs:** higher recurring cost, less control/customization, vendor lock-in on Vapi/Retell, but ships fastest, most reliable, least maintenance.

---

## 3. Best Model Per Task (Paid)

| Task | Model/Tool |
|---|---|
| Conversation LLM | Claude Sonnet 4.5 / GPT-4o |
| Reasoning-heavy edge cases (rescheduling logic) | Claude Opus / GPT-4o |
| STT | Deepgram Nova-3 |
| TTS | ElevenLabs Turbo v2.5 / Cartesia Sonic |
| Orchestration | Vapi / Retell AI |
| Calendar | Cal.com Cloud / MS Graph API |

---

## 4. UK Compliance Checklist (non-negotiable)

- [ ] **PECR consent** — opt-in consent required before AI outbound calls to consumers (not soft opt-out)
- [ ] **TPS screening** — check numbers against Telephone Preference Service before outbound dialing
- [ ] **Call recording notice** — state at call start: "this call may be recorded"
- [ ] **ICO registration** — register as data controller (small annual fee)
- [ ] **Valid CLI** — must show real, traceable caller ID, no spoofing
- [ ] **UK GDPR** — lawful basis for processing, right to erasure, data minimization
- [ ] **Data residency** — DB/storage in UK/EU regions (eu-west-2 London)
- [ ] **Privacy policy** — public-facing, covers call recording + data use
- [ ] **Do-not-call handling** — honor opt-outs immediately, log them, never re-call

---

## 5. Suggested Build Order

1. Backend + DB schema (businesses, clients, appointments, call_logs)
2. Cal.com/Calendar API integration (check_availability, book_slot functions)
3. Vapi/Retell agent config: GPT-4o/Claude + Deepgram + ElevenLabs, test latency
4. Twilio number + inbound/outbound call wiring
5. Conversation state machine (slot-filling, confirmation, barge-in handling)
6. UK compliance layer (consent flow, TPS check, recording notice)
7. Business dashboard (Next.js on Vercel)
8. Pilot with 1-2 businesses → measure booking success rate, call drop rate, latency

*Next: conversation state machine design, DB schema, or Vapi/Retell config — say which.*
