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
    """AI keys belong to Outreach only. Aivhub's AI keys move to the platform record (unless the
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


async def _prospect_leadgen_columns(conn: AsyncConnection) -> None:
    """Leadgen's Saved Accounts now persist as real Prospect rows instead of browser-only state;
    these two columns carry the fields Voice's calling prospects never needed."""
    await conn.execute(text("ALTER TABLE prospects ADD COLUMN IF NOT EXISTS email VARCHAR DEFAULT ''"))
    await conn.execute(text("ALTER TABLE prospects ADD COLUMN IF NOT EXISTS opening_hook TEXT DEFAULT ''"))


async def _seed_lookup_vendor_prices(conn: AsyncConnection) -> None:
    """Carries forward the per-call vendor prices that used to be hardcoded in
    enrichment_waterfall.py (COST_USD / OTHER_VENDOR_COST_USD) into provider_prices, so billing
    keeps working exactly as it did -- just as editable data now instead of Python constants.
    Runs once; staff can change any of these freely afterwards on the Model Pricing screen."""
    import uuid

    seed = {
        "icypeas": 0.01, "hunter": 0.03, "findymail": 0.03, "leadmagic": 0.02, "bettercontact": 0.05,
        "tavily": 0.008, "telnyx_lookup": 0.003,
    }
    for provider, price in seed.items():
        await conn.execute(text(
            "INSERT INTO provider_prices (id, provider, model, kind, price_in_usd, price_out_usd, confirmed, created_at, updated_at, updated_by) "
            "VALUES (:id, :p, '', 'lookup', :price, 0, TRUE, now(), now(), 'migration') "
            "ON CONFLICT (provider, model, kind) DO NOTHING"
        ), {"id": f"pp_{uuid.uuid4().hex[:12]}", "p": provider, "price": price})


async def _lead_account_business_record_column(conn: AsyncConnection) -> None:
    """Links a Leads user's saved company to the shared, cross-organisation BusinessRecord fact
    sheet (see models.py) -- their own notes/status stay on this row; only the pointer is new."""
    await conn.execute(text("ALTER TABLE lead_accounts ADD COLUMN IF NOT EXISTS business_record_id VARCHAR"))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_lead_accounts_business_record_id ON lead_accounts (business_record_id)"))


async def _business_record_shared_research_column(conn: AsyncConnection) -> None:
    """Carries one organisation's full Research dossier (team, named contacts, sources) into the
    shared, cross-organisation store -- public fact about the business, not that organisation's
    private data, so the next organisation that looks up the same company gets it too, free."""
    await conn.execute(text("ALTER TABLE business_records ADD COLUMN IF NOT EXISTS shared_research JSON"))


async def _seed_google_places_vendor_price(conn: AsyncConnection) -> None:
    """Google Places' real per-lookup cost (Text Search + Place Details, combined), for the
    admin portal's vendor-spend estimate -- same editable row as every other vendor price."""
    import uuid

    await conn.execute(text(
        "INSERT INTO provider_prices (id, provider, model, kind, price_in_usd, price_out_usd, confirmed, created_at, updated_at, updated_by) "
        "VALUES (:id, 'google_places', '', 'lookup', 0.035, 0, TRUE, now(), now(), 'migration') "
        "ON CONFLICT (provider, model, kind) DO NOTHING"
    ), {"id": f"pp_{uuid.uuid4().hex[:12]}"})


async def _lead_account_research_history_column(conn: AsyncConnection) -> None:
    """Re-researching a saved account used to throw away what the last run found; this column
    keeps earlier runs so users can look back at more than just the latest one (see models.py)."""
    await conn.execute(text("ALTER TABLE lead_accounts ADD COLUMN IF NOT EXISTS research_history JSON"))


