"""Journeys in the AI chat: everything the screen can do, by asking. The tools call app.services.journeys, the same functions the screen uses.

A draft is free and changes nothing outside itself, so the chat writes and edits drafts at once. Anything that starts sending or calling, adds
people, or changes a journey that is already running is only offered: it appears on screen with the facts, and runs when the person presses the
button. The chat never starts a journey by itself.
"""
from __future__ import annotations

import logging
import time
from typing import Any, Dict, List, Optional

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.core.tenancy import current_org
from app.models.models import EmailCampaign
from app.services import journeys as J
from app.services.assistant_engine import tool

logger = logging.getLogger("journey_assistant")

NAMES = ("journeys",)
TOPICS = ["journeys", "tasks"]
# Names a saved plan may use for one action of the journeys tool, so a plan can draft or report on its own and stop at the steps that need the person.
ALIASES = {"journey_draft": "draft", "journey_report": "report", "journey_people": "add_people", "journey_run": "start"}
ACTIONS = ["draft", "edit", "report", "add_people", "start", "pause", "stop", "tasks_done", "tasks_skip"]

_CHANGE = {"type": "object", "properties": {
    "op": {"type": "string", "enum": ["add_step", "remove_step", "set_step", "set_wait", "set_setting"]},
    "step": {"type": "integer", "description": "the step number, counting from 1"},
    "after": {"type": "integer", "description": "add_step: put the new step after this step number (0 = first; leave out = last)"},
    "channel": {"type": "string", "enum": list(J.STEP_CHANNELS)},
    "subject": {"type": "string"}, "body": {"type": "string"}, "title": {"type": "string"}, "notes": {"type": "string"},
    "goal": {"type": "string", "description": "a call step's goal"},
    "condition": {"type": "string", "enum": list(J.CALL_CONDITIONS)}, "voicemail": {"type": "string", "enum": list(J.VOICEMAIL)},
    "retries": {"type": "integer"}, "wait_days": {"type": "integer"}, "wait_hours": {"type": "integer"},
    "setting": {"type": "string", "enum": list(J.SETTING_NAMES)}, "value": {"description": "the new value for set_setting"}},
    "required": ["op"]}


def tools() -> List[Dict[str, Any]]:
    return [tool(
        "journeys", "USE for anything about the person's journeys (outreach paths of emails, calls and tasks). action draft: write a new DRAFT from their business profile and a goal "
                    "(free, nothing is sent). edit: change a journey's steps or settings (a draft is changed at once; one that is running is only offered). report: how a journey is "
                    "doing, with plain advice. add_people: offer adding one of their lists. start, pause, stop: only offered, they confirm on screen, you can never start one. "
                    "tasks_done, tasks_skip: offer marking their open journey tasks. DO NOT use for a plain email campaign question (use my_data).",
        {"action": {"type": "string", "enum": ACTIONS}, "journey": {"type": "string", "description": "the journey's name (not for draft)"},
         "goal": {"type": "string", "description": "draft: what the journey is for, in one sentence"}, "audience": {"type": "string", "description": "draft: who it goes to"},
         "emails": {"type": "integer", "description": "draft: how many emails, 2 to 5"},
         "channels": {"type": "array", "items": {"type": "string", "enum": ["call", "task"]}, "description": "draft: extra steps besides emails"},
         "name": {"type": "string", "description": "draft: a name for it"}, "changes": {"type": "array", "items": _CHANGE, "description": "edit: the changes"},
         "list_name": {"type": "string", "description": "add_people: which list"}, "how_many": {"type": "integer", "description": "add_people: 1 to 500"},
         "kind": {"type": "string", "enum": list(J.TASK_KINDS), "description": "tasks_done/tasks_skip: only this kind of task"}}, ["action"])]


SYSTEM = (" A Journey is a path a person follows through emails, calls and tasks, with a wait between steps; it ends for a person when they reply, book, opt out or say they are "
          "not interested. Use the journeys tool: action draft to build one (a draft; nothing is sent), edit to change one, report to see how it is doing. "
          "Adding people, starting, pausing and stopping are only offered: say the person confirms on screen, and never say you started it. "
          "Never invent results: quote the numbers a tool gave you.")


