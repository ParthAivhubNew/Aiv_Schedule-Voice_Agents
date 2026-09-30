import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Line } from "recharts";
import { api } from "../api/apiClient";
import { C, CONNECTIONS, FONT_BODY, FONT_DISPLAY, FONT_MONO, liveStackLabels, voiceLayersFromHub } from "../app/constants";
import { Badge, SelfHostedHint, TopBar } from "../app/ui";
import { TelephonyDocsView } from "../plugins/voice/TelephonyDocsView";
import { announceVoiceChanged } from "../plugins/voice/VoicePicker";
import { TelnyxAssistantSettingsCard, VoiceTrunkingHubTab } from "../plugins/voice/VoiceTrunkingHubTab";
import { AddIntegrationModal } from "./AddIntegrationModal";

export function ProviderConfigView({ notifications, setNotifications, commonAi, setCommonAi, profile, setProfile, onNavigateView, embedded = false }) {
  const [activeTab, setActiveTab] = useState("telephony-hub");
  const [showAdd, setShowAdd] = useState(false);
  const [addModalCategory, setAddModalCategory] = useState("LLM");
  const [dirty, setDirty] = useState(false);

  // ── Credentials: loaded live from backend with template fallback ──
  const [credsState, setCredsState] = useState(CONNECTIONS);
  const [rowState, setRowState] = useState({});
  const [liveHub, setLiveHub] = useState(null);
  const [deleteKeyConfirm, setDeleteKeyConfirm] = useState(null); // { groupName, item, rowKey, deleting }
  const liveLabels = liveHub ? liveStackLabels(liveHub) : null;

  useEffect(() => {
    async function loadConns() {
      try {
        const conns = await api.getConnections();
        if (conns && Array.isArray(conns) && conns.length) {
          setCredsState((prev) => {
            const groupBackendItems = {};
            conns.forEach((g) => {
              groupBackendItems[g.group] = g.items || [];
            });

            return prev.map((group) => {
              const bItems = groupBackendItems[group.group] || [];
              const matchedIds = new Set();

              const updatedItems = (group.items || []).map((it) => {
                // 1. Exact name match (excluding already matched items)
                let live = bItems.find((b) => !matchedIds.has(b.id) && b.name.toLowerCase() === it.name.toLowerCase());

                // 2. Normalized alias match if not exact
                if (!live) {
                  const itNorm = it.name.toLowerCase().replace(/[^a-z0-9]/g, "");
                  live = bItems.find((b) => {
                    if (matchedIds.has(b.id)) return false;
                    const bNorm = b.name.toLowerCase().replace(/[^a-z0-9]/g, "");
                    if (itNorm === bNorm) return true;
                    // xAI voice orchestrator aliases
                    if (group.group === "Voice Orchestration" && !itNorm.includes("telnyx") && (itNorm.startsWith("xai") || itNorm.includes("grok")) && (bNorm.startsWith("xai") || bNorm.includes("grok"))) return true;
                    // xAI LLM aliases (strict: do NOT match if it is telnyx)
                    if (group.group === "LLM" && !itNorm.includes("telnyx") && (itNorm.startsWith("xai") || itNorm.includes("grok")) && (bNorm.startsWith("xai") || bNorm.includes("grok"))) return true;
                    // LiveKit aliases
                    if (itNorm.includes("livekit") && bNorm.includes("livekit")) return true;
                    // Cartesia aliases
                    if (itNorm.includes("cartesia") && bNorm.includes("cartesia")) return true;
                    // ElevenLabs aliases
                    if (itNorm.includes("eleven") && bNorm.includes("eleven")) return true;
                    // Deepgram aliases
                    if (itNorm.includes("deepgram") && bNorm.includes("deepgram")) return true;
                    // Twilio aliases
                    if (itNorm.includes("twilio") && bNorm.includes("twilio")) return true;
                    // Cal.com aliases (not any name containing "cal", e.g. "Local LLM")
                    if (itNorm.includes("calcom") && bNorm.includes("calcom")) return true;
                    return false;
                  });
                }

                if (live) {
                  if (live.id) matchedIds.add(live.id);
                  return {
                    ...it,
                    id: live.id,
                    status: live.status,
                    apiKeyMasked: live.apiKeyMasked,
                    model: live.model || it.model,
                    baseUrl: live.baseUrl || it.baseUrl,
                    voiceId: live.voiceId || it.voiceId,
                    phone: live.phone || it.phone,
                    accountSid: live.accountSid || it.accountSid,
                    agentId: live.agentId || it.agentId,
                    connectionId: live.connectionId || it.connectionId,
                  };
                }
                return it;
              });

              // Only preserve custom or additional providers from backend that are actually connected with saved keys
              const extraItems = bItems.filter((b) => b.id && !matchedIds.has(b.id) && b.status === "connected" && b.apiKeyMasked).map((b) => ({
                name: b.name,
                id: b.id,
                status: b.status,
                apiKeyMasked: b.apiKeyMasked,
                model: b.model,
                baseUrl: b.baseUrl,
                voiceId: b.voiceId,
                phone: b.phone,
                accountSid: b.accountSid,
                agentId: b.agentId,
                connectionId: b.connectionId,
              }));

              return {
                ...group,
                items: [...updatedItems, ...extraItems],
              };
            });
          });
        }
      } catch (_) {}
      try {
        const hub = await api.getTelephonyHub();
        if (hub) {
          setLiveHub(hub);
          if (setCommonAi) {
            setCommonAi((prev) => ({
              ...prev,
              voiceLayers: voiceLayersFromHub(hub, prev.voiceLayers),
            }));
          }
        }
      } catch (_) {}
    }
    loadConns();
  }, []);

  const flash = () => {
    setDirty(true);
    setTimeout(() => setDirty(false), 1400);
  };

  // ── Credentials inline test→save helpers ──
  const setRow = (rowKey, patch) =>
    setRowState((s) => ({ ...s, [rowKey]: { ...(s[rowKey] || {}), ...patch } }));

  const isTelnyxCarrierRow = (rowKey) => /^Telephony\|/.test(rowKey || "") && /telnyx/i.test(rowKey || "");

  // Non-secret fields sent with every save so "Save" never blanks what the form showed.
  const extraFields = (rowKey, row) => {
    const second = (row.agentIdValue || "").trim();
    if (isTelnyxCarrierRow(rowKey)) return { connection_id: second };
    if (/twilio|whatsapp/i.test(rowKey || "")) return {};
    return { agent_id: second };
  };

  const refreshLiveHub = async () => {
    try {
      const hub = await api.getTelephonyHub();
      if (hub) setLiveHub(hub);
    } catch (_) {}
  };

  const handleConnect = (rowKey, it = {}) =>
    setRow(rowKey, {
      phase: "editing",
      keyValue: "",
      phoneValue: it?.phone || "",
      agentIdValue: isTelnyxCarrierRow(rowKey) ? (it?.connectionId || "") : (it?.agentId || ""),
      accountSidValue: it?.accountSid || "",
      modelValue: it?.model || "",
      baseUrlValue: it?.baseUrl || "",
      voiceIdValue: it?.voiceId || it?.config?.voice_id || "",
      errorMsg: "",
      testResult: null
    });

  const handleCancel = (rowKey) =>
    setRowState((s) => { const n = { ...s }; delete n[rowKey]; return n; });

  const handleTest = async (groupName, itemName, rowKey) => {
    const row = rowState[rowKey] || {};
    const key = (row.keyValue || "").trim();
    if (!key && !(row.baseUrlValue || "").trim()) { setRow(rowKey, { errorMsg: "Paste the API key, or enter a Base URL for a self-hosted model (key optional)." }); return; }
    const isTwilio = String(itemName || "").toLowerCase().includes("twilio");
    const isWhatsApp = String(itemName || "").toLowerCase().includes("whatsapp");
    const sidCandidate = (row.accountSidValue || row.agentIdValue || "").trim();
    const accountSid = isTwilio
      ? (sidCandidate.startsWith("AC") ? sidCandidate : (row.accountSidValue || "").trim())
      : isWhatsApp
      ? (row.accountSidValue || "").trim()
      : undefined;
    if (isTwilio && (!accountSid || !accountSid.startsWith("AC") || accountSid.length !== 34)) {
      setRow(rowKey, { errorMsg: "Twilio needs Account SID (AC…, 34 chars) in the Account SID field — not Voice Agent ID." });
      return;
    }
    if (isTwilio && (key.startsWith("xai-") || key.length !== 32)) {
      setRow(rowKey, { errorMsg: "Paste the Twilio Auth Token (32 characters from console.twilio.com) — not an xAI key." });
      return;
    }
    setRow(rowKey, { phase: "testing", errorMsg: "", testResult: null });
    try {
      const res = await api.testConnection({
        layer: groupName,
        provider: itemName,
        api_key: key,
        account_sid: accountSid || undefined,
        base_url: (row.baseUrlValue || "").trim() || undefined,
        model: (row.modelValue || "").trim() || undefined,
        voice_id: (row.voiceIdValue || "").trim() || undefined,
        use_for_calls: !!row.useForCallsValue,
      });
      setRow(rowKey, { phase: "tested_ok", testResult: res.details || "Authentication verified! Ready to save." });
    } catch (err) {
      const msg = err?.name === "AbortError"
        ? "Test cancelled."
        : (err?.message || "Authentication rejected by provider.");
      setRow(rowKey, { phase: "tested_fail", errorMsg: msg });
    }
  };

  const handleSave = async (groupName, itemName, rowKey) => {
    const row = rowState[rowKey] || {};
    const key = (row.keyValue || "").trim();
    const item = (credsState.find((g) => g.group === groupName)?.items || []).find((x) => x.name === itemName);
    const isAlreadyConnected = item?.status === "connected";

    // If key is not entered and connection is already connected, perform lightweight config update
    if (!key && isAlreadyConnected) {
      setRow(rowKey, { phase: "saving" });
      try {
        const savedVoiceId = (row.voiceIdValue || "").trim();
        const savedModel = (row.modelValue || "").trim();
        const savedBaseUrl = (row.baseUrlValue || "").trim();
        const savedPhone = (row.phoneValue || "").trim();
        await api.updateConnectionConfig({
          id: item.id || undefined,
          layer: groupName,
          provider: itemName,
          model: savedModel,
          base_url: savedBaseUrl,
          voice_id: savedVoiceId,
          use_for_calls: !!row.useForCallsValue,
          phone: savedPhone,
          ...extraFields(rowKey, row),
        });
        setCredsState((s) =>
          s.map((g) =>
            g.group === groupName
              ? {
                  ...g,
                  items: (g.items || []).map((x) =>
                    x.name === itemName
                      ? {
                          ...x,
                          model: savedModel,
                          baseUrl: savedBaseUrl,
                          voiceId: savedVoiceId,
                          phone: savedPhone,
                          ...(isTelnyxCarrierRow(rowKey) ? { connectionId: (row.agentIdValue || "").trim() } : { agentId: (row.agentIdValue || "").trim() }),
                          config: { ...(x.config || {}), voice_id: savedVoiceId, model: savedModel },
                        }
                      : x
                  ),
                }
              : g
          )
        );
        if (savedVoiceId) announceVoiceChanged();
        handleCancel(rowKey);
        setNotifications((ns) => [
          { id: "n_" + Date.now(), text: `✓ Updated configuration for ${itemName}`, time: "just now", unread: true, type: "success" },
          ...ns,
        ]);
        flash();
        refreshLiveHub();
        return;
      } catch (err) {
        setRow(rowKey, { phase: "tested_fail", errorMsg: err.message || "Failed to update configuration." });
        return;
      }
    }

    const isTwilio = String(itemName || "").toLowerCase().includes("twilio");
    const isWhatsApp = String(itemName || "").toLowerCase().includes("whatsapp");
    const sidCandidate = (row.accountSidValue || row.agentIdValue || "").trim();
    const accountSid = isTwilio
      ? (sidCandidate.startsWith("AC") ? sidCandidate : (row.accountSidValue || "").trim())
      : isWhatsApp
      ? (row.accountSidValue || "").trim()
      : undefined;
    setRow(rowKey, { phase: "saving" });
    try {
      const res = await api.testAndSaveConnection({
        layer: groupName,
        provider: itemName,
        api_key: key,
        account_sid: accountSid || undefined,
        base_url: (row.baseUrlValue || "").trim() || undefined,
        model: (row.modelValue || "").trim() || undefined,
        voice_id: (row.voiceIdValue || "").trim() || undefined,
        use_for_calls: !!row.useForCallsValue,
        phone: (row.phoneValue || "").trim() || undefined,
        ...extraFields(rowKey, row),
      });
      const savedVoiceId = (row.voiceIdValue || "").trim();
      setCredsState((s) =>
        s.map((g) =>
          g.group === groupName
            ? {
                ...g,
                items: (g.items || []).map((x) =>
                  x.name === itemName
                    ? {
                        ...x,
                        id: res.id || x.id,
                        status: "connected",
                        apiKeyMasked: res.maskedKey,
                        model: (row.modelValue || "").trim() || x.model,
                        baseUrl: (row.baseUrlValue || "").trim() || x.baseUrl,
                        voiceId: savedVoiceId || x.voiceId,
                        phone: (row.phoneValue || "").trim() || x.phone,
                        ...(isTelnyxCarrierRow(rowKey)
                          ? { connectionId: (row.agentIdValue || "").trim() || x.connectionId }
                          : { agentId: (row.agentIdValue || "").trim() || x.agentId }),
                        config: { ...(x.config || {}), voice_id: savedVoiceId || x.voiceId },
                      }
                    : x
                ),
              }
            : g
        )
      );
      if (savedVoiceId) announceVoiceChanged();
      if (row.phoneValue && setProfile) {
        setProfile((prev) => ({ ...prev, callerId: row.phoneValue }));
      }
      try {
        if (isTwilio && accountSid) localStorage.setItem("aivhub_twilio_sid", accountSid);
      } catch (_) {}
      handleCancel(rowKey);
      setNotifications((ns) => [
        { id: "n_" + Date.now(), text: `✓ ${itemName} key verified and saved!${row.phoneValue ? ` (Caller ID: ${row.phoneValue})` : ""}`, time: "just now", unread: true, type: "success" },
        ...ns,
      ]);
      flash();
      refreshLiveHub();
    } catch (err) {
      setRow(rowKey, { phase: "tested_fail", errorMsg: err.message || "Save failed." });
    }
  };

  const requestDeleteKey = (groupName, item, rowKey) => {
    if (!item || item.status !== "connected") return;
    setDeleteKeyConfirm({ groupName, item, rowKey, deleting: false, usedBy: null });
    api.connectionUsage({ id: item.id || undefined, layer: groupName, provider: item.name })
      .then((res) => setDeleteKeyConfirm((s) => (s && s.item === item ? { ...s, usedBy: (res && res.usedBy) || [] } : s)))
      .catch(() => setDeleteKeyConfirm((s) => (s && s.item === item ? { ...s, usedBy: [] } : s)));
  };

  const confirmDeleteKey = async () => {
    if (!deleteKeyConfirm) return;
    const { groupName, item, rowKey } = deleteKeyConfirm;
    setDeleteKeyConfirm((s) => (s ? { ...s, deleting: true } : s));
    setRow(rowKey, { phase: "saving", errorMsg: "" });
    try {
      await api.clearConnectionKey({
        id: item.id || undefined,
        layer: groupName,
        provider: item.name,
      });
      setCredsState((s) =>
        s.map((g) =>
          g.group === groupName
            ? {
                ...g,
                items: (g.items || []).map((x) =>
                  x.name === item.name
                    ? { ...x, status: "not_configured", apiKeyMasked: undefined }
                    : x
                ),
              }
            : g
        )
      );
      handleCancel(rowKey);
      setDeleteKeyConfirm(null);
      setNotifications((ns) => [
        { id: "n_" + Date.now(), text: `Deleted ${item.name} API key.`, time: "just now", unread: true, type: "success" },
        ...ns,
      ]);
      flash();
    } catch (err) {
      setRow(rowKey, { phase: "idle", errorMsg: "" });
      handleCancel(rowKey);
      setDeleteKeyConfirm(null);
      setNotifications((ns) => [
        { id: "n_" + Date.now(), text: err.message || `Failed to delete ${item.name} key.`, time: "just now", unread: true, type: "error" },
        ...ns,
      ]);
    }
  };

  const handleAddSuccess = (newIntegration) => {
    const itemObj = {
      name: newIntegration.name,
      status: "connected",
      apiKeyMasked: newIntegration.masked,
      model: newIntegration.model,
      baseUrl: newIntegration.baseUrl,
      voiceId: newIntegration.voiceId,
      config: { voice_id: newIntegration.voiceId },
    };
    setCredsState((prev) => {
      const exists = prev.find((g) => g.group === newIntegration.category);
      if (exists) {
        return prev.map((g) =>
          g.group === newIntegration.category
            ? { ...g, items: [...(g.items || []).filter((it) => it.name !== newIntegration.name), itemObj] }
            : g
        );
      }
      return [...prev, { group: newIntegration.category, desc: "", items: [itemObj] }];
    });
    if (newIntegration.voiceId) announceVoiceChanged();
    setNotifications((ns) => [
      { id: "n_" + Date.now(), text: `✓ Verified and activated ${newIntegration.name}`, time: "just now", unread: true, type: "success" },
      ...ns,
    ]);
    flash();
  };

  return (
    <>
      {!embedded && <TopBar title="AI config" subtitle="Line setup · Connections · Setup guide" notifications={notifications} setNotifications={setNotifications} />}
      <div style={{ padding: embedded ? 0 : "20px 32px" }}>

        <div style={{
          display: "flex",
          gap: 8,
          marginBottom: 18,
          flexWrap: "wrap",
          padding: embedded ? 6 : 0,
          background: embedded ? "#fff" : "transparent",
          border: embedded ? `1px solid ${C.border}` : "none",
          borderRadius: embedded ? 14 : 0,
          boxShadow: embedded ? "0 8px 28px rgba(18,20,28,0.06)" : "none",
        }}>
          {(embedded
            ? [
                { id: "telephony-hub", label: "Line setup" },
                { id: "credentials", label: "Connections" },
                { id: "docs", label: "Setup guide" },
              ]
            : [
                { id: "telephony-hub", label: "Line setup" },
                { id: "credentials", label: "Connections" },
                { id: "docs", label: "Setup guide" },
              ]
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              style={{
                padding: embedded ? "8px 14px" : "8px 16px",
                borderRadius: embedded ? 10 : 8,
                border: embedded ? "none" : `1px solid ${activeTab === t.id ? C.ink : C.border}`,
                background: activeTab === t.id ? (embedded ? C.ink : C.ink) : (embedded ? "transparent" : "#fff"),
                color: activeTab === t.id ? "#fff" : C.slate,
                fontFamily: FONT_BODY,
                fontSize: 13,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {activeTab === "docs" && (
          <TelephonyDocsView
            embedded={embedded}
            notifications={notifications}
            setNotifications={setNotifications}
            onNavigate={(dest) => {
              if (dest === "provider") setActiveTab("telephony-hub");
              else if (onNavigateView) onNavigateView(dest);
              else if (typeof window.__aivhub_switch_voice_view === "function") window.__aivhub_switch_voice_view(dest);
            }}
          />
        )}

        {/* TAB 0: Voice & Telephony Trunking Hub */}
        {activeTab === "telephony-hub" && (
          <VoiceTrunkingHubTab
            notifications={notifications}
            setNotifications={setNotifications}
            profile={profile}
            setProfile={setProfile}
            onOpenCredentials={() => setActiveTab("credentials")}
          />
        )}

        {/* TAB: Connections — single place to paste keys + see what's in use */}
        {activeTab === "credentials" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div style={{ padding: "14px 16px", borderRadius: 10, background: "#F8FAFC", border: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.textInk, marginBottom: 4 }}>Connections</div>
              <div style={{ fontSize: 12.5, color: C.slate, lineHeight: 1.45 }}>
                One place for API keys. Rows highlighted <b>In use · Calling</b> are what the live call stack is using now. Line phone / Activate stay under <b>Line setup</b>.
              </div>
              {liveLabels && (
                <div style={{ marginTop: 10, fontSize: 12.5, color: C.ink, fontWeight: 600 }}>
                  Calling now: {liveLabels.carrier} · {liveLabels.engine} · speak {liveLabels.tts}
                  {liveHub?.externalTts ? " (hybrid)" : ""}
                </div>
              )}
            </div>

            <TelnyxAssistantSettingsCard />

            {credsState.map((group) => (
              <div key={group.group}>
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 12, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em" }}>{group.group}</div>
                  {group.desc && <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.slateLight, marginTop: 2 }}>{group.desc}</div>}
                </div>

                <div style={{ background: C.paperCard, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden" }}>
                  {group.items.map((it, idx) => {
                    const rowKey = group.group + "|" + it.name;
                    const rs = rowState[rowKey] || {};
                    const phase = rs.phase || "idle";
                    const nameL = String(it.name || "").toLowerCase();
                    const carrierL = String(liveHub?.activeCarrier || liveLabels?.carrier || "").toLowerCase();
                    const ttsL = String(liveHub?.ttsProvider || liveHub?.ttsName || liveLabels?.tts || "").toLowerCase();
                    const engL = String(liveHub?.liveEngine || liveHub?.activeEngine || "").toLowerCase();
                    const isConnected = it.status === "connected";
                    let usedBy = "";
                    if (isConnected) {
                      if (group.group === "Telephony" && carrierL && nameL.includes(carrierL.split(/\s+/)[0])) {
                        usedBy = "In use · Calling";
                      } else if (group.group === "Text-to-Speech" && (
                        (nameL.includes("xai") && (ttsL.includes("xai") || !liveHub?.externalTts && engL.includes("xai"))) ||
                        (nameL.includes("cartesia") && ttsL.includes("cartesia")) ||
                        (nameL.includes("eleven") && ttsL.includes("eleven")) ||
                        (nameL.includes("deepgram") && (ttsL.includes("deepgram") || ttsL.includes("aura"))) ||
                        (ttsL && nameL.includes(ttsL.split(/\s+/)[0]))
                      )) {
                        usedBy = "In use · Calling speak";
                      } else if (group.group === "Voice Orchestration" && (
                        (nameL.includes("livekit") && engL.includes("livekit")) ||
                        (nameL.includes("xai") && engL.includes("xai")) ||
                        (nameL.includes("vapi") && engL.includes("vapi")) ||
                        (nameL.includes("retell") && engL.includes("retell")) ||
                        (nameL.includes("openai") && engL.includes("openai")) ||
                        (nameL.includes("modular") && engL.includes("modular"))
                      )) {
                        usedBy = "In use · Calling engine";
                      } else if (group.group === "Speech-to-Text" && (
                        (liveHub?.sttProvider && nameL.includes(String(liveHub.sttProvider).toLowerCase())) ||
                        (nameL.includes("deepgram") && String(liveLabels?.stt || "").toLowerCase().includes("deepgram"))
                      )) {
                        usedBy = "In use · Calling listen";
                      } else if (group.group === "LLM" && (
                        (liveHub?.llmProvider && nameL.includes(String(liveHub.llmProvider).toLowerCase())) ||
                        (nameL.includes("deepseek") && String(liveLabels?.llm || "").toLowerCase().includes("deepseek")) ||
                        (nameL.includes("openai") && String(liveLabels?.llm || "").toLowerCase().includes("openai"))
                      )) {
                        usedBy = "In use · Calling think";
                      } else if (group.group === "Calendar") {
                        usedBy = "In use · Schedule";
                      }
                    }
                    const highlighted = isConnected && !!usedBy;
                    const rowBg = isConnected ? "#F0FDF4" : undefined;
                    const rowBorderTop = idx === 0 ? "none" : (isConnected ? "1px solid #BBF7D0" : `1px solid ${C.border}`);
                    return (
                      <div key={it.name} style={{ borderTop: rowBorderTop, background: rowBg, transition: "background 0.2s ease, border-color 0.2s ease" }}>
                        {/* Main row */}
                        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 18px" }}>
                          <div style={{ width: 210, fontFamily: FONT_BODY, fontWeight: 600, fontSize: 13.5, color: C.textInk }}>
                            {it.name}
                            {it.model && (
                              <div style={{ fontSize: 11, fontFamily: FONT_MONO, color: C.cobalt, marginTop: 2, fontWeight: 600 }}>
                                Model: {it.model}
                              </div>
                            )}
                            {highlighted && (
                              <div style={{ fontSize: 10.5, fontWeight: 700, color: "#065F46", marginTop: 3, letterSpacing: "0.02em" }}>
                                {usedBy}
                                {group.group === "Text-to-Speech" && (liveHub?.ttsName || liveLabels?.tts) && (
                                  <span style={{ display: "block", color: "#047857", fontWeight: 600, fontSize: 10, marginTop: 1 }}>
                                    Active: {liveHub.ttsName || liveLabels.tts}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                          <div style={{ flex: 1, fontFamily: FONT_MONO, fontSize: 12, color: isConnected ? C.textInk : C.slateLight }}>
                            {it.apiKeyMasked || (isConnected ? "••••••••••••" : "Not configured")}
                          </div>
                          <Badge status={it.status} small />

                          {phase === "idle" && (
                            <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                              <button onClick={() => handleConnect(rowKey, it)}
                                style={{
                                  background: "#fff",
                                  border: `1px solid ${isConnected ? "#86EFAC" : C.border}`,
                                  borderRadius: 7,
                                  padding: "6px 14px",
                                  fontFamily: FONT_BODY,
                                  fontSize: 12,
                                  color: isConnected ? "#15803D" : C.slate,
                                  fontWeight: isConnected ? 600 : 500,
                                  cursor: "pointer",
                                  whiteSpace: "nowrap"
                                }}>
                                {isConnected ? "Configure / Update" : "Connect"}
                              </button>
                              {isConnected && (
                                <button
                                  type="button"
                                  onClick={() => requestDeleteKey(group.group, it, rowKey)}
                                  title="Delete saved API key"
                                  style={{ background: "#fff", border: `1px solid #F0C4B8`, borderRadius: 7, padding: "6px 10px", fontFamily: FONT_BODY, fontSize: 12, color: C.red, cursor: "pointer", whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 5 }}
                                >
                                  <Trash2 size={13} /> Delete key
                                </button>
                              )}
                            </div>
                          )}
                          {phase !== "idle" && (
                            <button onClick={() => handleCancel(rowKey)}
                              style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 7, padding: "6px 10px", fontFamily: FONT_BODY, fontSize: 12, color: C.slate, cursor: "pointer" }}>
                              Cancel
                            </button>
                          )}
                        </div>

                        {/* Inline input area with Test -> Save transition */}
                        {phase !== "idle" && (
                          <div style={{ borderTop: `1px solid ${C.border}`, background: C.paper, padding: "14px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
                            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                              <label style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                                {String(it.name || "").toLowerCase().includes("twilio")
                                  ? "Twilio Auth Token"
                                  : String(it.name || "").toLowerCase().includes("whatsapp")
                                  ? "Meta WhatsApp Access Token (EAAG...)"
                                  : `${it.name} API Key / Token`}
                              </label>
                              <div style={{ position: "relative", width: "100%" }}>
                                <input
                                  autoFocus={phase === "editing"}
                                  type={rs.showKey ? "text" : "password"}
                                  disabled={phase === "testing" || phase === "saving"}
                                  value={rs.keyValue || ""}
                                  onChange={(e) => setRow(rowKey, { keyValue: e.target.value, errorMsg: "", phase: "editing", testResult: null })}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      if (phase === "tested_ok") handleSave(group.group, it.name, rowKey);
                                      else handleTest(group.group, it.name, rowKey);
                                    }
                                  }}
                                  placeholder={String(it.name || "").toLowerCase().includes("twilio")
                                    ? "Paste 32-character Auth Token from console.twilio.com"
                                    : String(it.name || "").toLowerCase().includes("whatsapp")
                                    ? "Paste Meta Access Token (starts with EAAG...)"
                                    : "Paste API key / token to test & connect..."}
                                  style={{ width: "100%", boxSizing: "border-box", padding: "8px 38px 8px 12px", borderRadius: 8, border: `1px solid ${phase === "tested_fail" ? C.red : phase === "tested_ok" ? C.green : C.cobalt}`, fontFamily: FONT_MONO, fontSize: 12.5, outline: "none", background: "#fff" }}
                                />
                                <button
                                  type="button"
                                  onClick={() => setRow(rowKey, { showKey: !rs.showKey })}
                                  style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", padding: 4, display: "flex", alignItems: "center", color: C.slateLight }}
                                  title={rs.showKey ? "Hide key" : "Show key"}
                                >
                                  {rs.showKey ? <EyeOff size={15} /> : <Eye size={15} />}
                                </button>
                              </div>
                            </div>

                            {/* Optional Phone Number & Agent ID / Twilio Account SID / WhatsApp Phone ID */}
                            {(it.name.toLowerCase().includes("xai") || group.group === "Telephony" || group.group === "Voice Orchestration" || it.name.toLowerCase().includes("twilio") || group.group === "Messaging" || it.name.toLowerCase().includes("whatsapp")) && (
                              <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 10, marginTop: 4 }}>
                                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                  <label style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                                    {String(it.name || "").toLowerCase().includes("whatsapp")
                                      ? "WhatsApp Sender / Phone Number"
                                      : "Assigned Outbound Phone Number"}
                                  </label>
                                  <input
                                    type="text"
                                    value={rs.phoneValue || ""}
                                    onChange={(e) => setRow(rowKey, { phoneValue: e.target.value })}
                                    placeholder={String(it.name || "").toLowerCase().includes("whatsapp") ? "+1 555... or your registered WhatsApp number" : "+44 20... or +1..."}
                                    style={{ width: "100%", boxSizing: "border-box", padding: "8px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_MONO, fontSize: 12, outline: "none", background: "#fff" }}
                                  />
                                </div>
                                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                  <label style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                                    {isTelnyxCarrierRow(rowKey)
                                      ? "Call Control App ID (Optional)"
                                      : String(it.name || "").toLowerCase().includes("twilio")
                                      ? "Account SID (required)"
                                      : String(it.name || "").toLowerCase().includes("whatsapp")
                                      ? "Phone Number ID (Required)"
                                      : String(it.name || "").toLowerCase().includes("vapi")
                                      ? "Vapi Assistant ID (Optional)"
                                      : String(it.name || "").toLowerCase().includes("retell")
                                      ? "Retell Agent ID (Required for Outbound)"
                                      : "Voice Agent ID (Optional)"}
                                  </label>
                                  <input
                                    type="text"
                                    value={
                                      String(it.name || "").toLowerCase().includes("twilio") || String(it.name || "").toLowerCase().includes("whatsapp")
                                        ? (rs.accountSidValue || rs.agentIdValue || "")
                                        : (rs.agentIdValue || "")
                                    }
                                    onChange={(e) => {
                                      const v = e.target.value;
                                      if (String(it.name || "").toLowerCase().includes("twilio") || String(it.name || "").toLowerCase().includes("whatsapp")) {
                                        setRow(rowKey, { accountSidValue: v, agentIdValue: v, errorMsg: "" });
                                      } else {
                                        setRow(rowKey, { agentIdValue: v });
                                      }
                                    }}
                                    placeholder={isTelnyxCarrierRow(rowKey)
                                      ? "Leave empty to auto-detect"
                                      : String(it.name || "").toLowerCase().includes("twilio")
                                      ? "ACxxxxxxxx… (34 characters)"
                                      : String(it.name || "").toLowerCase().includes("whatsapp")
                                      ? "e.g. 1238965585975808 (15 digits)"
                                      : String(it.name || "").toLowerCase().includes("vapi")
                                      ? "asst_... or UUID (optional)"
                                      : String(it.name || "").toLowerCase().includes("retell")
                                      ? "agent_xxxxxxxxxxxxxxxx"
                                      : "agent_... or sid_..."}
                                    style={{ width: "100%", boxSizing: "border-box", padding: "8px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_MONO, fontSize: 12, outline: "none", background: "#fff" }}
                                  />
                                </div>
                              </div>
                            )}

                            {/* Model Selection & Custom Base URL */}
                            {(["LLM", "Speech-to-Text", "Text-to-Speech", "Voice Orchestration"].includes(group.group) || String(it.name || "").toLowerCase().includes("other")) && (
                              <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 10, marginTop: 4 }}>
                                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                  <label style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                                    Model
                                  </label>
                                  <input
                                    type="text"
                                    value={rs.modelValue || ""}
                                    onChange={(e) => setRow(rowKey, { modelValue: e.target.value })}
                                    placeholder={group.group === "Speech-to-Text" ? "e.g. nova-2, nova-2-phonecall" : group.group === "Text-to-Speech" ? "e.g. sonic-3" : "e.g. deepseek-chat, gpt-4o-mini, grok-4.20-0309-non-reasoning"}
                                    style={{ width: "100%", boxSizing: "border-box", padding: "8px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_MONO, fontSize: 12, outline: "none", background: "#fff" }}
                                  />
                                </div>
                                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                  <label style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                                    Custom Base URL (Optional)
                                  </label>
                                  <input
                                    type="text"
                                    value={rs.baseUrlValue || ""}
                                    onChange={(e) => setRow(rowKey, { baseUrlValue: e.target.value })}
                                    placeholder="https://... or http://localhost:11434/v1"
                                    style={{ width: "100%", boxSizing: "border-box", padding: "8px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_MONO, fontSize: 12, outline: "none", background: "#fff" }}
                                  />
                                  <SelfHostedHint />
                                </div>
                              </div>
                            )}

                            {/* A voice saved with a TTS key goes into the voice library */}
                            {group.group === "Text-to-Speech" && (
                              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
                                <label style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                                  Add a voice (optional){it.voiceCount ? ` · ${it.voiceCount} saved` : ""}
                                </label>
                                <input
                                  type="text"
                                  value={rs.voiceIdValue || ""}
                                  onChange={(e) => setRow(rowKey, { voiceIdValue: e.target.value })}
                                  placeholder="Voice ID from this provider"
                                  style={{ width: "100%", boxSizing: "border-box", padding: "8px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_MONO, fontSize: 12, outline: "none", background: "#fff" }}
                                />
                                <label style={{ display: "flex", gap: 6, alignItems: "center", fontFamily: FONT_BODY, fontSize: 12, color: C.textInk }}>
                                  <input type="checkbox" checked={!!rs.useForCallsValue} onChange={(e) => setRow(rowKey, { useForCallsValue: e.target.checked })} />
                                  Use for calls
                                </label>
                                <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.slateLight }}>Saved to the voice library. See and switch all voices under Line setup → Voice.</div>
                              </div>
                            )}

                            {rs.errorMsg && (
                              <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", background: C.redSoft, border: `1px solid #F0C4B8`, borderRadius: 6, fontFamily: FONT_BODY, fontSize: 12, color: C.red }}>
                                <AlertTriangle size={14} /> {rs.errorMsg}
                              </div>
                            )}

                            {phase === "tested_ok" && (
                              <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", background: C.greenSoft, border: `1px solid #BFE6DF`, borderRadius: 6, fontFamily: FONT_BODY, fontSize: 12, color: C.green }}>
                                <CheckCircle2 size={14} /> {rs.testResult}
                              </div>
                            )}

                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2, flexWrap: "wrap" }}>
                              {phase !== "tested_ok" ? (
                                <>
                                  <button
                                    onClick={() => handleTest(group.group, it.name, rowKey)}
                                    disabled={phase === "testing"}
                                    style={{ background: C.cobalt, color: "#fff", border: "none", borderRadius: 7, padding: "8px 18px", fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: phase === "testing" ? "wait" : "pointer", display: "flex", alignItems: "center", gap: 6 }}
                                  >
                                    {phase === "testing" ? (
                                      <>
                                        <RefreshCw size={13} className="animate-spin" /> Testing live connection...
                                      </>
                                    ) : (
                                      <>
                                        <ShieldCheck size={13} /> Test Connection
                                      </>
                                    )}
                                  </button>
                                  {isConnected && (
                                    <button
                                      onClick={() => handleSave(group.group, it.name, rowKey)}
                                      disabled={phase === "saving"}
                                      title="Update model, base URL, or voice ID without re-testing your secret API key"
                                      style={{ background: C.ink, color: "#fff", border: "none", borderRadius: 7, padding: "8px 16px", fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: phase === "saving" ? "wait" : "pointer", display: "flex", alignItems: "center", gap: 6 }}
                                    >
                                      {phase === "saving" ? (
                                        <>
                                          <RefreshCw size={13} className="animate-spin" /> Updating…
                                        </>
                                      ) : (
                                        <>
                                          <Save size={13} /> Save Settings (Keep Key)
                                        </>
                                      )}
                                    </button>
                                  )}
                                </>
                              ) : (
                                <button
                                  onClick={() => handleSave(group.group, it.name, rowKey)}
                                  disabled={phase === "saving"}
                                  style={{ background: C.green, color: "#fff", border: "none", borderRadius: 7, padding: "8px 20px", fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: phase === "saving" ? "wait" : "pointer", display: "flex", alignItems: "center", gap: 6 }}
                                >
                                  {phase === "saving" ? (
                                    <>
                                      <RefreshCw size={13} className="animate-spin" /> Saving key...
                                    </>
                                  ) : (
                                    <>
                                      <Check size={14} /> Save Verified Key
                                    </>
                                  )}
                                </button>
                              )}

                              <button
                                onClick={() => handleCancel(rowKey)}
                                style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 7, padding: "8px 14px", fontFamily: FONT_BODY, fontSize: 12, color: C.slate, cursor: "pointer" }}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Subtle add link per category */}
                <button onClick={() => { setAddModalCategory(group.group); setShowAdd(true); }}
                  style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", fontFamily: FONT_BODY, fontSize: 12, color: C.slateLight, cursor: "pointer", padding: "4px 4px" }}>
                  <Plus size={12} /> Add {group.group} provider
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {dirty && (
        <div style={{ position: "fixed", bottom: 24, right: 32, background: C.ink, color: "#fff", padding: "12px 18px", borderRadius: 10, fontFamily: FONT_BODY, fontSize: 12.5, display: "flex", alignItems: "center", gap: 10, zIndex: 100 }}>
          <CheckCircle2 size={15} color={C.teal} /> Changes applied successfully
        </div>
      )}

      {showAdd && <AddIntegrationModal initialCategory={addModalCategory} onClose={() => setShowAdd(false)} onAddSuccess={handleAddSuccess} />}

      {deleteKeyConfirm && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-key-confirm-title"
          onClick={() => !deleteKeyConfirm.deleting && setDeleteKeyConfirm(null)}
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
              maxWidth: 440,
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
                  background: C.redSoft,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}>
                  <Trash2 size={18} color={C.red} />
                </div>
                <h3 id="delete-key-confirm-title" style={{ margin: 0, fontFamily: FONT_DISPLAY, fontSize: 17, fontWeight: 800, color: C.textInk }}>
                  Delete {deleteKeyConfirm.item?.name} Key?
                </h3>
              </div>
              <button
                type="button"
                onClick={() => !deleteKeyConfirm.deleting && setDeleteKeyConfirm(null)}
                style={{ background: "none", border: "none", cursor: deleteKeyConfirm.deleting ? "wait" : "pointer", color: C.slate, padding: 4 }}
                aria-label="Close"
                disabled={deleteKeyConfirm.deleting}
              >
                <X size={18} />
              </button>
            </div>
            <p style={{ margin: "0 0 18px", fontSize: 13.5, lineHeight: 1.5, color: C.slate }}>
              Permanently remove the saved credentials for <b style={{ color: C.textInk }}>{deleteKeyConfirm.item?.name}</b> in <b>{deleteKeyConfirm.groupName}</b>? This cannot be undone.
            </p>
            {deleteKeyConfirm.usedBy === null ? (
              <p style={{ margin: "-8px 0 18px", fontSize: 12.5, color: C.slate }}>Checking what uses it…</p>
            ) : deleteKeyConfirm.usedBy.length ? (
              <div style={{ margin: "-6px 0 18px", padding: "10px 12px", borderRadius: 10, background: C.amberSoft, border: `1px solid ${C.border}`, fontSize: 12.5, color: C.textInk, lineHeight: 1.5 }}>
                <b>In use. These stop working until you add another key:</b>
                <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                  {deleteKeyConfirm.usedBy.map((u) => <li key={u}>{u}</li>)}
                </ul>
              </div>
            ) : (
              <p style={{ margin: "-8px 0 18px", fontSize: 12.5, color: C.slate }}>Nothing is using it right now.</p>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => setDeleteKeyConfirm(null)}
                disabled={deleteKeyConfirm.deleting}
                style={{
                  background: "#fff",
                  border: `1px solid ${C.border}`,
                  borderRadius: 8,
                  padding: "9px 16px",
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: deleteKeyConfirm.deleting ? "wait" : "pointer",
                  color: C.textInk,
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDeleteKey}
                disabled={deleteKeyConfirm.deleting}
                style={{
                  background: C.red,
                  border: "none",
                  borderRadius: 8,
                  padding: "9px 16px",
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: deleteKeyConfirm.deleting ? "wait" : "pointer",
                  color: "#fff",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                {deleteKeyConfirm.deleting ? (
                  <>
                    <RefreshCw size={14} className="animate-spin" /> Deleting…
                  </>
                ) : (
                  <>
                    <Trash2 size={14} /> Delete key
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