async def _business_record_postcode_index(conn: AsyncConnection) -> None:
    """Postcode searches (the map's drawn area, and "postcode starts with") are all 'postcode LIKE
    AB1 %' -- without an index each one reads every company. A prefix-ready btree makes them
    instant. On a big store, build it ahead without blocking the app:
    CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_business_records_postcode_prefix ON business_records (postcode varchar_pattern_ops);"""
    if conn.dialect.name != "postgresql":
        return
    await conn.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_business_records_postcode_prefix ON business_records (postcode varchar_pattern_ops)"))


async def _lead_account_verification_column(conn: AsyncConnection) -> None:
    """Saved Accounts > Check companies keeps its result in its own column, apart from what the
    user imported (see models.py)."""
    await conn.execute(text("ALTER TABLE lead_accounts ADD COLUMN IF NOT EXISTS verification JSON"))


async def _live_registry_check_config(conn: AsyncConnection) -> None:
    """Teaches the company check how to read a live search hit from the two registers that can be
    asked directly (Companies House, Food Hygiene): which hit field is the name, status, and so on.
    Only adds what is missing; anything staff already set is left alone."""
    import json

    hits = {
        "ds_companies_house": {
            "search_field_map": {"name": "title", "registration_number": "company_number", "status": "company_status",
                                 "company_category": "company_type", "incorporation_date": "date_of_creation",
                                 "address": "address_snippet"},
        },
        "ds_food_hygiene": {
            "search_endpoint": "/Establishments", "search_param": "name", "search_items_path": "establishments",
            "search_extra_params": {"pageSize": "5"}, "test_query": "Tesco",
            "search_field_map": {"name": "BusinessName", "postcode": "PostCode", "industry": "BusinessType",
                                 "address": ["AddressLine1", "AddressLine2", "AddressLine3", "PostCode"]},
            "search_defaults": {"status": "Active"},  # the register lists food businesses currently registered
        },
    }
    for source_id, extra in hits.items():
        row = (await conn.execute(text("SELECT config FROM data_sources WHERE id = :i"), {"i": source_id})).first()
        if not row:
            continue
        config = row[0] if isinstance(row[0], dict) else json.loads(row[0] or "{}")
        for key, value in extra.items():
            config.setdefault(key, value)
        await conn.execute(text("UPDATE data_sources SET config = CAST(:c AS JSON) WHERE id = :i"),
                           {"c": json.dumps(config), "i": source_id})