async def _context(db: AsyncSession) -> Dict[str, Any]:
    return {"org_id": current_org(), "name": ""}


async def context_line(db: AsyncSession) -> str:
    """The person's journeys, by name, so they can be referred to the way a person would."""
    camps = (await db.execute(select(EmailCampaign).order_by(EmailCampaign.created_at.desc()).limit(12))).scalars().all()
    return "The person's journeys: " + (", ".join(f"{c.name} ({c.status})" for c in camps) if camps else "none yet")


async def _find(db: AsyncSession, name: str) -> Optional[EmailCampaign]:
    name = (name or "").strip().lower()
    camps = (await db.execute(select(EmailCampaign).order_by(EmailCampaign.created_at.desc()))).scalars().all()
    if not camps:
        return None
    exact = [c for c in camps if c.name.lower() == name or c.id == name]
    close = [c for c in camps if name and name in c.name.lower()]
    return (exact or close or (camps if len(camps) == 1 else [None]))[0]


def _propose(t: Any, kind: str, title: str, detail: str, params: Dict[str, Any]) -> None:
    t.proposals.append({"id": f"p{len(t.proposals)}", "kind": kind, "title": title, "detail": detail, "params": params})


async def _not_found(db: AsyncSession, t: Any, name: str) -> None:
    camps = (await db.execute(select(EmailCampaign).order_by(EmailCampaign.created_at.desc()).limit(12))).scalars().all()
    t.notes.append(f"No journey is called '{name}'. The person's journeys are: {', '.join(c.name for c in camps) or 'none yet'}. Ask which one they mean.")


async def run(db: AsyncSession, t: Any, name: str, args: Dict[str, Any]) -> None:
    """Runs one journeys action for a chat turn (t collects the steps, notes and proposals)."""
    t0 = time.time()
    ms = lambda: int((time.time() - t0) * 1000)  # noqa: E731
    action = ALIASES.get(name) or str(args.get("action") or "")
    try:
        if action == "draft":
            await _draft(db, t, args, ms)
        elif action == "edit":
            await _edit(db, t, args, ms)
        elif action == "add_people":
            await _add_people(db, t, args, ms)
        elif action in ("start", "pause", "stop"):
            await _control(db, t, {**args, "action": action}, ms)
        elif action in ("tasks_done", "tasks_skip"):
            await _tasks(db, t, {**args, "action": "skip" if action == "tasks_skip" else "done"}, ms)
        elif action == "report":
            await _report(db, t, args, ms)
        else:
            t.notes.append(f"The journeys tool needs an action: {', '.join(ACTIONS)}.")
    except J.JourneyError as err:
        t.notes.append(f"That did not work: {err} Tell the person in plain words and ask what to change.")
    except HTTPException as err:
        t.notes.append(f"That did not work: {err.detail} Tell the person.")
    except Exception as err:
        logger.warning("journeys action %s failed: %s", action, err)
        t.notes.append("The writer is not available just now, so nothing was changed. Say so and suggest a ready-made journey from the Journeys page.")


async def _draft(db: AsyncSession, t: Any, args: Dict[str, Any], ms) -> None:
    channels = [c for c in (args.get("channels") or []) if c in ("call", "task")]
    camp = await J.ai_draft(db, {**await _context(db), **(t.actor or {})}, goal=str(args.get("goal") or ""), audience=str(args.get("audience") or ""),
                            channels=channels, count=int(args.get("emails") or 3), name=str(args.get("name") or ""), owner_id=(t.actor or {}).get("operator_id", ""))
    await db.commit()
    steps = [J.step_out(s) for s in await J.steps_of(db, camp.id)]
    _propose(t, "journey_open", f"Review “{camp.name}”", f"A draft with {len(steps)} steps. Nothing is sent until you add people and press Start.", {"journey_id": camp.id})
    t.steps.append({"label": "Wrote a draft journey", "detail": f"{camp.name}: {len(steps)} steps", "ms": ms()})
    t.notes.append(f"A draft journey called '{camp.name}' was saved and is on screen to review: {J.describe_steps(steps)}. Nothing is sent. "
                   "Tell the person what it does in two or three plain sentences, and that they add people and press Start when ready.")


