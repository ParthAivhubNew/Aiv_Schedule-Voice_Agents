import React, { useCallback, useEffect, useState } from "react";
import { Check, Image as ImageIcon, KeyRound, PenLine, Plus, Globe, Sparkles, Zap, ChevronDown, ChevronUp } from "lucide-react";
import { api } from "../api/apiClient";
import { C, FONT_BODY, FONT_DISPLAY, HUB_PAPER } from "../tokens";

// Post Scheduler AI settings (Simple edition).
// Both Text AI and Image AI lists are fully dynamic: no hardcoded providers.
// Users can provide any custom provider name, base URL endpoint, API key, model, and region.

const IMAGE_STYLES = [
  { id: "modern_saas", label: "Modern SaaS illustration" },
  { id: "editorial", label: "Editorial photo" },
  { id: "minimalist_3d", label: "Minimal 3D" },
  { id: "b2b_ad", label: "Bold B2B ad" },
  { id: "cinematic", label: "Cinematic" },
  { id: "neon_tech", label: "Dark neon tech" },
];

const ASPECTS = [
  { id: "4:5", label: "4:5 portrait (LinkedIn / Instagram feed)" },
  { id: "1:1", label: "1:1 square" },
  { id: "16:9", label: "16:9 landscape" },
  { id: "9:16", label: "9:16 story" },
];

function mirrorForClassic(s) {
  try {
    const prev = JSON.parse(localStorage.getItem("aivhub_scheduler_ai") || "{}") || {};
    const next = {
      ...prev,
      imageStyle: s.imageStyle,
      imageAspectRatio: s.imageAspectRatio,
      imageModel: s.imageModel || prev.imageModel,
    };
    if (s.textProvider && s.textProvider !== "auto") {
      next.provider = s.textProvider;
      if (s.textModel) next.model = s.textModel;
    }
    if (s.imageProvider && s.imageProvider !== "auto") next.imageProvider = s.imageProvider;
    delete next.apiKey;
    delete next.imageApiKey;
    localStorage.setItem("aivhub_scheduler_ai", JSON.stringify(next));
  } catch (_) {}
}

