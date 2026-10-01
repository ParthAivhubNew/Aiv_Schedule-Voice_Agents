import React from "react";
import { C, FONT_BODY, FONT_DISPLAY, FONT_MONO } from "../tokens";

export const input = { padding: "8px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13, fontFamily: FONT_BODY, background: "#fff", boxSizing: "border-box" };
export const btn = (primary, disabled) => ({
  display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 13px", borderRadius: 9, cursor: disabled ? "not-allowed" : "pointer",
  border: primary ? "none" : `1px solid ${C.border}`, background: primary ? C.ink : "#fff", color: primary ? "#fff" : C.textInk,
  fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, opacity: disabled ? 0.55 : 1, whiteSpace: "nowrap",
});
export const heading = { fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, color: C.textInk, margin: "22px 0 10px" };
export const card = { background: "#fff", border: `1px solid ${C.border}`, borderRadius: 14, padding: 16 };
export const cell = { padding: "8px 12px", borderTop: `1px solid ${C.border}`, fontSize: 12.5, textAlign: "left", verticalAlign: "middle" };
export const th = { padding: "8px 12px", fontSize: 11, color: C.slate, fontWeight: 700, textTransform: "uppercase", textAlign: "left", letterSpacing: "0.03em" };
export const mono = { fontFamily: FONT_MONO, fontSize: 11.5 };
export const fmt = (n) => Number(n || 0).toLocaleString();
export const money = (cents, currency) => new Intl.NumberFormat(undefined, { style: "currency", currency: (currency || "usd").toUpperCase() }).format(Number(cents || 0) / 100);
export const when = (iso) => (iso ? new Date(iso + (/[Z+]/.test(iso.slice(19)) ? "" : "Z")).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—");

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
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, background: "#fff", overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth }}>
        <thead><tr>{head.map((h, i) => <th key={i} style={th}>{h}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Pill({ tone = "slate", children }) {
  const tones = {
    green: [C.green, C.greenSoft], red: [C.red, C.redSoft], amber: [C.amber, C.amberSoft],
    blue: [C.cobalt, C.cobaltSoft], slate: [C.slate, C.paperSoft],
  };
  const [fg, bg] = tones[tone] || tones.slate;
  return <span style={{ display: "inline-block", fontSize: 11.5, fontWeight: 600, color: fg, background: bg, padding: "2px 9px", borderRadius: 99 }}>{children}</span>;
}

export function Note({ error, children }) {
  if (!children) return null;
  return (
    <div role={error ? "alert" : "status"} style={{ fontSize: 12.5, color: error ? C.red : C.teal, background: error ? C.redSoft : C.tealSoft, padding: "7px 11px", borderRadius: 9, margin: "8px 0" }}>
      {children}
    </div>
  );
}

// Runs an action, then shows what happened. Returns [message, isError, run].
export function useAction(after) {
  const [msg, setMsg] = React.useState({ text: "", error: false });
  const run = React.useCallback(async (fn, ok) => {
    setMsg({ text: "", error: false });
    try {
      const out = await fn();
      setMsg({ text: ok || "", error: false });
      if (after) await after();
      return out;
    } catch (err) {
      setMsg({ text: err.message, error: true });
      return undefined;
    }
  }, [after]);
  return [msg, run];
}

// Loads data once (and again on reload()).
export function useLoad(fn, deps = []) {
  const [state, setState] = React.useState({ data: null, error: "" });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const load = React.useCallback(() => fn().then((data) => setState({ data, error: "" }), (err) => setState((s) => ({ ...s, error: err.message }))), deps);
  React.useEffect(() => { load(); }, [load]);
  return [state.data, state.error, load];
}
