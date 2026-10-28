"""The starter kit a partner downloads from the Partner programme screen.

A zip whose folders match the partner's own project: they unzip it into the project folder and run one check. Each kit is
made for that partner (their publishable key, Outreach's address, their first web address filled in). The secret key is never
in it: it is shown once in the dashboard and the partner pastes it into a .env file.

Templates live in templates/common (every kit) and templates/<stack> (one kit). A {{NAME}} in a template is filled in here.
"""
from __future__ import annotations

import html
import io
import re
import zipfile
from pathlib import Path
from typing import Dict, Iterator, Tuple

_DIR = Path(__file__).resolve().parent / "templates"

STACKS: Dict[str, str] = {
    "vite": "A Vite or React app (no server of its own)",
    "node": "Your own Node / Express server",
    "next": "Next.js",
}

# A template that sits flat in its stack folder but belongs in a sub-folder of the partner's project.
_PLACE = {
    "common/outreach-test.html": "public/outreach-test.html",
    "vite/OutreachScreen.jsx": "src/OutreachScreen.jsx",
}


def _files(stack: str) -> Iterator[Tuple[str, str]]:
    """(path inside the zip, template text) for the common files and the chosen stack's."""
    for folder in ("common", stack):
        base = _DIR / folder
        for path in sorted(p for p in base.rglob("*") if p.is_file()):
            key = f"{folder}/{path.relative_to(base).as_posix()}"
            yield _PLACE.get(key, path.relative_to(base).as_posix()), path.read_text(encoding="utf-8")


def build(stack: str, *, client_id: str, host: str, origin: str, company: str) -> bytes:
    """The zip for one partner and one stack, as bytes."""
    if stack not in STACKS:
        raise ValueError(f"stack must be one of: {', '.join(STACKS)}")
    values = {"CLIENT_ID": client_id, "HOST": host.rstrip("/"), "ORIGIN": (origin or "https://app.yourproduct.com").rstrip("/"),
              "COMPANY": (company or "your company").strip()}
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for name, text in _files(stack):
            for key, value in values.items():
                text = text.replace("{{" + key + "}}", html.escape(value) if name.endswith(".html") else value)
            left = re.search(r"\{\{[A-Z_]+\}\}", text)  # JSX has {{ }} of its own: only {{NAME}} counts
            if left:
                raise ValueError(f"{name} still has an unfilled placeholder {left.group(0)}")
            z.writestr(name, text)
    return out.getvalue()
