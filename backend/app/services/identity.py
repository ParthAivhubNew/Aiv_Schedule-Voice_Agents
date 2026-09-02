import re
from typing import Dict, Any, List, Optional

LEGAL_SUFFIXES = re.compile(
    r"\b(ltd|limited|llp|plc|inc|incorporated|co|company|group|holdings|the|uk|llc)\b",
    re.IGNORECASE,
)

NICKNAMES = {
    "james": ["jim", "jimmy", "jamie"],
    "jim": ["james"],
    "jimmy": ["james"],
    "william": ["bill", "billy", "will", "liam"],
    "bill": ["william"],
    "robert": ["bob", "bobby", "rob"],
    "bob": ["robert"],
    "thomas": ["tom", "tommy"],
    "tom": ["thomas"],
    "richard": ["dick", "rick", "rich"],
    "david": ["dave"],
    "dave": ["david"],
    "alexander": ["alex"],
    "alex": ["alexander"],
    "edward": ["ed", "ted", "eddie"],
    "ed": ["edward"],
    "samuel": ["sam", "sammy"],
    "sam": ["samuel"],
}

def normalize_company_name(raw: str) -> str:
    s = str(raw or "").lower()
    s = LEGAL_SUFFIXES.sub(" ", s)
    s = re.sub(r"[^\w\s]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s

def normalize_website(raw: str) -> str:
    s = str(raw or "").lower().strip()
    s = re.sub(r"^https?:\/\/", "", s)
    s = re.sub(r"^www\.", "", s)
    s = s.split("/")[0].split("?")[0]
    return s.strip()

def normalize_phone_digits(raw: str) -> str:
    digits = re.sub(r"\D", "", str(raw or ""))
    if digits.startswith("44") and len(digits) >= 11:
        return "0" + digits[2:]
    return digits

def normalize_person_name(raw: str) -> str:
    s = str(raw or "").lower()
    s = re.sub(r"[^\w\s]", " ", s)
    return re.sub(r"\s+", " ", s).strip()

def first_names_match(a: str, b: str) -> bool:
    na = a.lower().strip()
    nb = b.lower().strip()
    if na == nb:
        return True
    if nb in NICKNAMES.get(na, []):
        return True
    if na in NICKNAMES.get(nb, []):
        return True
    return False

def people_match(name_a: str, name_b: str) -> bool:
    norm_a = normalize_person_name(name_a)
    norm_b = normalize_person_name(name_b)
    if not norm_a or not norm_b:
        return False
    if norm_a == norm_b:
        return True
    parts_a = norm_a.split()
    parts_b = norm_b.split()
    if len(parts_a) >= 2 and len(parts_b) >= 2:
        last_a = parts_a[-1]
        last_b = parts_b[-1]
        if last_a == last_b and first_names_match(parts_a[0], parts_b[0]):
            return True
    return False

def find_identity_match(
    target_name: str,
    target_phone: str = "",
    target_contact: str = "",
    target_site: str = "",
    registry_list: List[Dict[str, Any]] = None
) -> Optional[Dict[str, Any]]:
    if not registry_list:
        return None
    
    norm_target = normalize_company_name(target_name)
    norm_phone = normalize_phone_digits(target_phone)
    norm_site = normalize_website(target_site)
    
    for entry in registry_list:
        canon = entry.get("canonicalName") or entry.get("canonical_name", "")
        aliases = entry.get("aliases", [])
        phones = [normalize_phone_digits(p) for p in entry.get("phones", [])]
        websites = [normalize_website(w) for w in entry.get("websites", [])]
        
        # 1. Exact or Alias Company Match
        all_names = [canon] + aliases
        for name in all_names:
            if normalize_company_name(name) == norm_target and norm_target != "":
                return {
                    "matched": True,
                    "reason": "company_name",
                    "registryId": entry.get("id"),
                    "canonicalName": canon,
                    "doNotCall": entry.get("doNotCall", False) or entry.get("do_not_call", False),
                    "lastOutcome": entry.get("lastOutcome") or entry.get("last_outcome"),
                    "lastContactAt": entry.get("lastContactAt") or entry.get("last_contact_at"),
                }
        
        # 2. Phone Match
        if norm_phone and len(norm_phone) >= 7 and norm_phone in phones:
            return {
                "matched": True,
                "reason": "phone_number",
                "registryId": entry.get("id"),
                "canonicalName": canon,
                "doNotCall": entry.get("doNotCall", False) or entry.get("do_not_call", False),
                "lastOutcome": entry.get("lastOutcome") or entry.get("last_outcome"),
                "lastContactAt": entry.get("lastContactAt") or entry.get("last_contact_at"),
            }
            
        # 3. Domain match
        if norm_site and norm_site in websites:
            return {
                "matched": True,
                "reason": "website_domain",
                "registryId": entry.get("id"),
                "canonicalName": canon,
                "doNotCall": entry.get("doNotCall", False) or entry.get("do_not_call", False),
                "lastOutcome": entry.get("lastOutcome") or entry.get("last_outcome"),
                "lastContactAt": entry.get("lastContactAt") or entry.get("last_contact_at"),
            }

    return None
