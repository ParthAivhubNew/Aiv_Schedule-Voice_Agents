import React, { useMemo, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { C } from "../../../tokens";
import { TpsCheckDialog } from "../../leadgen/TpsCheckDialog";
import { tpsByKey, tpsKey } from "../../leadgen/tpsCheck";

// Adds the TPS and CTPS answer to each row of the call list, matched by number.
export function applyTps(rows, answers, phoneOf) {
  const by = tpsByKey(answers);
  return rows.map((r) => {
    const hit = by.get(tpsKey(phoneOf(r)));
    return hit ? { ...r, tps: hit } : r;
  });
}

export function TpsCheckBar({ rows, setRows, selectedIds, phoneOf, showToast }) {
  const [open, setOpen] = useState(false);
  const withPhone = useMemo(() => rows.filter((r) => tpsKey(phoneOf(r))), [rows, phoneOf]);
  const picked = useMemo(() => withPhone.filter((r) => selectedIds.has(r.id)), [withPhone, selectedIds]);
  const target = picked.length ? picked : withPhone;
  const numbers = useMemo(() => target.map((r) => phoneOf(r)), [target, phoneOf]);
  const unscreened = withPhone.filter((r) => !r.tps).length;
  if (!rows.length) return null;
  return (
    <div style={{ flexShrink: 0, borderBottom: `1px solid ${C.borderLight}`, padding: "8px 12px 8px 16px", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" disabled={!withPhone.length} onClick={() => setOpen(true)}
        title="Check these numbers against the TPS and CTPS registers before you call">
        <ShieldCheck size={15} /> {picked.length ? `Check TPS/CTPS (${picked.length})` : `Check TPS/CTPS (${withPhone.length})`}
      </button>
      <span style={{ fontSize: 12.5, color: C.slate }}>{unscreened ? `${unscreened.toLocaleString()} not screened yet` : "All screened"}</span>
      {open ? (
        <TpsCheckDialog numbers={numbers} wallet="voice" onClose={() => setOpen(false)}
          onDone={(answers) => { setRows((prev) => applyTps(prev, answers, phoneOf)); showToast("TPS and CTPS results added to the list"); }} />
      ) : null}
    </div>
  );
}
