"""An organisation's own keys and accounts: ChatGPT, DeepSeek, Tavily, Apollo, its own AI endpoints, Experian and Market Location.

The /connections routes are run by the Outreach team for client organisations, so clients cannot write there. This is the one
narrow door a client's admin can use for its own keys. Every key is tested where the vendor allows it, saved sealed in the
organisation's own rows (group "Own Keys") and never returned."""
import uuid
from typing import Any, Dict, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.database import get_db
from app.models.models import Connection
from app.services.key_validator import validate_api_key
from app.services.secret_box import config_get_secret, open_config, seal_config

router = APIRouter(prefix="/own-keys", tags=["Own keys"])

GROUP = "Own Keys"
KEY_PROVIDERS = {"openai": "OpenAI", "deepseek": "DeepSeek", "tavily": "Tavily", "apollo": "Apollo.io"}
BYO_AI = {
    "custom_rest_llm": "Custom Enterprise REST LLM", "azure_ai_gateway": "Azure AI Lead Intelligence", "aws_bedrock_gateway": "AWS Bedrock Pro",
    "google_vertex_ai": "Google Cloud Vertex AI", "private_vllm": "Self-Hosted Private LLM", "custom_reasoner": "Custom Lead Qualification Reasoner",
}
EXPERIAN_HOSTS = {"sandbox": "https://sandbox-uk-api.experian.com", "live": "https://uk-api.experian.com"}
DATA_PROVIDERS = {
    "experian": {"name": "Experian", "required": ["environment", "username", "password", "client_id", "client_secret"], "secret": ["password", "client_secret"]},
    "market_location": {"name": "Market Location", "required": ["base_url", "api_key"], "secret": ["api_key"]},
}


def _admin_only(request: Request) -> None:
    auth = getattr(request.state, "auth", None) or {}
    if not auth.get("is_admin"):
        raise HTTPException(status_code=403, detail="Only an administrator can change keys.")


class KeyRequest(BaseModel):
    api_key: str = ""
    base_url: str = ""
    model: str = ""


class DataProviderRequest(BaseModel):
    fields: Dict[str, str] = {}


async def _row(db: AsyncSession, name: str) -> Optional[Connection]:
    rows = (await db.execute(select(Connection).where(Connection.group_name == GROUP))).scalars().all()
    return next((r for r in rows if (r.name or "").lower() == name.lower()), None)


async def _cfg(db: AsyncSession, name: str) -> Dict[str, Any]:
    row = await _row(db, name)
    return open_config(row.config if row and isinstance(row.config, dict) else {})


async def _save(db: AsyncSession, name: str, cfg: Dict[str, Any], secret: str) -> None:
    existing = await _row(db, name)
    masked = "••••" + secret[-4:] if secret else None
    if existing:
        existing.status, existing.api_key_masked, existing.config = "connected", masked, seal_config(cfg)
    else:
        db.add(Connection(id="c_" + uuid.uuid4().hex[:12], group_name=GROUP, name=name, status="connected", api_key_masked=masked, config=seal_config(cfg)))
    await db.commit()


async def _remove(db: AsyncSession, name: str) -> None:
    row = await _row(db, name)
    if row:
        await db.delete(row)
        await db.commit()


@router.get("")
async def status(db: AsyncSession = Depends(get_db)):
    """What this organisation has saved itself. Never returns a key."""
    out: Dict[str, Any] = {"keys": {}, "byo": {}, "data": {}}
    for pid, name in KEY_PROVIDERS.items():
        out["keys"][pid] = bool(config_get_secret(await _cfg(db, name), "api_key"))
    for bid, name in BYO_AI.items():
        cfg = await _cfg(db, name)
        out["byo"][bid] = {"connected": bool(cfg.get("api_key")), "base_url": cfg.get("base_url", ""), "model": cfg.get("model", "")}
    for pid, meta in DATA_PROVIDERS.items():
        cfg = await _cfg(db, meta["name"])
        ok = bool(cfg.get("saved"))
        out["data"][pid] = {"connected": ok, "verified": bool(ok and cfg.get("verified")),
                            "fields": {k: v for k, v in cfg.items() if k in meta["required"] and k not in meta["secret"]} if ok else {}}
    return out


@router.post("/key/{provider}", dependencies=[Depends(_admin_only)])
async def save_key(provider: str, req: KeyRequest, db: AsyncSession = Depends(get_db)):
    name = KEY_PROVIDERS.get((provider or "").lower())
    if not name:
        raise HTTPException(status_code=404, detail="Unknown provider.")
    key = (req.api_key or "").strip()
    if not key:
        raise HTTPException(status_code=400, detail="Paste your API key first.")
    res = await validate_api_key(provider=name, api_key=key)
    if not res.get("valid"):
        raise HTTPException(status_code=400, detail=res.get("error") or f"{name} did not accept this key.")
    await _save(db, name, {"provider": name, "api_key": key}, key)
    return {"success": True, "details": res.get("details") or "Key checked and saved."}


