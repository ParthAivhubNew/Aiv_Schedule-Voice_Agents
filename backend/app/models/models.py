from sqlalchemy import Column, String, Integer, Boolean, Text, JSON, DateTime, ForeignKey, Float, UniqueConstraint, FetchedValue
from sqlalchemy.orm import relationship
from datetime import datetime
from app.database import Base

try:
    from pgvector.sqlalchemy import Vector
except (ImportError, Exception):
    from sqlalchemy import JSON
    def Vector(dim):
        return JSON

class Organization(Base):
    __tablename__ = "organizations"
    
    id = Column(String, primary_key=True, index=True)
    name = Column(String, nullable=False)
    slug = Column(String, unique=True, index=True, nullable=False)
    status = Column(String, default="active")  # active, inactive, suspended
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    operators = relationship("Operator", back_populates="organization")

class Operator(Base):
    __tablename__ = "operators"
    
    id = Column(String, primary_key=True)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True, index=True, server_default=FetchedValue())
    username = Column(String, index=True, nullable=False)
    name = Column(String, nullable=False)
    role = Column(String, default="Operator")
    email = Column(String, nullable=True)
    hashed_password = Column(String, nullable=False)
    is_active = Column(Boolean, default=True)
    must_change_password = Column(Boolean, default=False)
    password_changed_at = Column(DateTime, nullable=True)
    last_login_at = Column(DateTime, nullable=True)
    notify_prefs = Column(JSON, nullable=True)  # {event_key: bool}; missing keys use the defaults
    email_verified = Column(Boolean, default=False)
    google_sub = Column(String, nullable=True, index=True)
    phone = Column(String, default="")  # rings for "Call my phone" tests and when taking over a call
    created_at = Column(DateTime, default=datetime.utcnow)

    organization = relationship("Organization", back_populates="operators")

    __table_args__ = (
        UniqueConstraint("org_id", "username", name="uq_operator_org_username"),
    )


class AuthSession(Base):
    """One signed-in browser. Its refresh token is only valid while this row is not revoked."""
    __tablename__ = "auth_sessions"

    id = Column(String, primary_key=True)
    operator_id = Column(String, ForeignKey("operators.id", ondelete="CASCADE"), nullable=False, index=True)
    refresh_jti = Column(String, nullable=False)
    user_agent = Column(String, default="")
    ip = Column(String, default="")
    created_at = Column(DateTime, default=datetime.utcnow)
    last_used_at = Column(DateTime, default=datetime.utcnow)
    expires_at = Column(DateTime, nullable=False)
    revoked_at = Column(DateTime, nullable=True)


class Role(Base):
    """A named set of section levels (none / view / full) inside an organisation."""
    __tablename__ = "roles"

    id = Column(String, primary_key=True)
    org_id = Column(String, nullable=False, index=True, default="org_default")
    name = Column(String, nullable=False)
    description = Column(Text, default="")
    is_admin = Column(Boolean, default=False)
    is_system = Column(Boolean, default=False)
    levels = Column(JSON, default=dict)  # section -> none | view | full
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (UniqueConstraint("org_id", "name", name="uq_role_org_name"),)


class OperatorRole(Base):
    __tablename__ = "operator_roles"

    operator_id = Column(String, ForeignKey("operators.id", ondelete="CASCADE"), primary_key=True)
    role_id = Column(String, ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True)


class OperatorGrant(Base):
    """A level for one section given straight to one user (on top of their roles)."""
    __tablename__ = "operator_grants"

    operator_id = Column(String, ForeignKey("operators.id", ondelete="CASCADE"), primary_key=True)
    section = Column(String, primary_key=True)
    level = Column(String, nullable=False, default="view")
    granted_by = Column(String, default="")
    created_at = Column(DateTime, default=datetime.utcnow)

