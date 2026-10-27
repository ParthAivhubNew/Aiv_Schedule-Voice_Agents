"""The partner guides as public web pages, so a partner can read them without an account.

GET /docs/partners          the two guides and what each is for
GET /docs/partners/start    Get started, step by step
GET /docs/partners/embed    Embedding Outreach in your software
GET /docs/partners/api      Partner API: connecting accounts and what you can call

The text lives in backend/docs/partners/*.md; edit those and the pages follow. The section written for the Outreach team is left out.
"""
from __future__ import annotations

import html
from functools import lru_cache
from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import HTMLResponse, PlainTextResponse

from app.config import settings
from app.services import mini_markdown as MD

router = APIRouter(prefix="/docs/partners", tags=["Partner docs"])
_DIR = Path(__file__).resolve().parents[2] / "docs" / "partners"
_GUIDES = {
    "start": ("Get started", "New here? Seven steps from nothing to an Outreach screen inside your product, with code to copy."),
    "embed": ("Embedding reference", "Every option for showing screens: popups, side panels, colours, connecting users, security."),
    "api": ("API reference", "Use an account from your server: calls, lists, webhooks. The older path, still supported."),
}
_STYLE = ("body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:0;color:#12141C;line-height:1.65;background:#fff}"
          "main{max-width:820px;margin:0 auto;padding:32px 16px 80px}h1{font-size:28px}h2{font-size:21px;margin-top:40px;border-top:1px solid #E3E6EB;padding-top:24px}"
          "h3{font-size:17px;margin-top:28px}a{color:#0B5FFF}code{background:#F1F3F6;padding:1px 5px;border-radius:4px;font-size:.92em}"
          "pre{background:#F1F3F6;padding:14px;border-radius:8px;overflow-x:auto}pre code{background:none;padding:0}"
          "blockquote{margin:16px 0;padding:8px 16px;border-left:4px solid #98A1AE;background:#F7F8FA;color:#3A4250}"
          ".wide{overflow-x:auto}table{border-collapse:collapse;min-width:100%}th,td{border:1px solid #E3E6EB;padding:8px 10px;text-align:left;vertical-align:top;font-size:14.5px}"
          "th{background:#F7F8FA}nav{font-size:14px;margin-bottom:24px;color:#5B6472}"
          "@media (prefers-color-scheme:dark){body{background:#12141C;color:#E8EAF0}h2{border-color:#2A3040}a{color:#7FB0FF}code,pre{background:#1D2230}"
          "blockquote{background:#181C27;color:#C5CBD6}th{background:#181C27}th,td{border-color:#2A3040}nav{color:#98A1AE}}")


def _page(title: str, body: str) -> HTMLResponse:
    doc = (f'<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
           f"<title>{html.escape(title)}</title><style>{_STYLE}</style></head><body><main>{body}</main></body></html>")
    # SAMEORIGIN lets the Partner programme screen show the page in place; other sites still cannot frame it.
    return HTMLResponse(doc, headers={"Cache-Control": "public, max-age=300", "X-Frame-Options": "SAMEORIGIN"})


def _link(href: str) -> str:
    """The guides link to each other as embed.md / api.md; on the web those are page addresses."""
    base = f"{(settings.PUBLIC_BASE_URL or '').rstrip('/')}{settings.API_PREFIX}/docs/partners"
    for name in _GUIDES:
        if href == f"{name}.md" or href.startswith(f"{name}.md#"):
            return base + "/" + href.replace(".md", "", 1)
    return href


@lru_cache(maxsize=8)
def _guide_html(name: str) -> str:
    text = (_DIR / f"{name}.md").read_text(encoding="utf-8")
    return MD.render(MD.drop_section(text, "for the Outreach team"), _link)


@router.get("", response_class=HTMLResponse)
async def index() -> HTMLResponse:
    cards = "".join(f'<li><a href="{_link(name + ".md")}"><strong>{html.escape(title)}</strong></a><br>{html.escape(about)}</li>'
                    for name, (title, about) in _GUIDES.items())
    return _page("Partner documentation", f"<h1>Partner documentation</h1><p>Everything a partner needs to connect to Outreach.</p><ul>{cards}</ul>")


@router.get("/{name}", response_class=HTMLResponse)
async def guide(name: str):
    if name not in _GUIDES:
        return PlainTextResponse("Not found", status_code=404)
    nav = f'<nav><a href="{_link("embed.md").rsplit("/", 1)[0]}">All partner guides</a></nav>'
    return _page(_GUIDES[name][0], nav + _guide_html(name))