@router.post("/key/{provider}/test", dependencies=[Depends(_admin_only)])
async def test_key(provider: str, req: KeyRequest, db: AsyncSession = Depends(get_db)):
    name = KEY_PROVIDERS.get((provider or "").lower())
    if not name:
        raise HTTPException(status_code=404, detail="Unknown provider.")
    key = (req.api_key or "").strip() or config_get_secret(await _cfg(db, name), "api_key")
    if not key:
        raise HTTPException(status_code=400, detail="There is no key to test.")
    res = await validate_api_key(provider=name, api_key=key)
    if not res.get("valid"):
        raise HTTPException(status_code=400, detail=res.get("error") or f"{name} did not accept this key.")
    return {"success": True, "details": res.get("details") or "The key works."}


@router.delete("/key/{provider}", dependencies=[Depends(_admin_only)])
async def remove_key(provider: str, db: AsyncSession = Depends(get_db)):
    name = KEY_PROVIDERS.get((provider or "").lower())
    if not name:
        raise HTTPException(status_code=404, detail="Unknown provider.")
    await _remove(db, name)
    return {"success": True}


@router.post("/byo/{ai_id}", dependencies=[Depends(_admin_only)])
async def save_byo(ai_id: str, req: KeyRequest, db: AsyncSession = Depends(get_db)):
    """The organisation's own AI endpoint. The key is tested against the address it gave, then saved sealed."""
    name = BYO_AI.get(ai_id)
    if not name:
        raise HTTPException(status_code=404, detail="Unknown connector.")
    prev = await _cfg(db, name)
    key = (req.api_key or "").strip() or prev.get("api_key", "")
    base = (req.base_url or "").strip()
    if not base.lower().startswith("https://"):
        raise HTTPException(status_code=400, detail="The endpoint address must start with https://")
    if not key:
        raise HTTPException(status_code=400, detail="Paste your API key first.")
    model = (req.model or "").strip()
    res = await validate_api_key(provider=name, api_key=key, base_url=base, model=model or None, force_generic=True)
    if not res.get("valid"):
        raise HTTPException(status_code=400, detail=res.get("error") or "That endpoint did not accept the key.")
    await _save(db, name, {"provider": name, "api_key": key, "base_url": base, "model": model}, key)
    return {"success": True, "details": res.get("details") or "Checked and saved."}


@router.delete("/byo/{ai_id}", dependencies=[Depends(_admin_only)])
async def remove_byo(ai_id: str, db: AsyncSession = Depends(get_db)):
    name = BYO_AI.get(ai_id)
    if not name:
        raise HTTPException(status_code=404, detail="Unknown connector.")
    await _remove(db, name)
    return {"success": True}


@router.post("/data/{provider}", dependencies=[Depends(_admin_only)])
async def save_data_provider(provider: str, req: DataProviderRequest, db: AsyncSession = Depends(get_db)):
    """Experian is checked by asking for a token. Market Location gives no public way to check, so it is saved untested."""
    meta = DATA_PROVIDERS.get((provider or "").lower())
    if not meta:
        raise HTTPException(status_code=404, detail="Unknown data provider.")
    prev = await _cfg(db, meta["name"])
    fields = {k: (v or "").strip() for k, v in (req.fields or {}).items() if k in meta["required"]}
    for k in meta["required"]:  # a blank secret keeps the saved one
        if not fields.get(k) and prev.get(k):
            fields[k] = prev[k]
    missing = [k.replace("_", " ") for k in meta["required"] if not fields.get(k)]
    if missing:
        raise HTTPException(status_code=400, detail="Please fill in: " + ", ".join(missing) + ".")
    verified = False
    if meta["name"] == "Experian":
        host = EXPERIAN_HOSTS.get(fields["environment"])
        if not host:
            raise HTTPException(status_code=400, detail="Choose Sandbox or Live.")
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                res = await client.post(f"{host}/oauth2/v1/token", json={k: fields[k] for k in ("username", "password", "client_id", "client_secret")},
                                        headers={"Content-Type": "application/json", "Grant_type": "password"})
            token = "access_token" in res.json() if res.status_code == 200 else False
        except Exception:
            raise HTTPException(status_code=400, detail="Could not reach Experian, or it did not accept these details. Check them and try again.")
        if not token:
            raise HTTPException(status_code=400, detail="Experian did not accept these details. Check the username, password, client ID and client secret.")
        verified = True
    elif not fields["base_url"].lower().startswith("https://"):
        raise HTTPException(status_code=400, detail="The API address must start with https://")
    secret = next((fields[k] for k in meta["secret"][::-1] if fields.get(k)), "")
    await _save(db, meta["name"], {**fields, "saved": True, "verified": verified, "provider": meta["name"]}, secret)
    return {"success": True, "verified": verified,
            "details": "Checked with Experian and saved." if verified else "Saved. Market Location gives no way to check this, so it is not tested."}


@router.delete("/data/{provider}", dependencies=[Depends(_admin_only)])
async def remove_data_provider(provider: str, db: AsyncSession = Depends(get_db)):
    meta = DATA_PROVIDERS.get((provider or "").lower())
    if not meta:
        raise HTTPException(status_code=404, detail="Unknown data provider.")
    await _remove(db, meta["name"])
    return {"success": True}
