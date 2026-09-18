"""Utility to test and verify Meta WhatsApp Cloud API credentials and message sending."""
import os
import sys
import httpx
import asyncio

PHONE_NUMBER_ID = os.getenv("WHATSAPP_CLOUD_PHONE_NUMBER_ID", "1238965585975808")
WABA_ID = os.getenv("WHATSAPP_CLOUD_WABA_ID", "1488177123071552")
ACCESS_TOKEN = os.getenv("WHATSAPP_CLOUD_ACCESS_TOKEN", "")

async def test_meta_whatsapp(to_phone: str, message: str = "", use_template: bool = True, token: str = ""):
    tok = token or ACCESS_TOKEN
    if not tok:
        print("[ERROR] No WHATSAPP_CLOUD_ACCESS_TOKEN provided.")
        return False

    url = f"https://graph.facebook.com/v20.0/{PHONE_NUMBER_ID}/messages"
    headers = {
        "Authorization": f"Bearer {tok}",
        "Content-Type": "application/json"
    }

    digits = "".join(c for c in to_phone if c.isdigit())

    if use_template or not message:
        payload = {
            "messaging_product": "whatsapp",
            "to": digits,
            "type": "template",
            "template": {
                "name": "hello_world",
                "language": {"code": "en_US"}
            }
        }
    else:
        payload = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": digits,
            "type": "text",
            "text": {"preview_url": False, "body": message}
        }

    print(f"[*] Sending WhatsApp message via Meta Cloud API...")
    print(f"    To: {digits}")
    print(f"    Sender Phone Number ID: {PHONE_NUMBER_ID}")
    print(f"    Type: {payload.get('type')}")

    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            resp = await client.post(url, headers=headers, json=payload)
            print(f"[*] Status: {resp.status_code}")
            print(f"[*] Response: {resp.text}")
            if resp.status_code in (200, 201):
                print("[SUCCESS] WhatsApp message sent successfully!")
                return True
            else:
                print(f"[FAILED] Meta returned error status {resp.status_code}")
                return False
        except Exception as e:
            print(f"[EXCEPTION] {e}")
            return False

if __name__ == "__main__":
    phone = sys.argv[1] if len(sys.argv) > 1 else "919173611895"
    token = sys.argv[2] if len(sys.argv) > 2 else ""
    asyncio.run(test_meta_whatsapp(phone, token=token))
