import React, { useEffect, useState } from "react";
import { C } from "../tokens";
import { adminApi } from "./adminApi";
import { Note, PageTitle, Pill, btn, card, heading, input, useAction, useLoad } from "./ui";

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
      <div style={heading}>Keys</div>
      <div style={{ fontSize: 12.5, color: C.slate, maxWidth: 680 }}>
        Provider keys are saved in OutReach's own organisation (sign in to the app as an OutReach admin → AI configuration).
        Saved now — writing: {data.keys.text.join(", ") || "none"}; images: {data.keys.image.join(", ") || "none"}.
      </div>
    </>
  );
}
