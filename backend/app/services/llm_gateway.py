import os
import json
import logging
from typing import Dict, Any, List, Optional, AsyncGenerator
import httpx
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.models.models import Connection, CompanyProfile

logger = logging.getLogger("llm_gateway")

_llm_http_client: Optional[httpx.AsyncClient] = None

def _get_llm_client() -> httpx.AsyncClient:
    """Returns a module-level persistent HTTP client with connection pooling to eliminate TLS handshake latency."""
    global _llm_http_client
    if _llm_http_client is None or _llm_http_client.is_closed:
        _llm_http_client = httpx.AsyncClient(
            timeout=httpx.Timeout(45.0, connect=10.0),
            limits=httpx.Limits(max_keepalive_connections=20, max_connections=50, keepalive_expiry=60.0),
        )
    return _llm_http_client

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
    from app.services.secret_box import reject_if_masked, config_get_secret

    prov = (provider or "").strip().lower()
    key = reject_if_masked(api_key)
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

    # Otherwise query DB for any saved Connection, restricted to the LLM group only -
    # a Telephony/Calendar/etc. connection's key must never be sent to a chat LLM API.
    if db is not None:
        try:
            res = await db.execute(select(Connection).where(Connection.group_name == "LLM"))
            conns = res.scalars().all()

            # 1. Exact or partial match on provider name if provider was requested
            if prov:
                for c in conns:
                    cfg = c.config or {}
                    k = config_get_secret(cfg, "api_key", "apiKey", "auth_token")
                    c_name = c.name.lower()
                    cfg_prov = str(cfg.get("provider", "")).lower()
                    if k and (prov in c_name or c_name in prov or prov in cfg_prov):
                        return {
                            "provider": prov,
                            "api_key": k,
                            "base_url": cfg.get("base_url") or cfg.get("baseUrl") or burl,
                            "model": mod or cfg.get("model")
                        }

            # 2. Prefer a connected LLM-group provider
            for c in conns:
                cfg = c.config or {}
                k = config_get_secret(cfg, "api_key", "apiKey", "auth_token")
                if k and c.status == "connected":
                    c_prov = (cfg.get("provider") or c.name.lower()).strip()
                    if "dall-e" in c_prov or "openai" in c_prov:
                        c_prov = "openai"
                    return {
                        "provider": c_prov,
                        "api_key": k,
                        "base_url": cfg.get("base_url") or cfg.get("baseUrl") or burl,
                        "model": mod or cfg.get("model") or "gpt-4o-mini"
                    }

            # 3. Next check any LLM-group connection with a non-empty key
            for c in conns:
                cfg = c.config or {}
                k = config_get_secret(cfg, "api_key", "apiKey", "auth_token")
                if k:
                    c_prov = (cfg.get("provider") or c.name.lower()).strip()
                    if "dall-e" in c_prov or "openai" in c_prov:
                        c_prov = "openai"
                    return {
                        "provider": c_prov,
                        "api_key": k,
                        "base_url": cfg.get("base_url") or cfg.get("baseUrl") or burl,
                        "model": mod or cfg.get("model") or "gpt-4o-mini"
                    }
        except Exception as e:
            logger.warning(f"Failed to query DB for LLM connections: {e}")

    # Fallback to standard environment variables
    prov_env_map = {
        "openai": ("OPENAI_API_KEY", "https://api.openai.com/v1", "gpt-4o-mini"),
        "deepseek": ("DEEPSEEK_API_KEY", "https://api.deepseek.com", "deepseek-chat"),
        "anthropic": ("ANTHROPIC_API_KEY", "https://api.anthropic.com/v1", "claude-3-5-sonnet-20241022"),
        "groq": ("GROQ_API_KEY", "https://api.groq.com/openai/v1", "llama-3.3-70b-versatile"),
        "xai": ("XAI_API_KEY", "https://api.x.ai/v1", "grok-4.20-0309-non-reasoning"),
        "telnyx": ("TELNYX_API_KEY", "https://api.telnyx.com/v2/ai", "meta-llama/Meta-Llama-3.1-70B-Instruct"),
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
        "model": mod or "gpt-4o-mini"
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
        "telnyx llama 3.1 70b": "meta-llama/Meta-Llama-3.1-70B-Instruct",
        "telnyx llama 3.1 8b": "meta-llama/Meta-Llama-3.1-8B-Instruct",
        "telnyx deepseek r1": "deepseek-ai/DeepSeek-R1-Distill-Llama-70B",
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
            norm_model = "grok-4.20-0309-non-reasoning"
        elif "telnyx" in resolved_provider:
            norm_model = "meta-llama/Meta-Llama-3.1-70B-Instruct"
        else:
            norm_model = "gpt-4o-mini"

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


def _resolve_endpoint_and_model(prov: str, model: Optional[str], base_url: Optional[str]) -> tuple[str, str]:
    """Maps a provider name (+ optional explicit base_url/model) to an OpenAI-compatible chat endpoint + model slug."""
    prov = (prov or "").lower()
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
    elif "telnyx" in prov:
        endpoint = "https://api.telnyx.com/v2/ai/chat/completions"
        target_model = model or "meta-llama/Meta-Llama-3.1-70B-Instruct"
    elif ("xai" in prov or "grok" in prov) and "telnyx" not in prov:
        endpoint = "https://api.x.ai/v1/chat/completions"
        target_model = model or "grok-4.20-0309-non-reasoning"
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
        target_model = model or "gpt-4o-mini"
    return endpoint, target_model


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
    endpoint, target_model = _resolve_endpoint_and_model(prov, model, base_url)

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


def _convert_openai_tools_to_anthropic(tools: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Converts OpenAI-formatted tool schemas into Anthropic input_schema format."""
    anthropic_tools = []
    for t in tools:
        fn = t.get("function") if t.get("type") == "function" else t
        if not fn or not isinstance(fn, dict):
            continue
        anthropic_tools.append({
            "name": fn.get("name", ""),
            "description": fn.get("description", ""),
            "input_schema": fn.get("parameters", {"type": "object", "properties": {}})
        })
    return anthropic_tools


async def call_open_chat_llm_with_tools(
    messages: List[Dict[str, str]],
    tools: List[Dict[str, Any]],
    system_prompt: Optional[str] = None,
    api_key: Optional[str] = None,
    provider: Optional[str] = None,
    model: Optional[str] = None,
    base_url: Optional[str] = None,
    temperature: float = 0.3,
    max_tokens: int = 300,
    tool_choice: str = "auto",
    db: Optional[AsyncSession] = None
) -> Dict[str, Any]:
    """
    Non-streaming OpenAI-compatible & Anthropic chat completion WITH function/tool-calling support.
    Returns {"success", "reply", "tool_calls", "model", "provider"}.
    Anthropic returns normalized OpenAI-shaped tool_calls so callers get consistent objects.
    """
    creds = await resolve_llm_credentials(db=db, api_key=api_key, provider=provider, model=model, base_url=base_url)
    resolved_provider = (creds.get("provider") or "openai").lower()
    resolved_key = creds.get("api_key") or ""
    resolved_base_url = creds.get("base_url")
    resolved_model = creds.get("model")

    if not resolved_key:
        return {"success": False, "error": "Missing API key", "tool_calls": [], "reply": ""}

    if "anthropic" in resolved_provider or "claude" in resolved_provider:
        system_text = (system_prompt or "").strip()
        chat_history = []
        for m in messages:
            role = m.get("role") or "user"
            content = m.get("content") or ""
            if not content.strip():
                continue
            if role == "system":
                system_text += ("\n\n" if system_text else "") + content
            else:
                if role in ["ai", "assistant", "bot"]:
                    role = "assistant"
                elif role not in ["assistant", "user"]:
                    role = "user"
                chat_history.append({"role": role, "content": content})

        anthropic_tools = _convert_openai_tools_to_anthropic(tools)
        headers = {
            "x-api-key": resolved_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json"
        }
        target_model = resolved_model or "claude-3-5-sonnet-20241022"
        payload = {
            "model": target_model,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "messages": chat_history,
            "tools": anthropic_tools,
        }
        if system_text:
            payload["system"] = system_text

        try:
            client = _get_llm_client()
            res = await client.post("https://api.anthropic.com/v1/messages", headers=headers, json=payload)
            if res.status_code != 200:
                err_text = res.text[:300]
                logger.error(f"[TOOLS] Anthropic API error status {res.status_code}: {err_text}")
                return {"success": False, "error": f"Anthropic error ({res.status_code}): {err_text}", "tool_calls": [], "reply": ""}
            data = res.json()
            content_blocks = data.get("content", [])
            text_parts = []
            tool_calls = []
            for block in content_blocks:
                btype = block.get("type")
                if btype == "text":
                    text_parts.append(block.get("text", ""))
                elif btype == "tool_use":
                    tool_calls.append({
                        "id": block.get("id", ""),
                        "type": "function",
                        "function": {
                            "name": block.get("name", ""),
                            "arguments": json.dumps(block.get("input") or {})
                        }
                    })
            return {
                "success": True,
                "reply": "".join(text_parts).strip(),
                "tool_calls": tool_calls,
                "model": data.get("model", target_model),
                "provider": "anthropic"
            }
        except Exception as e:
            logger.error(f"[TOOLS] Anthropic tool-call request failed: {e}")
            return {"success": False, "error": str(e), "tool_calls": [], "reply": ""}

    formatted_messages = []
    if system_prompt:
        formatted_messages.append({"role": "system", "content": system_prompt})
    for m in messages:
        role = m.get("role") or "user"
        if role in ["ai", "assistant", "bot"]:
            role = "assistant"
        elif role not in ["system", "assistant", "user"]:
            role = "user"
        content = m.get("content") or ""
        if content.strip():
            formatted_messages.append({"role": role, "content": content})

    endpoint, target_model = _resolve_endpoint_and_model(resolved_provider, resolved_model, resolved_base_url)

    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {resolved_key}"}
    payload = {
        "model": target_model,
        "messages": formatted_messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "tools": tools,
        "tool_choice": tool_choice,
    }

    try:
        client = _get_llm_client()
        res = await client.post(endpoint, headers=headers, json=payload)
        if res.status_code != 200:
            err_text = res.text[:300]
            logger.error(f"[TOOLS] LLM API error ({endpoint}) status {res.status_code}: {err_text}")
            return {"success": False, "error": f"API returned status {res.status_code}: {err_text}", "tool_calls": [], "reply": ""}
        data = res.json()
        message = data.get("choices", [{}])[0].get("message", {}) or {}
        return {
            "success": True,
            "reply": message.get("content") or "",
            "tool_calls": message.get("tool_calls") or [],
            "model": data.get("model", target_model),
            "provider": resolved_provider,
        }
    except Exception as e:
        logger.error(f"[TOOLS] LLM tool-call request to {endpoint} failed: {e}")
        return {"success": False, "error": str(e), "tool_calls": [], "reply": ""}


async def stream_open_chat_llm(
    messages: List[Dict[str, str]],
    system_prompt: Optional[str] = None,
    api_key: Optional[str] = None,
    provider: Optional[str] = None,
    model: Optional[str] = None,
    base_url: Optional[str] = None,
    temperature: float = 0.7,
    max_tokens: int = 2048,
    db: Optional[AsyncSession] = None
) -> AsyncGenerator[str, None]:
    """
    Streams LLM token chunks in real-time from any supported provider (OpenAI, DeepSeek, Groq, xAI, Anthropic, Ollama).
    Yields string deltas as they arrive.
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

    effective_system = system_prompt or (
        "You are an expert autonomous AI partner in the AIVHub workspace."
    )

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

    if not any(m["role"] == "user" for m in formatted_messages):
        return

    # Normalize vendor model names
    norm_model = (resolved_model or "").strip()
    friendly_slug_map = {
        "claude 3.5 sonnet": "claude-3-5-sonnet-20241022",
        "claude 3.7 sonnet": "claude-3-7-sonnet-20250219",
        "claude 3.5 haiku": "claude-3-5-haiku-20241022",
        "deepseek-v3": "deepseek-chat",
        "deepseek-r1": "deepseek-reasoner",
        "groq llama 3.3 70b": "llama-3.3-70b-versatile",
        "xai grok-2": "grok-2-latest",
        "telnyx llama 3.1 70b": "meta-llama/Meta-Llama-3.1-70B-Instruct",
        "telnyx llama 3.1 8b": "meta-llama/Meta-Llama-3.1-8B-Instruct",
        "telnyx deepseek r1": "deepseek-ai/DeepSeek-R1-Distill-Llama-70B",
    }
    if norm_model.lower() in friendly_slug_map:
        norm_model = friendly_slug_map[norm_model.lower()]

    if not norm_model:
        if "anthropic" in resolved_provider or "claude" in resolved_provider:
            norm_model = "claude-3-5-sonnet-20241022"
        elif "deepseek" in resolved_provider:
            norm_model = "deepseek-chat"
        elif "groq" in resolved_provider:
            norm_model = "llama-3.3-70b-versatile"
        elif "xai" in resolved_provider or "grok" in resolved_provider:
            norm_model = "grok-4.20-0309-non-reasoning"
        elif "telnyx" in resolved_provider:
            norm_model = "meta-llama/Meta-Llama-3.1-70B-Instruct"
        else:
            norm_model = "gpt-4o-mini"

    resolved_model = norm_model

    if "anthropic" in resolved_provider or "claude" in resolved_provider:
        async for chunk in _stream_anthropic(
            messages=formatted_messages,
            api_key=resolved_key,
            model=resolved_model,
            temperature=temperature,
            max_tokens=max_tokens
        ):
            yield chunk
        return

    async for chunk in _stream_openai_compatible(
        messages=formatted_messages,
        api_key=resolved_key,
        provider=resolved_provider,
        model=resolved_model,
        base_url=resolved_base_url,
        temperature=temperature,
        max_tokens=max_tokens
    ):
        yield chunk


async def _stream_anthropic(
    messages: List[Dict[str, str]],
    api_key: str,
    model: str,
    temperature: float,
    max_tokens: int
) -> AsyncGenerator[str, None]:
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
        "messages": chat_history,
        "stream": True
    }
    if system_text.strip():
        payload["system"] = [
            {
                "type": "text",
                "text": system_text.strip(),
                "cache_control": {"type": "ephemeral"}
            }
        ]

    try:
        client = _get_llm_client()
        async with client.stream("POST", "https://api.anthropic.com/v1/messages", headers=headers, json=payload) as response:
            if response.status_code != 200:
                err_body = await response.aread()
                logger.error(f"[STREAM] Anthropic error {response.status_code}: {err_body.decode(errors='ignore')[:200]}")
                return
            async for line in response.aiter_lines():
                line = line.strip()
                if not line or not line.startswith("data:"):
                    continue
                data_str = line[5:].strip()
                if not data_str:
                    continue
                try:
                    ev = json.loads(data_str)
                    ev_type = ev.get("type")
                    if ev_type == "content_block_delta":
                        text_delta = ev.get("delta", {}).get("text", "")
                        if text_delta:
                            yield text_delta
                except Exception:
                    continue
    except Exception as e:
        logger.error(f"[STREAM] Anthropic stream error: {e}")


async def _stream_openai_compatible(
    messages: List[Dict[str, str]],
    api_key: str,
    provider: str,
    model: Optional[str],
    base_url: Optional[str],
    temperature: float,
    max_tokens: int
) -> AsyncGenerator[str, None]:
    prov = provider.lower()
    endpoint, target_model = _resolve_endpoint_and_model(prov, model, base_url)

    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    payload = {
        "model": target_model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": True
    }

    try:
        client = _get_llm_client()
        async with client.stream("POST", endpoint, headers=headers, json=payload) as response:
            if response.status_code != 200:
                err_body = await response.aread()
                logger.error(f"[STREAM] {prov} error {response.status_code}: {err_body.decode(errors='ignore')[:200]}")
                return
            async for line in response.aiter_lines():
                line = line.strip()
                if not line or not line.startswith("data:"):
                    continue
                data_str = line[5:].strip()
                if data_str == "[DONE]":
                    break
                try:
                    chunk = json.loads(data_str)
                    choices = chunk.get("choices") or []
                    if choices:
                        delta = choices[0].get("delta", {}).get("content", "")
                        if delta:
                            yield delta
                except Exception:
                    continue
    except Exception as e:
        logger.error(f"[STREAM] OpenAI compatible stream ({endpoint}) failed: {e}")

