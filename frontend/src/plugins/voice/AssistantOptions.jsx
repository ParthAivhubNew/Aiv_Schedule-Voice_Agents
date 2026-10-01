import React, { useMemo, useState } from "react";
import { Mic, Plus, Trash2, Upload } from "lucide-react";
import { C, FONT_BODY, FONT_DISPLAY } from "../../tokens";
import { api } from "../../api/apiClient";

export const box = { background: "#fff", border: `1px solid ${C.border}`, borderRadius: 14, padding: 18, display: "grid", gap: 12 };
export const input = { padding: "8px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13, fontFamily: FONT_BODY, background: "#fff", boxSizing: "border-box", width: "100%" };
export const label = { display: "grid", gap: 5, fontSize: 12, fontWeight: 600, color: C.slate };
export const btn = (primary, disabled) => ({
  display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 14px", borderRadius: 9, cursor: disabled ? "not-allowed" : "pointer",
  border: primary ? "none" : `1px solid ${C.border}`, background: primary ? C.ink : "#fff", color: primary ? "#fff" : C.textInk,
  fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, opacity: disabled ? 0.55 : 1, justifySelf: "start",
});
const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 };
const check = { display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13 };
const hint = { fontSize: 11.5, color: C.slate, fontWeight: 400 };
// "" in any choice means Telnyx picks; after a sync we know what it picked.
const telnyxDefault = (picked) => `Telnyx default${picked ? ` (${picked})` : ""}`;