export function SchedulerAiPanel({ showToast }) {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [settings, setSettings] = useState(null);
  const [saveState, setSaveState] = useState(""); // "" | saving | saved | error
  
  // Custom Connect Form States
  const [showAddText, setShowAddText] = useState(false);
  const [showAddImage, setShowAddImage] = useState(false);
  const [customTextForm, setCustomTextForm] = useState({ provider: "", apiKey: "", baseUrl: "", model: "" });
  const [customImageForm, setCustomImageForm] = useState({ provider: "", apiKey: "", baseUrl: "", model: "" });
  
  const [keyBusy, setKeyBusy] = useState("");
  const [keyMsg, setKeyMsg] = useState({ text: null, image: null });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await api.getSchedulerAiSettings();
      setData(res);
      setSettings((cur) => cur || res.settings);
      setLoadError("");
    } catch (e) {
      setLoadError(e.message || "Could not load AI settings.");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const persist = async (patch) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    setTestResult(null);
    setSaveState("saving");
    try {
      const res = await api.saveSchedulerAiSettings(next);
      setSettings(res.settings || next);
      mirrorForClassic(res.settings || next);
      setSaveState("saved");
      window.setTimeout(() => setSaveState((s) => (s === "saved" ? "" : s)), 1800);
    } catch (e) {
      setSaveState("error");
      if (showToast) showToast(e.message || "Could not save AI settings.");
    }
  };

  const textKeys = (data && data.keys && data.keys.text) || [];
  const imageKeys = (data && data.keys && data.keys.image) || [];
  const textProviders = (data && data.textProviders) || { auto: "Auto — use any saved key" };
  const imageProviders = (data && data.imageProviders) || {
    auto: "Auto — saved image key, else free",
    pollinations: "Pollinations (free)",
  };

  const saveCustomProvider = async (kind) => {
    const form = kind === "text" ? customTextForm : customImageForm;
    const provName = String(form.provider || "").trim();
    if (!provName) {
      setKeyMsg((m) => ({ ...m, [kind]: { ok: false, text: "Provider name is required (e.g. Groq, Ollama, DeepSeek)." } }));
      return;
    }
    setKeyBusy(kind);
    setKeyMsg((m) => ({ ...m, [kind]: null }));
    try {
      await api.testAndSaveConnection({
        layer: kind === "text" ? "LLM" : "IMAGE",
        provider: provName,
        api_key: String(form.apiKey || "").trim() || undefined,
        base_url: String(form.baseUrl || "").trim() || undefined,
        model: String(form.model || "").trim() || undefined,
      });
      
      const patch = kind === "text" 
        ? { textProvider: provName, textModel: form.model || settings.textModel } 
        : { imageProvider: provName, imageModel: form.model || settings.imageModel };
      
      await persist(patch);
      if (kind === "text") {
        setCustomTextForm({ provider: "", apiKey: "", baseUrl: "", model: "" });
        setShowAddText(false);
      } else {
        setCustomImageForm({ provider: "", apiKey: "", baseUrl: "", model: "" });
        setShowAddImage(false);
      }
      setKeyMsg((m) => ({ ...m, [kind]: { ok: true, text: `✓ ${provName} connected successfully.` } }));
      await load();
    } catch (e) {
      setKeyMsg((m) => ({ ...m, [kind]: { ok: false, text: e.message || "Could not verify connection." } }));
    } finally {
      setKeyBusy("");
    }
  };

  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(await api.testSchedulerAiSettings());
    } catch (e) {
      setTestResult({ error: e.message || "Test failed." });
    } finally {
      setTesting(false);
    }
  };

  if (loadError) {
    return (
      <div style={card}>
        <div style={title}>Writing & image AI</div>
        <div style={{ fontSize: 13, color: C.red, marginTop: 8 }}>{loadError}</div>
        <button type="button" onClick={load} style={{ ...secBtn, marginTop: 10 }}>Retry</button>
      </div>
    );
  }
  if (!settings) {
    return <div style={card}><div style={{ fontSize: 13, color: C.slate }}>Loading AI settings…</div></div>;
  }

  const tp = settings.textProvider || "auto";
  const ip = settings.imageProvider || "auto";
  const activeTextKey = textKeys.find((k) => k.provider === tp || k.name === tp);
  const activeImageKey = imageKeys.find((k) => k.provider === ip || k.name === ip);

  return (
    <div style={card}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 4 }}>
        <div>
          <div style={title}>Writing & Image AI</div>
          <div style={{ fontSize: 12.5, color: C.slate, lineHeight: 1.45, marginTop: 4, maxWidth: 650 }}>
            Connect any AI of your choice (OpenAI, Anthropic, DeepSeek, Groq, Ollama, OpenRouter, Stability, Fal, or your own custom endpoint). Text and image AI providers stay completely separate.
          </div>
        </div>
        <SaveBadge state={saveState} />
      </div>

      {/* 1. Writing AI Section */}
      <Section icon={<PenLine size={15} color={C.teal} />} label="Writing AI (Captions, Chat & Rewrites)" sub="Generates LinkedIn, X, Facebook, and Instagram captions.">
        <div style={grid2}>
          <div>
            <label style={labelStyle}>TEXT AI PROVIDER</label>
            <select
              value={tp}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "__add_new__") {
                  setShowAddText(true);
                } else {
                  persist({ textProvider: v });
                }
              }}
              style={input}
            >
              {Object.entries(textProviders).map(([id, lab]) => (
                <option key={id} value={id}>{lab}</option>
              ))}
              <option value="__add_new__">+ Add custom Text AI provider…</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>MODEL NAME</label>
            <input
              key={"tm_" + tp}
              defaultValue={settings.textModel || ""}
              placeholder={tp === "auto" ? "Uses connected provider default" : "e.g. llama-3.3-70b, deepseek-chat, gpt-4o"}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v !== (settings.textModel || "")) persist({ textModel: v });
              }}
              style={input}
            />
          </div>
        </div>

        {activeTextKey ? (
          <KeyStatus ok text={`Active: ${activeTextKey.name} (${activeTextKey.masked})${activeTextKey.baseUrl ? ` · ${activeTextKey.baseUrl}` : ""}`} />
        ) : tp === "auto" ? (
          <KeyStatus
            ok={textKeys.length > 0}
            text={textKeys.length > 0 ? `Auto will route to: ${textKeys[0].name} (${textKeys[0].masked}).` : "No Text AI key connected yet. Click below to add one."}
          />
        ) : (
          <KeyStatus ok={false} text={`No key found for ${textProviders[tp] || tp}. Connect it below or switch to Auto.`} />
        )}

        <div style={{ marginTop: 10 }}>
          <button
            type="button"
            onClick={() => setShowAddText(!showAddText)}
            style={{ ...secBtn, height: 32, fontSize: 12, padding: "0 10px" }}
          >
            {showAddText ? <ChevronUp size={13} /> : <Plus size={13} />}
            {showAddText ? "Hide custom connection form" : "Connect new Text AI provider / Custom URL"}
          </button>
        </div>

        {showAddText && (
          <CustomProviderForm
            kind="text"
            form={customTextForm}
            setForm={setCustomTextForm}
            busy={keyBusy === "text"}
            msg={keyMsg.text}
            onSave={() => saveCustomProvider("text")}
            placeholderProvider="e.g. Groq, Ollama, OpenRouter, DeepSeek, Together"
            placeholderUrl="e.g. https://api.groq.com/openai/v1 or http://localhost:11434/v1"
            placeholderModel="e.g. llama-3.3-70b-versatile, deepseek-chat"
          />
        )}
      </Section>

      {/* 2. Image AI Section */}
      <Section icon={<ImageIcon size={15} color={C.teal} />} label="Image AI (Visuals & Illustrations)" sub="Creates images for your social posts. Separate from Text AI.">
        <div style={grid2}>
          <div>
            <label style={labelStyle}>IMAGE AI PROVIDER</label>
            <select
              value={ip}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "__add_new__") {
                  setShowAddImage(true);
                } else {
                  persist({ imageProvider: v });
                }
              }}
              style={input}
            >
              {Object.entries(imageProviders).map(([id, lab]) => (
                <option key={id} value={id}>{lab}</option>
              ))}
              <option value="__add_new__">+ Add custom Image AI provider…</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>MODEL NAME (OPTIONAL)</label>
            <input
              key={"im_" + ip}
              defaultValue={settings.imageModel || ""}
              placeholder={ip === "pollinations" ? "flux (default)" : "e.g. dall-e-3, sdxl-1.0, flux-schnell"}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v !== (settings.imageModel || "")) persist({ imageModel: v });
              }}
              style={input}
            />
          </div>
          <div>
            <label style={labelStyle}>DEFAULT STYLE</label>
            <select value={settings.imageStyle || "modern_saas"} onChange={(e) => persist({ imageStyle: e.target.value })} style={input}>
              {IMAGE_STYLES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>ASPECT RATIO</label>
            <select value={settings.imageAspectRatio || "4:5"} onChange={(e) => persist({ imageAspectRatio: e.target.value })} style={input}>
              {ASPECTS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
          </div>
        </div>

        {ip === "pollinations" ? (
          <KeyStatus ok text="Pollinations FLUX is active and 100% free (no API key needed)." />
        ) : activeImageKey ? (
          <KeyStatus ok text={`Active: ${activeImageKey.name} (${activeImageKey.masked})${activeImageKey.baseUrl ? ` · ${activeImageKey.baseUrl}` : ""}`} />
        ) : ip === "auto" ? (
          <KeyStatus
            ok
            text={imageKeys.length > 0 ? `Auto will route to saved image key: ${imageKeys[0].name}.` : "Auto: using free Pollinations engine."}
          />
        ) : (
          <KeyStatus ok={false} text={`No key found for ${imageProviders[ip] || ip}. Connect it below or switch to Pollinations/Auto.`} />
        )}

        <div style={{ marginTop: 10 }}>
          <button
            type="button"
            onClick={() => setShowAddImage(!showAddImage)}
            style={{ ...secBtn, height: 32, fontSize: 12, padding: "0 10px" }}
          >
            {showAddImage ? <ChevronUp size={13} /> : <Plus size={13} />}
            {showAddImage ? "Hide custom connection form" : "Connect new Image AI provider / Custom URL"}
          </button>
        </div>

        {showAddImage && (
          <CustomProviderForm
            kind="image"
            form={customImageForm}
            setForm={setCustomImageForm}
            busy={keyBusy === "image"}
            msg={keyMsg.image}
            onSave={() => saveCustomProvider("image")}
            placeholderProvider="e.g. Stability AI, Fal.ai, OpenAI DALL-E, Flux Local"
            placeholderUrl="e.g. https://api.fal.ai/v1 or https://api.stability.ai or http://localhost:7860"
            placeholderModel="e.g. flux-schnell, dall-e-3, sdxl-1.0"
          />
        )}
      </Section>

      {/* Connectivity Test */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginTop: 20 }}>
        <button type="button" onClick={runTest} disabled={testing} style={{ ...priBtn, background: C.teal }}>
          <Zap size={14} /> {testing ? "Testing…" : "Test setup live"}
        </button>
        {testResult ? <TestSummary result={testResult} textProviders={textProviders} imageProviders={imageProviders} /> : null}
      </div>
    </div>
  );
}

