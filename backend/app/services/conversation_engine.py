"""
Adaptive Conversation Engine & Template System
Provides:
1. Multi-scenario Call Context Resolver (Outbound Campaigns, Direct Single Calls, Inbound Reception).
2. Dynamic Prompt Builder & Safe Template Rendering.
3. Out-of-the-box Base Default Template auto-seeder.
4. Localized date/time & timezone awareness.
"""

import logging
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional
import zoneinfo

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.models.models import (
    CompanyProfile,
    ConversationTemplate,
    ConversationVariable,
    Mission,
    Prospect,
)
from app.services.timezone_and_phone_utils import (
    normalize_smart_phone,
    validate_and_normalize_timezone,
)

logger = logging.getLogger("conversation_engine")

BASE_OUTBOUND_TEMPLATE_ID = "tpl_base_outbound_demo"
BASE_INBOUND_TEMPLATE_ID = "tpl_base_inbound_reception"


# --------------------------------------------------------------------------- #
# 1. Base Default Templates Definitions
# --------------------------------------------------------------------------- #
DEFAULT_OUTBOUND_TEMPLATE = {
    "id": BASE_OUTBOUND_TEMPLATE_ID,
    "org_id": "org_default",
    "name": "Base Outbound Sales & Demo Booking",
    "description": "Adaptive 7-step outbound prospecting flow with permission check & 4 objection handlers.",
    "call_direction": "outbound",
    "mission_type": "demo",
    "greeting_template": (
        "Hi {{prospect.name}}, this is {{company.agent_name}} from {{company.name}}. "
        "I'm reaching out regarding {{mission.context_hook}}. Did I catch you at an okay time for a quick chat?"
    ),
    "permission_check_template": (
        "Is now a good time for a quick 60 seconds, or did I catch you in the middle of something?"
    ),
    "value_prop_template": (
        "We help {{prospect.industry_phrase}} {{mission.value_prop}}. "
        "Typically teams save about {{variables.time_savings}}. "
        "Would you be open to a brief 15-minute walkthrough to see how it works?"
    ),
    "objection_responses": {
        "no_time": "That's exactly why I'm calling. Our clients save {{variables.time_savings}} every week. 15 minutes now will save hours down the road.",
        "not_interested": "Totally understand. Before I let you go — what are you currently using for {{mission.category}}? [Acknowledge] Makes sense. Would it help if I emailed you a 1-page case study?",
        "send_info": "Happy to! Before I do, what's your biggest priority with {{mission.pain_point}} right now? [Listen] Perfect. While I have you, would next week Tuesday or Thursday work for a brief 15-minute chat?",
        "already_have_solution": "Great to hear! Who are you currently using? [Listen] Many of our clients use that alongside us for {{mission.specific_benefit}}. Worth a quick comparison?"
    },
    "booking_transition_template": (
        "Let me check my calendar. Are you generally more open earlier in the week or toward the end? Morning or afternoon?"
    ),
    "confirmation_template": (
        "Perfect! I have your email as {{prospect.email}} — is that the best address for the calendar invite?"
    ),
    "closing_template": (
        "All set! You're booked for {{booking.day_and_time}}. "
        "You'll see the invite in your inbox shortly. Looking forward to speaking with you!"
    ),
    "flow_steps": [
        "greeting",
        "permission_check",
        "value_prop",
        "handle_objections",
        "booking_transition",
        "slot_checking",
        "email_confirmation",
        "book_and_close"
    ],
    "max_objection_attempts": 3,
    "agent_persona": "Professional, articulate, warm, and respectful of caller's time",
    "tone_instructions": "Keep all spoken responses concise (1-2 sentences maximum). Speak naturally. Never sound robotic.",
    "is_active": True,
    "is_default": True
}

