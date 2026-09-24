# 🌐 Repository Graph: AIVHub Voice AI Agent & Social Scheduler

**Root Directory:** `C:\Users\aivhu\OneDrive - aivhub.com\Desktop\Voice_AI_agent`  
**Architecture:** Multi-container Full-Stack SaaS (FastAPI + React 19 + PostgreSQL/pgvector + Redis + LiveKit SFU + SearXNG)

---

## 1. High-Level System Architecture

```mermaid
flowchart TB
    subgraph ClientLayer ["Client Interface (React 19 + Vite)"]
        UI_Hub["Hub / Login (PluginHub.jsx)"]
        UI_Voice["Voice Calling Workspace (CallingWorkspace.jsx)"]
        UI_Social["Social Scheduler Workspace (SocialWorkspace.jsx)"]
        UI_Admin["Cal.com Admin Settings (CalcomAdminModal.jsx)"]
    end

    subgraph Ingress ["Reverse Proxy & Web Server"]
        Nginx["Nginx Reverse Proxy (:80 / :8080)"]
    end

    subgraph BackendCore ["FastAPI Backend Application (:8000)"]
        API_Gateway["FastAPI App (main.py)"]
        WS_Hub["WebSocket Call Hub & Media Streamer"]
        
        subgraph APIRouters ["API Routers (backend/app/api/)"]
            R_Missions["missions.py"]
            R_Calls["calls.py"]
            R_Prospects["prospects.py"]
            R_Meetings["meetings.py / calcom.py"]
            R_VoiceEngines["livekit_router / vapi_router / retell_router / custom_voice_router / sip_webhook"]
            R_Social["scheduler.py"]
            R_Enrichment["enrichment.py"]
            R_Auth["auth.py / profile.py"]
        end

        subgraph CoreServices ["Core Business Services (backend/app/services/)"]
            S_Compliance["compliance.py (UK PECR/GDPR)"]
            S_Identity["identity.py (Deduplication)"]
            S_VoiceEngine["voice_plugin_plan.py (per-call engine select) -> xai_voice_service.py / voice_openai.py / voice_modular.py"]
            S_RAG["rag_service.py / embedding_service.py / crawler_service.py"]
            S_Calendar["calendar_service.py / booking_policy.py / booking_tools.py (wired: xai + openai only, see note below)"]
            S_SocialPub["social_publisher.py / post_writer.py / social_oauth.py"]
            S_Telephony["telephony_provider.py / outbound_dial.py"]
        end
    end

    subgraph PersistenceAndInfra ["Data & Real-Time Infrastructure"]
        DB_PG[("PostgreSQL 16 + pgvector (:5432)")]
        Cache_Redis[("Redis 7 Cache & Queue (:6379)")]
        SFU_LiveKit["LiveKit WebRTC SFU (:7880-:7882)"]
        Search_Searxng["SearXNG Meta-Search (:8888)"]
    end

    subgraph ExternalProviders ["External Telephony & AI Providers"]
        Ext_Telephony["Telephony: Twilio / Telnyx / SIPgate"]
        Ext_STT["STT: Deepgram / Whisper"]
        Ext_LLM["LLM: OpenAI / Anthropic / DeepSeek / Grok"]
        Ext_TTS["TTS: ElevenLabs / Cartesia / Telnyx"]
        Ext_Socials["Socials: LinkedIn / X / Meta / Threads"]
        Ext_Cal["Cal.com Cloud / Self-hosted"]
    end

    ClientLayer --> Nginx
    Nginx --> API_Gateway
    Nginx --> WS_Hub
    API_Gateway --> APIRouters
    APIRouters --> CoreServices
    CoreServices --> DB_PG
    CoreServices --> Cache_Redis
    CoreServices --> SFU_LiveKit
    CoreServices --> Search_Searxng
    S_VoiceEngine --> Ext_STT & Ext_LLM & Ext_TTS
    S_Telephony --> Ext_Telephony
    S_SocialPub --> Ext_Socials
    S_Calendar --> Ext_Cal
```

---

## 2. Directory Structure & File Map

