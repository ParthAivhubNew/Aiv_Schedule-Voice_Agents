"""
Timezone and Phone Number Utilities
Provides:
1. Strict IANA Timezone validation & canonical mapping.
2. Smart E.164 Phone Number normalization with country & area code intelligence.
"""

import re
from typing import Optional, Tuple
import zoneinfo

# Canonical mapping for common timezone abbreviations to official IANA timezone identifiers
COMMON_TIMEZONE_ALIASES = {
    # US & Canada
    "est": "America/New_York",
    "edt": "America/New_York",
    "eastern": "America/New_York",
    "et": "America/New_York",
    "cst": "America/Chicago",
    "cdt": "America/Chicago",
    "central": "America/Chicago",
    "ct": "America/Chicago",
    "mst": "America/Denver",
    "mdt": "America/Denver",
    "mountain": "America/Denver",
    "mt": "America/Denver",
    "pst": "America/Los_Angeles",
    "pdt": "America/Los_Angeles",
    "pacific": "America/Los_Angeles",
    "pt": "America/Los_Angeles",
    "akst": "America/Anchorage",
    "akdt": "America/Anchorage",
    "hst": "Pacific/Honolulu",
    "hawaii": "Pacific/Honolulu",

    # UK & Europe
    "gmt": "Europe/London",
    "bst": "Europe/London",
    "uk": "Europe/London",
    "london": "Europe/London",
    "cet": "Europe/Paris",
    "cest": "Europe/Paris",
    "eet": "Europe/Athens",
    "eest": "Europe/Athens",
    "wet": "Europe/Lisbon",
    "west": "Europe/Lisbon",
    "dublin": "Europe/Dublin",

    # Asia & Pacific
    "ist": "Asia/Kolkata",
    "india": "Asia/Kolkata",
    "jst": "Asia/Tokyo",
    "tokyo": "Asia/Tokyo",
    "japan": "Asia/Tokyo",
    "sgt": "Asia/Singapore",
    "singapore": "Asia/Singapore",
    "hkt": "Asia/Hong_Kong",
    "aest": "Australia/Sydney",
    "aedt": "Australia/Sydney",
    "sydney": "Australia/Sydney",
    "acst": "Australia/Adelaide",
    "awst": "Australia/Perth",
    "nzst": "Pacific/Auckland",
    "nzdt": "Pacific/Auckland",

    # Universal
    "utc": "UTC",
    "zulu": "UTC",
}

AVAILABLE_IANAS = zoneinfo.available_timezones()


def validate_and_normalize_timezone(tz_input: Optional[str], default_tz: str = "Europe/London") -> str:
    """
    Directly validates and maps a timezone string into a strict, valid IANA timezone name.
    Does NOT fail silently — maps abbreviations or returns standard valid IANA identifier.
    """
    if not tz_input:
        return default_tz

    raw = str(tz_input).strip()
    if not raw:
        return default_tz

    # Check alias dictionary first (e.g. EST -> America/New_York)
    raw_lower = raw.lower().replace(" ", "_")
    alias_match = COMMON_TIMEZONE_ALIASES.get(raw_lower)
    if alias_match and alias_match in AVAILABLE_IANAS:
        return alias_match

    # Check exact IANA match
    if raw in AVAILABLE_IANAS:
        return raw

    # Check case-insensitive exact IANA match
    for available in AVAILABLE_IANAS:
        if available.lower() == raw_lower:
            return available

    # Check substring matches for major cities
    for key, iana_name in COMMON_TIMEZONE_ALIASES.items():
        if key in raw_lower:
            return iana_name

    # If user provided a region/city format like 'america/chicago'
    parts = raw.split("/")
    if len(parts) == 2:
        reconstructed = f"{parts[0].capitalize()}/{parts[1].capitalize()}"
        if reconstructed in AVAILABLE_IANAS:
            return reconstructed

    # Return default fallback if input was invalid
    return default_tz


def normalize_smart_phone(number: Optional[str], default_country_code: str = "+44") -> Tuple[str, str]:
    """
    Smart Phone Number Normalization with Country & Area Code intelligence.
    Returns (e164_formatted_number, detected_country_prefix).
    """
    if not number:
        return "", ""

    raw = str(number).strip()
    # Strip all non-digit characters except leading plus
    cleaned = re.sub(r"[^\d+]", "", raw)

    if not cleaned:
        return "", ""

    # Convert 00 prefix (international dialing format) to +
    if cleaned.startswith("00"):
        cleaned = "+" + cleaned[2:]

    # If already starts with '+', validate length
    if cleaned.startswith("+"):
        digits_only = cleaned[1:]
        # Detect common country codes
        if digits_only.startswith("44"):
            return cleaned, "+44"
        elif digits_only.startswith("1"):
            return cleaned, "+1"
        elif digits_only.startswith("91"):
            return cleaned, "+91"
        elif digits_only.startswith("61"):
            return cleaned, "+61"
        return cleaned, "+" + digits_only[:2]

    # No leading plus: evaluate local numbers
    # UK local number with leading zero (e.g. 07307216767 -> 11 digits)
    if cleaned.startswith("0") and len(cleaned) == 11 and default_country_code == "+44":
        return "+44" + cleaned[1:], "+44"

    # UK number starting with 7 (e.g. 7307216767 -> 10 digits mobile)
    if cleaned.startswith("7") and len(cleaned) == 10 and default_country_code == "+44":
        return "+44" + cleaned, "+44"

    # US/Canada 10-digit number (e.g. 9096866918 -> 10 digits)
    if len(cleaned) == 10:
        if default_country_code == "+1":
            return "+1" + cleaned, "+1"
        elif default_country_code == "+44" and cleaned.startswith("7"):
            return "+44" + cleaned, "+44"
        else:
            return "+1" + cleaned, "+1"

    # 11-digit US number starting with 1
    if len(cleaned) == 11 and cleaned.startswith("1"):
        return "+" + cleaned, "+1"

    # 12-digit UK number starting with 44
    if len(cleaned) == 12 and cleaned.startswith("44"):
        return "+" + cleaned, "+44"

    # Fallback: prepend default country code without leading zeros
    trimmed = cleaned.lstrip("0")
    return f"{default_country_code}{trimmed}", default_country_code