class CompanyProfile(Base):
    __tablename__ = "company_profile"
    
    id = Column(String, primary_key=True, default="default")
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True, index=True, server_default=FetchedValue())
    name = Column(String, default="Your company")
    # How TTS should say the company name (optional). Empty → auto from name.
    spoken_name = Column(String, nullable=True)
    pitch = Column(Text, default="AI-powered business intelligence dashboards for mid-market operations teams")
    industry = Column(String, default="Business intelligence / data consulting")
    website = Column(String, default="https://aivhub.io")
    social = Column(String, default="linkedin.com/company/aivhub")
    caller_name = Column(String, default="Sam")
    caller_id = Column(String, nullable=True, default=None)
    tone = Column(String, default="Professional, concise, friendly")
    disclosure = Column(Text, default="This call may be recorded for quality and training purposes.")
    legal_name = Column(String, default="AIVHub Ltd")
    ico_ref = Column(String, default="ZA774219")
    dpo_contact = Column(String, default="privacy@aivhub.io")
    dnc_notes = Column(Text, default="Opt-outs logged immediately and excluded from all future missions.")
    # Organisation time settings: the one source every feature reads (see org_settings.py).
    timezone = Column(String, default="Europe/London")
    week_start = Column(String, default="monday")
    time_format = Column(String, default="24h")  # 24h | 12h
    approver_emails = Column(JSON, default=list)
    lunch_start = Column(String, default="12:00")
    lunch_end = Column(String, default="13:00")
    call_hours_policy = Column(String, default="respectful")
    weekday_start = Column(String, default="09:00")
    weekday_end = Column(String, default="17:30")
    # Outbound conversational script & custom prompt rules (editable from UI Call Script & Rules)
    call_opener = Column(Text, nullable=True)
    call_hook = Column(Text, nullable=True)
    closing_ask = Column(Text, nullable=True)
    custom_rules = Column(Text, nullable=True)
    demo_script = Column(Text, nullable=True)
    calendar_mode = Column(String, default="internal")  # internal | calcom
    default_outbound_template_id = Column(String, nullable=True)
    default_inbound_template_id = Column(String, nullable=True)
    # Agent Studio rules for every call: handover, never say, fields to capture, recording.
    studio = Column(JSON, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class KnowledgeSource(Base):
    __tablename__ = "knowledge_sources"
    # Owning organisation; the database fills it in (see app.core.tenancy).
    org_id = Column(String, index=True, server_default=FetchedValue())
    
    id = Column(String, primary_key=True, index=True)
    name = Column(String, nullable=False)
    type = Column(String, nullable=False)  # "Website URL", "Document upload", "Manual text", etc.
    value = Column(Text, nullable=False)
    status = Column(String, default="pending")  # pending, crawling, indexed, error
    synced = Column(String, default="Just now")
    chunk_count = Column(Integer, default=0)
    last_error = Column(Text, nullable=True)
    crawled_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    chunks = relationship("KnowledgeChunk", back_populates="source", cascade="all, delete-orphan")

class KnowledgeChunk(Base):
    __tablename__ = "knowledge_chunks"
    # Owning organisation; the database fills it in (see app.core.tenancy).
    org_id = Column(String, index=True, server_default=FetchedValue())
    
    id = Column(String, primary_key=True, index=True)
    source_id = Column(String, ForeignKey("knowledge_sources.id", ondelete="CASCADE"), nullable=False, index=True)
    url = Column(String, nullable=True)
    title = Column(String, default="")
    content = Column(Text, nullable=False)
    chunk_index = Column(Integer, default=0)
    embedding = Column(Vector(384), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    source = relationship("KnowledgeSource", back_populates="chunks")


class Service(Base):
    __tablename__ = "services"
    # Owning organisation; the database fills it in (see app.core.tenancy).
    org_id = Column(String, index=True, server_default=FetchedValue())
    
    id = Column(String, primary_key=True, index=True)
    name = Column(String, nullable=False)
    ideal = Column(String, nullable=False)
    desc = Column(Text, nullable=False)

class FAQ(Base):
    __tablename__ = "faqs"
    # Owning organisation; the database fills it in (see app.core.tenancy).
    org_id = Column(String, index=True, server_default=FetchedValue())
    
    id = Column(String, primary_key=True, index=True)
    question = Column(Text, nullable=False)
    answer = Column(Text, nullable=False)

class Connection(Base):
    __tablename__ = "connections"
    # Owning organisation; the database fills it in (see app.core.tenancy).
    org_id = Column(String, index=True, server_default=FetchedValue())
    
    id = Column(String, primary_key=True, index=True)
    group_name = Column(String, nullable=False)  # "LLM", "Speech-to-Text", etc.
    name = Column(String, nullable=False)
    status = Column(String, default="not_configured")  # "connected", "not_configured", "error"
    api_key_masked = Column(String, nullable=True)
    config = Column(JSON, default=dict)

class ContactRegistry(Base):
    __tablename__ = "contact_registry"
    # Owning organisation; the database fills it in (see app.core.tenancy).
    org_id = Column(String, index=True, server_default=FetchedValue())
    
    id = Column(String, primary_key=True, index=True)
    canonical_name = Column(String, index=True, nullable=False)
    aliases = Column(JSON, default=list)
    phones = Column(JSON, default=list)
    websites = Column(JSON, default=list)
    region = Column(String, nullable=True)
    sector = Column(String, nullable=True)
    people = Column(JSON, default=list)
    do_not_call = Column(Boolean, default=False)
    last_outcome = Column(String, nullable=True)
    last_contact_at = Column(String, nullable=True)
    requested_follow_up = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class Mission(Base):
    __tablename__ = "missions"
    
    id = Column(String, primary_key=True, index=True)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True, index=True, server_default=FetchedValue())
    title = Column(String, nullable=False)
    sector = Column(String, default="General")
    region = Column(String, default="UK-wide")
    status = Column(String, default="active")  # active, completed, needs_attention, paused
    contacted = Column(Integer, default=0)
    total = Column(Integer, default=0)
    meetings_booked = Column(Integer, default=0)
    created = Column(String, default="Today")
    source = Column(String, default="discover")  # discover, manual
    concurrency = Column(Integer, default=5)
    queue_estimate = Column(JSON, nullable=True)
    call_window = Column(String, default="09:00–17:30")
    timezone = Column(String, default="Europe/London")
    lunch_start = Column(String, default="12:00")
    lunch_end = Column(String, default="13:00")
    no_answer_fallbacks = Column(JSON, default=lambda: ["whatsapp", "sms", "email"])
    template_id = Column(String, default="")  # the script this campaign's calls use ("" = default)
    default_channel = Column(String, default="voice")
    created_at = Column(DateTime, default=datetime.utcnow)
    
    prospects = relationship("Prospect", back_populates="mission", cascade="all, delete-orphan")

class Prospect(Base):
    __tablename__ = "prospects"
    # Owning organisation; the database fills it in (see app.core.tenancy).
    org_id = Column(String, index=True, server_default=FetchedValue())
    
    id = Column(String, primary_key=True, index=True)
    mission_id = Column(String, ForeignKey("missions.id", ondelete="CASCADE"), nullable=True)
    registry_id = Column(String, ForeignKey("contact_registry.id", ondelete="SET NULL"), nullable=True)
    name = Column(String, nullable=False)
    sector = Column(String, default="General")
    region = Column(String, default="UK-wide")
    status = Column(String, default="queued")  # queued, calling, contacted, meeting_booked, retry, human_review, rejected, cold
    fit = Column(Integer, default=80)
    last_contact = Column(String, default="—")
    contact_person = Column(String, default="—")
    phone = Column(String, default="")
    site = Column(String, default="")
    channel = Column(String, default="voice")
    fallback_channel = Column(String, nullable=True)
    note = Column(Text, default="")
    time_status = Column(String, default="waiting")
    created_at = Column(DateTime, default=datetime.utcnow)
    
    mission = relationship("Mission", back_populates="prospects")

class LiveCall(Base):
    __tablename__ = "live_calls"
    
    id = Column(String, primary_key=True, index=True)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True, index=True, server_default=FetchedValue())
    carrier_sid = Column(String, nullable=True, index=True)  # Twilio CallSid for status callback matching
    carrier = Column(String, nullable=True)  # telephony provider used at dial time (twilio/telnyx/sipgate/…) for hangup
    mission_id = Column(String, nullable=True)
    prospect_id = Column(String, nullable=True)
    prospect = Column(String, nullable=False)
    mission = Column(String, nullable=False)
    state = Column(String, default="negotiating")  # pitching, negotiating, human_review, ended
    channel = Column(String, default="voice")
    duration = Column(String, default="00:00")
    flag = Column(String, nullable=True)
    taken = Column(Boolean, default=False)
    listening = Column(Boolean, default=False)
    confirming_end = Column(Boolean, default=False)
    ended = Column(Boolean, default=False)
    booked = Column(Boolean, default=False)
    transcript = Column(JSON, default=list)
    prospect_timezone = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

