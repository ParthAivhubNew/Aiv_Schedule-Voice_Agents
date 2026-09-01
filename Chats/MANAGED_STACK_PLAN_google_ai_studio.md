Here are the two separate, fully detailed project plan files. You can save each one into its own `.md` file.

---

### File 1: `MANAGED_STACK_PLAN.md`

```markdown
# Enterprise Managed AI Voice Booking System (UK & Europe)
**High-Performance Turnkey Architecture & Implementation Plan**

---

## 1. Project Overview & Strategy
This plan uses market-leading, fully managed APIs and voice orchestration platforms to achieve enterprise-grade conversational AI. It minimizes infrastructure overhead, guarantees sub-700ms voice round-trip latency, and enables rapid time-to-market.

---

## 2. Recommended Managed Tech Stack

| Layer | Service / Provider | Model / Configuration | Why Selected |
| :--- | :--- | :--- | :--- |
| **Voice Orchestrator** | **Retell AI** (or **Vapi.ai**) | Cloud Voice Engine | Built-in WebSocket audio streaming, barge-in (interruption) handling, and telephony bridging. |
| **Telephony Carrier** | **Twilio Voice** / **Telnyx** | UK Geographic DIDs (`020`, `0121`, `0161`) | Outbound UK CLI presentation, low packet loss, direct carrier routing. |
| **Speech-to-Text (STT)** | **Deepgram** | `nova-2` (`language: en-GB`) | Sub-200ms streaming transcription; industry-leading accuracy with British accents. |
| **LLM (Core Brain)** | **Anthropic Claude** / **OpenAI** | `Claude 3.5 Sonnet` / `GPT-4o` | Superior conversational reasoning, complex negotiation handling, and zero-shot function calling. |
| **Text-to-Speech (TTS)** | **Cartesia** / **ElevenLabs** | `Cartesia Sonic` / `ElevenLabs Flash v2.5` | ~100–150ms TTFB (Time-To-First-Byte) with realistic British RP voice profiles. |
| **Calendar Engine** | **Cal.com API** / **Nylas API** | Cloud Enterprise API | Multi-tenant availability checks, 2-way Google/Outlook sync, automated `.ics` dispatch. |
| **Job Queue & State** | **Temporal Cloud** | Distributed Workflows | Failover-safe state machine for scheduled retries, campaign pacing, and rate limits. |
| **Database** | **PostgreSQL (Supabase / AWS RDS)** | Managed DB | Stores client profiles, target business data, call transcripts, and recordings. |

---

## 3. End-to-End System Architecture

```
[Campaign CRM / DB] ──► [Temporal Cloud Workflow] ──► [CTPS / TPS API Verification]
                                                              │
                                                              ▼ (If clean)
[POST /v2/create-phone-call] ◄─────────────────────── [Assemble Dynamic Prompt]
           │
           ▼
  [Retell AI / Vapi Core]
  ├── Telephony: Twilio UK SIP Trunk
  ├── STT: Deepgram Nova-2 (en-GB)
  ├── Brain: Claude 3.5 Sonnet / GPT-4o ◄──► [Backend Webhooks: Cal.com API]
  └── TTS: Cartesia Sonic (British Voice)
           │
           ▼ (Call Completed)
  [Post-Call Webhook] ──► [Save Transcript + Summary + Generate Booking in CRM]
```

---

## 4. Context Assembly & Dynamic Prompting

Before placing each call, the system fetches the initiating client's profile and the target business's profile, injecting them into the voice agent runtime.

### Payload Structure Sent to Retell/Vapi:
```json
{
  "from_number": "+442079460912",
  "to_number": "+441614960123",
  "dynamic_variables": {
    "client_company": "Apex Fleet Logistics UK",
    "caller_name": "Oliver (Virtual Assistant)",
    "target_business": "Manchester Heavy Auto Ltd",
    "task_description": "Book safety inspection for 2 commercial vans",
    "earliest_date": "2026-09-01",
    "preferred_windows": "Tuesday or Wednesday between 09:00 and 12:00",
    "max_budget": "£200 per vehicle"
  }
}
```

### Dynamic System Prompt Template:
```text
You are {{caller_name}}, an automated booking coordinator calling on behalf of {{client_company}}.
You are calling {{target_business}} to arrange {{task_description}}.

