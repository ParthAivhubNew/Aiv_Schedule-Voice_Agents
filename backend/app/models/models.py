from sqlalchemy import Column, String, Integer, Boolean, Text, JSON, DateTime, Date, ForeignKey, Float, UniqueConstraint, FetchedValue
from sqlalchemy.orm import relationship
from datetime import datetime
import uuid
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
    referred_by_partner_id = Column(String, nullable=True, index=True)  # the partner whose sign-up page created this account
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
    profile = Column(JSON, nullable=True)  # the person's own details: names, job, locale, links, signature (see app/core/profile.py)
    avatar_file = Column(String, nullable=True)  # file name of the photo under static/avatars
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


class ApiKey(Base):
    """A developer secret key (sk_live_...) for external server-to-server API access."""
    __tablename__ = "api_keys"

    id = Column(String, primary_key=True, default=lambda: f"key_{uuid.uuid4().hex[:12]}")
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    created_by_id = Column(String, ForeignKey("operators.id", ondelete="SET NULL"), nullable=True)
    name = Column(String, nullable=False)
    prefix = Column(String, nullable=False, index=True)  # e.g. "sk_live_3829f0a8"
    hashed_key = Column(String, nullable=False, unique=True, index=True)  # SHA-256 hex digest
    scopes = Column(JSON, default=lambda: ["full_access"])  # ["voice:calls", "leads:search", "social:publish"]
    mailbox_ids = Column(JSON, nullable=True)  # mail scopes only reach these mailboxes; None = all of the company's
    is_active = Column(Boolean, default=True, index=True)
    last_used_at = Column(DateTime, nullable=True)
    expires_at = Column(DateTime, nullable=True)
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
    # Soft reference, not a DB-level FK: a real FK here would point at email_campaigns while
    # EmailCampaign.mission_id points back at missions, an unresolvable circular dependency for
    # create_all/drop_all. Same convention as every other cross-plugin pointer in this file
    # (e.g. EmailEnrollment.prospect_id).
    auto_enroll_campaign_id = Column(String, nullable=True, index=True)
    lead_list_id = Column(String, nullable=True, index=True)  # the Lead Gen list this mission was built from
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
    email = Column(String, default="")  # from Leadgen's Find Work Email, when run
    lead_id = Column(String, nullable=True, index=True)  # the Lead Gen company this call target came from (soft reference)
    opening_hook = Column(Text, default="")  # Leadgen's AI-written icebreaker for this account
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
    lead_id = Column(String, nullable=True, index=True)
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
    summary = Column(Text, default="")  # AI summary of the call so far (final once it ends)
    prospect_timezone = Column(String, nullable=True)
    direction = Column(String, nullable=True)  # "inbound" (they called us) or "outbound" (we called them); empty on older calls
    phone = Column(String, nullable=True)  # the other person's number, as dialled or as it reached us
    our_number = Column(String, nullable=True)  # the number of ours the call was on
    created_at = Column(DateTime, default=datetime.utcnow)

class CallLog(Base):
    __tablename__ = "call_logs"
    # Owning organisation; the database fills it in (see app.core.tenancy).
    org_id = Column(String, index=True, server_default=FetchedValue())
    
    id = Column(String, primary_key=True, index=True)
    registry_id = Column(String, nullable=True)
    lead_id = Column(String, nullable=True, index=True)  # the Lead Gen company this call was to
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
    summary = Column(Text, default="")  # AI summary of the finished call
    direction = Column(String, nullable=True)  # "inbound" or "outbound"; empty on older calls (the log API works it out from the call's own words)
    phone = Column(String, nullable=True)  # the other person's number
    our_number = Column(String, nullable=True)  # the number of ours the call was on
    created_at = Column(DateTime, default=datetime.utcnow)

class Meeting(Base):
    __tablename__ = "meetings"
    # Owning organisation; the database fills it in (see app.core.tenancy).
    org_id = Column(String, index=True, server_default=FetchedValue())
    
    id = Column(String, primary_key=True, index=True)
    lead_id = Column(String, nullable=True, index=True)  # the Lead Gen company this meeting is with
    call_id = Column(String, nullable=True, index=True)  # the call that booked it
    registry_id = Column(String, nullable=True)
    source_post_id = Column(String, nullable=True)  # the social post whose booking link produced it
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
    host = Column(String, default="Parth Barot")
    host_email = Column(String, default="parth.barot@aivhub.com")
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
    host_email = Column(String, default="parth.barot@aivhub.com")
    host_name = Column(String, default="Parth Barot")
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
    # Where the post came from: None = the app, "api" = created through the public API, "import" = a file.
    source = Column(String, nullable=True)
    # Pictures and videos in posting order: [{id, url, kind: image|video, alt, mime, width, height, duration}].
    # Empty on older rows, where image_url is the one picture. image_url always holds the first picture.
    media = Column(JSON, default=list)
    # Links in the text are swapped for tracked short links with UTM tags when this is not False.
    track_links = Column(Boolean, nullable=True)
    # Per-network settings, e.g. {"reddit": {"subreddit": "smallbusiness", "flair": ""}}.
    channel_options = Column(JSON, default=dict)
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
    media = Column(JSON, nullable=True)
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
    partner_id = Column(String, nullable=True, index=True)  # the partner whose embedded screen caused this line
    payer_org_id = Column(String, nullable=True)  # the organisation whose balance this line changed (org_id is who used it)
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


class NumberCheck(Base):
    """What a carrier lookup said about one phone number, kept for 30 days so checking the same
    number again (in any list) is free. Only numbers that got a real answer are kept."""
    __tablename__ = "number_checks"
    org_id = Column(String, index=True, server_default=FetchedValue())

    id = Column(String, primary_key=True)
    phone = Column(String, nullable=False, index=True)  # E.164
    status = Column(String, nullable=False)  # good, check, not_working
    line_type = Column(String, default="")  # mobile, landline, voip, toll_free, other
    carrier = Column(String, default="")
    country = Column(String, default="")
    found_name = Column(String, default="")
    checked_at = Column(DateTime, default=datetime.utcnow, index=True)


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
    """Credits given by Outreach staff from the owner portal: a permanent record (the database
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


class BillingEvent(Base):
    """What happened to a company's plans (started, renewed, cancelled, ended...), for the month-end report and for staff."""
    __tablename__ = "billing_events"

    id = Column(String, primary_key=True)
    org_id = Column(String, index=True, server_default=FetchedValue())
    org_name = Column(String, default="")
    wallet = Column(String, default="", index=True)
    plan_id = Column(String, default="")
    plan_name = Column(String, default="")
    kind = Column(String, index=True, default="")  # started, renewed, cancel_requested, cancel_undone, ended, repaired
    reason = Column(String, default="")  # why a plan was cancelled (a choice from billing_events.REASONS)
    note = Column(Text, default="")
    by = Column(String, default="")
    at = Column(DateTime, default=datetime.utcnow, index=True)


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


