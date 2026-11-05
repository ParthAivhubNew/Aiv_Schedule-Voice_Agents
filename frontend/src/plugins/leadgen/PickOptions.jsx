import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { C } from "../../tokens";
import { Spinner } from "../../app/Loader";
import { X } from "lucide-react";

const WORDS = { website: "website", phone: "phone number", email: "email", linkedin: "LinkedIn page", facebook: "Facebook page", x: "X profile", instagram: "Instagram profile" };
// Every public page a company can be looked up on, one icon each. The lookups are independent of one another.
export const SOCIAL = ["linkedin", "facebook", "x", "instagram"];
const WIDTH = 440;

const shortSource = (u) => String(u || "").replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "").slice(0, 52);
const isLink = (v) => /^https?:/i.test(String(v || ""));

function Candidate({ o, only, busy, disabled, onPick }) {
  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 10, display: "grid", gap: 5 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {isLink(o.value)
          ? <a href={o.value} target="_blank" rel="noreferrer" style={{ fontSize: 14, fontWeight: 600, color: C.cobalt, overflowWrap: "anywhere", flex: "1 1 200px" }}>{o.title || shortSource(o.value)}</a>
          : <strong style={{ fontSize: 14, overflowWrap: "anywhere", flex: "1 1 200px" }}>{o.value}</strong>}
        <span style={{ fontSize: 11.5, padding: "2px 8px", borderRadius: 999, background: o.label === "Likely" ? "#e9f6cf" : "#f1f3f6", color: o.label === "Likely" ? "#2f4a0c" : C.slate }}>{o.label}</span>
        {o.picks ? <span style={{ fontSize: 11.5, color: C.green }}>Confirmed as correct by {o.picks} {o.picks === 1 ? "other user" : "other users"}</span> : null}
      </div>
      {isLink(o.value) && o.title ? <div style={{ fontSize: 12, color: C.slate, overflowWrap: "anywhere" }}>{shortSource(o.value)}</div> : null}
      {o.note ? <div style={{ fontSize: 12.5, color: C.slate }}>{o.note}</div> : null}
      {(o.sources || []).length ? (
        <div style={{ fontSize: 12, color: C.slate }}>Seen on {o.sources.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer" style={{ color: C.cobalt, marginRight: 8, overflowWrap: "anywhere" }}>{shortSource(u)}</a>)}</div>
      ) : null}
      <div>
        <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" disabled={disabled} onClick={() => onPick(o)}>
          {busy ? <Spinner size={12} /> : null} {only ? "Yes, this is the correct one" : "This is the correct one"}
        </button>
      </div>
    </div>
  );
}

// Where the popover goes: just under the button it came from, kept on screen. No anchor on the page: centred.
function place(anchorKey) {
  const el = anchorKey ? document.querySelector(`[data-reach="${anchorKey}"]`) : null;
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const width = Math.min(WIDTH, window.innerWidth - 24);
  const left = Math.max(12, Math.min(r.left, window.innerWidth - width - 12));
  const below = window.innerHeight - r.bottom - 16;
  const above = r.top - 16;
  const useAbove = below < 260 && above > below;
  return { left, width, ...(useAbove ? { bottom: window.innerHeight - r.top + 6, maxHeight: Math.max(220, above) } : { top: r.bottom + 6, maxHeight: Math.max(220, below) }) };
}

