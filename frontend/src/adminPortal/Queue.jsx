import React from "react";
import { C } from "../tokens";
import { adminApi } from "./adminApi";
import { Note, PageTitle, Pill, Table, btn, cell, heading, mono, useAction, useLoad, when } from "./ui";

// What clients are waiting on: business verifications (Telnyx reviews them) and WhatsApp signups.
// With our Tech Provider app set up, clients finish WhatsApp signup themselves and it switches on
// by itself; the button here is only an override.
export function Queue({ canEdit, openClient }) {
  const [q, err, reload] = useLoad(adminApi.queue);
  const [msg, run] = useAction(reload);
  const open = (q?.verifications || []).filter((v) => !["approved"].includes(v.status));
  return (
    <>
      <PageTitle title="Queue" sub="Verifications and WhatsApp requests waiting on the OutReach team." />
      <Note error>{err}</Note>
      <Note error={msg.error}>{msg.text}</Note>

      <div style={heading}>WhatsApp requests</div>
      <Table head={["Client", "Number", "Signup", ""]}>
        {(q?.whatsappRequests || []).length === 0 && <tr><td colSpan={4} style={{ ...cell, color: C.slate }}>None waiting.</td></tr>}
        {(q?.whatsappRequests || []).map((w) => (
          <tr key={w.numberId}>
            <td style={cell}><button type="button" onClick={() => openClient(w.orgId)} style={{ ...btn(false), border: "none", padding: 0 }}>{w.orgName || w.orgId}</button></td>
            <td style={{ ...cell, ...mono }}>{w.e164}</td>
            <td style={cell}>
              {w.signupStatus === "failed" ? <Pill tone="red">{w.error || "failed"}</Pill>
                : w.signupStatus ? <Pill tone="amber">{w.telnyxStatus ? `Telnyx: ${w.telnyxStatus}` : "Client finishing with Meta"}</Pill>
                : <span style={{ color: C.slate }}>Manual</span>}
            </td>
            <td style={{ ...cell, textAlign: "right" }}>
              {canEdit && <button type="button" style={btn(true)} onClick={() => run(() => adminApi.setWhatsapp(w.orgId, w.numberId, true), `WhatsApp is live on ${w.e164}. The client was told.`)}>Switch WhatsApp on</button>}
            </td>
          </tr>
        ))}
      </Table>
      <div style={{ fontSize: 12, color: C.slate, marginTop: 6 }}>
        {q?.whatsappAutomatic
          ? "Automatic: clients sign up with Meta through Telnyx's page and WhatsApp switches on by itself. Use the button only if a number is stuck and its signup shows complete in the Telnyx portal."
          : "Manual: set WHATSAPP_META_APP_ID (our Tech Provider Meta app) to make this automatic. Until then, switch on only after the number's WhatsApp (Meta) signup shows complete in the Telnyx portal."}
      </div>

      <div style={heading}>Business verifications</div>
      <Table head={["Client", "Status", "Type", "Submitted", "Waiting", "Reason"]}>
        {open.length === 0 && <tr><td colSpan={6} style={{ ...cell, color: C.slate }}>Nothing open.</td></tr>}
        {open.map((v) => (
          <tr key={v.id}>
            <td style={cell}><button type="button" onClick={() => openClient(v.orgId)} style={{ ...btn(false), border: "none", padding: 0 }}>{v.orgName || v.orgId}</button></td>
            <td style={cell}><Pill tone={/reject|unapproved|fail/.test(v.status) ? "red" : "amber"}>{v.status}</Pill></td>
            <td style={cell}>{v.entityType}</td>
            <td style={cell}>{when(v.at)}</td>
            <td style={{ ...cell, color: v.waitingHours > 48 ? C.red : C.textInk }}>{v.waitingHours != null ? `${v.waitingHours} h` : "—"}</td>
            <td style={cell}>{v.reason || "—"}</td>
          </tr>
        ))}
      </Table>
    </>
  );
}
