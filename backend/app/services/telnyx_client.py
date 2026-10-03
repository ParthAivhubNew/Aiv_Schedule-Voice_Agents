"""Thin async client for the Telnyx v2 REST API (numbers, regulatory, accounts, WhatsApp).

One place for every path we call, so a change on Telnyx's side is fixed here only.
Errors come back as TelnyxError with Telnyx's own message, never a stack trace.
"""
from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote

import httpx

logger = logging.getLogger("telnyx_client")

BASE = os.getenv("TELNYX_API_BASE", "https://api.telnyx.com/v2")


class TelnyxError(Exception):
    def __init__(self, message: str, status: int = 0, body: Any = None):
        super().__init__(message)
        self.status = status
        self.body = body


_saved_key = ""  # the Telnyx key staff saved in the admin portal (Platform keys → Telephony)


def platform_key() -> str:
    """Our own (manager) Telnyx API key: TELNYX_API_KEY, else the one saved in the admin portal.
    Clients never see it."""
    from app.config import settings

    return (os.getenv("TELNYX_API_KEY") or getattr(settings, "TELNYX_API_KEY", "") or _saved_key or "").strip()


async def refresh_saved_key() -> str:
    """Re-read the admin-portal Telnyx key (at startup, after staff change it, and when a page
    needs it). Never raises: on any error the last known key stays."""
    global _saved_key
    try:
        from sqlalchemy.future import select

        from app.core.platform import platform_org_id
        from app.core.tenancy import org_scope
        from app.database import AsyncSessionLocal
        from app.models.models import Connection
        from app.services.secret_box import config_get_secret, open_config

        key = ""
        with org_scope(platform_org_id()):
            async with AsyncSessionLocal() as db:
                rows = (await db.execute(select(Connection).where(Connection.group_name == "Telephony"))).scalars().all()
        for c in rows:
            if "telnyx" in (c.name or "").lower():
                key = config_get_secret(open_config(c.config if isinstance(c.config, dict) else {}), "api_key", "auth_token") or ""
                if key:
                    break
        _saved_key = key.strip()
    except Exception as err:
        logger.debug(f"saved Telnyx key not read: {err}")
    return _saved_key


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

    async def speech(self, text: str, voice: str) -> Tuple[bytes, str]:
        """Text read out in a voice: (audio bytes, content type)."""
        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            r = await client.post(f"{BASE}/text-to-speech/speech", headers=headers,
                                  json={"text": text, "voice": voice, "output_type": "binary_output"})
        if r.status_code >= 400 or not r.content:
            try:
                body = r.json()
            except ValueError:
                body = {}
            logger.warning(f"[telnyx] text-to-speech {voice} -> {r.status_code}: {str(body)[:300]}")
            raise TelnyxError(_message(body, r.status_code), r.status_code, body)
        return r.content, (r.headers.get("content-type") or "audio/mpeg").split(";")[0]

    # ── Accounts ──────────────────────────────────────────────────────────
    async def create_managed_account(self, business_name: str, email: Optional[str] = None) -> Dict[str, Any]:
        payload = {"business_name": business_name[:100]}
        if email:
            payload["email"] = email
        return (await self._req("POST", "/managed_accounts", json=payload)).get("data", {})

    async def get_managed_account(self, account_id: str) -> Dict[str, Any]:
        # The API key of a new managed account is only on this resource, not on the create reply.
        return (await self._req("GET", f"/managed_accounts/{account_id}")).get("data", {})

    async def disable_managed_account(self, account_id: str) -> Dict[str, Any]:
        """No calls or messages in or out until enabled again (calls in progress carry on)."""
        return (await self._req("POST", f"/managed_accounts/{account_id}/actions/disable")).get("data", {})

    async def enable_managed_account(self, account_id: str) -> Dict[str, Any]:
        return (await self._req("POST", f"/managed_accounts/{account_id}/actions/enable")).get("data", {})

    async def create_billing_group(self, name: str) -> Dict[str, Any]:
        return (await self._req("POST", "/billing_groups", json={"name": name[:100]})).get("data", {})

    async def create_outbound_voice_profile(self, name: str, countries: List[str], billing_group_id: str = "",
                                            daily_spend_limit_usd: str = "", max_destination_rate: str = "") -> Dict[str, Any]:
        """Outbound calls are billed to the profile's billing group and limited to its countries.
        A daily spend limit makes Telnyx itself block outbound calls past that amount (USD, per day)."""
        payload: Dict[str, Any] = {"name": name[:100], "whitelisted_destinations": countries or ["GB"]}
        if billing_group_id:
            payload["billing_group_id"] = billing_group_id
        if daily_spend_limit_usd:
            payload["daily_spend_limit"] = str(daily_spend_limit_usd)
            payload["daily_spend_limit_enabled"] = True
        if max_destination_rate:
            payload["max_destination_rate"] = float(max_destination_rate)
        return (await self._req("POST", "/outbound_voice_profiles", json=payload)).get("data", {})

    async def update_outbound_voice_profile(self, profile_id: str, countries: List[str]) -> Dict[str, Any]:
        return (await self._req("PATCH", f"/outbound_voice_profiles/{profile_id}",
                                json={"whitelisted_destinations": countries or ["GB"]})).get("data", {})

    async def create_call_control_application(self, name: str, webhook_url: str, outbound_voice_profile_id: str = "") -> Dict[str, Any]:
        payload: Dict[str, Any] = {"application_name": name[:100], "webhook_event_url": webhook_url, "webhook_api_version": "2"}
        if outbound_voice_profile_id:
            payload["outbound"] = {"outbound_voice_profile_id": outbound_voice_profile_id}
        return (await self._req("POST", "/call_control_applications", json=payload)).get("data", {})

    async def get_call_control_application(self, app_id: str) -> Dict[str, Any]:
        return (await self._req("GET", f"/call_control_applications/{app_id}")).get("data", {})

    async def update_call_control_application(self, app_id: str, **fields) -> Dict[str, Any]:
        return (await self._req("PATCH", f"/call_control_applications/{app_id}", json=fields)).get("data", {})

    # ── AI Assistants ─────────────────────────────────────────────────────
    async def create_assistant(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        body = await self._req("POST", "/ai/assistants", json=payload)
        return body.get("data", body)

    async def update_assistant(self, assistant_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        body = await self._req("POST", f"/ai/assistants/{assistant_id}", json=payload)
        return body.get("data", body)

    async def get_assistant(self, assistant_id: str) -> Dict[str, Any]:
        body = await self._req("GET", f"/ai/assistants/{assistant_id}")
        return body.get("data", body)

    async def answer_call(self, call_control_id: str, client_state: str = "", webhook_url: str = "",
                          record: bool = False) -> Dict[str, Any]:
        payload: Dict[str, Any] = {}
        if record:
            payload.update({"record": "record-from-answer", "record_format": "mp3", "record_channels": "dual"})
        if client_state:
            payload["client_state"] = client_state
        if webhook_url:
            payload["webhook_url"], payload["webhook_url_method"] = webhook_url, "POST"
        return (await self._req("POST", f"/calls/{call_control_id}/actions/answer", json=payload)).get("data", {})

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

    async def find_phone_number(self, e164: str) -> Dict[str, Any]:
        """A number on this account by its E.164 form, or {} when the account has no such number."""
        rows = (await self._req("GET", "/phone_numbers", params={"filter[phone_number]": e164})).get("data") or []
        return next((r for r in rows if r.get("phone_number") == e164), {})

    async def update_phone_number(self, number_id: str, **fields) -> Dict[str, Any]:
        return (await self._req("PATCH", f"/phone_numbers/{number_id}", json=fields)).get("data", {})

    async def set_messaging_profile(self, number_id: str, profile_id: str) -> Dict[str, Any]:
        """Messages (SMS, WhatsApp) to this number go to that profile's webhook."""
        return (await self._req("PATCH", f"/phone_numbers/{number_id}/messaging",
                                json={"messaging_profile_id": profile_id})).get("data", {})

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

    async def get_balance(self) -> Dict[str, Any]:
        """Queries Telnyx GET /v2/balance (available_credit, balance, currency)."""
        return (await self._req("GET", "/balance")).get("data", {})

    # ── Usage reports (what Telnyx charged, broken down e.g. by billing group) ──
    async def usage_report_options(self, product: str = "") -> List[Dict[str, Any]]:
        """Each product with the dimensions and metrics it can be reported by."""
        params = {"product": product} if product else None
        return (await self._req("GET", "/usage_reports/options", params=params)).get("data", [])

    async def usage_report(self, product: str, dimensions: List[str], metrics: List[str],
                           start_date: str, end_date: str) -> List[Dict[str, Any]]:
        """Every row of a usage report (all pages). Dates: YYYY-MM-DDThh:mm:ss+00:00, at most 31 days apart."""
        rows: List[Dict[str, Any]] = []
        page = 1
        while True:
            params = {"product": product, "dimensions": ",".join(dimensions), "metrics": ",".join(metrics),
                      "start_date": start_date, "end_date": end_date, "page[number]": page, "page[size]": 100}
            body = await self._req("GET", "/usage_reports", params=params)
            rows += body.get("data", [])
            if page >= int((body.get("meta") or {}).get("total_pages") or 1):
                return rows
            page += 1

    # ── WhatsApp ──────────────────────────────────────────────────────────
    # Tech Provider signup. Only the guide documents these, not the API reference, so the replies
    # are read loosely (see whatsapp_signup).
    async def create_hosted_signup(self, app_id: str) -> Dict[str, Any]:
        return (await self._req("POST", "/whatsapp/hosted_signups", json={"app_id": app_id})).get("data", {})

    async def foreign_apps(self) -> List[Dict[str, Any]]:
        return (await self._req("GET", "/whatsapp/foreign_apps")).get("data", []) or []

    async def get_whatsapp_number(self, e164: str) -> Optional[Dict[str, Any]]:
        """The number's WhatsApp registration, or None when it is not registered (yet)."""
        try:
            return (await self._req("GET", f"/whatsapp/phone_numbers/{quote(e164, safe='')}")).get("data") or None
        except TelnyxError as err:
            if err.status == 404:
                return None
            raise

    async def create_whatsapp_template(self, waba_id: str, template: Dict[str, Any]) -> Dict[str, Any]:
        return (await self._req("POST", "/whatsapp/message_templates", json={"waba_id": waba_id, **template})).get("data", {})

    async def list_whatsapp_templates(self, waba_id: str) -> List[Dict[str, Any]]:
        return (await self._req("GET", "/whatsapp/message_templates", params={"filter[waba_id]": waba_id})).get("data", []) or []

    async def send_whatsapp(self, from_e164: str, to_e164: str, message: Dict[str, Any], webhook_url: str = "") -> Dict[str, Any]:
        payload: Dict[str, Any] = {"from": from_e164, "to": to_e164, "whatsapp_message": message}
        if webhook_url:
            payload["webhook_url"] = webhook_url
        return (await self._req("POST", "/messages/whatsapp", json=payload)).get("data", {})