class CallLog(Base):
    __tablename__ = "call_logs"
    # Owning organisation; the database fills it in (see app.core.tenancy).
    org_id = Column(String, index=True, server_default=FetchedValue())
    
    id = Column(String, primary_key=True, index=True)
    registry_id = Column(String, nullable=True)
    canonical_name = Column(String, nullable=False)
    listed_as = Column(String, nullable=False)
    person_canonical = Column(String, default="")
    person_listed_as = Column(String, default="")
    channel = Column(String, default="voice")
    mission = Column(String, default="")
    started_at = Column(String, nullable=False)
    ended_at = Column(String, nullable=False)
    duration = Column(String, default="0 min")
    outcome = Column(String, default="contacted")  # meeting_booked, rejected, callback_requested, no_answer, human_review
    requested_follow_up = Column(JSON, nullable=True)
    words_locked = Column(Boolean, default=True)
    transcript = Column(JSON, default=list)
    created_at = Column(DateTime, default=datetime.utcnow)

class Meeting(Base):
    __tablename__ = "meetings"
    # Owning organisation; the database fills it in (see app.core.tenancy).
    org_id = Column(String, index=True, server_default=FetchedValue())
    
    id = Column(String, primary_key=True, index=True)
    prospect = Column(String, nullable=False)
    mission = Column(String, nullable=False)
    date = Column(String, nullable=False)
    time = Column(String, nullable=False)
    host_timezone = Column(String, default="Europe/London")
    prospect_timezone = Column(String, nullable=True)
    prospect_date = Column(String, nullable=True)
    prospect_time = Column(String, nullable=True)
    starts_at_utc = Column(DateTime, nullable=True)
    duration = Column(String, default="15 min")
    status = Column(String, default="upcoming")  # upcoming, needs_outcome, converted, not_fit
    fit = Column(Integer, default=85)
    channel = Column(String, default="voice")
    format = Column(String, default="video")  # video, phone, in_person
    platform = Column(String, default="Google Meet")
    video_link = Column(String, nullable=True)
    dial_in = Column(String, nullable=True)
    address = Column(String, nullable=True)
    host = Column(String, default="Jitendra S.")
    host_email = Column(String, default="admin@aivhub.io")
    attendee = Column(String, default="")
    attendee_email = Column(String, nullable=True)
    calcom_booking_id = Column(String, nullable=True)
    event_type_slug = Column(String, default="15-min-discovery")
    cancellation_reason = Column(Text, nullable=True)
    prep = Column(Text, default="")
    outcome = Column(String, nullable=True)
    call_transcript = Column(JSON, default=list)
    meeting_transcript = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

class MeetingEventType(Base):
    __tablename__ = "meeting_event_types"
    # Owning organisation; the database fills it in (see app.core.tenancy).
    org_id = Column(String, index=True, server_default=FetchedValue())
    
    id = Column(String, primary_key=True, index=True)
    title = Column(String, nullable=False)
    slug = Column(String, unique=True, index=True, nullable=False)
    length = Column(Integer, default=15)  # minutes
    description = Column(Text, default="")
    location_type = Column(String, default="google_meet")  # google_meet, cal_video, zoom, phone, in_person
    location_value = Column(String, nullable=True)
    calcom_event_type_id = Column(String, nullable=True)
    is_active = Column(Boolean, default=True)
    color = Column(String, default="#10B981")
    created_at = Column(DateTime, default=datetime.utcnow)

