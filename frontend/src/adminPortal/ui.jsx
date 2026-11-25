import React from "react";
import { C, FONT_DISPLAY, FONT_MONO } from "../tokens";
// The plain building blocks the apps use too live in app/ui.jsx; the portal uses the same ones.
import { input, btn, card, cell, th, when, Note, useAction, useLoad } from "../app/ui";

export { input, btn, card, cell, th, when, Note, useAction, useLoad };

export const heading = { fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, color: C.textInk, margin: "22px 0 10px" };
export const mono = { fontFamily: FONT_MONO, fontSize: 11.5 };
export const fmt = (n) => Number(n || 0).toLocaleString();
export const money = (cents, currency) => new Intl.NumberFormat(undefined, { style: "currency", currency: (currency || "usd").toUpperCase() }).format(Number(cents || 0) / 100);

export function PageTitle({ title, sub, right }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
      <div>
        <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 22, margin: 0, color: C.textInk }}>{title}</h1>
        {sub && <div style={{ fontSize: 13, color: C.slate, marginTop: 4 }}>{sub}</div>}
      </div>
      {right}
    </div>
  );
}

export function Table({ head, children, minWidth = 640 }) {
  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, background: "#fff", overflowX: "auto", overflowY: "hidden" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth }}>
        <thead><tr>{head.map((h, i) => <th key={i} style={th}>{h}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

// The shared label (app/ui.jsx), so the apps and the portal look the same.
export { Pill } from "../app/ui";

export function AivhubToggle({ value, onChange }) {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "#fff", border: `1px solid ${C.border}`, borderRadius: 10, padding: "5px 10px", userSelect: "none" }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: value ? C.textInk : C.slate }}>
        Include Aivhub (own company)
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        style={{
          width: 34,
          height: 18,
          borderRadius: 99,
          border: "none",
          background: value ? C.cobalt : C.border,
          position: "relative",
          cursor: "pointer",
          transition: "background 0.2s",
          padding: 0,
        }}
      >
        <span
          style={{
            display: "block",
            width: 14,
            height: 14,
            borderRadius: "50%",
            background: "#fff",
            position: "absolute",
            top: 2,
            left: value ? 18 : 2,
            transition: "left 0.2s",
            boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
          }}
        />
      </button>
    </div>
  );
}

