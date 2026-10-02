import React, { useEffect, useState } from "react";
import { C } from "../tokens";
import { adminApi } from "./adminApi";
import { Note, PageTitle, Pill, btn, card, heading, input, mono, useAction, useLoad } from "./ui";
import { PlatformMailbox } from "./PlatformMailbox";

const NEEDS_PHONE = ["Telephony", "Messaging"];
const blank = { key: "", model: "", baseUrl: "", phone: "" };

// Provider keys every client company runs on. They live on the platform record, not in any
// company, and are only ever shown masked. Saving tests the key with the provider first.
export function PlatformKeys({ canEdit }) {
  const [data, err, reload] = useLoad(adminApi.platformKeys);
  const [msg, run] = useAction(reload);
  const [open, setOpen] = useState("");
  const [draft, setDraft] = useState(blank);
  const [extra, setExtra] = useState({});
  const [assistant, setAssistant] = useState({ assistant_id: "", public_key: "" });
  useEffect(() => {
    if (data) setAssistant({ assistant_id: data.assistant.assistantId || "", public_key: data.assistant.publicKey || "" });
  }, [data]);

  if (!data) return <><PageTitle title="Platform keys" /><Note error>{err}</Note></>;
  const edit = (group, item) => {
    setOpen(`${group}|${item.name}`);
    setDraft({ key: "", model: item.model || "", baseUrl: item.baseUrl || "", phone: item.phone || "" });
  };
  const save = (group, provider) => run(() => adminApi.savePlatformKey({
    layer: group, provider, api_key: draft.key.trim() || null, model: draft.model.trim() || null,
    base_url: draft.baseUrl.trim() || null, phone: draft.phone.trim() || null,
  }).then((r) => { setOpen(""); return r; }), `${provider}: key tested and saved.`);
  const form = (group, provider) => (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
      <input aria-label={`${provider} key`} type="password" autoComplete="off" placeholder="New key (empty = re-test the saved one)"
        value={draft.key} onChange={(e) => setDraft({ ...draft, key: e.target.value })} style={{ ...input, ...mono, flex: "2 1 240px" }} />
      <input aria-label={`${provider} model`} placeholder="Model (optional)" value={draft.model}
        onChange={(e) => setDraft({ ...draft, model: e.target.value })} style={{ ...input, flex: "1 1 160px" }} />
      <input aria-label={`${provider} base URL`} placeholder="Base URL (optional)" value={draft.baseUrl}
        onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })} style={{ ...input, flex: "1 1 180px" }} />
      {NEEDS_PHONE.includes(group) && (
        <input aria-label={`${provider} phone`} placeholder="Phone number (optional)" value={draft.phone}
          onChange={(e) => setDraft({ ...draft, phone: e.target.value })} style={{ ...input, flex: "1 1 150px" }} />
      )}
      <button type="button" style={btn(true)} onClick={() => save(group, provider)}>Test and save</button>
      <button type="button" style={btn(false)} onClick={() => setOpen("")}>Cancel</button>
    </div>
  );
  return (
    <>
      <PageTitle title="Platform keys" sub="AI, voice, phone and messaging keys every client company uses. Clients never see these." />
      <Note error={msg.error}>{msg.text}</Note>
      <div style={{ display: "grid", gap: 12 }}>
        {data.groups.map((g) => (
          <div key={g.group} style={card}>
            <div style={{ fontWeight: 700 }}>{g.group}</div>
            {g.desc && <div style={{ fontSize: 12, color: C.slate, marginBottom: 6 }}>{g.desc}</div>}
            {g.items.map((it) => {
              const id = `${g.group}|${it.name}`;
              return (
                <div key={it.id} style={{ borderTop: `1px solid ${C.border}`, padding: "8px 0" }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 600, minWidth: 180 }}>{it.name}</span>
                    {it.status === "connected" ? <Pill tone="green">Key saved</Pill> : <Pill>No key</Pill>}
                    {it.apiKeyMasked && <span style={mono}>{it.apiKeyMasked}</span>}
                    {it.model && <span style={{ fontSize: 12, color: C.slate }}>{it.model}</span>}
                    {canEdit && open !== id && (
                      <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                        <button type="button" style={btn(false)} onClick={() => edit(g.group, it)}>{it.status === "connected" ? "Change" : "Set key"}</button>
                        {it.status === "connected" && (
                          <button type="button" style={btn(false)} onClick={() => {
                            if (window.confirm(`Remove the ${it.name} key? Every client stops using it.`)) {
                              run(() => adminApi.clearPlatformKey({ id: it.id }), `${it.name}: key removed.`);
                            }
                          }}>Remove</button>
                        )}
                      </span>
                    )}
                  </div>
                  {open === id && form(g.group, it.name)}
                </div>
              );
            })}
            {canEdit && (open === `${g.group}|+` ? (
              <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
                <input aria-label={`${g.group} new provider`} placeholder="Provider name, e.g. OpenAI" value={extra[g.group] || ""}
                  onChange={(e) => setExtra({ ...extra, [g.group]: e.target.value })} style={{ ...input, minWidth: 220 }} />
                {form(g.group, (extra[g.group] || "").trim())}
              </div>
            ) : (
              <button type="button" style={{ ...btn(false), marginTop: 8 }} onClick={() => { setOpen(`${g.group}|+`); setDraft(blank); }}>Add another provider</button>
            ))}
          </div>
        ))}
      </div>

      <div style={heading}>Telnyx AI Assistant</div>
      <div style={{ ...card, display: "grid", gap: 8 }}>
        <div style={{ fontSize: 12.5, color: C.slate }}>
          {data.assistant.managed ? "Each user gets their own assistant automatically (TELNYX_MANAGED_ASSISTANTS is on). The ID below is only a fallback."
            : "Calls use this one assistant. Turn on TELNYX_MANAGED_ASSISTANTS for one assistant per user."}
        </div>
        <input aria-label="Assistant ID" placeholder="Assistant ID" value={assistant.assistant_id} disabled={!canEdit}
          onChange={(e) => setAssistant({ ...assistant, assistant_id: e.target.value })} style={{ ...input, ...mono }} />
        <input aria-label="Public key" placeholder="Telnyx account public key (for webhook signatures)" value={assistant.public_key} disabled={!canEdit}
          onChange={(e) => setAssistant({ ...assistant, public_key: e.target.value })} style={{ ...input, ...mono }} />
        {canEdit && (
          <button type="button" style={{ ...btn(true), justifySelf: "start" }} onClick={() => run(() => adminApi.savePlatformAssistant(assistant), "Saved.")}>
            Save assistant
          </button>
        )}
      </div>

      <PlatformMailbox canEdit={canEdit} />
    </>
  );
}
