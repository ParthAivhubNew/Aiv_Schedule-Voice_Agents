import React, { useState } from "react";
import { C } from "../tokens";
import { adminApi } from "./adminApi";
import { Note, Pill, Table, btn, cell, heading, input, useAction, useLoad } from "./ui";
import { BLANK, fromForm, idFromName, toForm } from "./customFinderLogic";

// E-mail finders set up here, with no code (backend/app/providers/generic_http.py): describe a plain JSON API, paste its key, press
// Test. It joins the e-mail finder order straight away, with its price on Model Pricing, and every call goes through the provider
// wrapper (plan, fair-use cap, pause after failures, cost log). Only staff admins can save or remove one.
const label = { fontSize: 12, fontWeight: 600, color: C.textInk, display: "flex", flexDirection: "column", gap: 4 };
const help = { fontSize: 11.5, color: C.slate, fontWeight: 400 };
const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 };
const area = { ...input, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12, minHeight: 92, resize: "vertical" };

function Field({ name, hint, children }) {
  return (
    <label style={label}>
      {name}
      {children}
      {hint ? <span style={help}>{hint}</span> : null}
    </label>
  );
}

export function CustomFinders() {
  const [data, err, reload] = useLoad(adminApi.customProviders);
  const [msg, run] = useAction(reload);
  const [form, setForm] = useState(null); // null: no form open
  const [editing, setEditing] = useState(""); // the id being changed; "" for a new one
  const [tests, setTests] = useState({});
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  const save = async () => {
    let body;
    try {
      body = fromForm(form);
    } catch (e) {
      await run(() => Promise.reject(e));
      return;
    }
    const out = await run(() => adminApi.saveCustomProvider(body), `${form.name} is saved and joins the e-mail finder order.`);
    if (out) setForm(null);
  };
  const remove = (p) => {
    if (!window.confirm(`Remove ${p.name}? It stops being asked straight away.`)) return;
    run(() => adminApi.removeCustomProvider(p.id), `${p.name} is removed.`);
  };
  const test = async (p) => {
    setTests((t) => ({ ...t, [p.id]: { busy: true } }));
    try {
      const out = await adminApi.testProvider(p.id);
      setTests((t) => ({ ...t, [p.id]: out }));
    } catch (e) {
      setTests((t) => ({ ...t, [p.id]: { ok: false, detail: e.message } }));
    }
  };

  const rows = data?.providers || [];
  return (
    <>
      <div style={{ ...heading, display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ flex: 1 }}>E-mail finders set up here, with no code</span>
        {!form && <button type="button" style={btn(true)} onClick={() => { setEditing(""); setForm({ ...BLANK }); }}>Add an e-mail finder</button>}
      </div>
      <div style={{ fontSize: 12.5, color: C.slate, marginBottom: 8 }}>
        For a provider with a plain JSON API. Describe the request and where the e-mail address is in the answer, paste the key, then Test.
        Other kinds of provider still need a file in backend/app/providers.
      </div>
      <Note error={!!err}>{err}</Note>
      <Note error={msg.error}>{msg.text}</Note>

      {rows.length > 0 && (
        <Table head={["Provider", "Address", "Key", "Our cost", "", ""]} minWidth={820}>
          {rows.map((p) => {
            const t = tests[p.id];
            return (
              <tr key={p.id}>
                <td style={cell}><div style={{ fontWeight: 600 }}>{p.name}</div><div style={{ fontSize: 12, color: C.slate }}>{p.id} · position {p.order}</div></td>
                <td style={{ ...cell, maxWidth: 280, overflowWrap: "anywhere" }}>{p.method} {p.url}</td>
                <td style={cell}>{p.keySaved ? <Pill tone="green">Saved</Pill> : <Pill tone="amber">No key</Pill>}</td>
                <td style={cell}>{p.priceUsd > 0 ? `$${p.priceUsd}` : <span style={{ color: C.amber }}>Not set</span>}
                  <div style={{ fontSize: 12, color: C.slate }}>{p.billing === "per_search" ? "Every search" : "Per find only"}</div></td>
                <td style={cell}>
                  <button type="button" style={btn(false, !p.keySaved || t?.busy)} disabled={!p.keySaved || t?.busy} onClick={() => test(p)}>
                    {t?.busy ? "Testing…" : "Test"}
                  </button>
                  {t && !t.busy && <div style={{ fontSize: 12, marginTop: 4, maxWidth: 260, color: t.ok ? C.teal : C.red }}>{t.detail}</div>}
                </td>
                <td style={{ ...cell, whiteSpace: "nowrap" }}>
                  <button type="button" style={btn(false)} onClick={() => { setEditing(p.id); setForm(toForm(p)); }}>Edit</button>{" "}
                  <button type="button" style={btn(false)} onClick={() => remove(p)}>Remove</button>
                </td>
              </tr>
            );
          })}
        </Table>
      )}

      {form && (
        <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 14, padding: 16, marginTop: 12, display: "grid", gap: 14 }}>
          <div style={grid}>
            <Field name="Name" hint="What staff see. Clients never see a provider's name.">
              <input style={input} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value, id: editing ? f.id : idFromName(e.target.value) }))} />
            </Field>
            <Field name="Id" hint={editing ? "Can't be changed once saved." : "Made from the name."}>
              <input style={input} value={form.id} disabled={!!editing} onChange={set("id")} />
            </Field>
            <Field name="Position in the order" hint="Lower is asked first. The built-in finders are 10 to 60.">
              <input style={input} type="number" min="1" max="999" value={form.order} onChange={set("order")} />
            </Field>
          </div>
          <div style={grid}>
            <Field name="Method">
              <select style={input} value={form.method} onChange={set("method")}><option>GET</option><option>POST</option></select>
            </Field>
            <Field name="Address" hint="https only. It may hold {domain}, {first_name}, {last_name}, {full_name} or {company}.">
              <input style={input} value={form.url} placeholder="https://api.example.com/v1/email-finder" onChange={set("url")} />
            </Field>
          </div>
          <div style={grid}>
            <Field name="The key goes in">
              <select style={input} value={form.keyIn} onChange={set("keyIn")}><option value="header">A header</option><option value="query">The query</option></select>
            </Field>
            <Field name={form.keyIn === "header" ? "Header name" : "Query parameter name"}>
              <input style={input} value={form.keyName} onChange={set("keyName")} />
            </Field>
            <Field name="Before the key" hint='Often "Bearer " for an Authorization header. Leave empty if none.'>
              <input style={input} value={form.keyPrefix} onChange={set("keyPrefix")} />
            </Field>
          </div>
          <div style={grid}>
            <Field name="Query (JSON)" hint="Text values. Use {first_name}, {last_name}, {full_name}, {company} and {domain}.">
              <textarea style={area} value={form.query} onChange={set("query")} />
            </Field>
            {form.method === "POST" && (
              <Field name="Body (JSON)" hint="Sent as JSON, with the same {…} values.">
                <textarea style={area} value={form.body} onChange={set("body")} />
              </Field>
            )}
          </div>
          <div style={grid}>
            <Field name="Where the e-mail is in the answer" hint="A dotted path, such as data.email or result.0.email.">
              <input style={input} value={form.emailPath} onChange={set("emailPath")} />
            </Field>
            <Field name="Where its status is (optional)" hint="Such as data.status. Without it, an address counts as unverified.">
              <input style={input} value={form.statusPath} onChange={set("statusPath")} />
            </Field>
            <Field name="Status words that mean verified" hint="Separated by commas, such as valid, verified.">
              <input style={input} value={form.verifiedValues} onChange={set("verifiedValues")} />
            </Field>
            <Field name="Status words that mean usable but unverified" hint="Such as accept_all. Empty: any other status counts as unverified.">
              <input style={input} value={form.catchAllValues} onChange={set("catchAllValues")} />
            </Field>
          </div>
          <label style={{ ...label, flexDirection: "row", alignItems: "center", fontWeight: 500 }}>
            <input type="checkbox" checked={form.trustAll} onChange={set("trustAll")} /> Every address it returns is verified
          </label>
          <div style={grid}>
            <Field name="What a look-up costs us (US dollars)" hint="Saved on Model Pricing too.">
              <input style={input} type="number" min="0" step="0.0001" value={form.priceUsd} onChange={set("priceUsd")} />
            </Field>
            <Field name="It charges">
              <select style={input} value={form.billing} onChange={set("billing")}><option value="per_find">Only when it finds one</option><option value="per_search">For every search</option></select>
            </Field>
            <Field name="Clients see the source as">
              <input style={input} value={form.clientLabel} onChange={set("clientLabel")} />
            </Field>
            <Field name="Docs link (optional)">
              <input style={input} value={form.docsUrl} onChange={set("docsUrl")} />
            </Field>
          </div>
          <label style={{ ...label, flexDirection: "row", alignItems: "center", fontWeight: 500 }}>
            <input type="checkbox" checked={form.exportable} onChange={set("exportable")} /> Its addresses may leave the app in a client's export
          </label>
          <Field name="Key" hint={editing ? "Leave empty to keep the saved key." : "Kept sealed. It is never shown again."}>
            <input style={input} type="password" autoComplete="off" value={form.key} onChange={set("key")} />
          </Field>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" style={btn(true, !form.name.trim())} disabled={!form.name.trim()} onClick={save}>Save</button>
            <button type="button" style={btn(false)} onClick={() => setForm(null)}>Cancel</button>
          </div>
        </div>
      )}
    </>
  );
}
