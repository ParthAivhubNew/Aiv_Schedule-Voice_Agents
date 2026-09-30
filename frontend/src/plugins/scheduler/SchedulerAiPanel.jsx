import React, { useCallback, useEffect, useState } from "react";
import { Check, Image as ImageIcon, KeyRound, PenLine, Plus, Globe, Sparkles, Zap, ChevronDown, ChevronUp, Edit3, AlertCircle, Eye, EyeOff, Trash2, Settings2 } from "lucide-react";
import { api } from "../../api/apiClient";
import { C, FONT_BODY, FONT_DISPLAY, HUB_PAPER } from "../../tokens";

// Post Scheduler AI settings.
// Fully dynamic provider management:
// 1. Clean focus on AI Provider credentials, custom Base URLs, and Models.
// 2. Aspect ratios and custom image styles are handled per-post according to platform recommendations.
// 3. Delete & Edit options for connected providers.
// 4. Symmetrical 2x2 grid with eye view icon while typing API key.

function matchKey(keys, selected) {
  const s = String(selected || "").trim().toLowerCase();
  if (!s) return null;
  return keys.find((k) => String(k.name || "").toLowerCase() === s || String(k.provider || "").toLowerCase() === s) || null;
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

  // A saved choice of "auto" or a legacy slug ("openai" vs the key's name "OpenAI") matches no
  // key, so the dropdown would show the first key while the backend used something else.
  // Pin the shown provider so what the user sees is what posts are written with.
  useEffect(() => {
    if (!data || !settings) return;
    const tk = (data.keys && data.keys.text) || [];
    const ik = (data.keys && data.keys.image) || [];
    const patch = {};
    if (tk.length && !matchKey(tk, settings.textProvider)) {
      patch.textProvider = tk[0].name;
      if (!settings.textModel) patch.textModel = tk[0].model || "";
    }
    const ip = String(settings.imageProvider || "").toLowerCase();
    if (ik.length && ip !== "pollinations" && !matchKey(ik, settings.imageProvider)) {
      patch.imageProvider = ik[0].name;
      if (!settings.imageModel) patch.imageModel = ik[0].model || "";
    }
    if (Object.keys(patch).length) persist(patch);
  }, [data, settings]); // eslint-disable-line react-hooks/exhaustive-deps

  const persist = async (patch) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    setTestResult(null);
    setSaveState("saving");
    try {
      const res = await api.saveSchedulerAiSettings(next);
      setSettings(res.settings || next);
      setSaveState("saved");
      window.setTimeout(() => setSaveState((s) => (s === "saved" ? "" : s)), 1800);
    } catch (e) {
      setSaveState("error");
      if (showToast) showToast(e.message || "Could not save AI settings.");
    }
  };

  const textKeys = (data && data.keys && data.keys.text) || [];
  const imageKeys = (data && data.keys && data.keys.image) || [];

  const textProviders = {};
  textKeys.forEach((k) => {
    textProviders[k.name] = k.name;
  });

  const imageProviders = {
    pollinations: "Pollinations (free default)",
  };
  imageKeys.forEach((k) => {
    imageProviders[k.name] = k.name;
  });

  const saveCustomProvider = async (kind) => {
    const form = kind === "text" ? customTextForm : customImageForm;
    const provName = String(form.provider || "").trim();
    if (!provName) {
      setKeyMsg((m) => ({ ...m, [kind]: { ok: false, text: "Provider name is required (e.g. DeepSeek, OpenAI, Groq, Fal)." } }));
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
        ? { textProvider: provName, textModel: form.model || settings?.textModel || "" } 
        : { imageProvider: provName, imageModel: form.model || settings?.imageModel || "" };
      
      await persist(patch);
      if (kind === "text") {
        setCustomTextForm({ provider: "", apiKey: "", baseUrl: "", model: "" });
        setShowAddText(false);
      } else {
        setCustomImageForm({ provider: "", apiKey: "", baseUrl: "", model: "" });
        setShowAddImage(false);
      }
      setKeyMsg((m) => ({ ...m, [kind]: { ok: true, text: `✓ ${provName} verified and saved successfully.` } }));
      await load();
    } catch (e) {
      setKeyMsg((m) => ({ ...m, [kind]: { ok: false, text: e.message || "Could not verify connection." } }));
    } finally {
      setKeyBusy("");
    }
  };

  const deleteKey = async (kind, keyObj) => {
    let usedBy = [];
    try {
      const res = await api.connectionUsage({ id: keyObj.id, layer: kind === "text" ? "LLM" : "IMAGE", provider: keyObj.name });
      usedBy = (res && res.usedBy) || [];
    } catch (_) {
      // Unknown usage: still ask.
    }
    const warn = usedBy.length ? "\n\nIn use. These stop working until you add another key:\n- " + usedBy.join("\n- ") : "";
    if (!window.confirm(`Remove the saved key for ${keyObj.name}?${warn}`)) return;
    setKeyBusy(kind);
    try {
      await api.clearConnectionKey({
        layer: kind === "text" ? "LLM" : "IMAGE",
        provider: keyObj.name,
        id: keyObj.id,
      });
      if (kind === "text") {
        await persist({ textProvider: "", textModel: "" });
      } else {
        await persist({ imageProvider: "pollinations", imageModel: "" });
      }
      await load();
      if (showToast) showToast(`Removed ${keyObj.name} key.`);
    } catch (e) {
      if (showToast) showToast(e.message || "Failed to delete key.");
    } finally {
      setKeyBusy("");
    }
  };

  const editKey = (kind, keyObj) => {
    if (kind === "text") {
      setCustomTextForm({
        provider: keyObj.name,
        apiKey: "",
        baseUrl: keyObj.baseUrl || "",
        model: keyObj.model || settings?.textModel || "",
      });
      setShowAddText(true);
    } else {
      setCustomImageForm({
        provider: keyObj.name,
        apiKey: "",
        baseUrl: keyObj.baseUrl || "",
        model: keyObj.model || settings?.imageModel || "",
      });
      setShowAddImage(true);
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
        <div style={title}>Writing & Image AI</div>
        <div style={{ fontSize: 13, color: C.red, marginTop: 8 }}>{loadError}</div>
        <button type="button" onClick={load} style={{ ...secBtn, marginTop: 10 }}>Retry</button>
      </div>
    );
  }
  if (!settings) {
    return <div style={card}><div style={{ fontSize: 13, color: C.slate }}>Loading AI settings…</div></div>;
  }

  // Active Provider selection resolution
  const hasTextKeys = textKeys.length > 0;
  const activeTextKey = matchKey(textKeys, settings.textProvider) || (hasTextKeys ? textKeys[0] : null);
  const effectiveTp = activeTextKey ? activeTextKey.name : "";

  const hasImageKeys = imageKeys.length > 0;
  const isPollinations = String(settings.imageProvider || "").toLowerCase() === "pollinations";
  const activeImageKey = isPollinations ? null : (matchKey(imageKeys, settings.imageProvider) || (hasImageKeys ? imageKeys[0] : null));
  const effectiveIp = activeImageKey ? activeImageKey.name : "pollinations";

  return (
    <div style={card}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 6 }}>
        <div>
          <div style={title}>Writing & Image AI</div>
          <div style={{ fontSize: 12.5, color: C.slate, lineHeight: 1.45, marginTop: 4, maxWidth: 680 }}>
            Connect any AI of your choice (OpenAI, Anthropic, DeepSeek, Groq, Ollama, OpenRouter, Stability, Fal, or your own custom endpoint). Text and image AI providers stay completely separate.
          </div>
        </div>
        <SaveBadge state={saveState} />
      </div>

      {/* 1. Writing AI Section */}
      <Section icon={<PenLine size={15} color={C.teal} />} label="Writing AI (Captions, Chat & Rewrites)" sub="Generates LinkedIn, X, Facebook, and Instagram captions.">
        {!hasTextKeys ? (
          /* Empty / Zero-Keys State: Highlighted in Yellow with collapsible Dropdown */
          <CustomProviderWindow
            kind="text"
            highlightedYellow={true}
            defaultOpen={false}
            form={customTextForm}
            setForm={setCustomTextForm}
            busy={keyBusy === "text"}
            msg={keyMsg.text}
            onSave={() => saveCustomProvider("text")}
            placeholderProvider="e.g. DeepSeek, OpenAI, Groq, Ollama, OpenRouter"
            placeholderUrl="e.g. https://api.deepseek.com or https://api.openai.com/v1"
            placeholderModel="e.g. deepseek-chat, gpt-4o, llama-3.3-70b-versatile"
          />
        ) : (
          /* Active Keys State: Provider Selection Dropdown + Editable Model Name */
          <div>
            <div style={grid2}>
              <div>
                <label style={labelStyle}>TEXT AI PROVIDER</label>
                <select
                  value={effectiveTp}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "__add_new__") {
                      setCustomTextForm({ provider: "", apiKey: "", baseUrl: "", model: "" });
                      setShowAddText(true);
                    } else {
                      const selKey = textKeys.find((k) => k.name === v);
                      persist({ 
                        textProvider: v, 
                        textModel: selKey?.model || settings.textModel || "" 
                      });
                    }
                  }}
                  style={input}
                >
                  {Object.entries(textProviders).map(([id, lab]) => (
                    <option key={id} value={id}>{lab}</option>
                  ))}
                  <option value="__add_new__">+ Connect another Text AI provider…</option>
                </select>
              </div>

              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                  <label style={{ ...labelStyle, marginBottom: 0 }}>MODEL NAME</label>
                  <span style={{ fontSize: 11, color: C.slate, fontWeight: 500 }}>Click to edit</span>
                </div>
                <div style={{ position: "relative" }}>
                  <input
                    key={"tm_" + effectiveTp + "_" + (settings.textModel || "")}
                    defaultValue={settings.textModel || activeTextKey?.model || ""}
                    placeholder="e.g. deepseek-chat, gpt-4o, llama-3.3-70b-versatile"
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v !== (settings.textModel || "")) {
                        persist({ textModel: v });
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.target.blur();
                      }
                    }}
                    style={{ ...input, paddingRight: 32 }}
                  />
                  <Edit3 size={14} color={C.slateLight} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
                </div>
              </div>
            </div>

            {activeTextKey && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                <KeyStatus
                  ok={true}
                  text={`Active: ${activeTextKey.name} (${activeTextKey.masked})${activeTextKey.baseUrl ? ` · Endpoint: ${activeTextKey.baseUrl}` : ""}${settings.textModel ? ` · Model: ${settings.textModel}` : ""}`}
                />
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => editKey("text", activeTextKey)}
                    style={{ ...secBtn, height: 28, fontSize: 11.5, padding: "0 8px" }}
                    title="Edit provider URL, endpoint or API key"
                  >
                    <Settings2 size={12} /> Edit URL / Key
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteKey("text", activeTextKey)}
                    style={{ ...secBtn, height: 28, fontSize: 11.5, padding: "0 8px", color: C.red }}
                    title="Delete saved key"
                  >
                    <Trash2 size={12} /> Remove
                  </button>
                </div>
              </div>
            )}

            <div style={{ marginTop: 12 }}>
              <CustomProviderWindow
                kind="text"
                highlightedYellow={false}
                defaultOpen={showAddText}
                isOpen={showAddText}
                onToggle={(open) => setShowAddText(open)}
                form={customTextForm}
                setForm={setCustomTextForm}
                busy={keyBusy === "text"}
                msg={keyMsg.text}
                onSave={() => saveCustomProvider("text")}
                placeholderProvider="e.g. DeepSeek, OpenAI, Groq, Ollama, OpenRouter"
                placeholderUrl="e.g. https://api.deepseek.com or https://api.openai.com/v1"
                placeholderModel="e.g. deepseek-chat, gpt-4o, llama-3.3-70b-versatile"
              />
            </div>
          </div>
        )}
      </Section>

      {/* 2. Image AI Section */}
      <Section icon={<ImageIcon size={15} color={C.teal} />} label="Image AI (Visuals & Illustrations)" sub="Creates images for your social posts. Visual styles and platform aspect ratios are tailored per-post.">
        {!hasImageKeys ? (
          /* Empty / Zero-Keys State: Highlighted in Yellow with collapsible Dropdown */
          <div>
            <CustomProviderWindow
              kind="image"
              highlightedYellow={true}
              defaultOpen={false}
              form={customImageForm}
              setForm={setCustomImageForm}
              busy={keyBusy === "image"}
              msg={keyMsg.image}
              onSave={() => saveCustomProvider("image")}
              placeholderProvider="e.g. Stability AI, Fal.ai, OpenAI DALL-E, Local SDXL"
              placeholderUrl="e.g. https://api.fal.ai/v1 or https://api.stability.ai or http://localhost:7860"
              placeholderModel="e.g. flux-schnell, dall-e-3, sdxl-1.0"
            />
            
            <div style={{ marginTop: 10 }}>
              <KeyStatus ok={true} text="Free fallback: Pollinations FLUX is active until a custom image AI key is connected." />
            </div>
          </div>
        ) : (
          /* Active Keys State: Provider Selection Dropdown + Editable Model Name */
          <div>
            <div style={grid2}>
              <div>
                <label style={labelStyle}>IMAGE AI PROVIDER</label>
                <select
                  value={effectiveIp}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "__add_new__") {
                      setCustomImageForm({ provider: "", apiKey: "", baseUrl: "", model: "" });
                      setShowAddImage(true);
                    } else {
                      const selKey = imageKeys.find((k) => k.name === v);
                      persist({ 
                        imageProvider: v,
                        imageModel: selKey?.model || settings.imageModel || ""
                      });
                    }
                  }}
                  style={input}
                >
                  {Object.entries(imageProviders).map(([id, lab]) => (
                    <option key={id} value={id}>{lab}</option>
                  ))}
                  <option value="__add_new__">+ Connect custom Image AI provider…</option>
                </select>
              </div>

              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                  <label style={{ ...labelStyle, marginBottom: 0 }}>MODEL NAME</label>
                  <span style={{ fontSize: 11, color: C.slate, fontWeight: 500 }}>Click to edit</span>
                </div>
                <div style={{ position: "relative" }}>
                  <input
                    key={"im_" + effectiveIp + "_" + (settings.imageModel || "")}
                    defaultValue={settings.imageModel || activeImageKey?.model || ""}
                    placeholder={effectiveIp === "pollinations" ? "flux (default free engine)" : "e.g. flux-schnell, dall-e-3, sdxl-1.0"}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v !== (settings.imageModel || "")) persist({ imageModel: v });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.target.blur();
                    }}
                    style={{ ...input, paddingRight: 32 }}
                  />
                  <Edit3 size={14} color={C.slateLight} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
                </div>
              </div>
            </div>

            {effectiveIp === "pollinations" ? (
              <KeyStatus ok={true} text="Pollinations FLUX is active and 100% free (no API key needed)." />
            ) : activeImageKey ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                <KeyStatus ok={true} text={`Active: ${activeImageKey.name} (${activeImageKey.masked})${activeImageKey.baseUrl ? ` · Endpoint: ${activeImageKey.baseUrl}` : ""}${settings.imageModel ? ` · Model: ${settings.imageModel}` : ""}`} />
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => editKey("image", activeImageKey)}
                    style={{ ...secBtn, height: 28, fontSize: 11.5, padding: "0 8px" }}
                    title="Edit provider URL, endpoint or API key"
                  >
                    <Settings2 size={12} /> Edit URL / Key
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteKey("image", activeImageKey)}
                    style={{ ...secBtn, height: 28, fontSize: 11.5, padding: "0 8px", color: C.red }}
                    title="Delete saved key"
                  >
                    <Trash2 size={12} /> Remove
                  </button>
                </div>
              </div>
            ) : (
              <KeyStatus ok={false} text={`No key found for ${imageProviders[effectiveIp] || effectiveIp}. Connect it below or switch to Pollinations.`} />
            )}

            <div style={{ marginTop: 12 }}>
              <CustomProviderWindow
                kind="image"
                highlightedYellow={false}
                defaultOpen={showAddImage}
                isOpen={showAddImage}
                onToggle={(open) => setShowAddImage(open)}
                form={customImageForm}
                setForm={setCustomImageForm}
                busy={keyBusy === "image"}
                msg={keyMsg.image}
                onSave={() => saveCustomProvider("image")}
                placeholderProvider="e.g. Stability AI, Fal.ai, OpenAI DALL-E, Local SDXL"
                placeholderUrl="e.g. https://api.fal.ai/v1 or https://api.stability.ai or http://localhost:7860"
                placeholderModel="e.g. flux-schnell, dall-e-3, sdxl-1.0"
              />
            </div>
          </div>
        )}
      </Section>

      {/* Connectivity Test - Shown once keys are configured */}
      {(hasTextKeys || hasImageKeys) && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginTop: 22, paddingTop: 16, borderTop: `1px solid ${C.borderLight}` }}>
          <button type="button" onClick={runTest} disabled={testing} style={{ ...priBtn, background: C.teal, height: 38, padding: "0 16px" }}>
            <Zap size={14} /> {testing ? "Testing live connection…" : "Test setup live"}
          </button>
          {testResult ? <TestSummary result={testResult} textProviders={textProviders} imageProviders={imageProviders} /> : null}
        </div>
      )}
    </div>
  );
}

