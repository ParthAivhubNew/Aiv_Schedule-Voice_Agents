"""The page a partner's popup opens to buy a phone number and verify the business.

The user searches, buys and uploads the business documents here, on our own page, so the partner never handles the
documents. The link is signed, names the organisation, works for 30 minutes and ends at the partner's registered return
address with ?status=&number_id=. It runs the same code as the Numbers screen.
"""
from __future__ import annotations

import html
import json
import logging
import urllib.parse
from types import SimpleNamespace
from typing import Any, Dict, List, Optional

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.approval_mail import _page

logger = logging.getLogger("public_api.numbers_page")
e = html.escape

_STYLE = """<style>
label{display:block;font-size:13px;font-weight:600;margin:12px 0 4px}
input,select{width:100%;box-sizing:border-box;height:40px;border:1px solid #E6E3DC;border-radius:10px;padding:0 12px;font:inherit;background:#fff}
input[type=file]{padding:8px 12px;height:auto}
.hint{font-size:12px;color:#5B6170;margin-top:4px}
.err{background:#FDECEA;border:1px solid #F3C4BE;color:#8A1F11;border-radius:10px;padding:10px 12px;font-size:14px;margin-bottom:12px}
.note{background:#E8F4F1;border:1px solid #B7DCD4;color:#0F4F47;border-radius:10px;padding:10px 12px;font-size:14px;margin-bottom:12px}
button.go{margin-top:14px;background:#12141C;color:#fff;border-color:#12141C}
.pick{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 0;border-top:1px solid #F1EFEA}
.pick:first-of-type{border-top:0}
</style>"""


def _request(org: str) -> SimpleNamespace:
    """Stands in for a signed-in request: the numbers code reads who is asking from request.state.auth."""
    return SimpleNamespace(state=SimpleNamespace(auth={"org_id": org, "is_admin": True, "type": "api_key", "name": "partner popup",
                                                      "email": "", "scopes": ["voice:calls"]}))


def _msg(err: Exception) -> str:
    if isinstance(err, HTTPException):
        d = err.detail
        return str(d.get("message") if isinstance(d, dict) else d)
    return "That did not work. Try again."


async def _state(db: AsyncSession, org: str) -> Dict[str, Any]:
    from app.api import telnyx_numbers as N

    try:
        return await N.overview(_request(org), db)
    except HTTPException:
        return {"numbers": [], "orders": [], "verification": None, "price": {"monthlyCredits": 0, "setupCredits": 0}}


def _fields_form(fields: List[Dict[str, Any]]) -> str:
    out = ""
    for f in fields:
        fid, name, kind = e(str(f["id"])), e(str(f["name"])), f["type"]
        help_ = f'<div class="hint">{e(str(f["description"]))}</div>' if f.get("description") else ""
        if kind == "document":
            out += f"<label>{name}</label><input type='file' name='doc_{fid}' accept='.pdf,.jpg,.jpeg,.png' required>{help_}"
        elif kind == "address":
            out += (f"<label>{name}</label>"
                    + "".join(f"<input name='addr_{fid}__{k}' placeholder='{ph}' required style='margin-bottom:6px'>"
                              for k, ph in (("street_address", "Street address"), ("locality", "Town or city"),
                                            ("postal_code", "Postcode"), ("country_code", "Country code, e.g. GB")))
                    + help_)
        else:
            out += f"<label>{name}</label><input name='txt_{fid}' required>{help_}"
    return out


