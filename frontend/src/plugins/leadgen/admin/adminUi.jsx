import React from "react";
import { Eye, EyeOff, Pencil, Trash2 } from "lucide-react";
import { C, FONT_BODY } from "../../../tokens";
import { roleTone, toggleLabel } from "./adminLogic";

export const text = { fontFamily: FONT_BODY };
export const muted = { ...text, fontSize: 13, color: C.slate, lineHeight: 1.5 };
export const field = { minHeight: 44, padding: "0 10px", border: `1px solid ${C.border}`, borderRadius: 8, fontFamily: FONT_BODY, fontSize: 14, background: "#fff", maxWidth: "100%", boxSizing: "border-box", color: C.textInk };
export const card = { border: `1px solid ${C.border}`, borderRadius: 12, background: "#fff", minWidth: 0 };

// Table-to-cards switch, drawer and shared bits. One style block for the whole screen.
export const ADMIN_CSS = `
.adm-table { width: 100%; border-collapse: collapse; }
.adm-table th { text-align: left; font: 600 11px/1 'Inter', sans-serif; letter-spacing: 0.05em; text-transform: uppercase; color: ${C.slate}; padding: 0; background: ${C.paper}; border-bottom: 1px solid ${C.border}; }
.adm-table th > button, .adm-table th > span { display: inline-flex; align-items: center; gap: 4px; min-height: 44px; padding: 0 12px; background: none; border: 0; font: inherit; letter-spacing: inherit; text-transform: inherit; color: inherit; cursor: pointer; }
.adm-table td { padding: 8px 12px; border-bottom: 1px solid ${C.borderLight}; font: 400 13px/1.4 'Inter', sans-serif; color: ${C.textInk}; vertical-align: middle; }
.adm-table tr:last-child td { border-bottom: 0; }
.adm-actions { display: flex; gap: 4px; }
.adm-icon { display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px; border: 0; background: transparent; border-radius: 8px; cursor: pointer; color: ${C.slate}; }
.adm-icon:hover:not(:disabled) { background: ${C.paperSoft}; color: ${C.textInk}; }
.adm-icon:disabled { opacity: 0.4; cursor: not-allowed; }
.adm-icon--off, .adm-icon--off:hover:not(:disabled) { background: ${C.amberSoft}; color: ${C.amber}; }
.adm-icon--on, .adm-icon--on:hover:not(:disabled) { background: ${C.greenSoft}; color: ${C.green}; }
.adm-icon--edit, .adm-icon--edit:hover:not(:disabled) { background: ${C.paperSoft}; color: ${C.textInk}; }
.adm-icon--del, .adm-icon--del:hover:not(:disabled) { background: ${C.redSoft}; color: ${C.red}; }
.adm-row-off td:not([data-label="Actions"]) { opacity: 0.65; }
.adm-roleitem-off .adm-roleitem-main { opacity: 0.65; }
.adm-namebtn { background: none; border: 0; padding: 0; min-height: 44px; font: 600 13px 'Inter', sans-serif; color: ${C.textInk}; text-align: left; cursor: pointer; overflow-wrap: anywhere; text-decoration: underline; text-decoration-color: transparent; }
.adm-namebtn:hover { text-decoration-color: currentColor; }
.adm-namebtn:focus-visible { outline: 2px solid ${C.cobalt}; outline-offset: 2px; border-radius: 4px; }
.adm-rolecard { border-bottom: 1px solid ${C.borderLight}; }
.adm-rolecard .adm-roleitem { border-bottom: 0; }
.adm-rolecard .adm-actions { padding: 0 10px 8px; }
.adm-icon:focus-visible, .adm-tab:focus-visible, .adm-chip:focus-visible, .adm-roleitem:focus-visible { outline: 2px solid ${C.cobalt}; outline-offset: 2px; }
.adm-tabs { display: flex; gap: 4px; overflow-x: auto; border-bottom: 1px solid ${C.border}; }
.adm-tab { display: inline-flex; align-items: center; gap: 6px; min-height: 44px; padding: 0 14px; background: none; border: 0; border-bottom: 2px solid transparent; font: 500 13px 'Inter', sans-serif; color: ${C.slate}; cursor: pointer; white-space: nowrap; }
.adm-tab[aria-selected="true"] { color: ${C.textInk}; border-bottom-color: ${C.cobalt}; font-weight: 600; }
.adm-chips { display: flex; gap: 8px; flex-wrap: wrap; }
.adm-chip { min-height: 44px; padding: 0 12px; border-radius: 999px; border: 1px solid ${C.border}; background: #fff; font: 500 12.5px 'Inter', sans-serif; color: ${C.textInk}; cursor: pointer; }
.adm-chip[aria-pressed="true"] { background: ${C.cobaltSoft}; border-color: ${C.cobalt}; color: ${C.cobaltDeep}; font-weight: 600; }
.adm-split { display: grid; grid-template-columns: 280px minmax(0, 1fr); gap: 16px; align-items: start; }
.adm-roleitem { display: block; width: 100%; text-align: left; padding: 10px 14px; min-height: 44px; border: 0; border-bottom: 1px solid ${C.borderLight}; background: #fff; cursor: pointer; font-family: 'Inter', sans-serif; }
.adm-roleitem[aria-current="true"] { background: ${C.cobaltSoft}; }
.adm-seg { display: inline-flex; border: 1px solid ${C.border}; border-radius: 8px; overflow: hidden; }
.adm-seg button { min-height: 44px; min-width: 52px; padding: 0 10px; border: 0; background: #fff; font: 500 12.5px 'Inter', sans-serif; color: ${C.slate}; cursor: pointer; }
.adm-seg button + button { border-left: 1px solid ${C.border}; }
.adm-seg button[aria-checked="true"] { background: ${C.cobaltSoft}; color: ${C.cobaltDeep}; font-weight: 700; }
.adm-seg button:disabled { cursor: not-allowed; opacity: 0.6; }
.adm-seg button:focus-visible { outline: 2px solid ${C.cobalt}; outline-offset: -2px; }
.adm-drawer-back { position: fixed; inset: 0; background: rgba(18,20,28,0.45); z-index: 200; display: flex; justify-content: flex-end; }
.adm-drawer { background: #fff; width: min(440px, 100%); height: 100%; overflow-y: auto; padding: 18px 16px; box-sizing: border-box; display: grid; gap: 14px; align-content: start; }
@media (max-width: 760px) {
  .adm-split { grid-template-columns: minmax(0, 1fr); }
  .adm-table thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  .adm-table, .adm-table tbody, .adm-table tr, .adm-table td { display: block; width: 100%; box-sizing: border-box; }
  .adm-table tr { padding: 10px 12px; border-bottom: 1px solid ${C.borderLight}; }
  .adm-table td { border: 0; padding: 3px 0; display: flex; gap: 8px; justify-content: space-between; align-items: center; }
  .adm-table td[data-label]::before { content: attr(data-label); font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: ${C.slate}; }
}
`;