### Operational Rules:
1. Greet the business and clearly state your company and goal in the first sentence.
2. Target slot preferences: {{preferred_windows}}.
3. If the operator proposes an alternate time, invoke `check_client_availability(date, time)` to verify.
4. Once an agreeable time is settled, call `confirm_and_book(date, time, service_type)` to confirm.
5. If transferred or put on hold, stay silent until a human speaks again.
6. Maintain a polite, professional, and concise British conversational style (keep responses under 2 sentences).
```

---

## 5. UK & European Compliance Framework

* **CTPS / TPS Scrubbing:** Query the Corporate Telephone Preference Service database via API before any call is queued. If a target number is listed, block outbound dialing unless explicit consent exists.
* **Calling Hours:** Enforce scheduled dial windows strictly between **09:00 and 17:30 Monday–Friday** (UK/BST).
* **Valid UK Caller ID (CLI):** Always display a valid, dialable UK phone number owned by your business. Provide an automated voice responder identifying the company if the number is called back.
* **Ofcom Abandoned Call Threshold:** Managed through Retell/Vapi's immediate agent bridge to keep silent/abandoned call rates well under **3%**.
* **GDPR Compliance:** Automatically purge or mask personal identifying information (PII) from transcripts after processing, and store audio within UK/EU AWS regions.

---

## 6. Implementation Roadmap

```
Week 1: Telecom & Platform Setup
  ├── Acquire UK geographic DIDs in Twilio/Telnyx.
  ├── Configure Retell/Vapi accounts with Cartesia Sonic & Deepgram Nova-2.
  └── Set up Cal.com API keys and webhook listeners.

Week 2: Backend Orchestration & Tools
  ├── Build the NestJS / FastAPI campaign manager.
  ├── Deploy Temporal Cloud workers for handling call retries and scheduling.
  └── Implement and test LLM tool endpoints (`check_availability`, `book_slot`).

Week 3: Compliance & Context Integration
  ├── Integrate third-party TPS/CTPS scrubbing API.
  ├── Add Answering Machine Detection (AMD) rules (auto-hangup on voicemail).
  └── Conduct end-to-end sandbox call testing.

Week 4: QA, Monitoring & Launch
  ├── Conduct latency audits (verify sub-700ms round-trip).
  ├── Set up Datadog / Sentry for call drop tracking.
  └── Roll out initial live B2B calling campaign.
```

---

## 7. Cost & Unit Economics (Per 1,000 Calls)
*Assumptions: 2.5 minutes average duration per call; 20 turns per call.*

* **Telephony (Twilio UK):** $0.012/min × 2.5 × 1,000 = **$30.00**
* **STT (Deepgram Nova-2):** $0.0043/min × 2.5 × 1,000 = **$10.75**
* **LLM (Claude 3.5 Sonnet):** ~500 input / 50 output tokens/turn = **$35.00**
* **TTS (Cartesia Sonic):** ~$0.075/1,000 chars = **$18.00**
* **Platform Fee (Retell/Vapi):** $0.05/min × 2.5 × 1,000 = **$125.00**
* **Total Cost per 1,000 Calls:** **~$218.75 (~$0.22 per call)**
```

---

### File 2: `OPENSOURCE_STACK_PLAN.md`

