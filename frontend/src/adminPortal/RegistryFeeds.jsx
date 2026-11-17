import React, { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { C } from "../tokens";
import { adminApi } from "./adminApi";
import { CallLog, LOG_PAGE_SIZE } from "./CallLog";
import { Note, Pill, Table, btn, card, cell, fmt, input, mono, useAction, when } from "./ui";

const TONE = { connected: "green", idle: "green", running: "amber", connecting: "amber", waiting: "amber", reconnecting: "amber", restarting: "amber", error: "red" };
const KIND = {
  status_changed: "Status changed", name_changed: "Name changed", address_changed: "Office moved", new_company: "New company",
  officer_appointed: "Director appointed", officer_resigned: "Director resigned", gazette_notice: "Gazette notice",
};

// The free official registers that keep our companies current: keys, how each feed is doing, and the changes found, ten at a time.
export function RegistryFeeds({ canEdit }) {
  const [data, setData] = useState(null);
  const [offset, setOffset] = useState(0);
  const [source, setSource] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [chKey, setChKey] = useState("");
  const [fcaKey, setFcaKey] = useState("");
  const [fcaEmail, setFcaEmail] = useState("");
  const [onspdUrl, setOnspdUrl] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      setData(await adminApi.registryFeeds({ limit: LOG_PAGE_SIZE, offset, source }));
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  }, [offset, source]);
  useEffect(() => { load(); }, [load]);
  const [msg, run] = useAction(load);

  const saveCh = async (e) => {
    e.preventDefault();
    if (await run(() => adminApi.saveRegistryKey({ which: "ch_stream", key: chKey.trim() }), "Stream key saved. The live feeds connect within a few minutes.")) setChKey("");
  };
  const saveFca = async (e) => {
    e.preventDefault();
    if (await run(() => adminApi.saveRegistryKey({ which: "fca", key: fcaKey.trim(), email: fcaEmail.trim() }), "FCA key saved.")) { setFcaKey(""); setFcaEmail(""); }
  };
  const start = (body, text) => run(() => adminApi.runRegistryJob(body), text);

  return (
    <div>
      <div style={{ fontSize: 12.5, color: C.slate, marginBottom: 8 }}>
        Free official registers that keep our companies current. The Companies House live feeds follow the BN companies we hold and need a stream key; the Gazette needs none.
        Only companies we already hold are recorded, and directors are kept by name, role and date.
      </div>
      <Note error={error || msg.error}>{error || msg.text}</Note>

      <Table head={["Feed", "State", "Last activity", "Read", "Kept", "Note"]} minWidth={760}>
        {(data?.feeds || []).map((f) => (
          <tr key={f.id}>
            <td style={cell}>{f.label}</td>
            <td style={cell}><Pill tone={TONE[f.status] || "slate"}>{f.status || "not started"}</Pill></td>
            <td style={cell}>{when(f.last_event_at || f.last_run_at)}</td>
            <td style={cell}>{fmt(f.seen)}</td>
            <td style={cell}>{fmt(f.kept)}</td>
            <td style={{ ...cell, color: f.error ? C.red || "#b42318" : C.slate }}>{f.error || ""}</td>
          </tr>
        ))}
      </Table>
      <div style={{ fontSize: 12, color: C.slate, margin: "6px 0 0" }}>Postcodes loaded from the ONS directory: {fmt(data?.postcodes)}</div>

      {canEdit ? (
        <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
          <form onSubmit={saveCh} style={{ ...card, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: 12.5, minWidth: 170 }}>Companies House stream key {data?.keys?.ch_stream ? <Pill tone="green">saved</Pill> : <Pill tone="slate">not saved</Pill>}</span>
            <input style={{ ...input, flex: "1 1 260px" }} type="password" autoComplete="off" aria-label="Companies House stream key" placeholder="Paste the stream key (developer.company-information.service.gov.uk)" value={chKey} onChange={(e) => setChKey(e.target.value)} />
            <button type="submit" style={btn(true, !chKey.trim())} disabled={!chKey.trim()}>Save</button>
          </form>
          <form onSubmit={saveFca} style={{ ...card, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: 12.5, minWidth: 170 }}>FCA register key {data?.keys?.fca ? <Pill tone="green">saved</Pill> : <Pill tone="slate">not saved</Pill>}</span>
            <input style={{ ...input, flex: "1 1 200px" }} autoComplete="off" aria-label="FCA registered email" placeholder="Email registered with the FCA" value={fcaEmail} onChange={(e) => setFcaEmail(e.target.value)} />
            <input style={{ ...input, flex: "1 1 200px" }} type="password" autoComplete="off" aria-label="FCA key" placeholder="FCA key" value={fcaKey} onChange={(e) => setFcaKey(e.target.value)} />
            <button type="submit" style={btn(true, !fcaKey.trim() || !fcaEmail.trim())} disabled={!fcaKey.trim() || !fcaEmail.trim()}>Save</button>
          </form>
          <div style={{ ...card, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button type="button" style={btn(false)} onClick={() => start({ job: "gazette", days: 14 }, "Gazette pull started: the last 14 days.")}>Pull the Gazette now</button>
            <button type="button" style={btn(false, !data?.keys?.fca)} disabled={!data?.keys?.fca} onClick={() => start({ job: "fca", limit: 200 }, "FCA check started for 200 finance companies.")}>Run the FCA check</button>
            <input style={{ ...input, flex: "1 1 260px" }} aria-label="ONS Postcode Directory download link" placeholder="Link to the ONS Postcode Directory zip" value={onspdUrl} onChange={(e) => setOnspdUrl(e.target.value)} />
            <button type="button" style={btn(false, !onspdUrl.trim())} disabled={!onspdUrl.trim()} onClick={() => start({ job: "onspd", url: onspdUrl.trim(), prefix: "BN" }, "Postcode load started for BN.")}>Load BN postcodes</button>
          </div>
        </div>
      ) : null}

      <CallLog title="Changes found" total={data?.total || 0} offset={offset} onPage={setOffset}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", margin: "0 0 8px" }}>
          <select style={input} aria-label="Which feed" value={source} onChange={(e) => { setOffset(0); setSource(e.target.value); }}>
            <option value="">All feeds</option>
            {Object.entries(data?.bySource || {}).map(([k, n]) => <option key={k} value={k}>{k} ({fmt(n)})</option>)}
          </select>
          <button type="button" style={btn(false, busy)} disabled={busy} onClick={load}><RefreshCw size={13} /> Refresh</button>
        </div>
        <Table head={["When", "Company", "Change", "From", "To", "Source"]} minWidth={820}>
          {(data?.events || []).map((e, i) => (
            <tr key={i}>
              <td style={{ ...cell, whiteSpace: "nowrap" }}>{when(e.at)}</td>
              <td style={cell}>{e.link ? <a href={e.link} target="_blank" rel="noreferrer">{e.company || e.number}</a> : (e.company || e.number)} <span style={{ ...mono, color: C.slate }}>{e.number}</span></td>
              <td style={cell}>{KIND[e.kind] || e.kind}{e.field && e.kind.startsWith("officer") ? <span style={{ color: C.slate }}> · {e.field}</span> : null}</td>
              <td style={cell}>{e.old || "—"}</td>
              <td style={cell}>{e.new || "—"}</td>
              <td style={{ ...cell, ...mono }}>{e.source}</td>
            </tr>
          ))}
          {data && !data.events.length ? <tr><td style={cell} colSpan={6}>No changes found yet.</td></tr> : null}
        </Table>
      </CallLog>
    </div>
  );
}