```
Voice_AI_agent/
├── docker-compose.yml                      # Multi-service container orchestration
├── docker-compose.override.yml             # Local overrides & developer mounts
├── livekit.yaml                            # Self-hosted LiveKit SFU configuration
├── README.md                               # Project documentation & setup guides
│
├── backend/                                # FastAPI Application Core
│   ├── Dockerfile                          # Python 3.11 container definition
│   ├── requirements.txt                    # Backend dependencies (FastAPI, SQLAlchemy, asyncpg, etc.)
│   └── app/
│       ├── main.py                         # Application entrypoint, lifespan migrations & router mounting
│       ├── config.py                       # Pydantic Settings & environment variables
│       ├── database.py                     # Async SQLAlchemy engine & session factory
│       ├── seed_data.py                    # Database bootstrapping & default seed records
│       │
│       ├── models/                         # SQLAlchemy ORM Models
│       │   └── models.py                   # Data schemas (Organizations, Missions, Calls, Meetings, etc.)
│       │
│       ├── schemas/                        # Pydantic request/response schemas
│       │
│       ├── api/                            # REST API Endpoint Routers
│       │   ├── auth.py                     # User authentication & JWT session management
│       │   ├── missions.py                 # Campaign creation, CSV ingestion & batch control
│       │   ├── prospects.py                # Contact list management & lead statuses
│       │   ├── calls.py                    # Outbound dial triggers, call controls, Twilio webhooks
│       │   │                               #   & transcript-regex booking fallback (confirm-booking)
│       │   ├── meetings.py                 # Meeting briefings, conversions & outcomes
│       │   ├── calcom.py                   # Cal.com v2 integration, webhook receiver & slot discovery
│       │   ├── schedule.py                 # Call queue scheduling & honored callbacks
│       │   ├── conversation_templates.py   # Dynamic script & objection template management
│       │   ├── connections.py              # Third-party provider credentials & key validation
│       │   ├── custom_voice_router.py      # Custom modular STT/LLM/TTS stack orchestration
│       │   ├── livekit_router.py           # WebRTC room token generation & SIP trunking
│       │   ├── vapi_router.py              # Vapi voice engine webhooks & control
│       │   ├── retell_router.py            # Retell voice engine webhooks & control
│       │   ├── sip_webhook.py              # xAI / Telnyx SIP inbound webhooks
│       │   ├── enrichment.py               # SearXNG web research & prospect enrichment
│       │   ├── scheduler.py                # AI social post scheduler & generation
│       │   ├── analytics.py                # Metrics, call duration & conversion analytics
│       │   ├── logs.py                     # System logs & structured audit events
│       │   ├── profile.py                  # Company branding, tone, & PECR policies
│       │   └── diagnostics.py              # System health, connection checks & latency diagnostics
│       │
│       ├── services/                       # Core Business Logic & Pipelines
│       │   ├── compliance.py               # UK PECR calling windows & TPS compliance checks
│       │   ├── identity.py                 # Name normalization, suffix stripping & deduplication
│       │   ├── outbound_dial.py            # Automated multi-carrier dialer dispatch
│       │   ├── telephony_provider.py       # Twilio / Telnyx / SIP trunking abstraction
│       │   ├── voice_plugin_plan.py        # Resolves per-call engine/carrier/LLM/STT/TTS plan
│       │   ├── xai_voice_service.py        # xAI Realtime engine — full tool-call booking (mature path)
│       │   ├── voice_openai.py             # OpenAI Realtime engine — reuses xAI tool defs for booking
│       │   ├── voice_modular.py            # STT -> LLM -> TTS cascade (Deepgram/Whisper -> llm_gateway -> ElevenLabs/Cartesia)
│       │   ├── voice_clone.py              # Voice cloning integration
│       │   ├── livekit_service.py          # LiveKit WebRTC session management
│       │   ├── llm_gateway.py              # Multi-provider LLM routing & token tracking (no `tools` param yet)
│       │   ├── conversation_engine.py      # Prompt construction for modular engine (⚠ not wired to tool execution)
│       │   ├── booking_tools.py            # Tool schemas/executor for check_availability/book_appointment
│       │   │                               #   (⚠ defined but never imported by voice_modular/llm_gateway)
│       │   ├── crawler_service.py          # Website spider for knowledge ingestion
│       │   ├── embedding_service.py        # Vector generation for pgvector
│       │   ├── rag_service.py              # Vector similarity search for company knowledge
│       │   ├── enrichment_service.py       # Deep lead research via SearXNG & LLM
│       │   ├── calendar_service.py         # Internal & Cal.com calendar synchronization
│       │   ├── booking_policy.py           # Working hours, slot calculation & buffer logic
│       │   ├── retell_service.py           # Retell voice engine integration
│       │   ├── vapi_service.py             # Vapi voice engine integration
│       │   ├── social_publisher.py         # Multi-platform social media dispatch
│       │   ├── post_writer.py              # AI social content generation & channel adaptation
│       │   ├── social_oauth.py             # OAuth token exchange/storage for social platforms
│       │   ├── secret_box.py               # Symmetric encryption for stored API keys
│       │   ├── key_validator.py            # Validates third-party provider API keys
│       │   ├── call_log_writer.py          # Persists finalized call logs & transcripts
│       │   ├── call_names.py               # Prospect/caller name resolution helpers
│       │   ├── call_recorder.py            # Call audio recording capture
│       │   ├── media_store.py              # Recorded media file storage
│       │   ├── process_logger.py           # Structured process/audit logging
│       │   ├── timezone_service.py         # Timezone resolution for scheduling
│       │   ├── timezone_and_phone_utils.py # Phone number & timezone normalization helpers
│       │   └── whatsapp_notify.py          # WhatsApp confirmation messaging
│       │
│       └── websockets/                     # Real-Time Streaming
│           ├── call_hub.py                 # Live transcript & call event broadcaster
│           └── media_stream.py             # Twilio Media Stream bidirectional audio bridge
│
├── frontend/                               # React 19 Single Page Application
│   ├── Dockerfile                          # Multi-stage production build (Vite -> Nginx)
│   ├── nginx.conf                          # Reverse proxy for static assets & /api forwarding
│   ├── package.json                        # Dependencies (React 19, Lucide, Recharts, Vite)
│   ├── vite.config.js                      # Vite proxying configuration
│   └── src/
│       ├── main.jsx                        # Vite entrypoint
│       ├── App.jsx                         # ⚠ ~25k-line monolith: hosts BOTH "classic" & "simple" editions,
│       │                                   #   toggled at runtime (defaults to "simple"); most logic lives here
│       │                                   #   rather than in views/ (many view files are dead/orphaned — see
│       │                                   #   frontend_dual_editions note)
│       ├── tokens.js                       # Radiant Dark glassmorphic design tokens & themes
│       │
│       ├── hub/                            # Authentication & App Navigation
│       │   ├── LoginScreen.jsx             # Operator login & authentication form
│       │   └── PluginHub.jsx               # Workspace selector (Voice Operator vs Social Scheduler)
│       │
│       ├── calling/                        # Autonomous Voice SDR Workspace
│       │   ├── CallingWorkspace.jsx        # Navigation shell & primary view coordinator
│       │   ├── CallingSchedule.jsx         # Honored callback calendar & timeline
│       │   └── callingEdition.js           # classic/simple edition toggle (localStorage + #hash override)
│       │
│       ├── views/                          # Voice SDR Sub-Views (⚠ largely superseded by App.jsx monolith)
│       │   ├── MissionsView.jsx            # Campaign monitor & batch progress
│       │   ├── NewMissionModal.jsx         # 4-step CSV upload, column mapping & PECR configuration
│       │   ├── ProspectsView.jsx           # Filterable contact list & lead statuses
│       │   ├── LiveCallsView.jsx           # Real-time audio waveform, live transcript & supervisor take-over
│       │   ├── CallLogView.jsx             # Words-locked historical transcripts & audio playback
│       │   ├── ScheduleView.jsx            # Hourly queue management & callback slots
│       │   ├── MeetingsView.jsx            # Booked appointments, pre-call briefings & calendar links
│       │   ├── ConversationTemplatesView.jsx# Script builder, objection matrix & variable interpolation
│       │   ├── CompanyProfileView.jsx      # Business profile, tone, rules, and PECR settings
│       │   ├── ConnectionsView.jsx         # Voice engine & provider API key management
│       │   ├── ProviderConfigView.jsx      # Telephony and AI vendor selector
│       │   ├── AnalyticsView.jsx           # Performance charts, conversion rates & calling stats
│       │   └── TelephonyDocsView.jsx       # Interactive webhook & SIP setup documentation
│       │
│       ├── components/                     # Shared UI chrome
│       │   ├── AppChrome.jsx               # App shell wrapper
│       │   ├── Sidebar.jsx / TopBar.jsx    # Primary navigation chrome
│       │   ├── BookingPolicyEditor.jsx     # Booking policy rules editor
│       │   ├── LiveKitBrowserCallModal.jsx # In-browser LiveKit call modal
│       │   ├── MeetingInvitePreview.jsx    # Meeting invite preview card
│       │   └── Badges.jsx                  # Status badge components
│       │
│       ├── plugins/                        # Standalone plugin widgets
│       │   ├── CalcomSchedulerPlugin.jsx   # Cal.com scheduling widget
│       │   ├── EmailOutreachPlugin.jsx     # Email outreach widget
│       │   └── LeadGenerationPlugin.jsx    # Lead generation widget
│       │
│       ├── scheduler/                      # AI Post Scheduler Workspace
│       │   ├── SocialWorkspace.jsx         # Social Planner, Approval Inbox, Accounts & Publishing
│       │   ├── PostSchedulerPlugin.jsx     # AI post creation wizard & natural language chat planner
│       │   ├── chatClean.js                # Markdown cleaning & text formatting utilities
│       │   └── legacy/                     # Retired code kept for reference
│       │       ├── App.jsx.classic-backup  # Pre-refactor snapshot of the classic-edition App.jsx
│       │       └── README.md
│       │
│       ├── api/                            # API client helpers
│       ├── utils/                          # Shared frontend utilities
│       │
│       └── admin/                          # Administrative Settings
│           └── CalcomAdminModal.jsx        # Full Cal.com booking policy & timezone synchronization
│
├── searxng/                                # SearXNG Privacy Search Configuration
│   └── settings.yml                        # Open search engine engine definitions
│
└── test-data/                              # Sample Data & Import Templates
    └── sample_prospects.csv                # Demo contact ingestion dataset
```

