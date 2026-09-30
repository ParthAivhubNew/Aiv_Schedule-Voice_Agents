import {
  AlertTriangle,
  Brain,
  Check,
  Cpu,
  Mic,
  PhoneCall,
  Save,
  User,
  Volume2,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "../api/apiClient";
import { C, FONT_BODY, FONT_DISPLAY } from "../app/constants";
import { announceVoiceChanged, VoicePicker } from "../plugins/voice/VoicePicker";

export function QuickSwitchModelModal({
  layerKey,
  layerTitle,
  layerName,
  hubData,
  connections = [],
  onClose,
  onSelectSuccess,
  onOpenCredentials,
}) {
  const [switching, setSwitching] = useState(false);
  const [selectedVal, setSelectedVal] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");

  const groupMap = {
    llm: "LLM",
    stt: "Speech-to-Text",
    tts: "Text-to-Speech",
    telephony: "Telephony",
    engine: "Voice Orchestration",
    voice: "Voice Persona",
  };

  const groupName = groupMap[layerKey] || layerName || "LLM";

  // Build model and provider options from all configured/registered items in DB + built-ins + standard options
  const options = useMemo(() => {
    const rawGroupItems = connections.find((g) => g.group === groupName)?.items || [];
    const groupItems = rawGroupItems;

    if (layerKey === "engine") {
      return [
        {
          id: "modular",
          label: "Modular Voice Pipeline (Ultra-Low Latency Streaming)",
          desc: "Decoupled Deepgram STT + Streaming LLM + Cartesia/ElevenLabs TTS with sub-500ms response.",
          badge: "Ultra-Fast (300ms)",
          value: "modular",
          isBuiltIn: true,
        },
        {
          id: "livekit",
          label: "LiveKit WebRTC Agents",
          desc: "WebRTC browser calling & SIP telephony bridge with realtime stream pacing.",
          badge: "Browser & SIP",
          value: "livekit",
          isBuiltIn: true,
        },
        {
          id: "xai",
          label: "xAI Realtime Grok (Speech-to-Speech)",
          desc: "Direct native speech-to-speech audio model via xAI SIP trunking.",
          badge: "Speech-to-Speech",
          value: "xai",
          isBuiltIn: true,
        },
        {
          id: "openai",
          label: "OpenAI Realtime",
          desc: "OpenAI Realtime bidirectional audio API pipeline.",
          badge: "Realtime",
          value: "openai",
          isBuiltIn: true,
        },
      ];
    }


    if (layerKey === "llm") {
      const res = [];
      const seenProviders = new Set();
      groupItems.forEach((c) => {
        const modelName = (c.model || (c.name.toLowerCase().includes("telnyx") ? "meta-llama/Meta-Llama-3.1-70B-Instruct" : c.name.toLowerCase().includes("deepseek") ? "deepseek-chat" : c.name.toLowerCase().includes("openai") ? "gpt-4o-mini" : c.name.toLowerCase().includes("anthropic") ? "claude-3-5-sonnet-20241022" : "")).trim();
        const providerTitle = c.name || "LLM";
        seenProviders.add(providerTitle.toLowerCase());
        const isConnected = c.status === "connected" || (c.apiKeyMasked && c.apiKeyMasked.length > 0);
        res.push({
          id: c.id,
          provider: providerTitle,
          label: modelName ? `${providerTitle} (${modelName})` : providerTitle,
          desc: `${providerTitle} · Model: ${modelName || "Default"}`,
          badge: isConnected ? (modelName || "Connected") : "Needs Key",
          value: providerTitle,
          model: modelName,
          isConnected,
        });
      });

      // Default standard templates if not already present
      const standardLlms = [
        { name: "Telnyx AI", model: "meta-llama/Meta-Llama-3.1-70B-Instruct" },
        { name: "OpenAI", model: "gpt-4o-mini" },
        { name: "DeepSeek", model: "deepseek-chat" },
        { name: "Anthropic (Claude)", model: "claude-3-5-sonnet-20241022" },
        { name: "xAI (Grok)", model: "grok-4.20-0309-non-reasoning" },
        { name: "Groq", model: "llama-3.3-70b-versatile" },
      ];
      standardLlms.forEach((sl) => {
        if (!seenProviders.has(sl.name.toLowerCase()) && ![...seenProviders].some((p) => p.includes(sl.name.toLowerCase()) || sl.name.toLowerCase().includes(p))) {
          res.push({
            id: `std_llm_${sl.name.toLowerCase().replace(/[^a-z0-9]/g, "_")}`,
            provider: sl.name,
            label: `${sl.name} (${sl.model})`,
            desc: `Standard LLM · Model: ${sl.model}`,
            badge: sl.model,
            value: sl.name,
            model: sl.model,
            isConnected: false,
          });
        }
      });
      return res;
    }

    if (layerKey === "stt") {
      const res = [];
      const seenProviders = new Set();
      groupItems.forEach((c) => {
        const modelName = (c.model || (c.name.toLowerCase().includes("deepgram") ? "nova-2" : c.name.toLowerCase().includes("telnyx") ? "openai/whisper-large-v3" : "")).trim();
        const providerTitle = c.name || "STT";
        seenProviders.add(providerTitle.toLowerCase());
        const isConnected = c.status === "connected" || (c.apiKeyMasked && c.apiKeyMasked.length > 0);
        res.push({
          id: c.id,
          provider: providerTitle,
          label: modelName ? `${providerTitle} (${modelName})` : providerTitle,
          desc: `${providerTitle} · Model: ${modelName || "Default"}`,
          badge: isConnected ? (modelName || "Connected") : "Needs Key",
          value: providerTitle,
          model: modelName,
          isConnected,
        });
      });

      const standardStts = [
        { name: "Deepgram", model: "nova-2" },
        { name: "Telnyx Whisper", model: "openai/whisper-large-v3" },
      ];
      standardStts.forEach((st) => {
        if (!seenProviders.has(st.name.toLowerCase()) && ![...seenProviders].some((p) => p.includes(st.name.toLowerCase()) || st.name.toLowerCase().includes(p))) {
          res.push({
            id: `std_stt_${st.name.toLowerCase().replace(/[^a-z0-9]/g, "_")}`,
            provider: st.name,
            label: `${st.name} (${st.model})`,
            desc: `Standard STT · Model: ${st.model}`,
            badge: st.model,
            value: st.name,
            model: st.model,
            isConnected: false,
          });
        }
      });
      return res;
    }

    if (layerKey === "tts") {
      const res = [];
      const seenProviders = new Set();
      groupItems.forEach((c) => {
        const cLower = (c.name || "").toLowerCase();
        const modelName = (c.model || (cLower.includes("cartesia") ? "sonic-3" : cLower.includes("telnyx") ? "telnyx/natural" : cLower.includes("eleven") ? "eleven_turbo_v2_5" : "")).trim();
        const providerTitle = c.name || "TTS";
        seenProviders.add(providerTitle.toLowerCase());
        const isConnected = c.status === "connected" || (c.apiKeyMasked && c.apiKeyMasked.length > 0);
        res.push({
          id: c.id,
          provider: providerTitle,
          label: modelName ? `${providerTitle} (${modelName})` : providerTitle,
          desc: `${providerTitle} · ${c.voiceId ? `Voice: ${c.voiceId}` : "Voice persona"}`,
          badge: isConnected ? (modelName || "Connected") : "Needs Key",
          value: providerTitle,
          voiceId: c.voiceId,
          model: modelName,
          isConnected,
        });
      });

      const standardTts = [
        { name: "Cartesia", model: "sonic-3" },
        { name: "Telnyx Natural (TTS)", model: "telnyx/natural" },
        { name: "ElevenLabs", model: "eleven_turbo_v2_5" },
        { name: "Deepgram Aura", model: "aura-asteria-en" },
      ];
      standardTts.forEach((st) => {
        if (!seenProviders.has(st.name.toLowerCase()) && ![...seenProviders].some((p) => p.includes(st.name.toLowerCase()) || st.name.toLowerCase().includes(p))) {
          res.push({
            id: `std_tts_${st.name.toLowerCase().replace(/[^a-z0-9]/g, "_")}`,
            provider: st.name,
            label: `${st.name} (${st.model})`,
            desc: `Standard TTS · Model: ${st.model}`,
            badge: st.model,
            value: st.name,
            model: st.model,
            isConnected: false,
          });
        }
      });

      // Built-in engine voices
      res.push(
        { id: "xai_rex", provider: "xAI", label: "xAI built-in (rex)", desc: "Warm energetic male voice persona bundled in engine.", badge: "Engine Voice", value: "xAI built-in (rex)", isBuiltIn: true },
        { id: "xai_ara", provider: "xAI", label: "xAI built-in (ara)", desc: "Clear professional female voice persona bundled in engine.", badge: "Engine Voice", value: "xAI built-in (ara)", isBuiltIn: true },
        { id: "xai_eve", provider: "xAI", label: "xAI built-in (eve)", desc: "Engaging female voice persona bundled in engine.", badge: "Engine Voice", value: "xAI built-in (eve)", isBuiltIn: true },
        { id: "xai_leo", provider: "xAI", label: "xAI built-in (leo)", desc: "Direct authoritative male voice persona bundled in engine.", badge: "Engine Voice", value: "xAI built-in (leo)", isBuiltIn: true }
      );
      return res;
    }

    if (layerKey === "telephony") {
      const res = [];
      const seenProviders = new Set();
      groupItems.forEach((c) => {
        const cLower = (c.name || "").toLowerCase();
        seenProviders.add(cLower);
        const isConnected = c.status === "connected" || (c.apiKeyMasked && c.apiKeyMasked.length > 0);
        if (cLower.includes("telnyx")) {
          res.push({
            id: c.id,
            provider: "Telnyx",
            label: "Telnyx (SIP Trunking)",
            desc: "High-throughput SIP trunking for low-latency bidirectional telephony.",
            badge: isConnected ? "SIP Trunk" : "Needs Key",
            value: "Telnyx",
            isConnected,
          });
        } else if (cLower.includes("twilio")) {
          res.push({
            id: c.id,
            provider: "Twilio",
            label: "Twilio (Voice & Media Streams)",
            desc: "Reliable global PSTN carrier with WebSocket bi-directional streaming.",
            badge: isConnected ? "Media Stream" : "Needs Key",
            value: "Twilio",
            isConnected,
          });
        } else {
          res.push({
            id: c.id,
            provider: c.name,
            label: c.name,
            desc: "Saved telephony carrier connection",
            badge: isConnected ? "Connected" : "Needs Key",
            value: c.name,
            isConnected,
          });
        }
      });

      if (!seenProviders.has("twilio")) {
        res.push({
          id: "std_twilio",
          provider: "Twilio",
          label: "Twilio (Voice & Media Streams)",
          desc: "Reliable global PSTN carrier with WebSocket bi-directional streaming.",
          badge: "Media Stream",
          value: "Twilio",
          isConnected: false,
        });
      }
      if (!seenProviders.has("telnyx")) {
        res.push({
          id: "std_telnyx",
          provider: "Telnyx",
          label: "Telnyx (SIP Trunking)",
          desc: "High-throughput SIP trunking for low-latency bidirectional telephony.",
          badge: "SIP Trunk",
          value: "Telnyx",
          isConnected: false,
        });
      }
      return res;
    }

    return groupItems.map((c) => ({
      id: c.id,
      label: c.name,
      desc: c.model ? `Model: ${c.model}` : "Connected Provider",
      badge: c.status === "connected" ? "Connected" : "Configured",
      value: c.name,
    }));
  }, [layerKey, groupName, connections, hubData]);

  const isOptionActive = (opt) => {
    const v = (opt.value || opt.label || "").toLowerCase();
    const m = (opt.model || "").toLowerCase();
    const curModel = String(hubData?.llmModel || "").toLowerCase();
    const curLlm = String(hubData?.llmName || hubData?.llmProvider || "").toLowerCase();

    if (layerKey === "engine") {
      const curEngine = String(hubData?.liveEngine || hubData?.activeEngine || "").toLowerCase();
      return (opt.value && curEngine === opt.value.toLowerCase()) || curEngine.includes(v);
    }
    if (layerKey === "llm") {
      if (m) {
        if (curModel) return curModel === m;
        if (curLlm.includes("deepseek")) return m === "deepseek-chat";
        if (curLlm.includes("groq")) return m === "llama-3.3-70b-versatile";
        if (curLlm.includes("openai")) return m === "gpt-4o-mini";
        if (curLlm.includes("anthropic")) return m === "claude-3-5-sonnet-20241022";
        if (curLlm.includes("xai") || curLlm.includes("grok")) return m.includes("grok");
        return curLlm.includes(m);
      }
      return curLlm === v || curLlm.includes(v);
    }
    if (layerKey === "stt") {
      const curStt = String(hubData?.sttName || hubData?.sttProvider || "").toLowerCase();
      const curSttModel = String(hubData?.sttModel || "").toLowerCase();
      if (m) {
        if (curSttModel) return curSttModel === m;
        if (curStt.includes("deepgram")) return m === "nova-2";
        return curStt.includes(m);
      }
      return curStt === v || curStt.includes(v);
    }
    if (layerKey === "tts") {
      const curTts = String(hubData?.ttsName || hubData?.ttsProvider || hubData?.voiceName || "").toLowerCase();
      return curTts === v || (opt.id && curTts.includes(opt.id.toLowerCase())) || curTts.includes(v);
    }
    if (layerKey === "telephony") {
      const curCarrier = String(hubData?.activeCarrier || "").toLowerCase();
      return curCarrier.includes(v);
    }
    return false;
  };

  const handleSelect = async (opt) => {
    setSelectedVal(opt.id || opt.value);
    setSwitching(true);
    setErrorMsg("");
    try {
      const payload = {};
      if (layerKey === "engine") {
        payload.engine = opt.value;
      } else if (layerKey === "llm") {
        payload.llm = opt.provider || opt.value;
        if (opt.model) payload.llm_model = opt.model;
      } else if (layerKey === "stt") {
        payload.stt = opt.provider || opt.value;
        if (opt.model) payload.stt_model = opt.model;
      } else if (layerKey === "tts") {
        payload.tts = opt.provider || opt.value;
        if (opt.model) payload.tts_model = opt.model;
      } else if (layerKey === "telephony") {
        payload.carrier = opt.value;
      }

      await api.selectActiveStack(payload);
      // Switching engine or TTS can change which call voice fits.
      announceVoiceChanged();
      setTimeout(() => {
        if (onSelectSuccess) onSelectSuccess(opt);
        onClose();
      }, 300);
    } catch (err) {
      setErrorMsg(err.message || "Failed to switch active model.");
      setSwitching(false);
    }
  };

  const getLayerIcon = () => {
    if (layerKey === "llm") return <Brain size={20} color="#4F46E5" />;
    if (layerKey === "stt") return <Mic size={20} color="#059669" />;
    if (layerKey === "tts") return <Volume2 size={20} color="#D97706" />;
    if (layerKey === "telephony") return <PhoneCall size={20} color="#2563EB" />;
    if (layerKey === "engine") return <Cpu size={20} color="#7C3AED" />;
    return <User size={20} color="#DB2777" />;
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.65)", backdropFilter: "blur(5px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 110, padding: 20 }}>
      <div style={{ background: "#fff", borderRadius: 18, width: "100%", maxWidth: 520, padding: 24, boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)", border: `1px solid ${C.border}`, display: "flex", flexDirection: "column", maxHeight: "90vh" }}>
        
        {/* Modal Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ padding: 8, borderRadius: 10, background: "#F1F5F9", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {getLayerIcon()}
            </div>
            <div>
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17, color: C.textInk }}>
                Switch {layerTitle || "Model"}
              </div>
              <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.slate, marginTop: 2 }}>
                1-click switch between saved & built-in options
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", color: C.slate, padding: 4, borderRadius: 6 }}
          >
            <X size={19} />
          </button>
        </div>

        {errorMsg && (
          <div style={{ padding: "8px 12px", borderRadius: 8, background: "#FEF2F2", border: "1px solid #FCA5A5", color: "#B91C1C", fontSize: 12, marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
            <AlertTriangle size={14} /> {errorMsg}
          </div>
        )}

        {/* Scrollable Model Options */}
        <div style={{ overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, paddingRight: 4, maxHeight: 380, margin: "4px 0 16px" }}>
          {layerKey === "voice" ? (
            <VoicePicker variant="full" />
          ) : options.length === 0 ? (
            <div style={{ padding: "28px 16px", textAlign: "center", background: "#F8FAFC", borderRadius: 12, border: `1px dashed ${C.border}` }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.textInk, marginBottom: 4 }}>
                No connected {layerTitle || "providers"} found
              </div>
              <div style={{ fontSize: 12, color: C.slate, maxWidth: 360, margin: "0 auto 14px", lineHeight: 1.4 }}>
                Save your API key under Connections to unlock models in this category for live calling.
              </div>
              <button
                type="button"
                onClick={() => {
                  if (onOpenCredentials) onOpenCredentials();
                }}
                style={{ background: C.ink, color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}
              >
                Go to Connections
              </button>
            </div>
          ) : (
            options.map((opt) => {
              const active = isOptionActive(opt);
              const isBusy = switching && selectedVal === (opt.id || opt.value);

              return (
                <div
                  key={opt.id || opt.value}
                  onClick={() => !active && !switching && handleSelect(opt)}
                  style={{
                    padding: "12px 14px",
                    borderRadius: 12,
                    border: active ? "1.5px solid #10B981" : "1px solid #E2E8F0",
                    background: active ? "#F0FDF4" : "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    cursor: active ? "default" : (switching ? "wait" : "pointer"),
                    transition: "all 0.15s ease",
                  }}
                  onMouseEnter={(e) => {
                    if (!active && !switching) {
                      e.currentTarget.style.borderColor = "#94A3B8";
                      e.currentTarget.style.background = "#F8FAFC";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!active && !switching) {
                      e.currentTarget.style.borderColor = "#E2E8F0";
                      e.currentTarget.style.background = "#fff";
                    }
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 3 }}>
                      <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 13.5, color: C.textInk }}>
                        {opt.label}
                      </span>
                      {opt.badge && (
                        <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 6px", borderRadius: 6, background: active ? "#D1FAE5" : "#F1F5F9", color: active ? "#065F46" : "#475569" }}>
                          {opt.badge}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11.5, color: C.slate, lineHeight: 1.35 }}>
                      {opt.desc}
                    </div>
                  </div>

                  <div>
                    {active ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 700, padding: "4px 10px", borderRadius: 999, background: "#10B981", color: "#fff" }}>
                        <Check size={13} /> Active
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={switching}
                        style={{
                          background: isBusy ? "#94A3B8" : "#fff",
                          color: isBusy ? "#fff" : C.ink,
                          border: `1px solid ${C.border}`,
                          borderRadius: 7,
                          padding: "5px 11px",
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: switching ? "wait" : "pointer",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {isBusy ? "Switching…" : "Use this"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Modal Footer */}
        <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 14, display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, color: C.slate }}>
          <span>Need a model not listed?</span>
          <button
            type="button"
            onClick={() => {
              if (onOpenCredentials) onOpenCredentials();
            }}
            style={{ background: "none", border: "none", color: C.cobalt, fontWeight: 600, cursor: "pointer", fontSize: 12, padding: 0 }}
          >
            + Connect new provider in Connections →
          </button>
        </div>

      </div>
    </div>
  );
}