async def _edit(db: AsyncSession, t: Any, args: Dict[str, Any], ms) -> None:
    camp = await _find(db, str(args.get("journey") or ""))
    if not camp:
        return await _not_found(db, t, str(args.get("journey") or ""))
    changes = [c for c in (args.get("changes") or []) if isinstance(c, dict)]
    if not changes:
        t.notes.append("No changes were given. Ask the person what to change.")
        return
    current = [J.step_out(s) for s in await J.steps_of(db, camp.id)]
    J.clean_steps(J.changed_steps(current, changes)[0])  # checked first, so nothing half-applies
    if camp.status == "draft":
        out = await J.apply_changes(db, camp, changes)
        await db.commit()
        steps = [J.step_out(s) for s in await J.steps_of(db, camp.id)]
        _propose(t, "journey_open", f"Review “{camp.name}”", f"Changed. It now has {len(steps)} steps.", {"journey_id": camp.id})
        t.steps.append({"label": "Changed the draft", "detail": f"{camp.name}: {len(changes)} change(s)", "ms": ms()})
        t.notes.append(f"The draft '{camp.name}' was changed ({len(changes)} change(s)). It now reads: {J.describe_steps(steps)}. Say what changed in one sentence.")
        return
    _propose(t, "journey_edit", f"Change “{camp.name}”", f"{len(changes)} change(s) to a journey that is {camp.status}. People part-way through keep their place.",
             {"journey_id": camp.id, "changes": changes})
    t.steps.append({"label": "Prepared a change for you to confirm", "detail": camp.name, "ms": ms()})
    t.notes.append(f"'{camp.name}' is {camp.status}, so the change is on screen waiting for the person to confirm. Say that people part-way through keep their place.")


async def _add_people(db: AsyncSession, t: Any, args: Dict[str, Any], ms) -> None:
    from app.api import lead_lists as LL

    camp = await _find(db, str(args.get("journey") or ""))
    if not camp:
        return await _not_found(db, t, str(args.get("journey") or ""))
    want = str(args.get("list_name") or "").strip().lower()
    lists = await LL._load(db)
    hit = next((x for x in lists if x["name"].lower() == want), None) or next((x for x in lists if want and want in x["name"].lower()), None)
    if not hit:
        t.notes.append(f"No list is called '{args.get('list_name', '')}'. The lists are: {', '.join(x['name'] for x in lists) or 'none'}.")
        return
    how_many = min(max(int(args.get("how_many") or 200), 1), 500)
    count = await J.enrol(db, camp, await J.people_from_list(db, hit["id"], how_many), current_org(), dry_run=True)
    skipped = ", ".join(f"{n} {k.replace('_', ' ')}" for k, n in count["skipped"].items() if n)
    _propose(t, "journey_people", f"Add {count['added']} people from “{hit['name']}” to “{camp.name}”",
             f"{count['added']} would be added" + (f"; skipped: {skipped}" if skipped else "") + ". Nothing is sent until the journey is running.",
             {"journey_id": camp.id, "list_id": hit["id"], "how_many": how_many})
    t.steps.append({"label": "Counted who would be added", "detail": f"{count['added']} from {hit['name']}", "ms": ms()})
    t.notes.append(f"{count['added']} people from '{hit['name']}' can be added to '{camp.name}'" + (f"; skipped: {skipped}" if skipped else "") + ". The offer is on screen for the person to confirm.")


async def _control(db: AsyncSession, t: Any, args: Dict[str, Any], ms) -> None:
    camp = await _find(db, str(args.get("journey") or ""))
    if not camp:
        return await _not_found(db, t, str(args.get("journey") or ""))
    action = str(args.get("action") or "")
    if action not in ("start", "pause", "stop"):
        t.notes.append("Ask whether they want to start, pause or stop it.")
        return
    if action == "start":
        reds = [o["text"] for o in await J.preflight(db, camp, current_org()) if o["level"] == "red"]
        if reds:
            t.notes.append(f"'{camp.name}' can't start yet: {' '.join(reds[:3])} Tell the person what to fix. Nothing was offered.")
            return
        title, detail = f"Start “{camp.name}”", "It is checked and ready. The first step goes out in the next sending window."
    elif action == "pause":
        title, detail = f"Pause “{camp.name}”", "Nothing more goes out until you start it again. People keep their place."
    else:
        title, detail = f"Stop “{camp.name}”", "This ends it for everyone still in it. It can't be started again."
    _propose(t, "journey_control", title, detail, {"journey_id": camp.id, "action": action})
    t.steps.append({"label": f"Prepared to {action} a journey", "detail": camp.name, "ms": ms()})
    t.notes.append(f"A button to {action} '{camp.name}' is on screen. The person presses it; you cannot do it. Say so in one sentence.")


