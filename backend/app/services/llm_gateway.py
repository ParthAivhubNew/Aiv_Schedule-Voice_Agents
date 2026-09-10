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

    # Normalize common provider aliases if provided
    if "claude" in prov:
        prov = "anthropic"
    elif "chatgpt" in prov or "gpt" in prov:
        prov = "openai"
    elif "grok" in prov:
        prov = "xai"

    # If explicit key was passed in request, use it directly!
    if key:
        return {
            "provider": prov or "openai",
            "api_key": key,
            "base_url": burl,
            "model": mod
        }

    # Otherwise query DB for any saved Connection
    if db is not None:
        try:
            res = await db.execute(select(Connection))
            conns = res.scalars().all()

            # 1. Exact or partial match on provider name if provider was requested
            if prov:
                for c in conns:
                    cfg = c.config or {}
                    k = (cfg.get("api_key") or cfg.get("apiKey") or "").strip()
                    c_name = c.name.lower()
                    cfg_prov = str(cfg.get("provider", "")).lower()
                    if k and (prov in c_name or c_name in prov or prov in cfg_prov):
                        return {
                            "provider": prov,
                            "api_key": k,
                            "base_url": cfg.get("base_url") or cfg.get("baseUrl") or burl,
                            "model": mod or cfg.get("model")
                        }

            # 2. Prefer connected provider in LLM, Social, Scheduler, or Image groups
            for c in conns:
                cfg = c.config or {}
                k = (cfg.get("api_key") or cfg.get("apiKey") or "").strip()
                if k and c.status == "connected":
                    c_prov = (cfg.get("provider") or c.name.lower()).strip()
                    if "dall-e" in c_prov or "openai" in c_prov:
                        c_prov = "openai"
                    return {
                        "provider": c_prov,
                        "api_key": k,
                        "base_url": cfg.get("base_url") or cfg.get("baseUrl") or burl,
                        "model": "gpt-4o" if c_prov == "openai" else (mod or cfg.get("model"))
                    }

            # 3. Next check any connection with a non-empty key
            for c in conns:
                cfg = c.config or {}
                k = (cfg.get("api_key") or cfg.get("apiKey") or "").strip()
                if k:
                    c_prov = (cfg.get("provider") or c.name.lower()).strip()
                    if "dall-e" in c_prov or "openai" in c_prov:
                        c_prov = "openai"
                    return {
                        "provider": c_prov,
                        "api_key": k,
                        "base_url": cfg.get("base_url") or cfg.get("baseUrl") or burl,
                        "model": "gpt-4o" if c_prov == "openai" else (mod or cfg.get("model"))
                    }
        except Exception as e:
            logger.warning(f"Failed to query DB for LLM connections: {e}")

    # Fallback to standard environment variables
    prov_env_map = {
        "openai": ("OPENAI_API_KEY", "https://api.openai.com/v1", "gpt-4o"),
        "deepseek": ("DEEPSEEK_API_KEY", "https://api.deepseek.com", "deepseek-chat"),
        "anthropic": ("ANTHROPIC_API_KEY", "https://api.anthropic.com/v1", "claude-3-5-sonnet-20241022"),
        "groq": ("GROQ_API_KEY", "https://api.groq.com/openai/v1", "llama-3.3-70b-versatile"),
        "xai": ("XAI_API_KEY", "https://api.x.ai/v1", "grok-2-latest"),
    }

    if prov in prov_env_map:
        env_var, default_url, default_model = prov_env_map[prov]
        k = os.getenv(env_var, "").strip()
        if k and (env_var != "ANTHROPIC_API_KEY" or k.startswith("sk-ant-")):
            return {
                "provider": prov,
                "api_key": k,
                "base_url": burl or default_url,
                "model": mod or default_model
            }

    # If requested provider has no key in env, check if ANY other provider has an active key in env!
    for p_name, (env_var, default_url, default_model) in prov_env_map.items():
        k = os.getenv(env_var, "").strip()
        if k and (env_var != "ANTHROPIC_API_KEY" or k.startswith("sk-ant-")):
            return {
                "provider": p_name,
                "api_key": k,
                "base_url": burl or default_url,
                "model": mod or default_model
            }

    # Return whatever was provided without pretending to have a key
    return {
        "provider": prov or "openai",
        "api_key": "",
        "base_url": burl or "",
        "model": mod or "gpt-4o"
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

    if isinstance(messages, str):
        messages = [{"role": "user", "content": messages}]

    for m in messages:
        if isinstance(m, str):
            if m.strip():
                formatted_messages.append({"role": "user", "content": m.strip()})
            continue
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

    # If no key and not an explicit local endpoint, inform user immediately without buffering
    is_local = bool(resolved_base_url and ("localhost" in str(resolved_base_url) or "127.0.0.1" in str(resolved_base_url)))
    if not resolved_key and not is_local:
        prov_display = resolved_provider.upper() if resolved_provider else "AI"
        return {
            "success": False,
            "error": f"Missing {prov_display} API Key",
            "reply": (
                f"⚠️ **No active API key configured for {prov_display}.**\n\n"
                "Please configure and save your API key in **Post Scheduler AI Config** (or the Global AI Config window) to activate real-time chat and planning."
            ),
            "model": resolved_model or "None",
            "provider": resolved_provider
        }

    # Normalize vendor model names so user-friendly names (e.g. 'Claude 3.5 Sonnet', 'GPT-4o') match provider APIs
    norm_model = (resolved_model or "").strip()

    # Map friendly display labels to exact API slugs if needed (e.g. 'Claude 3.5 Sonnet' -> 'claude-3-5-sonnet-20241022')
    friendly_slug_map = {
        "claude 3.5 sonnet": "claude-3-5-sonnet-20241022",
        "claude 3.7 sonnet": "claude-3-7-sonnet-20250219",
        "claude 3.5 haiku": "claude-3-5-haiku-20241022",
        "deepseek-v3": "deepseek-chat",
        "deepseek-r1": "deepseek-reasoner",
        "groq llama 3.3 70b": "llama-3.3-70b-versatile",
        "xai grok-2": "grok-2-latest",
    }
    if norm_model.lower() in friendly_slug_map:
        norm_model = friendly_slug_map[norm_model.lower()]

    # If no model was specified at all, supply a provider default
    if not norm_model:
        if "anthropic" in resolved_provider or "claude" in resolved_provider:
            norm_model = "claude-3-5-sonnet-20241022"
        elif "deepseek" in resolved_provider:
            norm_model = "deepseek-chat"
        elif "groq" in resolved_provider:
            norm_model = "llama-3.3-70b-versatile"
        elif "xai" in resolved_provider or "grok" in resolved_provider:
            norm_model = "grok-2-latest"
        else:
            norm_model = "gpt-4o"

    resolved_model = norm_model

    if "anthropic" in resolved_provider or "claude" in resolved_provider:
        return await _call_anthropic(
            messages=formatted_messages,
            api_key=resolved_key,
            model=resolved_model,
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
        if "generativelanguage.googleapis.com" in endpoint and not endpoint.endswith("/openai"):
            endpoint += "/openai"
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
    elif "gemini" in prov or "google" in prov:
        endpoint = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
        target_model = model or "gemini-1.5-flash"
    elif "openrouter" in prov:
        endpoint = "https://openrouter.ai/api/v1/chat/completions"
        target_model = model or "meta-llama/llama-3.3-70b-instruct"
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
