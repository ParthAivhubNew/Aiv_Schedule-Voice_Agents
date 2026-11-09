import React, { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { StickyNote, Trash2, X } from "lucide-react";
import { api } from "../../api/apiClient";
import { notice } from "../../utils/notice";
import { C, FONT_BODY } from "../../tokens";
import { Spinner } from "../../app/Loader";
import { NOTE_MAX, batches, cleanNote, companyRef, countWords, isAddShortcut, noteByline, noteProblem, oneLine, personKey, personRef } from "./notesLogic";

const text = { fontFamily: FONT_BODY };
const muted = { ...text, fontSize: 12.5, color: C.slate, lineHeight: 1.5 };
const CHANGED = "aivhub:notes-changed";

// ---------------------------------------------------------------- counts for table rows
// Every notes button on screen asks for its count; the asks made in the same moment go out as one request,
// so a page of rows costs one counts call. Any note added or deleted clears the cache and the buttons ask again.
const cache = new Map();
const inflight = new Set();
const wanted = { companies: new Set(), people: new Set() };
const listeners = new Set();
let version = 0;
let timer = null;

function emit() {
  version += 1;
  listeners.forEach((fn) => fn());
}

async function flush() {
  timer = null;
  const companies = [...wanted.companies];
  const people = [...wanted.people];
  wanted.companies.clear();
  wanted.people.clear();
  [...companies, ...people].forEach((r) => inflight.add(r));
  const cb = batches(companies);
  const pb = batches(people);
  const rounds = Math.max(cb.length, pb.length);
  for (let i = 0; i < rounds; i += 1) {
    const c = cb[i] || [];
    const p = pb[i] || [];
    try {
      const r = await api.leadNoteCounts(c, p);
      c.forEach((id) => cache.set(`c:${id}`, (r.companies || {})[id] || { count: 0, latest: null }));
      p.forEach((id) => cache.set(`p:${id}`, (r.people || {})[id] || { count: 0, latest: null }));
    } catch {
      c.forEach((id) => cache.set(`c:${id}`, { count: 0, latest: null }));
      p.forEach((id) => cache.set(`p:${id}`, { count: 0, latest: null }));
    }
    [...c, ...p].forEach((r) => inflight.delete(r));
  }
  emit();
}

function ask(kind, ref) {
  if (!ref || cache.has(`${kind}:${ref}`) || inflight.has(ref)) return;
  (kind === "c" ? wanted.companies : wanted.people).add(ref);
  if (!timer) timer = setTimeout(flush, 40);
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notesChanged() {
  cache.clear();
  emit();
  try { window.dispatchEvent(new CustomEvent(CHANGED)); } catch { /* nothing else listens */ }
}

function useNoteCount(companyId, person) {
  const kind = person ? "p" : "c";
  const ref = person ? personRef(companyId, person) : companyRef(companyId);
  const v = useSyncExternalStore(subscribe, () => version);
  useEffect(() => { ask(kind, ref); }, [kind, ref, v]);
  return cache.get(`${kind}:${ref}`) || null;
}

// ---------------------------------------------------------------- one company's notes
// target: { companyId, accountId }. Either id is enough; give both when the saved company is linked to a store record.
export function useNotes(target) {
  const companyId = target?.companyId || "";
  const accountId = target?.accountId || "";
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    if (!companyId && !accountId) return;
    try {
      setData(await api.leadNotes({ companyId, accountId }));
      setError("");
    } catch (e) {
      setError(e.message || "Couldn't load the notes.");
    }
  }, [companyId, accountId]);
  useEffect(() => { setData(null); load(); }, [load]);
  useEffect(() => {
    window.addEventListener(CHANGED, load);
    return () => window.removeEventListener(CHANGED, load);
  }, [load]);
  const add = async (raw, person = "") => {
    const problem = noteProblem(raw);
    if (problem) { notice(problem); return false; }
    try {
      await api.addLeadNoteEntry({ companyId, accountId, person, text: cleanNote(raw) });
      notice("Note added.");
      notesChanged();
      return true;
    } catch (e) {
      notice(e.message || "The note wasn't added. Try again.");
      return false;
    }
  };
  const remove = async (id) => {
    try {
      await api.deleteLeadNote(id);
      notice("Note deleted.");
      notesChanged();
      return true;
    } catch (e) {
      notice(e.message || "The note wasn't deleted. Try again.");
      return false;
    }
  };
  return { data, error, load, add, remove, notes: data?.notes || [], people: data?.people || {} };
}