DEFAULT_INBOUND_TEMPLATE = {
    "id": BASE_INBOUND_TEMPLATE_ID,
    "org_id": "org_default",
    "name": "Base Inbound Reception & Scheduling",
    "description": "Professional receptionist flow: answers questions, discovers needs, and schedules meetings.",
    "call_direction": "inbound",
    "mission_type": "reception",
    "greeting_template": (
        "Thanks for calling {{company.name}}! This is {{company.agent_name}}. How can I help you today?"
    ),
    "permission_check_template": "",
    "value_prop_template": (
        "We'd love to show you how we can help. Would you like to set up a quick meeting with our team?"
    ),
    "objection_responses": {
        "pricing_inquiry": "Pricing depends on your exact setup. I can book a quick 15-minute discovery call with our specialist to give you an accurate quote.",
        "just_browsing": "No problem! We specialize in {{company.services_summary}}. What specific question can I answer for you?"
    },
    "booking_transition_template": (
        "Let's get a time scheduled. What day generally suits you best this week?"
    ),
    "confirmation_template": (
        "Great! What is the best email address for the calendar confirmation?"
    ),
    "closing_template": (
        "All confirmed! You're booked for {{booking.day_and_time}}. "
        "I've sent the confirmation to your email. Have a wonderful day!"
    ),
    "flow_steps": [
        "greeting",
        "discovery",
        "value_prop",
        "booking_transition",
        "slot_checking",
        "email_confirmation",
        "book_and_close"
    ],
    "max_objection_attempts": 2,
    "agent_persona": "Welcoming, attentive, and helpful receptionist",
    "tone_instructions": "Listen carefully, answer questions from business knowledge, and transition smoothly to booking.",
    "is_active": True,
    "is_default": True
}