function Section({ icon, label, sub, children }) {
  return (
    <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 18, paddingTop: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 2 }}>
        {icon}
        <div style={{ fontWeight: 700, fontSize: 14, color: C.ink }}>{label}</div>
      </div>
      <div style={{ fontSize: 12, color: C.slate, marginBottom: 14 }}>{sub}</div>
      {children}
    </div>
  );
}

function KeyStatus({ ok, text }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: ok ? C.teal : C.amber, fontWeight: 600 }}>
      <span style={{ width: 7, height: 7, borderRadius: 99, background: ok ? C.teal : C.amber, flexShrink: 0 }} />
      {text}
    </div>
  );
}

// Small collapsible window with dropdown to fill details
function CustomProviderWindow({
  kind,
  highlightedYellow,
  defaultOpen = false,
  isOpen,
  onToggle,
  form,
  setForm,
  busy,
  msg,
  onSave,
  placeholderProvider,
  placeholderUrl,
  placeholderModel,
}) {
  const [localOpen, setLocalOpen] = useState(defaultOpen);
  const [showKey, setShowKey] = useState(false);
  const isExpanded = isOpen !== undefined ? isOpen : localOpen;

  const handleToggle = () => {
    const next = !isExpanded;
    if (onToggle) onToggle(next);
    else setLocalOpen(next);
  };

  // Yellow / Amber highlight styles when no keys exist
  const borderCol = highlightedYellow ? "#F59E0B" : C.border;
  const bgCol = highlightedYellow ? "#FFFDF5" : HUB_PAPER;
  const shadowStyle = highlightedYellow ? "0 2px 12px rgba(245, 158, 11, 0.15)" : "none";

  return (
    <div
      style={{
        marginTop: 8,
        borderRadius: 12,
        background: bgCol,
        border: `1.5px solid ${borderCol}`,
        boxShadow: shadowStyle,
        overflow: "hidden",
        transition: "border-color 0.2s, box-shadow 0.2s",
      }}
    >
      {/* Clickable Header Bar / Dropdown Trigger */}
      <div
        onClick={handleToggle}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px",
          cursor: "pointer",
          userSelect: "none",
          background: highlightedYellow ? "#FFFBEB" : "transparent",
          borderBottom: isExpanded ? `1px solid ${highlightedYellow ? "#FDE68A" : C.border}` : "none",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Sparkles size={15} color={highlightedYellow ? "#D97706" : C.teal} />
          <span style={{ fontWeight: 700, fontSize: 13.5, color: highlightedYellow ? "#B45309" : C.ink }}>
            Connect Any {kind === "text" ? "Text" : "Image"} AI (Cloud, Open-Source, or Self-Hosted)
          </span>
          {highlightedYellow && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "#B45309",
                background: "#FEF3C7",
                border: "1px solid #FDE68A",
                padding: "2px 8px",
                borderRadius: 99,
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <AlertCircle size={11} /> No Keys Present
            </span>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6, color: highlightedYellow ? "#B45309" : C.slate, fontSize: 12, fontWeight: 600 }}>
          <span>{isExpanded ? "Hide details / Close form" : "Open to fill details"}</span>
          {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </div>

      {/* Collapsible Dropdown Content Form */}
      {isExpanded && (
        <div style={{ padding: "16px 18px" }}>
          <form onSubmit={(e) => { e.preventDefault(); onSave(); }}>
            {/* Symmetrical 2x2 Grid */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 16px", marginBottom: 14 }}>
              {/* Row 1, Col 1: Provider Name */}
              <div>
                <label style={labelStyle}>PROVIDER NAME *</label>
                <input
                  value={form.provider || ""}
                  onChange={(e) => setForm({ ...form, provider: e.target.value })}
                  placeholder={placeholderProvider}
                  style={input}
                  required
                />
                <div style={hintStyle}>e.g. {kind === "text" ? "DeepSeek, OpenAI, Groq, Ollama" : "Stability AI, Fal.ai, OpenAI DALL-E, Flux"}</div>
              </div>

              {/* Row 1, Col 2: API Key with Toggle View Eye Icon */}
              <div>
                <label style={labelStyle}>API KEY (OPTIONAL FOR SELF-HOSTED)</label>
                <div style={{ position: "relative" }}>
                  <input
                    type={showKey ? "text" : "password"}
                    autoComplete="off"
                    value={form.apiKey || ""}
                    onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                    placeholder="Paste API key here"
                    style={{ ...input, fontFamily: "ui-monospace, monospace", paddingRight: 36 }}
                  />
                  {form.apiKey ? (
                    <button
                      type="button"
                      onClick={() => setShowKey(!showKey)}
                      style={{
                        position: "absolute",
                        right: 8,
                        top: "50%",
                        transform: "translateY(-50%)",
                        background: "transparent",
                        border: "none",
                        cursor: "pointer",
                        padding: 4,
                        display: "flex",
                        alignItems: "center",
                        color: showKey ? C.teal : C.slate,
                      }}
                      title={showKey ? "Hide API key" : "View API key while typing"}
                    >
                      {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  ) : null}
                </div>
                <div style={hintStyle}>Stored encrypted. Leave empty for a self-hosted model with a Base URL.</div>
              </div>

              {/* Row 2, Col 1: Base URL / Region */}
              <div>
                <label style={labelStyle}>CUSTOM BASE URL / REGION (OPTIONAL)</label>
                <input
                  value={form.baseUrl || ""}
                  onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                  placeholder={placeholderUrl}
                  style={input}
                />
                <div style={hintStyle}>e.g. {kind === "text" ? "https://api.deepseek.com or http://host.docker.internal:11434/v1" : "https://api.stability.ai or https://api.fal.ai/v1"}. In Docker, a model on the same machine is at host.docker.internal, not localhost.</div>
              </div>

              {/* Row 2, Col 2: Model Name */}
              <div>
                <label style={labelStyle}>MODEL NAME (OPTIONAL)</label>
                <input
                  value={form.model || ""}
                  onChange={(e) => setForm({ ...form, model: e.target.value })}
                  placeholder={placeholderModel}
                  style={input}
                />
                <div style={hintStyle}>Default model (can be edited anytime)</div>
              </div>
            </div>

            {/* Form Action Button */}
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button
                type="submit"
                disabled={busy || !String(form.provider || "").trim()}
                style={{
                  ...priBtn,
                  background: highlightedYellow ? "#D97706" : C.teal,
                  height: 38,
                  padding: "0 18px",
                  fontSize: 13,
                }}
              >
                {busy ? "Verifying connection…" : `Verify & save ${kind === "text" ? "Text" : "Image"} AI`}
              </button>
            </div>
          </form>

          {msg && (
            <div style={{ fontSize: 12.5, marginTop: 12, color: msg.ok ? C.teal : C.red, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
              <span>{msg.ok ? "✓" : "✕"}</span> {msg.text}
            </div>
          )}
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
    <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5 }}>
      <span style={{ color: t.ok ? C.teal : C.red, fontWeight: 600 }}>
        {t.ok ? <Check size={13} style={{ verticalAlign: -2 }} /> : "✕"} Writing AI: {tName}{t.model ? ` · ${t.model}` : ""}
        {!t.ok && t.error ? ` — ${t.error}` : ""}
      </span>
      <span style={{ color: i.missingKeyFor ? C.amber : C.teal, fontWeight: 600 }}>
        <Check size={13} style={{ verticalAlign: -2 }} /> Image AI: {iName}{i.model ? ` · ${i.model}` : ""}
        {i.missingKeyFor ? ` (no ${imageProviders[i.missingKeyFor] || i.missingKeyFor} key — using free)` : ""}
      </span>
    </div>
  );
}

function SaveBadge({ state }) {
  if (!state) return null;
  const map = {
    saving: { text: "Saving…", color: C.slate },
    saved: { text: "✓ Saved", color: C.teal },
    error: { text: "Not saved", color: C.red },
  };
  const s = map[state];
  return <span style={{ fontSize: 12, fontWeight: 700, color: s.color, whiteSpace: "nowrap" }}>{s.text}</span>;
}

const card = { background: "#fff", border: `1px solid ${C.border}`, borderRadius: 16, padding: "20px 22px", marginBottom: 22, fontFamily: FONT_BODY };
const title = { fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, color: C.ink };
const grid2 = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px 16px" };
const labelStyle = { display: "block", fontSize: 11, fontWeight: 700, color: C.slateLight, marginBottom: 6, letterSpacing: "0.04em" };
const hintStyle = { fontSize: 11, color: C.slate, marginTop: 4, lineHeight: 1.3 };
const input = { width: "100%", boxSizing: "border-box", height: 38, padding: "0 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13, fontFamily: FONT_BODY, background: "#fff", color: C.ink };
const secBtn = { display: "inline-flex", alignItems: "center", gap: 6, height: 36, padding: "0 12px", borderRadius: 9, border: `1px solid ${C.border}`, background: "#fff", color: C.ink, fontWeight: 600, fontSize: 12.5, cursor: "pointer", fontFamily: FONT_BODY };
const priBtn = { ...secBtn, border: "none", background: C.ink, color: "#fff" };
