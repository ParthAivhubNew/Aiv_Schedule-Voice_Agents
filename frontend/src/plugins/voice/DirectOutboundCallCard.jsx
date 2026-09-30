import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Headphones,
  KeyRound,
  PhoneCall,
  RefreshCw,
  Save,
  Server,
} from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../api/apiClient";
import { C, FONT_BODY, FONT_DISPLAY, FONT_MONO } from "../../app/constants";
import { LiveKitBrowserCallModal } from "../../components/LiveKitBrowserCallModal";

export function DirectOutboundCallCard({ notifications, setNotifications, defaultFromNumber, onViewLiveCalls, onCallCreated, prefillData, style }) {
  const [toNumber, setToNumber] = useState(prefillData?.toNumber || "");
  const [prospectName, setProspectName] = useState(prefillData?.prospectName || "");
  const [fromNumber, setFromNumber] = useState(defaultFromNumber || "");
  const [carrierChoice, setCarrierChoice] = useState("twilio");
  const [missionTitle, setMissionTitle] = useState(prefillData?.missionTitle || "Direct Client Outreach");
  const [liveKitModalOpen, setLiveKitModalOpen] = useState(false);

  useEffect(() => {
    if (defaultFromNumber) {
      setFromNumber((prev) => (!prev || prev.includes("79460912") ? defaultFromNumber : prev));
    }
  }, [defaultFromNumber]);
  const [accountSid, setAccountSid] = useState(() => {
    try {
      const saved = (localStorage.getItem("aivhub_twilio_sid") || "").trim();
      // If the saved value is truncated or invalid (not 34 chars starting with AC), purge it immediately!
      if (saved && (!saved.startsWith("AC") || saved.length !== 34)) {
        localStorage.removeItem("aivhub_twilio_sid");
        return "";
      }
      return saved;
    } catch (_) { return ""; }
  });
  const [authToken, setAuthToken] = useState(() => {
    try {
      const saved = (localStorage.getItem("aivhub_twilio_token") || "").trim();
      // If the saved token is truncated or invalid (not 32 chars), purge it immediately!
      if (saved && saved.length !== 32) {
        localStorage.removeItem("aivhub_twilio_token");
        return "";
      }
      return saved;
    } catch (_) { return ""; }
  });
  const [showCreds, setShowCreds] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  // Auto-sync Twilio credentials to localStorage ONLY if completely valid; otherwise remove
  useEffect(() => {
    try {
      const clean = (accountSid || "").trim();
      if (clean && clean.startsWith("AC") && clean.length === 34) {
        localStorage.setItem("aivhub_twilio_sid", clean);
      } else {
        localStorage.removeItem("aivhub_twilio_sid");
      }
    } catch (_) {}
  }, [accountSid]);

  useEffect(() => {
    try {
      const clean = (authToken || "").trim();
      if (clean && clean.length === 32) {
        localStorage.setItem("aivhub_twilio_token", clean);
      } else {
        localStorage.removeItem("aivhub_twilio_token");
      }
    } catch (_) {}
  }, [authToken]);

  // Clean any legacy invalid items from localStorage on mount
  useEffect(() => {
    try {
      const s = localStorage.getItem("aivhub_twilio_sid");
      if (s && (!s.startsWith("AC") || s.length !== 34)) {
        localStorage.removeItem("aivhub_twilio_sid");
        setAccountSid("");
      }
      const t = localStorage.getItem("aivhub_twilio_token");
      if (t && t.length !== 32) {
        localStorage.removeItem("aivhub_twilio_token");
        setAuthToken("");
      }
    } catch (_) {}
  }, []);

  const [savedContacts, setSavedContacts] = useState(() => {
    try {
      const saved = localStorage.getItem("aivhub_saved_contacts");
      if (saved) return JSON.parse(saved);
    } catch (_) {}
    return [
      { id: "sc_jm", name: "Jitendra Mehta", company: "Example Ltd", phone: "+447577570050", role: "CEO / Director" },
      { id: "sc_ops", name: "Operations Desk", company: "Example Ltd", phone: "+447307216767", role: "Support" }
    ];
  });

  useEffect(() => {
    if (prefillData) {
      if (prefillData.toNumber) setToNumber(prefillData.toNumber);
      if (prefillData.prospectName) setProspectName(prefillData.prospectName);
      if (prefillData.missionTitle) setMissionTitle(prefillData.missionTitle);
    }
  }, [prefillData]);

  const [dialing, setDialing] = useState(false);
  const [dialResult, setDialResult] = useState(null);
  const [dialError, setDialError] = useState("");
  const [saveStatus, setSaveStatus] = useState(null);

  const handleSaveTwilioCreds = async () => {
    const cleanSid = (accountSid || "").trim();
    const cleanToken = (authToken || "").trim();
    if (!cleanSid || !cleanToken) {
      setSaveStatus({ error: "Please enter both Twilio Account SID and Auth Token." });
      return;
    }
    if (!cleanSid.startsWith("AC") || cleanSid.length !== 34) {
      setSaveStatus({ error: `Account SID must start with 'AC' and be exactly 34 characters (currently ${cleanSid.length}). Found: '${cleanSid}'. Please copy the full Account SID from console.twilio.com.` });
      return;
    }
    if (cleanToken.length !== 32) {
      setSaveStatus({ error: `Auth Token must be exactly 32 characters (currently ${cleanToken.length}). Please copy the full Auth Token from console.twilio.com.` });
      return;
    }
    setSaveStatus({ saving: true });
    try {
      // Account SID is an identifier; Auth Token is sealed in DB only — never keep token in browser vault.
      localStorage.setItem("aivhub_twilio_sid", cleanSid);
      localStorage.removeItem("aivhub_twilio_token");
      await api.testAndSaveConnection({
        layer: "Telephony",
        provider: "Twilio",
        api_key: cleanToken,
        account_sid: cleanSid
      });
      setAuthToken("");
      setSaveStatus({ success: "✓ Twilio credentials encrypted & saved to database (token not kept in browser)." });
      setTimeout(() => setSaveStatus(null), 3500);
    } catch (err) {
      setSaveStatus({ error: err.message || "Failed to verify Twilio credentials." });
      setTimeout(() => setSaveStatus(null), 4500);
    }
  };

  const handleDial = async (e) => {
    if (e) e.preventDefault();
    if (carrierChoice === "livekit") {
      setLiveKitModalOpen(true);
      return;
    }
    if (!toNumber.trim()) {
      setDialError("Please enter a destination phone number.");
      return;
    }
    setDialing(true);
    setDialError("");
    setDialResult(null);

    const cleanSid = (accountSid || "").trim();
    const cleanToken = (authToken || "").trim();

    // If valid full credentials are provided, save to localStorage and pass in payload
    const validSid = (cleanSid && cleanSid.startsWith("AC") && cleanSid.length === 34) ? cleanSid : undefined;
    const validToken = (cleanToken && cleanToken.length === 32) ? cleanToken : undefined;

    if (validSid) {
      try { localStorage.setItem("aivhub_twilio_sid", validSid); } catch (_) {}
    }
    if (validToken) {
      try { localStorage.setItem("aivhub_twilio_token", validToken); } catch (_) {}
    }

    try {
      const payload = {
        to_number: toNumber.trim(),
        from_number: fromNumber.trim() || undefined,
        prospect_name: prospectName.trim() || undefined,
        mission_title: missionTitle.trim() || "Direct Client Outreach",
        carrier: carrierChoice,
        account_sid: validSid,
        api_key: validToken
      };
      const res = await api.dialOutbound(payload);
      setDialResult(res);
      if (onCallCreated) {
        try { onCallCreated(res, payload); } catch (_) {}
      }
      setNotifications((ns) => [
        {
          id: "n_" + Date.now(),
          text: `📞 Outbound call dispatched to ${toNumber} via ${res.carrier || carrierChoice.toUpperCase()}`,
          time: "just now",
          unread: true,
          type: "success"
        },
        ...ns
      ]);
    } catch (err) {
      setDialError(err.message || "Failed to initiate outbound call.");
    } finally {
      setDialing(false);
    }
  };

  return (
    <div style={{
      background: "#fff",
      borderRadius: 16,
      padding: isExpanded ? "20px 24px" : "14px 16px",
      color: C.textInk,
      border: `1px solid ${C.border}`,
      boxShadow: "0 8px 28px rgba(18,20,28,0.06)",
      margin: 0,
      ...style
    }}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => { if (!isExpanded) setIsExpanded(true); }}
        onKeyDown={(e) => { if (!isExpanded && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setIsExpanded(true); } }}
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: isExpanded ? 16 : 0, cursor: isExpanded ? "default" : "pointer" }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ background: C.teal, width: 8, height: 8, borderRadius: "50%", display: "inline-block" }} />
            <span style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: C.slate }}>
              Direct outbound
            </span>
          </div>
          {isExpanded ? (
            <>
              <h2 style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 18, color: C.textInk, margin: "6px 0 2px" }}>
                Dial one number
              </h2>
              <p style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate, margin: 0, maxWidth: 680, lineHeight: 1.4 }}>
                Test a single live line. Same voice stack as list calls. List page already dials the file — use this only for a one-off.
              </p>
            </>
          ) : (
            <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.slate, marginTop: 4 }}>
              Collapsed. Click to expand and place a one-off test call.
            </div>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }} onClick={(e) => e.stopPropagation()}>
          {isExpanded && onViewLiveCalls && (
            <button
              type="button"
              onClick={onViewLiveCalls}
              style={{
                background: C.cobaltSoft,
                border: "1px solid #C7D7FA",
                borderRadius: 8,
                padding: "6px 12px",
                color: C.cobaltDeep,
                fontFamily: FONT_BODY,
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 5
              }}
            >
              <Activity size={12} color={C.cobalt} /> Live
            </button>
          )}
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            style={{
              background: C.cobaltSoft,
              border: "1px solid #C7D7FA",
              borderRadius: 8,
              padding: "7px 12px",
              color: C.cobaltDeep,
              fontFamily: FONT_BODY,
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <ChevronDown size={14} style={{ transform: isExpanded ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
            {isExpanded ? "Collapse" : "Expand"}
          </button>
        </div>
      </div>

      {isExpanded && (
        <form onSubmit={handleDial} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Quick Dial Saved Contacts Bar */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", background: "#F8FAFC", padding: "8px 12px", borderRadius: 8, border: `1px solid ${C.border}` }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              ⚡ Quick Dial:
            </span>
            {savedContacts.map((sc) => (
              <button
                key={sc.id}
                type="button"
                onClick={() => {
                  setToNumber(sc.phone);
                  setProspectName(sc.name);
                }}
                style={{
                  background: toNumber === sc.phone ? C.cobalt : "#fff",
                  border: `1px solid ${toNumber === sc.phone ? C.cobalt : C.border}`,
                  borderRadius: 16,
                  padding: "4px 10px",
                  color: toNumber === sc.phone ? "#fff" : C.textInk,
                  fontFamily: FONT_BODY,
                  fontSize: 11.5,
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5
                }}
              >
                <span>📞 {sc.name}</span>
                <span style={{ opacity: 0.75, fontSize: 10.5 }}>({sc.phone})</span>
              </button>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
            {/* Destination Number */}
            <div>
              <label style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: C.slate, marginBottom: 5 }}>
                Destination Number <span style={{ color: C.red }}>*</span>
              </label>
              <input
                type="text"
                value={toNumber}
                onChange={(e) => setToNumber(e.target.value)}
                placeholder="e.g. +44... or +1..."
                style={{
                  width: "100%",
                  padding: "9px 12px",
                  borderRadius: 7,
                  border: `1px solid ${C.border}`,
                  background: "#fff",
                  color: C.textInk,
                  fontFamily: FONT_MONO,
                  fontSize: 13.5,
                  boxSizing: "border-box"
                }}
              />
              <div style={{ fontSize: 10.5, color: C.slateLight, marginTop: 3 }}>
                UK mobile (+447...) or international
              </div>
            </div>

            {/* Prospect Name */}
            <div>
              <label style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: C.slate, marginBottom: 5 }}>
                Prospect / Contact Name
              </label>
              <input
                type="text"
                value={prospectName}
                onChange={(e) => setProspectName(e.target.value)}
                placeholder="e.g. Boss (VIP Test)"
                style={{
                  width: "100%",
                  padding: "9px 12px",
                  borderRadius: 7,
                  border: `1px solid ${C.border}`,
                  background: "#fff",
                  color: C.textInk,
                  fontFamily: FONT_BODY,
                  fontSize: 13,
                  boxSizing: "border-box"
                }}
              />
              <div style={{ fontSize: 10.5, color: C.slateLight, marginTop: 3 }}>
                AI addresses them by name
              </div>
            </div>

            {/* Mission Title */}
            <div>
              <label style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: C.slate, marginBottom: 5 }}>
                Mission / Campaign
              </label>
              <input
                type="text"
                value={missionTitle}
                onChange={(e) => setMissionTitle(e.target.value)}
                placeholder="e.g. Direct Client Outreach"
                style={{
                  width: "100%",
                  padding: "9px 12px",
                  borderRadius: 7,
                  border: `1px solid ${C.border}`,
                  background: "#fff",
                  color: C.textInk,
                  fontFamily: FONT_BODY,
                  fontSize: 13,
                  boxSizing: "border-box"
                }}
              />
              <div style={{ fontSize: 10.5, color: C.slateLight, marginTop: 3 }}>
                Label for tracking & notes
              </div>
            </div>

            {/* Carrier Plugin */}
            <div>
              <label style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: C.slate, marginBottom: 5 }}>
                Carrier Plugin
              </label>
              <select
                value={carrierChoice}
                onChange={(e) => setCarrierChoice(e.target.value)}
                style={{
                  width: "100%",
                  padding: "9px 12px",
                  borderRadius: 7,
                  border: `1px solid ${C.border}`,
                  background: "#fff",
                  color: C.textInk,
                  fontFamily: FONT_BODY,
                  fontSize: 13,
                  fontWeight: 600,
                  boxSizing: "border-box"
                }}
              >
                <option value="twilio">Twilio Voice (UK PSTN)</option>
                <option value="telnyx">Telnyx (BYO SIP Trunk)</option>
                <option value="generic_sip">Generic SIP / PBX</option>
                <option value="livekit">LiveKit WebRTC (In-Browser Test)</option>
              </select>
              <div style={{ fontSize: 10.5, color: C.slateLight, marginTop: 3 }}>
                Multi-provider adapter
              </div>
            </div>

            {/* Caller ID */}
            <div>
              <label style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: C.slate, marginBottom: 5 }}>
                Caller ID (From)
              </label>
              <input
                type="text"
                value={fromNumber}
                onChange={(e) => setFromNumber(e.target.value)}
                placeholder="e.g. +44... or +1..."
                style={{
                  width: "100%",
                  padding: "9px 12px",
                  borderRadius: 7,
                  border: `1px solid ${C.border}`,
                  background: "#fff",
                  color: C.textInk,
                  fontFamily: FONT_MONO,
                  fontSize: 13,
                  boxSizing: "border-box"
                }}
              />
              <div style={{ fontSize: 10.5, color: C.slateLight, marginTop: 3 }}>
                Presented phone line
              </div>
            </div>
          </div>

          {/* Twilio credentials vault */}
          {carrierChoice === "twilio" && (
            <div style={{
              background: "#F8FAFC",
              border: `1px solid ${C.border}`,
              borderRadius: 10,
              padding: "12px 14px",
              marginTop: 6
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, flexWrap: "wrap", gap: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: C.textInk }}>
                  <KeyRound size={13} color={C.cobalt} />
                  <span>Twilio Account Credentials (Saved Safely)</span>
                  {accountSid && authToken && (
                    <span style={{ fontSize: 10, color: "#065F46", background: "#D1FAE5", padding: "1px 6px", borderRadius: 4, fontWeight: 600 }}>
                      ✓ Saved & Active
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {(accountSid || authToken) && (
                    <button
                      type="button"
                      onClick={() => {
                        setAccountSid("");
                        setAuthToken("");
                        try {
                          localStorage.removeItem("aivhub_twilio_sid");
                          localStorage.removeItem("aivhub_twilio_token");
                        } catch (_) {}
                      }}
                      style={{
                        background: "#fff",
                        color: C.slate,
                        border: `1px solid ${C.border}`,
                        borderRadius: 6,
                        padding: "5px 10px",
                        fontSize: 11,
                        cursor: "pointer"
                      }}
                    >
                      Clear & Use Server Vault
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleSaveTwilioCreds}
                    disabled={saveStatus?.saving}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                      background: C.cobalt,
                      color: "#fff",
                      border: "none",
                      borderRadius: 6,
                      padding: "5px 12px",
                      fontSize: 11.5,
                      fontWeight: 600,
                      cursor: "pointer"
                    }}
                  >
                    <Save size={12} />
                    {saveStatus?.saving ? "Saving..." : "Save Credentials"}
                  </button>
                </div>
              </div>
              {!accountSid && !authToken && (
                <div style={{ fontSize: 11, color: "#065F46", background: "#ECFDF5", padding: "6px 10px", borderRadius: 6, marginBottom: 8, display: "flex", alignItems: "center", gap: 6, border: "1px solid #A7F3D0" }}>
                  <span>🛡️</span>
                  <span><strong>Active:</strong> Using verified carrier credentials stored securely in the server vault{fromNumber ? ` (${fromNumber})` : ""}. You do not need to enter credentials manually.</span>
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                    <label style={{ fontSize: 10.5, color: C.slate }}>Twilio Account SID</label>
                    <span style={{
                      fontSize: 9.5,
                      fontWeight: 600,
                      color: !accountSid ? C.slateLight : (accountSid.length === 34 && accountSid.startsWith("AC") ? "#059669" : C.red)
                    }}>
                      {accountSid ? `${accountSid.length}/34 chars ${accountSid.length === 34 && accountSid.startsWith("AC") ? "✓" : "(incomplete)"}` : "Required (34 chars)"}
                    </span>
                  </div>
                  <input
                    type="text"
                    value={accountSid}
                    onChange={(e) => setAccountSid(e.target.value)}
                    placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: 6,
                      border: `1px solid ${accountSid && (accountSid.length !== 34 || !accountSid.startsWith("AC")) ? "#FCA5A5" : C.border}`,
                      background: "#fff",
                      color: C.textInk,
                      fontFamily: FONT_MONO,
                      fontSize: 12,
                      boxSizing: "border-box"
                    }}
                  />
                </div>
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                    <label style={{ fontSize: 10.5, color: C.slate }}>Twilio Auth Token</label>
                    <span style={{
                      fontSize: 9.5,
                      fontWeight: 600,
                      color: !authToken ? C.slateLight : (authToken.length === 32 ? "#059669" : C.red)
                    }}>
                      {authToken ? `${authToken.length}/32 chars ${authToken.length === 32 ? "✓" : "(incomplete)"}` : "Required (32 chars)"}
                    </span>
                  </div>
                  <input
                    type="password"
                    value={authToken}
                    onChange={(e) => setAuthToken(e.target.value)}
                    placeholder="••••••••••••••••••••••••••••••••"
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: 6,
                      border: `1px solid ${authToken && authToken.length !== 32 ? "#FCA5A5" : C.border}`,
                      background: "#fff",
                      color: C.textInk,
                      fontFamily: FONT_MONO,
                      fontSize: 12,
                      boxSizing: "border-box"
                    }}
                  />
                </div>
              </div>

              {saveStatus?.success && (
                <div style={{ marginTop: 8, fontSize: 11.5, color: "#059669", fontWeight: 600 }}>
                  {saveStatus.success}
                </div>
              )}
              {saveStatus?.error && (
                <div style={{ marginTop: 8, fontSize: 11.5, color: C.red, fontWeight: 600 }}>
                  ⚠ {saveStatus.error}
                </div>
              )}
            </div>
          )}

          {/* Error Alert */}
          {dialError && (
            <div style={{
              background: C.redSoft,
              border: "1px solid #FCA5A5",
              color: C.red,
              borderRadius: 8,
              padding: "9px 12px",
              fontSize: 12.5,
              display: "flex",
              alignItems: "center",
              gap: 8
            }}>
              <AlertTriangle size={14} color={C.red} />
              <span>{dialError}</span>
            </div>
          )}

          {/* Success Alert */}
          {dialResult && (
            <div style={{
              background: C.greenSoft,
              border: "1px solid #A7F3D0",
              color: "#065F46",
              borderRadius: 8,
              padding: "10px 14px",
              fontSize: 12.5,
              display: "flex",
              flexDirection: "column",
              gap: 6
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700 }}>
                  <CheckCircle2 size={15} color="#059669" />
                  <span>Call Dispatched! (Status: {dialResult.status})</span>
                </div>
                {onViewLiveCalls && (
                  <button
                    type="button"
                    onClick={onViewLiveCalls}
                    style={{
                      background: C.green,
                      color: "#fff",
                      border: "none",
                      borderRadius: 6,
                      padding: "4px 10px",
                      fontWeight: 700,
                      fontSize: 11.5,
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4
                    }}
                  >
                    <Activity size={12} /> Monitor Live Activity →
                  </button>
                )}
              </div>
              <div style={{ fontFamily: FONT_MONO, fontSize: 11, color: C.slate }}>
                SID: <strong>{dialResult.call_id}</strong> • Carrier: <strong>{dialResult.carrier}</strong> • SIP: <strong>{dialResult.bridge_sip_uri}</strong>
              </div>
            </div>
          )}

          {/* Submit & Test Buttons */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <button
              type="submit"
              disabled={dialing}
              style={{
                background: dialing ? C.slateLight : C.ink,
                color: "#fff",
                border: "none",
                borderRadius: 7,
                padding: "10px 22px",
                fontFamily: FONT_DISPLAY,
                fontSize: 13.5,
                fontWeight: 800,
                cursor: dialing ? "wait" : "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                boxShadow: "0 4px 14px rgba(0,0,0,0.12)"
              }}
            >
              {dialing ? (
                <>
                  <RefreshCw size={14} className="animate-spin" /> Calling {toNumber || "Prospect"}...
                </>
              ) : (
                <>
                  <PhoneCall size={15} /> 📞 Initiate Outbound Call Now
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => setLiveKitModalOpen(true)}
              style={{
                background: "linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%)",
                color: "#fff",
                border: "none",
                borderRadius: 7,
                padding: "10px 22px",
                fontFamily: FONT_DISPLAY,
                fontSize: 13.5,
                fontWeight: 800,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                boxShadow: "0 4px 14px rgba(37,99,235,0.3)",
                transition: "all 0.15s ease",
              }}
              title="Test call directly in web browser using LiveKit WebRTC (Zero carrier charges, 48kHz audio)"
            >
              <Headphones size={15} /> 🎙️ Test Call in Web (LiveKit WebRTC)
            </button>
          </div>
        </form>
      )}

      {/* LiveKit WebRTC In-Browser Voice Call Modal */}
      <LiveKitBrowserCallModal
        isOpen={liveKitModalOpen}
        onClose={() => setLiveKitModalOpen(false)}
        prospectName={prospectName.trim() || "Test Prospect"}
        prospectPhone={toNumber.trim() || "Browser WebRTC"}
        companyName={missionTitle.trim() || "Your company"}
        onCallEnded={() => {
          if (onViewLiveCalls) onViewLiveCalls();
        }}
      />
    </div>
  );
}


/* ---------------------------------- Voice & Telephony Trunking Hub (Multi-Provider) ---------------------------------- */
