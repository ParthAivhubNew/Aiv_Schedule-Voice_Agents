import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CardsSkeleton } from "../../app/Loader";
import { api } from "../../api/apiClient";
import { C, FONT_BODY } from "../../tokens";
import { askConfirm } from "./Dialogs";
import { deleteResult, deleteSummary, toggleAll, toggleOne } from "./retentionLogic";

// Companies nobody has contacted for 12 months (or that were added 12 months ago and never contacted) wait here to be kept or deleted.
// Deleting removes the company and its people. The do-not-email list is separate and is never touched.

const text = { fontFamily: FONT_BODY };
const muted = { ...text, fontSize: 13, color: C.slate, lineHeight: 1.5 };

export function RetentionReview({ toast, onGo }) {
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      setData(await api.retentionList());
      setSelected(new Set());
    } catch (e) {
      setData({ total: 0, accounts: [] });
      toast?.(e.message || "Couldn't load this list.");
    }
  }, [toast]);
  useEffect(() => { load(); }, [load]);
  const ids = useMemo(() => (data ? data.accounts.map((a) => a.id) : []), [data]);

  if (data === null) return <CardsSkeleton count={3} label="Loading the review list" />;

  const remove = async () => {
    const n = selected.size;
    if (!n) return;
    const ok = await askConfirm({
      title: `Delete ${n.toLocaleString()} ${n === 1 ? "company" : "companies"}?`,
      body: "They and their people are removed from your account. Their do-not-email entries are kept, so nobody on that list is ever written to again.",
      confirm: deleteSummary(n), danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      toast?.(deleteResult(await api.retentionDelete([...selected])));
      await load();
    } catch (e) {
      toast?.(e.message || "Couldn't delete them. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "grid", gap: 14, maxWidth: 900 }}>
      <div style={muted}>
        These companies were last contacted over 12 months ago, or were added then and never contacted. Keep only what you still have a reason to hold.
        Their do-not-email entries are kept.
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <label style={{ ...text, fontSize: 13, display: "inline-flex", gap: 8, alignItems: "center", minHeight: 40, cursor: "pointer" }}>
          <input type="checkbox" disabled={!ids.length} checked={ids.length > 0 && selected.size === ids.length} onChange={() => setSelected(toggleAll(ids, selected))} />
          Select all {data.total > ids.length ? `${ids.length.toLocaleString()} shown` : ids.length.toLocaleString()}
        </label>
        <button type="button" className="ui-btn ui-btn--danger ui-btn--sm" style={{ minHeight: 40 }} disabled={busy || !selected.size} onClick={remove}>{busy ? "Deleting…" : deleteSummary(selected.size)}</button>
        {onGo ? <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" style={{ minHeight: 40 }} onClick={() => onGo("lists")}>Back to Lists</button> : null}
      </div>
      {!ids.length ? <div style={{ ...muted, padding: "16px 0" }}>Nothing to review. Every saved company has been contacted or added within the last 12 months.</div> : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
          {data.accounts.map((a) => (
            <li key={a.id} style={{ border: `1px solid ${C.border}`, borderRadius: 8, background: "#fff" }}>
              <label style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 12px", minHeight: 40, cursor: "pointer" }}>
                <input type="checkbox" checked={selected.has(a.id)} onChange={() => setSelected(toggleOne(selected, a.id))} style={{ marginTop: 3 }} />
                <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>
                  <span style={{ ...text, fontSize: 13.5, fontWeight: 600, color: C.ink }}>{a.name}</span>
                  {a.email ? <span style={{ ...muted, display: "block" }}>{a.email}</span> : null}
                  <span style={{ ...muted, display: "block" }}>{a.reason}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
