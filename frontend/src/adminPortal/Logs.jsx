import React, { useCallback, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { C } from "../tokens";
import { adminApi } from "./adminApi";
import { Note, PageTitle, Pill, Table, btn, cell, input, mono, useLoad, when } from "./ui";

const levelTone = (l) => (/error|critical/i.test(l) ? "red" : /warn/i.test(l) ? "amber" : "slate");

// Process logs from every organisation (newest first), filterable by client and text.
export function Logs() {
  const [orgId, setOrgId] = useState("");
  const [find, setFind] = useState("");
  const [clients] = useLoad(adminApi.clients);
  const fetchLogs = useCallback(() => adminApi.logs(orgId), [orgId]);
  const [rows, err, reload] = useLoad(fetchLogs, [fetchLogs]);
  const names = useMemo(() => Object.fromEntries((clients || []).map((o) => [o.id, o.name])), [clients]);
  const shown = useMemo(() => {
    const t = find.trim().toLowerCase();
    return (rows || []).filter((r) => !t || `${r.subsystem} ${r.process} ${r.message}`.toLowerCase().includes(t));
  }, [rows, find]);

  return (
    <>
      <PageTitle title="Logs" sub="Process logs across all clients (last 300)."
        right={
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <select aria-label="Client" value={orgId} onChange={(e) => setOrgId(e.target.value)} style={input}>
              <option value="">All clients</option>
              {(clients || []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <input aria-label="Find in logs" placeholder="Find" value={find} onChange={(e) => setFind(e.target.value)} style={{ ...input, width: 180 }} />
            <button type="button" style={btn(false)} onClick={reload}><RefreshCw size={13} /> Refresh</button>
          </div>
        } />
      <Note error>{err}</Note>
      <Table head={["When", "Client", "Level", "Where", "Message"]} minWidth={900}>
        {shown.length === 0 && <tr><td colSpan={5} style={{ ...cell, color: C.slate }}>{rows ? "No logs." : "Loading…"}</td></tr>}
        {shown.map((r) => (
          <tr key={r.id}>
            <td style={{ ...cell, whiteSpace: "nowrap" }}>{when(r.at)}</td>
            <td style={cell}>{names[r.orgId] || r.orgId || "—"}</td>
            <td style={cell}><Pill tone={levelTone(r.level)}>{r.level}</Pill></td>
            <td style={{ ...cell, ...mono }}>{r.subsystem}{r.process ? ` / ${r.process}` : ""}</td>
            <td style={{ ...cell, maxWidth: 520, wordBreak: "break-word" }}>{r.message}</td>
          </tr>
        ))}
      </Table>
    </>
  );
}
