# AI Appointment Booking Platform — Open-Source / Self-Hosted Plan

## 1. Objective

Build UK-first AI appointment-booking platform using open-source/self-hosted infrastructure wherever practical.

Client gives natural-language request:

> Find me a dentist in London next Tuesday after 5 PM and book earliest suitable appointment.

System:

```text
Client request
→ requirement extraction
→ business discovery
→ business research
→ business ranking
→ AI outbound call
→ conversation
→ availability negotiation
→ booking
→ verification
→ client notification
```

DeepSeek API is used initially as LLM. Voice, database, workflow, RAG, crawling, observability, and most infrastructure remain self-hosted/open-source.

---

# 2. Core architecture

```text
Next.js
   ↓
FastAPI
   ↓
PostgreSQL + pgvector
   ↓
Redis
   ↓
Temporal
   ↓
Mission / Agent Orchestrator
   ↓
LiveKit Agents
   ↓
STT → DeepSeek → TTS
   ↓
LiveKit SIP
   ↓
SIP carrier
   ↓
Business
```

Important separation:

```text
LLM = language/reasoning
Backend = business truth
State machine = call truth
Temporal = workflow durability
Telephony = PSTN
PostgreSQL = persistent truth
pgvector = semantic retrieval
```

Never let LLM directly modify appointment state.

---

# 3. Recommended stack

## Frontend

- Next.js
- TypeScript
- Tailwind CSS
- shadcn/ui
- TanStack Query
- Zod
- WebSocket/SSE for live mission updates

## Backend

- Python
- FastAPI
- Pydantic
- SQLAlchemy
- Alembic

## Database

- PostgreSQL
- pgvector
- PostGIS when geographic search becomes important

## Cache

- Redis

## Workflow

- Temporal

## Realtime voice

- LiveKit Agents

## STT

Primary benchmark:

- faster-whisper
- Whisper large-v3-family models

Additional benchmark:

- Parakeet-family models

## TTS

Benchmark:

- Kokoro
- Piper
- XTTS-family
- Fish Audio-family models where licensing/deployment fits

## LLM

Current MVP:

- DeepSeek-V4-Flash

Difficult reasoning:

- DeepSeek-V4-Pro

Keep provider abstraction so local models can replace API later.

## Telephony

- LiveKit SIP
- UK SIP carrier

Alternative:

- Asterisk + SIP carrier

## Crawling

- Playwright
- httpx
- Trafilatura
- BeautifulSoup

## Object storage

- MinIO

## Authentication

- Keycloak
- OAuth2/OIDC

## Observability

- OpenTelemetry
- Prometheus
- Grafana

## Deployment

- Docker Compose initially
- Kubernetes later

---

# 4. Repository structure

```text
appointment-ai/
├── apps/
│   ├── web/
│   └── api/
├── services/
│   ├── voice-agent/
│   ├── research/
│   ├── notification/
│   └── worker/
├── packages/
│   ├── schemas/
│   ├── prompts/
│   └── providers/
├── infrastructure/
│   ├── docker/
│   ├── temporal/
│   ├── livekit/
│   └── monitoring/
├── migrations/
├── tests/
└── docs/
```

---

# 5. Database model

Core entities:

```text
organizations
users
roles
permissions

clients
client_preferences

missions
mission_requirements
mission_businesses
mission_events

businesses
business_locations
business_contacts
business_services
business_hours
business_policies

knowledge_sources
knowledge_documents
knowledge_chunks
knowledge_facts

calls
call_participants
call_events
call_transcripts
call_recordings

appointments
appointment_slots
appointment_events

agent_profiles
agent_policies
agent_tool_permissions

notifications
audit_logs
provider_usage
```

Every tenant-owned entity must have reliable organization ownership.

---

# 6. Knowledge architecture

Use separate knowledge domains.

## Company KB

```text
company identity
services
policies
pricing
booking rules
operating countries
communication rules
escalation rules
prohibited actions
```

