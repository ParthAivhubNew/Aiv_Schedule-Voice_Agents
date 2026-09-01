from pydantic import BaseModel, Field
from typing import List, Optional, Any, Dict

# Auth Schemas
class LoginRequest(BaseModel):
    username: str
    password: Optional[str] = "password"

class OperatorResponse(BaseModel):
    id: str
    username: str
    name: str
    role: str
    email: Optional[str] = None

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    operator: OperatorResponse

# Company Profile Schemas
class CompanyProfileSchema(BaseModel):
    id: Optional[str] = "default"
    name: str = "AIVHub"
    pitch: str = "AI-powered business intelligence dashboards for mid-market operations teams"
    industry: str = "Business intelligence / data consulting"
    website: str = "https://aivhub.io"
    social: str = "linkedin.com/company/aivhub"
    caller_name: str = "Sam"
    caller_id: str = "+44 20 7946 0912"
    tone: str = "Professional, concise, friendly"
    disclosure: str = "This call may be recorded for quality and training purposes."
    legal_name: str = "AIVHub Ltd"
    ico_ref: str = "ZA774219"
    dpo_contact: str = "privacy@aivhub.io"
    dnc_notes: str = "Opt-outs logged immediately and excluded from all future missions."
    timezone: str = "Europe/London"
    lunch_start: str = "12:00"
    lunch_end: str = "13:00"
    call_hours_policy: str = "respectful"
    weekday_start: str = "09:00"
    weekday_end: str = "17:30"

class KnowledgeSourceSchema(BaseModel):
    id: Optional[str] = None
    name: str
    type: str
    value: str
    status: Optional[str] = "indexed"
    synced: Optional[str] = "Just now"

class ServiceSchema(BaseModel):
    id: Optional[str] = None
    name: str
    ideal: str
    desc: str

class FAQSchema(BaseModel):
    id: Optional[str] = None
    question: str
    answer: str

class ConnectionSchema(BaseModel):
    id: Optional[str] = None
    group_name: str
    name: str
    status: str = "not_configured"
    api_key_masked: Optional[str] = None
    config: Optional[Dict[str, Any]] = None

# Prospect & Registry Schemas
class PersonSchema(BaseModel):
    id: Optional[str] = None
    canonicalName: str
    aliases: List[str] = []
    role: str = ""
    phone: str = ""

class ContactRegistrySchema(BaseModel):
    id: Optional[str] = None
    canonicalName: str
    aliases: List[str] = []
    phones: List[str] = []
    websites: List[str] = []
    region: Optional[str] = None
    sector: Optional[str] = None
    people: List[Dict[str, Any]] = []
    doNotCall: bool = False
    lastOutcome: Optional[str] = None
    lastContactAt: Optional[str] = None
    requestedFollowUp: Optional[Dict[str, Any]] = None

class ProspectSchema(BaseModel):
    id: Optional[str] = None
    mission_id: Optional[str] = None
    registry_id: Optional[str] = None
    name: str
    sector: Optional[str] = "General"
    region: Optional[str] = "UK-wide"
    status: str = "queued"
    fit: int = 80
    last_contact: Optional[str] = "—"
    contact_person: Optional[str] = "—"
    phone: Optional[str] = ""
    site: Optional[str] = ""
    channel: Optional[str] = "voice"
    fallback_channel: Optional[str] = None
    note: Optional[str] = ""
    time_status: Optional[str] = "waiting"

# Mission Schemas
class MissionCreateRequest(BaseModel):
    title: str
    sector: Optional[str] = "General"
    region: Optional[str] = "UK-wide"
    source: str = "discover"
    prompt: Optional[str] = None
    concurrency: int = 5
    call_window: str = "09:00–17:30"
    timezone: str = "Europe/London"
    lunch_start: str = "12:00"
    lunch_end: str = "13:00"
    default_channel: str = "voice"
    no_answer_fallbacks: List[str] = ["whatsapp", "sms", "email"]
    prospects: List[Dict[str, Any]] = []

