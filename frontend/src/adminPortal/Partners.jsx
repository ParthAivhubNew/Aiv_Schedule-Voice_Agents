import React, { useState } from "react";
import { C } from "../tokens";
import { adminApi } from "./adminApi";
import { Note, PageTitle, Pill, Table, btn, cell, heading, input, mono, useAction, useLoad, when } from "./ui";

const TONE = { pending: "amber", approved: "green", rejected: "red", sandbox: "blue", live: "green", suspended: "red" };

// Partner applications and the partners themselves. Staff admins decide; support staff can look.
export function Partners({ canEdit }) {
  const [data, error, reload] = useLoad(() => adminApi.partners(), []);
  const [msg, run] = useAction(reload);
  const [notes, setNotes] = useState({});
  const note = (id) => notes[id] || "";

  return (
    <div>
      <PageTitle title="Partners" sub="Companies that offer Outreach inside their own software. Approve an application to open its sandbox, then switch it live once the integration is checked." />
      <Note error>{error}</Note>
      <Note error={msg.error}>{msg.text}</Note>
      {data && (
        <>
          <div style={heading}>Applications{data.pending ? ` (${data.pending} waiting)` : ""}</div>
          <Table head={["Company", "Use", "Contact", "Applied", "Status", ""]} minWidth={860}>
            {data.applications.length === 0 && <tr><td style={{ ...cell, color: C.slate }} colSpan={6}>No applications yet.</td></tr>}
            {data.applications.map((a) => (
              <tr key={a.id}>
                <td style={cell}>
                  <div style={{ fontWeight: 600 }}>{a.company}</div>
                  <div style={{ color: C.slate }}>{a.product}</div>
                  {a.website && <div style={{ color: C.slate, overflowWrap: "anywhere" }}>{a.website}</div>}
                </td>
                <td style={{ ...cell, maxWidth: 280 }}>
                  <div>{a.useCase || "—"}</div>
                  {a.expectedUsers && <div style={{ color: C.slate }}>Expected users: {a.expectedUsers}</div>}
                </td>
                <td style={cell}>{a.contactName}<div style={{ color: C.slate, overflowWrap: "anywhere" }}>{a.contactEmail}</div></td>
                <td style={cell}>{when(a.createdAt)}</td>
                <td style={cell}>
                  <Pill tone={TONE[a.status]}>{a.status}</Pill>
                  {a.reviewNote && <div style={{ color: C.slate, marginTop: 4 }}>{a.reviewNote}</div>}
                </td>
                <td style={cell}>
                  {canEdit && a.status === "pending" && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                      <input aria-label={`Note for ${a.company}`} placeholder="Note (optional)" value={note(a.id)} style={{ ...input, width: 150 }}
                        onChange={(e) => setNotes({ ...notes, [a.id]: e.target.value })} />
                      <button type="button" style={btn(true)} onClick={() => run(() => adminApi.approvePartnerApplication(a.id, note(a.id)), `${a.company} approved.`)}>Approve</button>
                      <button type="button" style={btn(false)} onClick={() => window.confirm(`Reject the application from ${a.company}?`) && run(() => adminApi.rejectPartnerApplication(a.id, note(a.id)), `${a.company} rejected.`)}>Reject</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </Table>

          <div style={heading}>Partners</div>
          <Table head={["Partner", "Client ID", "Addresses", "Users", "Status", ""]} minWidth={860}>
            {data.partners.length === 0 && <tr><td style={{ ...cell, color: C.slate }} colSpan={6}>No partners yet.</td></tr>}
            {data.partners.map((p) => (
              <tr key={p.id}>
                <td style={cell}>
                  <div style={{ fontWeight: 600 }}>{p.name}</div>
                  <div style={{ color: C.slate }}>Terms: {p.termsVersion ? `accepted (${p.termsVersion})` : "not accepted yet"}</div>
                </td>
                <td style={{ ...cell, ...mono }}>{p.clientId}</td>
                <td style={{ ...cell, overflowWrap: "anywhere" }}>
                  {(p.allowedOrigins || []).join(", ") || "—"}
                  <div style={{ color: C.slate }}>Return: {(p.returnUrls || []).join(", ") || "—"}</div>
                </td>
                <td style={cell}>{p.activeUsers}</td>
                <td style={cell}>
                  <Pill tone={TONE[p.status]}>{p.status}</Pill>
                  {p.liveRequestedAt && p.status === "sandbox" && <div style={{ color: C.amber, marginTop: 4 }}>Asked to go live {when(p.liveRequestedAt)}</div>}
                </td>
                <td style={cell}>
                  {canEdit && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {p.status === "sandbox" && (
                        <button type="button" style={btn(true)} onClick={() => window.confirm(`Switch ${p.name} to live? New accounts will get live keys.`) && run(() => adminApi.setPartnerStatus(p.id, "live"), `${p.name} is live.`)}>Go live</button>
                      )}
                      {p.status !== "suspended" && (
                        <button type="button" style={btn(false)} onClick={() => window.confirm(`Pause ${p.name}? Every key it holds stops working.`) && run(() => adminApi.setPartnerStatus(p.id, "suspended"), `${p.name} paused.`)}>Pause</button>
                      )}
                      {p.status === "suspended" && (
                        <button type="button" style={btn(false)} onClick={() => run(() => adminApi.setPartnerStatus(p.id, "sandbox"), `${p.name} is back in the sandbox.`)}>Resume in sandbox</button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        </>
      )}
    </div>
  );
}