async def _tasks(db: AsyncSession, t: Any, args: Dict[str, Any], ms) -> None:
    action = "skip" if args.get("action") == "skip" else "done"
    camp = await _find(db, str(args.get("journey"))) if args.get("journey") else None
    rows = await J.list_tasks(db, campaign_id=camp.id if camp else "", limit=100)
    if args.get("kind"):
        rows = [r for r in rows if r["kind"] == args["kind"]]
    if not rows:
        t.notes.append("There are no open tasks that match.")
        return
    shown = "; ".join(f"{r['title']} ({r['contact'] or r['company']})" for r in rows[:6]) + (f" and {len(rows) - 6} more" if len(rows) > 6 else "")
    _propose(t, "journey_tasks", f"Mark {len(rows)} task{'s' if len(rows) != 1 else ''} as {'done' if action == 'done' else 'skipped'}", shown,
             {"action": action, "task_ids": [r["id"] for r in rows]})
    t.steps.append({"label": "Found open tasks", "detail": f"{len(rows)}", "ms": ms()})
    t.notes.append(f"{len(rows)} open task(s) match: {shown}. The offer is on screen for the person to confirm.")


async def _report(db: AsyncSession, t: Any, args: Dict[str, Any], ms) -> None:
    camp = await _find(db, str(args.get("journey") or ""))
    if not camp:
        return await _not_found(db, t, str(args.get("journey") or ""))
    res = await J.results(db, camp)
    steps = [J.step_out(s) for s in await J.steps_of(db, camp.id)]
    advice = J.suggestions_from(res, steps)
    variants = ("; A/B: " + ", ".join(f"version {k.upper()} {v['sent']} sent, {v['reply_rate']}% replied" for k, v in res["variants"].items())) if res["variants"] else ""
    t.steps.append({"label": "Read a journey's results", "detail": camp.name, "ms": ms()})
    t.notes.append(f"'{camp.name}' is {camp.status}. {res['people']} people: {res['in_progress']} in progress ({res['waiting_on_a_task']} waiting on a task), "
                   f"{res['by_status']['replied']} replied, {res['by_status']['booked']} booked, {res['by_status']['unresponsive']} unresponsive, {res['by_status']['bounced']} bounced. "
                   f"{res['sent']} emails sent, {res['opened']} opened, reply rate {res['reply_rate']}%, bounce rate {res['bounce_rate']}%{variants}. Steps: {J.describe_steps(steps)}. "
                   f"Advice from the numbers: {' '.join(advice)}")


async def my_data(db: AsyncSession, t: Any, topic: str) -> bool:
    """The journeys and tasks topics of my_data. True when the topic was one of these."""
    t0 = time.time()
    if topic == "journeys":
        rows = await J.list_journeys(db, current_org())
        t.notes.append("Journeys: " + "; ".join(
            f"{r['name']} is {r['status']}, {r['results']['people']} people ({r['results']['in_progress']} in progress), {r['results']['sent']} emails sent, "
            f"{r['results']['replied']} replied, {r['tasks_open']} open tasks" for r in rows[:10]) if rows else "The person has no journeys yet.")
        t.steps.append({"label": "Read your journeys", "detail": f"{len(rows)} found", "ms": int((time.time() - t0) * 1000)})
        return True
    if topic == "tasks":
        rows = await J.list_tasks(db, limit=15)
        t.notes.append("Open journey tasks: " + "; ".join(f"{r['title']} ({r['contact'] or r['company']}, {r['journey']})" for r in rows) if rows else "There are no open journey tasks.")
        t.steps.append({"label": "Read your tasks", "detail": f"{len(rows)} open", "ms": int((time.time() - t0) * 1000)})
        return True
    return False