class PlanChatThread(Base):
    """A saved Plan AI conversation in the Post Scheduler, shared with the company's team."""
    __tablename__ = "plan_chat_threads"
    org_id = Column(String, index=True, server_default=FetchedValue())

    id = Column(String, primary_key=True)
    title = Column(String, default="Chat")
    messages = Column(JSON, default=list)
    created_by = Column(String, default="")
    created_by_name = Column(String, default="")
    updated_at = Column(DateTime, default=datetime.utcnow, index=True)


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
    # When the access token stops working (UTC); None = no known expiry (Facebook/Instagram page
    # tokens, hand-pasted tokens). Kept fresh by social_oauth.ensure_fresh_token.
    expires_at = Column(DateTime, nullable=True)
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


class MeetingProvider(Base):
    """An organisation's connected Google / Microsoft / Zoom account, used to create real
    meeting rooms. Tokens are sealed (see app.services.secret_box)."""
    __tablename__ = "meeting_providers"
    # Owning organisation; the database fills it in (see app.core.tenancy).
    org_id = Column(String, index=True, server_default=FetchedValue())

    id = Column(String, primary_key=True)  # "<provider>:<org>"
    provider = Column(String, nullable=False)  # google | microsoft | zoom
    account = Column(String, default="")  # email shown to the user
    access_token = Column(Text, default="")
    refresh_token = Column(Text, default="")
    expires_at = Column(Float, default=0.0)
    status = Column(String, default="connected")
    last_error = Column(String, default="")
    connected_at = Column(DateTime, default=datetime.utcnow)


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
    rent_due_at = Column(DateTime, nullable=True)  # next time phone_number_month is owed
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


class WhatsappSignup(Base):
    """Putting one of the organisation's numbers on WhatsApp through Telnyx's hosted signup page.
    One row per number; checked until Telnyx shows the number registered."""
    __tablename__ = "whatsapp_signups"

    id = Column(String, primary_key=True)
    org_id = Column(String, index=True, server_default=FetchedValue())
    number_id = Column(String, nullable=False, index=True)
    e164 = Column(String, nullable=False)
    signup_url = Column(String, default="")
    expires_at = Column(DateTime, nullable=True)
    status = Column(String, default="link_sent")  # link_sent, live, failed
    telnyx_status = Column(String, default="")  # the number's WhatsApp status as Telnyx reports it
    waba_id = Column(String, default="")
    error = Column(String, default="")
    code = Column(String, default="")  # WhatsApp's verification code, when it arrives by SMS
    code_at = Column(DateTime, nullable=True)
    templates = Column(JSON, default=dict)  # our standard template name -> Meta status
    checked_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


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
    # How it speaks and listens (assistant_options.MINE): speed, sound, speech-to-text, language;
    # plus "effective", what Telnyx actually uses, read back after each sync.
    settings = Column(JSON, default=dict)
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


# ── Cold Email & Mailbox Warmup Plugin Models ─────────────────────────────────

class EmailMailbox(Base):
    """A user or team connected sending mailbox (Google Workspace, Microsoft 365, SMTP/IMAP)."""
    __tablename__ = "email_mailboxes"

    id = Column(String, primary_key=True)
    org_id = Column(String, index=True, server_default=FetchedValue())
    operator_id = Column(String, default="", index=True)
    email = Column(String, index=True, nullable=False)
    display_name = Column(String, default="")
    provider = Column(String, default="google")  # google, microsoft, smtp
    auth_type = Column(String, default="oauth")  # oauth, credentials
    credentials_encrypted = Column(Text, default="")  # encrypted via secret_box
    
    # Warmup & Sending Status
    status = Column(String, default="connected")  # connected, warming, graduated, active, paused, error, disabled
    pause_reason = Column(Text, default="")
    daily_cap = Column(Integer, default=5)
    max_daily_target = Column(Integer, default=40)
    warmup_started_at = Column(DateTime, nullable=True)
    graduated_at = Column(DateTime, nullable=True)
    consecutive_healthy_days = Column(Integer, default=0)
    bounce_rate_7d = Column(Float, default=0.0)
    
    # DNS Verification State
    spf_verified = Column(Boolean, default=False)
    dkim_verified = Column(Boolean, default=False)
    # The user chose to send without DKIM, knowing mail may be junked. SPF is still required.
    dkim_override = Column(Boolean, default=False)
    dmarc_verified = Column(Boolean, default=False)
    mx_verified = Column(Boolean, default=False)
    last_dns_check_at = Column(DateTime, nullable=True)
    dns_check_details = Column(JSON, default=dict)
    
    last_sync_at = Column(DateTime, nullable=True)
    last_error = Column(Text, default="")
    signature = Column(Text, default="")
    # Extra "send as" addresses on this mailbox's domain: [{"address": "sales@acme.com", "name": "Sales"}].
    aliases = Column(JSON, default=list)
    # IMAP: the highest message UID already read from INBOX (new mail is read above it).
    imap_last_uid = Column(Integer, default=0)
    # Today's plan from the warmup engine (re-planned once a day).
    plan_date = Column(String, default="")
    warmup_quota = Column(Integer, default=0)
    campaign_quota = Column(Integer, default=0)
    last_sent_at = Column(DateTime, nullable=True)
    # Mail screen sync: {"folders": {"inbox": "INBOX", ...}, "uids": {"inbox": {"validity": 1, "last": 120}}}
    mail_state = Column(JSON, default=dict)
    mail_synced_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class EmailSendLog(Base):
    """Daily aggregated send statistics per mailbox (guarantees max 1 log row per mailbox per day)."""
    __tablename__ = "email_send_logs"

    id = Column(String, primary_key=True)
    org_id = Column(String, index=True, server_default=FetchedValue())
    mailbox_id = Column(String, ForeignKey("email_mailboxes.id", ondelete="CASCADE"), index=True, nullable=False)
    date = Column(String, index=True, nullable=False)  # YYYY-MM-DD
    sent_count = Column(Integer, default=0)
    warmup_sent_count = Column(Integer, default=0)
    campaign_sent_count = Column(Integer, default=0)
    bounced_count = Column(Integer, default=0)
    complaint_count = Column(Integer, default=0)
    reply_count = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)