## Client KB

```text
preferences
location
preferred times
service preferences
approved businesses
businesses to avoid
recurring requirements
```

## Business KB

```text
business identity
website
services
opening hours
phone
address
booking method
policies
historical verified facts
```

Each fact:

```text
fact
source
source_url
retrieved_at
verified_at
confidence
expires_at
```

Never treat old business information as permanent truth.

---

# 7. Business research pipeline

```text
Business candidate
→ website/domain identification
→ official source verification
→ page extraction
→ structured fact extraction
→ confidence score
→ PostgreSQL
→ pgvector
```

Source priority:

1. official website
2. official booking system
3. official listing
4. trusted third-party source
5. search snippet

Do not permanently store unsupported search snippets as facts.

---

# 8. Mission engine

Mission is durable user objective.

Example:

```json
{
  "goal": "book appointment",
  "service": "dental cleaning",
  "location": "London",
  "date_from": "2026-09-01",
  "date_to": "2026-09-01",
  "time_after": "17:00",
  "priority": "earliest",
  "max_businesses": 5
}
```

States:

```text
CREATED
UNDERSTANDING
SEARCHING
RESEARCHING
READY_TO_CALL
CALLING
NEGOTIATING
BOOKING
VERIFYING
COMPLETED

NO_ANSWER
BUSY
VOICEMAIL
CALLBACK_REQUESTED
REJECTED
FAILED
HUMAN_REVIEW
CANCELLED
```

LLM does not own state.

---

# 9. Temporal workflow

Use Temporal for long-running missions.

Example:

```text
Mission created
→ search businesses
→ research
→ rank
→ call business A
→ no answer
→ retry
→ call business B
→ slot offered
→ verify
→ book
→ verify booking
→ notify client
→ complete
```

Workflow survives:

- process crashes
- restarts
- call drops
- callbacks
- retries
- human takeover

---

# 10. Voice pipeline

```text
Business voice
↓
SIP/PSTN
↓
LiveKit
↓
Streaming STT
↓
Agent Orchestrator
↓
DeepSeek
↓
Tool call / response
↓
TTS
↓
LiveKit
↓
Business
```

Target low perceived latency.

Voice agent must support:

- interruption
- barge-in
- silence detection
- partial transcription
- corrections
- voicemail
- IVR
- transfer
- hold
- call drops

---

# 11. STT strategy

Start with faster-whisper.

Benchmark against Whisper large-v3-family and Parakeet-family models.

Test:

```text
UK accents
telephone audio
names
dates
addresses
numbers
background noise
interruptions
```

Metrics:

```text
word error rate
latency
GPU memory
CPU usage
throughput
```

Do not select solely from public benchmark scores.

---

# 12. TTS strategy

Benchmark:

- Kokoro
- Piper
- XTTS-family

Test:

```text
UK English
naturalness
dates
numbers
names
business names
pauses
speed
latency
voice consistency
```

Keep premium TTS as optional fallback if open-source quality is insufficient.

---

# 13. DeepSeek strategy

Use DeepSeek-V4-Flash for:

- requirement extraction
- business fact extraction
- normal conversation
- tool selection
- call summarization
- classification

Use DeepSeek-V4-Pro selectively for:

- complex mission planning
- ambiguous requirements
- difficult policy interpretation
- final quality review

Do not use expensive reasoning model for every spoken turn.

---

# 14. LLM provider abstraction

Create:

```python
class LLMProvider:
    async def generate(...)
    async def stream(...)
    async def tool_call(...)
```

Implement:

```text
DeepSeekProvider
LocalProvider
OpenAIProvider
AnthropicProvider
```

Application code should depend on interface, not provider.

---

# 15. Tool system

Start with:

```text
search_businesses()
get_business_profile()
get_business_hours()
get_business_services()

get_client_preferences()
get_mission_requirements()

check_slot()
offer_slot()
confirm_slot()

create_appointment()
verify_appointment()

request_callback()
send_client_notification()

request_human_takeover()
end_call()
```

