import React, { useEffect, useState } from "react";
import { C } from "../tokens";
import { adminApi } from "./adminApi";
import { btn, mono, when } from "./ui";

const SHOWN = 3;

// One row per kind of alert (code, company and wording), newest first: a restart that re-ran the config check, or older alerts saved
// before the server counted repeats, show once with how many times and since when (plan 13). Each row keeps the ids it stands for.
export function groupAlerts(items) {
  const groups = new Map();
  for (const a of items) {
    const key = `${a.code}|${a.org}|${a.detail}|${a.ref || ""}`;
    const g = groups.get(key);
    const n = Number(a.count) || 1;
    const first = a.first_at || a.at;
    if (!g) groups.set(key, { ...a, ids: [a.id], count: n, first_at: first });
    else {
      g.ids.push(a.id);
      g.count += n;
      if (first < g.first_at) g.first_at = first;
      if (a.at > g.at) g.at = a.at;
    }
  }
  return [...groups.values()].sort((x, y) => (x.at < y.at ? 1 : -1));
}

// Problems only staff can fix: AI (our key or provider account, a model that is gone, unknown
// errors with the reference the customer was given) and billing (BILL-01: a month's call
// minutes and Telnyx's disagree). Also emailed to STAFF_ADMIN_EMAIL.
export function AlertsBanner({ go }) {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const load = () => adminApi.alerts().then((r) => setItems(groupAlerts((r.items || []).filter((a) => !a.seen))), () => {});
  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);
  if (!items.length) return null;
  const seen = async (ids) => {
    await Promise.all([].concat(ids).map((id) => adminApi.alertSeen(id).catch(() => {})));
    load();
  };
  const urgent = items.some((a) => a.level === "urgent");
  const list = open ? items : items.slice(0, SHOWN);
  return (
    <div role="alert" style={{ border: `1px solid ${urgent ? C.red : C.amber}`, background: urgent ? C.redSoft : C.amberSoft,
      borderRadius: 12, padding: "10px 14px", marginBottom: 16, display: "grid", gap: 8 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "space-between" }}>
        <strong style={{ color: urgent ? C.red : C.textInk, fontSize: 13.5 }}>
          {urgent ? "Urgent: " : ""}{items.length} alert{items.length === 1 ? "" : "s"} need a look
        </strong>
        <span style={{ display: "flex", gap: 6 }}>
          {items.some((a) => a.code.startsWith("AI")) && <button type="button" style={btn(false)} onClick={() => go("ai")}>Platform AI</button>}
          {items.some((a) => a.code.startsWith("BILL")) && <button type="button" style={btn(false)} onClick={() => go("billing")}>Telnyx costs</button>}
          <button type="button" style={btn(false)} onClick={() => seen("all")}>Dismiss all</button>
        </span>
      </div>
      {list.map((a) => (
        <div key={a.ids[0]} style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 12.5, flexWrap: "wrap" }}>
          <span style={{ ...mono, fontWeight: 700, color: a.level === "urgent" ? C.red : C.textInk }}>{a.code}</span>
          <span style={{ flex: "1 1 320px", minWidth: 0, overflowWrap: "anywhere" }}>
            <b>{a.org}</b> · {a.count > 1 ? `${a.count} times, since ${when(a.first_at)}, last ${when(a.at)}` : when(a.at)}{a.ref ? <> · <span style={mono}>{a.ref}</span></> : null}
            <div style={{ color: C.slate }}>{a.detail}</div>
          </span>
          <button type="button" style={btn(false)} onClick={() => seen(a.ids)}>Dismiss</button>
        </div>
      ))}
      {items.length > SHOWN && (
        <button type="button" style={{ ...btn(false), justifySelf: "start" }} onClick={() => setOpen(!open)}>
          {open ? "Show fewer" : `Show all ${items.length}`}
        </button>
      )}
    </div>
  );
}
