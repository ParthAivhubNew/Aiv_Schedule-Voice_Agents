"""The campaign preview page: see the emails, edit them, ask the AI to redo them, approve or reject. No sign-in."""
from __future__ import annotations

import html
from typing import Any, Dict

from app.public_api import email as E
from app.public_api.core import ApiError
from app.services.approval_mail import _page

_STATUS = {
    "drafting": ("The AI is writing the emails. This page refreshes by itself.", ""),
    "needs_approval": ("Waiting for your decision", ""), "approved": ("Approved", "good"), "sending": ("Sending", "good"),
    "paused": ("Paused", ""), "completed": ("Finished", "good"), "rejected": ("Rejected", "bad"), "failed": ("Something went wrong", "bad"),
}
_BOX = 'style="width:100%;box-sizing:border-box;padding:8px;border:1px solid #E6E3DC;border-radius:10px;font:inherit"'


def _esc(v: Any) -> str:
    return html.escape(str(v if v is not None else ""))


def render(v: Dict[str, Any], company: str, notice: str = "") -> str:
    st = v["status"]
    label, tone = _STATUS.get(st, (st, ""))
    banner = f'<div class="card" style="border-color:#0F766E"><strong>{_esc(notice)}</strong></div>' if notice else ""
    test = '<div class="card" style="border-color:#B45309"><strong>Test campaign.</strong> Nothing real is sent or charged.</div>' if v.get("test") else ""
    extra = (f'<div class="meta bad" style="margin-top:8px">{_esc(v["error"])}</div>' if v.get("error") else "") + \
            (f'<div class="meta" style="margin-top:8px">{_esc(v["note"])}</div>' if v.get("note") else "")
    boxes = ", ".join(_esc(m["email"]) for m in v["mailboxes"]) or "None"
    sched = v["schedule"]
    summary = (f'<div class="card"><div class="meta">Campaign</div><div class="head">{_esc(v["name"])}</div><span class="pill {tone}">{_esc(label)}</span>{extra}'
               f'<div class="meta" style="margin-top:10px">{v["leads"]} people · {len(v["steps"])} emails · up to {v["estimated_credits"]} credits · sent from {boxes}</div>'
               f'<div class="meta">Sends {_esc(sched["sending_window_start"])}–{_esc(sched["sending_window_end"])} on days {", ".join(str(d) for d in sched["days_of_week"])}</div>'
               + (f'<div class="meta">Sent {v["stats"]["sent"]} · replies {v["stats"]["replied"]} · bounced {v["stats"]["bounced"]}</div>'
                  if st in ("sending", "paused", "completed") else "") + "</div>")
    editable = st in ("needs_approval", "rejected") and not v.get("test")
    emails = ""
    for s in v["steps"]:
        wait = f' · {s["delay_days"]} days after the one before' if s["step"] > 1 else ""
        if editable:
            emails += (f'<div class="card"><div class="meta">Email {s["step"]}{wait}</div>'
                       f'<input name="subject_{s["step"]}" value="{_esc(s["subject"])}" {_BOX}>'
                       f'<textarea name="body_{s["step"]}" rows="7" style="margin-top:6px">{_esc(s["body"])}</textarea>'
                       f'<input type="hidden" name="delay_{s["step"]}" value="{s["delay_days"]}"></div>')
        else:
            emails += (f'<div class="card"><div class="meta">Email {s["step"]}{wait}</div><div class="head">{_esc(s["subject"])}</div>'
                       f'<div class="cap">{_esc(s["body"])}</div></div>')
    if v.get("warnings"):
        emails = ('<div class="card" style="border-color:#B45309"><strong>Check before approving</strong>'
                  + "".join(f'<div class="meta">{_esc(w)}</div>' for w in v["warnings"]) + "</div>") + emails
    if v.get("personal_lines"):
        rows = "".join(f'<div class="meta" style="margin-top:6px"><strong>{_esc(p["company"] or p["email"])}</strong>: {_esc(p["line"])}'
                       + (f' <span class="cap">(from: {_esc("; ".join(f["text"] for f in p["based_on"]))})</span>' if p["based_on"] else "") + "</div>"
                       for p in v["personal_lines"][:20])
        more = f'<div class="meta">…and {len(v["personal_lines"]) - 20} more</div>' if len(v["personal_lines"]) > 20 else ""
        emails += f'<div class="card"><div class="head">Opening lines</div><div class="meta">Each is built only from the facts shown.</div>{rows}{more}</div>'
    if not emails:
        emails = '<div class="card">No emails yet.</div>'
    actions = ""
    if editable:
        emails = f'<form method="post"><input type="hidden" name="action" value="save">{emails}<div class="row"><button type="submit">Save changes</button></div></form>'
    if st == "needs_approval":
        actions += ('<form method="post"><input type="hidden" name="action" value="approve"><div class="row"><button class="ok" type="submit">Approve and start sending</button></div></form>'
                    '<details><summary>Reject…</summary><form method="post" style="margin-top:8px"><input type="hidden" name="action" value="reject">'
                    '<textarea name="note" rows="2" placeholder="What should change? (optional)"></textarea><div class="row"><button class="no" type="submit">Reject</button></div></form></details>')
    if editable:
        actions += ('<div class="card" style="margin-top:14px"><div class="head">Ask the AI to rewrite them</div><form method="post">'
                    '<input type="hidden" name="action" value="rewrite"><input name="instruction" placeholder="e.g. shorter and less formal" ' + _BOX + '>'
                    '<div class="row"><button type="submit">Rewrite</button></div></form></div>')
    if st == "sending":
        actions += '<form method="post"><input type="hidden" name="action" value="pause"><div class="row"><button type="submit">Pause sending</button></div></form>'
    if st == "paused":
        actions += '<form method="post"><input type="hidden" name="action" value="resume"><div class="row"><button class="ok" type="submit">Resume sending</button></div></form>'
    refresh = '<meta http-equiv="refresh" content="6">' if st == "drafting" else ""
    body = (f"<h1>Email campaign</h1><div class='sub'>{_esc(company)} · this link works for 10 days and needs no sign-in</div>"
            f"{test}{banner}{summary}{emails}{actions}")
    return _page("Email campaign", body).replace("</head>", refresh + "</head>", 1)


