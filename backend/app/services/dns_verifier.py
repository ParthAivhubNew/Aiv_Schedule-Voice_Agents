"""DNS Deliverability Verifier for Cold Email Sending Domains.

Performs asynchronous checks for:
- SPF: Checks for valid v=spf1 record.
- DKIM: Checks selector TXT records (standard selectors: google, selector1, selector2, default, k1).
- DMARC: Checks _dmarc record (v=DMARC1; accepts p=none, p=quarantine, p=reject).
- MX: Verifies destination mail exchange records exist.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, List, Optional
logger = logging.getLogger("dns_verifier")

STANDARD_DKIM_SELECTORS = ["google", "selector1", "selector2", "default", "k1", "mail", "s1"]


_SPF_BY_PROVIDER = {
    "gmail": "v=spf1 include:_spf.google.com ~all",
    "outlook": "v=spf1 include:spf.protection.outlook.com ~all",
    "zoho": "v=spf1 include:zoho.eu include:zoho.com ~all",
    "one.com": "v=spf1 include:_custspf.one.com ~all",
}
_DKIM_HOWTO = {
    "gmail": "In Google Admin: Apps > Google Workspace > Gmail > Authenticate email. Pick the domain, press Generate new record, "
             "copy the TXT value into your DNS (name google._domainkey), then press Start authentication.",
    "outlook": "In Microsoft 365 Defender: Email & collaboration > Policies > DKIM. Pick the domain and copy the two CNAME records "
               "(selector1._domainkey and selector2._domainkey) into your DNS, then turn signing on.",
    "zoho": "In Zoho Mail Admin: Email Configuration > DKIM. Add a selector, copy the TXT value into your DNS, then press Verify.",
    "one.com": "In one.com Control Panel: Email > DKIM. Turn it on and add the record it shows to your DNS.",
}


def setup_guide(domain: str, provider: str, dns: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Plain steps for each record still missing: what to add, where, and the value to paste where
    we know it. DKIM's value is made by the mail host, so for that one we say where to get it."""
    domain = (domain or "").strip().lower()
    dns = dns or {}
    steps: List[Dict[str, Any]] = []
    if not dns.get("spf_verified"):
        steps.append({"key": "spf", "title": "Permission to send (SPF)", "type": "TXT", "host": domain or "@",
                      "value": _SPF_BY_PROVIDER.get(provider, "v=spf1 include:YOUR-MAIL-PROVIDER ~all"),
                      "why": "Tells inboxes that your mail provider is allowed to send email as you. Without it, many inboxes reject your emails."})
    if not dns.get("dkim_verified"):
        steps.append({"key": "dkim", "title": "Your email signature (DKIM)", "type": "TXT", "host": f"(selector)._domainkey.{domain}",
                      "value": "", "why": "A hidden signature on each email that proves it really came from you and was not changed on the way. Needed so your emails reach the inbox, not spam.",
                      "howto": _DKIM_HOWTO.get(provider, "Your email provider makes this one for you. Open its settings, look for DKIM, and copy the record it shows "
                                                          "into your domain settings."),
                      "note": "Your provider gave it a different name? Type that name here, then press Verify."})
    if not dns.get("dmarc_verified"):
        steps.append({"key": "dmarc", "title": "Safety rule (DMARC)", "type": "TXT", "host": f"_dmarc.{domain}",
                      "value": "v=DMARC1; p=none;",
                      "why": "A rule that tells inboxes what to do if someone fakes an email from your domain. Recommended, not required. Copy the value as it is: it only watches and never blocks your mail."})
    if not dns.get("mx_verified"):
        steps.append({"key": "mx", "title": "Receiving replies (MX)", "type": "MX", "host": domain, "value": "",
                      "why": "Tells the internet where to deliver replies to your emails, so they reach your inbox. Your provider shows the exact values to use."})
    return steps