# --------------------------------------------------------------------------- #
# 2. Context Resolver
# --------------------------------------------------------------------------- #
class CallContextResolver:
    """
    Resolves multi-scenario lead data:
    1. Full Data (Name + Phone + Email + Company + Mission)
    2. Partial Data (Name + Phone, No Email)
    3. Direct Quick Dial (Phone + Optional Name)
    4. Inbound Reception (Unknown or matched Caller ID)
    """

    @staticmethod
    async def resolve_outbound(
        db: AsyncSession,
        prospect_id: Optional[str] = None,
        mission_id: Optional[str] = None,
        override_phone: Optional[str] = None,
        override_name: Optional[str] = None,
        override_email: Optional[str] = None,
        override_company: Optional[str] = None,
    ) -> Dict[str, Any]:
        prospect: Optional[Prospect] = None
        if prospect_id:
            res = await db.execute(select(Prospect).where(Prospect.id == prospect_id))
            prospect = res.scalars().first()

        mission: Optional[Mission] = None
        if mission_id:
            m_res = await db.execute(select(Mission).where(Mission.id == mission_id))
            mission = m_res.scalars().first()

        prof_res = await db.execute(select(CompanyProfile).where(CompanyProfile.id == "default"))
        company = prof_res.scalars().first()

        # Company metadata
        comp_name = getattr(company, "name", None) or getattr(company, "spoken_name", None) or "AIVHub"
        comp_agent = getattr(company, "caller_name", None) or "Sam"
        comp_industry = getattr(company, "industry", None) or "Technology & AI Services"
        comp_pitch = getattr(company, "pitch", None) or "AI-powered voice automation and business consulting"
        comp_tz = validate_and_normalize_timezone(getattr(company, "timezone", None), "Europe/London")
        calendar_mode = getattr(company, "calendar_mode", None) or "internal"

        # Prospect metadata resolution
        p_name = (override_name or (prospect.name if prospect else "") or "").strip()
        p_phone = (override_phone or (prospect.phone if prospect else "") or "").strip()
        p_email = (override_email or (prospect.email if prospect else "") or "").strip()
        p_company = (override_company or (prospect.company if prospect else "") or "").strip()
        p_tz_raw = prospect.timezone if prospect else None
        p_tz = validate_and_normalize_timezone(p_tz_raw, comp_tz)

        norm_phone, country_code = normalize_smart_phone(p_phone)

        # Localized temporal context in target prospect timezone
        try:
            today_dt = datetime.now(zoneinfo.ZoneInfo(p_tz))
        except Exception:
            today_dt = datetime.utcnow()

        today_str = today_dt.strftime("%A, %B %d, %Y")
        today_iso = today_dt.strftime("%Y-%m-%d")
        tomorrow_str = (today_dt + timedelta(days=1)).strftime("%A, %B %d")

        # Industry phrase formatting
        industry_phrase = f"companies in {p_company}" if p_company else "businesses like yours"

        # Mission metadata
        mission_name = mission.name if mission else "Product Walkthrough"
        mission_hook = getattr(mission, "description", None) or f"our conversation about {comp_name}"
        mission_value = getattr(mission, "pitch", None) or comp_pitch
        mission_pain = "scheduling and outbound workflow"
        mission_category = "voice and operations automation"
        mission_benefit = "real-time booking and lead qualification"

        return {
            "direction": "outbound",
            "call_type": "outbound_prospecting",
            "has_known_name": bool(p_name),
            "has_known_email": bool(p_email),
            "has_known_company": bool(p_company),
            "prospect": {
                "id": prospect.id if prospect else None,
                "name": p_name,
                "phone": norm_phone or p_phone,
                "email": p_email,
                "company": p_company,
                "timezone": p_tz,
                "timezone_short": today_dt.strftime("%Z") or "Local Time",
                "industry_phrase": industry_phrase,
            },
            "mission": {
                "id": mission.id if mission else None,
                "name": mission_name,
                "context_hook": mission_hook,
                "value_prop": mission_value,
                "pain_point": mission_pain,
                "category": mission_category,
                "specific_benefit": mission_benefit,
            },
            "company": {
                "name": comp_name,
                "agent_name": comp_agent,
                "industry": comp_industry,
                "pitch": comp_pitch,
                "timezone": comp_tz,
                "calendar_mode": calendar_mode,
            },
            "temporal_context": {
                "today": today_str,
                "today_iso": today_iso,
                "tomorrow": tomorrow_str,
                "timezone": p_tz,
            },
            "variables": {
                "time_savings": "5+ hours per week",
                "similar_client": "operations and sales teams",
            }
        }

    @staticmethod
    async def resolve_inbound(
        db: AsyncSession,
        caller_phone: str,
        call_sid: Optional[str] = None
    ) -> Dict[str, Any]:
        norm_phone, country_code = normalize_smart_phone(caller_phone)

        # Match caller against existing database
        prospect: Optional[Prospect] = None
        if norm_phone:
            res = await db.execute(
                select(Prospect).where(
                    (Prospect.phone == norm_phone)
                    | (Prospect.phone.ilike(f"%{caller_phone.lstrip('+')}%"))
                )
            )
            prospect = res.scalars().first()

        prof_res = await db.execute(select(CompanyProfile).where(CompanyProfile.id == "default"))
        company = prof_res.scalars().first()

        comp_name = getattr(company, "name", None) or "AIVHub"
        comp_agent = getattr(company, "caller_name", None) or "Sam"
        comp_tz = validate_and_normalize_timezone(getattr(company, "timezone", None), "Europe/London")
        calendar_mode = getattr(company, "calendar_mode", None) or "internal"

        try:
            today_dt = datetime.now(zoneinfo.ZoneInfo(comp_tz))
        except Exception:
            today_dt = datetime.utcnow()

        today_str = today_dt.strftime("%A, %B %d, %Y")
        today_iso = today_dt.strftime("%Y-%m-%d")

        p_name = prospect.name if prospect else ""
        p_email = prospect.email if prospect else ""

        return {
            "direction": "inbound",
            "call_type": "inbound_reception",
            "has_known_name": bool(p_name),
            "has_known_email": bool(p_email),
            "caller": {
                "phone": norm_phone or caller_phone,
                "name": p_name,
                "email": p_email,
                "is_existing_client": bool(prospect),
            },
            "prospect": {
                "id": prospect.id if prospect else None,
                "name": p_name,
                "email": p_email,
                "phone": norm_phone or caller_phone,
                "timezone": comp_tz,
                "timezone_short": today_dt.strftime("%Z") or "Local Time",
            },
            "company": {
                "name": comp_name,
                "agent_name": comp_agent,
                "industry": getattr(company, "industry", None) or "Technology & Consulting",
                "pitch": getattr(company, "pitch", None) or "Enterprise Voice AI & Solutions",
                "services_summary": getattr(company, "pitch", None) or "automated appointment scheduling and workflow intelligence",
                "timezone": comp_tz,
                "calendar_mode": calendar_mode,
            },
            "temporal_context": {
                "today": today_str,
                "today_iso": today_iso,
                "timezone": comp_tz,
            },
            "variables": {
                "time_savings": "5+ hours per week",
            }
        }