class EmailMessage(Base):
    """Individual cold email message log with thread tracking and reply categorization."""
    __tablename__ = "email_messages"

    id = Column(String, primary_key=True)
    org_id = Column(String, index=True, server_default=FetchedValue())
    mailbox_id = Column(String, ForeignKey("email_mailboxes.id", ondelete="SET NULL"), index=True, nullable=True)
    campaign_id = Column(String, index=True, default="")
    sequence_step_id = Column(String, default="")
    prospect_id = Column(String, index=True, default="")
    enrollment_id = Column(String, index=True, default="")
    
    message_id = Column(String, index=True, default="")  # RFC 2822 Message-ID
    thread_id = Column(String, index=True, default="")
    recipient_email = Column(String, index=True, nullable=False)
    subject = Column(Text, default="")
    body_text = Column(Text, default="")
    body_html = Column(Text, default="")
    is_warmup = Column(Boolean, default=False)
    
    status = Column(String, default="queued")  # queued, sent, delivered, replied, bounced, failed
    bounce_reason = Column(Text, default="")
    reply_category = Column(String, default="")  # interested, not_interested, ooo, unsubscribe, question
    reply_snippet = Column(Text, default="")
    reply_from = Column(String, default="")
    open_count = Column(Integer, default=0)
    last_opened_at = Column(DateTime, nullable=True)

    sent_at = Column(DateTime, nullable=True)
    replied_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


class MailMessage(Base):
    """One email in a connected mailbox as the Mail screen shows it (a copy of what is on the mail server)."""
    __tablename__ = "mail_messages"

    id = Column(String, primary_key=True)
    org_id = Column(String, index=True, server_default=FetchedValue())
    mailbox_id = Column(String, ForeignKey("email_mailboxes.id", ondelete="CASCADE"), index=True, nullable=False)
    folder = Column(String, index=True, default="inbox")  # inbox, sent, drafts, archive, spam, trash
    remote_folder = Column(String, default="")
    uid = Column(Integer, default=0)  # the server's number for it in remote_folder (0 = only here, e.g. a draft)
    message_id = Column(String, index=True, default="")
    in_reply_to = Column(String, default="")
    thread_key = Column(String, index=True, default="")
    from_name = Column(String, default="")
    from_email = Column(String, index=True, default="")
    to_list = Column(JSON, default=list)  # [{"name": "", "email": ""}]
    cc_list = Column(JSON, default=list)
    bcc_list = Column(JSON, default=list)
    subject = Column(Text, default="")
    snippet = Column(Text, default="")
    body_text = Column(Text, default="")
    body_html = Column(Text, default="")
    attachments = Column(JSON, default=list)  # [{"name", "size", "type", "file"}]
    has_attachments = Column(Boolean, default=False)
    is_read = Column(Boolean, default=False)
    is_starred = Column(Boolean, default=False)
    sent_at = Column(DateTime, index=True, default=datetime.utcnow)
    created_at = Column(DateTime, default=datetime.utcnow)


class EmailSuppression(Base):
    """Global (org_id is null) or org-scoped email suppression & do-not-contact registry."""
    __tablename__ = "email_suppressions"

    id = Column(String, primary_key=True)
    org_id = Column(String, index=True, nullable=True)  # NULL = global platform suppression
    email = Column(String, index=True, nullable=False)
    domain = Column(String, index=True, default="")
    reason = Column(String, default="unsubscribe")  # hard_bounce, spam_complaint, unsubscribe, manual, gdpr_erasure
    source = Column(String, default="manual")  # webhook, inbox_reader, manual_import, voice_dnc_sync
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


