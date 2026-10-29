"""The partner guides as public web pages, so a partner can read them without an account.

GET /docs/partners          the guides and what each is for
GET /docs/partners/start    Get started, step by step
GET /docs/partners/embed    Embedding reference
GET /docs/partners/api      API reference

The text lives in backend/docs/partners/*.md; edit those and the pages follow. The section written for the Outreach team is left out.
"""
from __future__ import annotations

import html
import re
from functools import lru_cache
from pathlib import Path
from typing import List, Tuple

from fastapi import APIRouter
from fastapi.responses import HTMLResponse, PlainTextResponse

from app.config import settings
from app.partner_kit import server_file, snippet
from app.services import mini_markdown as MD

router = APIRouter(prefix="/docs/partners", tags=["Partner docs"])
_DIR = Path(__file__).resolve().parents[2] / "docs" / "partners"
_GUIDES = {
    "start": ("Get started", "New here? Seven steps from nothing to an Outreach screen inside your product, with code to copy."),
    "snippets": ("Copy-paste code", "The code to show Outreach your way (panel, popup, side panel, full page) and the one small server file, in your language."),
    "embed": ("Embedding reference", "Every option for showing screens: popups, side panels, colours, connecting users, security."),
    "api": ("API reference", "Use an account from your server: calls, lists, webhooks. The older path, still supported."),
}
_STYLE = """
:root{--bg:#fff;--ink:#14171F;--mute:#566070;--line:#E3E6EB;--soft:#F5F6F8;--accent:#2F4FD0;--code:#F1F3F6;--tip:#E8F3EE;--tipline:#2F7D5B;--warn:#FBF0E4;--warnline:#B4620A}
@media (prefers-color-scheme:dark){:root{--bg:#12141C;--ink:#E8EAF0;--mute:#A0A8B6;--line:#2A3040;--soft:#181C27;--accent:#8CB0FF;--code:#1D2230;--tip:#17261F;--tipline:#5DBB8E;--warn:#2A2016;--warnline:#E0A25A}}
*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:76px}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.7 -apple-system,Segoe UI,Roboto,Arial,sans-serif}
a{color:var(--accent)}
header{position:sticky;top:0;z-index:5;background:var(--bg);border-bottom:1px solid var(--line)}
.bar{max-width:1120px;margin:0 auto;padding:0 16px;display:flex;gap:4px;align-items:center;overflow-x:auto}
.bar .brand{font-weight:700;margin-right:16px;white-space:nowrap}
.bar a.tab{padding:15px 12px;text-decoration:none;color:var(--mute);font-size:14.5px;font-weight:600;border-bottom:2px solid transparent;white-space:nowrap}
.bar a.tab[aria-current=page]{color:var(--ink);border-color:var(--accent)}
.wrap{max-width:1120px;margin:0 auto;padding:28px 16px 96px;display:grid;grid-template-columns:230px minmax(0,1fr);gap:48px}
aside{position:sticky;top:76px;align-self:start;max-height:calc(100vh - 100px);overflow:auto;font-size:14px}
aside .label{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--mute);margin:0 0 8px}
aside a{display:block;padding:5px 10px;margin-left:-10px;border-radius:6px;color:var(--mute);text-decoration:none;line-height:1.4}
aside a:hover{background:var(--soft);color:var(--ink)}aside a.on{color:var(--accent);font-weight:600;background:var(--soft)}
details.toc{display:none}
article{max-width:780px;min-width:0}
h1{font-size:34px;line-height:1.2;margin:4px 0 16px}
h2{font-size:24px;line-height:1.3;margin:56px 0 12px;padding-top:28px;border-top:1px solid var(--line)}
h2:first-of-type{margin-top:32px}h3{font-size:18px;margin:32px 0 8px}
p,li{max-width:70ch}li{margin:4px 0}ul,ol{padding-left:22px}
code{background:var(--code);padding:2px 6px;border-radius:5px;font:.88em ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.pre{position:relative;margin:16px 0}
pre{background:var(--code);padding:16px;border-radius:10px;overflow-x:auto;margin:0;line-height:1.55;font-size:13.5px}
pre code{background:none;padding:0;font-size:inherit}
.copy{position:absolute;top:8px;right:8px;font:600 12px -apple-system,Segoe UI,Arial,sans-serif;padding:4px 10px;border-radius:6px;border:1px solid var(--line);background:var(--bg);color:var(--ink);cursor:pointer}
blockquote{margin:20px 0;padding:12px 16px;border-radius:8px;background:var(--soft);border:1px solid var(--line)}
blockquote.tip{background:var(--tip);border-color:var(--tipline)}blockquote.warn{background:var(--warn);border-color:var(--warnline)}
.wide{overflow-x:auto;margin:16px 0;border:1px solid var(--line);border-radius:10px}
table{border-collapse:collapse;width:100%;font-size:14.5px;line-height:1.5}
th,td{padding:10px 12px;text-align:left;vertical-align:top;border-bottom:1px solid var(--line)}
th{background:var(--soft);font-size:13px;color:var(--mute)}tr:last-child td{border-bottom:0}
ul.cards{list-style:none;padding:0;display:grid;gap:12px}ul.cards li{border:1px solid var(--line);border-radius:12px;padding:16px 18px;max-width:none}
ul.cards a{font-size:18px;font-weight:700;text-decoration:none}
@media (max-width:860px){.wrap{grid-template-columns:minmax(0,1fr);gap:0;padding-top:16px}aside{display:none}details.toc{display:block;margin-bottom:12px;border:1px solid var(--line);border-radius:10px;padding:10px 14px}
details.toc summary{cursor:pointer;font-weight:600}details.toc a{display:block;padding:6px 0;color:var(--mute);text-decoration:none}h1{font-size:28px}h2{font-size:21px}}
"""
_SCRIPT = """
(function(){try{
document.querySelectorAll('.pre').forEach(function(box){var b=document.createElement('button');b.type='button';b.className='copy';b.textContent='Copy';
b.onclick=function(){var t=box.querySelector('code').innerText;(navigator.clipboard?navigator.clipboard.writeText(t):Promise.reject()).then(function(){b.textContent='Copied';setTimeout(function(){b.textContent='Copy'},1500)},function(){b.textContent='Press Ctrl+C'})};box.appendChild(b)});
var links=[].slice.call(document.querySelectorAll('aside a'));if(!links.length||!('IntersectionObserver'in window))return;
var map={};links.forEach(function(a){map[a.getAttribute('href').slice(1)]=a});
var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){links.forEach(function(a){a.classList.remove('on')});var a=map[e.target.id];if(a)a.classList.add('on')}})},{rootMargin:'-80px 0px -70% 0px'});
document.querySelectorAll('article h2').forEach(function(h){io.observe(h)});
}catch(e){}})();
"""


