from sqlalchemy import Column, String, Integer, Boolean, Text, JSON, DateTime, ForeignKey, Float
from sqlalchemy.orm import relationship
from datetime import datetime
from app.database import Base

class Operator(Base):
    __tablename__ = "operators"
    
    id = Column(String, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    name = Column(String, nullable=False)
    role = Column(String, default="Operator")
    email = Column(String, nullable=True)
    hashed_password = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

class CompanyProfile(Base):
    __tablename__ = "company_profile"
    
    id = Column(String, primary_key=True, default="default")
    name = Column(String, default="AIVHub")
    pitch = Column(Text, default="AI-powered business intelligence dashboards for mid-market operations teams")
    industry = Column(String, default="Business intelligence / data consulting")
    website = Column(String, default="https://aivhub.io")
    social = Column(String, default="linkedin.com/company/aivhub")
    caller_name = Column(String, default="Sam")
    caller_id = Column(String, default="+44 20 7946 0912")
    tone = Column(String, default="Professional, concise, friendly")
    disclosure = Column(Text, default="This call may be recorded for quality and training purposes.")
    legal_name = Column(String, default="AIVHub Ltd")
    ico_ref = Column(String, default="ZA774219")
    dpo_contact = Column(String, default="privacy@aivhub.io")
    dnc_notes = Column(Text, default="Opt-outs logged immediately and excluded from all future missions.")
    timezone = Column(String, default="Europe/London")
    lunch_start = Column(String, default="12:00")
    lunch_end = Column(String, default="13:00")
    call_hours_policy = Column(String, default="respectful")
    weekday_start = Column(String, default="09:00")
    weekday_end = Column(String, default="17:30")
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class KnowledgeSource(Base):
    __tablename__ = "knowledge_sources"
    
    id = Column(String, primary_key=True, index=True)
    name = Column(String, nullable=False)
    type = Column(String, nullable=False)  # "Website URL", "Document upload", etc.
    value = Column(Text, nullable=False)
    status = Column(String, default="indexed")
    synced = Column(String, default="Just now")
    created_at = Column(DateTime, default=datetime.utcnow)

class Service(Base):
    __tablename__ = "services"
    
    id = Column(String, primary_key=True, index=True)
    name = Column(String, nullable=False)
    ideal = Column(String, nullable=False)
    desc = Column(Text, nullable=False)

class FAQ(Base):
    __tablename__ = "faqs"
    
    id = Column(String, primary_key=True, index=True)
    question = Column(Text, nullable=False)
    answer = Column(Text, nullable=False)

class Connection(Base):
    __tablename__ = "connections"
    
    id = Column(String, primary_key=True, index=True)
    group_name = Column(String, nullable=False)  # "LLM", "Speech-to-Text", etc.
    name = Column(String, nullable=False)
    status = Column(String, default="not_configured")  # "connected", "not_configured", "error"
    api_key_masked = Column(String, nullable=True)
    config = Column(JSON, default=dict)

class ContactRegistry(Base):
    __tablename__ = "contact_registry"
    
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
    default_channel = Column(String, default="voice")
    created_at = Column(DateTime, default=datetime.utcnow)
    
    prospects = relationship("Prospect", back_populates="mission", cascade="all, delete-orphan")

class Prospect(Base):
    __tablename__ = "prospects"
    
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
    created_at = Column(DateTime, default=datetime.utcnow)

class CallLog(Base):
    __tablename__ = "call_logs"
    
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
    
    id = Column(String, primary_key=True, index=True)
    prospect = Column(String, nullable=False)
    mission = Column(String, nullable=False)
    date = Column(String, nullable=False)
    time = Column(String, nullable=False)
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
    attendee = Column(String, default="")
    prep = Column(Text, default="")
    outcome = Column(String, nullable=True)
    call_transcript = Column(JSON, default=list)
    meeting_transcript = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

class ScheduleItem(Base):
    __tablename__ = "schedule_items"
    
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
    created_at = Column(DateTime, default=datetime.utcnow)

class Notification(Base):
    __tablename__ = "notifications"
    
    id = Column(String, primary_key=True, index=True)
    text = Column(Text, nullable=False)
    time = Column(String, default="Just now")
    unread = Column(Boolean, default=True)
    type = Column(String, default="info")  # success, alert, info
    created_at = Column(DateTime, default=datetime.utcnow)

# Post Scheduler Models
class SocialSchedule(Base):
    __tablename__ = "social_schedules"
    
    id = Column(String, primary_key=True, index=True)
    weekday = Column(String, nullable=False)
    time = Column(String, default="10:00")
    theme = Column(String, nullable=False)
    focus = Column(Text, default="")
    channels = Column(JSON, default=lambda: ["linkedin", "facebook", "x"])

class SocialTopic(Base):
    __tablename__ = "social_topics"
    
    id = Column(String, primary_key=True, index=True)
    schedule_id = Column(String, nullable=True)
    title = Column(String, nullable=False)
    angle = Column(Text, default="")
    hook = Column(Text, default="")
    source_type = Column(String, default="Knowledge Base")
    source_name = Column(String, default="Company Profile")
    keywords = Column(JSON, default=list)

class SocialPost(Base):
    __tablename__ = "social_posts"
    
    id = Column(String, primary_key=True, index=True)
    topic_id = Column(String, nullable=True)
    schedule_id = Column(String, nullable=True)
    title = Column(String, nullable=False)
    copy = Column(Text, nullable=False)
    channels = Column(JSON, default=lambda: ["linkedin", "x"])
    status = Column(String, default="draft")  # draft, awaiting_approval, approved, scheduled, published
    slot_date_ms = Column(Float, nullable=True)
    time = Column(String, default="10:00")
    theme = Column(String, default="General")
    tone = Column(String, default="Professional")
    created_at = Column(DateTime, default=datetime.utcnow)

class SocialEmail(Base):
    __tablename__ = "social_emails"
    
    id = Column(String, primary_key=True, index=True)
    post_id = Column(String, nullable=False)
    subject = Column(String, nullable=False)
    from_addr = Column(String, default="scheduler@aivhub.io")
    to_addr = Column(String, default="admin@aivhub.io")
    date = Column(String, default="Today")
    status = Column(String, default="unread")  # unread, read, acted
    post_data = Column(JSON, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow)