```markdown
# Self-Hosted Open-Source AI Voice Booking System (UK & Europe)
**Custom Architecture Powered by LiveKit, DeepSeek-V3 & Kokoro-82M**

---

## 1. Project Overview & Strategy
This plan outlines a fully self-hosted, open-source voice pipeline. By using open-weight speech models, self-hosted WebRTC telephony bridges, and the **DeepSeek API (`deepseek-chat`)**, you eliminate per-minute platform fees and maintain full data sovereignty for UK/EU GDPR compliance.

---

## 2. Recommended Open-Source Tech Stack

| Layer | Component / Tool | Open-Source License | Function in System |
| :--- | :--- | :--- | :--- |
| **Voice Framework** | **LiveKit Agents Framework** (Python) | Apache 2.0 | Orchestrates VAD, audio streaming, WebRTC channels, and tool loops. |
| **SIP / Media Bridge**| **LiveKit SIP Gateway** | Apache 2.0 | Direct carrier connection bridging SIP/RTP into WebRTC rooms. |
| **Carrier (Trunk)** | **Telnyx Wholesale SIP** / **Gamma UK** | N/A (Standard SIP) | Direct SIP trunking with UK CLI presentation. |
| **Speech-to-Text (STT)**| **Faster-Whisper** (`large-v3-turbo`) | MIT | Low-latency local transcription with British English tuning. |
| **LLM (Brain)** | **DeepSeek-V3 (`deepseek-chat`)** | Proprietary API / Open-weight | Fast conversational intelligence and structured tool-calling via OpenAI SDK format. |
| **Text-to-Speech (TTS)**| **Kokoro-82M** (Voices: `bf_emma`, `bm_george`) | Apache 2.0 | Sub-150ms lightweight neural synthesis with native British RP voices. |
| **VAD Engine** | **Silero VAD** | MIT | Precise speech detection for interruption/barge-in handling. |
| **Calendar Engine** | **Cal.com (Community Edition)** | AGPLv3 (Self-Hosted) | Full calendar management and availability engine running in Docker. |
| **Workflow Engine** | **Temporal (Community Edition)** / **BullMQ** | MIT / Open Source | Task queue, state machine, and retry handling. |
| **Database** | **PostgreSQL + pgvector** | PostgreSQL License | Local transactional database and semantic document store. |

---

## 3. Self-Hosted Infrastructure Topology

```
                       [Telnyx UK SIP Trunk]
                                │ (SIP / RTP)
                                ▼
                     [LiveKit SIP Gateway]
                                │ (WebRTC)
                                ▼
                       [LiveKit Server]
                                │
               ┌────────────────┴────────────────┐
               │                                 │
               ▼                                 ▼
      [LiveKit Worker 1]                [LiveKit Worker 2]
     (FastAPI / Agent SDK)             (FastAPI / Agent SDK)
       ├── Silero VAD                    ├── Silero VAD
       ├── Faster-Whisper (GPU)          ├── Faster-Whisper (GPU)
       ├── Kokoro-82M TTS (GPU/CPU)      ├── Kokoro-82M TTS (GPU/CPU)
       └── DeepSeek Client               └── DeepSeek Client
               │                                 │
               └────────────────┬────────────────┘
                                │ (Tool-Calling)
                                ▼
       [Self-Hosted Cal.com + PostgreSQL + Redis Queue]
```

---

## 4. Voice Agent Implementation Code

This implementation connects LiveKit's agent framework to **DeepSeek-V3** via its OpenAI-compatible endpoint, pairing it with **Faster-Whisper** and **Kokoro-82M**.

```python
# agent_worker.py
import os
import asyncio
from livekit.agents import AutoSubscribe, JobContext, WorkerOptions, cli, llm
from livekit.agents.pipeline import VoicePipelineAgent
from livekit.plugins import openai, silero

# 1. Custom DeepSeek-V3 LLM Client
def get_deepseek_llm() -> openai.LLM:
    return openai.LLM(
        model="deepseek-chat",
        api_key=os.getenv("DEEPSEEK_API_KEY"),
        base_url="https://api.deepseek.com/v1",
        temperature=0.3
    )

# 2. Tool Definitions for the LLM
class BookingTools(llm.FunctionContext):
    @llm.ai_callable(description="Check available booking slots for a given date")
    async def check_availability(self, date: str) -> str:
        # Query self-hosted Cal.com instance
        return f"Available slots for {date}: 10:00 AM, 02:30 PM, 04:00 PM."

    @llm.ai_callable(description="Confirm and lock the appointment booking")
    async def confirm_booking(self, date: str, time: str, service: str) -> str:
        # Execute booking on Cal.com API
        return f"Success: Appointment booked for {service} on {date} at {time}."