---

## 3. Core Operational Workflows

### 🎙️ Voice SDR Outbound Calling Flow

```mermaid
sequenceDiagram
    autonumber
    actor Op as Operator
    participant UI as CallingWorkspace (React)
    participant API as Calls / Missions API
    participant Comp as Compliance Engine
    participant Tel as Telephony (Twilio/Telnyx)
    participant WS as Media Stream WebSocket
    participant AI as Voice Engine (LiveKit / Modular / xAI)
    participant Cal as Calendar Service
    actor Prospect as Prospect (Phone)

    Op->>UI: Trigger Mission / Outbound Call
    UI->>API: POST /api/calls/trigger
    API->>Comp: Validate Calling Hours (PECR) & TPS / DNC
    Comp-->>API: Compliance Approved
    API->>Tel: Initiate Outbound SIP/PSTN Call
    Tel->>Prospect: Ringing / Connect
    Prospect-->>Tel: Answered
    Tel->>WS: Open Bi-directional Audio Stream
    WS->>AI: Stream Prospect Audio (PCM/Opus)
    AI->>AI: STT -> LLM Prompt + RAG Context -> TTS
    AI-->>WS: Stream Synthesized Response Audio
    WS-->>Tel: Play Audio to Prospect
    WS->>UI: Broadcast Live Transcript via WebSocket
    opt Prospect books meeting (xai / openai engines only — real tool-call booking)
        AI->>Cal: execute_xai_tool: book_calendar_meeting (xai_voice_service.py / voice_openai.py)
        Cal-->>AI: Meeting Confirmed + Video Link
        AI->>UI: Update Meeting Records & Notify
    end
    opt Prospect books meeting (modular/LiveKit engine — ⚠ tool-calling NOT wired)
        Note over AI: conversation_engine.py prompts the LLM to call check_availability/<br/>book_appointment, but llm_gateway.py has no `tools` param and<br/>booking_tools.py's executor is never invoked — the LLM's function-call<br/>intent has nowhere to go
        API->>API: Fallback: POST /calls/live/{id}/confirm-booking<br/>(regex-scrapes the transcript post-hoc in calls.py)
    end
    Prospect->>Tel: Hang Up
    Tel->>API: Status Callback (Call Ended)
    API->>API: Write Call Log & Lock Transcript
```

