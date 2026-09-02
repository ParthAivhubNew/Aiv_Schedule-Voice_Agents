import React, { useState } from "react";
import { Users, FileText, Package, HelpCircle, ShieldCheck, Plus, Globe, Upload, Save, Check } from "lucide-react";
import { C, FONT_BODY, FONT_DISPLAY } from "../tokens";
import { TopBar } from "../components/TopBar";

export function CompanyProfileView({
  profile = {},
  setProfile,
  notifications,
  setNotifications,
  sources = [],
  setSources,
  services = [],
  setServices,
  faq = [],
  setFaq,
  onSaveProfile,
}) {
  const [tab, setTab] = useState("identity");
  const [localProfile, setLocalProfile] = useState(profile);
  const [saved, setSaved] = useState(false);

  const handleChange = (k, v) => {
    setLocalProfile((p) => ({ ...p, [k]: v }));
    setSaved(false);
  };

  const handleSave = async () => {
    if (setProfile) setProfile(localProfile);
    if (onSaveProfile) await onSaveProfile(localProfile);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div style={{ flex: 1, overflowY: "auto", background: C.bg }}>
      <TopBar
        title="Company Profile & Knowledge"
        subtitle="Core company identity, caller persona, knowledge base documents, and compliance policies."
        notifications={notifications}
        setNotifications={setNotifications}
      />

      <div style={{ padding: 32 }}>
        {/* Navigation Tabs */}
        <div style={{ display: "flex", gap: 8, borderBottom: `1px solid ${C.border}`, paddingBottom: 14, marginBottom: 28 }}>
          {[
            { id: "identity", label: "Identity & Persona", icon: Users },
            { id: "knowledge", label: "Knowledge Sources", icon: FileText },
            { id: "services", label: "Services & Offerings", icon: Package },
            { id: "faq", label: "Objection Handling & FAQ", icon: HelpCircle },
            { id: "compliance", label: "UK PECR & Compliance", icon: ShieldCheck },
          ].map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "9px 16px",
                  borderRadius: 10,
                  border: `1px solid ${active ? C.cobaltDeep : "transparent"}`,
                  background: active ? "rgba(75,115,255,0.15)" : "rgba(255,255,255,0.03)",
                  color: active ? "#FFFFFF" : C.slate,
                  fontFamily: FONT_BODY,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
              >
                <Icon size={15} color={active ? C.cobaltDeep : C.slate} /> {t.label}
              </button>
            );
          })}
        </div>

        {/* Content Tabs */}
        <div style={{ background: "rgba(18, 22, 41, 0.75)", backdropFilter: "blur(16px)", borderRadius: 20, border: `1px solid ${C.border}`, padding: 32, maxWidth: 800, boxShadow: C.shadowCard }}>
          {tab === "identity" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#CBD5E1", marginBottom: 6 }}>Represented Company Name</label>
                <input type="text" value={localProfile.name || ""} onChange={(e) => handleChange("name", e.target.value)} style={{ width: "100%", height: 42, padding: "0 14px", borderRadius: 10 }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#CBD5E1", marginBottom: 6 }}>Core Value Proposition / Elevator Pitch</label>
                <textarea rows={2} value={localProfile.pitch || ""} onChange={(e) => handleChange("pitch", e.target.value)} style={{ width: "100%", padding: 12, borderRadius: 10 }} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#CBD5E1", marginBottom: 6 }}>AI Caller Persona Name</label>
                  <input type="text" value={localProfile.callerName || localProfile.caller_name || "Sam"} onChange={(e) => handleChange("callerName", e.target.value)} style={{ width: "100%", height: 42, padding: "0 14px", borderRadius: 10 }} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#CBD5E1", marginBottom: 6 }}>Outbound Caller ID (CLI)</label>
                  <input type="text" value={localProfile.callerId || localProfile.caller_id || "+44 20 7946 0912"} onChange={(e) => handleChange("callerId", e.target.value)} style={{ width: "100%", height: 42, padding: "0 14px", borderRadius: 10 }} />
                </div>
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#CBD5E1", marginBottom: 6 }}>Tone of Voice</label>
                <input type="text" value={localProfile.tone || ""} onChange={(e) => handleChange("tone", e.target.value)} style={{ width: "100%", height: 42, padding: "0 14px", borderRadius: 10 }} />
              </div>
            </div>
          )}

          {tab === "knowledge" && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#FFFFFF" }}>Indexed Documents & Sources</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {sources.map((s) => (
                  <div key={s.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: 14, borderRadius: 12, background: "rgba(255,255,255,0.03)", border: `1px solid ${C.borderLight}` }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13.5, color: "#FFFFFF" }}>{s.name}</div>
                      <div style={{ fontSize: 12, color: C.slate, marginTop: 2 }}>{s.type}: {s.value}</div>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: C.teal, background: C.tealSoft, padding: "3px 9px", borderRadius: 5, border: `1px solid rgba(0,229,195,0.3)` }}>
                      INDEXED
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === "services" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {services.map((sv) => (
                <div key={sv.id} style={{ padding: 16, borderRadius: 12, border: `1px solid ${C.borderLight}`, background: "rgba(255,255,255,0.03)" }}>
                  <div style={{ fontWeight: 700, fontSize: 15, color: "#FFFFFF" }}>{sv.name}</div>
                  <div style={{ fontSize: 12.5, color: C.cobaltDeep, marginTop: 2, fontWeight: 600 }}>Ideal for: {sv.ideal}</div>
                  <div style={{ fontSize: 13, color: C.slate, marginTop: 6, lineHeight: 1.45 }}>{sv.desc}</div>
                </div>
              ))}
            </div>
          )}

          {tab === "faq" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {faq.map((f) => (
                <div key={f.id} style={{ padding: 16, borderRadius: 12, border: `1px solid ${C.borderLight}`, background: "rgba(255,255,255,0.03)" }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: "#FFFFFF" }}>Q: {f.q}</div>
                  <div style={{ fontSize: 13, color: C.slate, marginTop: 6, lineHeight: 1.45 }}>A: {f.a}</div>
                </div>
              ))}
            </div>
          )}

          {tab === "compliance" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#CBD5E1", marginBottom: 6 }}>ICO Registration Reference</label>
                <input type="text" value={localProfile.icoRef || localProfile.ico_ref || "ZA774219"} onChange={(e) => handleChange("icoRef", e.target.value)} style={{ width: "100%", height: 42, padding: "0 14px", borderRadius: 10 }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#CBD5E1", marginBottom: 6 }}>Call Recording Statutory Disclosure</label>
                <textarea rows={2} value={localProfile.disclosure || ""} onChange={(e) => handleChange("disclosure", e.target.value)} style={{ width: "100%", padding: 12, borderRadius: 10 }} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#CBD5E1", marginBottom: 6 }}>Daily Lunch Buffer</label>
                  <input type="text" value={`${localProfile.lunchStart || "12:00"} – ${localProfile.lunchEnd || "13:00"}`} readOnly style={{ width: "100%", height: 42, padding: "0 14px", borderRadius: 10, opacity: 0.8 }} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#CBD5E1", marginBottom: 6 }}>Legal Calling Window</label>
                  <input type="text" value="08:00 – 21:00 (PECR Legal Max)" readOnly style={{ width: "100%", height: 42, padding: "0 14px", borderRadius: 10, opacity: 0.8 }} />
                </div>
              </div>
            </div>
          )}

          <div style={{ marginTop: 28, paddingTop: 20, borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "flex-end" }}>
            <button
              onClick={handleSave}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 24px",
                borderRadius: 10,
                border: "none",
                background: saved ? C.green : C.gradientPrimary,
                color: "#fff",
                fontWeight: 600,
                fontSize: 13.5,
                cursor: "pointer",
                boxShadow: C.glowPrimary,
              }}
            >
              {saved ? <Check size={15} /> : <Save size={15} />} {saved ? "Changes Saved" : "Save Changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
