import React, { useMemo, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { C, FONT_BODY } from "../../tokens";
import { TpsChip } from "./ListFilterBar";
import { TpsCheckDialog } from "./TpsCheckDialog";
import { allNumbers, numberCounts } from "./phoneNumbers";

const text = { fontFamily: FONT_BODY };
const WHERE = { company: "Company number", research: "Found by research", person: "Person", office: "Other office" };

// Every phone number held for one company, each with its TPS/CTPS result, and one button that checks them all. The button opens the
// cost first; nothing is spent until the person confirms there.
export function PhoneNumbers({ account, onChecked }) {
  const [open, setOpen] = useState(false);
  const nums = useMemo(() => allNumbers(account), [account]);
  const counts = useMemo(() => numberCounts([account]), [account]);
  if (!nums.length) return <div style={{ ...text, fontSize: 13, color: C.slate }}>No phone number is held for this company yet.</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
        {nums.map((n) => (
          <li key={n.key} style={{ ...text, fontSize: 13.5, color: C.textInk, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4 }}>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{n.text}</span>
            <TpsChip screening={n.screening} />
            <span style={{ color: C.slate, fontSize: 12.5 }}>{WHERE[n.kind]}{n.who ? `: ${n.who}` : ""}</span>
          </li>
        ))}
      </ul>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" style={{ minHeight: 36 }} onClick={() => setOpen(true)}
          title="Check every number on this company against the TPS and CTPS registers. You see the cost before anything is spent.">
          <ShieldCheck size={14} aria-hidden="true" /> Check all numbers
        </button>
        <span style={{ ...text, fontSize: 12.5, color: C.slate }}>{counts.checked.toLocaleString()} of {counts.total.toLocaleString()} {counts.total === 1 ? "number" : "numbers"} checked</span>
      </div>
      {open ? <TpsCheckDialog numbers={nums.map((n) => n.text)} wallet="leadgen" title={`Check every number for ${account.name}`} onClose={() => setOpen(false)} onDone={() => onChecked?.()} /> : null}
    </div>
  );
}

export default PhoneNumbers;
