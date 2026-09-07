# Telnyx & xAI Voice Agent Live Calling Guide

This guide details the complete, step-by-step process for connecting **Telnyx (Carrier)** and **xAI Realtime API (Speech-to-Speech Engine)** to your **FastAPI Backend** so you can place and receive live calls today.

---

## 🏗️ Architecture Overview

```
Caller (Mobile Phone)
       │
       ▼ (1. Dials Phone Number)
Telnyx (Carrier)
       │
       ▼ (2. Inbound SIP INVITE to sip.voice.x.ai:5060 | Codecs: PCMU, PCMA, G.722)
xAI Voice Agent API (Speech-to-Speech Engine)
       │
       ▼ (3. HTTP POST Svix Webhook: /api/sip-webhook)
FastAPI Backend (Your Server)
       │
       ▼ (4. Returns 200 OK fast [<15ms] & Opens wss://api.x.ai/v1/realtime)
Live Call Session
       • Dynamic Prompt with Company Profile & Catalog
       • Tool 1: pgvector RAG Knowledge Search
       • Tool 2: Calendar Meeting Booking
       • Live Transcript Broadcast to Dashboard (/ws/live)
       • Telemetry to backend/logs/telephony.log & voice.log
```

---

## 📋 Checklist to Go Live Today

### Step 1: Configure Telnyx Inbound SIP Routing (3 mins)

1. Log in to your [Telnyx Mission Control Portal](https://portal.telnyx.com).
2. Go to **Voice** ➔ **SIP Trunking** (or **SIP Connections**).
3. Click **Add SIP Connection**:
   - **Connection Name:** `xAI-Voice-Agent`
   - **SIP Connection Type:** Select **FQDN**
   - **Primary FQDN:** `sip.voice.x.ai`
   - **Port:** `5060`
   - **Transport Protocol:** `UDP` (or `Auto`)
   - **Inbound Destination Format:** `+E.164` (e.g. `+12025550199`)
   - **Supported Audio Codecs:** 
     - ✅ **G.711 μ-law (PCMU)** *(Required)*
     - ✅ **G.711 A-law (PCMA)**
     - ✅ **G.722** *(HD Voice)*
     *(Important: Do not disable PCMU/PCMA; xAI and standard carrier handshakes require G.711).*
4. Click **Save Connection**.
5. Go to **Numbers** ➔ **My Numbers** in the Telnyx portal:
   - Find your purchased phone number.
   - Click **Edit / Assign Connection**.
   - Set **Connection** to `xAI-Voice-Agent`.
   - Save changes.

---

### Step 2: Expose Your Local Server via Tunnel (Local Dev Only)

If you are running the backend on your development machine, xAI needs a public HTTPS URL to reach your `/api/sip-webhook`.

1. In Terminal 1, run your backend:
   ```powershell
   py -3.11 -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
   ```

2. In Terminal 2, start an `ngrok` or `cloudflared` tunnel:
   ```powershell
   ngrok http 8000
   ```
   *Copy the forwarding URL (e.g., `https://abcdef-123.ngrok-free.app`).*

3. Verify the webhook health endpoint in your browser or curl:
   ```bash
   curl https://abcdef-123.ngrok-free.app/api/sip-webhook/health
   ```
   *It should return `{"status": "healthy", ...}`.*

---

### Step 3: Register Your Number with xAI Voice Agent (2 mins)

Provide xAI with your phone number and your webhook URL.

1. Set your environment variables in `backend/.env`:
   ```env
   # xAI Realtime Voice Credentials
   XAI_API_KEY=xai-your-real-key-here
   XAI_VOICE_NAME=rex
   XAI_WEBHOOK_SECRET=whsec_your-signing-secret-here

   # Telnyx Telephony
   TELNYX_PHONE_NUMBER=+1xxxxxxxxxx
   ```

2. Register your number in the xAI Console (or via API call):
   - **Phone Number:** Your Telnyx E.164 number (e.g., `+12025550199`)
   - **Webhook URL:** `https://abcdef-123.ngrok-free.app/api/sip-webhook`
   - xAI will provide a webhook signing secret (starts with `whsec_...`).
   - Paste that secret into `XAI_WEBHOOK_SECRET` in your `.env`.

3. Run the pre-flight check script:
   ```powershell
   py -3.11 scripts/register_xai_number.py --webhook-url https://abcdef-123.ngrok-free.app/api/sip-webhook
   ```

---

### Step 4: Make Your First Live Call

1. Pick up your mobile phone and dial your Telnyx phone number.
2. **What happens within 500ms:**
   - Telnyx directs the SIP call to `sip.voice.x.ai:5060`.
   - xAI posts a Svix-signed notification to `/api/sip-webhook`.
   - Your FastAPI server validates the signature and immediately returns `200 OK`.
   - The background task opens a WebSocket to xAI and injects your Company Profile, catalog, and tools.
   - The AI voice answers: *"Hello! This is Sam calling from AIVHub..."*
3. **What to try during the call:**
   - **Ask a business question:** *"What does your enterprise tier include?"*
     ➔ Watch the AI pause for ~100ms, query your `pgvector` knowledge base chunks, and respond with exact facts.
   - **Book a meeting:** *"Can we schedule a demo tomorrow at 2 PM?"*
     ➔ The AI calls `book_calendar_meeting`, adds the appointment to your database schedule, confirms the time, and wraps up.
4. **Watch Live in Your UI:**
   - Open your browser to `http://localhost:5173`.
   - The **Active Calls** dashboard updates live with the conversation transcript.
   - The **System Process Logs** tab shows real-time records in `telephony.log` and `voice.log`.

---

## 🛡️ Security, Codecs & Troubleshooting

### Q: Does my server need any open inbound ports or port forwarding?
**No.** All inbound webhook traffic goes over standard HTTPS (443/80). The WebSocket connection to xAI is an **outbound** client connection initiated by your server. Media packets (RTP) travel directly between Telnyx and xAI.

### Q: Why do I hear dead silence or call drops immediately?
1. **Codec Mismatch:** Ensure Telnyx SIP connection has **G.711 μ-law (PCMU)** enabled.
2. **Expired Webhook Secret:** Verify `XAI_WEBHOOK_SECRET` in `.env` matches what xAI generated.
3. **Check Logs:** Inspect `backend/logs/telephony.log` and `backend/logs/voice.log` for exact error codes.