class MissionResponse(BaseModel):
    id: str
    title: str
    sector: str
    region: str
    status: str
    contacted: int
    total: int
    meetings_booked: int
    created: str
    source: str
    concurrency: int
    queue_estimate: Optional[Dict[str, Any]] = None
    call_window: str
    timezone: str
    lunch_start: str
    lunch_end: str
    no_answer_fallbacks: List[str]
    default_channel: str
    prospects: List[Dict[str, Any]] = []

# Live Call & Call Log Schemas
class LiveCallSchema(BaseModel):
    id: str
    mission_id: Optional[str] = None
    prospect_id: Optional[str] = None
    prospect: str
    mission: str
    state: str = "negotiating"
    channel: str = "voice"
    duration: str = "00:00"
    flag: Optional[str] = None
    taken: bool = False
    listening: bool = False
    confirming_end: bool = False
    ended: bool = False
    booked: bool = False
    transcript: List[str] = []

class CallLogSchema(BaseModel):
    id: Optional[str] = None
    registry_id: Optional[str] = None
    canonical_name: str
    listed_as: str
    person_canonical: Optional[str] = ""
    person_listed_as: Optional[str] = ""
    channel: str = "voice"
    mission: str = ""
    started_at: str
    ended_at: str
    duration: str = "0 min"
    outcome: str = "contacted"
    requested_follow_up: Optional[Dict[str, Any]] = None
    words_locked: bool = True
    transcript: List[Dict[str, Any]] = []

# Meeting & Schedule Schemas
class MeetingSchema(BaseModel):
    id: Optional[str] = None
    prospect: str
    mission: str
    date: str
    time: str
    duration: str = "15 min"
    status: str = "upcoming"
    fit: int = 85
    channel: str = "voice"
    format: str = "video"
    platform: Optional[str] = "Google Meet"
    video_link: Optional[str] = None
    dial_in: Optional[str] = None
    address: Optional[str] = None
    host: str = "Jitendra S."
    attendee: Optional[str] = ""
    prep: Optional[str] = ""
    outcome: Optional[str] = None
    call_transcript: List[Dict[str, Any]] = []
    meeting_transcript: Optional[List[Dict[str, Any]]] = None

class ScheduleItemSchema(BaseModel):
    id: Optional[str] = None
    day: str
    time: str
    prospect: str
    mission: str
    window: str = "09:00–17:30"
    status: str = "queued"
    honored: bool = False
    deferred: bool = False
    honored_quote: Optional[str] = None

class NotificationSchema(BaseModel):
    id: Optional[str] = None
    text: str
    time: str = "Just now"
    unread: bool = True
    type: str = "info"

# Post Scheduler Schemas
class SocialScheduleSchema(BaseModel):
    id: Optional[str] = None
    weekday: str
    time: str = "10:00"
    theme: str
    focus: str = ""
    channels: List[str] = ["linkedin", "x"]

class SocialTopicSchema(BaseModel):
    id: Optional[str] = None
    schedule_id: Optional[str] = None
    title: str
    angle: str = ""
    hook: str = ""
    source_type: str = "Knowledge Base"
    source_name: str = "Company Profile"
    keywords: List[str] = []

class SocialPostSchema(BaseModel):
    id: Optional[str] = None
    topic_id: Optional[str] = None
    schedule_id: Optional[str] = None
    title: str
    copy: str
    channels: List[str] = ["linkedin", "x"]
    status: str = "draft"
    slot_date_ms: Optional[float] = None
    time: str = "10:00"
    theme: str = "General"
    tone: str = "Professional"

class SocialEmailSchema(BaseModel):
    id: Optional[str] = None
    post_id: str
    subject: str
    from_addr: str = "scheduler@aivhub.io"
    to_addr: str = "admin@aivhub.io"
    date: str = "Today"
    status: str = "unread"
    post_data: Dict[str, Any] = {}
