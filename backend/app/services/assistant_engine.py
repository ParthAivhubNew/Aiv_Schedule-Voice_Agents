"""The turn loop every plugin assistant shares: the model chooses tools, the tools read the person's own data, and the answer is worded from
what they returned. It reports each step as an event (status, tool, step, final, error) so the chat can show the work as it happens.

A plugin supplies a Spec: its system prompt, its tool definitions and a handler for each. Handlers only read, or prepare a proposal the
person confirms on screen; nothing here spends credits or changes data on its own.
"""
from __future__ import annotations

import json
import logging
import re
import time
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Awaitable, Callable, Dict, List, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.services import llm_gateway

logger = logging.getLogger("assistant_engine")

MAX_ROUNDS = 4


_LEAK = re.compile(r"<[|｜]*\s*(?:DSML|function_calls|invoke|tool_call)", re.I)


def clean_reply(text: str) -> str:
    """Some models write a tool call as text instead of making it. Whatever follows where it starts is dropped, so the person never sees it."""
    text = text or ""
    m = _LEAK.search(text)
    return (text[:m.start()] if m else text).strip()


def proposal_reply(proposals: List[Dict[str, Any]]) -> str:
    """What to say when the model's own answer was empty: plain words about the cards on screen."""
    for p in proposals:
        if p["kind"] == "plan_run":
            return f"The plan “{p['title']}” is on screen. Press Run when you are ready, or tell me what to change."
        if p["kind"] == "switch":
            return f"{p['title']}. Press the button and I will ask it for you."
    return ""


def tool(name: str, description: str, props: Optional[Dict[str, Any]] = None, required: Optional[List[str]] = None) -> Dict[str, Any]:
    return {"type": "function", "function": {"name": name, "description": description,
                                             "parameters": {"type": "object", "properties": props or {}, "required": required or []}}}


class Turn:
    """What one message has done so far, shared by the tool handlers and then turned into the reply."""

    def __init__(self, db: AsyncSession, message: str, actor: Optional[Dict[str, Any]] = None):
        self.db = db
        self.message = message
        self.actor = actor or {}  # {operator_id, perms}
        self.steps: List[Dict[str, Any]] = []
        self.proposals: List[Dict[str, Any]] = []
        self.notes: List[str] = []

    def step(self, label: str, detail: str, t0: float) -> None:
        self.steps.append({"label": label, "detail": detail, "ms": int((time.time() - t0) * 1000)})

    def propose(self, kind: str, title: str, detail: str, params: Dict[str, Any]) -> None:
        self.proposals.append({"id": f"p{len(self.proposals)}", "kind": kind, "title": title, "detail": detail, "params": params})


Handler = Callable[[Turn, Dict[str, Any]], Awaitable[None]]


@dataclass
class Spec:
    plugin: str
    scope: str  # the LLM key group for this plugin (see llm_gateway.resolve_llm_credentials)
    system: str
    tools: List[Dict[str, Any]]
    handlers: Dict[str, Handler]
    doing: Dict[str, str] = field(default_factory=dict)  # tool name -> "Reading your calls", shown while it runs
    suggest: Callable[[Turn], List[str]] = lambda t: []
    fallback: str = "I'm not sure what to do with that. Tell me what you want to look at."


def _prompt(spec: Spec, context: str, notes: List[str]) -> str:
    if not notes:
        return spec.system + "\n\n" + context
    return (spec.system + "\n\n" + context + "\n\nWhat your tools have returned so far this turn (this is all you know; do not add facts). "
            "Call another tool only if the request still needs one; otherwise answer now in two to four short sentences, saying what you found or prepared and what they can do next:\n- "
            + "\n- ".join(notes))


async def events(spec: Spec, db: AsyncSession, message: str, history: List[Dict[str, Any]], context: str,
                 count_message: Callable[[], Awaitable[None]], actor: Optional[Dict[str, Any]] = None) -> AsyncIterator[Dict[str, Any]]:
    started = time.time()
    msgs = [{"role": "assistant" if m.get("role") in ("assistant", "ai", "bot") else "user", "content": str(m.get("content") or "")[:1500]}
            for m in history[-8:] if str(m.get("content") or "").strip()]
    messages = [*msgs, {"role": "user", "content": message}]
    turn = Turn(db, message, actor)
    ran: set = set()
    reply = ""
    answered = False
    for rnd in range(MAX_ROUNDS):
        yield {"type": "status", "text": "Thinking" if rnd == 0 else "Reading what came back"}
        plan = await llm_gateway.call_open_chat_llm_with_tools(
            messages=messages, tools=spec.tools, system_prompt=_prompt(spec, context, turn.notes), temperature=0.2, max_tokens=500, db=db, scope=spec.scope)
        if not plan.get("success"):
            logger.warning("%s assistant plan failed: %s", spec.plugin, plan.get("error"))
            if rnd == 0:
                yield {"type": "error", "status": 502, "message": "The AI service did not answer. Try again in a moment."}
                return
            break
        if rnd == 0:
            await count_message()
        fresh = []
        for call in plan.get("tool_calls") or []:
            fn = call.get("function") or {}
            try:
                args = json.loads(fn.get("arguments") or "{}")
            except ValueError:
                args = {}
            args = args if isinstance(args, dict) else {}
            sig = (fn.get("name"), json.dumps(args, sort_keys=True, default=str))
            if sig not in ran:
                ran.add(sig)
                fresh.append((fn.get("name") or "", args))
        if not fresh:
            reply = clean_reply(plan.get("reply") or "")
            answered = bool(reply)
            break
        for name, args in fresh[:MAX_ROUNDS]:
            yield {"type": "tool", "name": name, "text": spec.doing.get(name, "Working")}
            seen = len(turn.steps)
            handler = spec.handlers.get(name)
            try:
                if handler is None:
                    turn.notes.append(f"There is no tool called '{name}'. Do not call it again.")
                else:
                    await handler(turn, args)
            except Exception as err:  # one tool failing must not lose the rest of the turn
                logger.warning("%s assistant tool %s failed: %s", spec.plugin, name, err)
                turn.notes.append(f"The {name} tool failed ({type(err).__name__}), so there is nothing from it. Say so plainly and offer to try again.")
                turn.steps.append({"label": f"Could not finish: {name.replace('_', ' ')}", "detail": "Something went wrong. Try again.", "ms": 0, "failed": True})
            for s in turn.steps[seen:]:
                yield {"type": "step", "step": s}

    if turn.notes and not answered:
        yield {"type": "status", "text": "Writing the answer"}
        final = await llm_gateway.call_open_chat_llm(
            messages=messages, system_prompt=_prompt(spec, context, turn.notes) + "\n\nAnswer now, without calling anything else.",
            temperature=0.3, max_tokens=400, db=db, scope=spec.scope)
        reply = clean_reply(final.get("reply") or "") if final.get("success") else ""
        if not reply:
            reply = proposal_reply(turn.proposals) or " ".join(n for n in turn.notes if not n.startswith("A proposal")) or "Done. Check what is on screen."
    if not reply:
        reply = spec.fallback
    yield {"type": "final", "result": {"reply": reply, "steps": turn.steps, "proposals": turn.proposals, "found": None,
                                       "took_ms": int((time.time() - started) * 1000), "suggestions": spec.suggest(turn), "state": {}}}
