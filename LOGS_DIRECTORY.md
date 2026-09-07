# 📋 System Logs Directory & Architecture Map

This document outlines the complete logging architecture across the entire **Voice AI Agent** platform. Every subsystem, background worker, API key validation, web crawl, phone call, calendar booking, and database query has its own dedicated audit trail and physical log file on disk.

---

## 1. Multi-Tier Logging Architecture

Every event in the system is processed through a 4-tier pipeline:

```
                  ┌─────────────────────────────────────────────────────────┐
                  │                    Platform Event                       │
                  │   (Telnyx Dial / URL Crawl / RAG Query / Meeting Book)  │
                  └───────────────────────────┬─────────────────────────────┘
                                              │
                                              ▼
                             app.services.process_logger
                                              │
         ┌───────────────────┬────────────────┼───────────────────┐
         ▼                   ▼                ▼                   ▼
┌──────────────────┐ ┌───────────────┐ ┌──────────────┐ ┌──────────────────┐
│ Dedicated .log   │ │ Master .log   │ │ PostgreSQL   │ │ WebSocket Stream │
│ Subsystem File   │ │ File (All)    │ │ process_logs │ │ Live Dashboard   │
│ (e.g. telephony) │ │ (Full Stream) │ │ (Audit DB)   │ │ (Zero-polling)   │
└──────────────────┘ └───────────────┘ └──────────────┘ └──────────────────┘
```

1. **Dedicated Subsystem File**: Written directly to `backend/logs/<subsystem>.log` on disk.
2. **Master Log File**: Written to `backend/logs/all_processes.log` for global audit trails.
3. **PostgreSQL Database (`process_logs` table)**: Indexed by `subsystem`, `level`, and `created_at` for high-speed filtered queries in the frontend.
4. **Real-Time WebSocket (`/ws/live`)**: Pushes events live to the UI so operators can watch activity stream without refreshing the page.

---

## 2. Dedicated Subsystem Log Files Directory

All physical log files are stored under `backend/logs/`:

