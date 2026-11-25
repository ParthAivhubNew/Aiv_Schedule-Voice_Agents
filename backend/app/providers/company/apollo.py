"""Apollo: company data and people search. Its key is saved under Business Discovery and shared with the backup keys of
services/apollo_pool.py, which also logs every call. Its data may not be exported (its terms)."""
from __future__ import annotations

from typing import Any, Dict, Tuple

import httpx

from app.providers.base import EmailFinder, Licence, Manifest, Pricing, ProviderError, TestResult, check_response, rejected


class Apollo(EmailFinder):
    manifest = Manifest(
        id="apollo", name="Apollo", category="company_data", capabilities=("company_data", "email_finder"),
        provides=("email", "company", "people", "phone"), key_group="Business Discovery",
        pricing=Pricing(usd=0.0, unit="credit", billing="per_find"),  # a monthly plan with credits: staff set the price per credit
        licence=Licence(exportable=False, client_label="Licensed business data"), credit_item="lead_lookup", default_order=40,
        docs_url="https://docs.apollo.io", note="Its people database is large, so it comes before the last two e-mail finders.")

    async def find_email(self, client: httpx.AsyncClient, key: str, p: Dict[str, str]) -> Tuple[str, str]:
        """Apollo's people match. It only returns a real address on a plan that includes API email access; on a free plan the email
        comes back locked ("email_not_unlocked@...") and is treated as nobody found."""
        body = {"first_name": p["first_name"], "last_name": p["last_name"], "organization_name": p["company"], "reveal_personal_emails": False}
        if p["domain"]:
            body["domain"] = p["domain"]
        from app.services import apollo_pool

        def _email(j: Any) -> str:
            return str((((j or {}).get("person")) or {}).get("email") or "")

        who = f"{p['first_name']} {p['last_name']}".strip()
        res = await apollo_pool.call(client, "post", "https://api.apollo.io/api/v1/people/match", json=body, headers={"Cache-Control": "no-cache"},
                                     lead=key, purpose="email_lookup", looked_for=f"{who} at {p['company'] or p['domain']}".strip(),
                                     found=lambda j: "@" in _email(j) and "not_unlocked" not in _email(j))
        if res is None:
            raise ProviderError("Apollo: no key set.")
        person = (check_response(res, self.label()) or {}).get("person") or {}
        email_addr = str(person.get("email") or "")
        status = str(person.get("email_status") or "").lower()
        if not email_addr or "not_unlocked" in email_addr or "@" not in email_addr:
            return "", ""
        if status == "verified":
            return email_addr, "verified"
        if status in ("likely to engage", "extrapolated", "catch-all", "catch_all"):
            return email_addr, "catch_all"
        return "", ""

    async def saved_key(self) -> str:
        from app.services import apollo_pool

        pool = await apollo_pool.keys()
        return pool[0][2] if pool else ""

    async def test(self, client: httpx.AsyncClient, key: str) -> TestResult:
        res = await client.get("https://api.apollo.io/v1/auth/health", headers={"X-Api-Key": key, "Cache-Control": "no-cache"})
        bad = rejected(res, self.label())
        if bad:
            return bad
        if res.status_code != 200:
            return TestResult(False, f"Apollo answered {res.status_code}.")
        data = res.json() if res.content else {}
        if data.get("is_logged_in") is False:
            return TestResult(False, "Apollo did not accept the key.")
        return TestResult(True, "Key works.")


PROVIDER = Apollo()
