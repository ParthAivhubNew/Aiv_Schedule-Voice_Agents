"""Inbound web forms.

Signed in (Leads):  /inbound/forms ... build, publish, share and review answers.
Public:             /f/{key}/page, /f/{key}/config, /f/{key}/submit  -- a published form, for anyone.
"""
from __future__ import annotations

import html
import json
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenancy import org_scope, system_scope
from app.database import AsyncSessionLocal, get_db
from app.models.models import InboundForm, InboundSubmission
from app.public_api.core import check_rate
from app.services import inbound_forms as IF

router = APIRouter(prefix="/inbound", tags=["Inbound"])
public_router = APIRouter(prefix="/f", tags=["Inbound (public)"])

MAX_FORMS = 100
MAX_BODY_BYTES = 20_000


class FormIn(BaseModel):
    name: Optional[str] = None
    fields: Optional[List[Dict[str, Any]]] = None
    settings: Optional[Dict[str, Any]] = None


def _out(f: InboundForm, total: int = 0, pending: int = 0) -> Dict[str, Any]:
    return {
        "id": f.id, "name": f.name, "status": f.status, "fields": f.fields or [], "settings": f.settings or {},
        "schema_version": f.schema_version, "public_key": f.public_key, "published_at": f.published_at.isoformat() + "Z" if f.published_at else None,
        "updated_at": f.updated_at.isoformat() + "Z" if f.updated_at else None, "created_at": f.created_at.isoformat() + "Z" if f.created_at else None,
        "submissions": total, "pending": pending,
        "dirty": bool(f.status == "published" and (f.fields or []) != (f.published_fields or [])),  # edited since it was last published
    }


async def _form(db: AsyncSession, form_id: str) -> InboundForm:
    f = await db.get(InboundForm, form_id)
    if not f:
        raise HTTPException(status_code=404, detail="That form doesn't exist any more.")
    return f


async def _counts(db: AsyncSession, ids: List[str]) -> Dict[str, Dict[str, int]]:
    if not ids:
        return {}
    rows = (await db.execute(select(InboundSubmission.form_id, InboundSubmission.status, func.count())
                             .where(InboundSubmission.form_id.in_(ids)).group_by(InboundSubmission.form_id, InboundSubmission.status))).all()
    out: Dict[str, Dict[str, int]] = {}
    for fid, status, n in rows:
        d = out.setdefault(fid, {"total": 0, "pending": 0})
        d["total"] += n
        if status == "pending":
            d["pending"] += n
    return out


# ── Signed in ────────────────────────────────────────────────────────────────────────────────
@router.get("/forms")
async def list_forms(db: AsyncSession = Depends(get_db)):
    forms = (await db.execute(select(InboundForm).order_by(InboundForm.created_at.desc()))).scalars().all()
    counts = await _counts(db, [f.id for f in forms])
    return {"forms": [_out(f, counts.get(f.id, {}).get("total", 0), counts.get(f.id, {}).get("pending", 0)) for f in forms]}


@router.post("/forms")
async def create_form(body: FormIn, db: AsyncSession = Depends(get_db)):
    n = (await db.execute(select(func.count()).select_from(InboundForm))).scalar() or 0
    if n >= MAX_FORMS:
        raise HTTPException(status_code=400, detail=f"You can keep up to {MAX_FORMS} forms. Delete one first.")
    f = InboundForm(
        id=f"frm_{uuid.uuid4().hex[:14]}", name=IF.clean_text(body.name, 80) or f"New form {datetime.utcnow():%d %b %Y}",
        fields=IF.default_fields(), settings=IF.clean_settings({}), public_key=IF.new_key(),
    )
    db.add(f)
    await db.commit()
    return _out(f)


@router.get("/forms/{form_id}")
async def get_form(form_id: str, db: AsyncSession = Depends(get_db)):
    f = await _form(db, form_id)
    c = (await _counts(db, [f.id])).get(f.id, {})
    return _out(f, c.get("total", 0), c.get("pending", 0))


