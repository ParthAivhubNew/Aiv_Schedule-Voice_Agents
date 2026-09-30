"""Sections, access levels and roles (AIV style).

Every screen of the app belongs to a section. A role gives each section one of three levels:
none (hidden), view (read only) or full (read and change). A user can hold several roles and
can also get a level for one section directly (for example an admin sharing Analytics with one
person); the highest level wins. Admin roles get full access to everything.

The API is protected by path: each request path maps to a section, GET/HEAD need "view" and
every other method needs "full". Paths that are not listed only need a signed-in user.
"""
from __future__ import annotations

import re
from typing import Dict, Iterable, List, Optional, Tuple

NONE, VIEW, FULL = "none", "view", "full"
LEVELS = (NONE, VIEW, FULL)
_RANK = {NONE: 0, VIEW: 1, FULL: 2}

# key, label, group, description
SECTIONS: List[Tuple[str, str, str, str]] = [
    ("calling", "Calling", "Voice", "Contact lists, dialling, live calls, call history, schedule and AI templates."),
    ("analytics", "Analytics", "Voice", "Call and meeting results, trends and team performance."),
    ("process_logs", "System logs", "Voice", "Technical activity log of calls, providers and background jobs."),
    ("scheduler", "Post scheduler", "Social", "Planning, writing, approving and publishing social posts."),
    ("leadgen", "Lead generation", "Growth", "Finding and enriching companies and contacts."),
    ("email", "Email outreach", "Growth", "Email campaigns and sequences."),
    ("calcom", "Meetings & calendar", "Meetings", "Booking pages, event types and bookings."),
    ("company", "Company profile", "Settings", "Company details, services, FAQs and knowledge sources."),
    ("connections", "Connections & AI", "Settings", "Phone, AI and provider accounts and keys."),
    ("team", "Users & roles", "Settings", "Adding users, roles and who can see what."),
]
SECTION_KEYS = [s[0] for s in SECTIONS]

# Starter roles made for every organisation. Admin-only sections stay "none" for other roles
# until an admin shares them.
SYSTEM_ROLES: Dict[str, Dict] = {
    "Admin": {
        "is_admin": True,
        "description": "Full access to everything, including users, roles and keys.",
        "levels": {k: FULL for k in SECTION_KEYS},
    },
    "Manager": {
        "is_admin": False,
        "description": "Runs campaigns and approves posts. No users, roles or keys.",
        "levels": {
            "calling": FULL, "analytics": NONE, "process_logs": NONE, "scheduler": FULL,
            "leadgen": FULL, "email": FULL, "calcom": FULL, "company": FULL,
            "connections": VIEW, "team": NONE,
        },
    },
    "Operator": {
        "is_admin": False,
        "description": "Makes calls and drafts posts.",
        "levels": {
            "calling": FULL, "analytics": NONE, "process_logs": NONE, "scheduler": FULL,
            "leadgen": FULL, "email": FULL, "calcom": FULL, "company": VIEW,
            "connections": VIEW, "team": NONE,
        },
    },
    "Viewer": {
        "is_admin": False,
        "description": "Can look but not change anything.",
        "levels": {
            "calling": VIEW, "analytics": NONE, "process_logs": NONE, "scheduler": VIEW,
            "leadgen": VIEW, "email": VIEW, "calcom": VIEW, "company": VIEW,
            "connections": NONE, "team": NONE,
        },
    },
}


def rank(level: Optional[str]) -> int:
    return _RANK.get(level or NONE, 0)


def clean_level(level: Optional[str]) -> str:
    level = str(level or "").lower().strip()
    return level if level in _RANK else NONE


def merge(levels: Iterable[Dict[str, str]], is_admin: bool = False) -> Dict[str, str]:
    """Highest level per section across roles and direct grants."""
    if is_admin:
        return {k: FULL for k in SECTION_KEYS}
    out = {k: NONE for k in SECTION_KEYS}
    for lv in levels:
        for key, level in (lv or {}).items():
            if key in out and rank(level) > rank(out[key]):
                out[key] = clean_level(level)
    return out


def allows(perms: Dict[str, str], section: str, need: str) -> bool:
    return rank(perms.get(section)) >= rank(need)


# ── Path → section ─────────────────────────────────────────────────────────
# First match wins. None = any signed-in user. "admin" = admins only.
_PATH_RULES: List[Tuple[re.Pattern, Optional[str]]] = [
    (re.compile(r"^/auth/(me|me/notifications|logout|change-password|onboarding)$"), None),
    (re.compile(r"^/auth/"), "team"),
    (re.compile(r"^/credits"), None),  # admins and platform staff; checked in the handlers
    (re.compile(r"^/analytics/usage$"), None),  # plugin hub usage cards
    (re.compile(r"^/analytics"), "analytics"),
    (re.compile(r"^/logs"), "process_logs"),
    (re.compile(r"^/enrichment/copilot-chat$"), None),  # shared AI chat used by every plugin
    (re.compile(r"^/enrichment"), "leadgen"),
    (re.compile(r"^/scheduler"), "scheduler"),
    (re.compile(r"^/calcom"), "calcom"),
    (re.compile(r"^/profile/org$"), "company"),
    (re.compile(r"^/profile/notifications$"), None),
    (re.compile(r"^/profile"), "company"),
    (re.compile(r"^/connections"), "connections"),
    (re.compile(r"^/numbers"), "connections"),  # reading the list is open to every signed-in user
    (re.compile(r"^/(calls|prospects|missions|schedule|meetings|conversation-templates|voices|livekit|"
                r"telnyx-assistant|custom-voice|vapi|retell|diagnostics|sip-webhook|sip)(/|$)"), "calling"),
]

# Reading these is needed by every plugin (company name, AI keys status, timezone), so a GET
# only needs a signed-in user; changing them still needs the section.
_OPEN_READ = {"company", "connections"}


def section_for(api_path: str) -> Tuple[bool, Optional[str]]:
    """(matched, section) for a path relative to /api (e.g. "/calls/live")."""
    for pattern, section in _PATH_RULES:
        if pattern.search(api_path):
            return True, section
    return False, None


def required(api_path: str, method: str) -> Optional[Tuple[str, str]]:
    """(section, level) the request needs, or None when being signed in is enough."""
    matched, section = section_for(api_path)
    if not matched or not section:
        return None
    read = method.upper() in ("GET", "HEAD", "OPTIONS")
    if read and section in _OPEN_READ:
        return None
    return section, (VIEW if read else FULL)