// A lookup that could not be sure: the closest three, shown right under the button that was pressed. It stays until a match is chosen or it is
// closed. One candidate: "is this the right one?". Several: each is a link to check, with its own "this is the correct one" button.
export function PickOptions({ kind, company, options, anchorKey, onPick, onClose, onRetry, closest = [] }) {
  const [items, setItems] = useState(options);
  const [text, setText] = useState("");
  const [again, setAgain] = useState(false);
  const [miss, setMiss] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [pos, setPos] = useState(() => place(anchorKey));
  const box = useRef(null);
  useLayoutEffect(() => {
    const again = () => setPos(place(anchorKey));
    again();
    window.addEventListener("resize", again);
    window.addEventListener("scroll", again, true);
    return () => { window.removeEventListener("resize", again); window.removeEventListener("scroll", again, true); };
  }, [anchorKey]);
  // The parent hands in a new onClose on every render (the credits chip refreshes on a timer). Reading it through a ref keeps this
  // effect from re-running, which used to pull focus out of the text box in the middle of typing.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const opened = useRef({ hadOptions: Boolean(options?.length) }); // only what was shown when it opened decides where focus goes
  useEffect(() => {
    const field = document.getElementById("pick-more");
    ((!opened.current.hadOptions && field) || box.current)?.focus({ preventScroll: true });
    const onKey = (e) => { if (e.key === "Escape") closeRef.current(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const pick = async (o) => {
    setBusy(o.value);
    setError("");
    try { await onPick(o); onClose(); } catch (e) { setError(e.message || "That didn't save. Try again."); setBusy(""); }
  };
  const retry = async () => {
    if (!text.trim() || again) return;
    setAgain(true);
    setMiss("");
    try {
      const r = await onRetry(text.trim());
      if (r.done) { onClose(); return; }
      if ((r.options || []).length) { setItems(r.options); setText(""); } else setItems([]);
      setMiss((r.options || []).length ? "Here are the closest matches with your details added." : "Still no match. Add a little more detail and search again.");
    } catch (e) { setMiss(e.message || "We couldn't search just now. Try again later."); }
    setAgain(false);
  };
  const list = items.slice(0, 3);
  const one = list.length === 1;
  const word = WORDS[kind] || kind;
  const panel = (
    <div role="dialog" aria-modal="false" aria-label={one ? `Is this the right ${word}?` : `Which is the right ${word}?`} ref={box} tabIndex={-1}
      style={{ outline: "none", background: "#fff", borderRadius: 14, overflow: "auto", padding: 16, display: "grid", gap: 10, boxShadow: "0 12px 40px rgba(0,0,0,.22)", border: `1px solid ${C.border}`,
        ...(pos ? { position: "fixed", zIndex: 320, ...pos } : { width: "min(480px,100%)", maxHeight: "90vh" }) }}>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{!list.length ? `No confirmed ${word} for ${company} yet` : one ? `Is this the right ${word} for ${company}?` : `Which is the right ${word} for ${company}?`}</div>
          <div style={{ fontSize: 12.5, color: C.slate }}>
            {!list.length ? "Nothing was confirmed, so nothing is shown as theirs. These links are where to look, or tell us more below and we will search again." : <>{one ? "We found one possible match but are not sure. Open it and check." : "These are the closest matches. Open each one and check."} Choose the correct one and it is kept for you from then on.</>}
          </div>
        </div>
        <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={onClose} aria-label="Close"><X size={16} /></button>
      </div>
      {list.map((o) => <Candidate key={o.value} o={o} only={one} busy={busy === o.value} disabled={Boolean(busy)} onPick={pick} />)}
      {error ? <div role="alert" style={{ fontSize: 12.5, color: C.red }}>{error}</div> : null}
      {closest.length ? (
        <div style={{ display: "grid", gap: 4, borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Where to look</div>
          {closest.map((l) => (
            <a key={l.url} href={l.url} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: C.cobalt, overflowWrap: "anywhere" }}>{l.label}<span style={{ color: C.slate, fontSize: 12 }}> · {l.note}</span></a>
          ))}
        </div>
      ) : null}
      {onRetry ? (
        <div style={{ display: "grid", gap: 6, borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
          <label htmlFor="pick-more" style={{ fontSize: 13, fontWeight: 600 }}>{list.length ? "None of these? Tell us more" : "Tell us more"}</label>
          <textarea id="pick-more" value={text} onChange={(e) => setText(e.target.value.slice(0, 300))} rows={2} maxLength={300} disabled={again}
            placeholder="Anything that helps: the town, the name they trade under, what they do, a person who works there"
            style={{ width: "100%", boxSizing: "border-box", padding: 8, borderRadius: 8, border: `1px solid ${C.border}`, font: "inherit", fontSize: 13, resize: "vertical" }} />
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" disabled={!text.trim() || again} onClick={retry}>{again ? <Spinner size={12} /> : null} Search again</button>
            {miss ? <span role="status" style={{ fontSize: 12.5, color: C.slate }}>{miss}</span> : null}
          </div>
        </div>
      ) : null}
      <div><button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={onClose}>{one ? "No, this is not it" : "None of these"}</button></div>
    </div>
  );
  if (pos) return panel;
  return <div style={{ position: "fixed", inset: 0, zIndex: 320, background: "rgba(15,23,42,.35)", display: "grid", placeItems: "center", padding: 16 }}>{panel}</div>;
}
