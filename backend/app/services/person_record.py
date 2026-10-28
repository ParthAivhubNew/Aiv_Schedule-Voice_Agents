"""A saved record that is a person, not a company.

A call list of contacts with no company on each row is saved by the person's own name (see the import). Such a record has no
company to look up: asking a company register or the open web about "Mayur Doshi" finds other people's pages and unrelated
businesses, so those lookups are skipped for it and only its phone and email are checked."""
from __future__ import annotations

import re
from typing import Any

# General inboxes that belong to a company, not to a named person.
_ROLE = {"info", "support", "sales", "admin", "contact", "hello", "office", "enquiries", "enquiry", "accounts", "mail", "team", "hr", "jobs",
         "careers", "marketing", "service", "bookings", "orders", "reception", "help", "general", "press", "media", "billing", "customerservice"}


def is_person(name: Any, contact_name: Any = "", domain: Any = "", website: Any = "", record: Any = "") -> bool:
    """Named for one person, with no company website and no registry record behind it."""
    n = re.sub(r"\s+", " ", str(name or "")).strip().lower()
    c = re.sub(r"\s+", " ", str(contact_name or "")).strip().lower()
    return bool(n) and n == c and not str(domain or "").strip() and not str(website or "").strip() and not str(record or "").strip()


def is_person_account(a: Any) -> bool:
    return is_person(getattr(a, "name", ""), getattr(a, "contact_name", ""), getattr(a, "domain", ""), getattr(a, "website", ""), getattr(a, "business_record_id", ""))


def is_role_inbox(email: Any) -> bool:
    local = str(email or "").split("@")[0].strip().lower()
    return bool(local) and local in _ROLE
