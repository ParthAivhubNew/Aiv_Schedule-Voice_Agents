import React, { useCallback, useEffect, useRef, useState } from "react";
import { Bookmark, ChevronDown, Eye, MessageCircle, MessageSquare, Phone, Plus, Search, Trash2, X } from "lucide-react";
import { api } from "../../../api/apiClient";
import { Loader } from "../../../app/Loader";
import { C, FONT_BODY } from "../../../tokens";
import { navigateHash } from "../../../utils/route";
import { OUTCOME_WORD, STAGES, StageBadge } from "../../leadgen/LeadActivity";
import { CHIPS, countCalls, readViews, rowAsAccount, withView, writeViews } from "./callListLogic";

// The extra tools on the Voice call list, the same kind the Leads list has: cards and chips for where each contact stands, a search box with
// saved views, bulk actions on the ticked rows, and a side panel with one contact's calls, stage and notes.

const text = { fontFamily: FONT_BODY, fontSize: 13.5, color: C.ink };
const muted = { fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate };

function useAway(open, setOpen) {
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    window.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); window.removeEventListener("keydown", esc); };
  }, [open, setOpen]);
  return box;
}

// ── Cards, chips, search and views ──────────────────────────────────────────
function ViewsMenu({ status, q, onApply, onToast }) {
  const [open, setOpen] = useState(false);
  const [views, setViews] = useState(readViews);
  const [active, setActive] = useState("");
  const box = useAway(open, setOpen);
  const keep = (next) => { setViews(next); writeViews(next); };
  const save = () => {
    const name = window.prompt("A name for this filter, for example Ready to call", "");
    if (!name || !name.trim()) return;
    keep(withView(views, { name, status, q }));
    setActive(name.trim().slice(0, 40));
    setOpen(false);
    onToast(`Saved the view ${name.trim().slice(0, 40)}.`);
  };
  return (
    <div ref={box} style={{ position: "relative" }}>
      <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" aria-expanded={open} aria-haspopup="menu" title="Switch to a saved filter, or save this one" onClick={() => setOpen((o) => !o)}>
        <Eye size={14} /> {active || "Default view"} <ChevronDown size={13} />
      </button>
      {open ? (
        <div role="menu" className="ui-card" style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 60, minWidth: 230, padding: 6, boxShadow: "0 12px 32px rgba(20,24,40,.16)" }}>
          {[{ name: "Default view", status: "all", q: "" }, ...views].map((v) => (
            <div key={v.name} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <button type="button" role="menuitem" className="ui-btn ui-btn--ghost ui-btn--sm" style={{ flex: 1, justifyContent: "flex-start", fontWeight: (active || "Default view") === v.name ? 700 : 400 }}
                onClick={() => { onApply(v); setActive(v.name === "Default view" ? "" : v.name); setOpen(false); }}>{v.name}</button>
              {v.name !== "Default view" ? (
                <button type="button" className="ui-icon-btn" aria-label={`Delete the view ${v.name}`} title="Delete this view" onClick={() => { keep(views.filter((x) => x.name !== v.name)); if (active === v.name) setActive(""); }}><X size={13} /></button>
              ) : null}
            </div>
          ))}
          <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 4, paddingTop: 4 }}>
            <button type="button" role="menuitem" className="ui-btn ui-btn--ghost ui-btn--sm" style={{ width: "100%", justifyContent: "flex-start" }} onClick={save}><Plus size={13} /> Save this filter as a view</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function CallListSummary({ rows, phoneOf, status, setStatus, q, setQ, onToast }) {
  const n = countCalls(rows, phoneOf);
  const card = (label, value) => (
    <div className="ui-card" style={{ padding: "12px 16px" }}>
      <div style={muted}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 600, color: C.textInk, fontVariantNumeric: "tabular-nums", lineHeight: 1.3 }}>{value.toLocaleString()}</div>
    </div>
  );
  return (
    <div style={{ display: "grid", gap: 10, padding: "12px 16px", borderBottom: `1px solid ${C.borderLight}`, flexShrink: 0 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
        {card("Contacts", n.contacts)}{card("Ready to call", n.ready)}{card("Called", n.called)}{card("Interested", n.interested)}
      </div>
      <div className="ui-scroll" style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2 }} role="group" aria-label="Show contacts by how their last call went">
        {CHIPS.filter(([k]) => k === "all" || n.chips[k] > 0 || status === k).map(([k, label]) => (
          <button key={k} type="button" className={`ui-btn ui-btn--sm ${status === k ? "ui-btn--primary" : "ui-btn--ghost"}`} aria-pressed={status === k} style={{ whiteSpace: "nowrap" }} onClick={() => setStatus(k)}>
            {label} <span style={{ fontVariantNumeric: "tabular-nums", opacity: 0.8 }}>{n.chips[k]}</span>
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ position: "relative", flex: "1 1 260px", maxWidth: 440 }}>
          <Search size={14} aria-hidden="true" style={{ position: "absolute", left: 10, top: 10, color: C.slate }} />
          <input className="ui-input" style={{ width: "100%", paddingLeft: 30 }} placeholder="Filter by name, phone, email or place" aria-label="Filter the call list" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <ViewsMenu status={status} q={q} onApply={(v) => { setStatus(v.status || "all"); setQ(v.q || ""); }} onToast={onToast} />
      </div>
    </div>
  );
}

