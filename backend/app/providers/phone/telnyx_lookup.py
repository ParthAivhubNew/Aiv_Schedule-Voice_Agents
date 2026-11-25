"""Telnyx number lookup: whether a phone number is live, its line type and carrier (Leads and Voice number checks). Uses the
platform's own Telnyx key, the same account that carries calls."""
from __future__ import annotations

import httpx

from app.providers.base import Manifest, Pricing, Provider, TestResult, rejected


class TelnyxLookup(Provider):
    manifest = Manifest(
        id="telnyx_lookup", name="Telnyx number lookup", category="phone_lookup", capabilities=("phone_lookup",),
        provides=("line_type", "carrier", "live"), key_group="Telephony", pricing=Pricing(usd=0.003, unit="call", billing="per_search"),
        credit_item="number_check", default_order=10, docs_url="https://developers.telnyx.com/api/number-lookup")

    async def saved_key(self) -> str:
        from app.services import telnyx_client

        try:
            await telnyx_client.refresh_saved_key()
        except Exception:
            pass
        return telnyx_client.platform_key()

    async def test(self, client: httpx.AsyncClient, key: str) -> TestResult:
        res = await client.get("https://api.telnyx.com/v2/balance", headers={"Authorization": f"Bearer {key}"})
        bad = rejected(res, self.label())
        if bad:
            return bad
        if res.status_code != 200:
            return TestResult(False, f"Telnyx answered {res.status_code}.")
        data = (res.json() if res.content else {}).get("data") or {}
        try:
            left = float(data.get("available_credit", data.get("balance")))
        except (TypeError, ValueError):
            return TestResult(True, "Key works.")
        return TestResult(True, f"Key works. {left:,.2f} {data.get('currency') or 'USD'} available.", left, data.get("currency") or "USD")


PROVIDER = TelnyxLookup()
