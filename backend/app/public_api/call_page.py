"""The live call page: a link for people who are not technical. Watch a call, tell the AI what to do,
take the call over (we ring your phone) and hand it back. It acts on the same call as the app and the API."""
from __future__ import annotations

import html
from typing import Any, Dict

from app.public_api import voice as V
from app.public_api.core import ApiError
from app.services.approval_mail import _page

_STATUS = {
    "ringing": ("Ringing…", ""), "in_progress": ("On the call", ""), "completed": ("Finished", "good"),
    "failed": ("Could not connect", "bad"), "canceled": ("Ended early", "bad"), "no_answer": ("No answer", "bad"),
}
_OUTCOME = {
    "meeting_booked": "A meeting was booked", "interested": "Interested", "callback_requested": "Asked for a call back",
    "not_interested": "Not interested", "wrong_number": "Wrong number", "voicemail": "Voicemail", "do_not_call": "Asked not to be called again",
    "human_requested": "Asked for a person", "no_answer": "No answer", "contacted": "Spoke with them", "failed": "Failed",
}


def _esc(v: Any) -> str:
    return html.escape(str(v if v is not None else ""))


def render(v: Dict[str, Any], company: str, notice: str = "") -> str:
    label, tone = _STATUS.get(v["status"], (v["status"], ""))
    live = v["status"] in ("ringing", "in_progress")
    caps = v.get("capabilities") or {}
    who = v.get("to_name") or v.get("to") or "the person"
    banner = f'<div class="card" style="border-color:#0F766E"><strong>{_esc(notice)}</strong></div>' if notice else ""
    test = '<div class="card" style="border-color:#B45309"><strong>Test call.</strong> Nothing real is dialled or charged.</div>' if v.get("test") else ""
    lines = "".join(
        f'<div style="margin:4px 0"><span class="meta">{"AI" if t["who"] == "ai" else _esc(who) if t["who"] == "them" else _esc(t["who"])}</span> '
        f'{_esc(t["text"])}</div>' for t in v.get("transcript", [])[-60:]) or '<div class="meta">Nothing said yet.</div>'
    result = ""
    if not live:
        result += f'<div class="meta">Result</div><div class="head">{_esc(_OUTCOME.get(v.get("outcome") or "", v.get("outcome") or "No result"))}</div>'
        for k, a in (v.get("answers") or {}).items():
            result += f'<div class="meta" style="margin-top:6px">{_esc(k.replace("_", " ").capitalize())}</div><div>{_esc(a)}</div>'
    status = (f'<div class="card"><div class="meta">Call with</div><div class="head">{_esc(who)}</div>'
              f'<span class="pill {tone}">{_esc(label)}</span>{result}</div>')

    def form(action: str, fields: str, button: str, cls: str = "") -> str:
        return (f'<form method="post" style="margin-top:10px"><input type="hidden" name="action" value="{action}">{fields}'
                f'<div class="row"><button class="{cls}" type="submit">{button}</button></div></form>')

    box = 'style="width:100%;box-sizing:border-box;padding:8px;border:1px solid #E6E3DC;border-radius:10px"'
    controls = ""
    if caps.get("guide"):
        controls += f'<div class="card"><div class="head">Tell the AI what to do</div>' + form(
            "guide", f'<input name="message" placeholder="e.g. Offer them Tuesday at 3pm instead" {box}>', "Send to the AI") + \
            '<div class="meta" style="margin-top:6px">The AI pauses for a moment, then carries on with your instruction.</div></div>'
    if caps.get("take_over"):
        controls += f'<div class="card"><div class="head">Take the call yourself</div>' + form(
            "take_over", f'<input name="phone" placeholder="Your phone number, e.g. +447911123456" {box}>', "Ring me and connect me", "ok") + \
            '<div class="meta" style="margin-top:6px">We ring your phone. When you answer you are talking to them directly and the AI stays quiet.</div></div>'
    if caps.get("hand_back"):
        controls += f'<div class="card"><div class="head">You have the call</div>' + form(
            "hand_back", f'<input name="note" placeholder="Note for the AI, e.g. They want a quote by Friday" {box}>', "Hand back to the AI") + "</div>"
    if caps.get("end"):
        controls += form("end", "", "End the call", "no")
    refresh = '<meta http-equiv="refresh" content="4">' if live else ""
    body = (f"<h1>Call</h1><div class='sub'>{_esc(company)} · this link works for 10 days and needs no sign-in</div>"
            f"{test}{banner}{status}{controls}<div class='card'><div class='head'>What was said</div>{lines}</div>")
    return _page("Call", body).replace("</head>", refresh + "</head>", 1)


async def act(db, org: str, call_id: str, form: Dict[str, str]) -> str:
    action = form.get("action", "")
    try:
        if action == "end":
            await V.do_end(db, org, call_id)
            return "The call was ended."
        if action in ("guide", "take_over", "hand_back"):
            if action == "guide" and not (form.get("message") or "").strip():
                return "Type what the AI should do."
            body = V.ControlIn(action=action, message=form.get("message"), phone=form.get("phone"), note=form.get("note"))
            await V.do_control(db, org, "live-page", call_id, body)
            return {"guide": "Sent. The AI carries on with your instruction.",
                    "take_over": "Ringing your phone now. Answer it to join the call.",
                    "hand_back": "Handed back to the AI."}[action]
    except ApiError as err:
        await db.rollback()
        return err.message
    return ""