async def _seed_companies_house_source(conn: AsyncConnection) -> None:
    """The first api-type DataSource -- a config row, not special-cased code (see
    data_source_connector.py). Picks up COMPANIES_HOUSE_API_KEY once, as a one-time convenience
    for whoever already has a key, so there's something to paste into the Data Sources screen
    straight away; from then on the saved row (editable there) is what's actually used, same as
    every other staff-entered key in this app."""
    import json
    import os
    import uuid

    exists = (await conn.execute(text("SELECT 1 FROM data_sources WHERE id = 'ds_companies_house'"))).first()
    if exists:
        return
    config = {
        "trust_tier": "verified_registry",
        "search_endpoint": "/search/companies",
        "search_param": "q",
        "search_items_path": "items",
        "id_field_from_search": "company_number",
        "profile_endpoint": "/company/{id}",
        # A real term the Test button searches for to prove the key actually works -- Tesco is a
        # real, stable UK-registered company, so a working key should always find it.
        "test_query": "Tesco",
        "field_map": {
            "name": "company_name",
            "registration_number": "company_number",
            "address": ["registered_office_address.address_line_1", "registered_office_address.locality",
                        "registered_office_address.postal_code"],
            "region": "registered_office_address.locality",
            "industry": "sic_codes",
            "status": "company_status",
            "company_category": "type",
            "incorporation_date": "date_of_creation",
        },
        # Officers and who actually controls the company -- one extra call each, only for a
        # specific company someone looked up (see fetch_profile), never for a whole bulk import.
        "officers_endpoint": "/company/{id}/officers",
        "officers_items_path": "items",
        "officers_field_map": {"name": "name", "role": "officer_role", "appointed_on": "appointed_on", "resigned_on": "resigned_on"},
        "psc_endpoint": "/company/{id}/persons-with-significant-control",
        "psc_items_path": "items",
        "psc_field_map": {"name": "name", "kind": "kind", "notified_on": "notified_on", "ceased_on": "ceased_on"},
        # Bulk path: their own free monthly full-dataset download (see data_source_connector.py's
        # discover_bulk_files/stream_bulk_rows) -- no API key needed for this file, no company
        # name ever typed; "Start a run" on this source just imports the whole thing.
        "bulk_index_url": "https://download.companieshouse.gov.uk/en_output.html",
        "bulk_link_pattern": r"BasicCompanyData-[\d-]+-part\d+_\d+\.zip",
        "bulk_field_map": {
            "name": ["CompanyName"],
            "registration_number": ["CompanyNumber"],
            "industry": ["SICCode.SicText_1"],
            "region": ["RegAddress.PostTown"],
            "address": ["RegAddress.AddressLine1", "RegAddress.PostTown", "RegAddress.PostCode"],
            "status": ["CompanyStatus"],
            "company_category": ["CompanyCategory"],
            "incorporation_date": ["IncorporationDate"],
        },
    }
    await conn.execute(text(
        "INSERT INTO data_sources (id, name, kind, base_url, auth_type, api_key, config, provides_fields, "
        "max_concurrent_requests, min_delay_ms, run_state, status, created_at, updated_at, updated_by) "
        "VALUES (:id, 'Companies House (UK)', 'api', 'https://api.company-information.service.gov.uk', "
        "'api_key_basic', :key, CAST(:config AS JSON), CAST(:fields AS JSON), 5, 200, 'idle', 'active', "
        "now(), now(), 'migration')"
    ), {
        "id": "ds_companies_house", "key": os.getenv("COMPANIES_HOUSE_API_KEY", "").strip(),
        "config": json.dumps(config),
        "fields": json.dumps(["name", "registration_number", "address", "region", "industry"]),
    })


async def _companies_house_test_query(conn: AsyncConnection) -> None:
    """The Companies House row seeded before test_query existed in its config has no way to
    prove a key works (the Test button needs a real search term) -- add it without touching
    anything staff may have already changed on that row."""
    import json

    row = (await conn.execute(text("SELECT config FROM data_sources WHERE id = 'ds_companies_house'"))).first()
    if not row:
        return
    config = row[0] if isinstance(row[0], dict) else json.loads(row[0] or "{}")
    if config.get("test_query"):
        return
    config["test_query"] = "Tesco"
    await conn.execute(text("UPDATE data_sources SET config = CAST(:c AS JSON) WHERE id = 'ds_companies_house'"), {"c": json.dumps(config)})


async def _companies_house_bulk_config(conn: AsyncConnection) -> None:
    """Adds the bulk-download fields (see _seed_companies_house_source) to a row seeded before
    they existed, without touching anything staff may have already changed on it."""
    import json

    row = (await conn.execute(text("SELECT config FROM data_sources WHERE id = 'ds_companies_house'"))).first()
    if not row:
        return
    config = row[0] if isinstance(row[0], dict) else json.loads(row[0] or "{}")
    if config.get("bulk_index_url"):
        return
    config["bulk_index_url"] = "https://download.companieshouse.gov.uk/en_output.html"
    config["bulk_link_pattern"] = r"BasicCompanyData-[\d-]+-part\d+_\d+\.zip"
    config["bulk_field_map"] = {
        "name": ["CompanyName"], "registration_number": ["CompanyNumber"],
        "industry": ["SICCode.SicText_1"], "region": ["RegAddress.PostTown"],
        "address": ["RegAddress.AddressLine1", "RegAddress.PostTown", "RegAddress.PostCode"],
    }
    await conn.execute(text("UPDATE data_sources SET config = CAST(:c AS JSON) WHERE id = 'ds_companies_house'"), {"c": json.dumps(config)})


