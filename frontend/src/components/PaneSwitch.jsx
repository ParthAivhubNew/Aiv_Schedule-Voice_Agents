import React from "react";

// Phones show one pane of a busy screen at a time instead of stacking them into a long page.
// The screen's root gets className="pane-root" and data-active={current pane}; each pane inside it
// carries data-pane="<id>". global.css hides the other panes on a touch phone; wider screens show all.
// panes: [{ id, label, badge }]. Hidden on wider screens.
export function PaneSwitch({ panes, value, onChange }) {
  return (
    <div className="pane-switch" role="tablist">
      {panes.map((p) => (
        <button key={p.id} type="button" role="tab" aria-selected={value === p.id} onClick={() => onChange(p.id)}>
          {p.label}
          {p.badge ? <span className="pane-badge">{p.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}
