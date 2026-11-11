"""What a company's own website says about it: the accounting software it names, Making Tax Digital, hiring, team size.

Pure text reading, no network. Each signal is a whole-word match on pages the company published itself, so a finding can be
traced to words on its site. Nothing is guessed from silence: no match means the key is absent or false, never "no".
"""
from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Dict, List, Optional

# (shown name, pattern, ignore case). Sage is also an ordinary word and a name, so it only counts as written for the product.
_SOFTWARE = (
    ("Xero", r"\bXero\b", True),
    ("QuickBooks", r"\bQuick\s?Books\b", True),
    ("Sage", r"\bSage\b(?!\s+(?:advice|wisdom|green|leaves?|brush))", False),
    ("FreeAgent", r"\bFree\s?Agent\b", True),
    ("Dext", r"\bDext\b", False),
)
_MTD = re.compile(r"\bMaking\s+Tax\s+Digital\b|\bMTD\b", re.I)
_HIRING = re.compile(r"\bcareers\b|\bvacanc(?:y|ies)\b|\bwe(?:'|’)?re\s+hiring\b|\bwe\s+are\s+hiring\b|\bnow\s+hiring\b", re.I)
_TEAM = re.compile(r"\bteam\s+of\s+(\d{1,4})\b", re.I)


def extract(pages: List[Dict[str, Any]], now: Optional[datetime] = None) -> Dict[str, Any]:
    """pages: [{url, text}] from the company's own site. Returns {software, mtd, hiring, team_size, read_at}."""
    text = "\n".join(str(p.get("text") or "") for p in pages or [])
    software = [name for name, pattern, nocase in _SOFTWARE if re.search(pattern, text, re.I if nocase else 0)]
    sizes = [int(n) for n in _TEAM.findall(text) if 2 <= int(n) <= 2000]
    return {"software": software, "mtd": bool(_MTD.search(text)), "hiring": bool(_HIRING.search(text)), "team_size": max(sizes) if sizes else None,
            "read_at": (now or datetime.utcnow()).isoformat() + "Z"}
