import React, { useEffect, useState } from "react";
import { C } from "../tokens";
import { adminApi } from "./adminApi";
import { Note, PageTitle, Pill, btn, card, heading, input, mono, useAction, useLoad } from "./ui";

const LABELS = { openai: "OpenAI", anthropic: "Anthropic (Claude)", deepseek: "DeepSeek", groq: "Groq", gemini: "Google Gemini",
  xai: "xAI (Grok)", fal: "fal (FLUX)", stability: "Stability AI", pollinations: "Pollinations (free, no key)" };

const when = (iso) => (iso ? new Date(iso + "Z").toLocaleString() : "");

// The writing and image AI every company's Post scheduler uses: a main provider and an optional
// backup for each. When the main fails and a backup is set, the backup is used straight away;
// with no backup, only the main is used. Keys are set on the Platform keys page.
export function PlatformAi({ canEdit, scope = "scheduler", showCatalogue = true, showKeys = true }) {
  const loadFn = React.useCallback(() => adminApi.platformAi(scope), [scope]);
  const [data, err, reload] = useLoad(loadFn, [loadFn]);
  const [draft, setDraft] = useState(null);
  const [msg, run] = useAction(reload);
  const [tests, setTests] = useState({});
  useEffect(() => { if (data) setDraft(data.chosen); }, [data]);

  if (!data || !draft) return <><PageTitle title="Platform AI" /><Note error>{err}</Note></>;
  const keyNote = (kind, p) => {
    if (!p) return null;
    if (p === "pollinations") return <Pill tone="amber">No key needed; quality and commercial terms not guaranteed</Pill>;
    return (data.keys?.[kind] || []).some((k) => k.includes(p)) ? <Pill tone="green">Key saved</Pill> : <Pill tone="red">No key saved yet</Pill>;
  };
  const testIt = async (kind, slot) => {
    const id = `${kind}-${slot}`;
    setTests((t) => ({ ...t, [id]: { busy: true } }));
    const out = await run(() => adminApi.testPlatformAi(scope, kind, slot));
    setTests((t) => ({ ...t, [id]: out || { ok: false, error: "Test could not run." } }));
  };
  const status = (kind, slot) => {
    const t = tests[`${kind}-${slot}`];
    if (t && t.busy) return <Pill>Testing…</Pill>;
    if (t) return t.ok ? <Pill tone="green">Works ({[t.provider, t.model].filter(Boolean).join(" · ")})</Pill> : <Pill tone="red">{t.error}</Pill>;
    const h = ((data.health || {})[kind] || {})[slot] || {};
    const okAt = h.lastOkAt || "";
    const errAt = h.lastErrorAt || "";
    if (errAt && errAt > okAt) return <Pill tone="red">Last failed {when(errAt)}: {h.lastError}</Pill>;
    if (okAt) return <Pill tone="green">Last worked {when(okAt)}</Pill>;
    return null;
  };
  const slotRow = (kind, slot, options) => {
    const pf = `${kind}${slot === "backup" ? "Backup" : ""}Provider`;
    const mf = `${kind}${slot === "backup" ? "Backup" : ""}Model`;
    const isBackup = slot === "backup";
    return (
      <div style={{ display: "grid", gap: 6 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: C.slate }}>{isBackup ? "Backup (used only when the main fails)" : "Main"}</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select aria-label={`${kind} ${slot} provider`} value={draft[pf]} disabled={!canEdit}
            onChange={(e) => setDraft({ ...draft, [pf]: e.target.value, ...(isBackup && !e.target.value ? { [mf]: "" } : {}) })} style={input}>
            <option value="">{isBackup ? "No backup" : "Automatic (first key saved)"}</option>
            {options.map((p) => <option key={p} value={p}>{LABELS[p] || p}</option>)}
          </select>
          <input aria-label={`${kind} ${slot} model`} placeholder="Model (empty = provider default)" value={draft[mf]}
            disabled={!canEdit || (isBackup && !draft[pf])}
            onChange={(e) => setDraft({ ...draft, [mf]: e.target.value })} style={{ ...input, minWidth: 220, flex: 1 }} />
          {keyNote(kind, draft[pf])}
          {canEdit && (!isBackup || draft[pf]) && (
            <button type="button" style={btn(false)} onClick={() => testIt(kind, slot)}
              title="Saves nothing. Tests what is saved now.">Test saved</button>
          )}
        </div>
        <div>{status(kind, slot)}</div>
      </div>
    );
  };
  const block = (label, kind, options) => (
    <div style={{ ...card, display: "grid", gap: 14 }}>
      <div style={{ fontWeight: 700 }}>{label}</div>
      {slotRow(kind, "main", options)}
      {slotRow(kind, "backup", options)}
    </div>
  );
  return (
    <>
      <Note error={msg.error}>{msg.text}</Note>
      <div style={{ display: "grid", gap: 12 }}>
        {block(scope === "voice" ? "Conversation AI (Call reasoning)" : scope === "leadgen" ? "Reasoning AI (Enrichment LLM)" : "Writing (captions, posts and Plan AI)", "text", data.textProviders || [])}
        {scope === "scheduler" && block("Images", "image", data.imageProviders || [])}
      </div>
      {canEdit && (
        <button type="button" style={{ ...btn(true), marginTop: 12 }} onClick={() => run(() => adminApi.setPlatformAi(scope, draft), "Saved.")}>
          Save AI settings
        </button>
      )}
      {scope === "voice" && showCatalogue && <VoiceCatalogue canEdit={canEdit} />}

      {showKeys && (
        <>
          <div style={heading}>Keys</div>
          <div style={{ fontSize: 12.5, color: C.slate, maxWidth: 680 }}>
            Provider keys are set in the Shared keys pool (LLM for text reasoning, IMAGE for images). Only these keys are ever used.
            Saved now — text: {(data.keys?.text || []).join(", ") || "none"}; images: {(data.keys?.image || []).join(", ") || "none"}.
          </div>
        </>
      )}
    </>
  );
}

