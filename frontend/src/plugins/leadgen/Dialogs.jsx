import React, { useEffect, useState } from "react";
import { C, FONT_BODY } from "../../tokens";

// In-app replacements for the browser's prompt and confirm boxes, in the same look as the rest of Leads.
// Call askText(...) or askConfirm(...) from anywhere; both return a promise. <DialogHost /> is mounted once.

const text = { fontFamily: FONT_BODY };
let host = null; // set by the mounted DialogHost

export function askText({ title, label = "", initial = "", placeholder = "", confirm = "Save", multiline = false, maxLength = 200 }) {
  if (!host) return Promise.resolve(window.prompt(title, initial));
  return new Promise((resolve) => host({ kind: "text", title, label, initial, placeholder, confirm, multiline, maxLength, resolve }));
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
  const isText = d.kind === "text";
  const cancel = () => done(isText ? null : false);
  const accept = () => {
    if (!isText) return done(true);
    const v = value.trim();
    if (v) done(v);
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
        {isText ? (
          <label style={{ display: "flex", flexDirection: "column", gap: 4, ...text, fontSize: 12.5, color: C.slate }}>
            {d.label}
            {d.multiline
              ? <textarea className="ui-input" autoFocus rows={4} value={value} maxLength={d.maxLength} placeholder={d.placeholder} onChange={(e) => setValue(e.target.value)} style={{ height: "auto", padding: "8px 10px", resize: "vertical" }} />
              : <input className="ui-input" autoFocus value={value} maxLength={d.maxLength} placeholder={d.placeholder} onChange={(e) => setValue(e.target.value)} onFocus={(e) => e.target.select()} />}
          </label>
        ) : null}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="ui-btn ui-btn--ghost" title="Close without doing it" onClick={cancel}>Cancel</button>
          <button type="button" className={`ui-btn ${d.danger ? "ui-btn--danger" : "ui-btn--primary"}`} disabled={isText && !value.trim()} title={isText ? "Save what you typed" : "Go ahead"} onClick={accept}>{d.confirm}</button>
        </div>
      </div>
    </div>
  );
}
