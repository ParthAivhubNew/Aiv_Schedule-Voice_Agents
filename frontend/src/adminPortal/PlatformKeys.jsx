import React, { useEffect, useState } from "react";
import { C } from "../tokens";
import { adminApi } from "./adminApi";
import { Note, PageTitle, Pill, btn, card, heading, input, mono, useAction, useLoad } from "./ui";
import { PlatformMailbox } from "./PlatformMailbox";
import { PlatformAi } from "./PlatformAi";

const NEEDS_PHONE = ["Telephony", "Messaging"];
const blank = { key: "", model: "", baseUrl: "", phone: "" };

const VOICE_GROUPS = ["Telephony", "Speech-to-Text", "Text-to-Speech", "Voice Orchestration"];
const LEADGEN_GROUPS = ["Email Finder", "Business Discovery"];
const SHARED_GROUPS = ["LLM", "IMAGE", "Embeddings", "Messaging"];

export function PlatformKeys({ canEdit }) {
  const [activeTab, setActiveTab] = useState("voice");
  const [data, err, reload] = useLoad(adminApi.platformKeys);
  const [msg, run] = useAction(reload);
  const [open, setOpen] = useState("");
  const [draft, setDraft] = useState(blank);
  const [extra, setExtra] = useState({});
  const [assistant, setAssistant] = useState({ assistant_id: "", public_key: "" });

  useEffect(() => {
    if (data) setAssistant({ assistant_id: data.assistant.assistantId || "", public_key: data.assistant.publicKey || "" });
  }, [data]);

  if (!data) return <><PageTitle title="Platform keys & AI" /><Note error>{err}</Note></>;

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

  const renderGroupCards = (groupNames) => {
    const groups = data.groups.filter((g) => groupNames.includes(g.group));
    if (!groups.length) return null;
    return (
      <div style={{ display: "grid", gap: 12 }}>
        {groups.map((g) => (
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
    );
  };

  const tabs = [
    { id: "voice", label: "Voice" },
    { id: "leadgen", label: "Leadgen" },
    { id: "scheduler", label: "Post Scheduler" },
    { id: "shared", label: "Shared Infrastructure" },
  ];

  return (
    <>
      <PageTitle title="Platform Keys & AI" sub="Configure AI routing and provider keys per plugin. Clients never see or hold these keys." />
      <div style={{ display: "flex", gap: 8, margin: "14px 0 18px", borderBottom: `1px solid ${C.border}`, paddingBottom: 8, flexWrap: "wrap" }}>
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            style={{
              ...btn(activeTab === t.id),
              padding: "7px 14px",
              fontSize: 13,
              borderRadius: 8,
              background: activeTab === t.id ? C.ink : "transparent",
              color: activeTab === t.id ? "#fff" : C.textInk,
              borderColor: activeTab === t.id ? C.ink : C.border,
            }}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <Note error={msg.error}>{msg.text}</Note>

      {activeTab === "voice" && (
        <div style={{ display: "grid", gap: 16 }}>
          <div style={heading}>Conversation AI Routing</div>
          <div style={{ fontSize: 12.5, color: C.slate }}>
            Select which LLM powers call reasoning and conversation understanding for the Voice plugin.
          </div>
          <PlatformAi canEdit={canEdit} scope="voice" showCatalogue={false} showKeys={false} />

          <div style={heading}>Voice & Telephony Keys</div>
          {renderGroupCards(VOICE_GROUPS)}

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
        </div>
      )}

      {activeTab === "leadgen" && (
        <div style={{ display: "grid", gap: 16 }}>
          <div style={heading}>Reasoning AI Routing</div>
          <div style={{ fontSize: 12.5, color: C.slate }}>
            Select which LLM powers prospect research, waterfall enrichment, and company analysis.
          </div>
          <PlatformAi canEdit={canEdit} scope="leadgen" showCatalogue={false} showKeys={false} />

          <div style={heading}>Email Finder & Discovery Keys</div>
          {renderGroupCards(LEADGEN_GROUPS)}

          <div style={heading}>Platform Mailbox</div>
          <PlatformMailbox canEdit={canEdit} />
        </div>
      )}

      {activeTab === "scheduler" && (
        <div style={{ display: "grid", gap: 16 }}>
          <div style={heading}>Post Scheduler AI</div>
          <PlatformAi canEdit={canEdit} scope="scheduler" showCatalogue={true} showKeys={false} />
        </div>
      )}

      {activeTab === "shared" && (
        <div style={{ display: "grid", gap: 16 }}>
          <div style={{ fontSize: 13, color: C.slate }}>
            The central pool of LLM, Image, Embeddings, and Messaging keys. Enter keys once here; the Voice, Leadgen, and Post Scheduler routing selectors choose from this pool.
          </div>
          {renderGroupCards(SHARED_GROUPS)}
        </div>
      )}
    </>
  );
}
