import React, { useState } from "react";
import { C } from "../tokens";
import { adminApi } from "./adminApi";
import { Note, PageTitle, Pill, Table, btn, cell, heading, useLoad } from "./ui";
import { CustomFinders } from "./CustomFinders";

// Every outside data provider the app knows: one file each under backend/app/providers, found automatically. Its manifest says
// what it offers, where its key is saved, what it costs us, what we may do with its data, and which credit item clients pay.
// Test runs the saved key's real check (the vendor's balance or status call). Keys are pasted on Platform keys.
const UNIT = { call: "a call", find: "a find", credit: "a credit", record: "a record", month: "a month" };

export function Providers() {
  const [data, err, reload] = useLoad(adminApi.providers);
  const [tests, setTests] = useState({});
  const [busy, setBusy] = useState("");

  const runTest = async (id) => {
    setBusy(id);
    try {
      const out = await adminApi.testProvider(id);
      setTests((t) => ({ ...t, [id]: out }));
    } catch (e) {
      setTests((t) => ({ ...t, [id]: { ok: false, detail: e.message } }));
    }
    setBusy("");
  };

  const providers = data?.providers || [];
  const groups = providers.reduce((acc, p) => ({ ...acc, [p.categoryLabel]: [...(acc[p.categoryLabel] || []), p] }), {});
  const problems = Object.entries(data?.problems || {});
  return (
    <>
      <PageTitle title="Providers" sub="Every outside data provider, from its own file. Paste keys on Platform keys; prices are set on Balances → Model Pricing."
        right={<button type="button" style={btn(false)} onClick={reload}>Refresh</button>} />
      <Note error={!!err}>{err}</Note>
      {problems.length > 0 && (
        <Note error>{`Left out because of a problem in the file: ${problems.map(([where, why]) => `${where.split(".").pop()} (${why})`).join("; ")}`}</Note>
      )}
      {Object.entries(groups).map(([label, rows]) => (
        <div key={label}>
          <div style={heading}>{label}</div>
          <Table head={["Provider", "Key", "Our cost", "Licence", "Clients pay", "Test"]} minWidth={860}>
            {rows.map((p) => {
              const t = tests[p.id];
              return (
                <tr key={p.id}>
                  <td style={cell}>
                    <div style={{ fontWeight: 600 }}>{p.name}{p.settingsMade ? <span style={{ fontSize: 11.5, fontWeight: 500, color: C.slate }}> · set up here</span> : null}</div>
                    <div style={{ fontSize: 12, color: C.slate }}>{(p.provides || []).join(", ")}{p.note ? ` · ${p.note}` : ""}</div>
                  </td>
                  <td style={cell}>{p.keySaved ? <Pill tone="green">Saved</Pill> : <Pill tone="amber">No key</Pill>}<div style={{ fontSize: 12, color: C.slate }}>{p.keyGroup}</div></td>
                  <td style={cell}>
                    {p.pricing.usd > 0 ? `$${p.pricing.usd} per ${(UNIT[p.pricing.unit] || p.pricing.unit).replace(/^an? /, "")}` : <span style={{ color: C.amber }}>Not set</span>}
                    <div style={{ fontSize: 12, color: C.slate }}>{p.pricing.billing === "per_search" ? "Every search" : "Per find only"}</div>
                  </td>
                  <td style={cell}>
                    {p.licence.exportable ? <Pill tone="green">Exportable</Pill> : <Pill tone="red">Not exportable</Pill>}
                    <div style={{ fontSize: 12, color: C.slate }}>
                      Kept {p.licence.cacheDays} day{p.licence.cacheDays === 1 ? "" : "s"} · {p.licence.shareAcrossClients ? "reused for other clients" : "this client only"}
                    </div>
                    <div style={{ fontSize: 12, color: C.slate }}>Clients see “{p.licence.clientLabel}”</div>
                  </td>
                  <td style={cell}>{p.creditItem || "—"}</td>
                  <td style={cell}>
                    <button type="button" style={btn(false, !p.keySaved || busy === p.id)} disabled={!p.keySaved || busy === p.id} onClick={() => runTest(p.id)}>
                      {busy === p.id ? "Testing…" : "Test"}
                    </button>
                    {t && <div style={{ fontSize: 12, marginTop: 4, color: t.ok ? C.teal : C.red }}>{t.detail}</div>}
                  </td>
                </tr>
              );
            })}
          </Table>
        </div>
      ))}
      <div style={{ fontSize: 12, color: C.slate, marginTop: 10 }}>
        A new provider is one file in backend/app/providers. It shows here, joins its routing order and gets its price row on Model Pricing, with no other change.
      </div>
      <CustomFinders />
    </>
  );
}
