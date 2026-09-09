import os
import json
import logging
from typing import Dict, Any, List, Optional
import httpx
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.models.models import Connection, CompanyProfile

logger = logging.getLogger("llm_gateway")

async def resolve_llm_credentials(
    db: Optional[AsyncSession] = None,
    api_key: Optional[str] = None,
    provider: Optional[str] = None,
    model: Optional[str] = None,
    base_url: Optional[str] = None
) -> Dict[str, Any]:
    """
    Resolves API credentials from request parameters, database connections, or environment variables.
    """
    prov = (provider or "").strip().lower()
    key = (api_key or "").strip()
    burl = (base_url or "").strip() or None
    mod = (model or "").strip() or None

    # If explicit key was passed in request, use it!
    if key:
        return {
            "provider": prov or "custom",
            "api_key": key,
            "base_url": burl,
            "model": mod
        }

    # Otherwise query DB for any saved Connection in LLM group
    if db is not None:
        try:
            res = await db.execute(select(Connection).where(Connection.group_name == "LLM"))
            conns = res.scalars().all()

            # Prefer connected provider
            for c in conns:
                cfg = c.config or {}
                k = (cfg.get("api_key") or cfg.get("apiKey") or "").strip()
                if k and c.status == "connected":
                    return {
                        "provider": c.name.lower(),
                        "api_key": k,
                        "base_url": cfg.get("base_url") or cfg.get("baseUrl") or burl,
                        "model": mod or cfg.get("model")
                    }

            # Next check any with non-empty key
            for c in conns:
                cfg = c.config or {}
                k = (cfg.get("api_key") or cfg.get("apiKey") or "").strip()
                if k:
                    return {
                        "provider": c.name.lower(),
                        "api_key": k,
                        "base_url": cfg.get("base_url") or cfg.get("baseUrl") or burl,
                        "model": mod or cfg.get("model")
                    }
        except Exception as e:
            logger.warning(f"Failed to query DB for LLM connections: {e}")

    # Fallback to standard environment variables
    env_keys = [
        ("deepseek", "DEEPSEEK_API_KEY", "https://api.deepseek.com", "deepseek-chat"),
        ("openai", "OPENAI_API_KEY", "https://api.openai.com/v1", "gpt-4o"),
        ("anthropic", "ANTHROPIC_API_KEY", "https://api.anthropic.com/v1", "claude-3-5-sonnet-20241022"),
        ("groq", "GROQ_API_KEY", "https://api.groq.com/openai/v1", "llama-3.3-70b-versatile"),
        ("xai", "XAI_API_KEY", "https://api.x.ai/v1", "grok-2-latest"),
    ]
    for p_name, env_var, default_url, default_model in env_keys:
        k = os.getenv(env_var, "").strip()
        if k:
            return {
                "provider": prov or p_name,
                "api_key": k,
                "base_url": burl or default_url,
                "model": mod or default_model
            }

    # Return whatever was provided (may be Ollama or unauthenticated local)
    return {
        "provider": prov or "ollama",
        "api_key": "",
        "base_url": burl or "http://localhost:11434/v1",
        "model": mod or "llama3.2"
    }


async def call_open_chat_llm(
    messages: List[Dict[str, str]],
    system_prompt: Optional[str] = None,
    api_key: Optional[str] = None,
    provider: Optional[str] = None,
    model: Optional[str] = None,
    base_url: Optional[str] = None,
    temperature: float = 0.7,
    max_tokens: int = 2048,
    db: Optional[AsyncSession] = None
) -> Dict[str, Any]:
    """
    Calls any LLM provider (OpenAI, DeepSeek, Anthropic, Groq, xAI, Ollama, custom)
    with full open-ended conversational freedom.
    """
    creds = await resolve_llm_credentials(
        db=db,
        api_key=api_key,
        provider=provider,
        model=model,
        base_url=base_url
    )

    resolved_provider = (creds.get("provider") or "openai").lower()
    resolved_key = creds.get("api_key") or ""
    resolved_base_url = creds.get("base_url")
    resolved_model = creds.get("model")

    # Default system prompt for open conversational partner
    effective_system = system_prompt or (
        "You are an expert autonomous AI partner in the AIVHub workspace. "
        "You have deep expertise in B2B business intelligence, outbound sales engineering, "
        "autonomous lead generation, copywriting, content scheduling, and software architecture. "
        "You provide open, thoughtful, highly capable, and articulate answers on ANY topic, "
        "without arbitrary restrictions. When discussing strategies, give actionable, specific advice."
    )

    # Clean messages list
    formatted_messages = []
    if effective_system:
        formatted_messages.append({"role": "system", "content": effective_system})

    for m in messages:
        role = m.get("role") or m.get("sender") or "user"
        if role in ["ai", "assistant", "bot"]:
            role = "assistant"
        elif role not in ["system", "assistant", "user"]:
            role = "user"
        content = m.get("content") or m.get("text") or ""
        if content.strip():
            formatted_messages.append({"role": role, "content": content})

    # If no user messages, return early
    if not any(m["role"] == "user" for m in formatted_messages):
        return {
            "success": False,
            "error": "No user message provided.",
            "reply": "Please enter a message to start chatting."
        }

    # If no key and not a local endpoint, inform user clearly
    is_local = "localhost" in str(resolved_base_url) or "127.0.0.1" in str(resolved_base_url) or "ollama" in resolved_provider
    if not resolved_key and not is_local:
        return {
            "success": False,
            "error": "Missing API Key",
            "reply": (
                "⚠️ **No AI API Key is currently configured.**\n\n"
                "Please configure an API key in the **AI Plugin Configuration** window (e.g. OpenAI, DeepSeek, Anthropic Claude, Groq, or xAI), "
                "or start Ollama on `http://localhost:11434` for private local models."
            ),
            "model": resolved_model or "None",
            "provider": resolved_provider
        }

    # 1. ANTHROPIC CLAUDE DIRECT
    if "anthropic" in resolved_provider or "claude" in resolved_provider:
        return await _call_anthropic(
            messages=formatted_messages,
            api_key=resolved_key,
            model=resolved_model or "claude-3-5-sonnet-20241022",
            temperature=temperature,
            max_tokens=max_tokens
        )

    # 2. OPENAI / DEEPSEEK / GROQ / XAI / OLLAMA / CUSTOM OPENAI-COMPATIBLE
    return await _call_openai_compatible(
        messages=formatted_messages,
        api_key=resolved_key,
        provider=resolved_provider,
        model=resolved_model,
        base_url=resolved_base_url,
        temperature=temperature,
        max_tokens=max_tokens
    )


