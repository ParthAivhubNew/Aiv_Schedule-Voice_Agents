import React, { useState } from "react";
import { C } from "../tokens";
import { adminApi } from "./adminApi";
import { Note, Pill, Table, btn, cell, input, useAction, useLoad, when } from "./ui";

// What clients declared about how their contacts agreed to hear from them. Staff can read the wording, open the proof file and,
// if a declaration does not hold up, revoke it: the contacts it covered stop counting as having agreed. Staff admins only revoke.
export function ConsentDeclarations({ canEdit }) {
  const [data, error, reload] = useLoad(() => adminApi.consentList());
  const [msg, run] = useAction(reload);
  const [revoking, setRevoking] = useState("");
  const [reason, setReason] = useState("");
  if (!data) return <Note error>{error}</Note>;
  const rows = data.declarations || [];
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <Note error={msg.error}>{msg.text}</Note>
      {rows.length === 0 ? <div style={{ fontSize: 12.5, color: C.slate }}>No declarations yet.</div> : (
        <Table head={["When", "Client", "How they agreed", "Contacts", "Where", "Proof", ""]} minWidth={860}>
          {rows.map((d) => (
            <React.Fragment key={d.id}>
              <tr>
                <td style={cell}>{when(d.declared_at)}</td>
                <td style={cell}>{d.org_id || "—"}</td>
                <td style={cell}>{d.basis_text}{d.agreed_on ? `, ${d.agreed_on}` : ""}</td>
                <td style={cell}>{d.count}</td>
                <td style={cell}>{d.source || "—"}</td>
                <td style={cell}>
                  {d.has_proof_file ? (
                    <button type="button" style={btn(false)} onClick={() => run(() => adminApi.consentProof(d.id, d.proof_name || "proof"))}>Download {d.proof_name || "file"}</button>
                  ) : (d.proof_ref || "None")}
                </td>
                <td style={cell}>
                  {d.revoked_at ? <Pill tone="red">Revoked</Pill> : canEdit && d.basis !== "not_sure" ? (
                    <button type="button" style={btn(false)} onClick={() => { setRevoking(d.id); setReason(""); }}>Revoke</button>
                  ) : null}
                </td>
              </tr>
              {revoking === d.id && (
                <tr>
                  <td style={cell} colSpan={7}>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                      <input style={{ ...input, flex: "1 1 260px" }} placeholder="Why is this being revoked?" value={reason} onChange={(e) => setReason(e.target.value)} />
                      <button type="button" style={btn(true, !reason.trim())} disabled={!reason.trim()} onClick={async () => { await run(() => adminApi.revokeConsent(d.id, reason.trim()), "Revoked. Those contacts no longer count as having agreed."); setRevoking(""); }}>Revoke it</button>
                      <button type="button" style={btn(false)} onClick={() => setRevoking("")}>Cancel</button>
                    </div>
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </Table>
      )}
    </div>
  );
}
