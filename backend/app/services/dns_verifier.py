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