export function RoleChip({ role }) {
  const t = roleTone(role);
  return <span style={{ ...text, display: "inline-block", fontSize: 11.5, fontWeight: 600, padding: "3px 9px", borderRadius: 6, background: t.bg, color: t.fg, whiteSpace: "nowrap" }}>{role.name}</span>;
}

export function StatusChip({ status }) {
  const on = status === "active";
  return <span style={{ ...text, display: "inline-block", fontSize: 11.5, fontWeight: 600, padding: "3px 9px", borderRadius: 6, background: on ? C.greenSoft : C.paperSoft, color: on ? C.green : C.slate }}>{status}</span>;
}

// A message the screen reader announces, and a problem it announces at once.
export function Live({ message, error }) {
  return (
    <>
      <div role="status" aria-live="polite" style={{ ...muted, color: C.textInk, minHeight: message ? 20 : 0 }}>{message || ""}</div>
      {error ? <div role="alert" style={{ ...text, fontSize: 13.5, color: C.red }}>{error}</div> : null}
    </>
  );
}

export function PageHead({ title, sub, action }) {
  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
      <div style={{ minWidth: 0 }}>
        <h2 style={{ ...text, margin: 0, fontSize: 20, color: C.textInk }}>{title}</h2>
        <p style={{ ...muted, margin: "2px 0 0" }}>{sub}</p>
      </div>
      {action}
    </div>
  );
}

export function InactiveChip() {
  return <span style={{ ...text, display: "inline-block", fontSize: 11.5, fontWeight: 600, padding: "3px 9px", borderRadius: 6, background: C.paperSoft, color: C.slate, border: `1px solid ${C.border}`, whiteSpace: "nowrap" }}>Inactive</span>;
}

// The three icon buttons on every role card and user row: switch off or on, edit, delete.
// A reason string in toggleOff or deleteOff disables that button and becomes its title.
export function ItemActions({ name, active, onToggle, onEdit, onDelete, toggleOff = "", deleteOff = "" }) {
  const label = toggleLabel(name, active);
  return (
    <span className="adm-actions">
      <button type="button" className={`adm-icon ${active ? "adm-icon--off" : "adm-icon--on"}`} aria-label={label} title={toggleOff || label} disabled={!!toggleOff} onClick={onToggle}>
        {active ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
      </button>
      <button type="button" className="adm-icon adm-icon--edit" aria-label={`Edit ${name}`} title={`Edit ${name}`} onClick={onEdit}><Pencil size={16} aria-hidden="true" /></button>
      <button type="button" className="adm-icon adm-icon--del" aria-label={`Delete ${name}`} title={deleteOff || `Delete ${name}`} disabled={!!deleteOff} onClick={onDelete}><Trash2 size={16} aria-hidden="true" /></button>
    </span>
  );
}