# 3. Agent Entrypoint
async def entrypoint(ctx: JobContext):
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)

    agent = VoicePipelineAgent(
        vad=silero.VAD.load(),
        stt=...,  # Faster-Whisper worker (local inference)
        llm=get_deepseek_llm(),
        tts=...,  # Kokoro-82M ONNX model using voice 'bf_emma'
        fnc_ctx=BookingTools(),
        chat_ctx=llm.ChatContext().append(
            role="system",
            text=(
                "You are an automated booking assistant representing Apex Fleet UK. "
                "You are calling to arrange a vehicle inspection. "
                "Be professional, concise, speak in standard British English, "
                "and keep every turn under 2 sentences."
            )
        )
    )

    agent.start(ctx.room)

if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
```

---

## 5. Hardware Specifications & GPU Sizing

To ensure streaming latency stays under **800ms**:

### GPU Worker Instance (RunPod, Hetzner, or OVH Cloud):
* **GPU:** 1x NVIDIA RTX 4090 (24GB VRAM) or NVIDIA L4 (24GB VRAM).
* **VRAM Allocation:**
  * `Faster-Whisper large-v3-turbo` (int8 quantized): **~2.5 GB VRAM** (Processes STT in ~120ms).
  * `Kokoro-82M` (ONNX FP16): **~500 MB VRAM** (Generates audio in ~100ms).
  * Remaining VRAM handles multiple concurrent streaming streams (up to **10–12 simultaneous calls per GPU**).

### Control Plane Server (Standard VPS):
* **Specs:** 4 vCPUs / 8 GB RAM (Ubuntu 24.04).
* **Workloads:** LiveKit Server, LiveKit SIP Gateway, Self-Hosted Cal.com, Redis, Temporal, PostgreSQL.

---

## 6. Self-Hosted UK Telephony & Compliance Setup

1. **Telnyx Wholesale SIP Trunk:**
   * Create an Outbound FQDN profile pointing directly to your LiveKit SIP Gateway public IP.
   * Assign a pool of UK local DIDs (`020`, `0121`, `0161`).
2. **Automated CTPS Pre-Filter:**
   * Run a Redis-backed pre-check service against the UK Corporate Telephone Preference Service list before pushing any number into the dialing queue.
3. **Ofcom Time Pacing:**
   * Temporal workflows enforce dispatch windows only during **09:00–17:30 UK local time**.
4. **Data Isolation (GDPR Article 28):**
   * Audio streams and voice tokens never leave your private server network except for text prompts sent to the DeepSeek API.

---

## 7. Implementation Roadmap

```
Week 1: Server Setup & Open-Source Media Stack
  ├── Provision GPU instance (Hetzner / RunPod EU) and Control VPS.
  ├── Deploy Docker containers: LiveKit Server, SIP Gateway, Cal.com, PostgreSQL.
  └── Connect Telnyx SIP trunk to LiveKit SIP Gateway with UK DID numbers.

Week 2: Audio Pipeline & DeepSeek Integration
  ├── Set up Faster-Whisper streaming inference server.
  ├── Deploy Kokoro-82M TTS with British voice checkpoints (`bf_emma`, `bm_george`).
  └── Build Python LiveKit agent with DeepSeek-V3 tool-calling functions.

Week 3: Scheduling Logic & Campaign Controls
  ├── Deploy Temporal workflow for batch call campaigns.
  ├── Add automated TPS/CTPS blacklist checking before dialing.
  └── Tune Silero VAD settings to prevent false interruptions from background noise.

Week 4: Benchmarking & Production Rollout
  ├── Run concurrency and load tests (target: 10 concurrent calls per GPU).
  ├── Verify voice latency metrics (<800ms total loop).
  └── Launch production pilot.
```

---

## 8. Cost & Unit Economics (Per 1,000 Calls)
*Assumptions: 2.5 minutes average duration per call; 20 turns per call.*

* **Telephony (Telnyx Direct SIP):** $0.008/min × 2.5 × 1,000 = **$20.00**
* **Dedicated GPU Server (1x RTX 4090 @ $0.40/hr):** ~15 hours runtime = **$6.00**
* **LLM (DeepSeek-V3 API):** $0.14/1M input, $0.28/1M output tokens = **$1.80**
* **STT & TTS (Faster-Whisper + Kokoro-82M):** Processed locally on GPU = **$0.00**
* **Control Plane Hosting & Cal.com:** Allocated compute = **$2.50**
* **Total Cost per 1,000 Calls:** **~$30.30 (~$0.03 per call)**
```