| Subsystem ID | Monitored Domain | Physical Disk File Path | Database Filter | Key Events Logged |
| :--- | :--- | :--- | :--- | :--- |
| **`telephony`** | **Telnyx & Twilio Telephony** | [`backend/logs/telephony.log`](file:///c:/Users/aivhu/OneDrive%20-%20aivhub.com/Desktop/Voice_AI_agent/backend/logs/telephony.log) | `subsystem = 'telephony'` | Telnyx API V2 authentication, active phone number queries, outbound dialing, SIP connection state, call duration, and hangup codes. |
| **`voice`** | **Voice Agent & LLM Calls** | [`backend/logs/voice.log`](file:///c:/Users/aivhu/OneDrive%20-%20aivhub.com/Desktop/Voice_AI_agent/backend/logs/voice.log) | `subsystem = 'voice'` | Speech-to-text transcripts, LLM prompt generation timings, inference latency, takeover requests, and TTS voice playback. |
| **`crawler_rag`** | **Knowledge Base & pgvector** | [`backend/logs/crawler_rag.log`](file:///c:/Users/aivhu/OneDrive%20-%20aivhub.com/Desktop/Voice_AI_agent/backend/logs/crawler_rag.log) | `subsystem = 'crawler_rag'` | Web crawl requests, HTML extraction, text cleaning, semantic chunk generation, 384-dim FastEmbed vector generation, and vector cosine queries. |
| **`calendar`** | **Calendar & Bookings** | [`backend/logs/calendar.log`](file:///c:/Users/aivhu/OneDrive%20-%20aivhub.com/Desktop/Voice_AI_agent/backend/logs/calendar.log) | `subsystem = 'calendar'` | Meeting booking creation, time slot allocation, Cal.com API sync vs. Native Calendar engine fallback, video meeting links, and outcomes. |
| **`scheduler`** | **Scheduler & Dial Missions** | [`backend/logs/scheduler.log`](file:///c:/Users/aivhu/OneDrive%20-%20aivhub.com/Desktop/Voice_AI_agent/backend/logs/scheduler.log) | `subsystem = 'scheduler'` | Batch calling queues, prospect status updates, timezone compliance windows (09:00–17:30), and callback deferrals. |
| **`system`** | **System, Keys & Database** | [`backend/logs/system.log`](file:///c:/Users/aivhu/OneDrive%20-%20aivhub.com/Desktop/Voice_AI_agent/backend/logs/system.log) | `subsystem = 'system'` | Backend startup, PostgreSQL connection, pgvector extension checks, API key live probes (xAI, Groq, Deepgram, ElevenLabs), and health status. |
| **`auth`** | **Authentication & Security** | [`backend/logs/auth.log`](file:///c:/Users/aivhu/OneDrive%20-%20aivhub.com/Desktop/Voice_AI_agent/backend/logs/auth.log) | `subsystem = 'auth'` | Operator logins, password hashing, JWT token issuances, role permissions, and access denials. |
| **`all`** | **Master Aggregated Stream** | [`backend/logs/all_processes.log`](file:///c:/Users/aivhu/OneDrive%20-%20aivhub.com/Desktop/Voice_AI_agent/backend/logs/all_processes.log) | `subsystem = 'all'` | Combined real-time chronological stream of every single activity in the entire project. |

---

## 3. Log Levels & Formatting

Each line in the physical `.log` files is formatted uniformly:

```text
[YYYY-MM-DD HH:MM:SS.mmm] [LEVEL] [SUBSYSTEM] [PROCESS_NAME] [DURATION_MS] Message | {Structured JSON Payload}
```

### Supported Severity Levels:
* **`SUCCESS`** (Green): Operations that completed cleanly (e.g., Telnyx key authenticated, web page indexed into 18 chunks, meeting confirmed).
* **`INFO`** (Blue): Normal operational milestones (e.g., crawl started, vector query executed, call connected).
* **`WARN`** (Amber): Recoverable conditions or threshold misses (e.g., no vector chunks matched above 50% threshold, fallback to native calendar engine).
* **`ERROR`** (Red): Operation failures with full exception traces (e.g., Telnyx 401 unauthorized, URL unreachable, timeout).

---

## 4. How to View and Monitor Logs

### Option 1: In the Web UI (Interactive Dashboard)
1. Open the application sidebar and click **System Process Logs**.
2. Select any subsystem tab (**All**, **Telephony (Telnyx)**, **Voice & Calls**, **Crawler & RAG**, **Calendar**, etc.).
3. Features available:
   * **Live Stream Toggle**: Streams incoming events in real-time.
   * **Severity Level Filter**: Filter by `SUCCESS`, `INFO`, `WARN`, `ERROR`, or `ALL`.
   * **Search Bar**: Instant full-text search across messages, process names, and payloads.
   * **Expandable Trace Inspector**: Click on any log row to open the complete structured JSON payload.
   * **View Disk File**: Click **View Disk File (.log)** to inspect the raw file directly on disk.

### Option 2: Live Terminal Tail (PowerShell / Windows)
You can tail any log file in your terminal:

```powershell
# Watch telephony & Telnyx events in real-time
Get-Content -Path "backend/logs/telephony.log" -Wait -Tail 30

# Watch web crawler & pgvector indexing events
Get-Content -Path "backend/logs/crawler_rag.log" -Wait -Tail 30

# Watch all platform events simultaneously
Get-Content -Path "backend/logs/all_processes.log" -Wait -Tail 50
```

### Option 3: Via REST API
* `GET /api/logs` — Fetch all logs with optional query filters:
  * `?subsystem=telephony`
  * `?level=ERROR`
  * `?search=telnyx`
  * `?limit=100`
* `GET /api/logs/subsystems` — Returns event counts and disk file statuses for each subsystem.
* `GET /api/logs/raw/{subsystem}?lines=100` — Fetches the raw tail lines directly from the disk file.
* `DELETE /api/logs?subsystem=telephony` — Truncates logs for a specific subsystem.

### Option 4: Directly in PostgreSQL
```sql
-- Query last 50 error events across the platform
SELECT created_at, subsystem, process_name, message, duration_ms
FROM process_logs
WHERE level = 'ERROR'
ORDER BY created_at DESC
LIMIT 50;

-- Query Telnyx telephony events
SELECT created_at, level, process_name, message, details
FROM process_logs
WHERE subsystem = 'telephony'
ORDER BY created_at DESC;
```