---

### 📝 AI Social Media Scheduler Workflow

```mermaid
sequenceDiagram
    autonumber
    actor Marketer as Marketing Operator
    participant UI as SocialWorkspace (React)
    participant SchedAPI as Scheduler API
    participant Writer as Post Writer Service
    participant RAG as RAG & Knowledge Base
    participant OAuth as Social OAuth Service
    participant Networks as Social Platforms (LinkedIn, X, Meta)

    Marketer->>UI: Request Plan ("Create 3 LinkedIn & X posts about AI SDR")
    UI->>SchedAPI: POST /api/scheduler/generate-plan
    SchedAPI->>RAG: Retrieve Company Tone & Knowledge Chunks
    RAG-->>SchedAPI: Context & Unique Selling Points
    SchedAPI->>Writer: Synthesize Tailored Copy per Channel
    Writer-->>SchedAPI: Multi-platform Post Drafts
    SchedAPI-->>UI: Populate Approval Inbox
    Marketer->>UI: Review, Edit & Click "Approve & Schedule"
    UI->>SchedAPI: POST /api/scheduler/posts/{id}/approve
    Note over SchedAPI: Scheduled Trigger fires at designated time
    SchedAPI->>OAuth: Retrieve Decrypted Access Tokens
    OAuth-->>SchedAPI: Active OAuth Credentials
    SchedAPI->>Networks: Publish Post & Media via Platform APIs
    Networks-->>SchedAPI: Publication ID & Post URL
    SchedAPI->>UI: Update Status to "Published"
```

