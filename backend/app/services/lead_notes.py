"""Notes on a company, or on one person at a company, shared with everyone in the organisation.

A company can be a saved company (LeadAccount), a company store record (BusinessRecord), or both when the saved one is linked.
A new note is kept against the store record when there is one, else against the saved company, and reads look under both ids,
so the note list is the same from Find Leads, the Lists panel and the full company page. The saved company's old single notes
field is shown as the oldest entry, "Earlier note", until someone clears it."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Optional, Set

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import LeadAccount, LeadNote
from app.services.person_emails import person_key

MAX_LEN = 2000
MAX_BATCH = 200
EARLIER_PREFIX = "earlier:"


class NoteError(ValueError):
    pass


def clean_text(text: Any) -> str:
    """The note as it is kept: trimmed, at most three blank lines in a row, and no longer than MAX_LEN. Empty is refused."""
    t = re.sub(r"[ \t]+\n", "\n", str(text or "").replace("\r\n", "\n").replace("\r", "\n")).strip()
    t = re.sub(r"\n{4,}", "\n\n\n", t)
    if not t:
        raise NoteError("Write a note first.")
    if len(t) > MAX_LEN:
        raise NoteError(f"A note can be up to {MAX_LEN:,} characters.")
    return t


def earlier_text(notes: Any) -> str:
    """The saved company's old notes field, without the line Find Leads used to write on save ("Reg no. 123 · Active · ..."),
    which repeats register facts shown elsewhere and was never written by a person."""
    lines = str(notes or "").replace("\r\n", "\n").split("\n")
    kept = [ln for ln in lines if not re.match(r"^\s*Reg no\.\s", ln)]
    return "\n".join(kept).strip()


def iso(dt: Any) -> Optional[str]:
    return dt.isoformat() + "Z" if dt else None


def view(row: LeadNote, me: str = "", admin: bool = False) -> Dict[str, Any]:
    return {"id": row.id, "kind": row.target_kind or "company", "person_key": row.person_key or "", "text": row.text,
            "author_name": row.author_name or "Someone in your team", "created_at": iso(row.created_at),
            "can_delete": bool(admin or (me and row.author_user_id == me)), "earlier": False}


def earlier_view(lead: LeadAccount) -> Optional[Dict[str, Any]]:
    text = earlier_text(lead.notes)
    if not text:
        return None
    return {"id": f"{EARLIER_PREFIX}{lead.id}", "kind": "company", "person_key": "", "text": text, "author_name": "", "created_at": None,
            "can_delete": True, "earlier": True}


def newest_first(notes: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Dated notes newest first; the undated earlier note always last (it is the oldest)."""
    rows = list(notes)
    dated = sorted([n for n in rows if not n.get("earlier")], key=lambda n: n.get("created_at") or "", reverse=True)
    return dated + [n for n in rows if n.get("earlier")]


def split_person_ref(ref: str) -> tuple:
    """'<company id>|<person name>' -> (company id, person key)."""
    cid, _, name = str(ref or "").partition("|")
    return cid.strip(), person_key(name)


@dataclass
class Company:
    """Every id one company's notes can be kept under."""
    business_ids: Set[str] = field(default_factory=set)
    lead_ids: Set[str] = field(default_factory=set)
    leads: List[LeadAccount] = field(default_factory=list)

    @property
    def key(self) -> Dict[str, Optional[str]]:
        """Where a new note goes: the store record when there is one, else the saved company."""
        if self.business_ids:
            return {"business_record_id": sorted(self.business_ids)[0], "lead_account_id": None}
        if self.lead_ids:
            return {"business_record_id": None, "lead_account_id": sorted(self.lead_ids)[0]}
        return {"business_record_id": None, "lead_account_id": None}

    def clause(self):
        parts = []
        if self.business_ids:
            parts.append(LeadNote.business_record_id.in_(self.business_ids))
        if self.lead_ids:
            parts.append(LeadNote.lead_account_id.in_(self.lead_ids))
        return or_(*parts) if parts else None

    def owns(self, row: LeadNote) -> bool:
        return (row.business_record_id or "") in self.business_ids or (row.lead_account_id or "") in self.lead_ids