// ---------------------------------------------------------------- the box and the list
function NoteBox({ onAdd, placeholder = "Add a note for your team", compact = false, autoFocus = false }) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (busy || !cleanNote(draft)) return;
    setBusy(true);
    if (await onAdd(draft)) setDraft("");
    setBusy(false);
  };
  const over = draft.length > NOTE_MAX;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <textarea className="ui-input" rows={compact ? 2 : 3} value={draft} autoFocus={autoFocus} placeholder={placeholder} aria-label="New note"
        onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (isAddShortcut(e)) { e.preventDefault(); submit(); } }}
        style={{ height: "auto", padding: "8px 10px", resize: "vertical", lineHeight: 1.5 }} />
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" disabled={busy || !cleanNote(draft) || over} onClick={submit}
          title="Add this note. Everyone in your organisation sees it, with your name and the time. Ctrl+Enter also adds it">
          {busy ? <Spinner size={12} /> : null} Add note
        </button>
        <span style={{ ...muted, fontSize: 11.5, color: over ? C.red : C.slate }}>{over ? `${(draft.length - NOTE_MAX).toLocaleString()} characters too long` : "Ctrl+Enter adds it"}</span>
      </div>
    </div>
  );
}

function NoteRow({ n, onDelete }) {
  const [busy, setBusy] = useState(false);
  return (
    <li style={{ listStyle: "none", padding: "10px 0", borderTop: `1px solid ${C.borderLight}`, display: "flex", gap: 8, alignItems: "flex-start" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ ...muted, fontSize: 12, fontWeight: 600, color: n.earlier ? C.slate : C.ink }}>{noteByline(n)}</div>
        <div style={{ ...text, fontSize: 13.5, color: C.textInk, whiteSpace: "pre-wrap", overflowWrap: "anywhere", lineHeight: 1.5 }}>{n.text}</div>
      </div>
      {n.can_delete ? (
        <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" disabled={busy}
          title={n.earlier ? "Clear this earlier note" : "Delete this note"} aria-label={n.earlier ? "Clear the earlier note" : `Delete the note from ${noteByline(n)}`}
          onClick={async () => { setBusy(true); await onDelete(n.id); setBusy(false); }}>
          {busy ? <Spinner size={12} /> : <Trash2 size={14} />}
        </button>
      ) : null}
    </li>
  );
}

export function NotesList({ notes, error, loading, onAdd, onDelete, autoFocus = false, compact = false, empty = "No notes yet. Notes are shared with everyone in your organisation." }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <NoteBox onAdd={onAdd} autoFocus={autoFocus} compact={compact} />
      {error ? <div role="alert" style={{ ...muted, color: C.red }}>{error}</div> : null}
      {loading ? <div role="status" style={{ ...muted, display: "flex", gap: 6, alignItems: "center" }}><Spinner size={12} /> Loading notes</div> : null}
      {!loading && !notes.length && !error ? <div style={muted}>{empty}</div> : null}
      {notes.length ? <ul style={{ margin: 0, padding: 0 }}>{notes.map((n) => <NoteRow key={n.id} n={n} onDelete={onDelete} />)}</ul> : null}
    </div>
  );
}

// The full Notes tab of a profile: give it the useNotes() result.
export function NotesTab({ notesApi }) {
  return <NotesList notes={notesApi.notes} error={notesApi.error} loading={!notesApi.data && !notesApi.error} onAdd={(t) => notesApi.add(t)} onDelete={notesApi.remove} />;
}

// ---------------------------------------------------------------- the newest note in one line
export function LatestNote({ note, onOpen, style }) {
  if (!note) {
    return (
      <button type="button" onClick={onOpen} title="Open the notes on this company" aria-label="No notes yet. Open the notes"
        style={{ all: "unset", cursor: "pointer", ...muted, fontSize: 12.5, display: "flex", alignItems: "center", gap: 6, minWidth: 0, ...style }}>
        <StickyNote size={13} aria-hidden="true" /> No notes yet
      </button>
    );
  }
  return (
    <button type="button" onClick={onOpen} title={`${noteByline(note)}: ${oneLine(note.text, 400)}. Open the notes`} aria-label={`Latest note, ${noteByline(note)}: ${oneLine(note.text, 140)}. Open the notes`}
      style={{ all: "unset", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, minWidth: 0, ...text, fontSize: 12.5, color: C.textInk, ...style }}>
      <StickyNote size={13} color={C.slate} aria-hidden="true" style={{ flex: "none" }} />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{oneLine(note.text, 200)}</span>
      <span style={{ ...muted, fontSize: 11.5, whiteSpace: "nowrap", flex: "none" }}>{noteByline(note)}</span>
    </button>
  );
}