async def _business_record_search_indexes(conn: AsyncConnection) -> None:
    """GIN trigram indexes so searching business_records (name/domain/reg number/industry/
    region/email/phone, all ILIKE '%term%') stays fast once there are millions of rows -- a plain
    btree index can't help a leading-wildcard search, pg_trgm's can. SQLite (tests) has no
    extensions, so this is skipped there rather than failing the whole startup."""
    if conn.dialect.name != "postgresql":
        return
    try:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
    except Exception as err:
        logger.warning(f"Could not enable pg_trgm (business_records search will fall back to a plain scan): {err}")
        return
    for col in ("name", "domain", "registration_number", "industry", "region", "email", "phone"):
        await conn.execute(text(
            f"CREATE INDEX IF NOT EXISTS ix_business_records_{col}_trgm ON business_records USING GIN ({col} gin_trgm_ops)"
        ))


async def _companies_house_more_fields(conn: AsyncConnection) -> None:
    """Adds status/category/incorporation-date mapping and officers/PSC endpoints to a row seeded
    before they existed -- see _seed_companies_house_source for what each one does. Never touches
    anything staff may have already changed on this row."""
    import json

    row = (await conn.execute(text("SELECT config FROM data_sources WHERE id = 'ds_companies_house'"))).first()
    if not row:
        return
    config = row[0] if isinstance(row[0], dict) else json.loads(row[0] or "{}")
    if config.get("officers_endpoint"):
        return
    config.setdefault("field_map", {}).update({
        "status": "company_status", "company_category": "type", "incorporation_date": "date_of_creation",
    })
    config["officers_endpoint"] = "/company/{id}/officers"
    config["officers_items_path"] = "items"
    config["officers_field_map"] = {"name": "name", "role": "officer_role", "appointed_on": "appointed_on", "resigned_on": "resigned_on"}
    config["psc_endpoint"] = "/company/{id}/persons-with-significant-control"
    config["psc_items_path"] = "items"
    config["psc_field_map"] = {"name": "name", "kind": "kind", "notified_on": "notified_on", "ceased_on": "ceased_on"}
    config.setdefault("bulk_field_map", {}).update({
        "status": ["CompanyStatus"], "company_category": ["CompanyCategory"], "incorporation_date": ["IncorporationDate"],
    })
    await conn.execute(text("UPDATE data_sources SET config = CAST(:c AS JSON) WHERE id = 'ds_companies_house'"), {"c": json.dumps(config)})


async def _business_record_more_fields(conn: AsyncConnection) -> None:
    """More of what a registry source actually publishes about a company, not just the handful
    of fields the first version mapped -- status/category/incorporation date (already sitting in
    the same bulk file being downloaded, free to add), and officers/significant-control (fetched
    per company on demand -- see data_source_connector.fetch_profile)."""
    for col, typ in (
        ("status", "VARCHAR DEFAULT ''"), ("company_category", "VARCHAR DEFAULT ''"),
        ("incorporation_date", "VARCHAR DEFAULT ''"), ("officers", "JSON"), ("significant_control", "JSON"),
    ):
        await conn.execute(text(f"ALTER TABLE business_records ADD COLUMN IF NOT EXISTS {col} {typ}"))


async def _business_record_search_columns(conn: AsyncConnection) -> None:
    """The columns the Apollo-style filters search on (see BusinessRecord). Added empty and
    instant -- nothing is rewritten here, and no existing column is touched. Filling them for the
    rows already imported is a separate, resumable job (scripts/backfill_business_records.py), so
    a multi-million-row update never blocks the app starting up."""
    for col, typ in (
        ("sic_text", "VARCHAR"), ("sic_codes", "VARCHAR"), ("postcode", "VARCHAR"),
        ("incorporated_on", "DATE"), ("size_band", "VARCHAR"),
    ):
        await conn.execute(text(f"ALTER TABLE business_records ADD COLUMN IF NOT EXISTS {col} {typ}"))