class EmailCampaign(Base):
    """Multi-channel cold outreach campaign definition (supporting email + voice call steps)."""
    __tablename__ = "email_campaigns"

    id = Column(String, primary_key=True)
    org_id = Column(String, index=True, server_default=FetchedValue())
    name = Column(String, nullable=False)
    status = Column(String, default="draft")  # draft, running, paused, completed
    mailbox_ids = Column(JSON, default=list)  # Rotating pool of mailboxes
    alias_map = Column(JSON, default=dict)  # {mailbox_id: alias address} -- which address each mailbox sends this campaign as
    timezone_policy = Column(String, default="recipient")  # recipient, org
    sending_window_start = Column(String, default="09:00")
    sending_window_end = Column(String, default="17:00")
    days_of_week = Column(JSON, default=lambda: [1, 2, 3, 4, 5])  # Mon-Fri
    min_delay_seconds = Column(Integer, default=60)
    max_delay_seconds = Column(Integer, default=300)
    mission_id = Column(String, ForeignKey("missions.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class EmailSequenceStep(Base):
    """Individual step in a campaign cadence (can be Email or Voice SDR call)."""
    __tablename__ = "email_sequence_steps"

    id = Column(String, primary_key=True)
    org_id = Column(String, index=True, server_default=FetchedValue())
    campaign_id = Column(String, ForeignKey("email_campaigns.id", ondelete="CASCADE"), index=True, nullable=False)
    step_number = Column(Integer, nullable=False)
    channel = Column(String, default="email")  # email, voice_call
    delay_days = Column(Integer, default=0)
    delay_hours = Column(Integer, default=0)
    
    # For Email Steps
    subject = Column(Text, default="")
    body_template = Column(Text, default="")
    
    # For Voice Steps
    voice_assistant_id = Column(String, default="")
    mission_id = Column(String, default="")
    # When a call step runs: always, no_reply (they have not answered the emails), opened_no_reply (opened, no reply).
    condition = Column(String, default="always")
    
    created_at = Column(DateTime, default=datetime.utcnow)


class EmailEnrollment(Base):
    """Prospect enrollment and progression tracking within a multi-step sequence."""
    __tablename__ = "email_enrollments"

    id = Column(String, primary_key=True)
    org_id = Column(String, index=True, server_default=FetchedValue())
    campaign_id = Column(String, ForeignKey("email_campaigns.id", ondelete="CASCADE"), index=True, nullable=False)
    prospect_id = Column(String, index=True, nullable=True)  # optional link to a voice prospect
    lead_id = Column(String, index=True, nullable=True)  # the Lead Gen company this person is, so a call step can ring them
    email = Column(String, index=True, default="")
    first_name = Column(String, default="")
    last_name = Column(String, default="")
    company = Column(String, default="")
    mailbox_id = Column(String, default="")  # the mailbox that sent step 1; follow-ups stay on it
    last_message_id = Column(String, default="")  # threads follow-ups under the previous email
    last_subject = Column(Text, default="")
    vars = Column(JSON, nullable=True)  # per-person merge values, such as the AI-written {{personal_line}}
    current_step = Column(Integer, default=1)
    status = Column(String, default="active")  # active, paused, completed, replied, bounced, unsubscribed
    last_action_at = Column(DateTime, nullable=True)
    next_action_at = Column(DateTime, nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class PersonCache(Base):
    """Global shared person & enrichment cache with PECR entity classification."""
    __tablename__ = "person_cache"

    id = Column(String, primary_key=True)
    pdl_person_id = Column(String, unique=True, index=True, nullable=True)
    email = Column(String, index=True, nullable=False)
    first_name = Column(String, default="")
    last_name = Column(String, default="")
    company_name = Column(String, default="")
    domain = Column(String, index=True, default="")
    
    # UK PECR Entity Classification
    entity_type = Column(String, default="unknown")  # corporate (Ltd/PLC/LLP), individual (sole trader), unknown
    entity_verified = Column(Boolean, default=False)
    
    # Email Verification
    verification_status = Column(String, default="unverified")  # verified, risky, catch_all, invalid
    verified_at = Column(DateTime, nullable=True)
    source = Column(String, default="")  # the provider that found it
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class EnrichmentAttempt(Base):
    """Telemetry log for enrichment provider waterfall performance, cost tracking, and margin analysis."""
    __tablename__ = "enrichment_attempts"

    id = Column(String, primary_key=True)
    org_id = Column(String, index=True, server_default=FetchedValue())
    query = Column(Text, default="")
    provider = Column(String, nullable=False)  # cache, icypeas, hunter, findymail, leadmagic, bettercontact
    found_email = Column(String, default="")
    cost_usd = Column(Float, default=0.0)
    latency_ms = Column(Integer, default=0)
    hit = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


class ProviderPrice(Base):
    """What one unit of a provider+model actually costs us -- staff-entered (or still waiting to
    be), the one source every AI/vendor cost figure in the platform is computed from. A new
    model seen in real usage gets a blank placeholder row automatically; nothing here is
    hardcoded in Python, so a model or provider that didn't exist yesterday needs no code change
    to be tracked, only a price typed in once it shows up."""
    __tablename__ = "provider_prices"
    __table_args__ = (UniqueConstraint("provider", "model", "kind", name="uq_provider_price"),)

    id = Column(String, primary_key=True)
    provider = Column(String, nullable=False, index=True)
    model = Column(String, default="")  # "" for providers with no model variants (Hunter, BetterContact...)
    kind = Column(String, nullable=False)  # llm | image | tts | stt | lookup
    # Meaning of price_in_usd depends on kind: per 1K input tokens (llm), per call (image, lookup),
    # per minute (stt), per 1K characters (tts). price_out_usd (per 1K output tokens) is llm-only.
    price_in_usd = Column(Float, default=0.0)
    price_out_usd = Column(Float, default=0.0)
    confirmed = Column(Boolean, default=False)  # false until staff has actually set/checked this price
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = Column(String, default="")


class AiUsage(Base):
    """Every AI call's real usage, captured automatically regardless of provider or model -- the
    same way enrichment_attempts already tracks the Leadgen vendors. cost_usd is computed from
    ProviderPrice at call time and stored, so editing a price later never rewrites history."""
    __tablename__ = "ai_usage"

    id = Column(String, primary_key=True)
    org_id = Column(String, index=True, server_default=FetchedValue())
    plugin = Column(String, default="")  # voice | leadgen | scheduler
    kind = Column(String, nullable=False)  # llm | image | tts | stt
    provider = Column(String, nullable=False)
    model = Column(String, default="")
    input_tokens = Column(Integer, default=0)
    output_tokens = Column(Integer, default=0)
    units = Column(Float, default=0.0)  # calls / minutes / characters -- whichever `kind` implies
    cost_usd = Column(Float, default=0.0)
    priced = Column(Boolean, default=False)  # false if no confirmed price existed yet at call time
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


class LeadAccount(Base):
    """A company a Leads user saved: from AI Lead Scout, the Copilot, an import or by hand. Holds
    only what a web search, a research run or the user supplied; anything unknown stays empty."""
    __tablename__ = "lead_accounts"

    id = Column(String, primary_key=True)
    org_id = Column(String, index=True, server_default=FetchedValue())
    name = Column(String, nullable=False)
    domain = Column(String, default="", index=True)  # e.g. acme.co.uk; how duplicates are spotted
    website = Column(String, default="")
    phone = Column(String, default="")
    email = Column(String, default="")
    contact_name = Column(String, default="")
    contact_title = Column(String, default="")
    industry = Column(String, default="")
    region = Column(String, default="")
    notes = Column(Text, default="")  # what the search said about it, or the user's own note
    source = Column(String, default="manual")  # scout, copilot, import, manual
    source_url = Column(String, default="")
    research = Column(JSON, nullable=True)  # last research run: overview, people, phones, emails, socials, sources
    researched_at = Column(DateTime, nullable=True)
    research_history = Column(JSON, nullable=True)  # earlier research runs, newest first, each {research, researched_at} -- so re-researching never throws away what an earlier run found
    # The last "Check companies" result: {verdict, email, phone, reasons[], stages[], checked_at, ...}.
    # Kept apart from the saved fields so a check never overwrites what the user imported.
    verification = Column(JSON, nullable=True)
    # The user's own extra columns from an imported file: {"column name": "value"} (see clean_custom).
    custom = Column(JSON, nullable=True)
    # Points at the shared, cross-organisation fact about this company (see BusinessRecord below).
    # This org's own notes/status never leave this row; only the shared, public half is pointed to.
    business_record_id = Column(String, ForeignKey("business_records.id"), nullable=True, index=True)
    # The shared contact record (contact_registry) this company matched, so calls and do-not-call
    # flags found in Voice apply here too. Soft reference, like other cross-plugin pointers.
    registry_id = Column(String, nullable=True, index=True)
    last_call_outcome = Column(String, default="")
    last_called_at = Column(DateTime, nullable=True)
    # Where the company is in the journey: new, contacted, interested, meeting, won, lost, do_not_contact.
    stage = Column(String, default="new", index=True)
    last_contact_at = Column(DateTime, nullable=True)
    next_action_at = Column(DateTime, nullable=True)  # a callback or follow-up the user or a call asked for
    next_action = Column(String, default="")
    best_time = Column(String, default="")
    source_post_id = Column(String, nullable=True)  # the social post whose engagement produced this lead
    # Facts a call or meeting found, waiting for the user to accept or ignore:
    # [{id, field, value, from, call_id, at}]
    suggestions = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class ContactEvent(Base):
    """One touch with a contact (email, call, meeting, post, note, status change), written as it
    happens so a contact's timeline is one cheap query instead of a join across five tables."""
    __tablename__ = "contact_events"
    org_id = Column(String, index=True, server_default=FetchedValue())

    id = Column(String, primary_key=True)
    lead_id = Column(String, nullable=True, index=True)
    registry_id = Column(String, nullable=True, index=True)
    kind = Column(String, nullable=False)  # email, call, meeting, post, note, status
    ref_id = Column(String, default="", index=True)  # the call, meeting, email or post it came from
    summary = Column(Text, default="")
    detail = Column(JSON, nullable=True)
    at = Column(DateTime, default=datetime.utcnow, index=True)


class DoNotContact(Base):
    """The one do-not-contact list. A row blocks a phone, an email, a whole email domain or a
    registry contact on the channels listed."""
    __tablename__ = "do_not_contact"
    org_id = Column(String, index=True, server_default=FetchedValue())

    id = Column(String, primary_key=True)
    registry_id = Column(String, nullable=True, index=True)
    phone = Column(String, default="", index=True)  # digits only, as normalize_phone_digits gives
    email = Column(String, default="", index=True)
    domain = Column(String, default="")
    channels = Column(JSON, default=lambda: ["call", "email", "social"])
    reason = Column(String, default="")
    source = Column(String, default="manual")  # call, email_unsubscribe, manual, import
    name = Column(String, default="")
    at = Column(DateTime, default=datetime.utcnow, index=True)


class ConnectionRules(Base):
    """What the user switched on in Settings -> Connections, one row per organisation."""
    __tablename__ = "connection_rules"
    org_id = Column(String, index=True, server_default=FetchedValue())

    id = Column(String, primary_key=True)  # always "default"
    rules = Column(JSON, default=dict)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class SocialPostMetric(Base):
    """Latest numbers a network reported for one published post on one channel (refreshed every few hours)."""
    __tablename__ = "social_post_metrics"
    org_id = Column(String, index=True, server_default=FetchedValue())

    id = Column(String, primary_key=True)  # f"{post_id}:{platform}"
    post_id = Column(String, index=True, nullable=False)
    platform = Column(String, default="")
    account_id = Column(String, default="")
    remote_id = Column(String, default="")
    published_at = Column(DateTime, nullable=True, index=True)
    # None = the network did not report it (never shown as 0).
    reach = Column(Integer, nullable=True)
    impressions = Column(Integer, nullable=True)
    likes = Column(Integer, nullable=True)
    comments = Column(Integer, nullable=True)
    shares = Column(Integer, nullable=True)
    saves = Column(Integer, nullable=True)
    clicks = Column(Integer, nullable=True)
    error = Column(Text, nullable=True)  # why the numbers could not be read, in plain words
    fetched_at = Column(DateTime, nullable=True)


class SocialAccountStat(Base):
    """Followers of a connected account on one day (one row per account per day)."""
    __tablename__ = "social_account_stats"
    org_id = Column(String, index=True, server_default=FetchedValue())

    id = Column(String, primary_key=True)  # f"{account_id}:{YYYY-MM-DD}"
    account_id = Column(String, index=True, nullable=False)
    platform = Column(String, default="")
    day = Column(String, index=True, nullable=False)
    followers = Column(Integer, nullable=True)
    fetched_at = Column(DateTime, default=datetime.utcnow)


class SocialMedia(Base):
    """A picture or video in the organisation's media library (uploaded, or drawn by the AI)."""
    __tablename__ = "social_media"
    org_id = Column(String, index=True, server_default=FetchedValue())

    id = Column(String, primary_key=True)
    kind = Column(String, default="image")  # image | video
    url = Column(Text, nullable=False)  # /api/scheduler/media/<file>
    name = Column(String, default="")
    mime = Column(String, default="")
    size_bytes = Column(Integer, default=0)
    width = Column(Integer, nullable=True)
    height = Column(Integer, nullable=True)
    duration_s = Column(Float, nullable=True)  # videos
    alt_text = Column(Text, default="")
    tags = Column(JSON, default=list)
    source = Column(String, default="upload")  # upload | ai | import
    created_by = Column(String, default="")
    last_used_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


class SocialVideoJob(Base):
    """One AI video clip being made (it takes minutes), and where it went (library item, post)."""
    __tablename__ = "social_video_jobs"
    org_id = Column(String, index=True, server_default=FetchedValue())

    id = Column(String, primary_key=True)
    post_id = Column(String, index=True, nullable=True)
    prompt = Column(Text, default="")
    shape = Column(String, default="9:16")  # 9:16 | 16:9 | 1:1
    seconds = Column(Integer, default=5)
    state = Column(String, default="queued", index=True)  # queued | making | done | failed
    error = Column(Text, nullable=True)
    media_id = Column(String, nullable=True)
    url = Column(Text, nullable=True)
    created_by = Column(String, default="")
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class SocialLink(Base):
    """A tracked short link put in a post in place of the original link, one per post, channel and link."""
    __tablename__ = "social_links"
    org_id = Column(String, index=True, server_default=FetchedValue())

    id = Column(String, primary_key=True)  # the short code in /api/l/<code>
    post_id = Column(String, index=True, nullable=False)
    platform = Column(String, default="")
    original_url = Column(Text, nullable=False)
    target_url = Column(Text, nullable=False)  # original_url with the UTM tags added
    clicks = Column(Integer, default=0)
    last_click_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class SocialLinkClick(Base):
    """One click on a tracked link by a person (link-preview robots are not counted)."""
    __tablename__ = "social_link_clicks"
    org_id = Column(String, index=True, server_default=FetchedValue())

    id = Column(String, primary_key=True)
    link_id = Column(String, index=True, nullable=False)
    post_id = Column(String, index=True, nullable=False)
    platform = Column(String, default="")
    referrer = Column(String, default="")
    at = Column(DateTime, default=datetime.utcnow, index=True)


class SocialReport(Base):
    """A results report for a client or manager: sent by email on a schedule and viewable by link."""
    __tablename__ = "social_reports"
    org_id = Column(String, index=True, server_default=FetchedValue())

    id = Column(String, primary_key=True)
    name = Column(String, default="Social report")
    days = Column(Integer, default=30)  # 7 | 30 | 90
    channels = Column(JSON, default=list)  # empty: every channel
    account_ids = Column(JSON, default=list)  # empty: every account
    recipients = Column(JSON, default=list)
    frequency = Column(String, default="none")  # none | weekly | monthly
    intro = Column(Text, default="")  # a note from the sender shown at the top
    last_sent_at = Column(DateTime, nullable=True)
    created_by = Column(String, default="")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class SocialReportRun(Base):
    """One time a report was emailed: who got it and whether it went through."""
    __tablename__ = "social_report_runs"
    org_id = Column(String, index=True, server_default=FetchedValue())

    id = Column(String, primary_key=True)
    report_id = Column(String, index=True, nullable=False)
    report_name = Column(String, default="")
    recipients = Column(JSON, default=list)
    sent = Column(Integer, default=0)
    failed = Column(Integer, default=0)
    error = Column(String, default="")
    trigger = Column(String, default="manual")  # manual | schedule
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


class SocialListenTopic(Base):
    """Words to watch for on the networks that allow searching (brand, product, competitor, topic)."""
    __tablename__ = "social_listen_topics"
    org_id = Column(String, index=True, server_default=FetchedValue())

    id = Column(String, primary_key=True)
    name = Column(String, default="")
    keywords = Column(JSON, default=list)
    exclude = Column(JSON, default=list)
    sources = Column(JSON, default=lambda: ["reddit"])  # reddit | x | threads | instagram
    active = Column(Boolean, default=True)
    checked = Column(JSON, default=dict)  # {source: iso time of the last search}
    last_error = Column(JSON, default=dict)  # {source: plain-words reason the last search failed}
    created_at = Column(DateTime, default=datetime.utcnow)


class SocialMention(Base):
    """A public post or comment that matched a listening topic."""
    __tablename__ = "social_mentions"
    org_id = Column(String, index=True, server_default=FetchedValue())

    id = Column(String, primary_key=True)  # hash of source + remote id
    topic_id = Column(String, index=True, nullable=False)
    source = Column(String, default="")
    remote_id = Column(String, default="")
    author = Column(String, default="")
    author_url = Column(String, default="")
    title = Column(Text, default="")
    text = Column(Text, default="")
    url = Column(Text, default="")
    where = Column(String, default="")  # subreddit, hashtag ...
    score = Column(Integer, nullable=True)
    status = Column(String, default="new", index=True)  # new | seen | ignored
    lead_id = Column(String, nullable=True)
    posted_at = Column(DateTime, nullable=True, index=True)
    found_at = Column(DateTime, default=datetime.utcnow)


class SocialEngager(Base):
    """A person who engaged publicly with one of the organisation's posts."""
    __tablename__ = "social_engagers"
    org_id = Column(String, index=True, server_default=FetchedValue())

    id = Column(String, primary_key=True)
    post_id = Column(String, index=True, nullable=False)
    network = Column(String, default="")
    handle = Column(String, default="")
    name = Column(String, default="")
    company = Column(String, default="")
    profile_url = Column(String, default="")
    kind = Column(String, default="comment")  # comment, reaction, share, reply
    text = Column(Text, default="")
    lead_id = Column(String, nullable=True)  # set once added to a list
    at = Column(DateTime, default=datetime.utcnow, index=True)


class SeedInbox(Base):
    """Managed seed inboxes for automated deliverability warmup exchange and placement testing."""
    __tablename__ = "seed_inboxes"

    id = Column(String, primary_key=True)
    email = Column(String, unique=True, nullable=False)
    provider = Column(String, default="google")  # google, microsoft, custom
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class DataSource(Base):
    """A website or API the platform can pull public business data from -- staff-configured in
    Platform Keys, never hand-coded. Adding a new site or API key is filling in this row, not a
    deploy: the generic connectors in app.services.data_source_connector/data_source_scraper read
    everything they need (endpoints, field mapping, scrape+LLM settings) from `config`. Not org-
    scoped -- a source belongs to the platform, not to one organisation."""
    __tablename__ = "data_sources"

    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    kind = Column(String, nullable=False)  # api | scrape
    base_url = Column(String, default="")
    auth_type = Column(String, default="none")  # none | api_key | bearer
    api_key = Column(String, default="")  # staff-entered; never exposed to org users
    config = Column(JSON, nullable=True)  # endpoint templates, field mapping, scrape+LLM settings
    provides_fields = Column(JSON, nullable=True)  # which BusinessRecord fields this source can fill
    max_concurrent_requests = Column(Integer, default=2)
    min_delay_ms = Column(Integer, default=1000)
    run_state = Column(String, default="idle")  # idle | running | paused | stopping | error | stuck
    status = Column(String, default="active")  # active | disabled
    last_error = Column(Text, default="")
    last_synced_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = Column(String, default="")


class DataSourceRun(Base):
    """One pass of fetching from a DataSource. `cursor` is a checkpoint (last page/offset/id
    processed) so pausing never loses progress -- resuming just continues from it instead of
    starting the source over."""
    __tablename__ = "data_source_runs"

    id = Column(String, primary_key=True)
    source_id = Column(String, ForeignKey("data_sources.id"), index=True, nullable=False)
    status = Column(String, default="running")  # running | paused | done | error | stuck
    cursor = Column(JSON, nullable=True)
    records_found = Column(Integer, default=0)
    records_new = Column(Integer, default=0)
    records_updated = Column(Integer, default=0)
    error_message = Column(Text, default="")
    started_at = Column(DateTime, default=datetime.utcnow, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    finished_at = Column(DateTime, nullable=True)


class BusinessRecord(Base):
    """One outside company's public facts, merged from however many sources confirmed it --
    shared across every organisation on purpose: this is public data about businesses out in the
    world, never anything belonging to one of our own users, so there is no org_id and no row-
    level security on this table (see app.core.tenancy.TENANT_TABLES, which deliberately excludes
    it). `identity_hash` is how the same company found via two different sources becomes one row
    instead of a duplicate. An organisation's own notes about a company live on their own
    LeadAccount row instead, pointed at this one by LeadAccount.business_record_id -- never here."""
    __tablename__ = "business_records"

    id = Column(String, primary_key=True)
    identity_hash = Column(String, unique=True, nullable=False, index=True)
    name = Column(String, nullable=False)
    registration_number = Column(String, default="", index=True)
    domain = Column(String, default="", index=True)
    website = Column(String, default="")
    phone = Column(String, default="")
    email = Column(String, default="")
    address = Column(String, default="")
    industry = Column(String, default="")
    region = Column(String, default="", index=True)
    employee_estimate = Column(String, default="")
    description = Column(Text, default="")
    status = Column(String, default="")  # active, dissolved, liquidation, ... -- whatever the source calls it
    company_category = Column(String, default="")  # private limited, PLC, LLP, ...
    incorporation_date = Column(String, default="")
    # Search columns, derived from the source's own data (never guessed): sic_text is every SIC
    # description the registry lists, sic_codes the codes in them as "|56102|47110|", postcode is
    # upper-cased, incorporated_on is incorporation_date as a real date, and size_band is how the
    # company's FILED ACCOUNTS classify it (micro/small/medium_large/dormant) -- not headcount.
    sic_text = Column(String, nullable=True)
    sic_codes = Column(String, nullable=True)
    postcode = Column(String, nullable=True)
    incorporated_on = Column(Date, nullable=True)
    size_band = Column(String, nullable=True)
    officers = Column(JSON, nullable=True)  # [{name, role, appointed_on, ...}] -- fetched per-company, not during a bulk import
    significant_control = Column(JSON, nullable=True)  # [{name, kind, notified_on, ...}] -- who actually owns/controls it
    sources = Column(JSON, nullable=True)  # [{source_id, source_type, confirmed_at}, ...]
    # The full dossier (team, named contacts, phones, emails, sources, overview) from whichever
    # organisation's own Research run found the most recently -- this is public fact about the
    # business, not that organisation's private data, so every other organisation's saved account
    # for the same company gets it too, for free (see lead_accounts.py's research_account and
    # _apply_shared_record). Distinct from `sources` above (that's source-attribution bookkeeping;
    # this holds the research citations as the dossier itself shows them).
    shared_research = Column(JSON, nullable=True)
    confidence_tier = Column(String, default="scraped")  # verified_registry | scraped | llm_fallback
    raw_data = Column(JSON, nullable=True)  # the FULL original record from each source, keyed by source_id --
    # nothing a source publishes is ever thrown away, even fields with no column of their own yet
    embedding = Column(Vector(384), nullable=True)  # for later semantic ("indirect business") search
    # How well-filled-in and how well-known the company is, as one number for sorting (see business_records.rank_score_of):
    # tier * 10000 + prominence * 10 + filled-in fields. NULL means a bare registry record.
    rank_score = Column(Integer, nullable=True)
    needs_review = Column(Boolean, default=False)
    fetch_hash = Column(String, default="")  # hash of the last raw fetch; skips reprocessing unchanged content
    fetched_at = Column(DateTime, default=datetime.utcnow)
    last_verified_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class PlatformOptOut(Base):
    """A person who asked, on our public opt-out page or through staff, to be left out of the shared business data. Kept
    on purpose after their details are removed: it is how a later import is stopped from putting them back. Not
    organisation-scoped, like BusinessRecord."""
    __tablename__ = "platform_optouts"

    id = Column(String, primary_key=True)
    email = Column(String, index=True, default="")
    phone_key = Column(String, index=True, default="")  # the last ten digits of the number, so every way of writing it matches
    source = Column(String, default="opt_out_page")  # opt_out_page | staff
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


class PostcodeGeo(Base):
    """A UK postcode's centre point, looked up once (postcodes.io) and cached for everyone -- public
    geography, like BusinessRecord, so no org_id. lat/lng are NULL for a postcode that could not be
    found, so it is not asked for again on every search. Powers the Find Leads map and drawn-area search."""
    __tablename__ = "postcode_geo"

    postcode = Column(String, primary_key=True)  # upper-cased with the single space, e.g. "SW1A 1AA"
    lat = Column(Float, nullable=True)
    lng = Column(Float, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class EmailTemplate(Base):
    """Company-scoped email template stored in the database."""
    __tablename__ = "email_templates"

    id = Column(String, primary_key=True)
    org_id = Column(String, index=True, server_default=FetchedValue())
    name = Column(String, nullable=False)
    subject = Column(Text, default="")
    body_text = Column(Text, default="")
    category = Column(String, default="Outbound")
    tags = Column(JSON, default=list)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class WebhookEndpoint(Base):
    """An external destination URL registered by an organisation to receive real-time webhook events."""
    __tablename__ = "webhook_endpoints"

    id = Column(String, primary_key=True, default=lambda: f"wh_{uuid.uuid4().hex[:12]}")
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    url = Column(String, nullable=False)
    secret = Column(String, nullable=False)  # whsec_... used for HMAC-SHA256 signature
    description = Column(String, default="")
    events = Column(JSON, default=lambda: ["call.completed", "call.failed"])  # subscribed event types
    is_active = Column(Boolean, default=True, index=True)
    last_delivery_at = Column(DateTime, nullable=True)
    last_delivery_status = Column(Integer, nullable=True)  # HTTP status code e.g. 200, 500
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class WebhookDeliveryLog(Base):
    """Audit log of individual webhook attempts sent to external partner endpoints."""
    __tablename__ = "webhook_delivery_logs"

    id = Column(String, primary_key=True, default=lambda: f"whlog_{uuid.uuid4().hex[:12]}")
    endpoint_id = Column(String, ForeignKey("webhook_endpoints.id", ondelete="CASCADE"), nullable=False, index=True)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    event_type = Column(String, nullable=False, index=True)  # e.g. "call.completed"
    payload = Column(JSON, nullable=False)
    status_code = Column(Integer, nullable=True)
    response_body = Column(Text, nullable=True)
    duration_ms = Column(Integer, default=0)
    success = Column(Boolean, default=False)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)



# ── Public /v1 API support tables ─────────────────────────────────────────────
class PublicApiIdempotency(Base):
    """A POST sent with an Idempotency-Key: the answer is kept so a retry gets the same answer, not a second action."""
    __tablename__ = "public_api_idempotency"

    id = Column(String, primary_key=True)  # "<org>:<key>"
    org_id = Column(String, index=True, server_default=FetchedValue())
    key = Column(String, nullable=False)
    fingerprint = Column(String, nullable=False)  # method + path + body: the same key must mean the same request
    state = Column(String, default="running")  # running | done
    status_code = Column(Integer, nullable=True)
    body = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


class PublicApiAudit(Base):
    """One row per API request: who (which key), what, and how it went. Never holds request bodies or secrets."""
    __tablename__ = "public_api_audit"

    id = Column(String, primary_key=True, default=lambda: f"aud_{uuid.uuid4().hex[:14]}")
    org_id = Column(String, index=True, server_default=FetchedValue())
    key_id = Column(String, index=True)
    request_id = Column(String, index=True)
    method = Column(String)
    path = Column(String)
    status = Column(Integer)
    ms = Column(Integer, default=0)
    ip = Column(String, default="")
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


class PublicObject(Base):
    """Small records the public API owns: test-mode (sandbox) objects and email-campaign approvals."""
    __tablename__ = "public_objects"

    id = Column(String, primary_key=True)
    org_id = Column(String, index=True, server_default=FetchedValue())
    kind = Column(String, index=True)  # sandbox_call | sandbox_post | sandbox_search | sandbox_campaign | email_approval
    data = Column(JSON, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class PartnerApplication(Base):
    """A company asking to offer Outreach inside its own software. Staff approve or reject it."""
    __tablename__ = "partner_applications"

    id = Column(String, primary_key=True, default=lambda: f"papp_{uuid.uuid4().hex[:12]}")
    owner_org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    company = Column(String, nullable=False)
    product = Column(String, default="")
    use_case = Column(Text, default="")
    expected_users = Column(String, default="")
    contact_name = Column(String, default="")
    contact_email = Column(String, default="")
    website = Column(String, default="")
    status = Column(String, default="pending", index=True)  # pending | approved | rejected
    review_note = Column(Text, default="")
    reviewed_by = Column(String, default="")
    reviewed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


class Partner(Base):
    """An approved partner. Its users sign up or log in through the partner's own pages, which call POST /v1/run."""
    __tablename__ = "partners"

    id = Column(String, primary_key=True, default=lambda: f"ptr_{uuid.uuid4().hex[:12]}")
    owner_org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    application_id = Column(String, nullable=True)
    client_id = Column(String, nullable=False, unique=True, index=True)  # public: sent with every sign-up and login
    name = Column(String, nullable=False)
    status = Column(String, default="sandbox", index=True)  # sandbox | live | suspended
    live_requested_at = Column(DateTime, nullable=True)
    allowed_origins = Column(JSON, default=list)  # web addresses their login page runs on, e.g. https://app.partner.com
    return_urls = Column(JSON, default=list)  # exact addresses we may send a user back to
    scopes = Column(JSON, default=lambda: ["voice:calls", "leads:search", "social:publish", "wallets:read"])
    logo_url = Column(String, default="")
    accent_color = Column(String, default="")
    webhook_url = Column(String, default="")
    webhook_secret = Column(String, default="")  # whsec_...: signs the events sent to webhook_url
    secret_hash = Column(String, default="")  # SHA-256 of the partner's secret key (psk_...); the key itself is shown once
    secret_prefix = Column(String, default="")
    theme = Column(JSON, default=dict)  # the saved default look of embedded screens (see services/embed_theme.py)
    terms_version = Column(String, default="")
    terms_accepted_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class PartnerLink(Base):
    """One Outreach account a partner may act for, with the consent the user gave and the key issued for it."""
    __tablename__ = "partner_links"

    id = Column(String, primary_key=True, default=lambda: f"plink_{uuid.uuid4().hex[:12]}")
    partner_id = Column(String, ForeignKey("partners.id", ondelete="CASCADE"), nullable=False, index=True)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    operator_id = Column(String, default="")
    created_account = Column(Boolean, default=False)  # true when the account was created through this partner
    consent_version = Column(String, default="")
    consented_at = Column(DateTime, nullable=True)
    external_id = Column(String, default="", index=True)  # the user's id in the partner's own software
    key_id = Column(String, default="")  # the API key currently issued to the partner for this account
    status = Column(String, default="active", index=True)  # active | revoked
    revoked_by = Column(String, default="")  # user | partner | staff
    revoked_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    last_login_at = Column(DateTime, nullable=True)

    __table_args__ = (UniqueConstraint("partner_id", "org_id", name="uq_partner_link_org"),)


from sqlalchemy import event as _sa_event  # noqa: E402


@_sa_event.listens_for(SocialPost.image_url, "set")
def _cover_follows_image(target, value, oldvalue, initiator):
    """image_url is the post's first picture. Older code paths (AI redraw, Replace, restore) only set
    image_url; keep the media list's first picture in step so a carousel never shows a stale cover."""
    media = target.media if isinstance(target.media, list) else []
    if not media or not isinstance(media[0], dict) or media[0].get("kind", "image") != "image":
        return
    if value and media[0].get("url") != value:
        same_file = str(value).split("/")[-1] == str(media[0].get("url") or "").split("/")[-1]
        target.media = [dict(media[0], url=value, **({} if same_file else {"id": None, "width": None, "height": None}))] + media[1:]
    elif not value and oldvalue and media[0].get("url") == oldvalue:
        target.media = media[1:]


class CallList(Base):
    """A saved Call list: the table of people a user wants the AI to call (name, phone, company, notes and
    any extra columns from an imported file). Rows are kept whole, as the Call list screen edits them."""
    __tablename__ = "call_lists"

    id = Column(String, primary_key=True)
    org_id = Column(String, index=True, server_default=FetchedValue())
    name = Column(String, nullable=False)
    headers = Column(JSON, default=list)
    rows = Column(JSON, default=list)
    row_count = Column(Integer, default=0)
    called_count = Column(Integer, default=0)  # rows that already have a call, as of the last save
    created_by = Column(String, default="")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class CallSchedule(Base):
    """Calls placed on their own: a Call list, dialled right now, once, or on a repeating pattern, at one or
    more times a day. The server starts each run at its time (see call_schedule_engine)."""
    __tablename__ = "call_schedules"

    id = Column(String, primary_key=True)
    org_id = Column(String, index=True, server_default=FetchedValue())
    name = Column(String, nullable=False)
    list_id = Column(String, nullable=False, index=True)
    from_number = Column(String, default="")
    concurrency = Column(Integer, default=1)
    times = Column(JSON, default=lambda: ["10:00"])  # HH:MM in the organisation timezone, several a day allowed
    frequency = Column(String, default="recurring")  # now | once | recurring
    pattern = Column(String, default="weekly")  # daily | weekly | monthly | dates
    weekday = Column(String, nullable=False, default="")  # weekly pattern, e.g. "MO,TH"
    month_day = Column(Integer, nullable=True)
    custom_dates = Column(JSON, default=list)
    start_date = Column(String, nullable=True)  # YYYY-MM-DD, organisation timezone
    end_date = Column(String, nullable=True)
    status = Column(String, default="active")  # active | paused | ended
    ended_reason = Column(String, nullable=True)
    fired = Column(JSON, default=list)  # slots already handled, "YYYY-MM-DD HH:MM", newest last
    runs = Column(JSON, default=list)  # the latest runs: [{slot, at, ok, message, missionId}]
    created_by = Column(String, default="")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
