import { useEffect, useState } from "react";

// On a phone the table's ten columns would scroll sideways, so each company is a card instead: who it is, where, and how to reach it.
export function useNarrow(query = "(max-width: 820px)") {
  const read = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches;
  const [on, setOn] = useState(read);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const m = window.matchMedia(query);
    const h = () => setOn(m.matches);
    h();
    m.addEventListener("change", h);
    return () => m.removeEventListener("change", h);
  }, [query]);
  return on;
}

export const CARDS_CSS = `
.fl-cards{display:grid;gap:8px;padding:10px 12px 14px;transition:opacity .15s}
.fl-cards-group{margin:6px -12px 0;padding:8px 12px;font:600 12.5px Inter,sans-serif}
.fl-co{display:grid;grid-template-columns:44px minmax(0,1fr);align-items:start;background:var(--ui-surface,#fff);border:1px solid var(--ui-line,#E3E6EB);border-radius:10px;cursor:pointer}
.fl-co[data-on="true"]{background:#F6F8FE;border-color:var(--ui-accent,#3457D5)}
.fl-co[data-active="true"]{background:var(--ui-accent-soft,#EEF2FE)}
.fl-co .row-tick{min-height:48px;min-width:44px}
.fl-co-body{display:grid;gap:6px;padding:10px 12px 12px 0;min-width:0}
.fl-co-top{display:flex;align-items:center;gap:10px;min-width:0}
.fl-co-name{all:unset;cursor:pointer;display:block;min-width:0;font:600 14px Inter,sans-serif;color:var(--ui-ink,#111827);overflow-wrap:anywhere;border-radius:4px}
.fl-co-name:focus-visible{outline:2px solid var(--ui-accent,#3457D5);outline-offset:2px}
.fl-co-sub{font:12px Inter,sans-serif;color:var(--ui-muted,#6B7280)}
.fl-co-meta{font:13px Inter,sans-serif;color:var(--ui-ink-2,#374151);overflow-wrap:anywhere}
.fl-co-reach{display:flex;flex-wrap:wrap;gap:4px 14px;align-items:center;font:13px Inter,sans-serif}
`;
