import base64
import logging
import time
from typing import Dict, Optional

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from app.config import settings

logger = logging.getLogger("telnyx_signature")


def verify_telnyx_ed25519_signature(
    payload_bytes: bytes,
    headers: Dict[str, str],
    public_key: Optional[str] = None,
) -> bool:
    """
    Verifies Telnyx webhook signatures per Telnyx's Ed25519 scheme:
    Signed string = "{telnyx-timestamp}|{raw_payload}"
    Public key is the account's base64 Ed25519 public key from
    Mission Control -> Account Settings -> Keys & Credentials -> Public Key.
    Rejects requests older than 300 seconds (anti-replay protection).
    """
    pub_key_b64 = (public_key or settings.TELNYX_ASSISTANT_PUBLIC_KEY or "").strip()

    if not pub_key_b64:
        logger.warning("No TELNYX_ASSISTANT_PUBLIC_KEY configured. Skipping signature verification in dev/local mode.")
        return True

    normalized_headers = {k.lower(): v for k, v in headers.items()}
    signature_b64 = normalized_headers.get("telnyx-signature-ed25519")
    timestamp = normalized_headers.get("telnyx-timestamp")

    if not signature_b64 or not timestamp:
        logger.warning("Telnyx webhook request missing required headers: telnyx-signature-ed25519 or telnyx-timestamp.")
        return False

    try:
        ts = int(timestamp)
        now = int(time.time())
        if abs(now - ts) > 300:
            logger.warning(f"Telnyx webhook timestamp expired: delta={abs(now - ts)}s > 300s.")
            return False
    except ValueError:
        logger.warning("Invalid telnyx-timestamp header format.")
        return False

    try:
        pub_key_bytes = base64.b64decode(pub_key_b64)
        signature_bytes = base64.b64decode(signature_b64)
        signed_message = f"{timestamp}|".encode("utf-8") + payload_bytes
        public_key_obj = Ed25519PublicKey.from_public_bytes(pub_key_bytes)
        public_key_obj.verify(signature_bytes, signed_message)
        return True
    except InvalidSignature:
        logger.warning("Telnyx webhook signature verification FAILED — invalid Ed25519 signature.")
        return False
    except Exception as e:
        logger.warning(f"Telnyx webhook signature verification error: {e}")
        return False
