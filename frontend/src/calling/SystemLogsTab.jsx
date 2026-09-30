import React, { useCallback, useEffect, useState } from "react";
import { RefreshCw, ChevronDown, ChevronRight } from "lucide-react";
import { C, FONT_BODY, FONT_MONO } from "../tokens";
import { api } from "../api/apiClient";

const SUBSYSTEMS = [
  ["all", "Everything"],
  ["telephony", "Phone lines"],
  ["voice", "Voice & calls"],
  ["calendar", "Calendar & bookings"],
  ["scheduler", "Scheduler"],
  ["crawler_rag", "Knowledge & crawling"],
  ["system", "System & keys"],
  ["auth", "Sign-in"],
];
const LEVELS = ["ALL", "ERROR", "WARN", "SUCCESS", "INFO"];
const LEVEL_STYLE = {
  ERROR: { bg: C.redSoft, fg: C.red },
  WARN: { bg: C.amberSoft, fg: C.amber },
  SUCCESS: { bg: C.greenSoft, fg: C.green },
  INFO: { bg: C.paperSoft, fg: C.slate },
};

// Technical activity log (calls, providers, background jobs). Admin-only unless shared.
export function SystemLogsTab() {
  const [subsystem, setSubsystem] = useState("all");
  const [level, setLevel] = useState("ALL");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = { limit: 200 };
      if (subsystem !== "all") params.subsystem = subsystem;
      if (level !== "ALL") params.level = level;
      if (search.trim()) params.search = search.trim();
      setRows(await api.getProcessLogs(params));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [subsystem, level, search]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const select = { padding: "7px 10px", borderRadius: 8, border: `1px solid ${C.border}`, background: "#fff", fontSize: 12.5, fontFamily: FONT_BODY };

  return (
    <div style={{ fontFamily: FONT_BODY }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <select value={subsystem} onChange={(e) => setSubsystem(e.target.value)} style={select} aria-label="Area">
          {SUBSYSTEMS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select value={level} onChange={(e) => setLevel(e.target.value)} style={select} aria-label="Level">
          {LEVELS.map((l) => <option key={l} value={l}>{l === "ALL" ? "All levels" : l}</option>)}
        </select>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search messages" style={{ ...select, flex: 1, minWidth: 180 }} />
        <button type="button" onClick={load} style={{ ...select, display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", fontWeight: 600 }}>
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>
      {error && <div style={{ color: C.red, fontSize: 13, marginBottom: 10 }}>{error}</div>}
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, background: "#fff", overflow: "hidden" }}>
        {rows.length === 0 && <div style={{ padding: 18, fontSize: 13, color: C.slate }}>{loading ? "Loading…" : "Nothing logged for this filter."}</div>}
        {rows.map((r, i) => {
          const st = LEVEL_STYLE[r.level] || LEVEL_STYLE.INFO;
          const expanded = open === r.id;
          return (
            <div key={r.id} style={{ borderTop: i ? `1px solid ${C.borderLight}` : "none" }}>
              <button type="button" onClick={() => setOpen(expanded ? null : r.id)} style={{ width: "100%", display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 12px", background: "none", border: "none", textAlign: "left", cursor: "pointer", fontFamily: FONT_BODY }}>
                {expanded ? <ChevronDown size={14} color={C.slate} /> : <ChevronRight size={14} color={C.slate} />}
                <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 6px", borderRadius: 5, background: st.bg, color: st.fg, flexShrink: 0 }}>{r.level}</span>
                <span style={{ fontSize: 12, color: C.slate, flexShrink: 0, fontFamily: FONT_MONO }}>{String(r.createdAt || "").replace("T", " ").slice(0, 19)}</span>
                <span style={{ fontSize: 13, color: C.textInk, flex: 1 }}>{r.message}</span>
                <span style={{ fontSize: 11.5, color: C.slateLight, flexShrink: 0 }}>{r.subsystem}</span>
              </button>
              {expanded && (
                <pre style={{ margin: 0, padding: "0 14px 12px 36px", fontSize: 11.5, fontFamily: FONT_MONO, whiteSpace: "pre-wrap", wordBreak: "break-word", color: C.textInk }}>
                  {JSON.stringify({ process: r.processName, durationMs: r.durationMs, ...(r.details || {}) }, null, 2)}
                </pre>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
