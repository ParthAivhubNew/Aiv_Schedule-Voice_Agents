import {
  Activity,
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  Eye,
  EyeOff,
  Headphones,
  Phone,
  PhoneCall,
  Radio,
  RefreshCw,
  Save,
  ShieldCheck,
  Target,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Line } from "recharts";
import { api } from "../../api/apiClient";
import { C, FONT_BODY, FONT_DISPLAY, FONT_MONO, liveStackLabels } from "../../app/constants";
import { LiveKitBrowserCallModal } from "../../components/LiveKitBrowserCallModal";
import { AddIntegrationModal } from "../../settings/AddIntegrationModal";
import { QuickSwitchModelModal } from "../../settings/QuickSwitchModelModal";
import { DirectOutboundCallCard } from "./DirectOutboundCallCard";
import { VOICE_CHANGED_EVENT, VoicePicker } from "./VoicePicker";

export function CallPluginStackBoard({ hubData, connections = [], onChangeModel, onAddLayer, onOpenCredentials }) {
  const labels = liveStackLabels(hubData || {});
  const engine = String(hubData?.liveEngine || "").toLowerCase();
  const modular = engine === "modular" || engine === "livekit";
  const hybrid = !!hubData?.externalTts;
  const xaiLike = engine === "xai" || engine === "openai";

  const resolveModel = (key) => {
    if (key === "llm") {
      return hubData?.llmModel || hubData?.liveLabels?.llmModel || hubData?.liveLabels?.llm_model || (modular ? "gpt-4o-mini" : "");
    }
    if (key === "stt") {
      return hubData?.sttModel || hubData?.liveLabels?.sttModel || hubData?.liveLabels?.stt_model || (modular ? "nova-2" : "");
    }
    if (key === "tts") {
      return hubData?.ttsModel || hubData?.liveLabels?.ttsModel || hubData?.liveLabels?.tts_model || (modular || hybrid ? "sonic-3" : "");
    }
    if (key === "telephony") {
      return hubData?.phoneNumber || "";
    }
    return "";
  };

  const rows = [
    {
      key: "telephony",
      title: "Phone",
      layer: "Telephony",
      value: labels.carrier || hubData?.activeCarrier || "—",
      model: resolveModel("telephony"),
      isPhone: true,
      ok: hubData?.status === "connected" && !!hubData?.phoneNumber,
      hint: "Twilio, Telnyx, or SIP",
      needPlugin: true,
    },
    {
      key: "engine",
      title: "Call engine",
      layer: "Voice Orchestration",
      value: labels.engine,
      ok: hubData?.status === "connected" && !!engine,
      hint: "xAI · Modular · OpenAI",
      needPlugin: true,
    },
    {
      key: "stt",
      title: "Listen (STT)",
      layer: "Speech-to-Text",
      value: modular ? labels.stt : (xaiLike ? "Inside engine" : labels.stt),
      model: resolveModel("stt"),
      ok: modular ? !!(hubData?.sttProvider || hubData?.sttName) : hubData?.status === "connected",
      hint: modular ? "Deepgram, Whisper, …" : "Bundled — no separate plugin",
      needPlugin: true,
    },
    {
      key: "llm",
      title: "Think (LLM)",
      layer: "LLM",
      value: modular ? labels.llm : (xaiLike ? "Inside engine" : labels.llm),
      model: resolveModel("llm"),
      ok: modular ? !!(hubData?.llmProvider || hubData?.llmName) : hubData?.status === "connected",
      hint: modular ? "Groq, OpenAI, Grok chat, …" : "Bundled — no separate plugin",
      needPlugin: true,
    },
    {
      key: "tts",
      title: "Speak (TTS)",
      layer: "Text-to-Speech",
      value: (modular || hybrid)
        ? labels.tts
        : (engine === "xai"
          ? `xAI built-in (${hubData?.voiceLabel || "no voice picked"})`
          : engine === "openai"
            ? `OpenAI (${hubData?.voiceLabel || "no voice picked"})`
            : labels.tts),
      model: resolveModel("tts"),
      ok: modular || hybrid ? !!(hubData?.ttsProvider || hubData?.ttsName) : hubData?.status === "connected",
      hint: hybrid || modular ? "Cartesia, ElevenLabs, PlayHT, Other…" : "Using engine voice — Add TTS only to clone",
      needPlugin: true,
      recommend: engine === "xai" && !hybrid,
    },
    {
      key: "voice",
      title: "Call voice",
      layer: "Voice Persona",
      value: hubData?.voiceStatus === "ok"
        ? (hubData?.voiceLabel || hubData?.voiceName)
        : (hubData?.voiceProblem || "Not configured"),
      ok: hubData?.voiceStatus === "ok",
      hint: "Pick from the voice library: engine voices or saved TTS voices",
      needPlugin: true,
    },
  ];

  return (
    <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 14, padding: 20, margin: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <div>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, color: C.textInk }}>What Calling uses</div>
          <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate, marginTop: 4, maxWidth: 560, lineHeight: 1.45 }}>
            Live pieces for the next call. Click <strong>Change</strong> to switch between saved models. Yellow = still needed.
          </div>
        </div>
        <button
          type="button"
          onClick={() => onOpenCredentials && onOpenCredentials()}
          style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 12px", fontSize: 12.5, fontWeight: 600, color: C.ink, cursor: "pointer" }}
        >
          Connect providers
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map((r) => (
          <div
            key={r.key}
            style={{
              display: "grid",
              gridTemplateColumns: "140px 1fr auto",
              gap: 12,
              alignItems: "center",
              padding: "12px 14px",
              borderRadius: 10,
              border: `1px solid ${r.ok ? "#E2E8F0" : "#FDE68A"}`,
              background: r.ok ? "#F8FAFC" : "#FFFBEB",
            }}
          >
            <div>
              <div style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 13, color: C.textInk }}>{r.title}</div>
              <div style={{ fontSize: 11, color: C.slateLight, marginTop: 2 }}>{r.hint}</div>
            </div>
            <div>
              <div style={{ fontFamily: FONT_BODY, fontSize: 13.5, fontWeight: 600, color: C.ink, wordBreak: "break-all", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span>{r.value}</span>
                {r.model && !String(r.value || "").toLowerCase().includes(String(r.model || "").toLowerCase()) && (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      padding: "2px 8px",
                      borderRadius: 6,
                      background: r.isPhone ? "#F1F5F9" : "#EFF6FF",
                      border: `1px solid ${r.isPhone ? "#CBD5E1" : "#BFDBFE"}`,
                      color: r.isPhone ? "#334155" : "#1D4ED8",
                      fontSize: 11.5,
                      fontWeight: 600,
                      fontFamily: FONT_MONO,
                      letterSpacing: "0.01em",
                    }}
                    title={r.isPhone ? `Line Number: ${r.model}` : `Active Model: ${r.model}`}
                  >
                    <span style={{ width: 5, height: 5, borderRadius: "50%", background: r.isPhone ? "#64748B" : "#2563EB" }} />
                    {r.model}
                  </span>
                )}
              </div>
              {r.recommend && (
                <span style={{ display: "block", fontSize: 11, fontWeight: 500, color: "#B45309", marginTop: 2 }}>
                  Tip: add TTS plugin + Voice ID for your clone
                </span>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{
                fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 999,
                background: r.ok ? "#D1FAE5" : "#FEF3C7", color: r.ok ? "#065F46" : "#92400E",
              }}>
                {r.ok ? "Ready" : "Needed"}
              </span>
              {r.needPlugin && (
                <button
                  type="button"
                  onClick={() => {
                    if (r.ok && onChangeModel) {
                      onChangeModel(r.key, r.title, r.layer);
                    } else if (onAddLayer) {
                      onAddLayer(r.layer);
                    }
                  }}
                  style={{
                    background: C.ink, color: "#fff", border: "none", borderRadius: 7,
                    padding: "6px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
                  }}
                >
                  {r.ok ? "Change" : "Add"}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 12, fontSize: 12, color: C.slate, lineHeight: 1.45 }}>
        {modular
          ? "Modular mode: STT + LLM + TTS plugins all required from Connections."
          : hybrid
            ? "Hybrid mode: xAI listens/thinks; your TTS plugin speaks the clone."
            : "Engine-bundled mode: STT/LLM inside the engine. Add a TTS plugin anytime to unlock your own voice."}
      </div>
    </div>
  );
}

