"""
xAI Voice Agent & Telnyx Number Setup Utility
Usage:
    py -3.11 scripts/register_xai_number.py --webhook-url https://your-domain.com/api/sip-webhook
"""

import argparse
import json
import os
import sys
import httpx

# Add parent directory to path to import app config
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from app.config import settings

def main():
    parser = argparse.ArgumentParser(description="xAI Voice Agent Phone Registration & Diagnostics")
    parser.add_argument("--webhook-url", type=str, help="Public HTTPS webhook URL (e.g. https://xyz.ngrok-free.app/api/sip-webhook)")
    parser.add_argument("--phone-number", type=str, help="Telnyx phone number in E.164 format (e.g. +12025550199)")
    args = parser.parse_args()

    phone_number = args.phone_number or settings.TELNYX_PHONE_NUMBER or os.getenv("TELNYX_PHONE_NUMBER")
    api_key = settings.XAI_API_KEY or os.getenv("XAI_API_KEY")

    print("\n" + "=" * 60)
    print("  xAI Voice Agent + Telnyx Pre-Flight Check")
    print("=" * 60)

    print(f"[*] Voice Engine:        {settings.PROJECT_NAME}")
    print(f"[*] Telnyx Phone Number: {phone_number or 'Not set (set in .env as TELNYX_PHONE_NUMBER)'}")
    print(f"[*] xAI API Key:         {'Configured (***)' if api_key else 'Missing (set in .env as XAI_API_KEY)'}")
    print(f"[*] xAI Voice Name:      {settings.XAI_VOICE_NAME}")
    print(f"[*] xAI SIP FQDN:        {settings.XAI_SIP_FQDN}")
    print(f"[*] Webhook Secret:      {'Configured (whsec_***)' if settings.XAI_WEBHOOK_SECRET else 'Pending registration'}")

    webhook_url = args.webhook_url
    if not webhook_url:
        print("\n[!] Notice: No --webhook-url provided.")
        print("    If testing locally, start your tunnel first:")
        print("      ngrok http 8000")
        print("    Then re-run:")
        print("      py -3.11 scripts/register_xai_number.py --webhook-url https://<your-ngrok>.ngrok-free.app/api/sip-webhook\n")
        return

    print(f"[*] Target Webhook URL:  {webhook_url}")

    # Check local webhook accessibility
    try:
        health_url = webhook_url.rstrip("/") + "/health" if not webhook_url.endswith("/health") else webhook_url
        print(f"\n[*] Testing Webhook reachability at {health_url}...")
        resp = httpx.get(health_url, timeout=5.0)
        if resp.status_code == 200:
            print(f"    [+] Success! Webhook responded: {resp.json()}")
        else:
            print(f"    [?] Webhook returned status {resp.status_code}")
    except Exception as e:
        print(f"    [!] Warning: Could not reach {health_url}: {e}")
        print("    Ensure your server is running (uvicorn app.main:app) and tunnel is active.")

    print("\n" + "-" * 60)
    print("  TELNYX PORTAL INSTRUCTIONS")
    print("-" * 60)
    print("1. Log in to https://portal.telnyx.com")
    print("2. Navigate to 'Voice' -> 'SIP Trunking' -> 'Add SIP Connection'")
    print("3. Set SIP Connection Type to 'FQDN Connection':")
    print("   - Connection Name:          xAI-Voice-Agent")
    print("   - Primary FQDN:             sip.voice.x.ai")
    print("   - Port:                     5060")
    print("   - Inbound Destination Type: +E.164")
    print("   - Enabled Audio Codecs:     G.711 u-law (PCMU), G.711 a-law (PCMA), G.722")
    print(f"4. Navigate to 'Numbers' -> Assign your number ({phone_number or '+1...'}) to this connection.")

    print("\n" + "-" * 60)
    print("  xAI REGISTRATION COMMAND")
    print("-" * 60)
    print(f"""To register via xAI CLI or API, supply:
  - Phone Number: {phone_number or '<YOUR_TELNYX_NUMBER>'}
  - Webhook URL:  {webhook_url}
  - Voice:        {settings.XAI_VOICE_NAME}

Copy the returned 'whsec_...' secret into your .env file:
  XAI_WEBHOOK_SECRET=whsec_...
""")
    print("=" * 60 + "\n")

if __name__ == "__main__":
    main()