---

## 4. Entity Relationship Model (Database Schema)

```mermaid
erDiagram
    ORGANIZATIONS ||--o{ OPERATORS : "has members"
    ORGANIZATIONS ||--o{ COMPANY_PROFILES : "owns configuration"
    ORGANIZATIONS ||--o{ MISSIONS : "executes"
    ORGANIZATIONS ||--o{ LIVE_CALLS : "monitors"
    ORGANIZATIONS ||--o{ CONVERSATION_TEMPLATES : "defines"

    MISSIONS ||--o{ PROSPECTS : "contains"
    CONTACT_REGISTRY ||--o{ PROSPECTS : "maps canonical identity"

    KNOWLEDGE_SOURCES ||--o{ KNOWLEDGE_CHUNKS : "chunked & embedded into"

    SOCIAL_SCHEDULES ||--o{ SOCIAL_TOPICS : "categorizes"
    SOCIAL_TOPICS ||--o{ SOCIAL_POSTS : "generates"

    PROSPECTS ||--o{ CALL_LOGS : "records history"
    PROSPECTS ||--o{ MEETINGS : "schedules"
    PROSPECTS ||--o{ SCHEDULE_ITEMS : "enqueued for"

    ORGANIZATIONS {
        string id PK
        string name
        string slug
        string status
    }

    OPERATORS {
        string id PK
        string org_id FK
        string username
        string name
        string role
        string hashed_password
    }

    COMPANY_PROFILES {
        string id PK
        string org_id FK
        string name
        string spoken_name
        string pitch
        string timezone
        string call_hours_policy
        string calendar_mode
    }

    MISSIONS {
        string id PK
        string org_id FK
        string title
        string sector
        string region
        int concurrency
        string call_window
    }

    PROSPECTS {
        string id PK
        string mission_id FK
        string registry_id FK
        string name
        string phone
        string status
        int fit
    }

    LIVE_CALLS {
        string id PK
        string org_id FK
        string carrier_sid
        string prospect
        string state
        json transcript
        bool taken
    }

    CALL_LOGS {
        string id PK
        string canonical_name
        string started_at
        string duration
        string outcome
        bool words_locked
        json transcript
    }

    MEETINGS {
        string id PK
        string prospect
        string date
        string time
        string platform
        string video_link
        string calcom_booking_id
        string status
    }

    KNOWLEDGE_CHUNKS {
        string id PK
        string source_id FK
        text content
        vector embedding
    }

    SOCIAL_POSTS {
        string id PK
        string title
        text copy
        json channels
        string status
        text linkedin_copy
        text x_copy
    }
```

---

## 5. Technology Stack Summary

| Layer | Technologies / Libraries |
| :--- | :--- |
| **Frontend** | React 19, Vite, TailwindCSS / Radiant Dark Tokens, Lucide Icons, Recharts, PapaParse, XLSX, Nginx |
| **Backend** | Python 3.11, FastAPI, Pydantic v2, SQLAlchemy (Async), Uvicorn, Starlette WebSockets |
| **Databases & Cache** | PostgreSQL 16 with `pgvector`, Redis 7 Alpine |
| **WebRTC & Real-time** | LiveKit WebRTC Server (Self-hosted), WebSockets, Twilio Media Streams |
| **Telephony Providers** | Twilio Voice, Telnyx SIP / Voice, SIPgate, xAI SIP Trunking |
| **AI Voice Stack** | Deepgram / OpenAI Whisper (STT) $\rightarrow$ Claude 3.5 Sonnet / GPT-4o / DeepSeek (LLM) $\rightarrow$ ElevenLabs / Cartesia / Telnyx (TTS) |
| **Intelligence & Search** | SearXNG (Self-hosted search engine), BeautifulSoup4, Sentence-Transformers (Embeddings) |
| **Social Integrations** | LinkedIn API, X (Twitter) API v2, Meta Graph API (Facebook, Instagram), Threads API |
| **Calendar Integration** | Cal.com API v2, Google Meet, Microsoft Teams, Internal Calendar Engine |
