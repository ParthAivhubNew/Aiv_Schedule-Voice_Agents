import { useEffect, useRef, useState } from "react";
import { Maximize2, X } from "lucide-react";
import { api } from "../../api/apiClient";

// A text box for a list of things to leave out. While someone types, the closest known category or word is shown after their text in a
// faint colour; Tab (or the arrow key, or tapping the hint) writes it in. A button opens the same box large, for a long list.

let cached = null;
async function loadSuggestions() {
  if (cached) return cached;
  try { cached = (await api.exclusionSuggestions()).suggestions || []; } catch { cached = []; }
  return cached;
}

const items = (value) => String(value || "").split(/[,\n]/).map((s) => s.trim()).filter(Boolean);

// The word being typed is what follows the last comma or line break.
export function wordAt(value) {
  const cut = Math.max(value.lastIndexOf(","), value.lastIndexOf("\n")) + 1;
  const raw = value.slice(cut);
  const lead = raw.match(/^\s*/)[0];
  return { head: value.slice(0, cut) + lead, word: raw.slice(lead.length) };
}

export function closest(value, list) {
  const { word } = wordAt(value);
  if (word.length < 2) return "";
  const w = word.toLowerCase();
  const taken = new Set(items(value).map((s) => s.toLowerCase()));
  let best = "";
  for (const s of list) {
    const l = s.toLowerCase();
    if (l.startsWith(w) && l.length > w.length && !taken.has(l) && (!best || s.length < best.length || (s.length === best.length && l < best.toLowerCase()))) best = s;
  }
  return best;
}

const BOX = { fontFamily: "inherit", fontSize: 14, lineHeight: "20px", padding: "8px 10px", margin: 0, boxSizing: "border-box", whiteSpace: "pre-wrap", overflowWrap: "anywhere" };

function GhostArea({ value, onChange, placeholder, rows, label, autoFocus }) {
  const [list, setList] = useState([]);
  const [focused, setFocused] = useState(false);
  const ghost = useRef(null);
  useEffect(() => { let on = true; loadSuggestions().then((l) => on && setList(l)); return () => { on = false; }; }, []);
  const hint = focused ? closest(value, list) : "";
  const { head, word } = wordAt(value);
  const accept = () => { onChange(head + hint + ", "); };
  return (
    <div>
      <div style={{ position: "relative", background: "#fff", border: "1px solid var(--ui-line)", borderRadius: 8 }}>
        <div ref={ghost} aria-hidden="true" style={{ ...BOX, position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none", color: "transparent" }}>
          {value}<span style={{ color: "var(--ui-muted, #8a8f98)", opacity: 0.7 }}>{hint ? hint.slice(word.length) : ""}</span>
        </div>
        <textarea aria-label={label} autoFocus={autoFocus} rows={rows} value={value} placeholder={placeholder} spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
          onScroll={(e) => { if (ghost.current) ghost.current.scrollTop = e.target.scrollTop; }}
          onKeyDown={(e) => {
            const atEnd = e.target.selectionStart === value.length && e.target.selectionEnd === value.length;
            if (hint && atEnd && (e.key === "Tab" || e.key === "ArrowRight") && !e.shiftKey) { e.preventDefault(); accept(); }
          }}
          style={{ ...BOX, position: "relative", display: "block", width: "100%", resize: "vertical", border: "none", outline: "none", background: "transparent", color: "inherit" }} />
      </div>
      {hint ? (
        <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" style={{ marginTop: 4 }} onMouseDown={(e) => e.preventDefault()} onClick={accept} title="Write this in">
          Tab to add: {hint}
        </button>
      ) : null}
    </div>
  );
}

export default function ExclusionBox({ value, onChange, placeholder, label, title }) {
  const [big, setBig] = useState(false);
  useEffect(() => {
    if (!big) return undefined;
    const onKey = (e) => { if (e.key === "Escape") setBig(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [big]);
  const count = items(value).length;
  return (
    <>
      <GhostArea value={value} onChange={onChange} placeholder={placeholder} rows={3} label={label} />
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
        <span style={{ fontSize: 12, color: "var(--ui-muted)" }}>{count ? `${count.toLocaleString()} ${count === 1 ? "item" : "items"}` : "Separate with commas"}</span>
        <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" style={{ marginLeft: "auto" }} title={title || "Open a large box to read and edit the whole list"} onClick={() => setBig(true)}>
          <Maximize2 size={13} /> Expand
        </button>
      </div>
      {big ? (
        <div role="dialog" aria-modal="true" aria-label={label} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(15,20,30,.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onMouseDown={(e) => { if (e.target === e.currentTarget) setBig(false); }}>
          <div className="ui-card" style={{ width: "min(900px, 100%)", maxHeight: "92vh", display: "flex", flexDirection: "column", gap: 10, padding: 16, background: "#fff" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <strong style={{ fontSize: 15 }}>{label}</strong>
              <span style={{ fontSize: 12, color: "var(--ui-muted)" }}>{count.toLocaleString()} {count === 1 ? "item" : "items"} · separate with commas or new lines</span>
              <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" style={{ marginLeft: "auto" }} aria-label="Close" onClick={() => setBig(false)}><X size={16} /></button>
            </div>
            <div style={{ overflow: "auto" }}>
              <GhostArea value={value} onChange={onChange} placeholder={placeholder} rows={18} label={`${label}, large box`} autoFocus />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" disabled={!value} onClick={() => onChange("")}>Clear</button>
              <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" style={{ marginLeft: "auto" }} onClick={() => setBig(false)}>Done</button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