@router.put("/forms/{form_id}")
async def update_form(form_id: str, body: FormIn, db: AsyncSession = Depends(get_db)):
    f = await _form(db, form_id)
    if body.name is not None:
        f.name = IF.clean_text(body.name, 80) or f.name
    if body.fields is not None:
        try:
            f.fields = IF.clean_fields(body.fields)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
    if body.settings is not None:
        f.settings = IF.clean_settings({**(f.settings or {}), **body.settings})
    f.updated_at = datetime.utcnow()
    await db.commit()
    return _out(f)


@router.post("/forms/{form_id}/publish")
async def publish_form(form_id: str, db: AsyncSession = Depends(get_db)):
    f = await _form(db, form_id)
    f.published_fields = IF.clean_fields(f.fields or [])
    f.schema_version = (f.schema_version or 0) + 1
    f.status, f.published_at = "published", datetime.utcnow()
    await db.commit()
    return _out(f)


@router.post("/forms/{form_id}/unpublish")
async def unpublish_form(form_id: str, db: AsyncSession = Depends(get_db)):
    f = await _form(db, form_id)
    f.status = "draft"
    await db.commit()
    return _out(f)


@router.post("/forms/{form_id}/rotate-key")
async def rotate_key(form_id: str, db: AsyncSession = Depends(get_db)):
    """A new public link. The old link and any iframe using it stop working at once."""
    f = await _form(db, form_id)
    f.public_key = IF.new_key()
    await db.commit()
    return _out(f)


@router.delete("/forms/{form_id}")
async def delete_form(form_id: str, db: AsyncSession = Depends(get_db)):
    f = await _form(db, form_id)
    await db.execute(InboundSubmission.__table__.delete().where(InboundSubmission.form_id == f.id))
    await db.delete(f)
    await db.commit()
    return {"ok": True}


def _sub_out(s: InboundSubmission) -> Dict[str, Any]:
    return {"id": s.id, "form_id": s.form_id, "email": s.email, "status": s.status, "reason": s.reason, "lead_id": s.lead_id,
            "answers": s.payload or {}, "schema_version": s.schema_version, "created_at": s.created_at.isoformat() + "Z" if s.created_at else None}


@router.get("/forms/{form_id}/submissions")
async def list_submissions(form_id: str, limit: int = 100, db: AsyncSession = Depends(get_db)):
    f = await _form(db, form_id)
    rows = (await db.execute(select(InboundSubmission).where(InboundSubmission.form_id == f.id)
                             .order_by(InboundSubmission.created_at.desc()).limit(max(1, min(limit, 500))))).scalars().all()
    labels = {x["id"]: x["label"] for x in (f.published_fields or f.fields or [])}
    return {"submissions": [_sub_out(s) for s in rows], "labels": labels}


@router.post("/submissions/{sub_id}/approve")
async def approve_submission(sub_id: str, db: AsyncSession = Depends(get_db)):
    s = await db.get(InboundSubmission, sub_id)
    if not s:
        raise HTTPException(status_code=404, detail="That answer doesn't exist any more.")
    if s.status == "approved":
        return _sub_out(s)
    f = await _form(db, s.form_id)
    await IF.approve(db, s, f, how="owner")
    await db.commit()
    return _sub_out(s)


@router.post("/submissions/{sub_id}/block")
async def block_submission(sub_id: str, db: AsyncSession = Depends(get_db)):
    s = await db.get(InboundSubmission, sub_id)
    if not s:
        raise HTTPException(status_code=404, detail="That answer doesn't exist any more.")
    if s.status == "approved":
        raise HTTPException(status_code=400, detail="It is already saved as a lead. Remove the lead from Lists instead.")
    s.status, s.reason = "blocked", "Blocked by you."
    await db.commit()
    return _sub_out(s)


