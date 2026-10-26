"""The look of an embedded screen: what a partner may change, and the checks that keep it safe.

A partner sets an appearance as a saved default in its dashboard, or passes one when it mounts a screen. Only the keys below
are read, each value is checked, and anything else is dropped, so a partner can change colours, font and corners but can never
inject styles or scripts. frontend/src/embed/theme.js applies the same rules on the page.
"""
from __future__ import annotations

import re
from typing import Any, Dict

COLOR_KEYS = ("colorPrimary", "colorBackground", "colorSurface", "colorText", "colorDanger")
FONTS = {
    "system": 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    "inter": '"Inter", system-ui, sans-serif',
    "serif": 'Georgia, "Times New Roman", serif',
    "rounded": 'ui-rounded, "Nunito", "Segoe UI", system-ui, sans-serif',
    "mono": 'ui-monospace, "JetBrains Mono", Menlo, monospace',
}
MAX_RADIUS = 24
_HEX = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")


def clean_appearance(raw: Any) -> Dict[str, Any]:
    """The valid part of an appearance: {variables: {colorPrimary, ..., fontFamily, borderRadius}}. Unknown or bad values are dropped."""
    variables = (raw or {}).get("variables") if isinstance(raw, dict) else None
    if not isinstance(variables, dict):
        return {"variables": {}}
    out: Dict[str, Any] = {}
    for key in COLOR_KEYS:
        v = variables.get(key)
        if isinstance(v, str) and _HEX.match(v.strip()):
            out[key] = v.strip().lower()
    font = variables.get("fontFamily")
    if isinstance(font, str) and font in FONTS:
        out["fontFamily"] = font
    radius = variables.get("borderRadius")
    if isinstance(radius, (int, float)) and not isinstance(radius, bool) and 0 <= radius <= MAX_RADIUS:
        out["borderRadius"] = int(radius)
    return {"variables": out}


def problems(raw: Any) -> list[str]:
    """What was dropped, so the dashboard can say so instead of quietly saving less than the partner typed."""
    variables = (raw or {}).get("variables") if isinstance(raw, dict) else {}
    if not isinstance(variables, dict):
        return ["variables must be an object"]
    kept = clean_appearance(raw)["variables"]
    return [f"{k}: not a valid value" for k in variables if k not in kept]
