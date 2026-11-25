"""Icypeas: finds a work address; the search runs in the background and is read back."""
from __future__ import annotations

import asyncio
from typing import Dict, Tuple

import httpx

from app.providers.base import EmailFinder, Manifest, Pricing, ProviderError, TestResult, check_response, rejected


class Icypeas(EmailFinder):
    manifest = Manifest(
        id="icypeas", name="Icypeas", category="email_finder", capabilities=("email_finder",), provides=("email",),
        key_group="Email Finder", pricing=Pricing(usd=0.01, unit="find", billing="per_find"), credit_item="lead_lookup",
        default_order=10, docs_url="https://api-doc.icypeas.com")

    async def find_email(self, client: httpx.AsyncClient, key: str, p: Dict[str, str]) -> Tuple[str, str]:
        headers = {"Authorization": key, "Content-Type": "application/json"}
        body = {"firstname": p["first_name"], "lastname": p["last_name"], "domainOrCompany": p["domain"] or p["company"]}
        started = check_response(await client.post("https://app.icypeas.com/api/email-search", json=body, headers=headers), self.label()) or {}
        search_id = ((started.get("item") or {}).get("_id")) or ""
        if not search_id:
            raise ProviderError("Icypeas: search not started.")
        for _ in range(10):  # the search runs in the background; it usually finishes in a few seconds
            await asyncio.sleep(1.5)
            read = check_response(await client.post("https://app.icypeas.com/api/bulk-single-searchs/read",
                                                    json={"id": search_id}, headers=headers), self.label()) or {}
            item = (read.get("items") or [{}])[0]
            if item.get("status") in ("DEBITED", "FOUND", "NOT_FOUND", "DEBITED_NOT_FOUND", "BAD_INPUT", "INSUFFICIENT_FUNDS", "ABORTED"):
                emails = ((item.get("results") or {}).get("emails")) or []
                best = next((e for e in emails if str(e.get("certainty", "")).lower() in ("ultra_sure", "sure")), None)
                if best and best.get("email"):
                    return best["email"], "verified"
                return "", ""
        return "", ""

    async def test(self, client: httpx.AsyncClient, key: str) -> TestResult:
        # Icypeas has no balance call: reading a search that doesn't exist is free and tells a refused key from an accepted one.
        res = await client.post("https://app.icypeas.com/api/bulk-single-searchs/read", json={"id": "connection-test"},
                                headers={"Authorization": key, "Content-Type": "application/json"})
        bad = rejected(res, self.label())
        if bad:
            return bad
        if res.status_code >= 500:
            return TestResult(False, f"Icypeas answered {res.status_code}.")
        return TestResult(True, "Key accepted. Icypeas doesn't report a balance through its API.")


PROVIDER = Icypeas()