# ── Public ───────────────────────────────────────────────────────────────────────────────────
async def _published(key: str) -> Optional[Dict[str, Any]]:
    """The published form for a public key, as plain data (looked up outside any one organisation)."""
    if not key or len(key) > 64:
        return None
    with system_scope():
        async with AsyncSessionLocal() as db:
            f = (await db.execute(select(InboundForm).where(InboundForm.public_key == key))).scalars().first()
            if not f or f.status != "published" or not f.published_fields:
                return None
            return {"id": f.id, "org_id": f.org_id, "name": f.name, "fields": f.published_fields, "settings": f.settings or {}, "version": f.schema_version}


def _public_fields(fields: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [{**{k: f[k] for k in ("id", "type", "label", "placeholder", "required", "options")}, "share": bool(f.get("share_to_company"))} for f in fields]


async def _link_context(f: Dict[str, Any], t: str) -> Optional[Dict[str, Any]]:
    """What a personal link (from an email) says about the visitor: their email and name, and who sent it. None for a link
    without a token, or one that was altered, expired, or belongs to another form."""
    from app.services import form_links as FL

    tok = FL.read_token(t) if t else None
    if not tok or tok["form_id"] != f["id"] or tok["org_id"] != f["org_id"]:
        return None
    from sqlalchemy import text as sql

    from app.models.models import EmailEnrollment

    name = company = sender = ""
    try:
        with org_scope(f["org_id"]):
            async with AsyncSessionLocal() as db:
                enr = await db.get(EmailEnrollment, tok["enrollment_id"]) if tok["enrollment_id"] else None
                if enr is not None:
                    name, company = f"{enr.first_name or ''} {enr.last_name or ''}".strip(), enr.company or ""
                row = (await db.execute(sql("SELECT name FROM organizations WHERE id = :i"), {"i": f["org_id"]})).first()
                sender = (row[0] if row else "") or ""
    except Exception:
        pass  # the form still works without the pre-fill
    return {"email": tok["email"], "name": name, "company": company, "sender": sender}


def _client_ip(request: Request) -> str:
    fwd = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    return fwd or (request.client.host if request.client else "")


@public_router.get("/{key}/config")
async def form_config(key: str):
    f = await _published(key)
    if not f:
        raise HTTPException(status_code=404, detail="This form is not available.")
    return JSONResponse({"name": f["name"], "fields": _public_fields(f["fields"]), "thanks": f["settings"].get("thanks", "")},
                        headers={"Cache-Control": "public, max-age=30"})


@public_router.post("/{key}/submit")
async def submit(key: str, request: Request):
    f = await _published(key)
    if not f:
        raise HTTPException(status_code=404, detail="This form is not available.")
    ip = _client_ip(request)
    wait = check_rate(f"inbound:{key}:{ip}", True) or check_rate(f"inbound:{key}", True)
    if wait:
        return JSONResponse({"detail": "Too many answers just now. Try again in a moment."}, status_code=429, headers={"Retry-After": str(wait)})
    raw = await request.body()
    if len(raw) > MAX_BODY_BYTES:
        return JSONResponse({"detail": "That answer is too large."}, status_code=413)
    try:
        data = json.loads(raw or b"{}")
    except ValueError:
        return JSONResponse({"detail": "That answer could not be read."}, status_code=400)
    thanks = f["settings"].get("thanks") or "Thanks, we got your details."
    from app.services import form_links as FL

    tok = None
    token_raw = str(data.pop("_t", "") or "") if isinstance(data, dict) else ""
    if token_raw:  # the form was opened from a personal link in an email
        tok = FL.read_token(token_raw)
        if not tok or tok["form_id"] != f["id"] or tok["org_id"] != f["org_id"]:
            return JSONResponse({"detail": "This link has expired. Ask the sender for a new one."}, status_code=410)
    if isinstance(data, dict) and data.get(IF.HONEYPOT):
        return {"ok": True, "thanks": thanks}  # a bot: look like success, store nothing
    answers, errors = IF.validate_answer(f["fields"], f["settings"], data)
    if errors:
        return JSONResponse({"detail": "Please check the form.", "errors": errors}, status_code=422)
    email = IF.email_of(f["fields"], answers)
    if tok:  # the address in the link is the one the email went to: the person cannot send an answer as someone else
        email = tok["email"]
        for fld in f["fields"]:
            if fld["type"] == "email":
                answers[fld["id"]] = email
    with org_scope(f["org_id"]):
        async with AsyncSessionLocal() as db:
            if await IF.submissions_today(db, f["id"]) >= int(f["settings"].get("daily_limit") or IF.DEFAULT_DAILY_LIMIT):
                return JSONResponse({"detail": "This form is not taking answers right now. Please try again later."}, status_code=429)
            if tok:  # one answer per person per personal link
                done = (await db.execute(select(InboundSubmission.id).where(
                    InboundSubmission.form_id == f["id"], InboundSubmission.email == email, InboundSubmission.reason == "email link"))).first()
                if done:
                    return {"ok": True, "thanks": thanks}
            same = None if tok else (await db.execute(select(InboundSubmission.id).where(
                InboundSubmission.form_id == f["id"], InboundSubmission.email == email,
                InboundSubmission.created_at >= datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)))).first()
            if same:
                return {"ok": True, "thanks": thanks}  # the same person twice in one day: one row is enough
            sub = InboundSubmission(id=f"sub_{uuid.uuid4().hex[:16]}", form_id=f["id"], schema_version=f["version"], payload=answers,
                                    email=email, status="pending", ip_hash=IF.ip_hash(ip))
            db.add(sub)
            if tok:  # it came from our own email: no email check, it goes straight to the lead it was sent to
                await db.flush()
                form = await db.get(InboundForm, f["id"])
                await FL.attach(db, sub, form, tok)
                await db.commit()
                return {"ok": True, "thanks": thanks}
            await db.commit()
            sub_id = sub.id
    IF.start_review(f["org_id"], sub_id)
    return {"ok": True, "thanks": thanks}


