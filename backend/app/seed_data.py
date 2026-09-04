import asyncio
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.database import AsyncSessionLocal, engine, Base
from app.models.models import (
    Operator,
    CompanyProfile,
    KnowledgeSource,
    Service,
    FAQ,
    Connection,
    ContactRegistry,
    Mission,
    Prospect,
    LiveCall,
    CallLog,
    Meeting,
    ScheduleItem,
    Notification,
    SocialPost,
)

async def seed_database():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        
    async with AsyncSessionLocal() as db:
        # Check if already initialized
        res = await db.execute(select(Operator))
        if res.scalars().first():
            return

        print("Initializing clean database structure...")
        
        # 1. Operators
        admin = Operator(
            id="op_admin",
            username="jitendra",
            name="Jitendra S.",
            role="Admin",
            email="admin@aivhub.io",
            hashed_password="mock_password"
        )
        db.add(admin)
        
        # 2. Default Company Profile
        profile = CompanyProfile(
            id="default",
            name="AIVHub",
            pitch="AI-powered business intelligence dashboards for mid-market operations teams",
            industry="Business intelligence / data consulting",
            website="https://aivhub.io",
            social="linkedin.com/company/aivhub",
            caller_name="Sam",
            caller_id="+44 20 7946 0912",
            tone="Professional, concise, friendly",
            disclosure="This call may be recorded for quality and compliance purposes.",
            legal_name="AIVHub Ltd",
            ico_ref="ZA774219",
            dpo_contact="privacy@aivhub.io",
            dnc_notes="Opt-outs logged immediately and excluded from all future missions.",
            timezone="Europe/London",
            lunch_start="12:00",
            lunch_end="13:00",
            call_hours_policy="respectful",
            weekday_start="09:00",
            weekday_end="17:30",
        )
        db.add(profile)
        
        # 3. Default Knowledge Sources
        sources = [
            KnowledgeSource(id="k1", name="Company website", type="Website URL", value="https://aivhub.io", status="indexed", synced="Ready"),
        ]
        db.add_all(sources)
        
        # 4. Default Services
        services = [
            Service(id="sv1", name="BI Dashboard Platform", ideal="Mid-market ops teams, 50-500 staff", desc="Real-time operational dashboards pulling from existing systems."),
        ]
        db.add_all(services)
        
        # 5. Default FAQs
        faqs = [
            FAQ(id="f1", question="What does AIVHub do?", answer="We build AI-powered business intelligence dashboards that turn operational data into clear, real-time decisions for mid-market teams."),
        ]
        db.add_all(faqs)
        
        # 6. Connections template
        conns = [
            Connection(id="c_llm1", group_name="LLM", name="DeepSeek", status="not_configured"),
            Connection(id="c_llm2", group_name="LLM", name="OpenAI (GPT-4o)", status="not_configured"),
            Connection(id="c_llm3", group_name="LLM", name="Anthropic (Claude)", status="not_configured"),
            Connection(id="c_stt1", group_name="Speech-to-Text", name="Deepgram", status="not_configured"),
            Connection(id="c_tts1", group_name="Text-to-Speech", name="ElevenLabs", status="not_configured"),
            Connection(id="c_cal1", group_name="Calendar", name="Cal.com (Self-Hosted)", status="connected"),
        ]
        db.add_all(conns)
        
        # Note: Missions, Prospects, LiveCalls, Meetings, and ScheduleItems start 100% EMPTY for clean real-world testing.
        
        await db.commit()
        print("Database initialized cleanly for production testing!")

if __name__ == "__main__":
    asyncio.run(seed_database())