async def render(db: AsyncSession, data: Dict[str, Any], company: str, notice: str = "", error: str = "",
                 results: Optional[List[Dict[str, Any]]] = None, query: Optional[Dict[str, str]] = None) -> str:
    org = data["o"]
    st = await _state(db, org)
    q = query or {}
    country = (q.get("country") or "GB").upper()
    number_type = q.get("number_type") or "local"
    ver = st.get("verification")
    mine = [n for n in st.get("numbers", []) if n["status"] in ("active", "held")]
    head = f"<h1>Phone numbers</h1><div class='sub'>{e(company)} · this link works for 30 minutes</div>"
    flash = (f'<div class="err" role="alert">{e(error)}</div>' if error else "") + (f'<div class="note">{e(notice)}</div>' if notice else "")
    own = ""
    for n in mine:
        own += f"<div class='pick'><strong>{e(n['e164'])}</strong><span class='pill good'>{e(n['status'])}</span></div>"
    pending = [o for o in st.get("orders", []) if o["status"] == "pending"]
    for o in pending:
        own += f"<div class='pick'><strong>{e(o['phoneNumber'])}</strong><span class='pill'>being set up</span></div>"
    own_card = f"<div class='card'><div class='head'>Your numbers</div>{own}</div>" if own else ""
    done_btn = ""
    if mine:
        done_btn = (f"<form method='post'><input type='hidden' name='action' value='done'><input type='hidden' name='number_id' value='{e(mine[0]['id'])}'>"
                    "<button class='go' type='submit'>Done: go back</button></form>")

    vtext = {"approved": ("Your business is verified.", "good"), "pending": ("Your documents are being reviewed.", ""),
             "declined": ("Your documents were not accepted: " + str((ver or {}).get("reason") or "no reason given") + ". Send them again below.", "bad"),
             "expired": ("Your verification expired. Send your documents again below.", "bad")}
    ver_line = ""
    if ver:
        text, tone = vtext.get(ver["status"], (f"Verification: {ver['status']}", ""))
        ver_line = f"<div class='card'><span class='pill {tone}'>{e(text)}</span></div>"

    price = st.get("price") or {}
    search = (f"<div class='card'><div class='head'>Find a number</div><form method='post'><input type='hidden' name='action' value='search'>"
              f"<label for='c'>Country</label><input id='c' name='country' value='{e(country)}' maxlength='2'>"
              f"<label for='t'>Type</label><select id='t' name='number_type'>"
              + "".join(f"<option value='{k}'{' selected' if number_type == k else ''}>{k.replace('_', ' ').title()}</option>"
                        for k in ("local", "mobile", "toll_free"))
              + "</select><label for='l'>Town or area code</label><input id='l' name='locality' value='" + e(q.get("locality", "")) + "'>"
              "<button class='go' type='submit'>Search</button></form>"
              f"<div class='hint'>{price.get('monthlyCredits', 0)} credits a month per number, {price.get('setupCredits', 0)} credits one-off setup.</div></div>")
    found = ""
    if results is not None:
        if not results:
            found = "<div class='card'>No numbers found. Try another town or area code.</div>"
        else:
            rows = "".join(f"<div class='pick'><span><strong>{e(r['phoneNumber'])}</strong> <span class='hint'>{e(r.get('region') or '')}</span></span>"
                           f"<form method='post' style='margin:0'><input type='hidden' name='action' value='buy'>"
                           f"<input type='hidden' name='phone_number' value='{e(r['phoneNumber'])}'><input type='hidden' name='country' value='{e(country)}'>"
                           f"<input type='hidden' name='number_type' value='{e(number_type)}'><button class='ok' type='submit'>Buy</button></form></div>"
                           for r in results)
            found = f"<div class='card'><div class='head'>Available numbers</div>{rows}</div>"
    docs = ""
    if q.get("verify") == "1" or (ver and ver["status"] in ("declined", "expired")):
        from app.api import telnyx_numbers as N

        try:
            reqs = (await N.requirements(_request(org), country=country, number_type=number_type, db=db))["fields"]
        except HTTPException:
            reqs = []
        if reqs:
            docs = (f"<div class='card'><div class='head'>Verify your business</div><form method='post' enctype='multipart/form-data'>"
                    f"<input type='hidden' name='action' value='verify'><input type='hidden' name='country' value='{e(country)}'>"
                    f"<input type='hidden' name='number_type' value='{e(number_type)}'>"
                    "<label for='en'>Business type</label><select id='en' name='entity_type'><option value='company'>Company</option>"
                    "<option value='sole_trader'>Sole trader</option></select>"
                    f"{_fields_form(reqs)}<div class='hint'>PDF, JPG or PNG, up to 10 MB each. Review usually takes a few working days.</div>"
                    "<button class='go' type='submit'>Send for review</button></form></div>")
    return _page("Phone numbers", _STYLE + head + flash + own_card + ver_line + done_btn + search + found + docs)


def done(return_url: str, number_id: str, status: str = "connected") -> str:
    """The page after the user is finished: tells the page that opened this popup (only at the return address's own origin) and goes back to it."""
    parts = urllib.parse.urlparse(return_url)
    origin = f"{parts.scheme}://{parts.netloc}"
    q = urllib.parse.urlencode({"status": status, "provider": "number", "number_id": number_id})
    dest = return_url + ("&" if parts.query else "?") + q
    msg = json.dumps({"type": "outreach.number", "status": status, "number_id": number_id}).replace("</", "<\\/")
    body = ("<h1>All set</h1><div class='sub'>You can close this window.</div>"
            f"<script>try{{if(window.opener)window.opener.postMessage({msg},{json.dumps(origin)});}}catch(x){{}}"
            f"setTimeout(function(){{window.location.replace({json.dumps(dest)});}},500);</script>")
    return _page("Phone numbers", body)


async def act(db: AsyncSession, data: Dict[str, Any], form: Dict[str, str], files: Dict[str, Any]) -> Dict[str, Any]:
    """Do what the form asked. Returns {notice?, error?, results?, query?, finished?: number_id}."""
    from app.api import telnyx_numbers as N

    org, action = data["o"], form.get("action", "")
    req = _request(org)
    query = {k: form.get(k, "") for k in ("country", "number_type", "locality")}
    try:
        if action == "search":
            return {"results": await N.search(req, country=query["country"] or "GB", number_type=query["number_type"] or "local",
                                              locality=query["locality"], area_code="", contains="", db=db), "query": query}
        if action == "buy":
            out = await N.order(N.OrderBody(phoneNumber=form.get("phone_number", ""), country=query["country"] or "GB",
                                            numberType=query["number_type"] or "local"), req, db)
            return {"notice": "Ordered. It is ready in a few minutes; we tell the app that sent you here.", "query": query, "order": out}
        if action == "verify":
            texts = {k[4:]: v for k, v in form.items() if k.startswith("txt_")}
            addresses: Dict[str, Dict[str, str]] = {}
            for k, v in form.items():
                if k.startswith("addr_") and "__" in k:
                    rid, part = k[5:].split("__", 1)
                    addresses.setdefault(rid, {})[part] = v
            await N.submit_documents(db, req.state.auth, query["country"] or "GB", query["number_type"] or "local",
                                     form.get("entity_type", "company"), texts, addresses, files)
            return {"notice": "Sent. We will tell you when it is reviewed.", "query": query}
        if action == "done":
            return {"finished": form.get("number_id", "")}
    except HTTPException as err:
        await db.rollback()
        return {"error": _msg(err), "query": query, "results": None}
    except Exception as err:
        logger.warning(f"numbers page {action} failed: {err}")
        await db.rollback()
        return {"error": "That did not work. Try again.", "query": query}
    return {"query": query}
