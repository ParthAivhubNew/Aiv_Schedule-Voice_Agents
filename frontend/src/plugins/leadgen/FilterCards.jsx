import React from "react";
import { C, FONT_BODY } from "../../tokens";

// Filters that always get a card, in this order. Any other filter gets one only while a company matches it.
export const PINNED_FILTERS = ["all", "ready", "fixes", "attention", "new", "noemail", "flagged", "h_never"];

const TONES = {
  all: "var(--ui-accent)",
  ready: "#16A34A",
  fixes: "#D97706",
  attention: C.redSolid,
  new: "#2563EB",
  noemail: C.slate,
  flagged: "#EA580C",
  h_never: C.slateLight,
  h_no_answer: C.slateLight,
  h_interested: "#16A34A",
  h_recent: "#2563EB",
  h_warm: "#EA580C",
  v_verified: "#16A34A",
  v_looks_ok: "#16A34A",
  v_problem: C.redSolid,
  v_mismatch: "#EA580C",
  v_not_found: C.slate,
  v_unclear: "#D97706",
};

// filters: [[id, label, predicate, tip], ...]. Returns the cards to show, pinned ones first.
export function buildFilterCards(items, filters) {
  const cards = filters.map(([id, label, pred, tip]) => ({ id, label, tip: tip || "", tone: TONES[id] || C.slate, count: items.filter(pred).length }));
  const pinned = PINNED_FILTERS.map((id) => cards.find((c) => c.id === id)).filter(Boolean);
  const rest = cards.filter((c) => !PINNED_FILTERS.includes(c.id) && c.count > 0);
  return [...pinned, ...rest];
}

const css = `
.fc-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
.fc-card {
  position: relative; display: flex; flex-direction: column; justify-content: center; gap: 4px; min-width: 0; min-height: 72px;
  padding: 10px 12px 10px 16px; text-align: left; cursor: pointer; font-family: ${FONT_BODY};
  background: var(--ui-surface); border: 1px solid var(--ui-line); border-radius: var(--ui-r); box-shadow: var(--ui-shadow);
  transition: transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease, background 120ms ease;
}
.fc-card::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; border-radius: var(--ui-r) 0 0 var(--ui-r); background: var(--fc-tone); }
.fc-card:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08); border-color: var(--ui-line-strong); }
.fc-card:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 2px; }
.fc-card[aria-pressed="true"] { background: color-mix(in srgb, var(--fc-tone) 8%, var(--ui-surface)); border-color: var(--fc-tone); }
.fc-label {
  font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--ui-muted); line-height: 1.3;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere;
}
.fc-card[aria-pressed="true"] .fc-label { color: var(--ui-ink-2); }
.fc-count { font-size: 22px; font-weight: 600; line-height: 1.1; color: var(--ui-ink); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
@media (max-width: 480px) {
  .fc-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .fc-count { font-size: 20px; }
}
@media (pointer: coarse) { .fc-card { min-height: 64px; } }
@media (prefers-reduced-motion: reduce) { .fc-card { transition: none; } .fc-card:hover { transform: none; } }
`;

// One row of clickable count cards. Clicking the active card again goes back to All.
export function FilterCards({ cards, active, onPick }) {
  return (
    <div className="fc-grid" role="group" aria-label="Filter companies">
      <style>{css}</style>
      {cards.map((c) => (
        <button key={c.id} type="button" className="fc-card" title={c.tip} aria-pressed={active === c.id}
          style={{ "--fc-tone": c.tone }} onClick={() => onPick(active === c.id && c.id !== "all" ? "all" : c.id)}>
          <span className="fc-label">{c.label}</span>
          <span className="fc-count">{c.count.toLocaleString()}</span>
        </button>
      ))}
    </div>
  );
}
