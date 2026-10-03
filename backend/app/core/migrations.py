"""Numbered schema/data steps that run once each, in order, at startup.

Base.metadata.create_all creates new tables; these steps change existing ones (new columns,
data fixes). Each step is recorded in schema_migrations and never runs again. Steps only add:
no drops or renames while running code may still use the old shape.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Awaitable, Callable, List, Tuple

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

logger = logging.getLogger("migrations")

Step = Callable[[AsyncConnection], Awaitable[None]]


async def _operators_auth_columns(conn: AsyncConnection) -> None:
    for col, typ in (
        ("is_active", "BOOLEAN DEFAULT TRUE"),
        ("must_change_password", "BOOLEAN DEFAULT FALSE"),
        ("password_changed_at", "TIMESTAMP"),
        ("last_login_at", "TIMESTAMP"),
    ):
        await conn.execute(text(f"ALTER TABLE operators ADD COLUMN IF NOT EXISTS {col} {typ}"))
    await conn.execute(text("UPDATE operators SET is_active = TRUE WHERE is_active IS NULL"))
    await conn.execute(text("UPDATE operators SET must_change_password = FALSE WHERE must_change_password IS NULL"))


async def _hash_plain_passwords(conn: AsyncConnection) -> None:
    """No password stays in plain text. Weak old defaults must be changed at next sign-in."""
    from app.core.security import hash_password, is_hashed, is_weak_legacy

    rows = (await conn.execute(text("SELECT id, hashed_password FROM operators"))).all()
    for op_id, stored in rows:
        if is_hashed(stored):
            continue
        weak = is_weak_legacy(stored)
        await conn.execute(
            text("UPDATE operators SET hashed_password = :h, must_change_password = :m WHERE id = :i"),
            {"h": hash_password(stored or "password"), "m": bool(weak), "i": op_id},
        )
    if rows:
        logger.info("Hashed any plain-text operator passwords.")


async def _system_roles(conn: AsyncConnection) -> None:
    """Starter roles for the default organisation and a role for every existing user."""
    from app.core.permissions import SYSTEM_ROLES
    import json

    now = datetime.utcnow()
    ids = {}
    for name, spec in SYSTEM_ROLES.items():
        role_id = f"role_default_{name.lower()}"
        ids[name] = role_id
        await conn.execute(
            text(
                "INSERT INTO roles (id, org_id, name, description, is_admin, is_system, levels, created_at, updated_at) "
                "VALUES (:id, 'org_default', :name, :d, :a, TRUE, CAST(:lv AS JSON), :now, :now) "
                "ON CONFLICT (id) DO NOTHING"
            ),
            {"id": role_id, "name": name, "d": spec["description"], "a": spec["is_admin"], "lv": json.dumps(spec["levels"]), "now": now},
        )
    ops = (await conn.execute(text("SELECT id, role FROM operators"))).all()
    for op_id, role in ops:
        name = (role or "").strip().title()
        role_id = ids.get(name) or ids["Operator"]
        await conn.execute(
            text("INSERT INTO operator_roles (operator_id, role_id) VALUES (:o, :r) ON CONFLICT DO NOTHING"),
            {"o": op_id, "r": role_id},
        )


async def _meeting_lunch_columns(conn: AsyncConnection) -> None:
    await conn.execute(text("ALTER TABLE calcom_settings ADD COLUMN IF NOT EXISTS lunch_start VARCHAR DEFAULT '12:00'"))
    await conn.execute(text("ALTER TABLE calcom_settings ADD COLUMN IF NOT EXISTS lunch_end VARCHAR DEFAULT '13:00'"))


async def _operator_profile_columns(conn: AsyncConnection) -> None:
    await conn.execute(text("ALTER TABLE operators ADD COLUMN IF NOT EXISTS notify_prefs JSON"))
    await conn.execute(text("ALTER TABLE operators ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE"))
    await conn.execute(text("ALTER TABLE operators ADD COLUMN IF NOT EXISTS google_sub VARCHAR"))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_operators_google_sub ON operators (google_sub)"))


async def _credit_wallets(conn: AsyncConnection) -> None:
    """Credits move to per-plugin wallets. Each organisation's existing positive balance becomes
    one never-expiring batch in its Voice wallet, so nobody loses credits."""
    import uuid as _uuid

    await conn.execute(text("ALTER TABLE credit_ledger ADD COLUMN IF NOT EXISTS wallet VARCHAR DEFAULT 'voice'"))
    await conn.execute(text("UPDATE credit_ledger SET wallet = 'voice' WHERE wallet IS NULL"))
    rows = (await conn.execute(text("SELECT org_id, COALESCE(SUM(amount), 0) FROM credit_ledger GROUP BY org_id"))).all()
    for org_id, total in rows:
        if total and total > 0:
            await conn.execute(text(
                "INSERT INTO credit_grants (id, org_id, wallet, source, amount, remaining, expires_at, ref, note, created_at) "
                "VALUES (:id, :o, 'voice', 'grant', :a, :a, NULL, 'migration', 'Balance before wallets', now())"
            ), {"id": f"cg_{_uuid.uuid4().hex[:14]}", "o": org_id, "a": int(total)})


async def _billing_plan_currency(conn: AsyncConnection) -> None:
    await conn.execute(text("ALTER TABLE billing_plans ADD COLUMN IF NOT EXISTS currency VARCHAR DEFAULT 'usd'"))


async def _payg_columns(conn: AsyncConnection) -> None:
    """Telnyx pay-as-you-go: each organisation's own outbound app; what was paid for each batch."""
    await conn.execute(text("ALTER TABLE org_telnyx ADD COLUMN IF NOT EXISTS outbound_connection_id VARCHAR DEFAULT ''"))
    await conn.execute(text("ALTER TABLE credit_grants ADD COLUMN IF NOT EXISTS paid_cents INTEGER DEFAULT 0"))
    await conn.execute(text("ALTER TABLE credit_grants ADD COLUMN IF NOT EXISTS paid_currency VARCHAR DEFAULT ''"))


