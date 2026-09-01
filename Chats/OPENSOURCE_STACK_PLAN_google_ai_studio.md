Here is the standalone **File 2: `OPENSOURCE_STACK_PLAN.md`** ready to copy and save:

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
  * Remaining VRAM handles multiple concurrent streams (up to **10–12 simultaneous calls per GPU**).

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