export function TelnyxAssistantSettingsCard() {
  const [assistantId, setAssistantId] = useState("");
  const [publicKey, setPublicKey] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");
  const [dialTo, setDialTo] = useState("");
  const [dialing, setDialing] = useState(false);
  const [dialMsg, setDialMsg] = useState("");
  const [publicBase, setPublicBase] = useState("");
  const [copied, setCopied] = useState("");

  useEffect(() => {
    let cancelled = false;
    api.getTelnyxAssistantSettings()
      .then((res) => {
        if (cancelled || !res) return;
        setAssistantId(res.assistantId || "");
        setPublicKey(res.publicKey || "");
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoaded(true); });
    api.getTelephonyHub()
      .then((hub) => {
        if (cancelled || !hub || !hub.webhookUrl) return;
        setPublicBase(String(hub.webhookUrl).replace(/\/api\/sip-webhook\/?$/, ""));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const handleSave = async () => {
    const id = assistantId.trim();
    if (id && !/^[A-Za-z0-9_-]{6,}$/.test(id)) {
      setSavedMsg("That doesn't look like an Assistant ID (copy it from Telnyx → AI Assistants).");
      return;
    }
    setSaving(true);
    setSavedMsg("");
    try {
      await api.saveTelnyxAssistantSettings({ assistant_id: id, public_key: publicKey.trim() });
      setSavedMsg("Saved");
      try { window.dispatchEvent(new Event("aivhub_telnyx_assistant_saved")); } catch (_) {}
      setTimeout(() => setSavedMsg(""), 2500);
    } catch (e) {
      setSavedMsg(e?.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const copyUrl = async (key, text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(""), 1400);
    } catch (_) {}
  };

  const handleDial = async () => {
    const to = dialTo.trim();
    if (!to) return;
    setDialing(true);
    setDialMsg("");
    try {
      const res = await api.dialViaTelnyxAssistant({ to });
      setDialMsg(res?.success ? `Calling ${res.to || to} — follow it on the Live page.` : (res?.error || "Call failed."));
      if (res?.success) {
        try { window.dispatchEvent(new CustomEvent("aivhub_set_voice_view", { detail: "live" })); } catch (_) {}
      }
    } catch (e) {
      setDialMsg(e?.message || "Call failed.");
    } finally {
      setDialing(false);
    }
  };

  const inputStyle = { width: "100%", height: 38, padding: "0 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_MONO, fontSize: 12.5 };

  return (
    <div style={{ background: C.paperCard, border: `1px solid ${C.border}`, borderRadius: 14, padding: 16 }}>
      <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 14, color: C.textInk }}>Telnyx AI Assistant Settings</div>
      <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.slateLight, marginTop: 3, marginBottom: 12 }}>
        Connects a Telnyx-hosted AI Assistant to this software (booking tools, call logging, and your active conversation template's prompt sync). Not needed unless you're using Telnyx's own voice stack.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div>
          <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 5 }}>Assistant ID</label>
          <input
            value={assistantId}
            onChange={(e) => setAssistantId(e.target.value)}
            placeholder="e.g. 18bc015c-1545-484e-ad84-50b8a02fec06"
            disabled={!loaded}
            style={inputStyle}
          />
        </div>
        <div>
          <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 5 }}>Account Public Key</label>
          <input
            value={publicKey}
            onChange={(e) => setPublicKey(e.target.value)}
            placeholder="From Telnyx: Account Settings -> Keys & Credentials"
            disabled={!loaded}
            style={inputStyle}
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            type="button"
            onClick={handleSave}
            disabled={!loaded || saving}
            style={{ background: C.ink, border: "none", borderRadius: 8, padding: "8px 16px", color: "#fff", fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 700, cursor: saving ? "wait" : "pointer" }}
          >
            {saving ? "Saving..." : "Save"}
          </button>
          {savedMsg && (
            <span style={{ fontFamily: FONT_BODY, fontSize: 12, color: savedMsg === "Saved" ? C.green : C.red, fontWeight: 600 }}>{savedMsg}</span>
          )}
        </div>

        {publicBase && (
          <div style={{ background: C.paper, border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 12px", display: "grid", gap: 6 }}>
            <div style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em" }}>Paste into your Telnyx Assistant</div>
            {[
              ["events", "Assistant webhook (dynamic variables + call end)", `${publicBase}/api/telnyx-assistant/call-event`],
              ["tools", "Webhook tool URL (replace {tool} with check_availability / book_appointment)", `${publicBase}/api/telnyx-assistant/tool/{tool}`],
            ].map(([k, label, url]) => (
              <div key={k} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.slate }}>{label}</div>
                  <div style={{ fontFamily: FONT_MONO, fontSize: 11.5, color: C.textInk, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{url}</div>
                </div>
                <button type="button" onClick={() => copyUrl(k, url)} style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 6, padding: "4px 10px", fontFamily: FONT_BODY, fontSize: 11.5, cursor: "pointer", whiteSpace: "nowrap" }}>
                  {copied === k ? "Copied" : "Copy"}
                </button>
              </div>
            ))}
          </div>
        )}

        <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 6, paddingTop: 12 }}>
          <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 5 }}>Call via Telnyx Assistant</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={dialTo}
              onChange={(e) => setDialTo(e.target.value)}
              placeholder="+1 555... destination number"
              disabled={dialing}
              style={{ ...inputStyle, flex: 1 }}
            />
            <button
              type="button"
              onClick={handleDial}
              disabled={dialing || !dialTo.trim()}
              style={{ background: C.cobalt || C.ink, border: "none", borderRadius: 8, padding: "0 16px", color: "#fff", fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 700, cursor: dialing ? "wait" : "pointer", whiteSpace: "nowrap" }}
            >
              {dialing ? "Calling..." : "Call"}
            </button>
          </div>
          {dialMsg && (
            <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: dialMsg.startsWith("Calling") ? C.green : C.red, fontWeight: 600, marginTop: 6 }}>{dialMsg}</div>
          )}
        </div>
      </div>
    </div>
  );
}