async def verify_domain_dns(domain: str, dkim_selector: Optional[str] = None) -> Dict[str, Any]:
    """Asynchronously audits domain DNS records for email deliverability readiness."""
    domain = (domain or "").strip().lower()
    try:
        import dns.asyncresolver
        import dns.resolver
        resolver = dns.asyncresolver.Resolver()
        resolver.timeout = 3.0
        resolver.lifetime = 5.0
        has_dns = True
    except ImportError:
        has_dns = False

    result = {
        "domain": domain,
        "spf_verified": False,
        "spf_record": None,
        "dkim_verified": False,
        "dkim_selector": None,
        "dkim_record": None,
        "dmarc_verified": False,
        "dmarc_record": None,
        "dmarc_policy": None,
        "mx_verified": False,
        "mx_records": [],
        "all_passed": False,
        "recommendations": [],
    }

    if not has_dns:
        logger.warning("dnspython is not installed: DNS checks are skipped (pip install -r requirements.txt).")
        result["recommendations"].append("DNS checks are unavailable on the server right now. Ask the Outreach team to install dnspython.")
        return result

    # 1. SPF Check
    try:
        txt_records = await resolver.resolve(domain, "TXT")
        for rdata in txt_records:
            txt_content = "".join([s.decode("utf-8", errors="ignore") if isinstance(s, bytes) else str(s) for s in rdata.strings])
            if txt_content.startswith("v=spf1"):
                result["spf_verified"] = True
                result["spf_record"] = txt_content
                break
    except Exception as e:
        logger.debug(f"SPF query failed for {domain}: {e}")

    if not result["spf_verified"]:
        result["recommendations"].append(f"Add an SPF TXT record for {domain} (e.g. 'v=spf1 include:_spf.google.com ~all').")

    # 2. DKIM Check
    selectors_to_check = [dkim_selector] if dkim_selector else STANDARD_DKIM_SELECTORS
    for sel in selectors_to_check:
        if not sel:
            continue
        dkim_domain = f"{sel}._domainkey.{domain}"
        try:
            dkim_records = await resolver.resolve(dkim_domain, "TXT")
            for rdata in dkim_records:
                txt_content = "".join([s.decode("utf-8", errors="ignore") if isinstance(s, bytes) else str(s) for s in rdata.strings])
                if "k=rsa" in txt_content or "p=" in txt_content or "v=DKIM1" in txt_content:
                    result["dkim_verified"] = True
                    result["dkim_selector"] = sel
                    result["dkim_record"] = txt_content
                    break
            if result["dkim_verified"]:
                break
        except Exception:
            continue

    if not result["dkim_verified"]:
        result["recommendations"].append(f"Configure DKIM TXT record at (selector)._domainkey.{domain}.")

    # 3. DMARC Check
    dmarc_domain = f"_dmarc.{domain}"
    try:
        dmarc_records = await resolver.resolve(dmarc_domain, "TXT")
        for rdata in dmarc_records:
            txt_content = "".join([s.decode("utf-8", errors="ignore") if isinstance(s, bytes) else str(s) for s in rdata.strings])
            if txt_content.startswith("v=DMARC1"):
                result["dmarc_verified"] = True
                result["dmarc_record"] = txt_content
                # Extract policy
                if "p=reject" in txt_content:
                    result["dmarc_policy"] = "reject"
                elif "p=quarantine" in txt_content:
                    result["dmarc_policy"] = "quarantine"
                else:
                    result["dmarc_policy"] = "none"
                break
    except Exception as e:
        logger.debug(f"DMARC query failed for {domain}: {e}")

    if not result["dmarc_verified"]:
        result["recommendations"].append(f"Add a DMARC TXT record at _dmarc.{domain} (e.g. 'v=DMARC1; p=none; sp=none;').")

    # 4. MX Records Check
    try:
        mx_records = await resolver.resolve(domain, "MX")
        mx_list = [str(r.exchange).rstrip(".") for r in mx_records]
        if mx_list:
            result["mx_verified"] = True
            result["mx_records"] = mx_list
    except Exception as e:
        logger.debug(f"MX query failed for {domain}: {e}")

    if not result["mx_verified"]:
        result["recommendations"].append(f"Add valid MX records pointing to your email service provider.")

    result["all_passed"] = bool(result["spf_verified"] and result["dkim_verified"] and result["dmarc_verified"] and result["mx_verified"])
    return result
