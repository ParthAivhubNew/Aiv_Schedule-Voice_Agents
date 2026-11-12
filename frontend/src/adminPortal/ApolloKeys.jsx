import React, { useCallback, useEffect, useState } from "react";
import { RefreshCw, Trash2 } from "lucide-react";
import { C } from "../tokens";
import { adminApi } from "./adminApi";
import { Note, Pill, Table, btn, card, cell, fmt, heading, input, mono, useAction, when } from "./ui";

const PURPOSE = { company_by_website: "Company by website", company_by_name: "Company by name", email_lookup: "Person's email" };
const OUTCOME = {
  found: ["green", "Found"], none: ["slate", "Nothing found"], key_exhausted: ["red", "Out of credits"],
  rate_limited: ["amber", "Rate limited"], refused: ["red", "Refused"], error: ["red", "Error"],
};

function minutes(s) {
  return s >= 90 ? `${Math.round(s / 60)} min` : `${s}s`;
}

// Apollo keys in the order they are tried, and every call made: when Apollo was asked, for what, on which key.
export function ApolloKeys({ canEdit }) {
  const [days, setDays] = useState(30);
  const [purpose, setPurpose] = useState("");
  const [keyId, setKeyId] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState("");
  const [secret, setSecret] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      setData(await adminApi.apollo({ days, purpose, key: keyId }));
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  }, [days, purpose, keyId]);
  useEffect(() => { load(); }, [load]);
  const [msg, run] = useAction(load);

  const add = async (e) => {
    e.preventDefault();
    const done = await run(() => adminApi.addApolloKey({ label: label.trim(), key: secret.trim() }), "Backup key added.");
    if (done) { setLabel(""); setSecret(""); }
  };

  return (
    <div>
      <div style={{ fontSize: 12.5, color: C.slate, marginBottom: 8 }}>
        The Apollo key is tried first. When it is out of credits, rate limited or refused, the next key does the same task. Add as many backups as you like; they are used in this order.
      </div>
      <Note error={error || msg.error}>{error || msg.text}</Note>

      <Table head={["Order", "Key", "State", "Calls", "Found", "Out of credits", "Last used", ""]} minWidth={720}>
        {(data?.keys || []).map((k, i) => (
          <tr key={k.id}>
            <td style={cell}>{i + 1}</td>
            <td style={cell}>{k.label} <span style={{ ...mono, color: C.slate }}>…{k.tail}</span>{k.main ? <span style={{ color: C.slate }}> · saved under Business Discovery</span> : null}</td>
            <td style={cell}>{k.coolingSeconds ? <Pill tone="amber">Set aside for {minutes(k.coolingSeconds)}</Pill> : <Pill tone="green">In use</Pill>}</td>
            <td style={cell}>{fmt(k.calls)}</td>
            <td style={cell}>{fmt(k.found)}</td>
            <td style={cell}>{k.exhausted ? <Pill tone="red">{fmt(k.exhausted)}</Pill> : 0}</td>
            <td style={cell}>{when(k.lastUsed)}</td>
            <td style={{ ...cell, textAlign: "right" }}>
              {canEdit && !k.main ? (
                <button type="button" style={btn(false)} aria-label={`Remove ${k.label}`} onClick={() => { if (window.confirm(`Remove ${k.label}?`)) run(() => adminApi.removeApolloKey(k.id), "Key removed."); }}><Trash2 size={13} /> Remove</button>
              ) : null}
            </td>
          </tr>
        ))}
        {data && !data.keys.length ? <tr><td style={cell} colSpan={8}>No Apollo key yet. Add the main one in Platform keys (Business Discovery), or a backup below.</td></tr> : null}
      </Table>

      {canEdit ? (
        <form onSubmit={add} style={{ ...card, marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input style={{ ...input, width: 180 }} aria-label="Name for the backup key" placeholder="Name (optional)" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} />
          <input style={{ ...input, flex: "1 1 260px" }} type="password" autoComplete="off" aria-label="Apollo API key" placeholder={data?.keys?.length ? "Paste a backup Apollo API key" : "Paste the Apollo API key"} value={secret} onChange={(e) => setSecret(e.target.value)} />
          <button type="submit" style={btn(true, !secret.trim())} disabled={!secret.trim()}>{data?.keys?.length ? "Add backup key" : "Add Apollo key"}</button>
        </form>
      ) : null}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div style={{ ...heading, margin: "26px 0 6px" }}>When Apollo was asked</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select style={input} aria-label="What for" value={purpose} onChange={(e) => setPurpose(e.target.value)}>
            <option value="">Everything</option>
            {Object.entries(PURPOSE).map(([v, l]) => <option key={v} value={v}>{l}{data?.byPurpose?.[v] ? ` (${fmt(data.byPurpose[v])})` : ""}</option>)}
          </select>
          <select style={input} aria-label="Which key" value={keyId} onChange={(e) => setKeyId(e.target.value)}>
            <option value="">All keys</option>
            {(data?.keys || []).map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
          </select>
          <select style={input} aria-label="Period" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={1}>Last 24 hours</option>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
          </select>
          <button type="button" style={btn(false, busy)} disabled={busy} onClick={load}><RefreshCw size={13} /> Refresh</button>
        </div>
      </div>
      <div style={{ fontSize: 12, color: C.slate, marginBottom: 6 }}>
        Credits is our estimate: 1 for a matched company looked up by website, 1 for a person's email found, and 1 for each search by name (Apollo may charge these; not confirmed). Apollo's own usage page is the exact figure.
      </div>
      <Table head={["When", "Where in the app", "What for", "Looked for", "Triggered by", "Key", "Result", "Credits"]} minWidth={980}>
        {(data?.calls || []).map((c, i) => {
          const [tone, text] = OUTCOME[c.outcome] || ["slate", c.outcome];
          return (
            <tr key={i}>
              <td style={{ ...cell, whiteSpace: "nowrap" }}>{when(c.at)}</td>
              <td style={cell} title={c.route || "Not started by a person's click"}>{c.where}</td>
              <td style={cell}>{PURPOSE[c.purpose] || c.purpose}</td>
              <td style={{ ...cell, maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={c.lookedFor}>{c.lookedFor || "—"}</td>
              <td style={cell}>{c.user || "—"}{c.org ? <span style={{ color: C.slate }}> · {c.org}</span> : null}</td>
              <td style={cell}>{c.key} <span style={{ ...mono, color: C.slate }}>…{c.tail}</span></td>
              <td style={cell}><Pill tone={tone}>{text}</Pill>{c.status ? <span style={{ ...mono, color: C.slate }}> {c.status}</span> : null}</td>
              <td style={cell}>{c.credits || 0}</td>
            </tr>
          );
        })}
        {data && !data.calls.length ? <tr><td style={cell} colSpan={8}>No calls in this period.</td></tr> : null}
      </Table>
    </div>
  );
}