function Section({ icon, label, sub, children }) {
  return (
    <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 16, paddingTop: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 2 }}>
        {icon}
        <div style={{ fontWeight: 700, fontSize: 14, color: C.ink }}>{label}</div>
      </div>
      <div style={{ fontSize: 12, color: C.slate, marginBottom: 12 }}>{sub}</div>
      {children}
    </div>
  );
}

function KeyStatus({ ok, text }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: ok ? C.teal : C.amber, marginTop: 10, fontWeight: 600 }}>
      <span style={{ width: 7, height: 7, borderRadius: 99, background: ok ? C.teal : C.amber, flexShrink: 0 }} />
      {text}
    </div>
  );
}

function CustomProviderForm({ kind, form, setForm, busy, msg, onSave, placeholderProvider, placeholderUrl, placeholderModel }) {
  return (
    <div style={{ marginTop: 12, padding: 14, borderRadius: 12, background: HUB_PAPER, border: `1px solid ${C.border}` }}>
      <div style={{ fontWeight: 700, fontSize: 13, color: C.ink, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
        <Sparkles size={14} color={C.teal} />
        Connect Any {kind === "text" ? "Text" : "Image"} AI (Cloud, Open-Source, or Self-Hosted)
      </div>
      <form onSubmit={(e) => { e.preventDefault(); onSave(); }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10, marginBottom: 10 }}>
          <div>
            <label style={labelStyle}>PROVIDER NAME *</label>
            <input
              value={form.provider || ""}
              onChange={(e) => setForm({ ...form, provider: e.target.value })}
              placeholder={placeholderProvider}
              style={input}
              required
            />
          </div>
          <div>
            <label style={labelStyle}>API KEY (LEAVE EMPTY IF LOCAL/FREE)</label>
            <input
              type="password"
              autoComplete="off"
              value={form.apiKey || ""}
              onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
              placeholder="Paste API key"
              style={{ ...input, fontFamily: "ui-monospace, monospace" }}
            />
          </div>
          <div>
            <label style={labelStyle}>CUSTOM BASE URL / REGION (OPTIONAL)</label>
            <input
              value={form.baseUrl || ""}
              onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
              placeholder={placeholderUrl}
              style={input}
            />
          </div>
          <div>
            <label style={labelStyle}>MODEL NAME (OPTIONAL)</label>
            <input
              value={form.model || ""}
              onChange={(e) => setForm({ ...form, model: e.target.value })}
              placeholder={placeholderModel}
              style={input}
            />
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button type="submit" disabled={busy || !String(form.provider || "").trim()} style={{ ...priBtn, background: C.ink }}>
            {busy ? "Verifying…" : `Verify & save ${kind === "text" ? "Text" : "Image"} AI`}
          </button>
        </div>
      </form>
      {msg && (
        <div style={{ fontSize: 12, marginTop: 8, color: msg.ok ? C.teal : C.red, fontWeight: 600 }}>
          {msg.text}
        </div>
      )}
    </div>
  );
}

function TestSummary({ result, textProviders, imageProviders }) {
  if (result.error) return <span style={{ fontSize: 12.5, color: C.red, fontWeight: 600 }}>{result.error}</span>;
  const t = result.text || {};
  const i = result.image || {};
  const tName = textProviders[t.provider] || t.provider || "—";
  const iName = imageProviders[i.provider] || i.provider || "—";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 12.5 }}>
      <span style={{ color: t.ok ? C.teal : C.red, fontWeight: 600 }}>
        {t.ok ? <Check size={12} style={{ verticalAlign: -1 }} /> : "✕"} Writing: {tName}{t.model ? ` · ${t.model}` : ""}
        {!t.ok && t.error ? ` — ${t.error}` : ""}
      </span>
      <span style={{ color: i.missingKeyFor ? C.amber : C.teal, fontWeight: 600 }}>
        <Check size={12} style={{ verticalAlign: -1 }} /> Images: {iName}{i.model ? ` · ${i.model}` : ""}
        {i.missingKeyFor ? ` (no ${imageProviders[i.missingKeyFor] || i.missingKeyFor} key — using free)` : ""}
      </span>
    </div>
  );
}

