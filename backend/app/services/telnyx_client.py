"""Thin async client for the Telnyx v2 REST API (numbers, regulatory, accounts, WhatsApp).

One place for every path we call, so a change on Telnyx's side is fixed here only.
Errors come back as TelnyxError with Telnyx's own message, never a stack trace.
"""
from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger("telnyx_client")

BASE = os.getenv("TELNYX_API_BASE", "https://api.telnyx.com/v2")


class TelnyxError(Exception):
    def __init__(self, message: str, status: int = 0, body: Any = None):
        super().__init__(message)
        self.status = status
        self.body = body


def platform_key() -> str:
    """Our own (manager) Telnyx API key. Clients never see it."""
    from app.config import settings

    return (os.getenv("TELNYX_API_KEY") or getattr(settings, "TELNYX_API_KEY", "") or "").strip()


def _message(body: Any, status: int) -> str:
    try:
        errs = body.get("errors") or []
        if errs:
            e = errs[0]
            detail = e.get("detail") or e.get("title") or ""
            return f"Telnyx: {detail}".strip()
    except Exception:
        pass
    return f"Telnyx request failed ({status})."


class TelnyxClient:
    def __init__(self, api_key: str, timeout: float = 20.0):
        if not api_key:
            raise TelnyxError("Telnyx is not connected yet (no API key).")
        self.api_key = api_key
        self.timeout = timeout

    async def _req(self, method: str, path: str, *, params=None, json=None, files=None, data=None) -> Dict[str, Any]:
        url = f"{BASE}{path}"
        headers = {"Authorization": f"Bearer {self.api_key}", "Accept": "application/json"}
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            r = await client.request(method, url, params=params, json=json, files=files, data=data, headers=headers)
        try:
            body = r.json() if r.content else {}
        except ValueError:
            body = {"raw": r.text[:500]}
        if r.status_code >= 400:
            logger.warning(f"[telnyx] {method} {path} -> {r.status_code}: {str(body)[:300]}")
            raise TelnyxError(_message(body, r.status_code), r.status_code, body)
        return body

    # ── Accounts ──────────────────────────────────────────────────────────
    async def create_managed_account(self, business_name: str, email: Optional[str] = None) -> Dict[str, Any]:
        payload = {"business_name": business_name[:100]}
        if email:
            payload["email"] = email
        return (await self._req("POST", "/managed_accounts", json=payload)).get("data", {})

    async def get_managed_account(self, account_id: str) -> Dict[str, Any]:
        # The API key of a new managed account is only on this resource, not on the create reply.
        return (await self._req("GET", f"/managed_accounts/{account_id}")).get("data", {})

    async def create_billing_group(self, name: str) -> Dict[str, Any]:
        return (await self._req("POST", "/billing_groups", json={"name": name[:100]})).get("data", {})

    async def create_outbound_voice_profile(self, name: str, countries: List[str], billing_group_id: str = "") -> Dict[str, Any]:
        payload: Dict[str, Any] = {"name": name[:100], "whitelisted_destinations": countries or ["GB"]}
        if billing_group_id:
            payload["billing_group_id"] = billing_group_id
        return (await self._req("POST", "/outbound_voice_profiles", json=payload)).get("data", {})

    async def create_call_control_application(self, name: str, webhook_url: str) -> Dict[str, Any]:
        payload = {"application_name": name[:100], "webhook_event_url": webhook_url, "webhook_api_version": "2"}
        return (await self._req("POST", "/call_control_applications", json=payload)).get("data", {})

    async def create_messaging_profile(self, name: str, webhook_url: str) -> Dict[str, Any]:
        payload = {"name": name[:100], "webhook_url": webhook_url, "webhook_api_version": "2", "whitelisted_destinations": ["GB"]}
        return (await self._req("POST", "/messaging_profiles", json=payload)).get("data", {})

    # ── Numbers ───────────────────────────────────────────────────────────
    async def search_numbers(self, country: str = "GB", number_type: str = "local", locality: str = "",
                             area_code: str = "", contains: str = "", features: Optional[List[str]] = None,
                             limit: int = 20) -> List[Dict[str, Any]]:
        params: Dict[str, Any] = {
            "filter[country_code]": country,
            "filter[phone_number_type]": number_type,
            "filter[limit]": max(1, min(limit, 50)),
        }
        if locality:
            params["filter[locality]"] = locality
        if area_code:
            params["filter[national_destination_code]"] = area_code
        if contains:
            params["filter[phone_number][contains]"] = contains
        for f in features or ["voice"]:
            params.setdefault("filter[features][]", [])
            params["filter[features][]"].append(f)
        return (await self._req("GET", "/available_phone_numbers", params=params)).get("data", [])

    async def create_number_order(self, phone_numbers: List[str], requirement_group_id: str = "",
                                  connection_id: str = "", messaging_profile_id: str = "",
                                  billing_group_id: str = "", customer_reference: str = "") -> Dict[str, Any]:
        items = []
        for n in phone_numbers:
            item: Dict[str, Any] = {"phone_number": n}
            if requirement_group_id:
                item["requirement_group_id"] = requirement_group_id
            items.append(item)
        payload: Dict[str, Any] = {"phone_numbers": items}
        if connection_id:
            payload["connection_id"] = connection_id
        if messaging_profile_id:
            payload["messaging_profile_id"] = messaging_profile_id
        if billing_group_id:
            payload["billing_group_id"] = billing_group_id
        if customer_reference:
            payload["customer_reference"] = customer_reference
        return (await self._req("POST", "/number_orders", json=payload)).get("data", {})

    async def get_number_order(self, order_id: str) -> Dict[str, Any]:
        return (await self._req("GET", f"/number_orders/{order_id}")).get("data", {})

    async def get_phone_number(self, number_or_id: str) -> Dict[str, Any]:
        return (await self._req("GET", f"/phone_numbers/{number_or_id}")).get("data", {})

    async def update_phone_number(self, number_id: str, **fields) -> Dict[str, Any]:
        return (await self._req("PATCH", f"/phone_numbers/{number_id}", json=fields)).get("data", {})

    async def release_number(self, number_id: str) -> Dict[str, Any]:
        return await self._req("DELETE", f"/phone_numbers/{number_id}")

    # ── Regulatory (proof of identity and address for UK numbers) ─────────
    async def requirements(self, country: str = "GB", number_type: str = "local", action: str = "ordering") -> List[Dict[str, Any]]:
        params = {"filter[country_code]": country, "filter[phone_number_type]": number_type, "filter[action]": action}
        return (await self._req("GET", "/requirements", params=params)).get("data", [])

    async def upload_document(self, filename: str, content: bytes, content_type: str, customer_reference: str = "") -> Dict[str, Any]:
        files = {"file": (filename, content, content_type or "application/octet-stream")}
        data = {"customer_reference": customer_reference} if customer_reference else None
        return (await self._req("POST", "/documents", files=files, data=data)).get("data", {})

    async def create_address(self, fields: Dict[str, Any]) -> Dict[str, Any]:
        return (await self._req("POST", "/addresses", json=fields)).get("data", {})

    async def create_requirement_group(self, country: str, number_type: str, values: List[Dict[str, str]],
                                       customer_reference: str = "", action: str = "ordering") -> Dict[str, Any]:
        payload = {
            "country_code": country,
            "phone_number_type": number_type,
            "action": action,
            "customer_reference": customer_reference,
            "regulatory_requirements": values,
        }
        return (await self._req("POST", "/requirement_groups", json=payload)).get("data", {})

    async def update_requirement_group(self, group_id: str, values: List[Dict[str, str]]) -> Dict[str, Any]:
        return (await self._req("PATCH", f"/requirement_groups/{group_id}", json={"regulatory_requirements": values})).get("data", {})

    async def submit_requirement_group(self, group_id: str) -> Dict[str, Any]:
        return (await self._req("POST", f"/requirement_groups/{group_id}/submit_for_approval")).get("data", {})

    async def get_requirement_group(self, group_id: str) -> Dict[str, Any]:
        return (await self._req("GET", f"/requirement_groups/{group_id}")).get("data", {})

    # ── WhatsApp ──────────────────────────────────────────────────────────
    async def send_whatsapp(self, from_e164: str, to_e164: str, message: Dict[str, Any], webhook_url: str = "") -> Dict[str, Any]:
        payload: Dict[str, Any] = {"from": from_e164, "to": to_e164, "whatsapp_message": message}
        if webhook_url:
            payload["webhook_url"] = webhook_url
        return (await self._req("POST", "/messages/whatsapp", json=payload)).get("data", {})