async def _companies_house_search_fields(conn: AsyncConnection) -> None:
    """Teaches the Companies House bulk import to fill the search columns on every future run
    (all four SIC descriptions, the postcode, and the filed-accounts category the size band comes
    from). Only adds map entries; anything staff already set is left alone."""
    import json

    row = (await conn.execute(text("SELECT config FROM data_sources WHERE id = 'ds_companies_house'"))).first()
    if not row:
        return
    config = row[0] if isinstance(row[0], dict) else json.loads(row[0] or "{}")
    bulk_map = config.setdefault("bulk_field_map", {})
    bulk_map.setdefault("sic_text", [f"SICCode.SicText_{i}" for i in range(1, 5)])
    bulk_map.setdefault("postcode", ["RegAddress.PostCode"])
    bulk_map.setdefault("accounts_category", ["Accounts.AccountCategory"])
    await conn.execute(text("UPDATE data_sources SET config = CAST(:c AS JSON) WHERE id = 'ds_companies_house'"), {"c": json.dumps(config)})


async def _seed_open_data_sources(conn: AsyncConnection) -> None:
    """Three free UK registers, ready to start from Platform Keys > Data Sources (nothing runs until
    staff press Start). Each mapping was checked against the publisher's real file or API response:

      * CQC directory (care homes, clinics, dentists, GPs): a CSV whose link changes every month,
        found fresh from the publisher's page. Locations have no company number, so a row is matched
        to other sources by name + postcode.
      * Charity Commission register (England & Wales): one big JSON ZIP. A charity that is also a
        company is stored under its company number, so it merges into its Companies House row and adds
        the phone, email and website to it; other charities get their own CC- number.
      * Food Standards Agency hygiene ratings (restaurants, cafes, takeaways, shops): a no-key JSON API
        read one local authority at a time.

    A source only fills gaps on a company another source already described (see bulk_upsert), so none
    of them can overwrite Companies House's name, status or address. Skipped if a row already exists."""
    import json

    sources = {
        "ds_cqc": ("CQC care directory (England)", "https://www.cqc.org.uk", "none", 500, {
            "trust_tier": "verified_registry",
            "bulk_index_url": "https://www.cqc.org.uk/about-us/transparency/using-cqc-data",
            "bulk_link_pattern": r"https://www\.cqc\.org\.uk/system/files/[0-9-]+/[A-Za-z0-9_]*CQC_directory\.csv",
            "bulk_field_map": {
                "name": ["Name"], "address": ["Address", "Postcode"], "postcode": ["Postcode"], "phone": ["Phone number"],
                "website": ["Service's website (if available)"], "industry": ["Service types"],
                "region": ["Local authority"], "description": ["Specialisms/services"],
            },
            "bulk_defaults": {"status": "Active"},  # the directory lists active registered locations only
            "bulk_uk_phone": True,
        }),
        "ds_charity_commission": ("Charity Commission register (England & Wales)", "https://register-of-charities.charitycommission.gov.uk", "none", 500, {
            "trust_tier": "verified_registry",
            "bulk_file_urls": ["https://ccewuksprdoneregsadata1.blob.core.windows.net/data/json/publicextract.charity.zip"],
            "bulk_field_map": {
                "name": ["charity_name"], "company_number": ["charity_company_registration_number"],
                "charity_number": ["registered_charity_number"], "linked_number": ["linked_charity_number"],
                "status": ["charity_registration_status"], "incorporation_date": ["date_of_registration"],
                "address": ["charity_contact_address1", "charity_contact_address2", "charity_contact_address3",
                            "charity_contact_address4", "charity_contact_address5", "charity_contact_postcode"],
                "postcode": ["charity_contact_postcode"], "phone": ["charity_contact_phone"], "email": ["charity_contact_email"],
                "website": ["charity_contact_web"], "description": ["charity_activities"],
            },
            "bulk_registration": [
                {"field": "company_number", "pad": 8},
                {"fields": ["charity_number", "linked_number"], "prefix": "CC-", "joiner": "-"},
                {"field": "charity_number", "prefix": "CC-"},
            ],
            "bulk_value_map": {"status": {"Registered": "Active"}},
            "bulk_defaults": {"industry": "Charity", "company_category": "Registered charity"},
        }),
        "ds_food_hygiene": ("Food Hygiene Ratings (FSA)", "https://api.ratings.food.gov.uk", "none", 300, {
            "trust_tier": "verified_registry",
            "headers": {"x-api-version": "2", "accept": "application/json"},
            "bulk_paged_url": "https://api.ratings.food.gov.uk/Establishments?localAuthorityId={key}&pageNumber={page}&pageSize=5000",
            "bulk_page_size": 5000,
            "bulk_keys_url": "https://api.ratings.food.gov.uk/Authorities/basic",
            "bulk_keys_path": "authorities", "bulk_key_field": "LocalAuthorityId",
            "bulk_items_path": "establishments",
            "bulk_field_map": {
                "name": ["BusinessName"], "industry": ["BusinessType"], "postcode": ["PostCode"], "phone": ["Phone"],
                "region": ["LocalAuthorityName"],
                "address": ["AddressLine1", "AddressLine2", "AddressLine3", "AddressLine4", "PostCode"],
            },
            "bulk_defaults": {"status": "Active"},  # the register lists food businesses currently registered
        }),
    }
    for source_id, (name, base_url, auth, delay, config) in sources.items():
        if (await conn.execute(text("SELECT 1 FROM data_sources WHERE id = :i"), {"i": source_id})).first():
            continue
        await conn.execute(text(
            "INSERT INTO data_sources (id, name, kind, base_url, auth_type, api_key, config, provides_fields, "
            "max_concurrent_requests, min_delay_ms, run_state, status, created_at, updated_at, updated_by) "
            "VALUES (:id, :name, 'api', :base, :auth, '', CAST(:config AS JSON), CAST(:fields AS JSON), 1, :delay, "
            "'idle', 'active', now(), now(), 'migration')"
        ), {"id": source_id, "name": name, "base": base_url, "auth": auth, "delay": delay, "config": json.dumps(config),
            "fields": json.dumps(["name", "address", "postcode", "phone", "website", "industry"])})