async def act(db, org: str, campaign_id: str, form: Dict[str, str]) -> str:
    from fastapi import HTTPException

    action = form.get("action", "")
    ctx = {"org_id": org, "key_id": "preview", "name": "preview link"}
    by = "preview link"
    try:
        if campaign_id.startswith(E.SANDBOX):
            o = await db.get(E.PublicObject, campaign_id)
            if o and action in ("approve", "reject"):
                await E._sandbox_decide(db, o, org, action, by, form.get("note", ""))
                return "Approved. Nothing real is sent in test mode." if action == "approve" else "Rejected."
            return ""
        camp = await E._campaign(db, campaign_id)
        if action in ("approve", "reject"):
            await E.decide(db, camp, action, by, form.get("note", ""))
            return "Approved. Sending starts within the allowed hours." if action == "approve" else "Rejected."
        if action == "save":
            steps, n = [], 1
            while f"body_{n}" in form:
                steps.append(E.StepIn(subject=form.get(f"subject_{n}", ""), body=form[f"body_{n}"], delay_days=int(form.get(f"delay_{n}") or 0)))
                n += 1
            await E.edit_campaign(db, ctx, camp, E.EditIn(steps=steps))
            return "Saved. It needs approving again."
        if action == "rewrite":
            instruction = (form.get("instruction") or "").strip()
            if len(instruction) < 3:
                return "Say what should change."
            await E.edit_campaign(db, ctx, camp, E.EditIn(regenerate=E.RegenerateIn(instruction=instruction)))
            return "The AI is on it. This page refreshes when it is done."
        if action in ("pause", "resume"):
            await E.edit_campaign(db, ctx, camp, E.EditIn(action=action))
            return "Paused." if action == "pause" else "Resumed."
    except ApiError as err:
        await db.rollback()
        return err.message
    except HTTPException as err:
        await db.rollback()
        return str(err.detail)
    except ValueError:
        await db.rollback()
        return "Those changes are not valid."
    return ""
