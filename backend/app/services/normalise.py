"""One place that turns messy values into the form we store. Pure functions, no database."""
import re
from typing import Any, List

_REG_PREFIXES = ("SC", "NI", "OC", "SO", "NC", "R0", "LP", "SL", "SP", "SF", "NL", "NF", "IP", "RC", "FC", "CE", "GE", "AC", "ZC")
_POSTCODE = re.compile(r"^([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})$")
_OUTWARD = re.compile(r"^[A-Z]{1,2}\d[A-Z\d]?$")
_SPLIT4 = {"0113", "0114", "0115", "0116", "0117", "0118", "0121", "0131", "0141", "0151", "0161", "0191"}
_AREAS = set("AB AL B BA BB BD BH BL BN BR BS BT CA CB CF CH CM CO CR CT CV CW DA DD DE DG DH DL DN DT DY E EC EH EN EX FK FY G GL GU GY HA HD HG HP HR HS HU HX IG IM IP IV JE KA KT KW KY L LA LD LE LL LN LS LU M ME MK ML N NE NG NN NP NR NW OL OX PA PE PH PL PO PR RG RH RM S SA SE SG SK SL SM SN SO SP SR SS ST SW SY TA TD TF TN TQ TR TS TW UB W WA WC WD WF WN WR WS WV YO ZE".split())
_PARTICLES = {"de", "da", "di", "van", "von", "der", "den", "la", "le", "del", "of", "bin", "al"}

# Register type codes -> the label the bulk file uses.
CATEGORY_LABELS = {
    "ltd": "Private Limited Company",
    "plc": "Public Limited Company",
    "llp": "Limited Liability Partnership",
    "private-unlimited": "Private Unlimited Company",
    "private-limited-guarant-nsc": "Private Limited Company limited by guarantee",
    "private-limited-guarant-nsc-limited-exemption": "Private Limited Company limited by guarantee",
    "limited-partnership": "Limited Partnership",
    "scottish-partnership": "Scottish Partnership",
    "industrial-and-provident-society": "Industrial and Provident Society",
    "registered-society-non-jurisdictional": "Registered Society",
    "royal-charter": "Royal Charter Company",
    "charitable-incorporated-organisation": "Charitable Incorporated Organisation",
    "converted-or-closed": "Converted / Closed",
    "oversea-company": "Overseas Company",
}
CORPORATE_CATEGORIES = ("ltd", "plc", "llp", "private", "public limited", "limited", "cic", "community interest", "scottish", "limited partnership")


def company_number(raw: Any) -> str:
    """'8233371' -> '08233371'; 'sc123456' -> 'SC123456'; anything that cannot be a number -> ''."""
    s = re.sub(r"[\s\-]", "", str(raw or "")).upper()
    if not s:
        return ""
    for p in _REG_PREFIXES:
        if s.startswith(p) and s[len(p):].isdigit():
            return p + s[len(p):].zfill(8 - len(p))
    if s.isdigit() and len(s) <= 8:
        return s.zfill(8)
    return ""


def postcode(raw: Any) -> str:
    """'ls11 6jx' -> 'LS11 6JX'. An outward code alone ('DN11') is kept as it is. Else ''."""
    s = re.sub(r"\s+", " ", str(raw or "").strip().upper())
    m = _POSTCODE.match(s.replace(" ", "")) if s else None
    if m:
        return f"{m.group(1)} {m.group(2)}"
    return s if is_outward_only(s) else ""


def is_outward_only(raw: Any) -> bool:
    s = str(raw or "").strip().upper()
    m = re.match(r"^[A-Z]{1,2}", s)
    return bool(_OUTWARD.match(s)) and bool(m) and m.group(0) in _AREAS


def person_name(raw: Any) -> str:
    """'JAMES BROWN' -> 'James Brown'. Mixed-case names are left alone (McDonald, de Souza)."""
    s = re.sub(r"\s+", " ", str(raw or "").strip())
    if not s or (s != s.upper() and s != s.lower()):
        return s
    words = []
    for i, w in enumerate(s.lower().split(" ")):
        if i and w in _PARTICLES:
            words.append(w)
            continue
        w = "-".join(p.capitalize() for p in w.split("-"))
        w = re.sub(r"(^|')([a-z])", lambda m: m.group(1) + m.group(2).upper(), w)
        if w.startswith("Mc") and len(w) > 2:
            w = "Mc" + w[2:].capitalize()
        words.append(w)
    return " ".join(words)


def phone_display(raw: Any) -> str:
    """UK numbers in one national shape ('0113 550 2750'); anything else is only tidied."""
    s = str(raw or "").strip()
    if not s:
        return ""
    from app.services.uk_phone import national_digits

    d = national_digits(s)
    if not d or not (10 <= len(d) <= 11):
        return re.sub(r"\s+", " ", s)
    if d[:4] in _SPLIT4:
        return f"{d[:4]} {d[4:7]} {d[7:]}"
    if d.startswith(("020", "023", "024", "028", "029")):
        return f"{d[:3]} {d[3:7]} {d[7:]}"
    return f"{d[:5]} {d[5:]}"


def category_label(raw: Any) -> str:
    """A register type code ('ltd') becomes the bulk label; a value that is already a label is kept."""
    s = str(raw or "").strip()
    return CATEGORY_LABELS.get(s.lower(), s)


def is_raw_category(raw: Any) -> bool:
    s = str(raw or "").strip().lower()
    return bool(s) and s in CATEGORY_LABELS


def is_corporate(category: Any) -> bool:
    """A limited company, PLC, LLP or CIC: a corporate subscriber under PECR."""
    s = str(category or "").lower()
    return any(k in s for k in CORPORATE_CATEGORIES)


def sic_is_bare(raw: Any) -> bool:
    """True for a list of codes with no text ('69201' or '69201, 69202')."""
    s = str(raw or "").strip()
    return bool(s) and bool(re.fullmatch(r"[\d,;\s]+", s))


def codes(raw: Any) -> List[str]:
    return re.findall(r"\d{5}", str(raw or ""))
