"""The margin guard (plan 11, step 5): no rate-card price or plan may sell an activity below the margin floor without staff saying so.

For every rate-card activity:
- revenue: its credits x the cheapest net price of one credit in its app. That is the lowest over the plans and top-ups on sale:
  (price - VAT when prices include it - Stripe's fee) / credits;
- worst cost: what one unit can cost us at worst, from the providers' prices (Model Pricing, else the provider's manifest) and
  how many calls one unit can make (an e-mail search may ask up to MAX_PROVIDERS_ASKED finders), or the cost per unit staff set,
  whichever is higher;
- margin = (revenue - worst cost) / revenue. Below the floor (60% unless staff change it) is "below"; no known cost is "unknown"
  (shown, never blocking); an activity that costs us nothing is "free".
Saving rates or a plan that would put an activity below the floor is refused unless staff override it with a reason (api/admin_portal.py).
"""
from __future__ import annotations

import math
from typing import Any, Dict, List, Optional

from sqlalchemy import text

SETTINGS_KEY = "margin_settings"
DEFAULTS: Dict[str, Any] = {"floor_pct": 60, "prices_include_vat": True, "stripe_pct": 1.5, "stripe_fixed_pence": 20}


async def settings(db) -> Dict[str, Any]:
    from app.services.credits import _get_doc

    stored = await _get_doc(db, SETTINGS_KEY)
    return {**DEFAULTS, **{k: stored[k] for k in DEFAULTS if k in stored}}


async def set_settings(db, patch: Dict[str, Any]) -> Dict[str, Any]:
    from app.services.credits import _put_doc

    cur = await settings(db)
    if "floor_pct" in patch:
        cur["floor_pct"] = max(0, min(95, int(float(patch["floor_pct"]))))
    if "prices_include_vat" in patch:
        cur["prices_include_vat"] = bool(patch["prices_include_vat"])
    if "stripe_pct" in patch:
        cur["stripe_pct"] = max(0.0, min(10.0, float(patch["stripe_pct"])))
    if "stripe_fixed_pence" in patch:
        cur["stripe_fixed_pence"] = max(0.0, min(200.0, float(patch["stripe_fixed_pence"])))
    await _put_doc(db, SETTINGS_KEY, cur)
    return cur


async def _provider_usd(db) -> Dict[str, float]:
    """{provider id: $ per unit}: the Model Pricing price, else the provider manifest's."""
    from app.providers import registry

    out = {p.manifest.id: p.manifest.pricing.usd for p in registry.all_providers()}
    for prov, price, confirmed in (await db.execute(text(
            "SELECT provider, price_in_usd, confirmed FROM provider_prices WHERE kind = 'lookup' AND coalesce(model, '') = ''"))).all():
        if confirmed or (price or 0) > 0:
            out[prov] = float(price or 0)
    return out


def _worst_usd(item: str, usd: Dict[str, float]) -> Optional[float]:
    """What one unit of an activity can cost us at worst, in dollars; None when nobody knows yet."""
    from app.providers import registry
    from app.services.credits import DEFAULT_UNIT_COSTS_USD_CENTS, default_voice_minute_cost_usd_cents
    from app.services.enrichment_waterfall import MAX_PROVIDERS_ASKED

    finders = sorted((usd.get(p.manifest.id, 0.0) for p in registry.email_finders()), reverse=True)
    chain = sum(finders[:MAX_PROVIDERS_ASKED])
    web = usd.get("tavily", 0.0)
    fixed = {
        "lead_lookup": chain + 2 * web,  # a lead researched: the finders it may ask, and an advanced web search
        "check_email": chain,
        "lead_social": web,
        "google_deep_search": usd.get("google_places", 0.0) + 2 * web,
        "google_view": usd.get("google_places", 0.0),
        "number_check": 5 * usd.get("telnyx_lookup", 0.0), "lead_phone_check": 5 * usd.get("telnyx_lookup", 0.0),  # priced per 5 numbers
        "tps_check": 5 * usd.get("provero_tps", 0.0), "lead_tps_check": 5 * usd.get("provero_tps", 0.0),
        "voice_minute": default_voice_minute_cost_usd_cents() / 100.0,
        "ai_video": 3.0,  # the dearest clip the video models charge (credits.py)
        "email_send": 0.0, "check_registry": 0.0, "number_setup": 0.0,
    }
    if item in fixed:
        return fixed[item]
    if item in DEFAULT_UNIT_COSTS_USD_CENTS:
        return DEFAULT_UNIT_COSTS_USD_CENTS[item] / 100.0
    return None  # voice_minute_premium, ai_post, ai_image, call_transcript: no worst case known yet