Every tool must:

- validate input
- validate permissions
- validate mission state
- execute transaction safely
- log action
- return structured output

LLM-generated arguments are untrusted input.

---

# 16. Call state machine

```text
DIALING
→ RINGING
→ CONNECTED
→ HUMAN_OR_IVR
→ INTRODUCTION
→ PURPOSE
→ SERVICE_CONFIRMATION
→ AVAILABILITY
→ NEGOTIATION
→ CUSTOMER_DETAILS
→ BOOKING
→ CONFIRMATION
→ COMPLETED
```

Special states:

```text
VOICEMAIL
TRANSFER
HOLD
CALLBACK
WRONG_NUMBER
BUSINESS_CLOSED
LANGUAGE_MISMATCH
HUMAN_ESCALATION
```

---

# 17. Appointment verification

Never trust LLM claim:

> Booking successful.

Booking is successful only with backend evidence.

Evidence can be:

- booking API confirmation
- calendar event ID
- confirmation number
- explicit business confirmation
- verified appointment record

Final state:

```text
BOOKING_CONFIRMED
```

Only then notify client.

---

# 18. Business scoring

Use deterministic scoring:

```text
service match
geographic match
opening-hours match
availability probability
client preference
historical answer rate
historical booking rate
business reliability
call cost
```

Example:

```text
ABC Dental 92
XYZ Dental 87
London Dental 81
```

Historical data should improve ranking over time.

---

# 19. Business memory

Store verified historical facts:

```text
business_id
fact
source
confidence
last_verified
expiry
```

Example:

```text
ABC Dental
phone booking required
confidence 0.99

ABC Dental
best answer window 10:00–14:00
confidence 0.82
```

Historical behavior must expire.

---

# 20. Human takeover

Trigger when:

```text
confidence below threshold
unsupported business question
payment required
medical/legal issue
policy conflict
user requires human
```

Dashboard:

```text
LIVE CALL
Business: ABC Clinic
State: HUMAN_REVIEW

[Take Over]
[Listen]
[End Call]
```

Human takeover must preserve mission/call state.

---

# 21. Calendar

Support:

- Google Calendar API
- Microsoft Graph

Functions:

```text
availability
create event
update event
cancel event
timezone conversion
attendees
reminders
```

Business may still require phone-only booking.

---

# 22. Notifications

Support initially:

- email
- SMS

Later:

- WhatsApp
- push notifications

Send:

```text
business
service
date
time
location
confirmation number
cancellation information
```

Do not expose transcript by default.

---

# 23. Security

Implement:

- OAuth2/OIDC
- JWT
- RBAC
- MFA for administrators
- tenant isolation
- encrypted secrets
- signed webhooks
- rate limiting
- audit logs
- database access controls

Never:

- store keys in source
- expose keys frontend
- log API keys
- log authorization headers

---

# 24. UK/EU compliance architecture

Design for:

- GDPR
- UK GDPR
- telecom rules
- AI disclosure requirements where applicable
- call-recording rules
- automated calling/direct-marketing rules
- sector-specific requirements

Use configurable policy:

```text
country
industry
call_purpose
recording_policy
ai_disclosure
consent_requirement
retention_period
```

Get UK/EU legal review before production outbound calling.

---

# 25. PII handling

Classify:

```text
PUBLIC
INTERNAL
PERSONAL
SENSITIVE
HIGH_RISK
```

Use:

- encryption
- access control
- retention policies
- deletion workflows
- PII redaction
- audit logging

Recommended:

```text
raw audio → short retention
redacted transcript → medium retention
appointment outcome → longer retention
```

---

# 26. Observability

Track:

```text
mission_id
call_id
agent_id
provider
model
STT latency
LLM latency
TTS latency
first-audio latency
tool latency
call duration
tokens
cost
outcome
```