# --------------------------------------------------------------------------- #
# 3. Template Engine & Safe Renderer
# --------------------------------------------------------------------------- #
class ConversationTemplateEngine:
    """
    Compiles dynamic conversation templates into production LLM system prompts.
    Handles variable interpolation safely without crashing on missing fields or Jinja syntax.
    """

    @staticmethod
    async def ensure_default_templates(db: AsyncSession) -> None:
        """Auto-seeds default templates in PostgreSQL if missing."""
        try:
            out_res = await db.execute(
                select(ConversationTemplate).where(ConversationTemplate.id == BASE_OUTBOUND_TEMPLATE_ID)
            )
            if not out_res.scalars().first():
                t_out = ConversationTemplate(**DEFAULT_OUTBOUND_TEMPLATE)
                db.add(t_out)

            in_res = await db.execute(
                select(ConversationTemplate).where(ConversationTemplate.id == BASE_INBOUND_TEMPLATE_ID)
            )
            if not in_res.scalars().first():
                t_in = ConversationTemplate(**DEFAULT_INBOUND_TEMPLATE)
                db.add(t_in)

            await db.commit()
        except Exception as e:
            try:
                await db.rollback()
            except Exception:
                pass
            logger.debug(f"[CONV-ENGINE] Template seeding notice: {e}")

    @staticmethod
    async def get_active_template(
        db: AsyncSession,
        direction: str = "outbound",
        template_id: Optional[str] = None
    ) -> ConversationTemplate:
        """Retrieves active template from DB or fallback default."""
        await ConversationTemplateEngine.ensure_default_templates(db)

        if template_id:
            res = await db.execute(
                select(ConversationTemplate).where(ConversationTemplate.id == template_id)
            )
            t = res.scalars().first()
            if t:
                return t

        # Query default active template for this direction
        query = select(ConversationTemplate).where(
            (ConversationTemplate.call_direction == direction)
            & (ConversationTemplate.is_active == True)
        ).order_by(ConversationTemplate.is_default.desc(), ConversationTemplate.created_at.desc())

        res = await db.execute(query.limit(1))
        t = res.scalars().first()
        if t:
            return t

        # Fallback to in-memory object
        defaults = DEFAULT_OUTBOUND_TEMPLATE if direction == "outbound" else DEFAULT_INBOUND_TEMPLATE
        return ConversationTemplate(**defaults)

    @staticmethod
    def _safe_substitute(template_str: Optional[str], context: Dict[str, Any]) -> str:
        """Replaces {{a.b}} and {{a_b}} placeholders safely without Jinja2 syntax crashes."""
        if not template_str:
            return ""

        text = str(template_str)
        # Flat replacements
        prospect = context.get("prospect") or {}
        company = context.get("company") or {}
        mission = context.get("mission") or {}
        temporal = context.get("temporal_context") or {}
        variables = context.get("variables") or {}

        replacements = {
            # Dotted notation
            "{{prospect.name}}": prospect.get("name") or "there",
            "{{prospect.company}}": prospect.get("company") or "your company",
            "{{prospect.email}}": prospect.get("email") or "your email address",
            "{{prospect.phone}}": prospect.get("phone") or "",
            "{{prospect.timezone_short}}": prospect.get("timezone_short") or "Local Time",
            "{{prospect.industry_phrase}}": prospect.get("industry_phrase") or "companies like yours",
            "{{company.name}}": company.get("name") or "AIVHub",
            "{{company.agent_name}}": company.get("agent_name") or "Sam",
            "{{company.industry}}": company.get("industry") or "Technology & AI Consulting",
            "{{company.pitch}}": company.get("pitch") or "AI voice automation",
            "{{company.services_summary}}": company.get("services_summary") or "AI scheduling and CRM automation",
            "{{mission.name}}": mission.get("name") or "Product Demo",
            "{{mission.context_hook}}": mission.get("context_hook") or "our recent outreach",
            "{{mission.value_prop}}": mission.get("value_prop") or "save 5+ hours weekly",
            "{{mission.category}}": mission.get("category") or "operations automation",
            "{{mission.pain_point}}": mission.get("pain_point") or "lead scheduling",
            "{{mission.specific_benefit}}": mission.get("specific_benefit") or "instant calendar booking",
            "{{variables.time_savings}}": variables.get("time_savings") or "5+ hours per week",
            "{{temporal.today}}": temporal.get("today") or "today",
            "{{temporal.tomorrow}}": temporal.get("tomorrow") or "tomorrow",
            "{{booking.day_and_time}}": "[chosen appointment time]",

            # Underscore / flat notation (UI template tags)
            "{{prospect_name}}": prospect.get("name") or "there",
            "{{company_name}}": company.get("name") or "AIVHub",
            "{{caller_name}}": company.get("agent_name") or "Sam",
            "{{agent_name}}": company.get("agent_name") or "Sam",
            "{{prospect_company}}": prospect.get("company") or "your company",
            "{{prospect_email}}": prospect.get("email") or "your email address",
            "{{prospect_phone}}": prospect.get("phone") or "",
            "{{timezone}}": prospect.get("timezone") or temporal.get("timezone") or "Europe/London",
            "{{meeting_time}}": "[chosen appointment time]",
            "{{value_prop}}": mission.get("value_prop") or company.get("pitch") or "automate 80% of repetitive booking",
            "{{industry_phrase}}": prospect.get("industry_phrase") or "companies like yours",
            "{{today}}": temporal.get("today") or "today",
            "{{tomorrow}}": temporal.get("tomorrow") or "tomorrow",
        }

        # Inject dynamic custom variables if present
        if isinstance(variables, dict):
            for k, v in variables.items():
                replacements[f"{{{{{k}}}}}"] = str(v)
                replacements[f"{{{{variables.{k}}}}}"] = str(v)

        for placeholder, val in replacements.items():
            text = text.replace(placeholder, str(val))

        return text

    @staticmethod
    def render_initial_greeting(template: Any, context: Dict[str, Any]) -> str:
        """Renders the spoken opening hook / greeting line."""
        raw = getattr(template, "greeting_template", None)
        if not raw and isinstance(template, dict):
            raw = template.get("greeting_template")
        return ConversationTemplateEngine._safe_substitute(raw or "", context)

    @staticmethod
    def render_system_prompt(template: ConversationTemplate, context: Dict[str, Any]) -> str:
        """
        Assembles the complete, battle-tested system prompt for the voice LLM.
        """
        direction = context.get("direction", "outbound")
        prospect = context.get("prospect") or {}
        company = context.get("company") or {}
        mission = context.get("mission") or {}
        temporal = context.get("temporal_context") or {}

        comp_name = company.get("name") or "AIVHub"
        agent_name = company.get("agent_name") or "Sam"
        p_name = prospect.get("name") or "the prospect"
        p_email = prospect.get("email") or ""
        p_tz = prospect.get("timezone") or temporal.get("timezone") or "Europe/London"

        today_str = temporal.get("today") or datetime.utcnow().strftime("%A, %B %d, %Y")
        today_iso = temporal.get("today_iso") or datetime.utcnow().strftime("%Y-%m-%d")

        # Greeting & Section Rendering
        rendered_greeting = ConversationTemplateEngine._safe_substitute(template.greeting_template, context)
        rendered_perm = ConversationTemplateEngine._safe_substitute(template.permission_check_template, context)
        rendered_pitch = ConversationTemplateEngine._safe_substitute(template.value_prop_template, context)
        rendered_transition = ConversationTemplateEngine._safe_substitute(template.booking_transition_template, context)
        rendered_confirm = ConversationTemplateEngine._safe_substitute(template.confirmation_template, context)
        rendered_close = ConversationTemplateEngine._safe_substitute(template.closing_template, context)

        # Objection rendering
        objections = template.objection_responses if isinstance(template.objection_responses, dict) else {}
        obj_blocks = []
        for obj_key, obj_resp in objections.items():
            sub_resp = ConversationTemplateEngine._safe_substitute(obj_resp, context)
            obj_blocks.append(f"• **If they say '{obj_key.replace('_', ' ')}'**: \"{sub_resp}\"")
        objections_text = "\n".join(obj_blocks) if obj_blocks else "• If they object, acknowledge respectfully and offer a brief follow-up."

        if direction == "outbound":
            lead_knowledge_block = f"""
LEAD ON FILE:
- Name: {p_name if prospect.get('name') else 'Not on file (ask politely if needed)'}
- Phone: {prospect.get('phone')}
- Email: {p_email if p_email else 'Not on file (must collect & spell back during booking)'}
- Timezone: {p_tz}
"""
            email_rule = (
                f"- Confirm the email on file ({p_email}) before finalizing the booking."
                if p_email else
                "- Email is NOT on file: collect their email address and spell it back before booking."
            )

            prompt = f"""You are {agent_name}, a friendly, professional voice representative calling on behalf of {comp_name}.

TODAY'S CALENDAR CONTEXT:
- Today is {today_str}.
- Target Timezone: {p_tz}. Use this timezone for all scheduling.
- Today's date code: {today_iso}.

{lead_knowledge_block}

OUTBOUND CONVERSATIONAL FLOW (7 STEPS):
1. **Greeting & Identity**: Say: "{rendered_greeting}"
2. **Permission Check**: If they ask or hesitate, say: "{rendered_perm}" (If busy, offer a callback or email).
3. **Value Pitch (15s Max)**: Say: "{rendered_pitch}"
4. **Objection Handling (Max {template.max_objection_attempts} turns)**:
{objections_text}
5. **Meeting Transition**: Say: "{rendered_transition}"
6. **Live Slot Checking**:
   - When caller mentions a day (e.g. 'tomorrow afternoon' or 'Friday'), immediately call `check_availability(start_date=YYYY-MM-DD, end_date=YYYY-MM-DD)`.
   - Read back 2-3 open times naturally (e.g. "I have Friday at 10:30 AM or 2:00 PM Eastern").
   - If no slots are open, offer the next closest available day.
7. **Confirmation & Booking**:
   {email_rule}
   - Call `book_appointment(start_time=EXACT_TIMESTAMP)`.
   - Say: "{rendered_close}"

CORE CALLING RULES:
❌ DO NOT ask for information you already have on file.
❌ DO NOT read robotic lists or mention tool names or APIs.
❌ DO NOT guess timestamps: pass the exact ISO-8601 string returned by check_availability.
✅ Keep every spoken turn short (1 to 2 sentences max) so the caller can speak naturally.
✅ Be warm, helpful, and respectful of their time.
"""
        else:
            prompt = f"""You are {agent_name}, the welcoming receptionist for {comp_name}.

TODAY'S CALENDAR CONTEXT:
- Today is {today_str}.
- Business Timezone: {p_tz}.
- Today's date code: {today_iso}.

INBOUND RECEPTION FLOW (7 STEPS):
1. **Greeting**: Say: "{rendered_greeting}"
2. **Discovery**: Listen to the caller's request. Answer questions about services or pricing from business facts.
3. **Value Proposition**: Say: "{rendered_pitch}"
4. **Meeting Transition**: Say: "{rendered_transition}"
5. **Live Slot Checking**:
   - When they state a day preference, call `check_availability(start_date=YYYY-MM-DD, end_date=YYYY-MM-DD)`.
   - Offer 2-3 specific times.
6. **Caller Details**:
   - Ask for their full name.
   - Ask for their email address and spell it back to ensure 100% accuracy.
7. **Booking & Close**:
   - Call `book_appointment(start_time=EXACT_TIMESTAMP, attendee_name=..., attendee_email=...)`.
   - Say: "{rendered_close}"

CORE RULES:
✅ Keep responses concise and friendly.
✅ Spell back emails for clarity.
✅ Use exact ISO-8601 timestamps returned by availability check.
"""
        policy_booking = context.get("policy_booking_instructions")
        policy_hangup = context.get("policy_hangup_instructions")
        if policy_booking:
            prompt += f"\n\nBUSINESS-SPECIFIC BOOKING RULES (these override the generic steps above where they conflict):\n{policy_booking}"
        if policy_hangup:
            prompt += f"\n\nWRAP-UP & HANG-UP RULES:\n{policy_hangup}"

        custom_rules = (getattr(template, "custom_rules", None) or "").strip()
        if custom_rules:
            rendered_rules = ConversationTemplateEngine._safe_substitute(custom_rules, context)
            prompt += f"\n\nMASTER BUSINESS RULES & OBJECTION HANDLING (MANDATORY):\n{rendered_rules}"

        demo_script = (getattr(template, "demo_script", None) or "").strip()
        if demo_script:
            rendered_demo = ConversationTemplateEngine._safe_substitute(demo_script, context)
            prompt += (
                "\n\nDEMO CONVERSATION BLUEPRINT (IDEAL FLOW & TONE):\n"
                f"Mimic the natural cadence, warmth, brevity, and emotional tone of this sample dialogue:\n{rendered_demo}"
            )

        return prompt.strip()


# Singleton instances
context_resolver = CallContextResolver()
template_engine = ConversationTemplateEngine()
