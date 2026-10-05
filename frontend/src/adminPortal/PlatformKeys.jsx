import React, { useEffect, useState } from "react";
import { C } from "../tokens";
import { adminApi } from "./adminApi";
import { Note, PageTitle, Pill, btn, card, heading, input, mono, useAction, useLoad } from "./ui";
import { PlatformAi } from "./PlatformAi";

const NEEDS_PHONE = ["Telephony", "Messaging"];
const blank = { key: "", model: "", baseUrl: "", phone: "" };
const isTelnyx = (name) => (name || "").toLowerCase().includes("telnyx");

// LLM is the one group every plugin needs its own copy of; IMAGE is Post Scheduler-only today.
// Each plugin owns its keys independently -- nothing is shared automatically. "Copy from" on a
// group card is the only way one plugin's saved key ever reaches another, and only when asked.
// Telnyx powers the whole Voice call stack (telephony, LLM, STT and TTS) through one key, so it
// gets its own block below instead of appearing as "one more provider" inside these groups.
const VOICE_GROUPS = ["Telephony", "Speech-to-Text", "Text-to-Speech", "Voice Orchestration", "Embeddings", "Messaging", "LLM:voice"];
const LEADGEN_GROUPS = ["Email Finder", "Business Discovery", "LLM:leadgen"];
const SCHEDULER_GROUPS = ["LLM:scheduler", "IMAGE:scheduler"];
// group -> the other plugins' groups sharing the same base name, for the "Copy from" button.
const COPY_SIBLINGS = {
  "LLM:voice": [["LLM:leadgen", "Leads"], ["LLM:scheduler", "Social"]],
  "LLM:leadgen": [["LLM:voice", "Voice"], ["LLM:scheduler", "Social"]],
  "LLM:scheduler": [["LLM:voice", "Voice"], ["LLM:leadgen", "Leads"]],
};
const friendlyGroupName = (g) => g.replace(/:(voice|leadgen|scheduler)$/, (_, s) => ` (${s[0].toUpperCase()}${s.slice(1)}-only)`);

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

  const save = (group, provider) => run(() => {
    if (!isTelnyx(provider) && !draft.baseUrl.trim()) {
      throw new Error("Base URL is required -- every connection here is brought by you, nothing is guessed.");
    }
    return adminApi.savePlatformKey({
      layer: group, provider, api_key: draft.key.trim() || null, model: draft.model.trim() || null,
      base_url: draft.baseUrl.trim() || null, phone: draft.phone.trim() || null,
    }).then((r) => { setOpen(""); return r; });
  }, `${provider}: key tested and saved.`);

  const form = (group, provider) => (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
      <input aria-label={`${provider} key`} type="password" autoComplete="off" placeholder="New key (empty = re-test the saved one)"
        value={draft.key} onChange={(e) => setDraft({ ...draft, key: e.target.value })} style={{ ...input, ...mono, flex: "2 1 240px" }} />
      <input aria-label={`${provider} model`} placeholder="Model name (optional)" value={draft.model}
        onChange={(e) => setDraft({ ...draft, model: e.target.value })} style={{ ...input, flex: "1 1 160px" }} />
      <input aria-label={`${provider} base URL`} placeholder={isTelnyx(provider) ? "Base URL (optional)" : "Base URL (required -- bring your own)"} value={draft.baseUrl}
        onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })} style={{ ...input, flex: "1 1 220px" }} />
      {NEEDS_PHONE.includes(group) && (
        <input aria-label={`${provider} phone`} placeholder="Phone number (optional)" value={draft.phone}
          onChange={(e) => setDraft({ ...draft, phone: e.target.value })} style={{ ...input, flex: "1 1 150px" }} />
      )}
      <button type="button" style={btn(true)} onClick={() => save(group, provider)}>Test and save</button>
      <button type="button" style={btn(false)} onClick={() => setOpen("")}>Cancel</button>
    </div>
  );

  const copyFrom = (toGroup, fromGroup, providerName) =>
    run(() => adminApi.copyPlatformKey(fromGroup, toGroup, providerName), `Copied ${providerName} from ${fromGroup}.`);

  const clear = (name, id) => run(() => adminApi.clearPlatformKey({ id }), `${name}: key removed.`);

  const keyRow = (group, it) => {
    const id = `${group}|${it.name}`;
    return (
      <div key={it.id} style={{ borderTop: `1px solid ${C.border}`, padding: "8px 0" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontWeight: 600, minWidth: 180 }}>{it.name}</span>
          {it.status === "connected" ? <Pill tone="green">Key saved</Pill> : <Pill>No key</Pill>}
          {it.apiKeyMasked && <span style={mono}>{it.apiKeyMasked}</span>}
          {it.model && <span style={{ fontSize: 12, color: C.slate }}>{it.model}</span>}
          {it.baseUrl && <span style={{ fontSize: 12, color: C.slate }}>{it.baseUrl}</span>}
          {canEdit && open !== id && (
            <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
              <button type="button" style={btn(false)} onClick={() => edit(group, it)}>{it.status === "connected" ? "Change" : "Set key"}</button>
              {it.status === "connected" && (
                <button type="button" style={btn(false)} onClick={() => {
                  if (window.confirm(`Remove the ${it.name} key? Every client stops using it.`)) clear(it.name, it.id);
                }}>Remove</button>
              )}
            </span>
          )}
        </div>
        {open === id && form(group, it.name)}
      </div>
    );
  };

  const renderGroupCards = (groupNames) => {
    const byName = Object.fromEntries(data.groups.map((g) => [g.group, g]));
    const groups = groupNames.map((n) => byName[n]).filter(Boolean);
    if (!groups.length) return null;
    return (
      <div style={{ display: "grid", gap: 12 }}>
        {groups.map((g) => {
          const items = g.items.filter((it) => !isTelnyx(it.name));
          return (
            <div key={g.group} style={card}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <div style={{ fontWeight: 700 }}>{friendlyGroupName(g.group)}</div>
                {(COPY_SIBLINGS[g.group] || []).map(([fromGroup, label]) => (
                  <button key={fromGroup} type="button" style={{ ...btn(false), fontSize: 11, padding: "3px 8px" }}
                    title={`Copy a saved key from ${label} into this plugin, when you ask for it -- never automatic.`}
                    onClick={() => {
                      const provider = window.prompt(`Copy which provider's key from ${label}? (exact name, e.g. OpenAI)`);
                      if (provider) copyFrom(g.group, fromGroup, provider.trim());
                    }}>
                    Copy from {label}
                  </button>
                ))}
              </div>
              {items.map((it) => keyRow(g.group, it))}
              {canEdit && (open === `${g.group}|+` ? (
                <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
                  <input aria-label={`${g.group} new provider`} placeholder="Provider name" value={extra[g.group] || ""}
                    onChange={(e) => setExtra({ ...extra, [g.group]: e.target.value })} style={{ ...input, minWidth: 220 }} />
                  {form(g.group, (extra[g.group] || "").trim())}
                </div>
              ) : (
                <button type="button" style={{ ...btn(false), marginTop: 8 }} onClick={() => { setOpen(`${g.group}|+`); setDraft(blank); }}>Add a key</button>
              ))}
            </div>
          );
        })}
      </div>
    );
  };

  const telnyxItem = (Object.fromEntries(data.groups.map((g) => [g.group, g]))["Telephony"]?.items || []).find((it) => isTelnyx(it.name));

  const tabs = [
    { id: "voice", label: "Voice" },
    { id: "leadgen", label: "Leads" },
    { id: "scheduler", label: "Social" },
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
          <div style={heading}>Telnyx (the whole call stack)</div>
          <div style={{ ...card, display: "grid", gap: 10 }}>
            <div style={{ fontSize: 12.5, color: C.slate }}>
              One Telnyx key powers telephony, call reasoning, speech-to-text and text-to-speech together. This is Aivhub's own managed stack, not a bring-your-own connection.
            </div>
            {telnyxItem ? keyRow("Telephony", telnyxItem) : canEdit && (
              open === "Telephony|Telnyx" ? (
                <div>{form("Telephony", "Telnyx")}</div>
              ) : (
                <button type="button" style={btn(false)} onClick={() => { setOpen("Telephony|Telnyx"); setDraft(blank); }}>Set Telnyx key</button>
              )
            )}
            <VoiceStackStatus stack={data.voiceStack} />
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

          <div style={heading}>Conversation AI Routing</div>
          <div style={{ fontSize: 12.5, color: C.slate }}>
            Pick which saved LLM key powers call reasoning and conversation understanding for the Voice plugin.
          </div>
          <PlatformAi canEdit={canEdit} scope="voice" showCatalogue={true} />

          <div style={heading}>Voice & Telephony Keys</div>
          {renderGroupCards(VOICE_GROUPS)}
        </div>
      )}

      {activeTab === "leadgen" && (
        <div style={{ display: "grid", gap: 16 }}>
          <div style={heading}>Reasoning AI Routing</div>
          <div style={{ fontSize: 12.5, color: C.slate }}>
            Pick which saved LLM key powers prospect research, waterfall enrichment, and company analysis.
          </div>
          <PlatformAi canEdit={canEdit} scope="leadgen" showCatalogue={false} />

          <div style={heading}>Email Finder & Discovery Keys</div>
          {renderGroupCards(LEADGEN_GROUPS)}
        </div>
      )}

      {activeTab === "scheduler" && (
        <div style={{ display: "grid", gap: 16 }}>
          <div style={heading}>Social AI</div>
          <PlatformAi canEdit={canEdit} scope="scheduler" showCatalogue={false} showKeys={false} />

          <div style={heading}>Writing & Image Keys</div>
          {renderGroupCards(SCHEDULER_GROUPS)}
        </div>
      )}
    </>
  );
}

