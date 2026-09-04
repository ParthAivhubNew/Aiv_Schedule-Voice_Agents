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
  services = [],
  faq = [],
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
    <div style={{ flex: 1, overflowY: "auto", background: C.paper }}>
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
                  padding: "8px 16px",
                  borderRadius: 999,
                  border: `1px solid ${active ? C.ink : C.border}`,
                  background: active ? C.ink : "#FFFFFF",
                  color: active ? "#FFFFFF" : C.textInk,
                  fontFamily: FONT_BODY,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                <Icon size={14} color={active ? "#FFFFFF" : C.slate} /> {t.label}
              </button>
            );
          })}
        </div>

        {/* Content Container */}
        <div style={{ background: "#FFFFFF", borderRadius: 18, border: `1px solid ${C.border}`, padding: 30, maxWidth: 800, boxShadow: C.shadowCard }}>
          {tab === "identity" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 6 }}>Represented Company Name</label>
                <input type="text" value={localProfile.name || ""} onChange={(e) => handleChange("name", e.target.value)} style={{ width: "100%", height: 42, padding: "0 14px", borderRadius: 8, border: `1px solid ${C.border}` }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 6 }}>Core Value Proposition / Elevator Pitch</label>
                <textarea rows={2} value={localProfile.pitch || ""} onChange={(e) => handleChange("pitch", e.target.value)} style={{ width: "100%", padding: 12, borderRadius: 8, border: `1px solid ${C.border}` }} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 6 }}>AI Caller Persona Name</label>
                  <input type="text" value={localProfile.callerName || localProfile.caller_name || "Sam"} onChange={(e) => handleChange("callerName", e.target.value)} style={{ width: "100%", height: 42, padding: "0 14px", borderRadius: 8, border: `1px solid ${C.border}` }} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 6 }}>Outbound Caller ID (CLI)</label>
                  <input type="text" value={localProfile.callerId || localProfile.caller_id || "+44 20 7946 0912"} onChange={(e) => handleChange("callerId", e.target.value)} style={{ width: "100%", height: 42, padding: "0 14px", borderRadius: 8, border: `1px solid ${C.border}` }} />
                </div>
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 6 }}>Tone of Voice</label>
                <input type="text" value={localProfile.tone || ""} onChange={(e) => handleChange("tone", e.target.value)} style={{ width: "100%", height: 42, padding: "0 14px", borderRadius: 8, border: `1px solid ${C.border}` }} />
              </div>
            </div>
          )}

          {tab === "knowledge" && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: C.ink }}>Indexed Documents & Sources</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {(sources.length ? sources : [
                  { id: "k-1", name: "AIVHub Core Fleet Capabilities.pdf", type: "PDF Document", value: "Fleet operations overview" },
                  { id: "k-2", name: "https://aivhub.co.uk", type: "Website URL", value: "Public product pages" }
                ]).map((s) => (
                  <div key={s.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: 14, borderRadius: 10, background: C.paperSoft }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13.5, color: C.ink }}>{s.name}</div>
                      <div style={{ fontSize: 12, color: C.slate, marginTop: 2 }}>{s.type}: {s.value}</div>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: C.teal, background: C.tealSoft, padding: "3px 8px", borderRadius: 4 }}>
                      INDEXED
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === "services" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {(services.length ? services : [
                { id: "s-1", name: "Autonomous Dispatch Booking", ideal: "UK haulage & 3PL operators", desc: "Automated qualification and discovery meeting booking with transport managers." }
              ]).map((sv) => (
                <div key={sv.id} style={{ padding: 16, borderRadius: 10, border: `1px solid ${C.border}`, background: C.paperSoft }}>
                  <div style={{ fontWeight: 700, fontSize: 14.5, color: C.ink }}>{sv.name}</div>
                  <div style={{ fontSize: 12.5, color: C.cobalt, marginTop: 2, fontWeight: 600 }}>Ideal for: {sv.ideal}</div>
                  <div style={{ fontSize: 13, color: C.textInk, marginTop: 6, lineHeight: 1.45 }}>{sv.desc}</div>
                </div>
              ))}
            </div>
          )}

          {tab === "faq" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {(faq.length ? faq : [
                { id: "f-1", q: "How much does this cost?", a: "Pricing depends on fleet size and call volume. We provide clear proposals after a brief 15-minute demo." },
                { id: "f-2", q: "Are you real or an AI?", a: "I am an autonomous voice assistant from AIVHub calling to coordinate meeting availability." }
              ]).map((f) => (
                <div key={f.id} style={{ padding: 16, borderRadius: 10, border: `1px solid ${C.border}`, background: C.paperSoft }}>
                  <div style={{ fontWeight: 700, fontSize: 13.5, color: C.ink }}>Q: {f.q}</div>
                  <div style={{ fontSize: 13, color: C.textInk, marginTop: 6, lineHeight: 1.45 }}>A: {f.a}</div>
                </div>
              ))}
            </div>
          )}

          {tab === "compliance" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 6 }}>ICO Registration Reference</label>
                <input type="text" value={localProfile.icoRef || localProfile.ico_ref || "ZA774219"} onChange={(e) => handleChange("icoRef", e.target.value)} style={{ width: "100%", height: 42, padding: "0 14px", borderRadius: 8, border: `1px solid ${C.border}` }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 6 }}>Call Recording Statutory Disclosure</label>
                <textarea rows={2} value={localProfile.disclosure || ""} onChange={(e) => handleChange("disclosure", e.target.value)} style={{ width: "100%", padding: 12, borderRadius: 8, border: `1px solid ${C.border}` }} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 6 }}>Daily Lunch Buffer</label>
                  <input type="text" value={`${localProfile.lunchStart || "12:00"} – ${localProfile.lunchEnd || "13:00"}`} readOnly style={{ width: "100%", height: 42, padding: "0 14px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.paperSoft }} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 6 }}>Legal Calling Window</label>
                  <input type="text" value="08:00 – 21:00 (PECR Legal Max)" readOnly style={{ width: "100%", height: 42, padding: "0 14px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.paperSoft }} />
                </div>
              </div>
            </div>
          )}

          <div style={{ marginTop: 24, paddingTop: 18, borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "flex-end" }}>
            <button
              onClick={handleSave}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 22px",
                borderRadius: 9,
                border: "none",
                background: saved ? C.green : C.cobalt,
                color: "#fff",
                fontWeight: 600,
                fontSize: 13.5,
                cursor: "pointer",
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