async def _agent_studio(conn: AsyncConnection) -> None:
    """Agent Studio: a user's own phone, company call rules, a script per campaign, and each
    managed assistant's voice and model."""
    await conn.execute(text("ALTER TABLE operators ADD COLUMN IF NOT EXISTS phone VARCHAR DEFAULT ''"))
    await conn.execute(text("ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS studio JSON"))
    await conn.execute(text("ALTER TABLE missions ADD COLUMN IF NOT EXISTS template_id VARCHAR DEFAULT ''"))
    await conn.execute(text("ALTER TABLE voice_assistants ADD COLUMN IF NOT EXISTS voice VARCHAR DEFAULT ''"))
    await conn.execute(text("ALTER TABLE voice_assistants ADD COLUMN IF NOT EXISTS model VARCHAR DEFAULT ''"))


async def _call_takeover(conn: AsyncConnection) -> None:
    await conn.execute(text("ALTER TABLE call_briefs ADD COLUMN IF NOT EXISTS supervisor_leg VARCHAR DEFAULT ''"))
    await conn.execute(text("ALTER TABLE call_briefs ADD COLUMN IF NOT EXISTS supervisor_id VARCHAR DEFAULT ''"))


async def _platform_split(conn: AsyncConnection) -> None:
    from app.core.platform import split_platform

    await split_platform(conn)


async def _ai_keys_owner_only(conn: AsyncConnection) -> None:
    """AI keys belong to OutReach only. Aivhub's AI keys move to the platform record (unless the
    platform already has one by that name); every other company's own AI keys are switched off
    (kept, never used: the AI resolvers read the platform record only)."""
    from app.core.platform import AIVHUB_ORG, platform_org_id

    platform = platform_org_id()
    if platform != AIVHUB_ORG:
        await conn.execute(text(
            "UPDATE connections SET org_id = :p WHERE org_id = :a AND group_name IN ('LLM', 'IMAGE') "
            "AND lower(name) NOT IN (SELECT lower(name) FROM connections WHERE org_id = :p AND group_name IN ('LLM', 'IMAGE'))"),
            {"p": platform, "a": AIVHUB_ORG})
    off = await conn.execute(text(
        "UPDATE connections SET status = 'disabled_by_platform' "
        "WHERE org_id <> :p AND group_name IN ('LLM', 'IMAGE') AND coalesce(status, '') <> 'disabled_by_platform'"),
        {"p": platform})


# Plans 2026_10_10 used to seed, on the same Stripe prices as the plans linked from Stripe.
_SEEDED_PLANS = ["plan_voice_starter", "plan_voice_growth", "topup_voice_1hr", "plan_social_starter",
                 "plan_social_growth", "plan_lead_starter", "plan_lead_growth"]


