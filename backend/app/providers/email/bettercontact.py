"""BetterContact: runs its own waterfall of sources; the request runs in the background and is read back."""
from __future__ import annotations

import asyncio
from typing import Dict, Tuple

import httpx

from app.providers.base import EmailFinder, Manifest, Pricing, ProviderError, TestResult, check_response, rejected


class BetterContact(EmailFinder):
    manifest = Manifest(
        id="bettercontact", name="BetterContact", category="email_finder", capabilities=("email_finder",), provides=("email",),
        key_group="Email Finder", pricing=Pricing(usd=0.05, unit="find", billing="per_find"), credit_item="lead_lookup",
        default_order=60, docs_url="https://doc.bettercontact.rocks")

    async def find_email(self, client: httpx.AsyncClient, key: str, p: Dict[str, str]) -> Tuple[str, str]:
        headers = {"X-API-Key": key, "Content-Type": "application/json"}
        body = {"data": [{"first_name": p["first_name"], "last_name": p["last_name"], "company": p["company"],
                          "company_domain": p["domain"]}], "enrich_email_address": True, "enrich_phone_number": False}
        started = check_response(await client.post("https://app.bettercontact.rocks/api/v2/async", json=body, headers=headers), self.label()) or {}
        req_id = started.get("id") or ""
        if not req_id:
            raise ProviderError("BetterContact: request not started.")
        for _ in range(12):  # BetterContact runs its own waterfall; allow it up to ~30 seconds
            await asyncio.sleep(2.5)
            got = check_response(await client.get(f"https://app.bettercontact.rocks/api/v2/async/{req_id}", headers=headers), self.label()) or {}
            if str(got.get("status") or "").lower() in ("terminated", "completed", "done"):
                row = (got.get("data") or [{}])[0]
                email_addr = row.get("contact_email_address") or ""
                status = str(row.get("contact_email_address_status") or "").lower()
                if email_addr and status in ("deliverable", "valid", "verified"):
                    return email_addr, "verified"
                if email_addr and "catch" in status:
                    return email_addr, "catch_all"
                return "", ""
        return "", ""

    async def test(self, client: httpx.AsyncClient, key: str) -> TestResult:
        res = await client.get("https://app.bettercontact.rocks/api/v2/account", headers={"X-API-Key": key})
        bad = rejected(res, self.label())
        if bad:
            return bad
        if res.status_code != 200:
            return TestResult(False, f"BetterContact answered {res.status_code}.")
        left = (res.json() if res.content else {}).get("credits_left")
        return TestResult(True, "Key works." + (f" {float(left):,.0f} credits left." if left is not None else ""),
                          float(left) if left is not None else None, "credits")


PROVIDER = BetterContact()