export function VoiceTrunkingHubTab({ notifications, setNotifications, profile, setProfile, onOpenCredentials }) {
  const getCachedHub = () => {
    try {
      const raw = localStorage.getItem("aivhub_telephony_hub_cache");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") return parsed;
      }
    } catch (_) {}
    return null;
  };

  const cached = getCachedHub();

  // Until /telephony-hub answers, show "Not configured" — never a made-up stack.
  const [hubData, setHubData] = useState(cached || {
    activeCarrier: "Not configured",
    activeEngine: "Not configured",
    liveEngine: "not_configured",
    liveNote: "",
    externalTts: false,
    ttsProvider: null,
    ttsName: "Not configured",
    llmProvider: null,
    llmName: "Not configured",
    sttProvider: null,
    sttName: "Not configured",
    ttsVoiceId: null,
    phoneNumber: profile?.callerId || "",
    silenceDurationMs: 380,
    temperature: 0.80,
    status: "not_configured",
    webhookUrl: "",
    xaiFqdn: "",
    codecs: ["G.711 μ-law (PCMU)", "G.711 A-law (PCMA)", "G.722"],
    isLive: false
  });
  const [carrierChoice, setCarrierChoice] = useState(() => {
    const c = String(cached?.activeCarrier || "twilio").toLowerCase();
    return c.includes("telnyx") ? "telnyx" : c.includes("sip") ? "generic_sip" : "twilio";
  });
  const [engineChoice, setEngineChoice] = useState(() => {
    return cached?.liveEngine || "livekit";
  });
  const [phoneNumber, setPhoneNumber] = useState(hubData?.phoneNumber || "");
  const [liveKitModalOpen, setLiveKitModalOpen] = useState(false);
  const [diagRunning, setDiagRunning] = useState(false);
  const [diagScore, setDiagScore] = useState(null);

  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [accountSid, setAccountSid] = useState("");
  const [signingSecret, setSigningSecret] = useState("");
  const [silenceDurationMs, setSilenceDurationMs] = useState(cached?.silenceDurationMs || 380);
  const [temperature, setTemperature] = useState(cached?.temperature || 0.80);
  const [webhookUrl, setWebhookUrl] = useState(cached?.webhookUrl || "");

  const [provisioning, setProvisioning] = useState(false);
  const [provisionMsg, setProvisionMsg] = useState(null);
  const [provisionErr, setProvisionErr] = useState("");

  const [pinging, setPinging] = useState(false);
  const [pingResult, setPingResult] = useState(null);
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const [copiedFqdn, setCopiedFqdn] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [showStackAdd, setShowStackAdd] = useState(false);
  const [stackAddLayer, setStackAddLayer] = useState("Text-to-Speech");
  const [inboundRoutingOpen, setInboundRoutingOpen] = useState(false);
  const [provisionConfirmOpen, setProvisionConfirmOpen] = useState(false);
  const [showProvisionTip, setShowProvisionTip] = useState(false);
  const [connsState, setConnsState] = useState([]);
  const [quickSwitchState, setQuickSwitchState] = useState({ open: false, layerKey: "", layerTitle: "", layerName: "" });

  const fetchStatus = async () => {
    try {
      const [data, conns] = await Promise.all([
        api.getTelephonyHub().catch(() => null),
        api.getConnections().catch(() => []),
      ]);
      if (conns && Array.isArray(conns)) {
        setConnsState(conns);
      }
      if (data) {
        setHubData(data);
        try {
          localStorage.setItem("aivhub_telephony_hub_cache", JSON.stringify(data));
        } catch (_) {}
        setPhoneNumber(data.phoneNumber || "");
        if (data.phoneNumber && setProfile) {
          setProfile((prev) => ({ ...prev, callerId: data.phoneNumber }));
        }
        if (data.webhookUrl) setWebhookUrl(data.webhookUrl);
        if (data.silenceDurationMs) setSilenceDurationMs(data.silenceDurationMs);
        if (data.temperature) setTemperature(data.temperature);
        if (data.signingSecret) setSigningSecret(data.signingSecret);
        if (data.activeCarrier) {
          const cLower = data.activeCarrier.toLowerCase();
          setCarrierChoice(cLower.includes("twilio") ? "twilio" : cLower.includes("sip") ? "generic_sip" : "telnyx");
        }
        // Only engines this form can set up; anything else keeps the current choice.
        const known = ["xai", "openai", "livekit", "modular"];
        const eLower = String(data.liveEngine || data.activeEngine || "").toLowerCase();
        const engine = known.find((k) => eLower === k) || known.find((k) => eLower.includes(k));
        if (engine) setEngineChoice(engine);
      }
    } catch (err) {
      console.error("Failed to load telephony hub data:", err);
    }
  };

  // A voice picked anywhere (this page, Calling, Connections) refreshes the line status.
  useEffect(() => {
    const onVoice = () => fetchStatus();
    window.addEventListener(VOICE_CHANGED_EVENT, onVoice);
    return () => window.removeEventListener(VOICE_CHANGED_EVENT, onVoice);
  }, []);

  useEffect(() => {
    fetchStatus();
  }, []);

  useEffect(() => {
    if (hubData?.phoneNumber !== undefined) {
      setPhoneNumber(hubData.phoneNumber || "");
    }
  }, [hubData?.phoneNumber]);

  const handleRunDiagnostics = async () => {
    try {
      setDiagRunning(true);
      const res = await api.runVoiceAndBookingDiagnostics();
      setDiagScore(res);
      if (typeof setNotifications === "function") {
        setNotifications((ns) => [
          {
            id: "n_" + Date.now(),
            text: `5-Point Diagnostics Score: ${res?.overall_score || (res?.all_passed ? "5/5 PASS" : "Results Ready")}`,
            time: "just now",
            unread: true,
            type: res?.all_passed ? "success" : "warning",
          },
          ...(ns || []),
        ]);
      }
    } catch (err) {
      if (typeof setNotifications === "function") {
        setNotifications((ns) => [
          {
            id: "n_" + Date.now(),
            text: `Diagnostics check failed: ${err.message || err}`,
            time: "just now",
            unread: true,
            type: "error",
          },
          ...(ns || []),
        ]);
      }
    } finally {
      setDiagRunning(false);
    }
  };

  const handlePing = async () => {
    setPinging(true);
    setPingResult(null);
    try {
      const res = await api.testTelephonyPing();
      setPingResult(res);
    } catch (err) {
      setPingResult({ success: false, latencyMs: 0, details: { error: String(err) } });
    } finally {
      setPinging(false);
    }
  };

  const handleProvision = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    setProvisionConfirmOpen(false);
    setProvisioning(true);
    setProvisionErr("");
    setProvisionMsg(null);

    if (!phoneNumber.trim()) {
      setProvisionErr("Phone number is required.");
      setProvisioning(false);
      return;
    }

    try {
      const res = await api.provisionTelephonyHub({
        carrier: carrierChoice,
        engine: engineChoice,
        phone_number: phoneNumber,
        api_key: apiKey,
        account_sid: accountSid,
        silence_duration_ms: Number(silenceDurationMs),
        temperature: Number(temperature),
        webhook_url: webhookUrl,
        signing_secret: signingSecret
      });

      setProvisionMsg(res);
      if (res.signingSecret) {
        setSigningSecret(res.signingSecret);
      }
      const activeNum = res.phoneNumber || phoneNumber;
      if (activeNum) setPhoneNumber(activeNum);
      await fetchStatus();
      if (setProfile) {
        setProfile((prev) => ({ ...prev, callerId: activeNum }));
      }
      try {
        const raw = localStorage.getItem("aivhub_company_profile");
        const p = raw ? JSON.parse(raw) : {};
        p.callerId = activeNum;
        localStorage.setItem("aivhub_company_profile", JSON.stringify(p));
      } catch (_) {}
      setNotifications((ns) => [
        { id: "n_" + Date.now(), text: res.message || `✓ Activated ${res.carrier} + ${res.engine} on ${activeNum}`, time: "just now", unread: true, type: "success" },
        ...ns
      ]);
    } catch (err) {
      setProvisionErr(err.message || "Failed to provision stack.");
    } finally {
      setProvisioning(false);
    }
  };

  const copyToClipboard = (text, type) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    if (type === "webhook") {
      setCopiedWebhook(true);
      setTimeout(() => setCopiedWebhook(false), 2000);
    } else if (type === "secret") {
      setCopiedSecret(true);
      setTimeout(() => setCopiedSecret(false), 2000);
    } else {
      setCopiedFqdn(true);
      setTimeout(() => setCopiedFqdn(false), 2000);
    }
  };


  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* 1. HERO ACTIVE STACK CARD */}
      <div
        style={{
          background: "#fff",
          borderRadius: 14,
          padding: "24px 28px",
          color: C.textInk,
          border: `1px solid ${C.border}`,
          boxShadow: "0 8px 28px rgba(18,20,28,0.06)",
          display: "flex",
          flexDirection: "column",
          gap: 18
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 44, height: 44, borderRadius: 10, background: C.cobaltSoft, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid #C7D7FA" }}>
              <Radio size={22} color={C.cobalt} />
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18, color: C.textInk }}>Active Voice & Telephony Trunk</span>
                {hubData?.status === "connected" ? (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 8px", borderRadius: 12, background: "#D1FAE5", border: "1px solid #A7F3D0", color: "#065F46", fontSize: 11, fontWeight: 600 }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#10B981" }} /> Live Call Ready
                  </span>
                ) : (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 8px", borderRadius: 12, background: "#FEF3C7", border: "1px solid #FDE68A", color: "#92400E", fontSize: 11, fontWeight: 600 }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#F59E0B" }} /> Not Configured
                  </span>
                )}
              </div>
              <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.slate, marginTop: 2 }}>
                {hubData.liveNote || "Live line status for the next call."}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <button
              onClick={handlePing}
              disabled={pinging}
              style={{
                background: C.cobaltSoft,
                border: "1px solid #C7D7FA",
                borderRadius: 8,
                padding: "8px 14px",
                color: C.cobaltDeep,
                fontFamily: FONT_BODY,
                fontSize: 12.5,
                fontWeight: 600,
                cursor: pinging ? "wait" : "pointer",
                display: "flex",
                alignItems: "center",
                gap: 6
              }}
            >
              {pinging ? <RefreshCw size={13} className="animate-spin" /> : <PhoneCall size={13} />}
              Test Inbound Ping
            </button>

            <button
              type="button"
              onClick={() => setLiveKitModalOpen(true)}
              style={{
                background: "linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%)",
                border: "none",
                borderRadius: 8,
                padding: "8px 16px",
                color: "#fff",
                fontFamily: FONT_BODY,
                fontSize: 12.5,
                fontWeight: 700,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 6,
                boxShadow: "0 2px 8px rgba(37,99,235,0.3)",
              }}
              title="Test the AI agent voice directly in your web browser via LiveKit WebRTC (no phone needed)"
            >
              <Headphones size={14} /> Test Call in Web (LiveKit)
            </button>
            <button
              type="button"
              onClick={handleRunDiagnostics}
              disabled={diagRunning}
              style={{
                background: C.ink,
                border: "none",
                borderRadius: 8,
                padding: "8px 16px",
                color: "#fff",
                fontFamily: FONT_BODY,
                fontSize: 12.5,
                fontWeight: 700,
                cursor: diagRunning ? "wait" : "pointer",
                display: "flex",
                alignItems: "center",
                gap: 6,
                boxShadow: "0 2px 8px rgba(15,23,42,0.18)",
              }}
              title="Run 5-point universal diagnostic health check across Telephony, STT, LLM, TTS, and Calendar"
            >
              <Activity size={14} className={diagRunning ? "animate-spin" : ""} />
              {diagRunning ? "Testing Stack..." : "5-Point Diagnostics"}
            </button>
          </div>
        </div>

        {/* Status Metrics Bar */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, paddingTop: 14, borderTop: `1px solid ${C.border}` }}>
          <div>
            <div style={{ fontSize: 11, color: C.slate, textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.05em" }}>Inbound Caller Line</div>
            <div style={{ fontFamily: FONT_MONO, fontSize: 15, fontWeight: 700, color: C.cobaltDeep, marginTop: 4 }}>{hubData.phoneNumber}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: C.slate, textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.05em" }}>Carrier Route</div>
            <div style={{ fontFamily: FONT_BODY, fontSize: 14, fontWeight: 600, color: hubData?.status === "connected" ? C.textInk : C.slate, marginTop: 4 }}>{hubData.activeCarrier} (Direct SIP)</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: C.slate, textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.05em" }}>Voice AI Engine</div>
            <div style={{ fontFamily: FONT_BODY, fontSize: 14, fontWeight: 600, color: hubData?.status === "connected" ? C.textInk : C.slate, marginTop: 4 }}>{hubData.activeEngine} ({hubData.voiceLabel || "no voice picked"})</div>
          </div>
          {engineChoice !== "livekit" && (
            <div>
              <div style={{ fontSize: 11, color: C.slate, textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.05em" }}>SIP Inbound FQDN</div>
              <div style={{ fontFamily: FONT_MONO, fontSize: 12.5, color: C.slate, marginTop: 4 }}>{hubData.xaiFqdn}:5060</div>
            </div>
          )}
          {engineChoice === "livekit" && (
            <div>
              <div style={{ fontSize: 11, color: C.slate, textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.05em" }}>WebRTC Connection</div>
              <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: hubData?.status === "connected" ? C.teal : C.slate, marginTop: 4, fontWeight: 600 }}>Browser-based (no SIP)</div>
            </div>
          )}
        </div>

        {(() => {
          const labels = liveStackLabels(hubData);
          return (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, paddingTop: 4 }}>
              <div>
                <div style={{ fontSize: 11, color: C.slate, textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.05em" }}>Live engine</div>
                <div style={{ fontFamily: FONT_BODY, fontSize: 13.5, fontWeight: 600, color: C.textInk, marginTop: 4 }}>{labels.engine}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: C.slate, textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.05em" }}>LLM</div>
                <div style={{ fontFamily: FONT_BODY, fontSize: 13.5, fontWeight: 600, color: C.textInk, marginTop: 4 }}>{labels.llm}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: C.slate, textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.05em" }}>STT</div>
                <div style={{ fontFamily: FONT_BODY, fontSize: 13.5, fontWeight: 600, color: C.textInk, marginTop: 4 }}>{labels.stt}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: C.slate, textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.05em" }}>TTS</div>
                <div style={{ fontFamily: FONT_BODY, fontSize: 13.5, fontWeight: 600, color: C.textInk, marginTop: 4 }}>{labels.tts}</div>
              </div>
            </div>
          );
        })()}

        {/* 5-Point Diagnostic Scorecard Banner */}
        {diagScore && (
          <div style={{ padding: "14px 16px", borderRadius: 10, background: diagScore.all_passed ? "#F0FDF4" : "#FFFBEB", border: `1px solid ${diagScore.all_passed ? "#BBF7D0" : "#FDE68A"}`, marginTop: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Activity size={16} color={diagScore.all_passed ? "#16A34A" : "#D97706"} />
                <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 14, color: C.ink }}>5-Point Universal Diagnostics</span>
                <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 7px", borderRadius: 5, background: diagScore.all_passed ? "#DCFCE7" : "#FEF3C7", color: diagScore.all_passed ? "#15803D" : "#B45309" }}>
                  SCORE: {diagScore.overall_score || (diagScore.all_passed ? "5/5 PASS" : "ATTENTION")}
                </span>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 8, marginTop: 6 }}>
              {[
                { label: "1. Telephony", data: diagScore.checks?.telephony || diagScore.telephony },
                { label: "2. Voice Stack", data: diagScore.checks?.voice_stack || diagScore.voice_stack || diagScore.stt },
                { label: "3. Calendar Mode", data: diagScore.checks?.calendar_config || diagScore.calendar_config },
                { label: "4. Slot Engine", data: diagScore.checks?.slot_availability || diagScore.slot_availability },
                { label: "5. Test Booking", data: diagScore.checks?.test_booking_roundtrip || diagScore.test_booking_roundtrip },
              ].map((item, idx) => {
                const passed = item.data?.status === "pass";
                const isWarn = item.data?.status === "warn";
                const summary = item.data?.summary || (Array.isArray(item.data?.details) ? item.data.details[0] : item.data?.details) || (passed ? "Ready" : "Not configured");
                return (
                  <div key={idx} style={{ padding: "8px 10px", borderRadius: 7, background: "#fff", border: `1px solid ${passed ? "#BBF7D0" : isWarn ? "#FDE68A" : "#FCA5A5"}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 11.5, fontWeight: 700, color: C.ink }}>{item.label}</span>
                      {passed ? <CheckCircle2 size={13} color="#16A34A" /> : isWarn ? <AlertTriangle size={13} color="#D97706" /> : <AlertTriangle size={13} color="#DC2626" />}
                    </div>
                    <div style={{ fontSize: 10.5, color: C.slate, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={summary}>{summary}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Live Ping Result Banner */}
        {pingResult && (
          <div style={{ padding: "10px 14px", borderRadius: 8, background: pingResult.success ? C.greenSoft : C.redSoft, border: `1px solid ${pingResult.success ? "#A7F3D0" : "#FCA5A5"}`, display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12.5, flexWrap: "wrap", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: pingResult.success ? "#065F46" : C.red }}>
              {pingResult.success ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
              <span>{pingResult.success ? `Webhook healthy · ${pingResult.latencyMs}ms` : `Ping failed: ${pingResult.details?.error || "Check server"}`}</span>
            </div>
            <span style={{ fontFamily: FONT_MONO, color: C.slate, fontSize: 11 }}>HTTP {pingResult.statusCode}</span>
          </div>
        )}
      </div>

      <CallPluginStackBoard
        hubData={hubData}
        connections={connsState}
        onChangeModel={(layerKey, layerTitle, layerName) => {
          setQuickSwitchState({ open: true, layerKey, layerTitle, layerName });
        }}
        onAddLayer={(layer) => {
          setStackAddLayer(layer || "Text-to-Speech");
          setShowStackAdd(true);
        }}
        onOpenCredentials={() => {
          if (typeof onOpenCredentials === "function") onOpenCredentials();
        }}
      />

      {quickSwitchState.open && (
        <QuickSwitchModelModal
          layerKey={quickSwitchState.layerKey}
          layerTitle={quickSwitchState.layerTitle}
          layerName={quickSwitchState.layerName}
          hubData={hubData}
          connections={connsState}
          onClose={() => setQuickSwitchState({ open: false, layerKey: "", layerTitle: "", layerName: "" })}
          onSelectSuccess={(opt) => {
            fetchStatus();
            if (typeof setNotifications === "function") {
              setNotifications((ns) => [
                {
                  id: "n_" + Date.now(),
                  text: `✓ Live call stack switched to ${opt.label || opt.name || opt.value}.`,
                  time: "just now",
                  unread: true,
                  type: "success",
                },
                ...(ns || []),
              ]);
            }
          }}
          onOpenCredentials={() => {
            setQuickSwitchState({ open: false, layerKey: "", layerTitle: "", layerName: "" });
            if (typeof onOpenCredentials === "function") onOpenCredentials();
          }}
        />
      )}

      {showStackAdd && (
        <AddIntegrationModal
          initialCategory={stackAddLayer}
          onClose={() => setShowStackAdd(false)}
          onAddSuccess={() => {
            setShowStackAdd(false);
            fetchStatus();
            if (typeof setNotifications === "function") {
              setNotifications((ns) => [
                { id: "n_" + Date.now(), text: "Plugin connected — live call stack updated.", time: "just now", unread: true, type: "success" },
                ...(ns || []),
              ]);
            }
          }}
        />
      )}

      {/* Direct Outbound Dialing Card */}
      <DirectOutboundCallCard notifications={notifications} setNotifications={setNotifications} defaultFromNumber={phoneNumber || hubData.phoneNumber} />

      {/* 2. PLUGGABLE STACK SELECTOR FORM */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!provisioning) setProvisionConfirmOpen(true);
        }}
        style={{ display: "flex", flexDirection: "column", gap: 20, margin: 0 }}
      >
        
        {/* Line Credentials & Activation Form */}
        <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 14, padding: 24, margin: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
            <h3 style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, color: C.textInk, margin: 0 }}>Configure Line Credentials & Activation</h3>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
            <div>
              <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 700, color: C.slate, marginBottom: 6 }}>
                Phone Number (E.164 format)
              </label>
              <input
                type="text"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="+1 (202) 555-0199 or +44..."
                style={{ width: "100%", boxSizing: "border-box", padding: "10px 14px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_MONO, fontSize: 13, outline: "none" }}
              />
              <div style={{ fontSize: 11, color: C.slateLight, marginTop: 4 }}>The active caller ID that triggers this voice trunk.</div>
            </div>

            <div>
              <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 700, color: C.slate, marginBottom: 6 }}>
                  {engineChoice === "xai" ? "xAI API Key" : engineChoice === "openai" ? "OpenAI API Key" : engineChoice === "livekit" ? "LiveKit API Key (optional — uses Connections plugins)" : engineChoice === "modular" ? "Optional engine key (modular uses Connections STT/TTS/LLM)" : "Engine Primary API Key"}
                </label>
                <div style={{ position: "relative" }}>
                  <input
                    type={showKey ? "text" : "password"}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={engineChoice === "xai" ? "xai-••••••••••••••••" : engineChoice === "livekit" ? "devkey (or leave blank if using .env LIVEKIT_API_KEY)" : "sk-••••••••••••••••"}
                    style={{ width: "100%", boxSizing: "border-box", padding: "10px 38px 10px 14px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_MONO, fontSize: 13, outline: "none" }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: C.slateLight }}
                  >
                    {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                <div style={{ fontSize: 11, color: hubData.hasApiKey ? "#059669" : C.slateLight, marginTop: 4 }}>
                  {hubData.hasApiKey ? `✓ Active Key Saved in Database: ${hubData.apiKeyMasked} (Leave blank to keep active key, or enter new key to replace)` : "Stored securely in database. Never exposed to callers."}
                </div>
              </div>

            {engineChoice === "xai" && (
              <div>
                <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 700, color: C.slate, marginBottom: 6 }}>
                  Webhook Signing Secret (Svix HMAC Secret)
                </label>
                <input
                  type="password"
                  autoComplete="off"
                  value={signingSecret}
                  onChange={(e) => setSigningSecret(e.target.value)}
                  placeholder={hubData.hasSigningSecret ? hubData.signingSecretMasked : "Auto-generated upon registration (whsec_...)"}
                  style={{ width: "100%", boxSizing: "border-box", padding: "10px 14px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_MONO, fontSize: 13, outline: "none" }}
                />
                <div style={{ fontSize: 11, color: hubData.hasSigningSecret ? "#059669" : C.slateLight, marginTop: 4 }}>
                  {hubData.hasSigningSecret ? `✓ Linked to Svix Secret: ${hubData.signingSecretMasked}` : "Auto-populated by xAI BYO trunk registration, or paste manually from console.x.ai."}
                </div>
              </div>
            )}


            {carrierChoice === "twilio" && (
              <div>
                <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 700, color: C.slate, marginBottom: 6 }}>
                  Twilio Account SID
                </label>
                <input
                  type="text"
                  value={accountSid}
                  onChange={(e) => setAccountSid(e.target.value)}
                  placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  style={{ width: "100%", boxSizing: "border-box", padding: "10px 14px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_MONO, fontSize: 13, outline: "none" }}
                />
              </div>
            )}

            <div style={{ gridColumn: "1 / -1" }}>
              <div style={{ fontFamily: FONT_BODY, fontSize: 12, fontWeight: 700, color: C.slate, marginBottom: 8 }}>
                Who speaks on the call?
              </div>
              <VoicePicker variant="full" />
            </div>

            <div>
              <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 700, color: C.slate, marginBottom: 6 }}>
                Response speed
              </label>
              <select
                value={silenceDurationMs}
                onChange={(e) => setSilenceDurationMs(Number(e.target.value))}
                style={{ width: "100%", boxSizing: "border-box", padding: "10px 14px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13, outline: "none", background: "#fff" }}
              >
                <option value={320}>Fast (320ms)</option>
                <option value={380}>Balanced (380ms)</option>
                <option value={500}>Relaxed (500ms)</option>
              </select>
            </div>

            <div>
              <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 700, color: C.slate, marginBottom: 6 }}>
                Voice style
              </label>
              <select
                value={temperature}
                onChange={(e) => setTemperature(Number(e.target.value))}
                style={{ width: "100%", boxSizing: "border-box", padding: "10px 14px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13, outline: "none", background: "#fff" }}
              >
                <option value={0.85}>Warm</option>
                <option value={0.80}>Balanced</option>
                <option value={0.70}>Neutral</option>
              </select>
            </div>
          </div>

          {/* Dynamic SIP & Webhook Routing Info — collapsed by default */}
          <div style={{ marginTop: 20, paddingTop: 18, borderTop: `1px solid ${C.border}` }}>
            <button
              type="button"
              onClick={() => setInboundRoutingOpen((o) => !o)}
              aria-expanded={inboundRoutingOpen}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                background: inboundRoutingOpen ? "#F8FAFC" : "#fff",
                border: `1px solid ${C.border}`,
                borderRadius: 10,
                padding: "12px 14px",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.textInk }}>
                  📡 Inbound Routing Configuration for {carrierChoice === "telnyx" ? "Telnyx Portal" : carrierChoice === "twilio" ? "Twilio Console" : "Carrier / PBX"}
                </div>
                {!inboundRoutingOpen && (
                  <div style={{ fontSize: 12, color: C.slate, marginTop: 3 }}>
                    Collapsed. Expand for webhook URL, SIP FQDN, and signing secret.
                  </div>
                )}
              </div>
              <span style={{
                flexShrink: 0,
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontSize: 12,
                fontWeight: 700,
                color: C.cobaltDeep,
                background: C.cobaltSoft,
                border: "1px solid #C7D7FA",
                borderRadius: 8,
                padding: "6px 10px",
              }}>
                {inboundRoutingOpen ? "Collapse" : "Expand"}
                <ChevronDown size={14} style={{ transform: inboundRoutingOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
              </span>
            </button>

            {inboundRoutingOpen && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14, marginTop: 12 }}>
              {/* Webhook Box */}
              <div style={{ background: "#F8FAFC", border: `1px solid ${C.border}`, borderRadius: 8, padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase" }}>Public Inbound Webhook URL</span>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(webhookUrl, "webhook")}
                    style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 5, padding: "3px 8px", fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", gap: 4, color: C.slate }}
                  >
                    {copiedWebhook ? <Check size={11} color={C.green} /> : <Copy size={11} />}
                    {copiedWebhook ? "Copied" : "Copy"}
                  </button>
                </div>
                <div style={{ fontFamily: FONT_MONO, fontSize: 11.5, color: C.ink, wordBreak: "break-all" }}>{webhookUrl}</div>
                <div style={{ fontSize: 11, color: C.slate, marginTop: 4 }}>Destination for xAI live call handoff.</div>
              </div>

              {/* Carrier SIP Box */}
              <div style={{ background: "#F8FAFC", border: `1px solid ${C.border}`, borderRadius: 8, padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase" }}>Inbound FQDN Target</span>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(`${hubData?.xaiFqdn || "sip.voice.x.ai"}:5060`, "fqdn")}
                    style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 5, padding: "3px 8px", fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", gap: 4, color: C.slate }}
                  >
                    {copiedFqdn ? <Check size={11} color={C.green} /> : <Copy size={11} />}
                    {copiedFqdn ? "Copied" : "Copy"}
                  </button>
                </div>
                <div style={{ fontFamily: FONT_MONO, fontSize: 12, color: C.ink }}>{hubData?.xaiFqdn || "sip.voice.x.ai"}:5060</div>
                <div style={{ fontSize: 11, color: C.slate, marginTop: 4 }}>
                  Destination: <b>+E.164</b> • Codecs: <b>G.711 μ-law, G.722</b>
                </div>
              </div>

              {/* Webhook Signing Secret Box */}
              <div style={{ background: "#F8FAFC", border: `1px solid ${C.border}`, borderRadius: 8, padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase" }}>Webhook Signing Secret (Svix)</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <button
                      type="button"
                      onClick={() => setShowSecret(!showSecret)}
                      style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 5, padding: "3px 8px", fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", gap: 4, color: C.slate }}
                      title={signingSecret ? (showSecret ? "Hide" : "Show one-time secret") : "Full secret stays encrypted — only mask is available"}
                    >
                      {showSecret ? <EyeOff size={11} /> : <Eye size={11} />}
                      {showSecret ? "Hide" : "Reveal"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const copyVal = signingSecret || "";
                        if (!copyVal) {
                          setNotifications?.((ns) => [
                            { id: "n_" + Date.now(), text: "Full signing secret is encrypted — copy only available right after provision.", time: "just now", unread: true, type: "info" },
                            ...(ns || []),
                          ]);
                          return;
                        }
                        copyToClipboard(copyVal, "secret");
                      }}
                      style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 5, padding: "3px 8px", fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", gap: 4, color: C.slate }}
                    >
                      {copiedSecret ? <Check size={11} color={C.green} /> : <Copy size={11} />}
                      {copiedSecret ? "Copied" : "Copy"}
                    </button>                  </div>
                </div>
                <div style={{ fontFamily: FONT_MONO, fontSize: 11.5, color: C.ink, wordBreak: "break-all" }}>
                  {showSecret
                    ? (signingSecret || hubData.signingSecretMasked || "whsec_••••••••")
                    : (hubData.signingSecretMasked || (signingSecret ? (signingSecret.slice(0, 8) + "••••••••") : "whsec_••••••••"))}
                </div>
                <div style={{ fontSize: 11, color: hubData.hasSigningSecret ? "#059669" : C.slate, marginTop: 4 }}>
                  {hubData.hasSigningSecret
                    ? "✓ Encrypted in database — full secret cannot be revealed again (shown once at provision)"
                    : "Auto-generated by xAI upon registration"}
                </div>              </div>
            </div>
            )}
          </div>
        </div>

        {/* Feedback Alerts */}
        {provisionErr && (
          <div style={{ padding: "12px 16px", borderRadius: 8, background: C.redSoft, border: `1px solid #FCA5A5`, color: C.red, display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <AlertTriangle size={16} /> {provisionErr}
          </div>
        )}

        {provisionMsg && (
          <div style={{
            padding: "14px 18px",
            borderRadius: 8,
            background: (provisionMsg.success && !provisionMsg.registrationError) ? C.greenSoft : C.redSoft,
            border: `1px solid ${(provisionMsg.success && !provisionMsg.registrationError) ? "#A7F3D0" : "#FCA5A5"}`,
            color: (provisionMsg.success && !provisionMsg.registrationError) ? C.green : C.red,
            display: "flex",
            flexDirection: "column",
            gap: 10,
            fontSize: 13
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700 }}>
              {(provisionMsg.success && !provisionMsg.registrationError) ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
              {provisionMsg.message}
            </div>
            {provisionMsg.signingSecret && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#fff", padding: "10px 14px", borderRadius: 8, border: "1px solid #A7F3D0", flexWrap: "wrap", gap: 10 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ fontSize: 11, color: C.slate, fontWeight: 700, textTransform: "uppercase" }}>🔑 Your Webhook Signing Secret (Copy & Save)</span>
                  <span style={{ fontFamily: FONT_MONO, fontSize: 12.5, color: C.ink, wordBreak: "break-all" }}>{provisionMsg.signingSecret}</span>
                </div>
                <button
                  type="button"
                  onClick={() => copyToClipboard(provisionMsg.signingSecret, "secret")}
                  style={{ background: "#ECFDF5", border: "1px solid #059669", borderRadius: 6, padding: "6px 14px", fontSize: 12, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, color: "#065F46", fontWeight: 700 }}
                >
                  {copiedSecret ? <Check size={13} color="#059669" /> : <Copy size={13} />}
                  {copiedSecret ? "Copied to Clipboard!" : "Copy Signing Secret"}
                </button>
              </div>
            )}
          </div>
        )}


        {/* Submit Button + confirm popup */}
        <div style={{ position: "relative", display: "inline-flex", flexDirection: "column", alignItems: "flex-start", gap: 8 }}>
          {showProvisionTip && !provisioning && (
            <div
              role="tooltip"
              style={{
                position: "absolute",
                bottom: "calc(100% + 10px)",
                left: 0,
                zIndex: 30,
                maxWidth: 340,
                padding: "10px 12px",
                borderRadius: 10,
                background: "#0F172A",
                color: "#F8FAFC",
                fontSize: 12.5,
                lineHeight: 1.45,
                boxShadow: "0 10px 28px rgba(15,23,42,0.28)",
                pointerEvents: "none",
              }}
            >
              Saves phone, carrier, voice engine, and voice settings. Registers the number on xAI (BYO trunk) and refreshes Telephony + Voice connections. Does not place a call.
              <span style={{
                position: "absolute",
                bottom: -6,
                left: 28,
                width: 12,
                height: 12,
                background: "#0F172A",
                transform: "rotate(45deg)",
              }} />
            </div>
          )}
          <button
            type="submit"
            disabled={provisioning}
            onMouseEnter={() => setShowProvisionTip(true)}
            onMouseLeave={() => setShowProvisionTip(false)}
            onFocus={() => setShowProvisionTip(true)}
            onBlur={() => setShowProvisionTip(false)}
            aria-describedby="provision-stack-tip"
            style={{
              background: "linear-gradient(135deg, #0EA5E9 0%, #0284C7 100%)",
              color: "#fff",
              border: "none",
              borderRadius: 10,
              padding: "14px 32px",
              fontFamily: FONT_DISPLAY,
              fontSize: 15,
              fontWeight: 800,
              cursor: provisioning ? "wait" : "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 10,
              boxShadow: "0 6px 20px rgba(6, 182, 212, 0.35)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              transition: "all 0.2s ease",
              transform: provisioning ? "scale(0.98)" : "scale(1)",
              opacity: provisioning ? 0.7 : 1,
            }}
          >
            {provisioning ? (
              <>
                <RefreshCw size={16} className="animate-spin" style={{ animation: "spin 1s linear infinite" }} /> 
                <span>Provisioning...</span>
              </>
            ) : (
              <>
                <ShieldCheck size={18} /> 
                <span>💾 Save & Activate Stack</span>
              </>
            )}
          </button>
          <span id="provision-stack-tip" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
            Saves phone, carrier, voice engine, and voice settings. Registers the number on xAI and refreshes connections. Does not place a call.
          </span>
        </div>
      </form>

      {provisionConfirmOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="provision-confirm-title"
          onClick={() => !provisioning && setProvisionConfirmOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            background: "rgba(15, 23, 42, 0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: 420,
              background: "#fff",
              borderRadius: 14,
              border: `1px solid ${C.border}`,
              boxShadow: "0 24px 60px rgba(15,23,42,0.28)",
              padding: "22px 24px",
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  background: C.cobaltSoft,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}>
                  <ShieldCheck size={18} color={C.cobaltDeep} />
                </div>
                <h3 id="provision-confirm-title" style={{ margin: 0, fontFamily: FONT_DISPLAY, fontSize: 17, fontWeight: 800, color: C.textInk }}>
                  Save updated stack?
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setProvisionConfirmOpen(false)}
                style={{ background: "none", border: "none", cursor: "pointer", color: C.slate, padding: 4 }}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            <p style={{ margin: "0 0 18px", fontSize: 13.5, lineHeight: 1.5, color: C.slate }}>
              New updates will get saved — phone number, carrier, voice engine, active voice, and pacing. The line will also register with xAI if needed. This does not start a call.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => setProvisionConfirmOpen(false)}
                style={{
                  background: "#fff",
                  border: `1px solid ${C.border}`,
                  borderRadius: 8,
                  padding: "9px 16px",
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: "pointer",
                  color: C.textInk,
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleProvision()}
                style={{
                  background: `linear-gradient(135deg, #2a47ae 0%, #1a2d7a 100%)`,
                  border: "none",
                  borderRadius: 10,
                  padding: "11px 22px",
                  fontSize: 14,
                  fontWeight: 800,
                  cursor: "pointer",
                  color: "#fff",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  boxShadow: `0 4px 12px rgba(42, 71, 174, 0.3)`,
                  transition: "all 0.2s ease",
                }}
              >
                <Check size={16} style={{ fontWeight: "bold" }} /> 💾 Save & Activate
              </button>
            </div>
          </div>
        </div>
      )}

      {/* LiveKit WebRTC In-Browser Voice Call Modal */}
      <LiveKitBrowserCallModal
        isOpen={liveKitModalOpen}
        onClose={() => setLiveKitModalOpen(false)}
        prospectName="Line Setup Test User"
        prospectPhone={phoneNumber || hubData?.phoneNumber || "Browser WebRTC"}
        companyName={profile?.name || "Your company"}
      />
    </div>
  );
}

/* ---------------------------------- AI Lead Radar & Autonomous Discovery View ---------------------------------- */