async def _credit_pence(db, plans: List[Dict[str, Any]], cfg: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    """{wallet: {"pence": net pence one credit brings at the cheapest, "plan": its name}} over the plans and top-ups on sale."""
    from app.services import fx

    out: Dict[str, Dict[str, Any]] = {}
    for p in plans:
        if not p.get("active", True) or int(p.get("credits") or 0) <= 0:
            continue
        gross = (await fx.convert(db, int(p["price_cents"]) / 100.0, (p.get("currency") or "usd").upper(), "GBP"))[0] * 100
        net = gross / 1.2 if cfg["prices_include_vat"] else gross
        net -= gross * float(cfg["stripe_pct"]) / 100.0 + float(cfg["stripe_fixed_pence"])
        per = net / int(p["credits"])
        if p["wallet"] not in out or per < out[p["wallet"]]["pence"]:
            out[p["wallet"]] = {"pence": round(per, 3), "plan": p.get("name") or ""}
    return out


async def _plans(db) -> List[Dict[str, Any]]:
    return [{"id": r[0], "wallet": r[1], "kind": r[2], "name": r[3], "price_cents": int(r[4] or 0), "currency": r[5] or "usd",
             "credits": int(r[6] or 0), "active": bool(r[7])}
            for r in (await db.execute(text("SELECT id, wallet, kind, name, price_usd_cents, currency, credits, active FROM billing_plans"))).all()]


async def table(db, rates: Optional[Dict[str, Any]] = None, plans: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    """Every activity's margin at the cheapest credit, with today's rates and plans, or with proposed ones."""
    from app.services import fx
    from app.services import revenue as R
    from app.services.credits import rates as current_rates

    cfg = await settings(db)
    card = await current_rates(db)
    proposed = {k: v for k, v in (rates or {}).items() if k in card}
    usd = await _provider_usd(db)
    credit = await _credit_pence(db, plans if plans is not None else await _plans(db), cfg)
    usd_gbp = (await fx.rate(db, "USD", "GBP"))[0]
    stored = (await R.unit_costs(db))
    staff_cur, staff = stored["currency"].upper(), stored["costs"]
    items = []
    for item, row in card.items():
        credits = float(proposed.get(item, row["credits"]))
        wallet = row["wallet"]
        worst = _worst_usd(item, usd)
        worst_p = worst * usd_gbp * 100 if worst is not None else None
        if staff.get(item):
            staff_p = (await fx.convert(db, float(staff[item]), staff_cur, "GBP"))[0]  # stored in minor units already
            worst_p = max(worst_p or 0.0, staff_p)
        per = (credit.get(wallet) or {}).get("pence")
        revenue = credits * per if per is not None else None
        if worst_p is None or per is None:  # no cost known yet, or nothing on sale in its app (it can't be sold below cost)
            status, margin = "unknown", None
        elif worst_p <= 0:
            status, margin = "free", None
        elif not revenue or revenue <= 0:
            status, margin = "below", -100.0
        else:
            margin = round((revenue - worst_p) / revenue * 100, 1)
            status = "below" if margin < cfg["floor_pct"] else "ok"
        items.append({"item": item, "label": row["label"], "wallet": wallet, "credits": credits,
                      "creditPence": per, "revenuePence": round(revenue, 2) if revenue is not None else None,
                      "worstCostPence": round(worst_p, 2) if worst_p is not None else None, "marginPct": margin, "status": status})
    order = {"below": 0, "unknown": 1, "ok": 2, "free": 3}
    items.sort(key=lambda r: (order[r["status"]], r["marginPct"] if r["marginPct"] is not None else 1e9))
    return {"settings": cfg, "usdToGbp": round(usd_gbp, 5), "wallets": credit, "items": items}


async def problems(db, rates: Optional[Dict[str, Any]] = None, plans: Optional[List[Dict[str, Any]]] = None) -> List[Dict[str, Any]]:
    """The activities a change would put below the floor, or push further below it: [] when it may be saved. An activity that was already
    below the floor and isn't made worse doesn't block an unrelated change (it stays listed on the margin table)."""
    now = {r["item"]: r for r in (await table(db))["items"]}
    out = []
    for r in (await table(db, rates, plans))["items"]:
        if r["status"] != "below":
            continue
        before = now.get(r["item"])
        if before is None or before["status"] != "below" or (r["marginPct"] or -1e9) < (before["marginPct"] or -1e9):
            out.append(r)
    return out


def needed_credits(item_row: Dict[str, Any], floor_pct: float) -> Optional[int]:
    """The fewest whole credits that would meet the floor for one activity, for the message staff see."""
    per, worst = item_row.get("creditPence"), item_row.get("worstCostPence")
    if not per or worst is None:
        return None
    return int(math.ceil(worst / (per * (1 - floor_pct / 100.0))))
