import React from "react";
import { C } from "../tokens";
import { adminApi } from "./adminApi";
import { Note, PageTitle, Pill, Table, btn, cell, heading, mono, useAction, useLoad, when } from "./ui";

// Every customer API key and webhook. Staff can look; admins can switch one off. Secrets are never shown.
export function ApiAccess({ canEdit }) {
  const [data, error, reload] = useLoad(() => adminApi.developerAccess(), []);
  const [msg, run] = useAction(reload);
  return (
    <div>
      <PageTitle title="API access" sub="Customers' API keys and webhooks. Switch one off if it is misused; the customer can create a new one." />
      <Note error>{error}</Note>
      <Note error={msg.error}>{msg.text}</Note>
      {data && (
        <>
          <div style={heading}>Keys</div>
          <Table head={["Customer", "Name", "Key", "Allowed", "Last used", "Status", ""]} minWidth={760}>
            {data.keys.length === 0 && <tr><td style={{ ...cell, color: C.slate }} colSpan={7}>No keys yet.</td></tr>}
            {data.keys.map((k) => (
              <tr key={k.id}>
                <td style={cell}>{k.orgName || k.orgId}</td>
                <td style={cell}>{k.name}</td>
                <td style={{ ...cell, ...mono }}>{k.prefix}…</td>
                <td style={cell}>{(k.scopes || []).join(", ")}</td>
                <td style={cell}>{when(k.lastUsedAt)}</td>
                <td style={cell}><Pill tone={k.active ? "green" : "slate"}>{k.active ? "On" : "Off"}</Pill></td>
                <td style={cell}>
                  {canEdit && k.active && (
                    <button type="button" style={btn(false)} onClick={() => window.confirm(`Switch off the key "${k.name}" for ${k.orgName || k.orgId}?`) && run(() => adminApi.revokeKey(k.id), "Key switched off.")}>
                      Switch off
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
          <div style={heading}>Webhooks</div>
          <Table head={["Customer", "Address", "Events", "Last delivery", "Status", ""]} minWidth={760}>
            {data.webhooks.length === 0 && <tr><td style={{ ...cell, color: C.slate }} colSpan={6}>No webhooks yet.</td></tr>}
            {data.webhooks.map((w) => (
              <tr key={w.id}>
                <td style={cell}>{w.orgName || w.orgId}</td>
                <td style={{ ...cell, ...mono, overflowWrap: "anywhere" }}>{w.url}</td>
                <td style={cell}>{(w.events || []).join(", ")}</td>
                <td style={cell}>{w.lastDeliveryAt ? `${when(w.lastDeliveryAt)} (${w.lastDeliveryStatus ?? "—"})` : "—"}</td>
                <td style={cell}><Pill tone={w.active ? "green" : "slate"}>{w.active ? "On" : "Off"}</Pill></td>
                <td style={cell}>
                  {canEdit && w.active && (
                    <button type="button" style={btn(false)} onClick={() => window.confirm(`Switch off this webhook for ${w.orgName || w.orgId}?`) && run(() => adminApi.disableWebhook(w.id), "Webhook switched off.")}>
                      Switch off
                    </button>
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