function SaveBadge({ state }) {
  if (!state) return null;
  const map = {
    saving: { text: "Saving…", color: C.slate },
    saved: { text: "Saved", color: C.teal },
    error: { text: "Not saved", color: C.red },
  };
  const s = map[state];
  return <span style={{ fontSize: 12, fontWeight: 700, color: s.color, whiteSpace: "nowrap" }}>{s.text}</span>;
}

const card = { background: "#fff", border: `1px solid ${C.border}`, borderRadius: 16, padding: 20, marginBottom: 22, fontFamily: FONT_BODY };
const title = { fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, color: C.ink };
const grid2 = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 };
const labelStyle = { display: "block", fontSize: 11, fontWeight: 700, color: C.slateLight, marginBottom: 6, letterSpacing: "0.04em" };
const input = { width: "100%", boxSizing: "border-box", height: 36, padding: "0 10px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13, fontFamily: FONT_BODY, background: "#fff", color: C.ink };
const secBtn = { display: "inline-flex", alignItems: "center", gap: 6, height: 36, padding: "0 12px", borderRadius: 9, border: `1px solid ${C.border}`, background: "#fff", color: C.ink, fontWeight: 600, fontSize: 12.5, cursor: "pointer", fontFamily: FONT_BODY };
const priBtn = { ...secBtn, border: "none", background: C.ink, color: "#fff" };