// ── Bulk actions on the ticked rows ─────────────────────────────────────────
const STAGE_CHOICES = [...STAGES, ["lost", "Not interested"], ["do_not_contact", "Do not contact"]];

export function BulkActions({ selected, phoneOf, leadsOn, leadLists, listName, onRemove, onToast, onLeadListsChanged }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState(""); // "" | "list" | "stage"
  const [target, setTarget] = useState("");
  const [newName, setNewName] = useState("");
  const [stage, setStage] = useState("interested");
  const [busy, setBusy] = useState(false);
  const box = useAway(open, (v) => { setOpen(v); if (!v) setMode(""); });
  const known = selected.filter((r) => r.leadId);

  const putInList = async (name, existingId) => {
    let id = existingId;
    const ids = known.map((r) => r.leadId);
    if (!id) id = (await api.createLeadList(name, ids))?.list?.id;
    else if (ids.length) await api.updateLeadList(id, { add: ids });
    const fresh = selected.filter((r) => !r.leadId);
    if (fresh.length) await api.saveLeadAccounts(fresh.map((r) => rowAsAccount(r, phoneOf(r))), name);
    onLeadListsChanged?.();
    return id;
  };
  const run = async (fn) => {
    setBusy(true);
    try { await fn(); } catch (e) { onToast(e.message || "That didn't work."); } finally { setBusy(false); }
  };
  const addToList = () => run(async () => {
    const existing = leadLists.find((l) => l.id === target);
    const name = existing ? existing.name : newName.trim();
    if (!name) { onToast("Choose a list or type a name for a new one."); return; }
    await putInList(name, existing?.id);
    onToast(`${selected.length} contact${selected.length === 1 ? "" : "s"} added to “${name}” in Leads.`);
    setOpen(false); setMode("");
  });
  const setStageFor = () => run(async () => {
    for (const r of known) await api.setLeadStage(r.leadId, stage);
    const label = (STAGE_CHOICES.find(([k]) => k === stage) || [])[1] || stage;
    const left = selected.length - known.length;
    onToast(`${known.length} moved to ${label}.${left ? ` ${left} are not in Leads yet: add them to a Leads list first.` : ""}`);
    setOpen(false); setMode("");
  });
  const emailThem = () => run(async () => {
    const name = `${listName || "Call list"} (email)`.slice(0, 80);
    const existing = leadLists.find((l) => l.name.toLowerCase() === name.toLowerCase());
    await putInList(name, existing?.id);
    onToast(`Saved as “${name}” in Leads. Open it there and press Start a campaign.`);
    setOpen(false);
    navigateHash("#/leadgen/lists");
  });

  return (
    <div ref={box} style={{ position: "relative" }}>
      <button type="button" className="ui-btn ui-btn--ghost" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((o) => !o)}>More actions <ChevronDown size={14} /></button>
      {open ? (
        <div role="menu" className="ui-card" style={{ position: "absolute", top: "calc(100% + 4px)", right: 0, zIndex: 60, minWidth: 280, padding: 6, boxShadow: "0 12px 32px rgba(20,24,40,.16)" }}>
          {!mode ? (
            <>
              {leadsOn ? (
                <>
                  <button type="button" role="menuitem" className="ui-menu-item" onClick={() => setMode("list")}><Plus size={15} /> Add to a Leads list</button>
                  <button type="button" role="menuitem" className="ui-menu-item" disabled={!known.length} title={known.length ? "" : "These contacts are not in Leads yet. Add them to a Leads list first."} onClick={() => setMode("stage")}><Bookmark size={15} /> Set their stage</button>
                  <button type="button" role="menuitem" className="ui-menu-item" disabled={busy} onClick={emailThem}><MessageSquare size={15} /> Email them from Leads</button>
                  <hr className="ui-menu-sep" />
                </>
              ) : null}
              <button type="button" role="menuitem" className="ui-menu-item" onClick={() => { onRemove(selected.map((r) => r.id)); setOpen(false); }}><Trash2 size={15} /> Remove from this list</button>
            </>
          ) : mode === "list" ? (
            <div style={{ display: "grid", gap: 8, padding: 8 }}>
              <label style={{ ...muted, display: "grid", gap: 4 }}>Add {selected.length} to
                <select className="ui-input" value={target} onChange={(e) => setTarget(e.target.value)}>
                  <option value="">A new list…</option>
                  {leadLists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </label>
              {!target ? <input className="ui-input" placeholder="Name for the new list" aria-label="Name for the new list" value={newName} maxLength={80} onChange={(e) => setNewName(e.target.value)} /> : null}
              <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => setMode("")}>Back</button>
                <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" disabled={busy} onClick={addToList}>{busy ? "Adding…" : "Add"}</button>
              </div>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 8, padding: 8 }}>
              <label style={{ ...muted, display: "grid", gap: 4 }}>Move {known.length} to
                <select className="ui-input" value={stage} onChange={(e) => setStage(e.target.value)}>
                  {STAGE_CHOICES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                </select>
              </label>
              <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => setMode("")}>Back</button>
                <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" disabled={busy} onClick={setStageFor}>{busy ? "Moving…" : "Move"}</button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

// ── One contact's side panel ────────────────────────────────────────────────
const when = (iso) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
const KIND_WORD = { call: "Call", email: "Email", meeting: "Meeting", post: "Post", note: "Note", status: "Status" };

export function ContactPanel({ row, phone, calls, leadsOn, needNumber, onClose, onCall, onText, onWhatsApp, onToast, onAddToLeads }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");
  const [openCall, setOpenCall] = useState("");
  const leadId = leadsOn ? row.leadId : "";
  const load = useCallback(async () => {
    if (!leadId) { setData(null); return; }
    try { setData(await api.getTimeline(leadId)); setError(""); } catch (e) { setError(e.message || "Couldn't load this contact's history."); }
  }, [leadId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const esc = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  const run = async (key, fn, done) => {
    setBusy(key);
    try { await fn(); if (done) onToast(done); await load(); } catch (e) { onToast(e.message || "That didn't work."); } finally { setBusy(""); }
  };
  const stage = data?.lead?.stage || "new";
  const name = row.company || row.contact || row.name;
  const fields = [["Contact", row.contact], ["Phone", phone], ["Email", row.email], ["Website", row.website], ["Place", [row.town, row.postcode].filter(Boolean).join(" ")], ["Type of business", row.sector]].filter(([, v]) => v);
  const ordered = [...calls].sort((a, b) => new Date(b.startedAt || b.endedAt || 0) - new Date(a.startedAt || a.endedAt || 0));
  return (
    <aside role="dialog" aria-label={`Details for ${name}`} style={{ position: "fixed", top: 57, right: 0, bottom: 0, width: "min(460px, 100vw)", zIndex: 70, background: "#fff", borderLeft: `1px solid ${C.border}`, boxShadow: "-12px 0 32px rgba(20,24,40,.10)", display: "flex", flexDirection: "column", fontFamily: FONT_BODY }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "14px 16px", borderBottom: `1px solid ${C.border}` }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: C.textInk, overflowWrap: "anywhere" }}>{name}</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
            {leadId ? <StageBadge stage={stage} /> : <span style={muted}>Not in Leads yet</span>}
            <span style={muted}>{row.callTimes ? `${row.callTimes} call${row.callTimes === 1 ? "" : "s"}` : "Not called"}{row.lastOutcome ? ` · ${row.lastOutcome}` : ""}</span>
          </div>
        </div>
        <button type="button" className="ui-icon-btn" aria-label="Close" onClick={onClose}><X size={17} /></button>
      </div>
      <div className="ui-scroll" style={{ flex: 1, overflowY: "auto", padding: 16, display: "grid", gap: 16, alignContent: "start" }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" disabled={!phone || needNumber} title={needNumber ? "Get a phone number first" : ""} onClick={() => onCall()}><Phone size={14} /> Call</button>
          <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" disabled={!phone} onClick={onText}><MessageSquare size={14} /> Text</button>
          <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" disabled={!phone} onClick={onWhatsApp}><MessageCircle size={14} /> WhatsApp</button>
        </div>

        <section aria-label="Details" style={{ display: "grid", gap: 4 }}>
          {fields.map(([k, v]) => (
            <div key={k} style={{ display: "flex", gap: 10, ...text }}><span style={{ ...muted, width: 110, flex: "none" }}>{k}</span><span style={{ overflowWrap: "anywhere" }}>{v}</span></div>
          ))}
          {row.check ? <div style={{ display: "flex", gap: 10, ...text }}><span style={{ ...muted, width: 110, flex: "none" }}>Number check</span><span>{[row.check.lineType, row.check.carrier, row.check.country].filter(Boolean).join(" · ") || "Checked"}</span></div> : null}
        </section>

        {leadsOn ? (leadId ? (
          <section aria-label="Stage and notes" style={{ display: "grid", gap: 8 }}>
            <div style={{ ...text, fontWeight: 600 }}>Where they stand</div>
            <select className="ui-input" aria-label="Stage" value={stage} disabled={busy === "stage"} onChange={(e) => run("stage", () => api.setLeadStage(leadId, e.target.value), "Moved.")}>
              {[...STAGES, ["lost", "Not interested"], ["do_not_contact", "Do not contact"]].map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
            <div style={{ display: "flex", gap: 6 }}>
              <input className="ui-input" style={{ flex: 1 }} placeholder="Add a note" aria-label="Add a note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && note.trim()) run("note", async () => { await api.addLeadNote(leadId, note.trim()); setNote(""); }); }} />
              <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" disabled={!note.trim() || busy === "note"} onClick={() => run("note", async () => { await api.addLeadNote(leadId, note.trim()); setNote(""); })}>Add</button>
            </div>
          </section>
        ) : (
          <section aria-label="Leads" style={{ display: "grid", gap: 6, justifyItems: "start" }}>
            <div style={muted}>This contact is only on this call list. Add it to a Leads list to track its stage, notes and emails.</div>
            <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={onAddToLeads}><Plus size={14} /> Add to a Leads list</button>
          </section>
        )) : null}

        <section aria-label="Calls" style={{ display: "grid", gap: 6 }}>
          <div style={{ ...text, fontWeight: 600 }}>Calls</div>
          {!ordered.length ? <div style={muted}>No calls to this contact yet.</div> : ordered.map((c, i) => (
            <div key={c.id || i} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 10px" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", ...text }}>
                <b style={{ flex: 1 }}>{OUTCOME_WORD[c.outcome] || c.outcome || "Call"}</b>
                <span style={muted}>{[when(c.startedAt || c.endedAt), c.duration].filter(Boolean).join(" · ")}</span>
                {c.summary ? <button type="button" className="ui-link" onClick={() => setOpenCall(openCall === (c.id || i) ? "" : (c.id || i))}>{openCall === (c.id || i) ? "Hide summary" : "Summary"}</button> : null}
              </div>
              {openCall === (c.id || i) && c.summary ? <div style={{ ...muted, whiteSpace: "pre-wrap", marginTop: 6 }}>{c.summary}</div> : null}
            </div>
          ))}
        </section>

        {leadId ? (
          <section aria-label="Timeline" style={{ display: "grid", gap: 0 }}>
            <div style={{ ...text, fontWeight: 600, marginBottom: 6 }}>Timeline</div>
            {error ? <div role="alert" style={{ ...text, color: C.red }}>{error}</div> : null}
            {!data && !error ? <Loader compact label="Loading" /> : null}
            {data && !data.events.length ? <div style={muted}>Nothing has happened with this contact yet.</div> : null}
            {(data?.events || []).map((e) => (
              <div key={e.id} style={{ display: "flex", gap: 10, padding: "6px 0", borderTop: `1px solid ${C.border}` }}>
                <span style={{ ...muted, width: 92, flex: "none" }}>{when(e.at)}</span>
                <span style={{ fontSize: 11.5, fontWeight: 600, color: C.slate, width: 56, flex: "none" }}>{KIND_WORD[e.kind] || e.kind}</span>
                <span style={{ ...text, flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{e.summary}</span>
              </div>
            ))}
          </section>
        ) : null}
      </div>
    </aside>
  );
}
