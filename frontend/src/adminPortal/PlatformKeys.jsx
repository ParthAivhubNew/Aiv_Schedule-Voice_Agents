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
    { id: "datasources", label: "Data Sources" },
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

      {activeTab === "datasources" && (
        <div style={{ display: "grid", gap: 16 }}>
          <div style={heading}>Data Sources</div>
          <DataSources canEdit={canEdit} />

          <div style={heading}>Scraped Data</div>
          <BusinessRecordsBrowser />
        </div>
      )}

      {activeTab === "scheduler" && (
        <div style={{ display: "grid", gap: 16 }}>
          <div style={heading}>Social AI</div>
          <PlatformAi canEdit={canEdit} scope="scheduler" showCatalogue={false} showKeys={false} />

          <div style={heading}>Writing & Image Keys</div>
          {renderGroupCards(SCHEDULER_GROUPS)}

          <div style={heading}>Social OAuth Apps</div>
          <SocialOAuthApps canEdit={canEdit} />
        </div>
      )}
    </>
  );
}

const OAUTH_LABELS = { linkedin: "LinkedIn", x: "X", facebook: "Facebook", instagram: "Instagram", threads: "Threads" };

// The one shared developer-app registration (Client ID/Secret) behind every organisation's
// "Connect LinkedIn/Facebook/..." button -- staff-only. Organisations only ever see whether
// it's configured, never these values (see SocialWorkspace.jsx's read-only status check).
function SocialOAuthApps({ canEdit }) {
  const [data, err, reload] = useLoad(adminApi.socialOauthApps);
  const [msg, run] = useAction(reload);
  const [open, setOpen] = useState("");
  const [draft, setDraft] = useState({ clientId: "", clientSecret: "", configId: "" });

  if (!data) return <Note error={err}>{err}</Note>;
  const platforms = (data.platforms || []).filter((p) => p !== "instagram");
  const appFor = (p) => (data.apps || []).find((a) => a.platform === p) || {};

  const save = (platform) => run(() => {
    if (!draft.clientId.trim() || !draft.clientSecret.trim()) {
      throw new Error("Client ID and Client Secret are both required.");
    }
    return adminApi.saveSocialOauthApp(platform, {
      clientId: draft.clientId.trim(),
      clientSecret: draft.clientSecret.trim(),
      configId: draft.configId.trim(),
      redirectUri: (data.defaultCallback || {})[platform] || "",
    }).then((r) => { setOpen(""); return r; });
  }, `${OAUTH_LABELS[platform] || platform}: app saved. Organisations can now click Connect.`);

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ fontSize: 12.5, color: C.slate }}>
        One Client ID + Secret per network, shared by every organisation's "Connect" button. Paste these from each
        network's own developer portal; register the callback URL shown below there too.
      </div>
      <Note error={msg.error}>{msg.text}</Note>
      {platforms.map((p) => {
        const app = appFor(p);
        const isOpen = open === p;
        const isFacebook = p === "facebook";
        return (
          <div key={p} style={{ ...card, display: "grid", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <div style={{ fontWeight: 700 }}>{OAUTH_LABELS[p] || p}{isFacebook ? " (also powers Instagram)" : ""}</div>
              {app.configured ? <Pill tone="green">Configured{app.clientIdHint ? `: ${app.clientIdHint}` : ""}</Pill> : <Pill>Not set up</Pill>}
            </div>
            <div style={mono}>Callback URL: {(data.defaultCallback || {})[p] || app.callbackUrl || ""}</div>
            {canEdit && (isOpen ? (
              <div style={{ display: "grid", gap: 6, maxWidth: 420 }}>
                <input aria-label={`${p} client id`} placeholder="Client ID" value={draft.clientId}
                  onChange={(e) => setDraft({ ...draft, clientId: e.target.value })} style={input} />
                <input aria-label={`${p} client secret`} type="password" placeholder={app.hasSecret ? "New secret (empty = keep saved one)" : "Client secret"}
                  value={draft.clientSecret} onChange={(e) => setDraft({ ...draft, clientSecret: e.target.value })} style={input} />
                {isFacebook && (
                  <input aria-label="Facebook Login for Business Configuration ID" placeholder="Facebook Login for Business -- Configuration ID (optional)"
                    value={draft.configId} onChange={(e) => setDraft({ ...draft, configId: e.target.value })} style={input} />
                )}
                <div style={{ display: "flex", gap: 6 }}>
                  <button type="button" style={btn(true)} onClick={() => save(p)}>Save</button>
                  <button type="button" style={btn(false)} onClick={() => setOpen("")}>Cancel</button>
                </div>
              </div>
            ) : (
              <button type="button" style={{ ...btn(false), justifySelf: "start" }}
                onClick={() => { setOpen(p); setDraft({ clientId: "", clientSecret: "", configId: "" }); }}>
                {app.configured ? "Replace" : "Set up"}
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}

const emptyDataSource = { name: "", kind: "api", baseUrl: "", authType: "none", apiKey: "", config: "{}", providesFields: "", maxConcurrentRequests: 2, minDelayMs: 1000, status: "active" };

// Every website/API the platform pulls public company data from (see BusinessRecord) -- staff
// only. Companies House ships pre-configured as the first row; adding a second source here is a
// form, never a deploy. Keys are staff-entered and never shown to organisations.
function DataSources({ canEdit }) {
  const [data, err, reload] = useLoad(adminApi.dataSources);
  const [msg, run] = useAction(reload);
  const [open, setOpen] = useState("");
  const [draft, setDraft] = useState(emptyDataSource);
  const [testResult, setTestResult] = useState({});
  const [startOpen, setStartOpen] = useState("");
  const [startQueries, setStartQueries] = useState("");
  const [runsOpen, setRunsOpen] = useState("");
  const [runsData, setRunsData] = useState({});
  const sources = data?.sources || [];

  // While a run is actually in progress, refresh its panel every couple of seconds so progress
  // is visible live instead of needing a manual Hide/Runs click to see anything update. Must run
  // on every render (not after the "!data" return below) -- a hook skipped on some renders and
  // not others breaks React's Rules of Hooks and crashes the whole page.
  useEffect(() => {
    if (!runsOpen) return undefined;
    const current = sources.find((s) => s.id === runsOpen);
    if (!current || current.runState !== "running") return undefined;
    const id = setInterval(async () => {
      const r = await adminApi.dataSourceRuns(runsOpen);
      setRunsData((d) => ({ ...d, [runsOpen]: r.runs || [] }));
      reload();
    }, 2500);
    return () => clearInterval(id);
  }, [runsOpen, sources, reload]);

  if (!data) return <Note error={err}>{err}</Note>;

  const startRun = (s) => run(async () => {
    const queries = startQueries.split("\n").map((q) => q.trim()).filter(Boolean);
    if (!queries.length) throw new Error("Enter at least one search term, one per line.");
    const r = await adminApi.startDataSource(s.id, queries);
    setStartOpen("");
    setStartQueries("");
    setRunsOpen(s.id); // jump straight to watching it, so it's obvious something's happening
    const runs = await adminApi.dataSourceRuns(s.id);
    setRunsData((d) => ({ ...d, [s.id]: runs.runs || [] }));
    return r;
  }, `Started -- working through the list now. Watch it below, or "docker compose logs -f backend" on the server.`);

  const toggleRuns = async (s) => {
    if (runsOpen === s.id) {
      setRunsOpen("");
      return;
    }
    setRunsOpen(s.id);
    const r = await adminApi.dataSourceRuns(s.id);
    setRunsData((d) => ({ ...d, [s.id]: r.runs || [] }));
  };

  const toBody = (d) => {
    let config;
    try {
      config = JSON.parse(d.config || "{}");
    } catch (_) {
      throw new Error("Config must be valid JSON.");
    }
    return {
      name: d.name.trim(), kind: d.kind, baseUrl: d.baseUrl.trim(), authType: d.authType, apiKey: d.apiKey.trim(),
      config, providesFields: d.providesFields.split(",").map((f) => f.trim()).filter(Boolean),
      maxConcurrentRequests: Number(d.maxConcurrentRequests) || 1, minDelayMs: Number(d.minDelayMs) || 0, status: d.status,
    };
  };

  const edit = (s) => {
    setOpen(s.id);
    setDraft({
      name: s.name, kind: s.kind, baseUrl: s.baseUrl, authType: s.authType, apiKey: "",
      config: JSON.stringify(s.config || {}, null, 2), providesFields: (s.providesFields || []).join(", "),
      maxConcurrentRequests: s.maxConcurrentRequests, minDelayMs: s.minDelayMs, status: s.status,
    });
  };

  const save = (id) => run(() => {
    if (!draft.name.trim()) throw new Error("A data source needs a name.");
    const body = toBody(draft);
    return (id ? adminApi.updateDataSource(id, body) : adminApi.createDataSource(body)).then((r) => { setOpen(""); return r; });
  }, id ? "Saved." : "Added.");

  const remove = (s) => {
    if (window.confirm(`Remove ${s.name}? Anything already saved from it stays; it just won't be fetched from again.`)) {
      run(() => adminApi.deleteDataSource(s.id), `${s.name} removed.`);
    }
  };

  const control = (s, action) => run(async () => {
    const r = await adminApi.controlDataSource(s.id, action);
    if (action === "test") setTestResult((t) => ({ ...t, [s.id]: r }));
    return r;
  }, action === "test" ? "Tested." : `${action === "pause" ? "Paused" : action === "resume" ? "Resumed" : "Stopped"}.`);

  const runStateTone = (state) => (state === "running" ? "green" : state === "error" || state === "stuck" ? "red" : state === "paused" ? "amber" : undefined);

  const EXAMPLE_CONFIG = {
    api: JSON.stringify({
      trust_tier: "verified_registry", search_endpoint: "/search?q=", search_param: "q",
      search_items_path: "items", id_field_from_search: "id", profile_endpoint: "/items/{id}",
      test_query: "a real example this API should actually find",
      field_map: { name: "title", registration_number: "id", address: "address", industry: "category" },
    }, null, 2),
    scrape: JSON.stringify({ trust_tier: "scraped", url_template: "https://example.com/search?q={query}" }, null, 2),
  };

  const field = (label, hint, children) => (
    <div style={{ display: "grid", gap: 2 }}>
      <label style={{ fontSize: 11.5, fontWeight: 600, color: C.textInk }}>{label}</label>
      {children}
      {hint && <div style={{ fontSize: 11, color: C.slate }}>{hint}</div>}
    </div>
  );

  const form = (id) => (
    <div style={{ display: "grid", gap: 10, marginTop: 8 }}>
      {field("Name", "Shown on the card above -- anything descriptive, e.g. \"Companies House\" or \"Yellow Pages\".",
        <input aria-label="Source name" placeholder="e.g. Companies House" value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })} style={input} />)}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {field("Kind", "\"api\" if the site gives you a real API with a key; \"scrape\" if there's no API and we read the page instead.",
          <select aria-label="Kind" value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })} style={{ ...input, minWidth: 120 }}>
            <option value="api">api</option>
            <option value="scrape">scrape</option>
          </select>)}
        {field("Auth type", "How the key is sent. Most REST APIs use \"api_key_header\" or \"bearer\" -- check that API's own docs.",
          <select aria-label="Auth type" value={draft.authType} onChange={(e) => setDraft({ ...draft, authType: e.target.value })} style={{ ...input, minWidth: 170 }}>
            <option value="none">none -- no key needed</option>
            <option value="api_key_basic">api_key_basic -- key as HTTP Basic username</option>
            <option value="api_key_header">api_key_header -- key in a custom header</option>
            <option value="bearer">bearer -- "Authorization: Bearer &lt;key&gt;"</option>
          </select>)}
        {field("Status", "\"active\" to let it be used; \"disabled\" to keep it saved but switched off.",
          <input aria-label="Status" placeholder="active" value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })} style={{ ...input, minWidth: 100 }} />)}
      </div>
      {field("Base URL", "The API's root address, no trailing slash -- e.g. https://api.example.com (endpoints below are relative to this).",
        <input aria-label="Base URL" placeholder="https://api.example.com" value={draft.baseUrl} onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })} style={input} />)}
      {field("API key", "Paste it here, not in the config JSON -- this field is the one place it's actually used for auth.",
        <input aria-label="API key" type="password" autoComplete="off" placeholder={id ? "New key (empty = keep saved one)" : "API key"}
          value={draft.apiKey} onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })} style={{ ...input, ...mono }} />)}
      {field("Fields this source can fill", "Comma-separated, just for your own reference when more than one source could answer the same question -- e.g. name, address, industry.",
        <input aria-label="Provides fields" placeholder="name, address, industry" value={draft.providesFields}
          onChange={(e) => setDraft({ ...draft, providesFields: e.target.value })} style={input} />)}
      <div style={{ display: "flex", gap: 6 }}>
        {field("Max concurrent", "How many requests to this source at once -- keep this low (2-5) unless the API's own docs say it allows more.",
          <input aria-label="Max concurrent requests" type="number" min="1" value={draft.maxConcurrentRequests}
            onChange={(e) => setDraft({ ...draft, maxConcurrentRequests: e.target.value })} style={{ ...input, minWidth: 100 }} />)}
        {field("Delay between requests (ms)", "A pause between requests, so a slow/free site isn't hammered.",
          <input aria-label="Delay between requests (ms)" type="number" min="0" value={draft.minDelayMs}
            onChange={(e) => setDraft({ ...draft, minDelayMs: e.target.value })} style={{ ...input, minWidth: 100 }} />)}
      </div>
      {field(
        <>Config (JSON) <button type="button" style={{ ...btn(false), fontSize: 10.5, padding: "1px 6px", marginLeft: 8 }}
          onClick={() => setDraft({ ...draft, config: EXAMPLE_CONFIG[draft.kind] })}>Insert an example for "{draft.kind}"</button></>,
        draft.kind === "api"
          ? "For an api source: search_endpoint + search_param (how to search), search_items_path (where the results list sits in the response), profile_endpoint (optional -- a details page per result), field_map (which field in the response becomes each saved fact), and test_query (a real term the Test button should actually find)."
          : "For a scrape source: url_template with {query} where the search term goes -- e.g. https://example.com/search?q={query}. The page is read and an AI pulls out the facts, so no field_map is needed here.",
        <textarea aria-label="Config JSON" placeholder={EXAMPLE_CONFIG[draft.kind]} value={draft.config}
          onChange={(e) => setDraft({ ...draft, config: e.target.value })} rows={9} style={{ ...input, ...mono, fontSize: 11.5 }} />
      )}
      <div style={{ display: "flex", gap: 6 }}>
        <button type="button" style={btn(true)} onClick={() => save(id)}>Save</button>
        <button type="button" style={btn(false)} onClick={() => setOpen("")}>Cancel</button>
      </div>
    </div>
  );

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ fontSize: 12.5, color: C.slate }}>
        Public company data the platform can look up or scrape -- shared across every organisation (see BusinessRecord).
        Paste an API key here to turn a source on; adding a new site is a form, not a deploy.
      </div>
      <Note error={msg.error}>{msg.text}</Note>
      {sources.map((s) => {
        const isOpen = open === s.id;
        const test = testResult[s.id];
        return (
          <div key={s.id} style={{ ...card, display: "grid", gap: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <div style={{ fontWeight: 700 }}>{s.name}</div>
              <Pill>{s.kind}</Pill>
              {s.hasKey ? <Pill tone="green">Key saved</Pill> : <Pill tone="amber">No key</Pill>}
              <Pill tone={runStateTone(s.runState)}>{s.runState}</Pill>
              {s.status !== "active" && <Pill>{s.status}</Pill>}
            </div>
            {s.lastError && <div style={{ fontSize: 12, color: C.red || "#c0392b" }}>Last error: {s.lastError}</div>}
            {test && (
              <div style={{ fontSize: 12, color: test.ok ? (test.hits ? "#15803d" : C.slate) : (C.red || "#c0392b") }}>
                {test.ok
                  ? (test.hits ? `Test OK -- found ${test.hits} result(s), e.g. "${test.sample?.title || test.sample?.name || JSON.stringify(test.sample || {}).slice(0, 60)}".` : test.note)
                  : `Test failed: ${test.error}`}
              </div>
            )}
            <div style={mono}>{s.baseUrl}</div>
            {canEdit && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button type="button" style={btn(false)} onClick={() => control(s, "test")}>Test</button>
                {s.runState === "running" && (
                  <>
                    <button type="button" style={btn(false)} onClick={() => control(s, "pause")}>Pause</button>
                    <button type="button" style={btn(false)} onClick={() => control(s, "stop")}>Stop</button>
                  </>
                )}
                {s.runState === "paused" && (
                  <>
                    <button type="button" style={btn(false)} onClick={() => control(s, "resume")}>Resume</button>
                    <button type="button" style={btn(false)} onClick={() => control(s, "stop")}>Stop</button>
                  </>
                )}
                {s.runState !== "running" && s.runState !== "paused" && (
                  <button type="button" style={btn(true)} onClick={() => { setStartOpen(s.id); setStartQueries(""); }}>Start a run</button>
                )}
                <button type="button" style={btn(false)} onClick={() => toggleRuns(s)}>{runsOpen === s.id ? "Hide runs" : "Runs"}</button>
                <button type="button" style={btn(false)} onClick={() => edit(s)}>Edit</button>
                <button type="button" style={btn(false)} onClick={() => remove(s)}>Remove</button>
              </div>
            )}
            {startOpen === s.id && (
              <div style={{ display: "grid", gap: 6, marginTop: 4 }}>
                <div style={{ fontSize: 11.5, color: C.slate }}>
                  One search term per line -- company names, keywords, whatever this source searches by. Each one is looked up and saved; you can Pause or Stop partway through.
                </div>
                <textarea aria-label="Search terms, one per line" placeholder={"Tesco\nSainsbury's\nAsda"} value={startQueries}
                  onChange={(e) => setStartQueries(e.target.value)} rows={5} style={{ ...input, ...mono, fontSize: 12 }} />
                <div style={{ display: "flex", gap: 6 }}>
                  <button type="button" style={btn(true)} onClick={() => startRun(s)}>Start</button>
                  <button type="button" style={btn(false)} onClick={() => setStartOpen("")}>Cancel</button>
                </div>
              </div>
            )}
            {runsOpen === s.id && (
              <div style={{ display: "grid", gap: 4, marginTop: 4, borderTop: `1px solid ${C.border}`, paddingTop: 6 }}>
                {(runsData[s.id] || []).length === 0 && <div style={{ fontSize: 12, color: C.slate }}>No runs yet.</div>}
                {(runsData[s.id] || []).map((r) => (
                  <div key={r.id} style={{ fontSize: 11.5, color: C.slate, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <Pill tone={r.status === "done" ? "green" : r.status === "error" || r.status === "stuck" ? "red" : r.status === "running" ? "green" : undefined}>{r.status}</Pill>
                    <span>{r.total ? `${r.recordsFound}/${r.total} processed, ${r.recordsNew} new` : `found ${r.recordsFound}, new ${r.recordsNew}`}</span>
                    {r.status === "running" && r.currentQuery && <span style={{ fontStyle: "italic" }}>now: "{r.currentQuery}"</span>}
                    <span>{r.startedAt ? new Date(r.startedAt).toLocaleString() : ""}</span>
                    {r.errorMessage && <span style={{ color: C.red || "#c0392b" }}>{r.errorMessage}</span>}
                  </div>
                ))}
              </div>
            )}
            {isOpen && form(s.id)}
          </div>
        );
      })}
      {canEdit && (open === "+" ? (
        <div style={card}>{form("")}</div>
      ) : (
        <button type="button" style={{ ...btn(false), justifySelf: "start" }} onClick={() => { setOpen("+"); setDraft(emptyDataSource); }}>
          Add a data source
        </button>
      ))}
    </div>
  );
}

const CONFIDENCE_TONE = { verified_registry: "green", scraped: undefined, llm_fallback: "amber" };

// The shared BusinessRecord store, in a table -- so staff can actually see what scraping has
// produced, and search it the same way a user's question would be matched, to check whether a
// company is in there at all when someone says "I asked and got nothing."
const PAGE_SIZE = 50;

function BusinessRecordsBrowser() {
  const [q, setQ] = useState("");
  const [searched, setSearched] = useState("");
  const [page, setPage] = useState(0);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = async (term, pageNum) => {
    setLoading(true);
    setError("");
    try {
      const r = await adminApi.businessRecords(term, PAGE_SIZE, pageNum * PAGE_SIZE);
      setData(r);
      setSearched(term);
      setPage(pageNum);
    } catch (e) {
      setError(e.message || "Couldn't load.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load("", 0); }, []);

  const records = data?.records || [];
  const total = data?.total || 0;
  const from = total ? page * PAGE_SIZE + 1 : 0;
  const to = Math.min(total, (page + 1) * PAGE_SIZE);

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ fontSize: 12.5, color: C.slate }}>
        Every company fact actually saved so far, shared across every organisation. Search it the same way a
        user's question would match -- name, domain, registration number, industry, region, email or phone.
      </div>
      <form onSubmit={(e) => { e.preventDefault(); load(q, 0); }} style={{ display: "flex", gap: 6 }}>
        <input aria-label="Search scraped data" placeholder="Search by name, domain, industry, region..." value={q}
          onChange={(e) => setQ(e.target.value)} style={{ ...input, flex: 1 }} />
        <button type="submit" style={btn(true)}>Search</button>
        {searched && <button type="button" style={btn(false)} onClick={() => { setQ(""); load("", 0); }}>Clear</button>}
      </form>
      <Note error={error}>{error}</Note>
      {data && (
        <div style={{ fontSize: 11.5, color: C.slate, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span>
            {total ? `Showing ${from}-${to} of ${total}` : "0"} {searched ? `match(es) for "${searched}"` : "record(s) total"}
            {searched && total === 0 && ' -- nothing found for this. If a user says they asked about this and got nothing, this confirms it was never found by any source yet.'}
          </span>
          {total > PAGE_SIZE && (
            <span style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
              <button type="button" style={btn(false)} disabled={page === 0} onClick={() => load(searched, page - 1)}>Previous</button>
              <button type="button" style={btn(false)} disabled={to >= total} onClick={() => load(searched, page + 1)}>Next</button>
            </span>
          )}
        </div>
      )}
      {loading ? <div style={{ fontSize: 12.5, color: C.slate }}>Loading…</div> : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: `1px solid ${C.border}` }}>
                {["Name", "Reg #", "Domain", "Industry", "Region", "Confidence", "Sources", "Updated"].map((h) => (
                  <th key={h} style={{ padding: "6px 8px", color: C.slate, fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                  <td style={{ padding: "6px 8px", fontWeight: 600 }}>{r.name}</td>
                  <td style={{ padding: "6px 8px", ...mono }}>{r.registration_number || "—"}</td>
                  <td style={{ padding: "6px 8px" }}>{r.domain || "—"}</td>
                  <td style={{ padding: "6px 8px" }}>{r.industry || "—"}</td>
                  <td style={{ padding: "6px 8px" }}>{r.region || "—"}</td>
                  <td style={{ padding: "6px 8px" }}><Pill tone={CONFIDENCE_TONE[r.confidence_tier]}>{r.confidence_tier}</Pill></td>
                  <td style={{ padding: "6px 8px" }}>{(r.sources || []).length}</td>
                  <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{r.fetched_at ? new Date(r.fetched_at).toLocaleDateString() : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
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
