"""UK telephone numbers that Ofcom reserves for TV and radio drama.

They are valid-looking and some network lookups report them as real landlines, so they must be
rejected before any paid lookup. Ranges are Ofcom's published drama list.
"""
import re

# National form without spaces. Each entry is a prefix; the rest of the number is the free part.
_DRAMA_PREFIXES = (
    "01134960", "01144960", "01154960", "01164960", "01174960", "01184960",
    "01214960", "01314960", "01414960", "01514960", "01614960",
    "01914980",
    "02896496",
    "02920180",
    "02079460",
    "01632960",
    "07700900",
    "08081570",
    "09098790",
    "03069990",
)


def national_digits(raw: str) -> str:
    """Digits of a UK number in national form (leading 0), or '' when it is not UK-shaped."""
    d = re.sub(r"\D", "", str(raw or ""))
    if d.startswith("0044"):
        d = d[4:]
    elif d.startswith("44"):
        d = d[2:]
    elif d.startswith("0"):
        return d
    else:
        return ""
    return "0" + d


def fictional(raw: str) -> bool:
    """True when the number sits in an Ofcom drama range."""
    d = national_digits(raw)
    if not d:
        return False
    return any(d.startswith(p) for p in _DRAMA_PREFIXES)
