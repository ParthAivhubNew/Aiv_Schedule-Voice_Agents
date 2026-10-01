import React, { useEffect, useState } from "react";
import { C } from "../tokens";
import { adminApi } from "./adminApi";
import { Note, PageTitle, Pill, btn, card, heading, input, mono, useAction, useLoad } from "./ui";

const LABELS = { openai: "OpenAI", anthropic: "Anthropic (Claude)", deepseek: "DeepSeek", groq: "Groq", gemini: "Google Gemini",
  xai: "xAI (Grok)", fal: "fal (FLUX)", stability: "Stability AI", pollinations: "Pollinations (free, no key)" };

// The writing and image AI every client's Post scheduler uses. Empty = automatic (the first
// key OutReach saved), as before. Keys are saved in OutReach's own AI config.
export function PlatformAi({ canEdit }) {
  const [data, err, reload] = useLoad(adminApi.platformAi);
  const [draft, setDraft] = useState(null);
  const [msg, run] = useAction(reload);
  useEffect(() => { if (data) setDraft(data.chosen); }, [data]);

  if (!data || !draft) return <><PageTitle title="Platform AI" /><Note error>{err}</Note></>;
  const keyNote = (kind, p) => {
    if (!p) return null;
    if (p === "pollinations") return <Pill tone="amber">No key needed; quality and commercial terms not guaranteed</Pill>;
    return data.keys[kind].some((k) => k.includes(p)) ? <Pill tone="green">Key saved</Pill> : <Pill tone="red">No key saved yet</Pill>;
  };
  const row = (label, kind, providerField, modelField, options) => (
    <div style={{ ...card, display: "grid", gap: 10 }}>
      <div style={{ fontWeight: 700 }}>{label}</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <select aria-label={`${label} provider`} value={draft[providerField]} disabled={!canEdit}
          onChange={(e) => setDraft({ ...draft, [providerField]: e.target.value })} style={input}>
          <option value="">Automatic (first key saved)</option>
          {options.map((p) => <option key={p} value={p}>{LABELS[p] || p}</option>)}
        </select>
        <input aria-label={`${label} model`} placeholder="Model (empty = provider default)" value={draft[modelField]} disabled={!canEdit}
          onChange={(e) => setDraft({ ...draft, [modelField]: e.target.value })} style={{ ...input, minWidth: 240, flex: 1 }} />
        {keyNote(kind, draft[providerField])}
      </div>
    </div>
  );
  return (
    <>
      <PageTitle title="Platform AI" sub="What every client's Post scheduler writes and draws with. Clients cannot change it." />
      <Note error={msg.error}>{msg.text}</Note>
      <div style={{ display: "grid", gap: 12 }}>
        {row("Writing (captions and posts)", "text", "textProvider", "textModel", data.textProviders)}
        {row("Images", "image", "imageProvider", "imageModel", data.imageProviders)}
      </div>
      {canEdit && (
        <button type="button" style={{ ...btn(true), marginTop: 12 }} onClick={() => run(() => adminApi.setPlatformAi(draft), "Saved. Clients use this from their next post.")}>
          Save
        </button>
      )}
      <VoiceCatalogue canEdit={canEdit} />

      <div style={heading}>Keys</div>
      <div style={{ fontSize: 12.5, color: C.slate, maxWidth: 680 }}>
        Provider keys are saved in OutReach's own organisation (sign in to the app as an OutReach admin → AI configuration).
        Saved now — writing: {data.keys.text.join(", ") || "none"}; images: {data.keys.image.join(", ") || "none"}.
      </div>
    </>
  );
}

const EMPTY = { voices: [], models: [] };

// The voices and models clients may pick for their call assistant in Agent Studio. Use the
// names exactly as Telnyx shows them (e.g. in the Telnyx portal's assistant voice list).
function VoiceCatalogue({ canEdit }) {
  const [data, err, reload] = useLoad(adminApi.voiceCatalogue);
  const [draft, setDraft] = useState(EMPTY);
  const [msg, run] = useAction(reload);
  useEffect(() => { if (data) setDraft(data); }, [data]);

  const edit = (kind, i, patch) => setDraft({ ...draft, [kind]: draft[kind].map((row, j) => (j === i ? { ...row, ...patch } : row)) });
  const remove = (kind, i) => setDraft({ ...draft, [kind]: draft[kind].filter((_, j) => j !== i) });
  const add = (kind) => setDraft({ ...draft, [kind]: [...draft[kind], kind === "voices" ? { id: "", label: "", sample: "" } : { id: "", label: "" }] });
  const rows = (kind, fields) => (
    <div style={{ display: "grid", gap: 6 }}>
      {draft[kind].map((row, i) => (
        <div key={i} style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {fields.map(([f, ph, w]) => (
            <input key={f} aria-label={`${kind} ${f} ${i + 1}`} placeholder={ph} value={row[f] || ""} disabled={!canEdit}
              onChange={(e) => edit(kind, i, { [f]: e.target.value })} style={{ ...input, ...(f === "id" ? mono : {}), flex: `1 1 ${w}px` }} />
          ))}
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