async def _remove_seeded_billing_plans(conn: AsyncConnection) -> None:
    """Plans are linked from Stripe in the billing screen. The seeded copies sat beside them on the
    same Stripe prices with other credits, so a payment could grant either amount. A subscriber on
    a seeded plan moves to the linked plan with the same price; with none, theirs stays, off sale."""
    import json

    twin = dict((await conn.execute(text(
        "SELECT s.id, (SELECT o.id FROM billing_plans o WHERE o.stripe_price_id = s.stripe_price_id "
        "AND o.id <> ALL(:seeded) ORDER BY o.created_at LIMIT 1) FROM billing_plans s WHERE s.id = ANY(:seeded)"),
        {"seeded": _SEEDED_PLANS})).all())
    held = set()
    for sub_id, raw in (await conn.execute(text("SELECT id, CAST(plans AS TEXT) FROM billing_subscriptions"))).all():
        plans = json.loads(raw or "null") or {}
        moved = {w: twin.get(i) or i for w, i in plans.items()}
        held.update(moved.values())
        if moved != plans:
            await conn.execute(text("UPDATE billing_subscriptions SET plans = CAST(:p AS JSON) WHERE id = :i"),
                               {"p": json.dumps(moved), "i": sub_id})
    for plan_id in twin:
        if plan_id in held:
            await conn.execute(text("UPDATE billing_plans SET active = FALSE WHERE id = :i"), {"i": plan_id})
        else:
            await conn.execute(text("DELETE FROM billing_plans WHERE id = :i"), {"i": plan_id})


async def _merge_leadgen_email_wallets(conn: AsyncConnection) -> None:
    """Merge Leadgen + Email into one wallet 'leadgen' and add cross-reference FK columns."""
    import json

    # 1. Add auto_enroll_campaign_id to missions and mission_id to email_campaigns
    await conn.execute(text("ALTER TABLE missions ADD COLUMN IF NOT EXISTS auto_enroll_campaign_id VARCHAR"))
    await conn.execute(text("ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS mission_id VARCHAR"))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_missions_auto_enroll_campaign_id ON missions (auto_enroll_campaign_id)"))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_email_campaigns_mission_id ON email_campaigns (mission_id)"))

    # 2. Update credit_ledger, credit_grants, billing_plans from 'email' to 'leadgen'
    await conn.execute(text("UPDATE credit_ledger SET wallet = 'leadgen' WHERE wallet = 'email'"))
    await conn.execute(text("UPDATE credit_grants SET wallet = 'leadgen' WHERE wallet = 'email'"))
    await conn.execute(text("UPDATE billing_plans SET wallet = 'leadgen' WHERE wallet = 'email'"))

    # 3. Consolidate BillingSubscription.plans JSON. Let failures propagate (same as every
    # other step) so run_migrations does NOT record this step as done and retries it on the
    # next startup instead of silently leaving an org's subscription half-migrated.
    subs = (await conn.execute(text("SELECT id, org_id, plans FROM billing_subscriptions"))).all()
    for sub_id, org_id, raw_plans in subs:
        if not raw_plans:
            continue
        plans_dict = raw_plans if isinstance(raw_plans, dict) else json.loads(raw_plans or "{}")
        if "email" in plans_dict:
            email_plan = plans_dict.pop("email")
            if "leadgen" not in plans_dict:
                plans_dict["leadgen"] = email_plan
            logger.info(f"[migrations] Consolidated subscription {sub_id} for org {org_id} from email to leadgen: {plans_dict}")
            await conn.execute(
                text("UPDATE billing_subscriptions SET plans = CAST(:p AS JSON) WHERE id = :i"),
                {"p": json.dumps(plans_dict), "i": sub_id}
            )

    # 4. Consolidate the per-org overdraft "debt" JSON. org_settings isn't its own table --
    # it's an app_settings row keyed "credits:<org_id>" whose data JSON has a "debt" field
    # (see credits.py org_settings()/_settings_id()). Move debt["email"] -> debt["leadgen"]
    # so pre-existing email-wallet debt isn't silently forgiven by the wallet rename.
    settings_rows = (await conn.execute(
        text("SELECT id, data FROM app_settings WHERE id LIKE 'credits:%'")
    )).all()
    for row_id, raw_data in settings_rows:
        if not raw_data:
            continue
        data_dict = raw_data if isinstance(raw_data, dict) else json.loads(raw_data or "{}")
        debt_dict = dict(data_dict.get("debt") or {})
        if "email" in debt_dict:
            email_debt = debt_dict.pop("email", 0) or 0
            debt_dict["leadgen"] = (debt_dict.get("leadgen", 0) or 0) + email_debt
            data_dict["debt"] = debt_dict
            await conn.execute(
                text("UPDATE app_settings SET data = CAST(:d AS JSON) WHERE id = :i"),
                {"d": json.dumps(data_dict), "i": row_id}
            )