const EMPTY = { voices: [], models: [] };

// The voices and models clients may pick for their call assistant in Agent Studio. Use the
// names exactly as Telnyx shows them (e.g. in the Telnyx portal's assistant voice list).
function VoiceCatalogue({ canEdit }) {
  const [data, err, reload] = useLoad(adminApi.voiceCatalogue);
  const [clients] = useLoad(adminApi.clients);
  const [draft, setDraft] = useState(EMPTY);
  const [msg, run] = useAction(reload);
  useEffect(() => { if (data) setDraft(data); }, [data]);

  const edit = (kind, i, patch) => setDraft({ ...draft, [kind]: draft[kind].map((row, j) => (j === i ? { ...row, ...patch } : row)) });
  const remove = (kind, i) => setDraft({ ...draft, [kind]: draft[kind].filter((_, j) => j !== i) });
  const add = (kind) => setDraft({ ...draft, [kind]: [...draft[kind], kind === "voices" ? { id: "", label: "", sample: "", org: "" } : { id: "", label: "" }] });
  const rows = (kind, fields) => (
    <div style={{ display: "grid", gap: 6 }}>
      {draft[kind].map((row, i) => (
        <div key={i} style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {fields.map(([f, ph, w]) => (
            <input key={f} aria-label={`${kind} ${f} ${i + 1}`} placeholder={ph} value={row[f] || ""} disabled={!canEdit}
              onChange={(e) => edit(kind, i, { [f]: e.target.value })} style={{ ...input, ...(f === "id" ? mono : {}), flex: `1 1 ${w}px` }} />
          ))}
          {kind === "voices" && (
            <select aria-label={`voices client ${i + 1}`} value={row.org || ""} disabled={!canEdit} title="A client's own cloned voice: only that client sees it"
              onChange={(e) => edit(kind, i, { org: e.target.value })} style={{ ...input, flex: "1 1 170px" }}>
              <option value="">Every client</option>
              {(clients || []).map((o) => <option key={o.id} value={o.id}>Only {o.name}</option>)}
            </select>
          )}
          {canEdit && <button type="button" style={btn(false)} onClick={() => remove(kind, i)}>Remove</button>}
        </div>
      ))}
      {canEdit && <button type="button" style={{ ...btn(false), justifySelf: "start" }} onClick={() => add(kind)}>Add {kind === "voices" ? "a voice" : "a model"}</button>}
    </div>
  );
  return (
    <>
      <div style={heading}>Call assistant voices and models (Agent Studio)</div>
      <Note error>{err}</Note>
      <Note error={msg.error}>{msg.text}</Note>
      <div style={{ ...card, display: "grid", gap: 12 }}>
        <div style={{ fontSize: 12.5, color: C.slate }}>
          What clients can choose for their call assistant. Use Telnyx's exact names. A sample is an https link to a short recording clients can play.
          A client's cloned voice: clone it in the Telnyx portal, paste its voice ID here and set "Only" to that client, so no other client sees it.
          Nothing listed: everyone uses Telnyx's default.
        </div>
        <div style={{ fontWeight: 700, fontSize: 13 }}>Voices</div>
        {rows("voices", [["id", "Telnyx voice name, e.g. Telnyx.NaturalHD.astra", 240], ["label", "Label clients see", 160], ["sample", "https://… sample (optional)", 200]])}
        <div style={{ fontWeight: 700, fontSize: 13 }}>Models</div>
        {rows("models", [["id", "Telnyx model name", 240], ["label", "Label clients see", 160]])}
        {canEdit && (
          <button type="button" style={{ ...btn(true), justifySelf: "start" }}
            onClick={() => run(() => adminApi.setVoiceCatalogue({ voices: draft.voices.filter((v) => v.id.trim()), models: draft.models.filter((m) => m.id.trim()) }), "Saved.")}>
            Save voices and models
          </button>
        )}
      </div>
    </>
  );
}
