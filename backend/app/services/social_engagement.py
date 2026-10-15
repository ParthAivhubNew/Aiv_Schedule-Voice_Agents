"""Who engaged with the organisation's posts, and turning them into leads.

Reads public comments and replies from the networks that let a connected account read them, keeps one row
per person per post, and adds the ones the user picks to a Lead Gen list. Only people who engaged publicly
are added, always tagged with where they came from.
"""
from __future__ import annotations

import hashlib
import logging
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote

import httpx
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.models.models import LeadAccount, SocialAccount, SocialEngager, SocialPost
from app.services import connections as C
from app.services.social_publisher import account_access_token, normalize_platform

logger = logging.getLogger("social_engagement")

GRAPH = "https://graph.facebook.com/v19.0"
THREADS = "https://graph.threads.net/v1.0"
LIST_NAME = "Social audience"
READABLE = ("facebook", "instagram", "threads", "linkedin")


def _when(raw: Any) -> Optional[datetime]:
    try:
        return datetime.fromisoformat(str(raw).replace("Z", "+00:00").replace("+0000", "+00:00")).replace(tzinfo=None)
    except Exception:
        return None


def parse_graph_comments(platform: str, data: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Comments from a Facebook, Instagram or Threads response, as {handle,name,text,kind,at,profile_url}."""
    out = []
    for c in data.get("data") or []:
        who = c.get("from") or {}
        handle = c.get("username") or who.get("id") or ""
        name = who.get("name") or c.get("username") or ""
        text = c.get("message") or c.get("text") or ""
        if not handle and not name:
            continue
        url = ""
        if platform == "instagram" and c.get("username"):
            url = f"https://www.instagram.com/{c['username']}/"
        elif platform == "threads" and c.get("username"):
            url = f"https://www.threads.net/@{c['username']}"
        elif platform == "facebook" and who.get("id"):
            url = f"https://www.facebook.com/{who['id']}"
        out.append({"handle": str(handle), "name": str(name), "text": str(text)[:1000], "kind": "reply" if platform == "threads" else "comment",
                    "at": _when(c.get("created_time") or c.get("timestamp")), "profile_url": url})
    return out


def parse_linkedin_comments(data: Dict[str, Any]) -> List[Dict[str, Any]]:
    out = []
    for c in data.get("elements") or []:
        actor = c.get("actor") or ""
        if not actor:
            continue
        msg = ((c.get("message") or {}).get("text")) or ""
        created = (c.get("created") or {}).get("time")
        at = datetime.utcfromtimestamp(created / 1000) if isinstance(created, (int, float)) else None
        out.append({"handle": actor, "name": "", "text": str(msg)[:1000], "kind": "comment", "at": at, "profile_url": ""})
    return out


async def fetch_engagers(account: SocialAccount, platform: str, remote_id: str) -> Tuple[List[Dict[str, Any]], str]:
    """(people, error). An error is plain text for the user; people may be empty without one."""
    token = account_access_token(account)
    if not token or not remote_id:
        return [], "This channel is not connected."
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            if platform in ("facebook", "instagram"):
                fields = "from{name,id},message,created_time" if platform == "facebook" else "username,text,timestamp"
                res = await client.get(f"{GRAPH}/{remote_id}/comments", params={"fields": fields, "limit": 100, "access_token": token})
                if res.status_code != 200:
                    return [], f"{platform.title()} would not share the comments ({res.status_code}). Reconnect the channel with comment access."
                return parse_graph_comments(platform, res.json()), ""
            if platform == "threads":
                res = await client.get(f"{THREADS}/{remote_id}/replies", params={"fields": "username,text,timestamp", "access_token": token})
                if res.status_code != 200:
                    return [], f"Threads would not share the replies ({res.status_code})."
                return parse_graph_comments("threads", res.json()), ""
            if platform == "linkedin":
                res = await client.get(f"https://api.linkedin.com/rest/socialActions/{quote(remote_id, safe='')}/comments",
                                       headers={"Authorization": f"Bearer {token}", "Linkedin-Version": "202401", "X-Restli-Protocol-Version": "2.0.0"})
                if res.status_code != 200:
                    return [], f"LinkedIn would not share the comments ({res.status_code}). This needs comment access on the connected app."
                return parse_linkedin_comments(res.json()), ""
    except httpx.HTTPError as err:
        return [], f"Could not reach {platform.title()}: {err}"
    return [], f"{platform.title()} does not let connected accounts read who engaged, so add them by hand or by file."


def _key(post_id: str, network: str, handle: str, kind: str, text: str) -> str:
    return "se_" + hashlib.sha1(f"{post_id}|{network}|{handle.lower()}|{kind}|{text[:80]}".encode()).hexdigest()[:20]


async def save_engagers(db: AsyncSession, post_id: str, network: str, people: List[Dict[str, Any]]) -> int:
    """Keep each person once per post. Returns how many were new."""
    new = 0
    for p in people:
        handle = (p.get("handle") or p.get("name") or "").strip()
        if not handle:
            continue
        sid = _key(post_id, network, handle, p.get("kind", "comment"), p.get("text", ""))
        if await db.get(SocialEngager, sid):
            continue
        db.add(SocialEngager(id=sid, post_id=post_id, network=network, handle=handle[:200], name=(p.get("name") or "")[:200],
                             company=(p.get("company") or "")[:200], profile_url=(p.get("profile_url") or "")[:400],
                             kind=p.get("kind", "comment"), text=(p.get("text") or "")[:1000], at=p.get("at") or datetime.utcnow()))
        new += 1
    await db.flush()
    return new


async def refresh_post(db: AsyncSession, post: SocialPost) -> Dict[str, Any]:
    """Read engagement for every channel the post went to. Returns {new, errors}."""
    accounts = (await db.execute(select(SocialAccount).where(SocialAccount.status == "connected"))).scalars().all()
    new, errors = 0, []
    for r in post.publish_results or []:
        platform = normalize_platform(r.get("platform") or r.get("channel"))
        if not r.get("ok") or not r.get("id") or platform not in READABLE:
            continue
        acc = next((a for a in accounts if normalize_platform(a.platform) == platform), None)
        if not acc:
            continue
        people, err = await fetch_engagers(acc, platform, str(r["id"]))
        if err:
            errors.append(err)
        new += await save_engagers(db, post.id, platform, people)
    await link_warm(db, post.id)
    return {"new": new, "errors": errors}


def view(e: SocialEngager) -> Dict[str, Any]:
    return {"id": e.id, "post_id": e.post_id, "network": e.network, "handle": e.handle, "name": e.name, "company": e.company,
            "profile_url": e.profile_url, "kind": e.kind, "text": e.text, "lead_id": e.lead_id or "",
            "at": e.at.isoformat() + "Z" if e.at else None}


async def link_warm(db: AsyncSession, post_id: str) -> int:
    """Engagers who are already leads: the lead gets a "post" touch on its timeline, which ranks it as warm."""
    n = 0
    leads = (await db.execute(select(LeadAccount))).scalars().all()
    by_name = {}
    for a in leads:
        for key in ((a.contact_name or "").strip().lower(), (a.name or "").strip().lower()):
            if key:
                by_name.setdefault(key, a)
    for e in (await db.execute(select(SocialEngager).where(SocialEngager.post_id == post_id, SocialEngager.lead_id.is_(None)))).scalars().all():
        hit = by_name.get((e.name or "").strip().lower()) or by_name.get((e.company or "").strip().lower())
        if hit:
            e.lead_id = hit.id
            await C.record_event(db, "post", lead_id=hit.id, registry_id=hit.registry_id or "", ref_id=e.id,
                                 summary=f"{e.kind.title()}ed on your post" if e.kind != "reply" else "Replied to your post",
                                 detail={"post_id": post_id, "network": e.network, "text": e.text[:200]})
            n += 1
    return n


async def add_to_list(db: AsyncSession, engager_ids: List[str], list_name: str = LIST_NAME) -> Dict[str, Any]:
    """Make leads of the chosen engagers (source "Social", linked to the post) and put them in a list."""
    from app.api.lead_lists import put_in_list

    rows = (await db.execute(select(SocialEngager).where(SocialEngager.id.in_(engager_ids)))).scalars().all()
    created, ids = 0, []
    for e in rows:
        if e.lead_id:
            ids.append(e.lead_id)
            continue
        label = (e.company or e.name or e.handle).strip()
        lead = LeadAccount(id=f"la_{uuid.uuid4().hex[:12]}", name=label[:120], contact_name=(e.name or "")[:120], source="social",
                           source_url=e.profile_url or "", notes=(f"{e.kind.title()} on a {e.network.title()} post: " + e.text)[:2000],
                           source_post_id=e.post_id, stage="new")
        db.add(lead)
        await db.flush()
        e.lead_id = lead.id
        await C.record_event(db, "post", lead_id=lead.id, ref_id=e.id, summary=f"{e.kind.title()} on your {e.network.title()} post",
                             detail={"post_id": e.post_id, "text": e.text[:200]})
        ids.append(lead.id)
        created += 1
    await db.flush()
    placed = await put_in_list(db, "", list_name, ids) if ids else {"id": "", "name": list_name, "count": 0}
    return {"added": created, "linked": len(ids) - created, "list": placed}