async def resolve_many(db: AsyncSession, ids: Iterable[str]) -> Dict[str, Company]:
    """Each id (a saved company's id or a company store id) -> every id that company's notes may sit under. Two queries in all."""
    wanted = [i for i in dict.fromkeys(str(x or "").strip() for x in ids) if i]
    if not wanted:
        return {}
    by_id = {a.id: a for a in (await db.execute(select(LeadAccount).where(LeadAccount.id.in_(wanted)))).scalars().all()}
    biz_ids = set(wanted) - set(by_id) | {a.business_record_id for a in by_id.values() if a.business_record_id}
    linked: Dict[str, List[LeadAccount]] = {}
    if biz_ids:
        for a in (await db.execute(select(LeadAccount).where(LeadAccount.business_record_id.in_(biz_ids)))).scalars().all():
            linked.setdefault(a.business_record_id, []).append(a)
    out: Dict[str, Company] = {}
    for i in wanted:
        c = Company()
        if i in by_id:
            lead = by_id[i]
            c.lead_ids.add(lead.id)
            c.leads.append(lead)
            if lead.business_record_id:
                c.business_ids.add(lead.business_record_id)
                for other in linked.get(lead.business_record_id, []):
                    if other.id not in c.lead_ids:
                        c.lead_ids.add(other.id)
                        c.leads.append(other)
        else:
            c.business_ids.add(i)
            for other in linked.get(i, []):
                c.lead_ids.add(other.id)
                c.leads.append(other)
        out[i] = c
    return out


async def resolve(db: AsyncSession, company_id: str = "", account_id: str = "") -> Company:
    ids = [x for x in (account_id, company_id) if x]
    got = await resolve_many(db, ids)
    c = Company()
    for one in got.values():
        c.business_ids |= one.business_ids
        c.lead_ids |= one.lead_ids
        c.leads += [x for x in one.leads if x.id not in {y.id for y in c.leads}]
    return c


async def notes_for(db: AsyncSession, company: Company, me: str = "", admin: bool = False) -> Dict[str, Any]:
    """{notes: company notes newest first (the earlier note last), people: {person key: [notes]}}."""
    clause = company.clause()
    rows = (await db.execute(select(LeadNote).where(clause).order_by(LeadNote.created_at.desc()))).scalars().all() if clause is not None else []
    notes = [view(r, me, admin) for r in rows if (r.target_kind or "company") == "company"]
    notes += [e for e in (earlier_view(lead) for lead in company.leads) if e]
    people: Dict[str, List[Dict[str, Any]]] = {}
    for r in rows:
        if r.target_kind == "person" and r.person_key:
            people.setdefault(r.person_key, []).append(view(r, me, admin))
    return {"notes": newest_first(notes), "people": {k: newest_first(v) for k, v in people.items()}}


def summary(notes: List[Dict[str, Any]]) -> Dict[str, Any]:
    """What a table needs for one row: how many notes and the newest one."""
    ordered = newest_first(notes)
    top = ordered[0] if ordered else None
    return {"count": len(ordered), "latest": {"text": top["text"][:200], "author_name": top["author_name"], "created_at": top["created_at"], "earlier": top["earlier"]} if top else None}


async def counts(db: AsyncSession, company_ids: List[str], person_refs: List[str]) -> Dict[str, Any]:
    """One query for a page of rows: note counts and the newest note for each company and each '<company id>|<person name>'."""
    company_ids = [c for c in dict.fromkeys(company_ids or []) if c][:MAX_BATCH]
    person_refs = [p for p in dict.fromkeys(person_refs or []) if p][:MAX_BATCH]
    parsed = {ref: split_person_ref(ref) for ref in person_refs}
    resolved = await resolve_many(db, company_ids + [cid for cid, _ in parsed.values()])
    all_biz: Set[str] = set()
    all_lead: Set[str] = set()
    for c in resolved.values():
        all_biz |= c.business_ids
        all_lead |= c.lead_ids
    rows: List[LeadNote] = []
    if all_biz or all_lead:
        parts = []
        if all_biz:
            parts.append(LeadNote.business_record_id.in_(all_biz))
        if all_lead:
            parts.append(LeadNote.lead_account_id.in_(all_lead))
        rows = (await db.execute(select(LeadNote).where(or_(*parts)))).scalars().all()
    out_c: Dict[str, Any] = {}
    for cid in company_ids:
        c = resolved.get(cid) or Company()
        mine = [view(r) for r in rows if (r.target_kind or "company") == "company" and c.owns(r)]
        mine += [e for e in (earlier_view(lead) for lead in c.leads) if e]
        out_c[cid] = summary(mine)
    out_p: Dict[str, Any] = {}
    for ref, (cid, key) in parsed.items():
        c = resolved.get(cid) or Company()
        out_p[ref] = summary([view(r) for r in rows if r.target_kind == "person" and r.person_key == key and key and c.owns(r)])
    return {"companies": out_c, "people": out_p}
