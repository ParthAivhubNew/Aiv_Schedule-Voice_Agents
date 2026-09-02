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
        # Check if already seeded
        res = await db.execute(select(Operator))
        if res.scalars().first():
            print("Database already contains records. Skipping seed.")
            return

        print("Seeding initial data...")
        
        # 1. Operators
        admin = Operator(
            id="op_admin",
            username="jitendra",
            name="Jitendra S.",
            role="Admin",
            email="jitendra@aivhub.io",
            hashed_password="mock_password"
        )
        db.add(admin)
        
        # 2. Company Profile
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
            disclosure="This call may be recorded for quality and training purposes.",
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
        
        # 3. Knowledge Sources
        sources = [
            KnowledgeSource(id="k1", name="Company website", type="Website URL", value="aivhub.io", status="indexed", synced="2 hours ago"),
            KnowledgeSource(id="k2", name="Service catalogue & pricing", type="Document upload", value="aivhub-services-2026.pdf", status="indexed", synced="1 day ago"),
            KnowledgeSource(id="k3", name="Case studies deck", type="Google Drive link", value="drive.google.com/aivhub-case-studies", status="pending", synced="—"),
            KnowledgeSource(id="k4", name="Objection handling notes", type="Manual text", value="Internal notes on common pushback", status="indexed", synced="3 days ago"),
        ]
        db.add_all(sources)
        
        # 4. Services
        services = [
            Service(id="sv1", name="BI Dashboard Platform", ideal="Mid-market ops teams, 50-500 staff", desc="Real-time operational dashboards pulling from existing systems."),
            Service(id="sv2", name="Data Pipeline Consulting", ideal="Companies with fragmented data sources", desc="Set up reliable pipelines feeding clean data into reporting."),
        ]
        db.add_all(services)
        
        # 5. FAQs
        faqs = [
            FAQ(id="f1", question="What does AIVHub actually do?", answer="We build AI-powered business intelligence dashboards that turn raw operational data into clear, real-time decisions for mid-market teams."),
            FAQ(id="f2", question="How much does it cost?", answer="Pricing depends on team size and data sources — I can have someone send exact numbers, or we can cover it on the call we're booking."),
            FAQ(id="f3", question="Who else uses this?", answer="We work with logistics, manufacturing, and retail operators across the UK — happy to share relevant examples on the call."),
        ]
        db.add_all(faqs)
        
        # 6. Connections
        conns = [
            Connection(id="c_llm1", group_name="LLM", name="Anthropic (Claude)", status="connected"),
            Connection(id="c_llm2", group_name="LLM", name="OpenAI (GPT-4o)", status="connected"),
            Connection(id="c_llm3", group_name="LLM", name="DeepSeek", status="not_configured"),
            Connection(id="c_stt1", group_name="Speech-to-Text", name="Deepgram", status="connected"),
            Connection(id="c_stt2", group_name="Speech-to-Text", name="Faster-Whisper (self-hosted)", status="not_configured"),
            Connection(id="c_tts1", group_name="Text-to-Speech", name="ElevenLabs", status="connected"),
            Connection(id="c_tts2", group_name="Text-to-Speech", name="Cartesia", status="not_configured"),
            Connection(id="c_tts3", group_name="Text-to-Speech", name="Kokoro (self-hosted)", status="not_configured"),
            Connection(id="c_vo1", group_name="Voice Orchestration", name="Vapi", status="connected"),
            Connection(id="c_vo2", group_name="Voice Orchestration", name="Retell AI", status="not_configured"),
            Connection(id="c_vo3", group_name="Voice Orchestration", name="LiveKit (self-hosted)", status="connected"),
            Connection(id="c_tel1", group_name="Telephony", name="Twilio", status="connected"),
            Connection(id="c_cal1", group_name="Calendar", name="Cal.com", status="connected"),
            Connection(id="c_disc1", group_name="Business Discovery", name="Google Places API", status="connected"),
            Connection(id="c_disc2", group_name="Business Discovery", name="Web Search Provider", status="connected"),
        ]
        db.add_all(conns)
        
        # 7. Contact Registry
        registry = [
            ContactRegistry(
                id="cr1",
                canonical_name="Acme Logistics Ltd",
                aliases=["Acme Logistics", "ACME LOGISTICS LIMITED"],
                phones=["+44 161 496 0123"],
                websites=["acmelogistics.co.uk"],
                region="Manchester",
                sector="Logistics",
                people=[{"canonicalName": "James Whitfield", "role": "Ops Director", "phone": "+44 161 496 0123"}],
                do_not_call=False,
                last_outcome="meeting_booked",
                last_contact_at="26 Aug 2026, 14:32"
            ),
            ContactRegistry(
                id="cr2",
                canonical_name="Northern Freight Co",
                aliases=["Northern Freight Company"],
                phones=["+44 161 220 4471"],
                websites=["northernfreight.co.uk"],
                region="Manchester",
                sector="Logistics",
                do_not_call=False,
                last_outcome="calling",
                last_contact_at="Live"
            ),
            ContactRegistry(
                id="cr3",
                canonical_name="Speedy Haulage",
                aliases=["Speedy Haulage Ltd"],
                phones=["+44 161 774 5510"],
                websites=["speedyhaulage.co.uk"],
                region="Manchester",
                sector="Logistics",
                people=[{"canonicalName": "Priya Nair", "role": "MD", "phone": "+44 161 774 5510"}],
                do_not_call=True,
                last_outcome="rejected",
                last_contact_at="26 Aug 2026, 10:41"
            )
        ]
        db.add_all(registry)
        
        # 8. Missions & Prospects
        m1 = Mission(
            id="m1",
            title="Logistics companies — Manchester",
            sector="Logistics",
            region="Manchester",
            status="active",
            contacted=12,
            total=20,
            meetings_booked=3,
            created="24 Aug",
            source="discover",
            concurrency=5,
            call_window="09:00–17:30"
        )
        db.add(m1)
        
        p1 = Prospect(id="p1", mission_id="m1", registry_id="cr1", name="Acme Logistics Ltd", sector="Logistics", region="Manchester", status="meeting_booked", fit=92, contact_person="James Whitfield · Ops Director", phone="+44 161 496 0123", site="acmelogistics.co.uk", note="Meeting booked — Thu 26 Sep, 2:00 PM", time_status="14:32")
        p2 = Prospect(id="p2", mission_id="m1", registry_id="cr2", name="Northern Freight Co", sector="Logistics", region="Manchester", status="calling", fit=81, phone="+44 161 220 4471", site="northernfreight.co.uk", note="Negotiating meeting time", time_status="now")
        p3 = Prospect(id="p3", mission_id="m1", name="Manchester Transport Group", sector="Logistics", region="Manchester", status="retry", fit=74, phone="+44 161 883 2200", site="mtgroup.co.uk", note="No answer — retry scheduled 15:00", time_status="11:05")
        p4 = Prospect(id="p4", mission_id="m1", registry_id="cr3", name="Speedy Haulage", sector="Logistics", region="Manchester", status="rejected", fit=58, phone="+44 161 774 5510", site="speedyhaulage.co.uk", note="Not interested — added to do-not-call", time_status="10:41")
        p5 = Prospect(id="p5", mission_id="m1", name="Green Mile Logistics", sector="Logistics", region="Manchester", status="cold", fit=69, phone="+44 161 552 9081", site="greenmilelogistics.co.uk", note="Researching company profile", time_status="09:58")
        p6 = Prospect(id="p6", mission_id="m1", name="Pennine Distribution", sector="Logistics", region="Manchester", status="human_review", fit=88, contact_person="Tom Radcliffe · Finance Director", phone="+44 161 998 3345", site="pennine-dist.co.uk", note="Asked about pricing — needs staff input", time_status="13:12")
        db.add_all([p1, p2, p3, p4, p5, p6])
        
        # 9. Live Calls
        live_calls = [
            LiveCall(
                id="c1",
                mission_id="m1",
                prospect_id="p2",
                prospect="Northern Freight Co",
                mission="Logistics — Manchester",
                state="negotiating",
                channel="voice",
                duration="02:14",
                transcript=[
                    "AI: Would Thursday at 2pm work for a short call with your ops lead?",
                    "Prospect: Let me check — maybe Wednesday instead.",
                    "AI: Wednesday works well — morning or afternoon suits better?",
                ]
            ),
            LiveCall(
                id="c2",
                mission_id="m1",
                prospect_id="p6",
                prospect="Pennine Distribution",
                mission="Logistics — Manchester",
                state="human_review",
                channel="voice",
                duration="04:02",
                flag="Pricing question",
                transcript=[
                    "Prospect: What exactly does this cost us, roughly?",
                    "AI: I can have someone follow up with pricing details directly —",
                ]
            ),
            LiveCall(
                id="c4",
                mission_id="m1",
                prospect="Riverside Manufacturing",
                mission="Q3 warm leads",
                state="negotiating",
                channel="whatsapp",
                duration="3 messages",
                transcript=[
                    "AI: Hi! This is Sam from AIVHub — saw Riverside's expanding the Coventry site. Worth a quick 15-min chat about ops dashboards?",
                    "Prospect: Maybe, send more info first",
                    "AI: Sure — sending a one-pager now. Would Tuesday or Wednesday next week work for a short call either way?",
                ]
            )
        ]
        db.add_all(live_calls)
        
        # 10. Meetings
        meetings = [
            Meeting(
                id="mt1",
                prospect="Acme Logistics Ltd",
                mission="Logistics — Manchester",
                date="Thu 3 Sep",
                time="14:00",
                duration="15 min",
                status="upcoming",
                fit=92,
                channel="voice",
                format="video",
                platform="Google Meet",
                video_link="meet.google.com/aiv-acme-disc",
                host="Jitendra S.",
                attendee="James Whitfield · Ops Director",
                prep="James showed strong interest in real-time dispatch dashboards on the call. Current pain point: manual Excel reporting takes ~2 days/week.",
                call_transcript=[
                    {"who": "ai", "text": "Hi, this is Sam calling on behalf of AIVHub — do you have a quick minute?"},
                    {"who": "them", "text": "Sure, what's this about?"},
                    {"who": "ai", "text": "We build BI dashboards for logistics operators. Quick question: how does your team currently track dispatch performance?"},
                    {"who": "them", "text": "Mostly spreadsheets, honestly. It's a mess."},
                    {"who": "ai", "text": "That's exactly what we help with. Would a 15-minute call with James make sense to see if it's a fit?"},
                    {"who": "them", "text": "Yeah, put something in for Thursday afternoon."},
                    {"who": "ai", "text": "Perfect — Thursday 2pm works, I'll send a Google Meet link over."}
                ]
            )
        ]
        db.add_all(meetings)
        
        # 11. Schedule Items
        schedules = [
            ScheduleItem(id="s1", day="Today, 27 Aug", time="09:30", prospect="Green Mile Logistics", mission="Logistics — Manchester", window="09:00–17:30", status="queued"),
            ScheduleItem(id="s2", day="Today, 27 Aug", time="11:00", prospect="Manchester Transport Group", mission="Logistics — Manchester", window="09:00–17:30", status="queued"),
            ScheduleItem(id="s8", day="Mon, 31 Aug", time="10:00", prospect="Coventry Precision Ltd", mission="Q3 warm leads", window="09:00–17:30", status="queued", honored=True, honored_quote="Call me back next week, Monday morning if you can."),
        ]
        db.add_all(schedules)
        
        # 12. Notifications
        notifs = [
            Notification(id="n1", text="Meeting booked — Acme Logistics Ltd, Thu 2:00 PM", time="10m ago", unread=True, type="success"),
            Notification(id="n2", text="Pennine Distribution needs staff input — pricing question", time="24m ago", unread=True, type="alert"),
            Notification(id="n3", text="Speedy Haulage marked do-not-call", time="1h ago", unread=True, type="info"),
        ]
        db.add_all(notifs)
        
        await db.commit()
        print("Initial seed data successfully committed!")

if __name__ == "__main__":
    asyncio.run(seed_database())
