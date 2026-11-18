import { useEffect, useRef, useState } from "react";
import { Maximize2, X } from "lucide-react";
import { api } from "../../api/apiClient";

// A box for a list of things to leave out. Each item becomes a chip with an x and a tag saying how it is read (category, word, SIC code,
// postcode, company number). While someone types, matching categories and words drop down, and the closest one shows after the text in a
// faint colour: Tab writes it in. A comma, Enter or a paste adds items. A button opens the list large, where it can also be edited as text.

let cached = null;
async function load() {
  if (cached) return cached;
  try {
    const r = await api.exclusionSuggestions();
    cached = { list: r.suggestions || [], cats: new Set(r.categories || []) };
  } catch { cached = { list: [], cats: new Set() }; }
  return cached;
}

export const items = (value) => String(value || "").split(/[,\n]/).map((s) => s.trim()).filter(Boolean);

// The same reading of a label the server uses: lower case, "&" is "and", letters and digits only.
export const keyOf = (s) => (String(s || "").toLowerCase().replace(/&/g, " and ").match(/[a-z0-9]+/g) || []).join(" ");

const KIND_TIPS = {
  Category: "A category: leaves out companies with the words and SIC codes it stands for",
  Word: "A word: leaves out companies with it in their name or trade",
  "SIC code": "A SIC code: leaves out companies with this code (a short code takes every code starting with it)",
  Postcode: "A postcode district: leaves out companies registered there",
  "Company no.": "A company number: leaves out that one company",
};

export function kindOf(item, cats) {
  const t = String(item).trim();
  if (/^\d{2,5}$/.test(t)) return "SIC code";
  if (/^[A-Za-z]{0,2}\d{6,8}$/.test(t.replace(/\s+/g, ""))) return "Company no.";
  if (/^[A-Z]{1,2}\d[A-Z\d]?( \d[A-Z]{0,2})?$/.test(t.toUpperCase().replace(/\s+/g, " "))) return "Postcode";
  return cats.has(keyOf(t)) || cats.has(keyOf(t.replace(/\(.*?\)/g, ""))) ? "Category" : "Word";
}

// Up to six suggestions for what is being typed: those that start with it (shortest first), then those with a word that starts with it.
export function matches(draft, list, taken) {
  const w = String(draft || "").replace(/^\s+/, "").toLowerCase();
  if (w.trim().length < 2) return [];
  const starts = [];
  const inside = [];
  for (const s of list) {
    const l = s.toLowerCase();
    if (taken.has(l) || l === w.trim()) continue;
    if (l.startsWith(w)) starts.push(s);
    else if (l.split(/[^a-z0-9]+/).some((p) => p && p.startsWith(w.trim()))) inside.push(s);
  }
  const order = (a, b) => a.length - b.length || a.toLowerCase().localeCompare(b.toLowerCase());
  return [...starts.sort(order), ...inside.sort(order)].slice(0, 6);
}

// Text mode (the large box): the word being typed is what follows the last comma or line break.
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

const FONT = { fontFamily: "inherit", fontSize: 14, lineHeight: "20px" };
const FAINT = { color: "var(--ui-muted, #8a8f98)", opacity: 0.7 };

