# AIVHub — Voice AI Agent & Post Scheduler (Production App)

A production-ready, full-stack, Dockerized SaaS workspace featuring an autonomous **AI Voice SDR (Appointment Booking Agent)** and an AI-driven **Post Scheduler & Social Content Planner**.

---

## 🌟 Key Features

1. **AI Voice SDR (Outbound Appointment Booker)**:
   - **UK PECR Compliance Engine**: Enforces legal calling windows (08:00–21:00 vs 09:00–17:30 policies), lunch break avoidance (12:00–13:00), and TPS screening.
   - **Smart Identity Registry & Deduplication**: Strips legal company suffixes (`Ltd`, `PLC`, `LLC`) and matches nicknames (*Jim* $\rightarrow$ *James*) to avoid duplicate dials.
   - **4-Step Bulk Ingestion Wizard**: Import CSV / Excel lists with automatic column guessing, data validation, concurrency limits, and live finish ETA calculations.
   - **Real-Time Live Activity & Supervisor Controls**: Audio waveform pulse, live streaming transcripts, Listen In, Take Over, End Call, and instant Meeting Booking confirmation.
   - **Honored Callback Scheduler**: Locks verbatim quotes (*"Call me next Monday morning"*) and schedules follow-up calls automatically.
   - **Pre-Call Briefings & Meeting Outcomes**: Pre-call prep notes synthesized from conversations with Google Meet / Teams link generation.
   - **Dual Engine Architecture**: Supports real live carriers (Twilio, Vapi, LiveKit, Deepgram, ElevenLabs, DeepSeek) + built-in automated conversational simulator for instant zero-config testing.

2. **AI Post Scheduler Plugin**:
   - Natural language chat planner (*"Schedule 3 posts a week for LinkedIn and X"*).
   - Knowledge Base topic synthesis from company profile and documents.
   - Interactive Approval Inbox and Post Editor.

---

## 🚀 Quick Start (Docker Deployment)

The fastest way to run the complete stack on any server or local machine with Docker:

### 1. Clone & Navigate
```bash
cd "working app"
```

### 2. Configure Environment (Optional)
```bash
cp .env.example .env
```

### 3. Launch with Docker Compose
```bash
docker compose up --build -d
```

### 4. Access the Application
- **Frontend Dashboard**: [http://localhost](http://localhost) (or your server's IP / domain)
- **FastAPI Interactive Docs**: [http://localhost:8000/docs](http://localhost:8000/docs)
- **API Health Check**: [http://localhost:8000/health](http://localhost:8000/health)

---

## 🛠️ Local Development (Without Docker)

You can also run the backend and frontend separately on your local machine:

### Backend Setup
```bash
cd backend
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
python -m app.main
```
*The backend will automatically create SQLite database `aivhub.db` and seed it with initial campaigns, prospects, and company data.*

### Frontend Setup
```bash
cd frontend
npm install
npm run dev
```
*Frontend runs on [http://localhost:5173](http://localhost:5173) with automatic proxying to the FastAPI backend.*

---

## 📂 Project Architecture

```
working app/
├── docker-compose.yml       # Production multi-container composition
├── .env.example             # Environment variable template
├── backend/
│   ├── Dockerfile           # Python 3.11 slim image
│   ├── requirements.txt     # FastAPI, SQLAlchemy, AsyncPG, Redis, etc.
│   ├── app/
│   │   ├── main.py          # FastAPI application & WebSockets
│   │   ├── config.py        # Pydantic Settings
│   │   ├── database.py      # Async database connection & sessions
│   │   ├── models/          # SQLAlchemy data models
│   │   ├── schemas/         # Pydantic request/response schemas
│   │   ├── api/             # REST API routers (Missions, Calls, Schedule, Meetings, etc.)
│   │   ├── services/        # Compliance engine, identity deduplication, call simulator
│   │   ├── websockets/      # Live audio & transcript broadcast hub
│   │   └── seed_data.py     # Initial database seeder
└── frontend/
    ├── Dockerfile           # Multi-stage build (Node -> Nginx Alpine)
    ├── nginx.conf           # Reverse proxy configuration
    ├── package.json         # React 19, Lucide, Recharts, PapaParse, XLSX, Vite
    ├── vite.config.js       # Vite development proxy
    └── src/
        ├── App.jsx          # Root application coordinator & state
        ├── api/             # REST & WebSocket client wrappers
        ├── tokens.js        # Design tokens, colors, typography
        ├── components/      # UI component library (Sidebar, TopBar, Badges, etc.)
        ├── views/           # Voice Operator App views (Missions, Live, Schedule, etc.)
        ├── scheduler/       # Post Scheduler plugin
        └── hub/             # LoginScreen and Workspace Hub
```

---

## 🔒 Security & Compliance
- **UK GDPR / PECR Standard**: Calling windows enforced in code, explicit statutory recording disclosures, and DNC opt-outs immediately excluded from all dialers.
- **Append-Only Call Log**: Call transcripts and exact prospect quotes are immutable and words-locked.