def _base() -> str:
    return f"{(settings.PUBLIC_BASE_URL or '').rstrip('/')}{settings.API_PREFIX}/docs/partners"


def _link(href: str) -> str:
    """The guides link to each other as embed.md / api.md; on the web those are page addresses."""
    for name in _GUIDES:
        if href == f"{name}.md" or href.startswith(f"{name}.md#"):
            return _base() + "/" + href.replace(".md", "", 1)
    return href


def _page(title: str, body: str, current: str = "", toc: List[Tuple[str, str]] = ()) -> HTMLResponse:
    tabs = "".join(f'<a class="tab" href="{_base()}/{name}"{" aria-current=page" if name == current else ""}>{html.escape(label)}</a>'
                   for name, (label, _) in _GUIDES.items())
    items = "".join(f'<a href="#{anchor}">{html.escape(text)}</a>' for anchor, text in toc)
    side = f'<aside aria-label="On this page"><p class="label">On this page</p>{items}</aside>' if toc else "<aside></aside>"
    mobile = f'<details class="toc"><summary>On this page</summary>{items}</details>' if toc else ""
    doc = (f'<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
           f"<title>{html.escape(title)}</title><style>{_STYLE}</style></head><body>"
           f'<header><nav class="bar" aria-label="Partner guides"><span class="brand">Outreach for partners</span>{tabs}</nav></header>'
           f'<div class="wrap">{side}<article>{mobile}{body}</article></div><script>{_SCRIPT}</script></body></html>')
    # SAMEORIGIN lets the Partner programme screen show the page in place; other sites still cannot frame it.
    return HTMLResponse(doc, headers={"Cache-Control": "public, max-age=300", "X-Frame-Options": "SAMEORIGIN"})


_LANG = {".html": "html", ".jsx": "jsx", ".mjs": "js", ".js": "js", ".py": "python", ".php": "php"}


def _expand(text: str) -> str:
    """{{snippet:panel.html}} and {{server:node}} become the very files the starter kit ships, so the docs and the kit cannot differ."""
    def code(name: str, body: str) -> str:
        return "```" + _LANG.get("." + name.rsplit(".", 1)[-1], "") + "\n" + body.rstrip("\n") + "\n```"

    text = re.sub(r"^\{\{snippet:([\w.-]+)\}\}$", lambda m: code(m.group(1), snippet(m.group(1))), text, flags=re.M)
    text = re.sub(r"^\{\{server:(\w+)\}\}$", lambda m: code(*server_file(m.group(1))), text, flags=re.M)
    return text.replace("{{HOST}}", "https://YOUR-OUTREACH-HOST")


@lru_cache(maxsize=8)
def _guide(name: str) -> Tuple[str, Tuple[Tuple[str, str], ...]]:
    text = _expand(MD.drop_section((_DIR / f"{name}.md").read_text(encoding="utf-8"), "for the Outreach team"))
    rendered = MD.render(text, _link).replace("<pre>", '<div class="pre"><pre>').replace("</pre>", "</pre></div>")
    return rendered, tuple(MD.headings(text))


def _guide_html(name: str) -> str:
    return _guide(name)[0]


@router.get("", response_class=HTMLResponse)
async def index() -> HTMLResponse:
    cards = "".join(f'<li><a href="{_base()}/{name}">{html.escape(title)}</a><br>{html.escape(about)}</li>' for name, (title, about) in _GUIDES.items())
    return _page("Partner documentation", f'<h1>Partner documentation</h1><p>Everything a partner needs to connect to Outreach. Start with the first guide.</p><ul class="cards">{cards}</ul>')


@router.get("/{name}", response_class=HTMLResponse)
async def guide(name: str):
    if name not in _GUIDES:
        return PlainTextResponse("Not found", status_code=404)
    body, toc = _guide(name)
    return _page(f"{_GUIDES[name][0]} | Outreach partners", body, current=name, toc=list(toc))
