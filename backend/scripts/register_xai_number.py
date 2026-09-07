"""
xAI Voice Agent & Telnyx Number Registration Utility
Registers your BYO Trunk (Telnyx) phone number with xAI API:
POST https://api.x.ai/v2/phone-numbers
"""

import argparse
import json
import os
import sys
import httpx

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from app.config import settings

def main():
    parser = argparse.ArgumentParser(description="Register Telnyx Phone Number with xAI Voice Agent")
    parser.add_argument("--api-key", type=str, help="Your xAI API Key (xai-...)")
    parser.add_argument("--phone-number", type=str, help="Telnyx phone number in E.164 (e.g. +12025550199)")
    parser.add_argument("--webhook-url", type=str, default="https://8000-01m1bx2zfn0zxjnf9833v44pnv.cloudspaces.litng.ai/api/sip-webhook", help="Public Webhook URL")
    args = parser.parse_args()

    api_key = args.api_key or settings.XAI_API_KEY or os.getenv("XAI_API_KEY")
    phone_number = args.phone_number or settings.TELNYX_PHONE_NUMBER or os.getenv("TELNYX_PHONE_NUMBER")
    webhook_url = args.webhook_url

    print("\n" + "=" * 65)
    print("   xAI Voice Agent Phone Number Registration")
    print("=" * 65)

    if not api_key:
        print("\n[!] ERROR: Missing xAI API Key.")
        print("    Pass it with --api-key xai-xxxxxxxx or set XAI_API_KEY in .env")
        return

    if not phone_number:
        print("\n[!] ERROR: Missing Phone Number.")
        print("    Pass it with --phone-number +1xxxxxxxxxx or set TELNYX_PHONE_NUMBER in .env")
        return

    payload = {
        "origin": "byo_trunk",
        "name": "AIVHub Voice Agent",
        "phone_number": phone_number,
        "webhook": {
            "name": "AIVHub SIP Webhook",
            "url": webhook_url
        }
    }

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

    endpoint = "https://api.x.ai/v2/phone-numbers"
    print(f"\n[*] Submitting registration to {endpoint}...")
    print(f"[*] Phone Number: {phone_number}")
    print(f"[*] Webhook URL:  {webhook_url}")

    try:
        response = httpx.post(endpoint, json=payload, headers=headers, timeout=15.0)
        print(f"[*] HTTP Status:  {response.status_code}")
        
        if response.status_code in [200, 201]:
            data = response.json()
            signing_secret = data.get("signing_secret") or data.get("webhook_secret") or data.get("secret")
            print("\n" + "*" * 65)
            print("  SUCCESS! NUMBER REGISTERED WITH xAI VOICE AGENT")
            print("*" * 65)
            print(f"  Number ID:       {data.get('id', 'N/A')}")
            print(f"  Signing Secret:  {signing_secret}")
            print("*" * 65)
            print("\nSave this signing secret in your backend/.env file:")
            print(f"  XAI_WEBHOOK_SECRET={signing_secret}")
            print(f"  XAI_API_KEY={api_key}")
            print(f"  TELNYX_PHONE_NUMBER={phone_number}")
            print(f"  VOICE_ENGINE_MODE=live\n")
        else:
            print(f"\n[!] Registration failed: {response.text}")
    except Exception as e:
        print(f"\n[!] Error contacting xAI API: {e}")

if __name__ == "__main__":
    main()
