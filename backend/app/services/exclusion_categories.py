"""What a person means when they leave out a directory-style category.

A list such as "Places of Worship, Hospitals, Schools (Special), Banks and Financial Institutions" is written in directory categories, but the
register holds company names ("St Mary's Church") and SIC text ("Activities of religious organisations"). So each known category stands for the
name words and SIC codes that find those companies. A label that is not known here is looked for as typed, with plurals tolerated.
Fixed list, no AI call.
"""
from __future__ import annotations

import re
from typing import Dict, List, Tuple

_SCHOOL_SICS = ("85100", "85200", "85310", "85320", "85510", "85520", "85590")
_COLLEGE_SICS = ("85320", "85410", "85421", "85422")
_HEALTH_SICS = ("86101", "86102", "86210", "86220", "86230", "86900")

# label -> (words found in a name or trade, SIC codes)
_RAW: Dict[str, Tuple[Tuple[str, ...], Tuple[str, ...]]] = {
    "Adoption and Fostering Services": (("adoption", "fostering"), ()),
    "Air Ambulance Services": (("air ambulance",), ()),
    "Airports": (("airport",), ("52230",)),
    "Ambulance and Medical Transportation Services": (("ambulance",), ()),
    "Armed Forces": (("armed forces", "royal navy", "royal air force"), ("84220",)),
    "Banks and Financial Institutions": (("bank plc", "bank of", "building society"), ("64110", "64191", "64192")),
    "Birth Marriage & Deaths Registration Offices": (("registration office", "register office", "registrar"), ()),
    "Blood Donor Services": (("blood donor", "blood service"), ()),
    "Blood Stock Agents": (("bloodstock",), ()),
    "Bureau De Change": (("bureau de change",), ()),
    "Casinos": (("casino",), ()),
    "Central Government": (("government", "ministry of", "civil service"), ("84110", "84120", "84130")),
    "Certification and Accreditation Bodies": (("accreditation", "certification body"), ()),
    "Chambers of Commerce": (("chamber of commerce",), ("94110",)),
    "Charities and Charitable Organisations": (("charity", "charitable", "charities"), ()),
    "Coastguard": (("coastguard",), ()),
    "Colleges (Higher Education)": (("college",), _COLLEGE_SICS),
    "Colleges (Technical and Agricultural)": (("college",), _COLLEGE_SICS),
    "Company Registrar": (("registrar of companies", "companies house"), ()),
    "Consular Services": (("consulate", "consular"), ()),
    "Courts": (("magistrates court", "crown court", "county court", "courts service"), ("84230",)),
    "Credit and Discount Cards": (("credit card", "discount card"), ()),
    "Credit and Finance Companies": (("moneylender", "money lender"), ("64910", "64921", "64922", "64929")),
    "Credit Reference Agencies": (("credit reference",), ()),
    "Credit Related Institutions": (("moneylender", "money lender"), ("64910", "64921", "64922", "64929")),
    "Credit Unions": (("credit union",), ()),
    "Data Protection Registrar": (("information commissioner",), ()),
    "Debt Collection Agencies": (("debt collection", "debt recovery"), ("82911",)),
    "Department of Transport": (("department for transport", "department of transport"), ()),
    "Development Agencies": (("development agency",), ()),
    "Directory Enquiries Services": (("directory enquiries",), ()),
    "DSS": (("dss", "jobcentre"), ()),
    "Dyslexia Advice and Support Organisations": (("dyslexia",), ()),
    "Education Agencies and Authorities": (("education authority", "local education"), ("85600",)),
    "Education Services": (("education authority",), ("85600",)),
    "Embassies": (("embassy", "high commission"), ()),
    "Ferry Operators": (("ferry", "ferries"), ("50100", "50300")),
    "Fire Stations": (("fire station", "fire and rescue", "fire service"), ("84250",)),
    "Fund Raising Services Charitable and Non Charitable": (("fundraising", "fund raising"), ()),
    "Further Education Schools and Colleges": (("college", "school"), _COLLEGE_SICS),
    "Handicraft Schools": (("school",), ()),
    "Health Authorities": (("health authority", "nhs"), ()),
    "Health Centres": (("health centre", "health center", "medical centre"), ("86210", "86220")),
    "Healthcare Companies": ((), _HEALTH_SICS),
    "HM Prisons": (("prison",), ()),
    "Hospitals": (("hospital",), ("86101", "86102")),
    "Inland Revenue": (("hmrc", "inland revenue", "revenue and customs"), ()),
    "Insurance - Caravan": (("caravan insurance",), ()),
    "Libraries": (("library", "libraries"), ("91011",)),
    "Loans & Debt - Management": (("debt management", "debt advice"), ()),
    "Local Government": (("borough council", "county council", "district council", "town council", "parish council", "city council", "local authority"), ("84110",)),
    "Members of Parliaments": (("member of parliament", "houses of parliament"), ()),
    "Mental Health Centres": (("mental health",), ()),
    "Merchants Banks": (("merchant bank",), ("64191",)),
    "Ministry of Defence": (("ministry of defence",), ("84220",)),
    "Moneylenders": (("moneylender", "money lender"), ("64921", "64922", "64929")),
    "NHS Clinics": (("nhs",), ()),
    "Nursery Schools": (("nursery school", "day nursery", "pre school", "preschool"), ("85100", "88910")),
    "Oil Companies": (("petroleum",), ("19201", "06100")),
    "Oil Refineries": (("oil refinery",), ("19201",)),
    "Passport Services": (("passport office", "passport service"), ()),
    "Places of Worship": (("church", "chapel", "mosque", "synagogue", "temple", "parish", "cathedral", "gurdwara", "place of worship", "worship"), ("94910",)),
    "Police Forces": (("police",), ("84240",)),
    "Police Support Services": (("police",), ("84240",)),
    "Political Parties": (("political party", "conservative association", "labour party", "liberal democrat"), ("94920",)),
    "Post Offices": (("post office",), ("53100",)),
    "Power Boat and Motor Cruising Schools": (("motor cruising", "powerboat training"), ()),
    "Pregnancy Testing and Help Centres": (("pregnancy",), ()),
    "Primary and Junior Schools (Foundation)": (("school",), _SCHOOL_SICS),
    "Primary and Junior Schools (Local Authority)": (("school",), _SCHOOL_SICS),
    "Primary Care Trusts": (("primary care trust",), ()),
    "Probate Registries": (("probate registry",), ()),
    "Probation Services": (("probation",), ()),
    "Railways Operators of": (("railway station", "rail operator", "network rail", "train operating"), ("49100",)),
    "Recruitment (Armed Forces)": (("armed forces",), ("84220",)),
    "Religious Organisations and Places of Worship": (("church", "chapel", "mosque", "synagogue", "temple", "parish", "cathedral", "gurdwara", "place of worship", "worship", "religious"), ("94910",)),
    "River Authorities": (("river authority", "environment agency", "river board"), ()),
    "Schools (Independent)": (("school",), _SCHOOL_SICS),
    "Schools (Leisure Based Activities)": (("riding school", "sailing school", "ski school", "swimming school", "dance school"), ("85510",)),
    "Schools (Special)": (("school",), _SCHOOL_SICS),
    "Schools and Colleges (Art)": (("art school", "school of art", "art college"), ("85520",)),
    "Schools of Music": (("school of music", "music school"), ("85520",)),
    "Secondary Schools (Foundation)": (("school",), _SCHOOL_SICS),
    "Secondary Schools (Local Authority)": (("school",), _SCHOOL_SICS),
    "Shopping Centres": (("shopping centre", "shopping center"), ()),
    "Sixth Form Colleges": (("sixth form", "college"), ("85320", "85410")),
    "Technical and Industrial Schools": (("school",), ("85320",)),
    "Tourist Information Offices": (("tourist information",), ()),
    "Trade and Business Organisations": (("trade association",), ("94110", "94120", "94990")),
    "Trade Assoc & Regulatory Bodies": (("trade association", "regulatory body"), ("94110", "94120", "94990")),
    "Trade Unions Activities of": (("trade union", "trades union"), ("94200",)),
    "Trading Standards": (("trading standards",), ()),
    "Train Information Services": (("train information",), ("49100",)),
    "Train Stations": (("train station", "railway station"), ("49100",)),
    "University Activities of": (("university",), ("85421", "85422")),
    "Water Authorities": (("water authority", "water board"), ("36000",)),
    "Water Companies": (("southern water", "thames water", "water authority"), ("36000",)),
    "Waterways": (("waterways", "canal and river trust"), ()),
    "Weather Service Providers": (("weather service", "met office"), ()),
    "Weighbridges - Public": (("weighbridge",), ()),
    "X-Ray Facilities and Services": (("x ray", "xray", "radiology"), ()),
}