@public_router.get("/{key}/page")
async def form_page(key: str, t: str = ""):
    f = await _published(key)
    if not f:
        return HTMLResponse("<!doctype html><meta charset=utf-8><title>Form not available</title><p style='font:16px system-ui;padding:24px'>This form is not available.</p>", status_code=404)
    page = _PAGE.replace("__TITLE__", html.escape(f["name"])).replace("__KEY__", json.dumps(key)).replace("__FIELDS__", json.dumps(_public_fields(f["fields"])).replace("</", "<\\/")) \
        .replace("__THANKS__", json.dumps(f["settings"].get("thanks", "")).replace("</", "<\\/")).replace("__HP__", IF.HONEYPOT)
    ctx = await _link_context(f, t) if t else None
    page = page.replace("__PREFILL__", json.dumps({**ctx, "t": t} if ctx else None).replace("</", "<\\/"))
    return HTMLResponse(page, headers={
        "Content-Security-Policy": IF.frame_ancestors(f["settings"]) + "; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'",
        "Referrer-Policy": "no-referrer", "Cache-Control": "no-store",
    })


_PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>__TITLE__</title>
<style>
*{box-sizing:border-box}body{margin:0;font:16px/1.4 system-ui,-apple-system,Segoe UI,sans-serif;color:#2b2926;background:#fff}
form{max-width:520px;margin:0 auto;padding:24px 16px}h1{font-size:22px;margin:0 0 16px}
label{display:block;font-weight:600;font-size:14px;margin:14px 0 6px}.req{color:#f72237}
input[type=text],input[type=email],input[type=tel],select{width:100%;padding:11px 12px;border:1px solid #d8d6d4;border-radius:8px;font:inherit;background:#fff}
input:focus,select:focus{outline:2px solid #2b2926;outline-offset:1px}
.chk{display:flex;gap:10px;align-items:flex-start;font-weight:400;margin-top:14px}.chk input{margin-top:4px}
.err{color:#b4121f;font-size:13px;margin-top:4px}button{margin-top:20px;padding:12px 20px;border:0;border-radius:8px;background:#2b2926;color:#fff;font:inherit;font-weight:600;cursor:pointer;min-height:44px}
button[disabled]{opacity:.6;cursor:default}.hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}.ok{padding:32px 16px;text-align:center;font-size:18px}
.from{color:#6b6762;font-size:14px;margin:-8px 0 8px}
</style></head><body>
<form id="f" novalidate><h1>__TITLE__</h1><div id="fields"></div><div class="hp" aria-hidden="true"><label>Leave this empty<input type="text" name="__HP__" tabindex="-1" autocomplete="off"></label></div>
<div class="err" id="top" role="alert"></div><button type="submit" id="go">Submit</button></form>
<div class="ok" id="done" hidden role="status"></div>
<script>
var KEY=__KEY__,FIELDS=__FIELDS__,THANKS=__THANKS__,PREFILL=__PREFILL__;
var box=document.getElementById("fields"),form=document.getElementById("f");
FIELDS.forEach(function(f){
  var w=document.createElement("div"),id="q_"+f.id,el;
  if(f.type==="checkbox"){w.className="chk";el=document.createElement("input");el.type="checkbox";el.id=id;var l=document.createElement("label");l.className="chk";l.htmlFor=id;l.style.margin="0";l.textContent=f.label;w.appendChild(el);w.appendChild(l);}
  else{var lab=document.createElement("label");lab.htmlFor=id;lab.textContent=f.label;if(f.required){var s=document.createElement("span");s.className="req";s.textContent=" *";lab.appendChild(s);}w.appendChild(lab);
    if(f.type==="dropdown"){el=document.createElement("select");var o0=document.createElement("option");o0.value="";o0.textContent=f.placeholder||"Choose one";el.appendChild(o0);f.options.forEach(function(o){var op=document.createElement("option");op.value=o;op.textContent=o;el.appendChild(op);});}
    else{el=document.createElement("input");el.type=f.type==="email"?"email":f.type==="phone"?"tel":"text";el.placeholder=f.placeholder||"";el.autocomplete=f.type==="email"?"email":f.type==="phone"?"tel":f.type==="name"?"name":"off";}
    el.id=id;w.appendChild(el);}
  var e=document.createElement("div");e.className="err";e.id="e_"+f.id;w.appendChild(e);box.appendChild(w);
});
if(PREFILL){FIELDS.forEach(function(f){var el=document.getElementById("q_"+f.id);if(!el)return;if(f.type==="email"){el.value=PREFILL.email;el.readOnly=true;}else if(f.type==="name"&&PREFILL.name){el.value=PREFILL.name;}if(f.share){var n=document.createElement("div");n.className="from";n.textContent="This will be added to the company details, shown as confirmed by you.";el.parentNode.appendChild(n);}});if(PREFILL.sender){var p=document.createElement("p");p.className="from";p.textContent="Sent to you by "+PREFILL.sender+".";var h=document.querySelector("h1");h.parentNode.insertBefore(p,h.nextSibling);}}
form.addEventListener("submit",function(ev){
  ev.preventDefault();var body={},go=document.getElementById("go");
  FIELDS.forEach(function(f){var el=document.getElementById("q_"+f.id);body[f.id]=f.type==="checkbox"?el.checked:el.value;document.getElementById("e_"+f.id).textContent="";});
  body["__HP__"]=form.elements["__HP__"].value;if(PREFILL)body._t=PREFILL.t;document.getElementById("top").textContent="";go.disabled=true;
  fetch("/api/f/"+encodeURIComponent(KEY)+"/submit",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}).then(function(r){return r.json().then(function(j){return{s:r.status,j:j};});}).then(function(x){
    if(x.s===200){form.hidden=true;var d=document.getElementById("done");d.textContent=x.j.thanks||THANKS||"Thanks.";d.hidden=false;return;}
    go.disabled=false;var er=x.j.errors||{};Object.keys(er).forEach(function(k){var t=document.getElementById("e_"+k);if(t)t.textContent=er[k];});
    if(!Object.keys(er).length)document.getElementById("top").textContent=x.j.detail||"Something went wrong. Please try again.";
  }).catch(function(){go.disabled=false;document.getElementById("top").textContent="Could not send. Check your connection and try again.";});
});
</script></body></html>"""
