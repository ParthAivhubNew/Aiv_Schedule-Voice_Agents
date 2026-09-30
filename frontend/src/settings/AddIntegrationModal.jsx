import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  KeyRound,
  Phone,
  Save,
  ShieldCheck,
  X,
} from "lucide-react";
import { useState } from "react";
import { Line } from "recharts";
import { api } from "../api/apiClient";
import { C, FAMOUS_PROVIDERS_BY_LAYER, FONT_BODY, FONT_DISPLAY, FONT_MONO } from "../app/constants";
import { SelfHostedHint } from "../app/ui";

export function AddIntegrationModal({ onClose, onAddSuccess, initialCategory = "LLM" }) {
  const [category, setCategory] = useState(initialCategory && FAMOUS_PROVIDERS_BY_LAYER[initialCategory] ? initialCategory : "LLM");
  const [providerChoice, setProviderChoice] = useState(
    ((FAMOUS_PROVIDERS_BY_LAYER[initialCategory] || FAMOUS_PROVIDERS_BY_LAYER.LLM) || ["Other (Custom Base URL)"])[0]
  );
  const [customName, setCustomName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [voiceId, setVoiceId] = useState("");
  const [useForCalls, setUseForCalls] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [accountSid, setAccountSid] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [showPhoneField, setShowPhoneField] = useState(false);

  const [testing, setTesting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const isOther = providerChoice.startsWith("Other") || category === "Other";
  const isTwilio = providerChoice === "Twilio" || providerChoice.includes("Twilio");
  const isTelnyx = providerChoice.toLowerCase().includes("telnyx");
  const isWhatsApp = providerChoice.toLowerCase().includes("whatsapp") || category === "Messaging";
  const isTts = category === "Text-to-Speech";
  const providerList = FAMOUS_PROVIDERS_BY_LAYER[category] || ["Other (Custom Base URL)"];

  const getModelPlaceholder = (cat, prov) => {
    if (prov.includes("Telnyx AI") || (cat === "LLM" && prov.includes("Telnyx"))) return "meta-llama/Meta-Llama-3.1-70B-Instruct";
    if (prov.includes("Telnyx Whisper") || (cat === "Speech-to-Text" && prov.includes("Telnyx"))) return "openai/whisper-large-v3";
    if (prov.includes("Telnyx Natural") || (cat === "Text-to-Speech" && prov.includes("Telnyx"))) return "telnyx/natural";
    if (prov.includes("DeepSeek")) return "deepseek-chat";
    if (prov.includes("OpenAI") && cat === "LLM") return "gpt-4o-mini";
    if (prov.includes("OpenAI") && cat === "Speech-to-Text") return "whisper-1";
    if (prov.includes("Anthropic")) return "claude-3-5-sonnet-20241022";
    if (prov.includes("xAI") || prov.includes("Grok")) return "grok-4.20-0309-non-reasoning";
    if (prov.includes("Groq")) return "llama-3.3-70b-versatile";
    if (prov.includes("Deepgram") && cat === "Speech-to-Text") return "nova-2";
    if (prov.includes("Deepgram") && cat === "Text-to-Speech") return "aura-asteria-en";
    if (prov.includes("Cartesia")) return "sonic-3";
    if (prov.includes("ElevenLabs")) return "eleven_turbo_v2_5";
    if (cat === "LLM") return "e.g. meta-llama/Meta-Llama-3.1-70B-Instruct";
    if (cat === "Speech-to-Text") return "e.g. nova-2, openai/whisper-large-v3";
    if (cat === "Text-to-Speech") return "e.g. sonic-3, telnyx/natural";
    return "e.g. model-id-or-slug";
  };

  const handleCategoryChange = (cat) => {
    setCategory(cat);
    const firstChoice = (FAMOUS_PROVIDERS_BY_LAYER[cat] || ["Other (Custom Base URL)"])[0];
    setProviderChoice(firstChoice);
    setErrorMsg("");
    setSuccessMsg("");
    setShowPhoneField(false);
  };

  const handleTestAndSave = async (e) => {
    e.preventDefault();
    setErrorMsg("");
    setSuccessMsg("");

    if (!apiKey.trim() && !(isOther && baseUrl.trim())) {
      setErrorMsg(isOther ? "Enter the Base URL. The key is optional for self-hosted models." : "API key cannot be empty.");
      return;
    }

    if (isOther && !baseUrl.trim()) {
      setErrorMsg("Custom providers require a valid Base URL.");
      return;
    }

    if (isTwilio && !accountSid.trim() && !apiKey.includes(":")) {
      setErrorMsg("Twilio requires your Account SID and Auth Token.");
      return;
    }

    if (isWhatsApp && !accountSid.trim()) {
      setErrorMsg("WhatsApp Cloud API requires your Meta Phone Number ID.");
      return;
    }

    setTesting(true);

    const effProviderName = isOther ? (customName.trim() || "Custom Provider") : providerChoice.split(" (")[0];

    try {
      // 1. Call Backend Validator
      const res = await api.testAndSaveConnection({
        layer: category,
        provider: effProviderName,
        api_key: apiKey.trim(),
        base_url: baseUrl.trim() || undefined,
        account_sid: accountSid.trim() || undefined,
        model: model.trim() || undefined,
        voice_id: isTts && voiceId.trim() ? voiceId.trim() : undefined,
        use_for_calls: isTts && voiceId.trim() ? useForCalls : undefined,
      });

      if (isTelnyx && phoneNumber.trim()) {
        try {
          localStorage.setItem("aivhub_caller_id", phoneNumber.trim());
          await api.updateProfile({ callerId: phoneNumber.trim() });
        } catch (_) {}
      }

      setSuccessMsg(`✓ ${res.details || "API Key verified & active!"}`);
      setTimeout(() => {
        onAddSuccess({
          category,
          name: effProviderName,
          status: "connected",
          key: apiKey.trim(),
          masked: res.maskedKey,
          model: model.trim() || undefined,
          baseUrl: baseUrl.trim() || undefined,
          voiceId: isTts && voiceId.trim() ? voiceId.trim() : undefined,
          phoneNumber: phoneNumber.trim() || undefined,
        });
        onClose();
      }, 900);
    } catch (err) {
      setErrorMsg(err.message || "Authentication failed. Key was rejected by the provider.");
    } finally {
      setTesting(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(18,20,28,0.55)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20 }}>
      <div style={{ background: "#fff", borderRadius: 18, width: "100%", maxWidth: 480, maxHeight: "90vh", overflowY: "auto", padding: 26, boxShadow: "0 24px 70px rgba(0,0,0,0.25)", border: `1px solid ${C.border}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18, color: C.textInk, display: "flex", alignItems: "center", gap: 8 }}>
            <KeyRound size={18} color={C.cobalt} /> Add & Validate Provider Key
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: C.slate }}><X size={18} /></button>
        </div>

        <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate, marginBottom: 18, lineHeight: 1.45 }}>
          Keys are <strong>actively tested and authenticated</strong> against the provider before saving to ensure 100% reliable calls.
        </div>

        <form onSubmit={handleTestAndSave} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Layer Category */}
          <div>
            <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 11.5, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>
              Infrastructure Layer
            </label>
            <select
              value={category}
              onChange={(e) => handleCategoryChange(e.target.value)}
              style={{ width: "100%", height: 38, padding: "0 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13, background: "#fff" }}
            >
              {Object.keys(FAMOUS_PROVIDERS_BY_LAYER).map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {/* Provider Dropdown */}
          <div>
            <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 11.5, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>
              Provider
            </label>
            <select
              value={providerChoice}
              onChange={(e) => { setProviderChoice(e.target.value); setErrorMsg(""); setSuccessMsg(""); }}
              style={{ width: "100%", height: 38, padding: "0 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13, background: "#fff" }}
            >
              {providerList.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>

          {/* Custom Name if Other */}
          {isOther && (
            <div>
              <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 11.5, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>
                Custom Provider Name
              </label>
              <input
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="e.g. TogetherAI, Local vLLM, Custom SIP"
                style={{ width: "100%", height: 38, padding: "0 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13 }}
              />
            </div>
          )}

          {/* Model Name / Slug */}
          {(category === "LLM" || category === "Speech-to-Text" || category === "Text-to-Speech" || category === "Voice Orchestration" || isOther) && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <label style={{ fontFamily: FONT_BODY, fontSize: 11.5, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  {category === "LLM" ? "Model Name / Slug" : category === "Speech-to-Text" ? "STT Model / Engine" : category === "Text-to-Speech" ? "TTS Voice / Model" : "Model Identifier (Optional)"}
                </label>
                {(category === "LLM" || category === "Speech-to-Text" || category === "Text-to-Speech") && (
                  <span
                    style={{ fontSize: 11, color: C.cobalt, cursor: "pointer", fontWeight: 600 }}
                    onClick={() => setModel(getModelPlaceholder(category, providerChoice))}
                    title="Click to fill recommended default model"
                  >
                    Auto-fill default
                  </span>
                )}
              </div>
              <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={getModelPlaceholder(category, providerChoice)}
                style={{ width: "100%", height: 38, padding: "0 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_MONO, fontSize: 12.5 }}
              />
              <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.slateLight, marginTop: 4 }}>
                {category === "LLM"
                  ? "Specify the model to run for conversational reasoning (e.g. meta-llama/Meta-Llama-3.1-70B-Instruct for Telnyx AI)."
                  : category === "Speech-to-Text"
                  ? "Acoustic model for speech recognition (e.g. openai/whisper-large-v3, nova-2)."
                  : category === "Text-to-Speech"
                  ? "Voice model synthesis engine (e.g. telnyx/natural, sonic-3)."
                  : "Model or engine identifier required by this endpoint."}
              </div>
            </div>
          )}

          {/* Twilio SID */}
          {isTwilio && (
            <div>
              <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 11.5, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>
                Twilio Account SID
              </label>
              <input
                value={accountSid}
                onChange={(e) => setAccountSid(e.target.value)}
                placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                style={{ width: "100%", height: 38, padding: "0 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_MONO, fontSize: 12.5 }}
              />
            </div>
          )}

          {/* WhatsApp Phone Number ID */}
          {isWhatsApp && (
            <div>
              <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 11.5, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>
                WhatsApp Phone Number ID
              </label>
              <input
                value={accountSid}
                onChange={(e) => setAccountSid(e.target.value)}
                placeholder="e.g. 1238965585975808 (15-digit ID from Meta Dev App)"
                style={{ width: "100%", height: 38, padding: "0 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_MONO, fontSize: 12.5 }}
              />
              <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.slateLight, marginTop: 4 }}>
                Found in Meta for Developers &gt; WhatsApp &gt; API Setup &gt; Phone number ID.
              </div>
            </div>
          )}

          {/* WhatsApp Registered Phone Number */}
          {isWhatsApp && (
            <div>
              <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 11.5, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>
                WhatsApp Registered Phone Number
              </label>
              <input
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="e.g. +44... or +1..."
                style={{ width: "100%", height: 38, padding: "0 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_MONO, fontSize: 12.5 }}
              />
              <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.slateLight, marginTop: 4 }}>
                The verified WhatsApp Business phone number used to send/receive messages.
              </div>
            </div>
          )}

          {/* Telnyx Telephony Outbound Phone Number (Direct for Telephony layer) */}
          {isTelnyx && category === "Telephony" && (
            <div>
              <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 11.5, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>
                Telnyx Outbound Phone Number
              </label>
              <input
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="e.g. +44... or +1..."
                style={{ width: "100%", height: 38, padding: "0 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_MONO, fontSize: 12.5 }}
              />
              <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.slateLight, marginTop: 4 }}>
                This number is verified on your Telnyx portal and used as your outbound Caller ID.
              </div>
            </div>
          )}

          {/* Telnyx Phone Number Optional Accordion Dropdown (for LLM / STT / TTS) */}
          {isTelnyx && category !== "Telephony" && (
            <div style={{ border: `1px dashed ${C.border}`, borderRadius: 8, padding: "10px 12px", background: "#FAF9F6" }}>
              <button
                type="button"
                onClick={() => setShowPhoneField(!showPhoneField)}
                style={{ background: "none", border: "none", cursor: "pointer", color: C.cobalt, fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, padding: 0, display: "flex", alignItems: "center", gap: 4 }}
              >
                {showPhoneField ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                {showPhoneField ? "Hide Telnyx Outbound Caller ID" : "Attach Outbound Phone Number (Optional)"}
              </button>
              {showPhoneField && (
                <div style={{ marginTop: 8 }}>
                  <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 5 }}>
                    Telnyx Outbound Phone Number
                  </label>
                  <input
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    placeholder="e.g. +44... or +1..."
                    style={{ width: "100%", height: 36, padding: "0 10px", borderRadius: 6, border: `1px solid ${C.border}`, fontFamily: FONT_MONO, fontSize: 12, background: "#fff" }}
                  />
                  <div style={{ fontFamily: FONT_BODY, fontSize: 10.5, color: C.slateLight, marginTop: 3 }}>
                    Optional: Save as your outbound Caller ID when dialing via Telnyx.
                  </div>
                </div>
              )}
            </div>
          )}

          {/* API Key */}
          <div>
            <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 11.5, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>
              {isTwilio ? "Auth Token" : isTelnyx ? "Telnyx API V2 Key" : isWhatsApp ? "Meta WhatsApp Access Token (EAAG...)" : isOther ? "API Key / Token (optional for self-hosted)" : "API Key / Token"}
            </label>
            <div style={{ position: "relative", width: "100%" }}>
              <input
                type={showApiKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => { setApiKey(e.target.value); setErrorMsg(""); setSuccessMsg(""); }}
                placeholder={isTelnyx ? "KEY018..." : isWhatsApp ? "EAAG..." : providerChoice.includes("DeepSeek") ? "sk-..." : providerChoice.includes("OpenAI") ? "sk-proj-..." : providerChoice.includes("Deepgram") ? "Token..." : "Paste API key..."}
                style={{ width: "100%", boxSizing: "border-box", height: 38, padding: "0 38px 0 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_MONO, fontSize: 12.5 }}
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", padding: 4, display: "flex", alignItems: "center", color: C.slateLight }}
                title={showApiKey ? "Hide key" : "Show key"}
              >
                {showApiKey ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          {isTts && (
            <div>
              <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 11.5, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>
                Voice ID (optional)
              </label>
              <input
                value={voiceId}
                onChange={(e) => setVoiceId(e.target.value)}
                placeholder={providerChoice.includes("Cartesia") ? "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" : "Voice ID from this provider"}
                style={{ width: "100%", height: 38, padding: "0 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_MONO, fontSize: 12.5 }}
              />
              <label style={{ display: "flex", gap: 6, alignItems: "center", fontFamily: FONT_BODY, fontSize: 12, color: C.textInk, marginTop: 6 }}>
                <input type="checkbox" checked={useForCalls} onChange={(e) => setUseForCalls(e.target.checked)} />
                Use for calls
              </label>
              <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.slateLight, marginTop: 4 }}>
                Saved to the voice library. Add more voices and switch between them under Line setup → Voice.
              </div>
            </div>
          )}

          {/* Base URL (if custom or Cal.com) */}
          {(isOther || providerChoice.includes("Cal.com")) && (
            <div>
              <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 11.5, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>
                Base URL / Endpoint
              </label>
              <input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder={providerChoice.includes("Cal.com") ? "https://api.cal.com/v2" : "https://api.your-custom-llm.com/v1"}
                style={{ width: "100%", height: 38, padding: "0 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13 }}
              />
              {isOther ? <SelfHostedHint /> : null}
            </div>
          )}

          {/* Error Message */}
          {errorMsg && (
            <div style={{ background: C.redSoft, border: `1px solid #F0C4B8`, borderRadius: 8, padding: "10px 14px", fontFamily: FONT_BODY, fontSize: 12.5, color: C.red, display: "flex", alignItems: "flex-start", gap: 8 }}>
              <AlertTriangle size={15} style={{ marginTop: 2, flexShrink: 0 }} />
              <div>{errorMsg}</div>
            </div>
          )}

          {/* Success Message */}
          {successMsg && (
            <div style={{ background: C.tealSoft, border: `1px solid #BFE6DF`, borderRadius: 8, padding: "10px 14px", fontFamily: FONT_BODY, fontSize: 12.5, color: C.teal, display: "flex", alignItems: "center", gap: 8 }}>
              <CheckCircle2 size={15} />
              <div>{successMsg}</div>
            </div>
          )}

          {/* Action Button */}
          <button
            type="submit"
            disabled={testing}
            style={{
              width: "100%",
              height: 44,
              borderRadius: 10,
              border: "none",
              background: testing ? C.slateLight : C.cobalt,
              color: "#fff",
              fontFamily: FONT_BODY,
              fontWeight: 600,
              fontSize: 14,
              cursor: testing ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              marginTop: 4,
            }}
          >
            {testing ? (
              <>Testing live authentication...</>
            ) : (
              <>
                <ShieldCheck size={16} /> Test & Save Key
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}


/* ---------------------------------- Direct Outbound Calling Component ---------------------------------- */