def key(label: str) -> str:
    return " ".join(re.findall(r"[a-z0-9]+", str(label or "").lower().replace("&", " and ")))


CATEGORIES: Dict[str, Tuple[Tuple[str, ...], Tuple[str, ...]]] = {key(k): v for k, v in _RAW.items()}


_CHARITY_KEYS = {key("Charities and Charitable Organisations"), "charity", "charities", "charitable"}


def wants_charities_out(items: List[str]) -> bool:
    """A charity's name often has none of the words ("Brighton Housing Trust"), so leaving out charities also uses the charity register."""
    return any(key(i) in _CHARITY_KEYS for i in items)


def suggestions() -> List[str]:
    """What the box offers while someone types: the category labels as written, then the plain words they stand for."""
    words = sorted({w for ws, _ in _RAW.values() for w in ws})
    return sorted(_RAW) + words


def expand(item: str) -> Tuple[List[str], List[str]]:
    """(name/trade words, SIC codes) a typed exclusion stands for. A known category gives its list; anything else is the typed words."""
    k = key(item)
    hit = CATEGORIES.get(k) or CATEGORIES.get(key(re.sub(r"\(.*?\)", "", str(item))))
    if hit:
        return list(hit[0]), list(hit[1])
    return [str(item).strip()], []


def word_regex(term: str) -> str:
    """A Postgres regex for a word or phrase in a name or trade text: whole words, a plural accepted ("hospital" finds "Hospitals"
    and "hospitals" finds "Hospital"), never part of a longer word ("hospital" is not "Hospitality")."""
    tokens = re.findall(r"[a-z0-9]+", str(term).lower())
    if not tokens:
        return ""
    last = tokens[-1]
    stems = {last}
    if last.endswith("ies") and len(last) > 4:
        stems.add(last[:-3] + "y")
    if last.endswith("es") and len(last) > 4:
        stems.add(last[:-2])
    if last.endswith("s") and not last.endswith("ss") and len(last) > 3:
        stems.add(last[:-1])
    tail = "(" + "|".join(sorted(stems, key=len, reverse=True)) + ")"
    head = "[^a-z0-9]+".join(tokens[:-1] + [""]) if len(tokens) > 1 else ""
    return r"\m" + head + tail + r"(s|es)?\M"