Use:

- OpenTelemetry
- Prometheus
- Grafana

---

# 27. Metrics

Track:

```text
answer_rate
successful_call_rate
booking_rate
callback_rate
failure_rate
human_transfer_rate

average_call_duration
average_booking_time

LLM_cost
STT_cost
TTS_cost
telephony_cost

cost_per_successful_booking
```

Most important business metric:

```text
total cost / successful appointment
```

---

# 28. Testing

Build:

### Unit

- requirement parsing
- date handling
- timezone conversion
- ranking
- slot selection
- policy validation

### Voice

- interruptions
- silence
- accents
- names
- numbers
- dates
- addresses
- noisy audio
- voicemail
- IVR
- hold

### Agent

- tool selection
- hallucination
- refusal
- state transitions
- recovery

### Integration

```text
mission
→ research
→ call
→ booking
→ verification
→ notification
```

### Red-team

Test:

- business changes slot
- business asks for payment
- business asks sensitive question
- business transfers call
- business places AI on hold
- ambiguous appointment time
- business says no AI
- wrong number
- voicemail

---

# 29. Evaluation dataset

Create at least:

```text
100 easy
100 medium
100 difficult
100 interruption-heavy
100 IVR
100 voicemail
100 booking conflicts
100 ambiguous
```

Measure:

```text
task completion
booking correctness
false confirmation rate
tool correctness
state correctness
latency
cost
```

Optimize for correct successful bookings, not pretty transcripts.

---

# 30. Docker Compose MVP

Services:

```text
frontend
api
worker
voice-agent
research
postgres
redis
temporal
livekit
minio
prometheus
grafana
```

Later separate voice/GPU workers.

---

# 31. GPU strategy

Initially:

```text
DeepSeek API
+
CPU/GPU voice models
```

When volume grows:

```text
dedicated GPU workers
```

Separate:

```text
STT GPU
TTS GPU
LLM GPU
```

Do not deploy huge self-hosted LLM merely for architectural purity.

---

# 32. Cost strategy

Open-source software cost:

```text
near zero
```

Paid unavoidable components:

```text
telephony
SIP carrier
DeepSeek API
business-data/search API where required
server/GPU
```

Reduce cost with:

- model routing
- caching
- business knowledge reuse
- prompt compression
- batch research
- short spoken turns
- self-hosted STT/TTS

---

# 33. Development phases

## Phase 0

- repository
- Docker
- FastAPI
- Next.js
- PostgreSQL
- Redis
- auth
- provider abstraction

## Phase 1

- mission creation
- requirement extraction
- business discovery
- business ranking

## Phase 2

- crawling
- business profile
- RAG
- source tracking
- business memory

## Phase 3

- LiveKit
- SIP
- STT
- DeepSeek
- TTS
- interruptions
- call state

## Phase 4

- appointment negotiation
- booking
- verification
- calendar
- notifications

## Phase 5

- Temporal
- retries
- callbacks
- human takeover
- event system

## Phase 6

- compliance
- tenant isolation
- billing
- monitoring
- production hardening

---

# 34. MVP definition

MVP is successful when:

```text
Client gives natural-language request
→ system finds suitable businesses
→ researches them
→ calls business
→ AI speaks naturally
→ handles interruptions
→ negotiates appointment
→ verifies booking
→ reports result
```

Not merely:

```text
AI can place phone call
```

---

# 35. Recommended initial stack

```text
Next.js
TypeScript
FastAPI
Python
PostgreSQL
pgvector
Redis
Temporal
LiveKit Agents
DeepSeek-V4-Flash
DeepSeek-V4-Pro for difficult cases
faster-whisper
Kokoro
Playwright
Trafilatura
MinIO
Keycloak
OpenTelemetry
Prometheus
Grafana
Docker Compose
LiveKit SIP
UK SIP carrier
```

Build provider interfaces from day one so premium or local models can replace individual components later.
