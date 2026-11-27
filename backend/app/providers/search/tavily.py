"""Tavily: web search used to find a company's website, phone, e-mail and social pages. Calls go through services/tavily_pool.py
(backup keys, cool-downs, one log row per call); a call costs Tavily credits (basic 1, advanced 2)."""
from __future__ import annotations

import httpx

from app.providers.base import Licence, Manifest, Pricing, Provider, TestResult, rejected


class Tavily(Provider):
    manifest = Manifest(
        id="tavily", name="Tavily", category="web_search", capabilities=("web_search",), provides=("website", "phone", "email", "social"),
        key_group="Business Discovery", pricing=Pricing(usd=0.008, unit="credit", billing="per_search"),
        licence=Licence(exportable=True, client_label="Found on the web"), credit_item="lead_lookup", default_order=10,
        docs_url="https://docs.tavily.com")

    async def saved_key(self) -> str:
        from app.services.enrichment_service import tavily_key

        return await tavily_key()

    async def test(self, client: httpx.AsyncClient, key: str) -> TestResult:
        res = await client.get("https://api.tavily.com/usage", headers={"Authorization": f"Bearer {key}"})
        bad = rejected(res, self.label())
        if bad:
            return bad
        if res.status_code != 200:
            return TestResult(False, f"Tavily answered {res.status_code}.")
        acct = (res.json() if res.content else {}).get("account") or {}
        limit, used = acct.get("plan_limit"), acct.get("plan_usage")
        if limit is None or used is None:
            return TestResult(True, "Key works.")
        left = float(limit) - float(used)
        if left <= 0 and acct.get("paygo_limit") is None:
            return TestResult(False, "Key works, but it has used all its credits this month, so searches fail until it renews or is topped up.", 0.0, "credits")
        return TestResult(True, f"Key works. {left:,.0f} credits left this month.", left, "credits")


PROVIDER = Tavily()