// How the user's own assistant speaks and listens: every voice, model and speech-to-text engine
// Telnyx offers. Voices are many, so they are narrowed by provider and language first.
export function VoiceFields({ catalogue, me, setMe, effective = {} }) {
  const [provider, setProvider] = useState("");
  const [lang, setLang] = useState("");
  const s = me.settings;
  const set = (patch) => setMe({ ...me, settings: { ...s, ...patch } });
  const providers = useMemo(() => [...new Set(catalogue.voices.map((v) => v.provider || "other"))], [catalogue.voices]);
  const languages = useMemo(() => [...new Set(catalogue.voices.map((v) => v.language).filter(Boolean))].sort(), [catalogue.voices]);
  const shown = catalogue.voices.filter((v) => v.id === me.voice
    || ((!provider || (v.provider || "other") === provider) && (!lang || v.language === lang)));
  const stt = (catalogue.stt || []).find((m) => m.id === s.sttModel);
  const sttLanguages = stt?.languages?.length ? stt.languages : [];

  return (
    <>
      <div style={grid}>
        <label style={label}>Voice provider
          <select aria-label="Voice provider" value={provider} onChange={(e) => setProvider(e.target.value)} style={input}>
            <option value="">All ({catalogue.voices.length} voices)</option>
            {providers.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label style={label}>Voice language
          <select aria-label="Voice language" value={lang} onChange={(e) => setLang(e.target.value)} style={input}>
            <option value="">Any language</option>
            {languages.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </label>
        <label style={label}>Voice
          <select aria-label="Voice" value={me.voice} onChange={(e) => setMe({ ...me, voice: e.target.value })} style={input}>
            <option value="">{telnyxDefault(effective.voice)}</option>
            {shown.slice(0, 500).map((v) => (
              <option key={v.id} value={v.id}>{v.label}{v.private ? " (your company's voice)" : ""}{v.language ? ` · ${v.language}` : ""}{v.gender ? ` · ${v.gender}` : ""}</option>
            ))}
          </select>
        </label>
        <label style={label}>Thinking model
          <select aria-label="Model" value={me.model} onChange={(e) => setMe({ ...me, model: e.target.value })} style={input}>
            <option value="">{telnyxDefault(effective.model)}</option>
            {catalogue.models.map((m) => <option key={m.id} value={m.id}>{m.label}{m.price ? ` · ${m.price}` : ""}</option>)}
          </select>
        </label>
        <label style={label}>Speaking speed: {Number(s.voiceSpeed).toFixed(2)}×
          <input aria-label="Speaking speed" type="range" min="0.5" max="2" step="0.05" value={s.voiceSpeed} onChange={(e) => set({ voiceSpeed: Number(e.target.value) })} />
        </label>
        <label style={label}>Background sound
          <div style={{ display: "flex", gap: 6 }}>
            <select aria-label="Background sound" value={s.background} onChange={(e) => set({ background: e.target.value })} style={input}>
              <option value="">Silence</option>
              <option value="office">Office</option>
            </select>
            {s.background && <input aria-label="Background volume" type="range" min="0.1" max="1" step="0.1" value={s.backgroundVolume} onChange={(e) => set({ backgroundVolume: Number(e.target.value) })} />}
          </div>
        </label>
        <label style={label}>Speech-to-text (how it hears)
          <select aria-label="Speech to text" value={s.sttModel} onChange={(e) => set({ sttModel: e.target.value, language: "" })} style={input}>
            <option value="">{telnyxDefault(effective.sttModel)}</option>
            {(catalogue.stt || []).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </label>
        <label style={label}>Language it listens for
          {sttLanguages.length ? (
            <select aria-label="Listening language" value={s.language} onChange={(e) => set({ language: e.target.value })} style={input}>
              <option value="">Detect automatically</option>
              {sttLanguages.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          ) : (
            <input aria-label="Listening language" placeholder="Detect automatically (or e.g. en)" value={s.language} onChange={(e) => set({ language: e.target.value })} style={input} />
          )}
        </label>
      </div>
      {me.voice.startsWith("Telnyx.Ultra.") && (
        <label style={check}>
          <input type="checkbox" aria-label="Expressive" checked={s.expressive} onChange={(e) => set({ expressive: e.target.checked })} style={{ marginTop: 3 }} />
          <span>Expressive <span style={hint}>(laughs and emotion in the voice)</span></span>
        </label>
      )}
    </>
  );
}

// How every call behaves (admins). Same settings as Telnyx's assistant, in plain words.
export function BehaviourFields({ a, set }) {
  const transfers = a.transfers || [];
  const setRow = (i, patch) => set({ transfers: transfers.map((t, j) => (j === i ? { ...t, ...patch } : t)) });
  const toggle = (key, text, note) => (
    <label style={check}>
      <input type="checkbox" aria-label={text} checked={!!a[key]} onChange={(e) => set({ [key]: e.target.checked })} style={{ marginTop: 3 }} />
      <span>{text}{note && <span style={hint}> ({note})</span>}</span>
    </label>
  );
  return (
    <div style={{ display: "grid", gap: 12, borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
      <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 13.5, color: C.textInk }}>How every call behaves</div>
      <div style={grid}>
        {toggle("speaksFirst", "Agent speaks first", "off: waits for the other person")}
        {toggle("interruptions", "People can interrupt the agent")}
        {toggle("noGreetingInterrupt", "Nobody can interrupt the greeting")}
        {toggle("textCaller", "Agent can text the caller during the call")}
        {toggle("keepData", "Keep conversation history", "off: Telnyx keeps no transcript or insights")}
      </div>
      <div style={grid}>
        <label style={label}>Ask "are you still there?" after (seconds of silence)
          <input aria-label="Silence check-in seconds" type="number" min="0" max="600" value={a.idleReplySecs} onChange={(e) => set({ idleReplySecs: e.target.value })} style={input} />
        </label>
        <label style={label}>Hang up after silence (seconds, 0 = Telnyx default)
          <input aria-label="Silence hang-up seconds" type="number" min="0" max="14400" value={a.idleHangupSecs} onChange={(e) => set({ idleHangupSecs: e.target.value })} style={input} />
        </label>
        <label style={label}>If the agent fails, send the call to
          <input aria-label="Fallback number" placeholder="+447700900123" value={a.fallbackNumber} onChange={(e) => set({ fallbackNumber: e.target.value })} style={input} />
        </label>
        <label style={label}>Background noise filter
          <select aria-label="Noise filter" value={a.noise} onChange={(e) => set({ noise: e.target.value })} style={input}>
            <option value="">Telnyx default</option>
            <option value="aicoustics">ai-coustics (best for AI)</option>
            <option value="krisp">Krisp</option>
            <option value="deepfilternet">DeepFilterNet</option>
            <option value="disabled">Off</option>
          </select>
        </label>
      </div>
      <label style={label}>Words to recognise (names, brands; comma separated; used by Deepgram Nova-3 and Flux)
        <input aria-label="Words to recognise" placeholder="Aivhub, OutReach, Siobhan" value={a.keyterms} onChange={(e) => set({ keyterms: e.target.value })} style={input} />
      </label>
      <div style={{ display: "grid", gap: 6 }}>
        <div style={label}>People the agent can put callers through to</div>
        {transfers.map((t, i) => (
          <div key={i} style={{ display: "flex", gap: 6 }}>
            <input aria-label={`Transfer ${i + 1} name`} placeholder="Sales" value={t.name} onChange={(e) => setRow(i, { name: e.target.value })} style={{ ...input, width: 180 }} />
            <input aria-label={`Transfer ${i + 1} number`} placeholder="+447700900123" value={t.number} onChange={(e) => setRow(i, { number: e.target.value })} style={input} />
            <button type="button" aria-label={`Remove transfer ${i + 1}`} style={btn(false)} onClick={() => set({ transfers: transfers.filter((_, j) => j !== i) })}><Trash2 size={13} /></button>
          </div>
        ))}
        {transfers.length < 10 && (
          <button type="button" style={btn(false)} onClick={() => set({ transfers: [...transfers, { name: "", number: "" }] })}><Plus size={13} /> Add person</button>
        )}
      </div>
    </div>
  );
}

const EMPTY_CLONE = { name: "", language: "en", gender: "female", file: null, consent: false };

// The company's own voices: upload a short sample, free. Everyone in the company can pick them.
export function CompanyVoices({ clones, onChanged }) {
  const [form, setForm] = useState(EMPTY_CLONE);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ text: "", error: false });
  const run = async (fn, ok) => {
    setBusy(true);
    setMsg({ text: "", error: false });
    try {
      await fn();
      setMsg({ text: ok, error: false });
      onChanged();
    } catch (err) {
      setMsg({ text: err.message, error: true });
    }
    setBusy(false);
  };
  const ready = form.name.trim() && form.file && form.consent && !busy;
  return (
    <div style={box}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, color: C.textInk }}>
        <Mic size={16} color={C.cobalt} /> Your company's voices
      </div>
      <div style={{ fontSize: 12.5, color: C.slate }}>Clone a real voice from 5–10 seconds of clear speech. Free. Only your company sees it; pick it as a voice above.</div>
      {clones.length > 0 && (
        <div style={{ display: "grid", gap: 6 }}>
          {clones.map((c) => (
            <div key={c.id} style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 13 }}>
              <span style={{ flex: 1 }}><b>{c.name}</b> <span style={{ color: C.slate }}>· {c.language} · {c.gender}{c.status && c.status !== "active" ? ` · ${c.status}` : ""}</span></span>
              <button type="button" aria-label={`Delete ${c.name}`} style={btn(false, busy)} disabled={busy}
                onClick={() => run(() => api.deleteVoiceClone(c.id), `${c.name} deleted.`)}><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
      )}
      <div style={grid}>
        <label style={label}>Name
          <input aria-label="Voice name" placeholder="Priya" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={input} />
        </label>
        <label style={label}>Language spoken in the sample
          <input aria-label="Sample language" maxLength={2} placeholder="en" value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value.toLowerCase() })} style={input} />
        </label>
        <label style={label}>Voice
          <select aria-label="Voice gender" value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })} style={input}>
            <option value="female">Female</option><option value="male">Male</option><option value="neutral">Neutral</option>
          </select>
        </label>
        <label style={label}>Sample (WAV, MP3, FLAC, OGG, M4A; under 5 MB)
          <input aria-label="Voice sample" type="file" accept=".wav,.mp3,.flac,.ogg,.m4a,audio/*" onChange={(e) => setForm({ ...form, file: e.target.files?.[0] || null })} style={input} />
        </label>
      </div>
      <label style={check}>
        <input type="checkbox" aria-label="Speaker consent" checked={form.consent} onChange={(e) => setForm({ ...form, consent: e.target.checked })} style={{ marginTop: 3 }} />
        <span>The person in this recording agreed to have their voice cloned and used for our calls.</span>
      </label>
      <button type="button" style={btn(true, !ready)} disabled={!ready}
        onClick={() => run(async () => { await api.addVoiceClone(form); setForm(EMPTY_CLONE); }, "Voice added. Pick it as your voice above.")}>
        <Upload size={13} /> {busy ? "Cloning…" : "Clone voice"}
      </button>
      {msg.text && <div role={msg.error ? "alert" : "status"} style={{ fontSize: 12.5, color: msg.error ? C.red : C.teal }}>{msg.text}</div>}
    </div>
  );
}
