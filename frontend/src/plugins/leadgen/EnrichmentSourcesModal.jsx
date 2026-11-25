import React, { useEffect, useState } from "react";
import { ShieldCheck, X } from "lucide-react";
import { api } from "../../api/apiClient";
import { C, FONT_BODY, FONT_DISPLAY } from "../../tokens";
import { Logo, StatusPill } from "./ConnectorsView";
import { byGroup, countLine, kindLabels } from "./connectorsLogic";

// "Where your data comes from" on Lists: the sources that are switched on for the account, read from the server (GET /leadgen/connectors,
// the same list as the Connectors screen). Nothing here is made up: no speeds, no record counts the server didn't send.

const text = { fontFamily: FONT_BODY };
const head = { fontFamily: FONT_DISPLAY };
const SHOWN = new Set(["connected", "paused", "error"]);

export function EnrichmentSourcesModal({ open, onClose, initialData = null }) {
  const [data, setData] = useState(initialData);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open || data) return undefined;
    let alive = true;
    api.getConnectors()
      .then((res) => alive && setData(res))
      .catch((err) => alive && setError(err?.message || "The sources couldn't be loaded. Try again later."));
    return () => {
      alive = false;
    };
  }, [open, data]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;

  const live = (data?.connectors || []).filter((c) => SHOWN.has(c.status) && c.group !== "yours");
  const groups = byGroup(live, data?.groups);
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="enrichment-modal-title" onClick={onClose}
      style={{ position: "fixed", inset: 0, backgroundColor: "rgba(15, 23, 42, 0.55)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div className="ui-card" onClick={(e) => e.stopPropagation()}
        style={{ ...text, width: "100%", maxWidth: 760, maxHeight: "90vh", display: "flex", flexDirection: "column", background: "#FFFFFF", borderRadius: 14, overflow: "hidden", border: `1px solid ${C.border}` }}>
        <div style={{ padding: "18px 22px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, background: "#F8FAFC" }}>
          <div>
            <h2 id="enrichment-modal-title" style={{ ...head, margin: 0, fontSize: 18, color: C.ink }}>Where your data comes from</h2>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: C.slate }}>The sources switched on for your account. Values from Google or enrichment data can be used here but not downloaded.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="ui-btn ui-btn--ghost ui-btn--sm" style={{ minHeight: 36 }}><X size={16} /></button>
        </div>
        <div style={{ padding: "16px 22px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 16 }}>
          {error ? <div role="alert" style={{ fontSize: 13, color: "#991B1B" }}>{error}</div> : null}
          {!data && !error ? <div role="status" style={{ fontSize: 13, color: C.slate }}>Loading…</div> : null}
          {data && !groups.length ? <div style={{ fontSize: 13, color: C.slate }}>No source is switched on for your account yet.</div> : null}
          {groups.map((g) => (
            <section key={g.id} aria-label={g.label}>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: C.slate, marginBottom: 8 }}>{g.label}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {g.items.map((c) => {
                  const counts = countLine(c);
                  const gives = kindLabels(c, data?.kinds);
                  return (
                    <div key={c.id} style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "10px 12px", border: `1px solid ${C.border}`, borderRadius: 8 }}>
                      <Logo name={c.logo} size={28} />
                      <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <span style={{ ...head, fontSize: 13.5, fontWeight: 600, color: C.ink }}>{c.name}</span>
                          <StatusPill c={c} />
                        </div>
                        <div style={{ fontSize: 12.5, color: C.textInk, lineHeight: 1.45 }}>{c.desc}</div>
                        {counts || gives.length ? <div style={{ fontSize: 11.5, color: C.slate }}>{[gives.join(", "), counts].filter(Boolean).join(" · ")}</div> : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

// Compact banner shown on Import and Lists.
export function EnrichmentBanner({ onOpenModal }) {
  return (
    <div style={{ ...text, background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 10, padding: "12px 16px", display: "flex", alignItems: "center",
      justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
      <div>
        <div style={{ ...head, fontSize: 13.5, fontWeight: 700, color: "#14532D" }}>Where your data comes from</div>
        <div style={{ fontSize: 12, color: "#166534", marginTop: 2 }}>
          Companies are matched to the official registers. Phones, e-mails and websites come from the sources switched on for your account.
        </div>
      </div>
      <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={onOpenModal}
        style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, minHeight: 34 }}>
        <ShieldCheck size={14} aria-hidden="true" /> See the sources
      </button>
    </div>
  );
}
