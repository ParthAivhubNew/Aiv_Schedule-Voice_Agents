import React, { useEffect, useState } from "react";
import { C, FONT_BODY } from "../../tokens";
import { api } from "../../api/apiClient";

// In-app replacements for the browser's prompt and confirm boxes, in the same look as the rest of Leads.
// Call askText(...) or askConfirm(...) from anywhere; both return a promise. <DialogHost /> is mounted once.

const text = { fontFamily: FONT_BODY };
let host = null; // set by the mounted DialogHost

export function askText({ title, label = "", initial = "", placeholder = "", confirm = "Save", multiline = false, maxLength = 200 }) {
  if (!host) return Promise.resolve(window.prompt(title, initial));
  return new Promise((resolve) => host({ kind: "text", title, label, initial, placeholder, confirm, multiline, maxLength, resolve }));
}

// Pick one of the lists already made, or type a new name. Resolves with the list name, or null when closed.
export function askList({ title, confirm = "Add" }) {
  if (!host) return Promise.resolve(window.prompt(title, "Unsorted"));
  return new Promise((resolve) => host({ kind: "list", title, confirm, resolve }));
}

export function askConfirm({ title, body = "", confirm = "Yes", danger = false }) {
  if (!host) return Promise.resolve(window.confirm(`${title}${body ? `\n\n${body}` : ""}`));
  return new Promise((resolve) => host({ kind: "confirm", title, body, confirm, danger, resolve }));
}

export function DialogHost() {
  const [queue, setQueue] = useState([]);
  useEffect(() => {
    host = (d) => setQueue((q) => [...q, d]);
    return () => { host = null; };
  }, []);
  const current = queue[0];
  if (!current) return null;
  const done = (value) => { current.resolve(value); setQueue((q) => q.slice(1)); };
  return <DialogBox key={queue.length + current.title} d={current} done={done} />;
}

function DialogBox({ d, done }) {
  const [value, setValue] = useState(d.initial || "");
  const [lists, setLists] = useState(null);
  const isText = d.kind === "text" || d.kind === "list";
  useEffect(() => {
    if (d.kind !== "list") return;
    api.listLeadLists().then((r) => setLists((r && r.lists) || [])).catch(() => setLists([]));
  }, [d.kind]);
  const typed = value.trim();
  const same = (lists || []).find((l) => l.name.trim().toLowerCase() === typed.toLowerCase());
  const shown = (lists || []).filter((l) => !typed || l.name.toLowerCase().includes(typed.toLowerCase()));
  const cancel = () => done(isText ? null : false);
  const accept = () => {
    if (!isText) return done(true);
    const v = value.trim();
    if (v) done(same ? same.name : v);
  };
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") cancel();
      if (e.key === "Enter" && !(isText && d.multiline && !e.ctrlKey)) { e.preventDefault(); accept(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  return (
    <div onClick={cancel} style={{ position: "fixed", inset: 0, background: "rgba(15,18,28,0.45)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div role="dialog" aria-modal="true" aria-label={d.title} onClick={(e) => e.stopPropagation()} className="ui-card"
        style={{ width: "min(100%, 420px)", padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ ...text, fontSize: 16, fontWeight: 600, color: C.ink, overflowWrap: "anywhere" }}>{d.title}</div>
        {!isText && d.body ? <div style={{ ...text, fontSize: 13.5, color: C.slate, lineHeight: 1.5 }}>{d.body}</div> : null}
        {d.kind === "list" ? (
          <>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, ...text, fontSize: 12.5, color: C.slate }}>
              Pick a list below, or type a new name to start one
              <input className="ui-input" autoFocus value={value} maxLength={80} placeholder="Search your lists or name a new one" onChange={(e) => setValue(e.target.value)} />
            </label>
            <div role="listbox" aria-label="Your lists" style={{ maxHeight: 240, overflowY: "auto", border: `1px solid ${C.border}`, borderRadius: 8 }}>
              {lists === null ? <div style={{ ...text, fontSize: 13, color: C.slate, padding: 10 }}>Loading your lists…</div> : null}
              {lists !== null && !shown.length ? <div style={{ ...text, fontSize: 13, color: C.slate, padding: 10 }}>{typed ? "No list has that name yet. It will be made." : "You have no lists yet."}</div> : null}
              {shown.map((l) => (
                <button key={l.id} type="button" role="option" aria-selected={same?.id === l.id} onClick={() => setValue(l.name)}
                  style={{ ...text, display: "flex", width: "100%", justifyContent: "space-between", gap: 8, textAlign: "left", padding: "8px 10px", border: 0, borderBottom: `1px solid ${C.border}`, cursor: "pointer", fontSize: 13.5, color: C.ink, background: same?.id === l.id ? "#EEF2FF" : "transparent" }}>
                  <span style={{ overflowWrap: "anywhere" }}>{l.name}</span>
                  <span style={{ color: C.slate, flex: "none" }}>{(l.ids || []).length.toLocaleString()}</span>
                </button>
              ))}
            </div>
          </>
        ) : d.kind === "text" ? (
          <label style={{ display: "flex", flexDirection: "column", gap: 4, ...text, fontSize: 12.5, color: C.slate }}>
            {d.label}
            {d.multiline
              ? <textarea className="ui-input" autoFocus rows={4} value={value} maxLength={d.maxLength} placeholder={d.placeholder} onChange={(e) => setValue(e.target.value)} style={{ height: "auto", padding: "8px 10px", resize: "vertical" }} />
              : <input className="ui-input" autoFocus value={value} maxLength={d.maxLength} placeholder={d.placeholder} onChange={(e) => setValue(e.target.value)} onFocus={(e) => e.target.select()} />}
          </label>
        ) : null}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="ui-btn ui-btn--ghost" title="Close without doing it" onClick={cancel}>Cancel</button>
          <button type="button" className={`ui-btn ${d.danger ? "ui-btn--danger" : "ui-btn--primary"}`} disabled={isText && !value.trim()} title={isText ? "Save what you typed" : "Go ahead"} onClick={accept}>{d.kind === "list" && typed ? (same ? `${d.confirm} to ${same.name.length > 22 ? same.name.slice(0, 21) + "…" : same.name}` : "Make list and add") : d.confirm}</button>
        </div>
      </div>
    </div>
  );
}