// Reads the live running config (not a static description) so it updates itself the moment
// anything about the Telnyx/assistant setup changes -- TELNYX_MANAGED_ASSISTANTS, the account
// mode, how many assistants and client Telnyx setups actually exist right now.
function VoiceStackStatus({ stack }) {
  if (!stack) return null;
  const row = (label, value, tone) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: `1px solid ${C.border}` }}>
      <span style={{ fontSize: 12.5, color: C.slate }}>{label}</span>
      <Pill tone={tone}>{value}</Pill>
    </div>
  );
  return (
    <div style={{ display: "grid", gap: 2 }}>
      {row("Per-client assistants (TELNYX_MANAGED_ASSISTANTS)", stack.managedAssistants ? "On" : "Off",
        stack.managedAssistants ? "green" : "amber")}
      {row("Telnyx account mode", stack.accountMode === "managed_account" ? "Managed account (own Telnyx sub-account per client)" : "Billing group (shared Telnyx balance)")}
      {row("Platform Telnyx key connected", stack.platformReady ? "Yes" : "No", stack.platformReady ? "green" : "red")}
      {row("Client Telnyx setups provisioned", stack.orgsProvisioned)}
      {row("Assistants actually created", stack.assistantsCreated)}
      {stack.accountMode === "managed_account" && row("Clients on their own Telnyx sub-account", stack.orgsOnManagedAccount)}
      <div style={{ fontSize: 11.5, color: C.slate, marginTop: 6 }}>
        {stack.managedAssistants
          ? "Every client org gets its own Telnyx AI assistant automatically when they finish Telnyx verification -- not the one shared assistant below."
          : "Managed assistants are off: every client currently shares the one assistant ID set below. Turn on TELNYX_MANAGED_ASSISTANTS to give each client its own."}
      </div>
    </div>
  );
}
