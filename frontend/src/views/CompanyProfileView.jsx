import React, { useState, useEffect } from "react";
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
  const [tab, setTab] = useState(() => {
    try {
      return localStorage.getItem("aivhub_company_tab") || "identity";
    } catch (_) {
      return "identity";
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem("aivhub_company_tab", tab);
    } catch (_) {}
  }, [tab]);
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
            { id: "script", label: "Call Script & Rules", icon: HelpCircle },
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
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 6 }}>Say Company Name As (Phonetic / Spoken)</label>
                <input type="text" value={localProfile.spokenName || localProfile.spoken_name || ""} onChange={(e) => handleChange("spokenName", e.target.value)} placeholder="e.g. Outreach by A I V Hub" style={{ width: "100%", height: 42, padding: "0 14px", borderRadius: 8, border: `1px solid ${C.border}` }} />
                <span style={{ fontSize: 11, color: C.slate, marginTop: 4, display: "block" }}>How the voice TTS engine pronounces your company name. Spaces help spell out acronyms cleanly.</span>
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
                  <input type="text" value={localProfile.callerId || localProfile.caller_id || ""} onChange={(e) => handleChange("callerId", e.target.value)} placeholder="e.g. +44... or +1..." style={{ width: "100%", height: 42, padding: "0 14px", borderRadius: 8, border: `1px solid ${C.border}` }} />
                </div>
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 6 }}>Active Calendar Engine</label>
                <select
                  value={localProfile.calendar_mode || localProfile.calendarMode || "internal"}
                  onChange={(e) => handleChange("calendar_mode", e.target.value)}
                  style={{ width: "100%", height: 42, padding: "0 14px", borderRadius: 8, border: `1px solid ${C.border}`, background: "#fff", fontSize: 13 }}
                >
                  <option value="internal">Internal Database Calendar</option>
                  <option value="calcom">Cal.com Cloud Calendar & Event Types</option>
                </select>
                <span style={{ fontSize: 11, color: C.slate, marginTop: 4, display: "block" }}>
                  Switch at any time. When using Internal mode, booked appointments appear directly in your local Meetings tab. When Cal.com is selected, slots and bookings synchronize via Cal.com.
                </span>
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

          {tab === "script" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Single Place: Demo Conversation Blueprint (Few-Shot Pattern) */}
              <div style={{ background: C.paperSoft, border: `1px solid ${C.border}`, borderRadius: 10, padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: C.ink }}>Demo Conversation Blueprint (Ideal Flow & Feelings)</div>
                <div style={{ fontSize: 12, color: C.slate }}>
                  The AI mimics this exact sample dialogue for conversational rhythm, natural contractions, brevity, warmth, and emotion.
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: C.ink, marginBottom: 4 }}>Ideal Sample Conversation Script</label>
                  <textarea
                    rows={6}
                    value={localProfile.demoScript || localProfile.demo_script || ""}
                    onChange={(e) => handleChange("demoScript", e.target.value)}
                    placeholder={'Prospect: "Hello?"\nAI: "Hi John, Parth here from A.I.V. Hub! Did I catch you in the middle of something?"\nProspect: "A little bit, what is this regarding?"\nAI: "Totally get it, won\'t keep you! We help businesses automate their Power BI reports. Just curious, how are you currently tracking your KPIs?"\nProspect: "We use Excel sheets mostly."\nAI: "Makes total sense! Would you be open to a quick 15-minute walkthrough sometime this week to see how we automate that?"'}
                    style={{ width: "100%", padding: 12, borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: "monospace", fontSize: 12.5 }}
                  />
                  <span style={{ fontSize: 11, color: C.slate, marginTop: 3, display: "block" }}>
                    Leave blank to automatically use your configured Opener, Hook, and Walkthrough offer below.
                  </span>
                </div>
              </div>

              {/* Master Voice Rules & Objections */}
              <div style={{ background: C.paperSoft, border: `1px solid ${C.border}`, borderRadius: 10, padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: C.ink }}>Master Business Rules & Objection Handling</div>
                <div style={{ fontSize: 12, color: C.slate }}>Direct operational rules, deal-breakers, and objection rebuttals followed strictly on every call.</div>
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: C.ink, marginBottom: 4 }}>Master Rules & Objections</label>
                  <textarea
                    rows={5}
                    value={localProfile.customRules || localProfile.custom_rules || ""}
                    onChange={(e) => handleChange("customRules", e.target.value)}
                    placeholder={"• If interrupted with 'hello', do NOT restart the greeting; say 'Yes, I\\'m right here!'\n• If they are busy or in a meeting, politely ask for their email address to send a 1-page overview.\n• If asked about pricing, state that pricing depends on data volume and offer the walkthrough for exact figures.\n• If they ask if you are an AI, confirm warmly that you are an AI assistant."}
                    style={{ width: "100%", padding: 12, borderRadius: 8, border: `1px solid ${C.border}` }}
                  />
                  <span style={{ fontSize: 11, color: C.slate, marginTop: 3, display: "block" }}>Direct behavioral prompt rules injected into every outbound call.</span>
                </div>
              </div>
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