class CalcomSetting(Base):
    __tablename__ = "calcom_settings"
    # Owning organisation; the database fills it in (see app.core.tenancy).
    org_id = Column(String, index=True, server_default=FetchedValue())
    
    id = Column(String, primary_key=True, default="default")
    host_email = Column(String, default="admin@aivhub.io")
    host_name = Column(String, default="Jitendra S.")
    api_key = Column(String, nullable=True)
    base_url = Column(String, default="https://api.cal.com/v2")
    default_event_type_slug = Column(String, default="15-min-discovery")
    default_duration = Column(Integer, default=15)
    default_platform = Column(String, default="google_meet")
    # Timezone comes from the organisation settings (org_settings.org_timezone).
    working_hours_start = Column(String, default="09:00")
    working_hours_end = Column(String, default="17:30")
    working_days = Column(JSON, default=lambda: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"])
    working_hours_by_day = Column(JSON, nullable=True)
    slot_step_minutes = Column(Integer, default=15)
    flex_minutes = Column(Integer, default=0)
    # Lunch break with no meetings; equal start and end = no lunch break.
    lunch_start = Column(String, default="12:00")
    lunch_end = Column(String, default="13:00")
    buffer_before = Column(Integer, default=5)
    buffer_after = Column(Integer, default=5)
    auto_email_attendee = Column(Boolean, default=True)
    auto_email_host = Column(Boolean, default=True)
    prospect_timezone_override = Column(String, nullable=True)
    # Per-business meeting types, notify channels, and call booking rules (JSON)
    booking_policy = Column(JSON, nullable=True)
    # Bring-your-own invite email HTML ({{tokens}}). Empty = built-in template.
    invite_html_attendee = Column(Text, nullable=True)
    invite_html_host = Column(Text, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class ScheduleItem(Base):
    __tablename__ = "schedule_items"
    # Owning organisation; the database fills it in (see app.core.tenancy).
    org_id = Column(String, index=True, server_default=FetchedValue())
    
    id = Column(String, primary_key=True, index=True)
    day = Column(String, nullable=False)
    time = Column(String, nullable=False)
    prospect = Column(String, nullable=False)
    mission = Column(String, nullable=False)
    window = Column(String, default="09:00–17:30")
    status = Column(String, default="queued")  # queued, retry, completed
    honored = Column(Boolean, default=False)
    deferred = Column(Boolean, default=False)
    honored_quote = Column(Text, nullable=True)
    kind = Column(String, default="phone")  # phone, video, in_person, whatsapp
    phone = Column(String, nullable=True)
    email = Column(String, nullable=True)
    video_link = Column(String, nullable=True)
    platform = Column(String, nullable=True)
    address = Column(String, nullable=True)
    notes = Column(Text, nullable=True)
    whatsapp_to = Column(String, nullable=True)
    notify_whatsapp = Column(Boolean, default=False)
    meeting_id = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

class Notification(Base):
    __tablename__ = "notifications"
    # Owning organisation; the database fills it in (see app.core.tenancy).
    org_id = Column(String, index=True, server_default=FetchedValue())
    
    id = Column(String, primary_key=True, index=True)
    text = Column(Text, nullable=False)
    time = Column(String, default="Just now")
    unread = Column(Boolean, default=True)
    type = Column(String, default="info")  # success, alert, info
    created_at = Column(DateTime, default=datetime.utcnow)

# Post Scheduler Models
class Voice(Base):
    """A voice saved for calls: one row per provider voice (many per provider, many providers).
    Engine built-in voices (xAI Ara/Rex, OpenAI Alloy, ...) are not stored. The call voice is
    picked in the active voice stack (voice_kind / voice_ref)."""
    __tablename__ = "voices"
    # Owning organisation; the database fills it in (see app.core.tenancy).
    org_id = Column(String, index=True, server_default=FetchedValue())
    __table_args__ = (UniqueConstraint("provider", "voice_id", name="uq_voices_provider_voice"),)

    id = Column(String, primary_key=True)
    provider = Column(String, nullable=False)  # cartesia | elevenlabs | telnyx | deepgram | xai | <custom>
    voice_id = Column(String, nullable=False)
    label = Column(String, default="")
    origin = Column(String, default="pasted")  # saved_with_tts | imported | pasted | cloned | migrated
    meta = Column(JSON, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow)


class SocialSchedule(Base):
    """A posting plan: right now, once, or repeating. Its posts are created a little ahead of
    time, written by the AI queue, approved like any post and published by the publish loop."""
    __tablename__ = "social_schedules"
    # Owning organisation; the database fills it in (see app.core.tenancy).
    org_id = Column(String, index=True, server_default=FetchedValue())

    id = Column(String, primary_key=True, index=True)
    theme = Column(String, nullable=False)  # schedule name
    focus = Column(Text, default="")  # what the posts are about
    channels = Column(JSON, default=lambda: ["linkedin"])
    time = Column(String, default="10:00")
    weekday = Column(String, nullable=False, default="")  # weekly pattern, e.g. "MO,TH"
    frequency = Column(String, default="recurring")  # now | once | recurring
    pattern = Column(String, default="weekly")  # daily | weekly | monthly | dates
    start_date = Column(String, nullable=True)  # YYYY-MM-DD, organisation timezone
    end_date = Column(String, nullable=True)
    month_day = Column(Integer, nullable=True)
    custom_dates = Column(JSON, default=list)
    date_topics = Column(JSON, default=dict)  # custom dates: {"YYYY-MM-DD": "topic for that post"}
    make_image = Column(Boolean, default=True)
    approver_emails = Column(JSON, default=list)  # empty: the organisation's approvers
    result_emails = Column(JSON, default=list)  # empty: the organisation's approvers
    retry_count = Column(Integer, default=1)
    retry_delay_min = Column(Integer, default=5)
    status = Column(String, default="active")  # active | paused | ended
    ended_reason = Column(String, nullable=True)
    reminder_sent_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class SocialPost(Base):
    __tablename__ = "social_posts"
    # Owning organisation; the database fills it in (see app.core.tenancy).
    org_id = Column(String, index=True, server_default=FetchedValue())
    
    id = Column(String, primary_key=True, index=True)
    topic_id = Column(String, nullable=True)
    schedule_id = Column(String, nullable=True)
    title = Column(String, nullable=False)
    copy = Column(Text, nullable=False)
    channels = Column(JSON, default=lambda: ["linkedin", "x"])
    # awaiting_approval | approved | rejected | approval_missed | publishing | published | failed
    status = Column(String, default="draft")
    slot_date_ms = Column(Float, nullable=True)
    time = Column(String, default="10:00")
    theme = Column(String, default="General")
    tone = Column(String, default="Professional")
    image_url = Column(Text, nullable=True)
    image_prompt = Column(Text, nullable=True)
    hook = Column(Text, nullable=True)
    linkedin_copy = Column(Text, nullable=True)
    x_copy = Column(Text, nullable=True)
    facebook_copy = Column(Text, nullable=True)
    instagram_copy = Column(Text, nullable=True)
    threads_copy = Column(Text, nullable=True)
    hashtags = Column(JSON, default=list)
    cta = Column(Text, nullable=True)
    first_comment = Column(Text, nullable=True)
    alt_text = Column(Text, nullable=True)
    adapt_per_channel = Column(Boolean, default=False)
    publish_results = Column(JSON, default=list)
    published_at = Column(String, nullable=True)
    # Exact publish instant (epoch ms): date + time in the organisation timezone, set by the server.
    # slot_date_ms + time is kept for rows created before due_at_ms existed.
    due_at_ms = Column(Float, nullable=True)
    # AI writing state shown on the card: queued | writing | imaging | failed (None = idle).
    gen_state = Column(String, nullable=True)
    gen_error = Column(Text, nullable=True)
    # Text or image changed by hand: chat edits that sweep many posts leave it alone.
    edited_by_user = Column(Boolean, default=False)
    # Approval: when the approvers were emailed, who approved (email or "app"), and the
    # reviewer's note on a rejection.
    approval_requested_at = Column(DateTime, nullable=True)
    approved_by = Column(String, nullable=True)
    approved_at = Column(DateTime, nullable=True)
    review_note = Column(Text, nullable=True)
    # Schedule posts: the schedule date this post fills; detached once edited or moved by hand
    # (the schedule no longer changes or replaces it); asap = "right now" (goes out on approval).
    occurrence = Column(String, nullable=True)
    detached = Column(Boolean, default=False)
    asap = Column(Boolean, default=False)
    # Automatic publish retries used, and when the next one is due (epoch ms).
    publish_attempts = Column(Integer, default=0)
    retry_at_ms = Column(Float, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class SocialPostVersion(Base):
    """Saved content of a post after each change (the newest 10 per post are kept) for undo/restore."""
    __tablename__ = "social_post_versions"
    # Owning organisation; the database fills it in (see app.core.tenancy).
    org_id = Column(String, index=True, server_default=FetchedValue())

    id = Column(String, primary_key=True)
    post_id = Column(String, index=True, nullable=False)
    source = Column(String, default="update")  # original | you | ai | restore | update
    title = Column(String, default="")
    copy = Column(Text, default="")
    image_url = Column(Text, nullable=True)
    image_prompt = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


class SocialGenJob(Base):
    """One piece of content to write (and illustrate) for one or more posts that share it.
    Stored so queued work survives restarts and runs with no browser open."""
    __tablename__ = "social_gen_jobs"
    # Owning organisation; the database fills it in (see app.core.tenancy).
    org_id = Column(String, index=True, server_default=FetchedValue())

    id = Column(String, primary_key=True)
    post_ids = Column(JSON, default=list)
    plan = Column(Text, default="")
    headline = Column(Text, default="")
    channel = Column(String, default="linkedin")
    date = Column(String, default="")
    revision_note = Column(Text, default="")
    existing_copy = Column(Text, default="")
    skip_image = Column(Boolean, default=False)
    solo = Column(Boolean, default=False)  # retry alone after a batched reply failed
    options = Column(JSON, default=dict)
    priority = Column(Integer, default=0)
    # queued | writing | image_queued | imaging | done | failed | paused | image_paused (out of credits)
    state = Column(String, default="queued")
    error = Column(Text, nullable=True)
    attempts = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class CreditEntry(Base):
    """One line of an organisation's credit ledger. The balance is the sum of amounts:
    grants are positive, usage negative. ref ties usage to what used it (e.g. a call log)."""
    __tablename__ = "credit_ledger"
    org_id = Column(String, index=True, server_default=FetchedValue())

    id = Column(String, primary_key=True)
    kind = Column(String, nullable=False)  # grant, usage, expire, adjust
    wallet = Column(String, default="voice", index=True)  # voice, leadgen, email, scheduler
    item = Column(String, default="")  # rate card key for usage, e.g. voice_minute
    quantity = Column(Float, default=0)
    amount = Column(Integer, nullable=False)
    ref = Column(String, nullable=True, index=True)
    note = Column(String, default="")
    by = Column(String, default="")
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


class StaffUser(Base):
    """Aivhub staff for the admin portal. Separate from client users (operators), so no client
    role can ever become staff. Two-factor authentication is required."""
    __tablename__ = "staff_users"

    id = Column(String, primary_key=True)
    email = Column(String, nullable=False, unique=True, index=True)
    name = Column(String, default="")
    role = Column(String, default="staff_support")  # staff_admin | staff_support
    hashed_password = Column(String, nullable=False)
    totp_secret_sealed = Column(Text, default="")
    totp_enabled = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    last_login_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class CreditGrant(Base):
    """A batch of credits in one plugin's wallet (a plan renewal, a top-up, or added by staff).
    Usage takes from the batch closest to expiry first."""
    __tablename__ = "credit_grants"
    org_id = Column(String, index=True, server_default=FetchedValue())

    id = Column(String, primary_key=True)
    wallet = Column(String, nullable=False, index=True)
    source = Column(String, default="grant")  # plan, topup, grant, starter
    amount = Column(Integer, nullable=False)
    remaining = Column(Integer, nullable=False)
    expires_at = Column(DateTime, nullable=True, index=True)  # None = never
    ref = Column(String, default="", index=True)  # e.g. Stripe invoice/session id (makes grants idempotent)
    note = Column(String, default="")
    paid_cents = Column(Integer, default=0)  # what the customer paid for this batch (Stripe), for margins
    paid_currency = Column(String, default="")
    created_at = Column(DateTime, default=datetime.utcnow)


class CreditAward(Base):
    """Credits given by OutReach staff from the owner portal: a permanent record (the database
    refuses to change or delete a row; see tenancy.ensure_append_only). Not per-organisation:
    staff and finance read every company's. label says how it was paid for: given (no payment),
    offline (paid outside Stripe, with its reference) or paid (paid, with its reference)."""
    __tablename__ = "credit_awards"

    id = Column(String, primary_key=True)
    org_id = Column(String, nullable=False, index=True)
    org_name = Column(String, default="")
    wallet = Column(String, nullable=False)
    amount = Column(Integer, nullable=False)
    label = Column(String, nullable=False)  # given | offline | paid
    reason = Column(Text, nullable=False)
    payment_ref = Column(String, default="")
    paid_cents = Column(Integer, default=0)
    paid_currency = Column(String, default="")
    expires_at = Column(DateTime, nullable=True)
    balance_before = Column(Integer, nullable=False)
    balance_after = Column(Integer, nullable=False)
    confirmed_with = Column(String, default="")  # amount | password
    staff_id = Column(String, nullable=False)
    staff_email = Column(String, default="")
    staff_name = Column(String, default="")
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


class BillingPlan(Base):
    """What we sell, per plugin: monthly plans and one-off top-ups (platform-wide, set by staff)."""
    __tablename__ = "billing_plans"

    id = Column(String, primary_key=True)
    wallet = Column(String, nullable=False, index=True)
    kind = Column(String, default="plan")  # plan | topup
    name = Column(String, nullable=False)
    description = Column(String, default="")
    price_usd_cents = Column(Integer, nullable=False)
    currency = Column(String, default="usd")  # of price_usd_cents (prices made in Stripe can be e.g. gbp)
    credits = Column(Integer, nullable=False)
    features = Column(JSON, default=list)
    stripe_product_id = Column(String, default="")
    stripe_price_id = Column(String, default="", index=True)
    active = Column(Boolean, default=True)
    sort = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)


class BillingSubscription(Base):
    """An organisation's Stripe customer and subscription (one subscription, one item per plugin)."""
    __tablename__ = "billing_subscriptions"
    org_id = Column(String, index=True, server_default=FetchedValue())

    id = Column(String, primary_key=True)  # = org id
    stripe_customer_id = Column(String, default="", index=True)
    stripe_subscription_id = Column(String, default="", index=True)
    status = Column(String, default="none")  # none, active, past_due, canceled, incomplete
    plans = Column(JSON, default=dict)  # wallet -> plan id
    current_period_end = Column(DateTime, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class StripeEvent(Base):
    """Stripe events already handled, so a retried webhook never grants credits twice."""
    __tablename__ = "stripe_events"

    id = Column(String, primary_key=True)
    type = Column(String, default="")
    created_at = Column(DateTime, default=datetime.utcnow)


class AppSetting(Base):
    """Small app-wide settings documents stored by key (e.g. the live voice stack)."""
    __tablename__ = "app_settings"

    id = Column(String, primary_key=True)
    data = Column(JSON, default=dict)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class SchedulerSetting(Base):
    """Post Scheduler preferences (which text/image AI to use). Keys live in Connection rows."""
    __tablename__ = "scheduler_settings"
    # Owning organisation; the database fills it in (see app.core.tenancy).
    org_id = Column(String, index=True, server_default=FetchedValue())

    id = Column(String, primary_key=True, default="default")
    data = Column(JSON, default=dict)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class SocialAccount(Base):
    __tablename__ = "social_accounts"
    # Owning organisation; the database fills it in (see app.core.tenancy).
    org_id = Column(String, index=True, server_default=FetchedValue())

    id = Column(String, primary_key=True, index=True)
    platform = Column(String, nullable=False, index=True)  # linkedin, x, facebook, instagram, threads
    label = Column(String, default="")
    handle = Column(String, default="")
    account_id = Column(String, default="")  # person/org/page/ig/user id
    access_token = Column(Text, default="")
    refresh_token = Column(Text, default="")
    token_secret = Column(Text, default="")  # X OAuth 1.0a
    extra = Column(JSON, default=dict)  # apiKey, apiSecret, pageId, authorType
    is_default = Column(Boolean, default=True)
    status = Column(String, default="disconnected")  # connected, error, disconnected
    last_error = Column(Text, default="")
    last_tested_at = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class SocialOAuthApp(Base):
    """One-time AIVHub developer-app credentials so operators can click Connect."""
    __tablename__ = "social_oauth_apps"

    platform = Column(String, primary_key=True)
    client_id = Column(String, default="")
    client_secret = Column(Text, default="")
    redirect_uri = Column(String, default="")
    config_id = Column(String, default="")
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class SocialOAuthState(Base):
    __tablename__ = "social_oauth_states"
    # Owning organisation; the database fills it in (see app.core.tenancy).
    org_id = Column(String, index=True, server_default=FetchedValue())

    id = Column(String, primary_key=True)
    platform = Column(String, nullable=False)
    code_verifier = Column(String, default="")
    frontend_url = Column(String, default="")
    created_at = Column(DateTime, default=datetime.utcnow)


class SocialEmail(Base):
    __tablename__ = "social_emails"
    # Owning organisation; the database fills it in (see app.core.tenancy).
    org_id = Column(String, index=True, server_default=FetchedValue())
    
    id = Column(String, primary_key=True, index=True)
    post_id = Column(String, nullable=False)
    subject = Column(String, nullable=False)
    from_addr = Column(String, default="scheduler@aivhub.io")
    to_addr = Column(String, default="admin@aivhub.io")
    date = Column(String, default="Today")
    status = Column(String, default="unread")  # unread, read, acted
    post_data = Column(JSON, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow)

class ProcessLog(Base):
    __tablename__ = "process_logs"
    # Owning organisation; the database fills it in (see app.core.tenancy).
    org_id = Column(String, index=True, server_default=FetchedValue())
    
    id = Column(String, primary_key=True, index=True)
    subsystem = Column(String, index=True, nullable=False)  # telephony, voice, crawler_rag, calendar, scheduler, system, auth
    level = Column(String, default="INFO", index=True)       # INFO, SUCCESS, WARN, ERROR
    process_name = Column(String, nullable=False)           # specific task or event name
    message = Column(Text, nullable=False)                  # human readable summary
    details = Column(JSON, default=dict)                    # full structured payload, headers, metadata
    duration_ms = Column(Float, nullable=True)              # execution latency in milliseconds
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


class ConversationTemplate(Base):
    """
    Dynamic conversation templates - replaces hardcoded scripts.
    Supports Outbound prospecting & Inbound reception with full customization.
    """
    __tablename__ = "conversation_templates"

    id = Column(String, primary_key=True)
    org_id = Column(String, index=True, server_default=FetchedValue())
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    call_direction = Column(String, nullable=False, default="outbound")  # "outbound" | "inbound"
    mission_type = Column(String, default="demo")  # "demo", "discovery", "reception", "followup"

    # Template sections (Supports dynamic contextual variables like {{prospect.name}}, {{company.name}}, {{today}})
    greeting_template = Column(Text, nullable=False)
    permission_check_template = Column(Text, nullable=True)
    value_prop_template = Column(Text, nullable=False)
    objection_responses = Column(JSON, default=dict)  # {"not_interested": "...", "no_time": "...", ...}
    booking_transition_template = Column(Text, nullable=False)
    confirmation_template = Column(Text, nullable=False)
    closing_template = Column(Text, nullable=False)

    # Free-text business rules and a worked example conversation — migrated in from
    # CompanyProfile's old "Call Script & Rules" fields so this is the one place that
    # feeds every voice engine (xAI included), not just the modular/LiveKit pipeline.
    custom_rules = Column(Text, nullable=True)
    demo_script = Column(Text, nullable=True)

    # Flow configuration
    flow_steps = Column(JSON, default=list)  # ["greeting", "permission_check", "value_prop", ...]
    max_objection_attempts = Column(Integer, default=3)

    # Persona & instructions
    agent_persona = Column(String, default="professional and friendly")
    tone_instructions = Column(Text, nullable=True)

    # State & Analytics
    is_active = Column(Boolean, default=True)
    is_default = Column(Boolean, default=False)
    times_used = Column(Integer, default=0)
    success_rate = Column(Float, default=0.0)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class ConversationVariable(Base):
    """
    Reusable custom variables for template interpolation.
    """
    __tablename__ = "conversation_variables"

    id = Column(String, primary_key=True)
    org_id = Column(String, index=True, server_default=FetchedValue())
    key = Column(String, nullable=False)  # "time_savings", "pain_point", etc.
    value = Column(Text, nullable=False)
    category = Column(String, default="custom")  # "company", "product", "mission", "custom"
    description = Column(String, nullable=True)
    times_referenced = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)




class OrgPhoneNumber(Base):
    """A phone number owned by an organisation (bought on Telnyx or brought in)."""
    __tablename__ = "org_phone_numbers"

    id = Column(String, primary_key=True)
    org_id = Column(String, index=True, server_default=FetchedValue())
    e164 = Column(String, nullable=False, index=True)
    label = Column(String, default="")
    provider = Column(String, default="telnyx")
    provider_ref = Column(String, default="")  # e.g. Telnyx phone number id
    assistant_id = Column(String, default="")  # Telnyx AI Assistant answering this number
    capabilities = Column(JSON, default=lambda: ["voice"])  # voice, sms, whatsapp
    status = Column(String, default="active")  # active, pending, disabled
    is_default = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class OrgTelnyx(Base):
    """An organisation's Telnyx setup: its managed account (or billing group on our account)
    and the resources numbers are attached to. One row per organisation; id = org id."""
    __tablename__ = "org_telnyx"

    id = Column(String, primary_key=True)
    org_id = Column(String, index=True, server_default=FetchedValue())
    mode = Column(String, default="billing_group")  # managed_account | billing_group
    managed_account_id = Column(String, default="")
    api_key_sealed = Column(Text, default="")  # managed account's own key (encrypted)
    billing_group_id = Column(String, default="")
    outbound_voice_profile_id = Column(String, default="")  # its own, in its billing group (PAYG)
    outbound_connection_id = Column(String, default="")  # its own Call Control app for outbound calls
    connection_id = Column(String, default="")  # Call Control app new numbers attach to
    messaging_profile_id = Column(String, default="")  # needed for WhatsApp / SMS
    allowed_countries = Column(JSON, default=lambda: ["GB"])
    status = Column(String, default="new")  # new, ready, error
    last_error = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class VerificationSubmission(Base):
    """Proof of identity and address a regulator needs before we can buy numbers (e.g. UK local)."""
    __tablename__ = "verification_submissions"

    id = Column(String, primary_key=True)
    org_id = Column(String, index=True, server_default=FetchedValue())
    country = Column(String, default="GB")
    number_type = Column(String, default="local")
    entity_type = Column(String, default="company")  # company | sole_trader
    fields = Column(JSON, default=dict)  # requirement id -> text value (and our own form fields)
    documents = Column(JSON, default=list)  # [{requirement_id, filename, telnyx_document_id}]
    requirement_group_id = Column(String, default="")
    status = Column(String, default="draft")  # draft, pending-approval, approved, declined, expired, error
    reason = Column(Text, default="")
    submitted_by = Column(String, default="")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class NumberOrder(Base):
    """A phone number bought on Telnyx for an organisation, until it becomes an OrgPhoneNumber."""
    __tablename__ = "number_orders"

    id = Column(String, primary_key=True)
    org_id = Column(String, index=True, server_default=FetchedValue())
    telnyx_order_id = Column(String, default="", index=True)
    phone_number = Column(String, nullable=False)
    country = Column(String, default="GB")
    number_type = Column(String, default="local")
    requirement_group_id = Column(String, default="")
    status = Column(String, default="pending")  # pending, success, failure
    monthly_cost = Column(String, default="")
    upfront_cost = Column(String, default="")
    currency = Column(String, default="USD")
    error = Column(Text, default="")
    ordered_by = Column(String, default="")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class WhatsappThread(Base):
    """A WhatsApp conversation between one of our numbers and one contact."""
    __tablename__ = "whatsapp_threads"

    id = Column(String, primary_key=True)
    org_id = Column(String, index=True, server_default=FetchedValue())
    our_number = Column(String, nullable=False, index=True)
    contact_number = Column(String, nullable=False, index=True)
    contact_name = Column(String, default="")
    ai_enabled = Column(Boolean, default=False)  # unused: WhatsApp auto-replies are off
    unread = Column(Integer, default=0)
    last_inbound_at = Column(DateTime, nullable=True)  # starts the 24-hour free-reply window
    last_message_at = Column(DateTime, default=datetime.utcnow, index=True)
    last_preview = Column(String, default="")
    created_at = Column(DateTime, default=datetime.utcnow)


class WhatsappMessage(Base):
    __tablename__ = "whatsapp_messages"

    id = Column(String, primary_key=True)
    org_id = Column(String, index=True, server_default=FetchedValue())
    thread_id = Column(String, index=True, nullable=False)
    direction = Column(String, default="inbound")  # inbound | outbound
    sender = Column(String, default="contact")  # contact | ai | human
    sender_name = Column(String, default="")
    kind = Column(String, default="text")  # text | template | media
    text = Column(Text, default="")
    template = Column(JSON, nullable=True)
    status = Column(String, default="received")  # received, queued, sent, delivered, read, failed
    telnyx_message_id = Column(String, default="", index=True)
    error = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


class PhoneNumberAssignment(Base):
    """Which users may call from a number. A number with no assignments is shared by everyone."""
    __tablename__ = "phone_number_assignments"

    number_id = Column(String, ForeignKey("org_phone_numbers.id", ondelete="CASCADE"), primary_key=True)
    operator_id = Column(String, ForeignKey("operators.id", ondelete="CASCADE"), primary_key=True)


class VoiceAssistant(Base):
    """A Telnyx AI Assistant we manage: one per user (operator_id) plus one per organisation for
    numbers nobody is assigned to (operator_id ""). Its instructions are our fixed shell; the
    script, company and prospect arrive per call as dynamic variables (see CallBrief)."""
    __tablename__ = "voice_assistants"

    id = Column(String, primary_key=True)
    org_id = Column(String, index=True, server_default=FetchedValue())
    operator_id = Column(String, default="", index=True)
    telnyx_assistant_id = Column(String, default="")
    voice = Column(String, default="")  # from the staff voice catalogue ("" = platform default)
    model = Column(String, default="")  # from the staff model catalogue ("" = platform default)
    shell_version = Column(Integer, default=0)
    status = Column(String, default="pending")  # pending, ready, error
    last_error = Column(Text, default="")
    synced_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class CallBrief(Base):
    """Everything one call needs from us: who placed it, the script rendered for this prospect,
    and what the assistant reported back (outcome, captured fields). id is the call's id."""
    __tablename__ = "call_briefs"

    id = Column(String, primary_key=True)
    org_id = Column(String, index=True, server_default=FetchedValue())
    operator_id = Column(String, default="")
    direction = Column(String, default="outbound")
    assistant_id = Column(String, default="")  # VoiceAssistant.id
    template_id = Column(String, default="")
    mission_id = Column(String, default="")
    prospect_id = Column(String, default="")
    phone = Column(String, default="")  # the other party
    our_number = Column(String, default="")
    variables = Column(JSON, default=dict)  # what Telnyx got as dynamic variables
    script = Column(Text, default="")  # the full rendered script (variables may hold a part)
    outcome = Column(String, default="")
    captured = Column(JSON, default=dict)
    notes = Column(Text, default="")
    supervisor_leg = Column(String, default="")  # the user's own call while they have taken over
    supervisor_id = Column(String, default="")
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