async def _call_anthropic(
    messages: List[Dict[str, str]],
    api_key: str,
    model: str,
    temperature: float,
    max_tokens: int
) -> Dict[str, Any]:
    system_text = ""
    chat_history = []
    for m in messages:
        if m["role"] == "system":
            system_text += m["content"] + "\n\n"
        else:
            chat_history.append({"role": m["role"], "content": m["content"]})

    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
    }
    payload = {
        "model": model or "claude-3-5-sonnet-20241022",
        "max_tokens": max_tokens,
        "temperature": temperature,
        "messages": chat_history
    }
    if system_text.strip():
        payload["system"] = system_text.strip()

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(45.0, connect=10.0)) as client:
            res = await client.post("https://api.anthropic.com/v1/messages", headers=headers, json=payload)
            if res.status_code == 200:
                data = res.json()
                text = "".join([block.get("text", "") for block in data.get("content", [])])
                return {
                    "success": True,
                    "reply": text.strip(),
                    "model": data.get("model", model),
                    "provider": "anthropic"
                }
            else:
                err_text = res.text[:300]
                logger.error(f"Anthropic error {res.status_code}: {err_text}")
                return {
                    "success": False,
                    "error": f"Anthropic API error ({res.status_code}): {err_text}",
                    "reply": f"⚠️ Anthropic Error: {err_text}"
                }
    except Exception as e:
        logger.error(f"Anthropic call failed: {e}")
        return {"success": False, "error": str(e), "reply": f"⚠️ Anthropic connection failed: {e}"}


async def _call_openai_compatible(
    messages: List[Dict[str, str]],
    api_key: str,
    provider: str,
    model: Optional[str],
    base_url: Optional[str],
    temperature: float,
    max_tokens: int
) -> Dict[str, Any]:
    prov = provider.lower()
    
    # Determine base endpoint and model
    if base_url:
        endpoint = base_url.rstrip("/")
        if not endpoint.endswith("/chat/completions"):
            endpoint += "/chat/completions"
        target_model = model or "gpt-4o-mini"
    elif "deepseek" in prov:
        endpoint = "https://api.deepseek.com/chat/completions"
        target_model = model or "deepseek-chat"
    elif "groq" in prov:
        endpoint = "https://api.groq.com/openai/v1/chat/completions"
        target_model = model or "llama-3.3-70b-versatile"
    elif "xai" in prov or "grok" in prov:
        endpoint = "https://api.x.ai/v1/chat/completions"
        target_model = model or "grok-2-latest"
    elif "ollama" in prov:
        endpoint = "http://localhost:11434/v1/chat/completions"
        target_model = model or "llama3.2"
    else:
        endpoint = "https://api.openai.com/v1/chat/completions"
        target_model = model or "gpt-4o"

    headers = {
        "Content-Type": "application/json"
    }
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    payload = {
        "model": target_model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens
    }

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(45.0, connect=10.0)) as client:
            res = await client.post(endpoint, headers=headers, json=payload)
            if res.status_code == 200:
                data = res.json()
                content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
                return {
                    "success": True,
                    "reply": content.strip(),
                    "model": data.get("model", target_model),
                    "provider": provider
                }
            else:
                err_text = res.text[:300]
                logger.error(f"LLM API error ({endpoint}) status {res.status_code}: {err_text}")
                return {
                    "success": False,
                    "error": f"API returned status {res.status_code}: {err_text}",
                    "reply": f"⚠️ LLM Error ({res.status_code}): {err_text}"
                }
    except Exception as e:
        logger.error(f"LLM request to {endpoint} failed: {e}")
        return {
            "success": False,
            "error": str(e),
            "reply": f"⚠️ Could not reach AI endpoint ({endpoint}): {e}"
        }