// ---------------------------------------------------------------- the notes button for tables and lists
// A quiet icon when there are no notes, the count when there are. Opens a small popover with the notes and a box to add one,
// without opening the profile: every click inside stops at the button.
function Popover({ anchor, onClose, children, label }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  useLayoutEffect(() => {
    const place = () => {
      const r = anchor?.getBoundingClientRect();
      if (!r) return;
      const w = Math.min(360, window.innerWidth - 24);
      const left = Math.max(12, Math.min(r.left, window.innerWidth - w - 12));
      const below = window.innerHeight - r.bottom;
      const maxH = Math.max(220, Math.min(460, (below > 300 ? below : r.top) - 16));
      setPos(below > 300 || below > r.top ? { left, top: r.bottom + 6, width: w, maxHeight: maxH } : { left, bottom: window.innerHeight - r.top + 6, width: w, maxHeight: maxH });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [anchor]);
  useEffect(() => {
    const key = (e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    const away = (e) => { if (ref.current && !ref.current.contains(e.target) && !anchor?.contains(e.target)) onClose(); };
    window.addEventListener("keydown", key, true);
    window.addEventListener("mousedown", away);
    return () => { window.removeEventListener("keydown", key, true); window.removeEventListener("mousedown", away); };
  }, [onClose, anchor]);
  if (!pos) return null;
  return createPortal(
    <div ref={ref} role="dialog" aria-label={label} onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}
      className="ui-scroll" style={{ position: "fixed", zIndex: 1200, ...pos, overflowY: "auto", background: "#fff", border: `1px solid ${C.border}`, borderRadius: 10, boxShadow: "0 12px 32px rgba(16,24,40,.18)", padding: 12, boxSizing: "border-box" }}>
      {children}
    </div>,
    document.body,
  );
}

function PopoverBody({ companyId, person, name, onClose }) {
  const n = useNotes({ companyId });
  const list = person ? (n.people[personKey(person)] || []) : n.notes;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ ...text, fontSize: 13.5, fontWeight: 600, color: C.ink, flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>Notes on {name}</div>
        <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" title="Close the notes" aria-label="Close the notes" onClick={onClose}><X size={14} /></button>
      </div>
      <NotesList compact autoFocus notes={list} error={n.error} loading={!n.data && !n.error} onAdd={(t) => n.add(t, person || "")} onDelete={n.remove}
        empty={`No notes on ${name} yet. Everyone in your organisation sees what you add.`} />
    </div>
  );
}

export function NotesButton({ companyId, person = "", name = "" }) {
  const info = useNoteCount(companyId, person);
  const [open, setOpen] = useState(false);
  const btn = useRef(null);
  const close = useCallback(() => setOpen(false), []);
  if (!companyId) return null;
  const count = info?.count || 0;
  const who = name || person || "this company";
  const tip = count ? `${countWords(count)} on ${who}. Latest: ${oneLine(info.latest?.text || "", 90)}. Open the notes` : `Add a note on ${who}`;
  return (
    <>
      <button ref={btn} type="button" title={tip} aria-label={count ? `${countWords(count)} on ${who}. Open the notes` : `Add a note on ${who}`} aria-expanded={open} aria-haspopup="dialog"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }} onMouseDown={(e) => e.stopPropagation()}
        style={{ all: "unset", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 3, padding: "2px 5px", borderRadius: 6, verticalAlign: "middle", flex: "none",
          color: count ? C.cobalt : C.slateLight, background: count ? C.cobaltSoft : "transparent", ...text, fontSize: 11.5, fontWeight: 600, minHeight: 20 }}>
        <StickyNote size={13} aria-hidden="true" />{count ? <span>{count}</span> : null}
      </button>
      {open ? <Popover anchor={btn.current} onClose={close} label={`Notes on ${who}`}><PopoverBody companyId={companyId} person={person} name={who} onClose={close} /></Popover> : null}
    </>
  );
}