async def _social_account_expiry(conn: AsyncConnection) -> None:
    await conn.execute(text("ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP"))


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
    ("2026_10_15_prospect_leadgen_columns", _prospect_leadgen_columns),
    ("2026_10_16_seed_lookup_vendor_prices", _seed_lookup_vendor_prices),
    ("2026_10_17_lead_account_business_record_column", _lead_account_business_record_column),
    ("2026_10_17_seed_companies_house_source", _seed_companies_house_source),
    ("2026_10_18_companies_house_test_query", _companies_house_test_query),
    ("2026_10_19_business_record_search_indexes", _business_record_search_indexes),
    ("2026_10_20_companies_house_bulk_config", _companies_house_bulk_config),
    ("2026_10_21_business_record_more_fields", _business_record_more_fields),
    ("2026_10_22_companies_house_more_fields", _companies_house_more_fields),
    ("2026_10_23_business_record_search_columns", _business_record_search_columns),
    ("2026_10_23_companies_house_search_fields", _companies_house_search_fields),
    ("2026_10_24_seed_open_data_sources", _seed_open_data_sources),
    ("2026_10_25_lead_account_research_history_column", _lead_account_research_history_column),
    ("2026_10_26_seed_google_places_vendor_price", _seed_google_places_vendor_price),
    ("2026_10_27_business_record_shared_research_column", _business_record_shared_research_column),
    ("2026_10_28_social_account_expiry", _social_account_expiry),
    ("2026_10_29_lead_account_verification_column", _lead_account_verification_column),
    ("2026_10_29_live_registry_check_config", _live_registry_check_config),
    ("2026_10_30_business_record_postcode_index", _business_record_postcode_index),
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