function ChipInput({ value, onChange, placeholder, label, list, cats, tall }) {
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const inputRef = useRef(null);
  const have = items(value);
  const taken = new Set(have.map((s) => s.toLowerCase()));
  const found = open ? matches(draft, list, taken) : [];
  const lead = draft.replace(/^\s+/, "");
  const ghost = found[0] && found[0].toLowerCase().startsWith(lead.toLowerCase()) ? found[0] : "";

  const commit = (text) => {
    const add = items(text).filter((s, i, all) => !taken.has(s.toLowerCase()) && all.findIndex((x) => x.toLowerCase() === s.toLowerCase()) === i);
    if (add.length) onChange([...have, ...add].join(", "));
    setDraft("");
    setActive(-1);
  };
  const removeAt = (i) => onChange(have.filter((_, n) => n !== i).join(", "));

  const onKeyDown = (e) => {
    const atEnd = e.target.selectionStart === draft.length && e.target.selectionEnd === draft.length;
    if (e.key === "ArrowDown" && found.length) { e.preventDefault(); setActive((a) => Math.min(a + 1, found.length - 1)); return; }
    if (e.key === "ArrowUp" && found.length) { e.preventDefault(); setActive((a) => Math.max(a - 1, -1)); return; }
    if (e.key === "Tab" && !e.shiftKey && (active >= 0 || ghost)) { e.preventDefault(); commit(active >= 0 ? found[active] : ghost); return; }
    if (e.key === "ArrowRight" && ghost && atEnd) { e.preventDefault(); commit(ghost); return; }
    if (e.key === "Enter" && (active >= 0 || draft.trim())) { e.preventDefault(); commit(active >= 0 ? found[active] : draft); return; }
    if (e.key === "," && draft.trim()) { e.preventDefault(); commit(draft); return; }
    if (e.key === "Backspace" && !draft && have.length) { e.preventDefault(); removeAt(have.length - 1); return; }
    if (e.key === "Escape" && found.length) { e.stopPropagation(); setOpen(false); setActive(-1); }
  };

  return (
    <div style={{ position: "relative" }}>
      <div onClick={() => inputRef.current && inputRef.current.focus()}
        style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, padding: 6, background: "#fff", border: "1px solid var(--ui-line)", borderRadius: 8, maxHeight: tall ? "55vh" : 160, minHeight: tall ? 160 : 0, overflowY: "auto", cursor: "text", alignContent: "flex-start" }}>
        {have.map((it, i) => {
          const kind = kindOf(it, cats);
          return (
            <span key={`${it}-${i}`} title={KIND_TIPS[kind]} style={{ ...FONT, fontSize: 13, display: "inline-flex", alignItems: "center", gap: 6, background: "var(--ui-sunken, #f3f4f6)", border: "1px solid var(--ui-line)", borderRadius: 6, padding: "1px 4px 1px 8px", maxWidth: "100%" }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it}</span>
              <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--ui-muted)" }}>{kind}</span>
              <button type="button" aria-label={`Remove ${it}`} onClick={(e) => { e.stopPropagation(); removeAt(i); }}
                style={{ all: "unset", cursor: "pointer", display: "inline-flex", padding: 2, borderRadius: 4, color: "var(--ui-muted)" }}><X size={12} /></button>
            </span>
          );
        })}
        <span style={{ position: "relative", flex: "1 1 140px", minWidth: 120, display: "inline-block" }}>
          <span aria-hidden="true" style={{ ...FONT, position: "absolute", left: 0, top: 0, bottom: 0, display: "flex", alignItems: "center", whiteSpace: "pre", overflow: "hidden", maxWidth: "100%", pointerEvents: "none" }}>
            <span style={{ visibility: "hidden" }}>{draft}</span><span style={FAINT}>{ghost ? ghost.slice(lead.length) : ""}</span>
          </span>
          <input ref={inputRef} aria-label={label} aria-autocomplete="list" aria-expanded={found.length > 0} value={draft} spellCheck={false} autoComplete="off"
            placeholder={have.length ? "" : placeholder}
            onChange={(e) => { setDraft(e.target.value.replace(/^\s+/, "")); setOpen(true); setActive(-1); }}
            onFocus={() => setOpen(true)}
            onBlur={() => { setOpen(false); if (draft.trim()) commit(draft); }}
            onPaste={(e) => {
              const t = e.clipboardData && e.clipboardData.getData("text");
              if (t && /[,\n]/.test(t)) { e.preventDefault(); commit(`${draft},${t}`); }
            }}
            onKeyDown={onKeyDown}
            style={{ ...FONT, position: "relative", width: "100%", border: "none", outline: "none", background: "transparent", color: "inherit", padding: 0, margin: 0 }} />
        </span>
      </div>
      {found.length ? (
        <ul role="listbox" aria-label={`${label} suggestions`}
          style={{ position: "absolute", left: 0, right: 0, top: "100%", marginTop: 2, zIndex: 30, listStyle: "none", padding: 4, background: "#fff", border: "1px solid var(--ui-line)", borderRadius: 8, boxShadow: "0 6px 20px rgba(0,0,0,.12)" }}>
          {found.map((s, i) => (
            <li key={s} role="option" aria-selected={i === active} onMouseDown={(e) => { e.preventDefault(); commit(s); inputRef.current && inputRef.current.focus(); }}
              onMouseEnter={() => setActive(i)}
              style={{ ...FONT, fontSize: 13, display: "flex", gap: 8, padding: "6px 8px", borderRadius: 6, cursor: "pointer", background: i === active ? "var(--ui-hover, #eef0f4)" : "transparent" }}>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s}</span>
              <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--ui-muted)", alignSelf: "center" }}>{kindOf(s, cats)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// The large box's text mode: the whole list as text, with the faint finish for the word being typed.
function TextMode({ value, onChange, placeholder, label, list }) {
  const [focused, setFocused] = useState(false);
  const ghost = useRef(null);
  const hint = focused ? closest(value, list) : "";
  const { head, word } = wordAt(value);
  const accept = () => onChange(head + hint + ", ");
  const box = { ...FONT, padding: "8px 10px", margin: 0, boxSizing: "border-box", whiteSpace: "pre-wrap", overflowWrap: "anywhere" };
  return (
    <div style={{ position: "relative", background: "#fff", border: "1px solid var(--ui-line)", borderRadius: 8 }}>
      <div ref={ghost} aria-hidden="true" style={{ ...box, position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none", color: "transparent" }}>
        {value}<span style={FAINT}>{hint ? hint.slice(word.length) : ""}</span>
      </div>
      <textarea aria-label={`${label}, as text`} autoFocus rows={16} value={value} placeholder={placeholder} spellCheck={false}
        onChange={(e) => onChange(e.target.value)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        onScroll={(e) => { if (ghost.current) ghost.current.scrollTop = e.target.scrollTop; }}
        onKeyDown={(e) => {
          const atEnd = e.target.selectionStart === value.length && e.target.selectionEnd === value.length;
          if (hint && atEnd && (e.key === "Tab" || e.key === "ArrowRight") && !e.shiftKey) { e.preventDefault(); accept(); }
        }}
        style={{ ...box, position: "relative", display: "block", width: "100%", resize: "vertical", border: "none", outline: "none", background: "transparent", color: "inherit" }} />
    </div>
  );
}

export default function ExclusionBox({ value, onChange, placeholder, label, title }) {
  const [sug, setSug] = useState({ list: [], cats: new Set() });
  const [big, setBig] = useState(false);
  const [asText, setAsText] = useState(false);
  useEffect(() => { let on = true; load().then((s) => on && setSug(s)); return () => { on = false; }; }, []);
  useEffect(() => {
    if (!big) return undefined;
    const onKey = (e) => { if (e.key === "Escape") setBig(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [big]);
  const count = items(value).length;
  const counted = count ? `${count.toLocaleString()} ${count === 1 ? "item" : "items"}` : "Type, then comma or Enter";
  return (
    <>
      <ChipInput value={value} onChange={onChange} placeholder={placeholder} label={label} list={sug.list} cats={sug.cats} />
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
        <span style={{ fontSize: 12, color: "var(--ui-muted)" }}>{counted}</span>
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
              <span style={{ fontSize: 12, color: "var(--ui-muted)" }}>{count.toLocaleString()} {count === 1 ? "item" : "items"}</span>
              <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" style={{ marginLeft: "auto" }} aria-pressed={asText} title="Switch between chips and one block of text, to paste or edit a whole list" onClick={() => setAsText((v) => !v)}>
                {asText ? "Show as chips" : "Edit as text"}
              </button>
              <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" aria-label="Close" onClick={() => setBig(false)}><X size={16} /></button>
            </div>
            <div style={{ overflow: "auto", paddingBottom: 150 }}>
              {asText
                ? <TextMode value={value} onChange={onChange} placeholder={placeholder} label={label} list={sug.list} />
                : <ChipInput value={value} onChange={onChange} placeholder={placeholder} label={label} list={sug.list} cats={sug.cats} tall />}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" disabled={!value} onClick={() => onChange("")}>Clear all</button>
              <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" style={{ marginLeft: "auto" }} onClick={() => setBig(false)}>Done</button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
