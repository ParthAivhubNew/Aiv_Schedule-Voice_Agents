import httpx
import logging
from typing import Dict, Any, Optional

logger = logging.getLogger("key_validator")

async def validate_api_key(
    provider: str,
    api_key: str,
    base_url: Optional[str] = None,
    account_sid: Optional[str] = None
) -> Dict[str, Any]:
    """
    Performs a real-time live probe to the provider's official API endpoint
    to verify that the supplied credentials are authentic and authorized.
    """
    p = provider.lower().replace(" ", "").replace("-", "").replace(".", "")
    api_key = api_key.strip()

    if not api_key:
        return {"valid": False, "error": "API Key cannot be empty."}

    timeout = httpx.Timeout(8.0, connect=5.0)

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            # 1. DeepSeek
            if "deepseek" in p:
                url = (base_url or "https://api.deepseek.com").rstrip("/") + "/models"
                headers = {"Authorization": f"Bearer {api_key}", "Accept": "application/json"}
                res = await client.get(url, headers=headers)
                if res.status_code == 200:
                    return {"valid": True, "provider": "DeepSeek", "details": "Authenticated successfully (DeepSeek-V3 / DeepSeek-R1 ready)."}
                elif res.status_code == 401:
                    return {"valid": False, "error": "DeepSeek authentication failed (Invalid API key - 401 Unauthorized)."}
                elif res.status_code == 402:
                    return {"valid": False, "error": "DeepSeek account has insufficient balance / credits (402 Payment Required)."}
                else:
                    return {"valid": False, "error": f"DeepSeek returned status {res.status_code}: {res.text[:150]}"}

            # 2. OpenAI
            elif "openai" in p or "chatgpt" in p:
                url = (base_url or "https://api.openai.com/v1").rstrip("/") + "/models"
                headers = {"Authorization": f"Bearer {api_key}"}
                res = await client.get(url, headers=headers)
                if res.status_code == 200:
                    return {"valid": True, "provider": "OpenAI", "details": "Authenticated successfully (GPT-4o / Whisper / TTS ready)."}
                elif res.status_code == 401:
                    return {"valid": False, "error": "OpenAI authentication failed (Invalid API key - 401 Unauthorized)."}
                else:
                    return {"valid": False, "error": f"OpenAI returned status {res.status_code}: {res.text[:150]}"}

            # 3. Anthropic (Claude)
            elif "anthropic" in p or "claude" in p:
                url = "https://api.anthropic.com/v1/models"
                headers = {
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json"
                }
                res = await client.get(url, headers=headers)
                if res.status_code == 200:
                    return {"valid": True, "provider": "Anthropic", "details": "Authenticated successfully (Claude 3.5 Sonnet ready)."}
                elif res.status_code == 401:
                    return {"valid": False, "error": "Anthropic authentication failed (Invalid x-api-key)."}
                else:
                    return {"valid": False, "error": f"Anthropic returned status {res.status_code}: {res.text[:150]}"}

            # 4. Deepgram (Speech-to-Text)
            elif "deepgram" in p:
                url = "https://api.deepgram.com/v1/projects"
                headers = {"Authorization": f"Token {api_key}"}
                res = await client.get(url, headers=headers)
                if res.status_code == 200:
                    return {"valid": True, "provider": "Deepgram", "details": "Authenticated successfully (Nova-2 STT stream ready)."}
                elif res.status_code in [401, 403]:
                    return {"valid": False, "error": "Deepgram authentication failed (Invalid Token - 401/403)."}
                else:
                    return {"valid": False, "error": f"Deepgram returned status {res.status_code}: {res.text[:150]}"}

            # 5. ElevenLabs (Text-to-Speech)
            elif "elevenlabs" in p:
                url = "https://api.elevenlabs.io/v1/user"
                headers = {"xi-api-key": api_key}
                res = await client.get(url, headers=headers)
                if res.status_code == 200:
                    data = res.json()
                    tier = data.get("subscription", {}).get("tier", "active")
                    return {"valid": True, "provider": "ElevenLabs", "details": f"Authenticated successfully (Tier: {tier})."}
                elif res.status_code in [401, 403]:
                    return {"valid": False, "error": "ElevenLabs authentication failed (Invalid xi-api-key)."}
                else:
                    return {"valid": False, "error": f"ElevenLabs returned status {res.status_code}: {res.text[:150]}"}

            # 6. Cartesia (Ultra-fast Voice TTS)
            elif "cartesia" in p:
                url = "https://api.cartesia.ai/voices"
                headers = {"X-API-Key": api_key, "Cartesia-Version": "2024-06-10"}
                res = await client.get(url, headers=headers)
                if res.status_code == 200:
                    return {"valid": True, "provider": "Cartesia", "details": "Authenticated successfully (Sonic 90ms TTS ready)."}
                elif res.status_code in [401, 403]:
                    return {"valid": False, "error": "Cartesia authentication failed (Invalid API Key)."}
                else:
                    return {"valid": False, "error": f"Cartesia returned status {res.status_code}: {res.text[:150]}"}

            # 7. Groq
            elif "groq" in p:
                url = "https://api.groq.com/openai/v1/models"
                headers = {"Authorization": f"Bearer {api_key}"}
                res = await client.get(url, headers=headers)
                if res.status_code == 200:
                    return {"valid": True, "provider": "Groq", "details": "Authenticated successfully (Llama-3-70b @ 800 tps)."}
                else:
                    return {"valid": False, "error": "Groq authentication failed (Invalid API key)."}

            # 8. Twilio (Telephony)
            elif "twilio" in p:
                sid = account_sid or "AC"
                url = f"https://api.twilio.com/2010-04-01/Accounts/{sid}.json"
                # If secret is format SID:TOKEN
                if ":" in api_key:
                    parts = api_key.split(":", 1)
                    auth = (parts[0], parts[1])
                else:
                    auth = (account_sid or "AC", api_key)
                res = await client.get(url, auth=auth)
                if res.status_code == 200:
                    return {"valid": True, "provider": "Twilio", "details": "Twilio Account SID & Token verified successfully."}
                elif res.status_code == 401:
                    return {"valid": False, "error": "Twilio authentication failed (Invalid Account SID / Auth Token)."}
                else:
                    # If user just provided auth token without SID, provide guidance
                    if not account_sid and not ":" in api_key:
                        return {"valid": False, "error": "Twilio requires both Account SID and Auth Token (format: ACxxx:auth_token)."}
                    return {"valid": False, "error": f"Twilio returned status {res.status_code}"}

            # 9. Cal.com
            elif "calcom" in p or "cal" in p:
                target_url = (base_url or "http://calcom:3000/api/v1").rstrip("/")
                headers = {"Authorization": f"Bearer {api_key}"}
                # Try event-types or me endpoint
                try:
                    res = await client.get(f"{target_url}/event-types", headers=headers)
                    if res.status_code in [200, 201]:
                        return {"valid": True, "provider": "Cal.com", "details": "Cal.com API key verified (Event types accessible)."}
                    elif res.status_code in [401, 403]:
                        return {"valid": False, "error": "Cal.com authentication failed (Invalid API key)."}
                except Exception:
                    # Try cloud endpoint if local failed
                    res2 = await client.get("https://api.cal.com/v1/event-types", headers=headers)
                    if res2.status_code in [200, 201]:
                        return {"valid": True, "provider": "Cal.com Cloud", "details": "Cal.com Cloud API key verified."}
                return {"valid": False, "error": "Could not authenticate with Cal.com (Check API key or server URL)."}

            # 10. Custom / Other Provider with Base URL
            else:
                if not base_url:
                    return {"valid": False, "error": "Custom provider requires a valid Base URL endpoint."}
                
                headers = {"Authorization": f"Bearer {api_key}"}
                try:
                    res = await client.get(base_url, headers=headers)
                    if res.status_code < 400:
                        return {"valid": True, "provider": provider, "details": f"Endpoint responded with status {res.status_code}."}
                    elif res.status_code in [401, 403]:
                        return {"valid": False, "error": f"Authentication rejected by {base_url} (HTTP {res.status_code})."}
                    else:
                        return {"valid": False, "error": f"Endpoint returned HTTP {res.status_code}: {res.text[:120]}"}
                except Exception as ex:
                    return {"valid": False, "error": f"Connection to {base_url} failed: {str(ex)}"}

    except httpx.ConnectTimeout:
        return {"valid": False, "error": f"Connection to {provider} timed out. Please check network connection."}
    except httpx.ConnectError as ce:
        return {"valid": False, "error": f"Could not reach {provider} host: {str(ce)}"}
    except Exception as e:
        logger.error(f"Error validating {provider} key: {e}")
        return {"valid": False, "error": f"Validation error: {str(e)}"}