async def _phone_rental_due(conn: AsyncConnection) -> None:
    await conn.execute(text("ALTER TABLE org_phone_numbers ADD COLUMN IF NOT EXISTS rent_due_at TIMESTAMP"))
    await conn.execute(text("UPDATE org_phone_numbers SET rent_due_at = created_at + interval '30 days' WHERE rent_due_at IS NULL AND status = 'active'"))


async def _split_shared_provider_keys_per_plugin(conn: AsyncConnection) -> None:
    """Each plugin (Voice, Leadgen, Post Scheduler) gets its own independent LLM key instead of
    all three sharing one "LLM" pool; Post Scheduler also gets its own "IMAGE" key (the only
    plugin that uses one today). This DUPLICATES existing rows into the new per-plugin groups
    rather than moving them, so every plugin keeps working with the exact key it was already
    using the moment this deploys -- nobody has to reconfigure anything. The old "LLM"/"IMAGE"
    groups are left in place as a fallback (resolve_llm_credentials and _saved_ai_keys both check
    the scoped group first, then fall back to the legacy one), so this is purely additive.
    """
    import json

    rows = (await conn.execute(text(
        "SELECT id, org_id, group_name, name, status, api_key_masked, config FROM connections "
        "WHERE group_name IN ('LLM', 'IMAGE')"
    ))).all()
    for row_id, org_id, group_name, name, status, masked, config in rows:
        targets = ["voice", "leadgen", "scheduler"] if group_name == "LLM" else ["scheduler"]
        for scope in targets:
            new_group = f"{group_name}:{scope}"
            new_id = f"{row_id}_{scope}"
            exists = (await conn.execute(text(
                "SELECT 1 FROM connections WHERE id = :i"), {"i": new_id}
            )).first()
            if exists:
                continue
            await conn.execute(text(
                "INSERT INTO connections (id, org_id, group_name, name, status, api_key_masked, config) "
                "VALUES (:id, :org_id, :group_name, :name, :status, :masked, CAST(:config AS JSON))"
            ), {
                "id": new_id, "org_id": org_id, "group_name": new_group, "name": name,
                "status": status, "masked": masked,
                "config": json.dumps(config) if config is not None else None,
            })


STEPS: List[Tuple[str, Step]] = [
    ("2026_10_01_operators_auth_columns", _operators_auth_columns),
    ("2026_10_01_hash_plain_passwords", _hash_plain_passwords),
    ("2026_10_01_system_roles", _system_roles),
    ("2026_10_02_meeting_lunch_columns", _meeting_lunch_columns),
    ("2026_10_02_operator_profile_columns", _operator_profile_columns),
    ("2026_10_03_credit_wallets", _credit_wallets),
    ("2026_10_04_billing_plan_currency", _billing_plan_currency),
    ("2026_10_05_payg_columns", _payg_columns),
    ("2026_10_06_agent_studio", _agent_studio),
    ("2026_10_07_call_takeover", _call_takeover),
    ("2026_10_08_platform_split", _platform_split),
    ("2026_10_09_ai_keys_owner_only", _ai_keys_owner_only),
    ("2026_10_11_merge_leadgen_email", _merge_leadgen_email_wallets),
    ("2026_10_12_phone_rental_due", _phone_rental_due),
    ("2026_10_13_split_shared_provider_keys", _split_shared_provider_keys_per_plugin),
    ("2026_10_14_remove_seeded_billing_plans", _remove_seeded_billing_plans),
]


async def run_migrations(conn: AsyncConnection) -> None:
    await conn.execute(text(
        "CREATE TABLE IF NOT EXISTS schema_migrations (id VARCHAR PRIMARY KEY, applied_at TIMESTAMP NOT NULL)"
    ))
    done = {r[0] for r in (await conn.execute(text("SELECT id FROM schema_migrations"))).all()}
    for step_id, step in STEPS:
        if step_id in done:
            continue
        logger.info(f"Applying migration {step_id}")
        await step(conn)
        await conn.execute(
            text("INSERT INTO schema_migrations (id, applied_at) VALUES (:i, :t)"),
            {"i": step_id, "t": datetime.utcnow()},
        )
