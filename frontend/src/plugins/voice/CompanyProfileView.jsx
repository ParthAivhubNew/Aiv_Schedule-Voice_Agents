import {
  AlertTriangle,
  BookOpen,
  Calendar,
  Check,
  CheckCircle2,
  FileText,
  Globe,
  HelpCircle,
  Layers,
  Link2,
  Package,
  PenLine,
  PlusCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../api/apiClient";
import {
  applyCallHourPolicy,
  C,
  CALL_HOUR_POLICIES,
  FONT_BODY,
  FONT_DISPLAY,
  LUNCH_HOUR_OPTIONS,
  PECR,
  PROFILE_TABS,
  SOURCE_TYPES,
  TIMEZONES,
  WEEKDAY_HOUR_OPTIONS,
} from "../../app/constants";
import { Field, SectionIntro, TopBar } from "../../app/ui";
import { announceOrgUpdated } from "../../org/orgSettings";

export function CompanyProfileView({ profile, setProfile, notifications, setNotifications, sources = [], setSources, services = [], setServices, faq = [], setFaq, embedded = false, onDirtyChange }) {
  const [tab, setTab] = useState("identity");
  const [saved, setSaved] = useState(false);
  const [addingSource, setAddingSource] = useState(false);
  const [newSource, setNewSource] = useState({ name: "", type: "Website URL", value: "" });
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [activeChunkModal, setActiveChunkModal] = useState(null);
  const [testQuery, setTestQuery] = useState("");
  const [testResults, setTestResults] = useState(null);
  const [testingQuery, setTestingQuery] = useState(false);
  const [resyncingId, setResyncingId] = useState(null);
  const [dirty, setDirty] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null);
  const [unsavedModalTarget, setUnsavedModalTarget] = useState(null);

  useEffect(() => {
    if (typeof onDirtyChange === "function") onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  const markDirty = () => setDirty(true);

  const requestTab = (nextId) => {
    if (nextId === tab) return;
    if (dirty) {
      setUnsavedModalTarget(nextId);
      return;
    }
    setTab(nextId);
  };

  const handleConfirmLeave = () => {
    const target = unsavedModalTarget;
    setDirty(false);
    setUnsavedModalTarget(null);
    if (target) setTab(target);
  };

  const handleSaveAndLeave = async () => {
    const target = unsavedModalTarget;
    await save(true);
    setUnsavedModalTarget(null);
    if (target) setTab(target);
  };

  const handleCancelLeave = () => {
    setUnsavedModalTarget(null);
  };

  useEffect(() => {
    const onExternalSave = () => {
      save(true);
    };
    window.addEventListener("aivhub_save_company", onExternalSave);
    return () => window.removeEventListener("aivhub_save_company", onExternalSave);
  }, [profile, sources, services, faq]);

  const update = (k, v) => {
    markDirty();
    setProfile((p) => {
      const next = { ...p, [k]: v };
      try { localStorage.setItem("aivhub_company_profile", JSON.stringify(next)); } catch (_) {}
      return next;
    });
  };

  const save = async (showToast = true) => {
    setSaving(true);
    setSaveStatus(null);
    setDirty(false);
    try {
      localStorage.setItem("aivhub_company_profile", JSON.stringify(profile));
      localStorage.setItem("aivhub_sources", JSON.stringify(sources));
      localStorage.setItem("aivhub_services", JSON.stringify(services));
      localStorage.setItem("aivhub_faq", JSON.stringify(faq));
    } catch (_) {}
    try {
      await api.updateProfile(profile);
      announceOrgUpdated();
      await api.saveServices(services);
      await api.saveFaqs(faq);
      setSaving(false);
      setSaved(true);
      setSaveStatus("saved");
      if (showToast && typeof setNotifications === "function") {
        setNotifications((ns) => [{ id: "n_" + Date.now(), text: "✓ Company profile, call rules & compliance saved", time: "just now", unread: true, type: "success" }, ...(ns || [])]);
      }
    } catch (err) {
      console.warn("Backend updateProfile warning:", err);
      setSaving(false);
      setSaved(true);
      setSaveStatus("saved_local");
      if (showToast && typeof setNotifications === "function") {
        setNotifications((ns) => [{ id: "n_" + Date.now(), text: "Company profile changes saved locally", time: "just now", unread: true, type: "info" }, ...(ns || [])]);
      }
    }
    setTimeout(() => {
      setSaved(false);
      setSaveStatus(null);
    }, 3000);
  };

  const renderSaveBtn = (label = "Save changes") => (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 10, marginTop: 8 }}>
      <button
        type="button"
        onClick={() => save(true)}
        disabled={saving}
        style={{
          background: saved ? "#059669" : saving ? "#4b5563" : "linear-gradient(135deg, #2a47ae 0%, #1a2d7a 100%)",
          color: "#fff",
          border: "none",
          borderRadius: 8,
          padding: "10px 20px",
          fontFamily: FONT_BODY,
          fontSize: 13,
          fontWeight: 600,
          cursor: saving ? "wait" : "pointer",
          display: "inline-flex",
          alignItems: "center",
          gap: 7,
          transition: "all 0.2s ease",
          boxShadow: saved ? "0 4px 12px rgba(5, 150, 105, 0.3)" : "0 4px 12px rgba(42, 71, 174, 0.25)",
        }}
      >
        {saving ? (
          <>
            <RefreshCw size={14} style={{ animation: "spin 1s linear infinite" }} />
            <span>Saving changes...</span>
          </>
        ) : saved ? (
          <>
            <Check size={14} />
            <span>Changes Saved!</span>
          </>
        ) : (
          <>
            <span>💾</span>
            <span>{label}</span>
          </>
        )}
      </button>
      {dirty && !saved && !saving && (
        <span style={{ fontSize: 12, color: "#b45309", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4 }}>
          ● Unsaved changes
        </span>
      )}
      {saved && (
        <span style={{ fontSize: 12, color: "#059669", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 4 }}>
          <CheckCircle2 size={14} /> Synced to database
        </span>
      )}
    </div>
  );

  const addSource = async () => {
    if (newSource.type === "File upload") {
      if (!newSource.file) return;
      const file = newSource.file;
      const name = (newSource.name || file.name).trim();
      setUploadError("");
      setUploading(true);
      try {
        await api.uploadSource(file, name);
        setNewSource({ name: "", type: "Website URL", value: "" });
        setAddingSource(false);
        setNotifications((ns) => [{ id: "n_" + Date.now(), text: `✓ ${name} added. Indexing started.`, time: "just now", unread: true, type: "info" }, ...ns]);
        const fresh = await api.getSources().catch(() => null);
        if (Array.isArray(fresh)) setSources(fresh);
        setTimeout(async () => {
          try {
            const later = await api.getSources();
            if (Array.isArray(later)) setSources(later);
          } catch (_) {}
        }, 3500);
      } catch (err) {
        setUploadError(err.message);
      }
      setUploading(false);
      return;
    }
    if (!newSource.name || !newSource.value) return;
    const tempId = "k_" + Date.now();
    const item = { id: tempId, ...newSource, status: "crawling", synced: "just now", chunkCount: 0 };
    setSources((s) => {
      const next = [item, ...s];
      try { localStorage.setItem("aivhub_sources", JSON.stringify(next)); } catch (_) {}
      return next;
    });
    setNewSource({ name: "", type: "Website URL", value: "" });
    setAddingSource(false);

    try {
      await api.addSource(item);
      setNotifications((ns) => [{ id: "n_" + Date.now(), text: `✓ Web crawling & vector indexing started for ${item.name}`, time: "just now", unread: true, type: "info" }, ...ns]);
      setTimeout(async () => {
        try {
          const fresh = await api.getSources();
          if (Array.isArray(fresh) && fresh.length) setSources(fresh);
        } catch (_) {}
      }, 3500);
    } catch (err) {
      console.warn("Backend addSource error:", err);
    }
  };

  const resyncSource = async (id) => {
    setResyncingId(id);
    setSources((s) => s.map((x) => (x.id === id ? { ...x, status: "crawling" } : x)));
    try {
      await api.resyncSource(id);
      setNotifications((ns) => [{ id: "n_" + Date.now(), text: "Re-crawling and re-embedding triggered", time: "just now", unread: true, type: "info" }, ...ns]);
      setTimeout(async () => {
        try {
          const fresh = await api.getSources();
          if (Array.isArray(fresh) && fresh.length) setSources(fresh);
        } catch (_) {}
        setResyncingId(null);
      }, 4000);
    } catch (err) {
      console.warn("Resync error:", err);
      setResyncingId(null);
    }
  };

  const viewChunks = async (source) => {
    setActiveChunkModal({ source, chunks: [], loading: true });
    try {
      const data = await api.getSourceChunks(source.id);
      setActiveChunkModal({ source, chunks: data || [], loading: false });
    } catch (err) {
      console.warn("Error loading chunks:", err);
      setActiveChunkModal({ source, chunks: [], loading: false, error: "No chunks indexed yet." });
    }
  };

  const removeSource = async (id) => {
    setSources((s) => {
      const next = s.filter((x) => x.id !== id);
      try { localStorage.setItem("aivhub_sources", JSON.stringify(next)); } catch (_) {}
      return next;
    });
    try {
      await api.deleteSource(id);
    } catch (_) {}
  };

  const runTestQuery = async () => {
    if (!testQuery.trim()) return;
    setTestingQuery(true);
    setTestResults(null);
    try {
      const res = await api.testKnowledgeQuery(testQuery.trim());
      setTestResults(res);
    } catch (err) {
      setTestResults({ query: testQuery, matches: [], count: 0, error: err.message || "Failed to search" });
    } finally {
      setTestingQuery(false);
    }
  };


  const addService = () => {
    markDirty();
    setServices((s) => {
      const next = [...s, { id: "sv_" + Date.now(), name: "", ideal: "", desc: "" }];
      try { localStorage.setItem("aivhub_services", JSON.stringify(next)); } catch (_) {}
      return next;
    });
  };

  const updateService = (id, k, v) => {
    markDirty();
    setServices((s) => {
      const next = s.map((x) => (x.id === id ? { ...x, [k]: v } : x));
      try { localStorage.setItem("aivhub_services", JSON.stringify(next)); } catch (_) {}
      return next;
    });
  };

  const removeService = (id) => {
    markDirty();
    setServices((s) => {
      const next = s.filter((x) => x.id !== id);
      try { localStorage.setItem("aivhub_services", JSON.stringify(next)); } catch (_) {}
      return next;
    });
  };

  const addFaq = () => {
    markDirty();
    setFaq((f) => {
      const next = [...f, { id: "f_" + Date.now(), q: "", a: "" }];
      try { localStorage.setItem("aivhub_faq", JSON.stringify(next)); } catch (_) {}
      return next;
    });
  };

  const updateFaq = (id, k, v) => {
    markDirty();
    setFaq((f) => {
      const next = f.map((x) => (x.id === id ? { ...x, [k]: v } : x));
      try { localStorage.setItem("aivhub_faq", JSON.stringify(next)); } catch (_) {}
      return next;
    });
  };

  const removeFaq = (id) => {
    markDirty();
    setFaq((f) => {
      const next = f.filter((x) => x.id !== id);
      try { localStorage.setItem("aivhub_faq", JSON.stringify(next)); } catch (_) {}
      return next;
    });
  };

  const renderProfileTabs = (mode) => (
    <div style={mode === "pills"
      ? { display: "flex", gap: 8, flexWrap: "wrap" }
      : { display: "flex", flexDirection: "column", gap: 2 }
    }>
      {PROFILE_TABS.map((t) => {
        const Icon = t.icon;
        const active = tab === t.id;
        const pill = mode === "pills";
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => requestTab(t.id)}
            style={pill ? {
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 16px",
              borderRadius: 8,
              border: `1px solid ${active ? C.ink : C.border}`,
              background: active ? C.ink : "#fff",
              color: active ? "#fff" : C.slate,
              fontFamily: FONT_BODY,
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            } : {
              display: "flex",
              alignItems: "center",
              gap: 9,
              padding: "9px 11px",
              borderRadius: 8,
              border: "none",
              cursor: "pointer",
              textAlign: "left",
              background: active ? C.cobaltSoft : "transparent",
              color: active ? C.cobaltDeep : C.slate,
              fontFamily: FONT_BODY,
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            <Icon size={15} /> {t.label}
          </button>
        );
      })}
    </div>
  );

  return (
    <>
      {!embedded && <TopBar title="Company Profile" subtitle="Everything the AI knows about your company when it's on a call" notifications={notifications} setNotifications={setNotifications} />}
      <div style={embedded
        ? { padding: 0, display: "flex", flexDirection: "column", gap: 14 }
        : { padding: "20px 32px", display: "grid", gridTemplateColumns: "200px 1fr", gap: 24 }
      }>
        {renderProfileTabs(embedded ? "pills" : "rail")}

        <div style={{ width: "100%", maxWidth: embedded ? "100%" : ((tab === "services" || tab === "knowledge") ? 1040 : 760), transition: "max-width 0.25s ease" }}>
          {tab === "identity" && (
            <div style={{ background: C.paperCard, border: `1px solid ${C.border}`, borderRadius: 12, padding: 22 }}>
              <SectionIntro icon={Users} title="Company identity" desc="Basic facts the AI introduces itself with and uses to explain who it's calling on behalf of." />
              <Field label="Company name" value={profile.name} onChange={(v) => update("name", v)} placeholder="Your company" />
              <Field
                label="Say company name as (spoken)"
                value={profile.spokenName || ""}
                onChange={(v) => update("spokenName", v)}
                placeholder="How the voice should say your brand"
                hint="Optional. Blank = say the company name as written."
              />
              <Field label="Industry" value={profile.industry || ""} onChange={(v) => update("industry", v)} placeholder="Industry" />
              <Field label="Website" value={profile.website || ""} onChange={(v) => update("website", v)} placeholder="https://" hint="Also added automatically as a knowledge source." />
              <Field label="LinkedIn / other social links" value={profile.social || ""} onChange={(v) => update("social", v)} placeholder="linkedin.com/company/…" />
              <Field label="Caller persona name" value={profile.callerName} onChange={(v) => update("callerName", v)} placeholder="Name the agent uses" hint="The name the AI introduces itself as on calls." />
              <Field label="Caller ID number shown" value={profile.callerId} onChange={(v) => update("callerId", v)} placeholder="+44…" />
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 6 }}>Organisation timezone</div>
                <select
                  value={profile.timezone || "Europe/London"}
                  onChange={(e) => update("timezone", e.target.value)}
                  style={{ width: "100%", padding: "8px 10px", borderRadius: 7, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13 }}
                >
                  {!TIMEZONES.some((z) => z.id === (profile.timezone || "Europe/London")) ? <option value={profile.timezone}>{profile.timezone}</option> : null}
                  {TIMEZONES.map((z) => <option key={z.id} value={z.id}>{z.label}</option>)}
                </select>
                <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.slateLight, marginTop: 4 }}>The whole app runs on this clock: post schedules, call windows, callbacks, meetings and call logs.</div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                <div>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 6 }}>Week starts on</div>
                  <select
                    value={profile.weekStart || "monday"}
                    onChange={(e) => update("weekStart", e.target.value)}
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 7, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13, background: "#fff" }}
                  >
                    <option value="monday">Monday</option>
                    <option value="sunday">Sunday</option>
                    <option value="saturday">Saturday</option>
                  </select>
                </div>
                <div>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 6 }}>Time format</div>
                  <select
                    value={profile.timeFormat || "24h"}
                    onChange={(e) => update("timeFormat", e.target.value)}
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 7, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13, background: "#fff" }}
                  >
                    <option value="24h">24-hour (14:30)</option>
                    <option value="12h">12-hour (2:30 PM)</option>
                  </select>
                </div>
              </div>
              <Field
                label="Post approver emails"
                value={Array.isArray(profile.approverEmails) ? profile.approverEmails.join(", ") : (profile.approverEmails || "")}
                onChange={(v) => update("approverEmails", v)}
                placeholder="approver@company.com, manager@company.com"
                hint="Every scheduled post is sent here for approval. Separate several with commas."
              />
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 6 }}>Active Calendar Engine</div>
                <select
                  value={profile.calendar_mode || profile.calendarMode || "internal"}
                  onChange={(e) => update("calendar_mode", e.target.value)}
                  style={{ width: "100%", padding: "8px 10px", borderRadius: 7, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13, background: "#fff" }}
                >
                  <option value="internal">Internal Database Calendar</option>
                  <option value="calcom">Cal.com Cloud Calendar & Event Types</option>
                </select>
                <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.slateLight, marginTop: 4 }}>
                  Switch at any time. When using Internal mode, booked appointments appear directly in your local Meetings tab. When Cal.com is selected, slots and bookings synchronize via Cal.com.
                </div>
              </div>
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 6 }}>When we may call — a policy, not an accident</div>
                <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.slate, lineHeight: 1.5, marginBottom: 10 }}>
                  UK PECR for B2B live calls: <strong>08:00–21:00 weekdays</strong>, <strong>09:00–18:00 weekends</strong>. Calling a shorter office day is legal. It is not the legal maximum.
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {CALL_HOUR_POLICIES.map((p) => {
                    const active = (profile.callHoursPolicy || "respectful") === p.id;
                    const range = p.id === "custom"
                      ? `${profile.weekdayStart || "09:00"}–${profile.weekdayEnd || "17:30"}`
                      : `${p.weekdayStart}–${p.weekdayEnd}`;
                    return (
                      <button
                        key={p.id}
                        onClick={() => {
                          const next = applyCallHourPolicy(p.id, profile);
                          setProfile((pr) => {
                            const merged = { ...pr, ...next };
                            try { localStorage.setItem("aivhub_company_profile", JSON.stringify(merged)); } catch (_) {}
                            return merged;
                          });
                        }}
                        style={{
                          textAlign: "left", padding: "11px 13px", borderRadius: 9, cursor: "pointer",
                          border: `1.5px solid ${active ? C.ink : C.border}`, background: active ? C.paper : "#fff",
                        }}
                      >
                        <div style={{ fontFamily: FONT_BODY, fontSize: 13, fontWeight: 700, color: C.textInk }}>
                          {p.label} · {range} weekdays
                        </div>
                        <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.slate, marginTop: 4, lineHeight: 1.4 }}>{p.blurb}</div>
                      </button>
                    );
                  })}
                </div>
                {(profile.callHoursPolicy || "respectful") === "custom" && (
                  <>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                      <span style={{ fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, color: C.slate }}>Window</span>
                      <select
                        value={profile.weekdayStart || "09:00"}
                        onChange={(e) => {
                          const v = e.target.value;
                          setProfile((p) => {
                            const next = { ...p, weekdayStart: v, callHoursPolicy: "custom" };
                            try { localStorage.setItem("aivhub_company_profile", JSON.stringify(next)); } catch (_) {}
                            return next;
                          });
                        }}
                        style={{ flex: 1, minWidth: 110, padding: "8px 10px", borderRadius: 7, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13 }}
                      >
                        {WEEKDAY_HOUR_OPTIONS.filter((t) => t < (profile.weekdayEnd || "21:00")).map((t) => <option key={t}>{t}</option>)}
                      </select>
                      <span style={{ color: C.slateLight }}>–</span>
                      <select
                        value={profile.weekdayEnd || "17:30"}
                        onChange={(e) => {
                          const v = e.target.value;
                          setProfile((p) => {
                            const next = { ...p, weekdayEnd: v, callHoursPolicy: "custom" };
                            try { localStorage.setItem("aivhub_company_profile", JSON.stringify(next)); } catch (_) {}
                            return next;
                          });
                        }}
                        style={{ flex: 1, minWidth: 110, padding: "8px 10px", borderRadius: 7, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13 }}
                      >
                        {WEEKDAY_HOUR_OPTIONS.filter((t) => t > (profile.weekdayStart || "08:00")).map((t) => <option key={t}>{t}</option>)}
                      </select>
                    </div>
                    <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.slateLight, marginTop: 6 }}>
                      Hard stop is PECR 08:00–21:00 weekdays.
                    </div>
                  </>
                )}
              </div>
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 6 }}>Lunch break of the people we call</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <select value={profile.lunchStart || "12:00"} onChange={(e) => update("lunchStart", e.target.value)} style={{ flex: 1, padding: "8px 10px", borderRadius: 7, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13 }}>
                    {LUNCH_HOUR_OPTIONS.filter((t) => t < (profile.lunchEnd || "15:00")).map((t) => <option key={t}>{t}</option>)}
                  </select>
                  <span style={{ color: C.slateLight }}>–</span>
                  <select value={profile.lunchEnd || "13:00"} onChange={(e) => update("lunchEnd", e.target.value)} style={{ flex: 1, padding: "8px 10px", borderRadius: 7, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13 }}>
                    {LUNCH_HOUR_OPTIONS.filter((t) => t > (profile.lunchStart || "11:00")).map((t) => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.slateLight, marginTop: 4 }}>No voice, WhatsApp, SMS, or email is sent in this window — so nobody is disturbed at lunch.</div>
              </div>
              <Field label="Tone" value={profile.tone} onChange={(v) => update("tone", v)} placeholder="Professional, concise, friendly" />
              {renderSaveBtn("Save changes")}
            </div>
          )}

          {tab === "knowledge" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ background: C.paperCard, border: `1px solid ${C.border}`, borderRadius: 12, padding: 22 }}>
                {(() => {
                  const ragFailed = sources.filter((s) => s.status === "failed").length;
                  const ragCrawling = sources.some((s) => s.status === "crawling" || resyncingId === s.id);
                  const ragChunks = sources.reduce((n, s) => n + (Number(s.chunkCount) || 0), 0);
                  const ragLive = sources.filter((s) => s.status !== "failed" && s.status !== "crawling").length;
                  const ragTone = ragCrawling
                    ? { bg: "#FFFBEB", bd: "#FDE68A", fg: "#92400E", label: "Indexing sources", sub: "Crawler is splitting pages into chunks for on-call search." }
                    : ragLive && !ragFailed
                      ? { bg: "#ECFDF5", bd: "#A7F3D0", fg: "#065F46", label: "Knowledge live on calls", sub: `${ragLive} source${ragLive === 1 ? "" : "s"} · ${ragChunks} chunk${ragChunks === 1 ? "" : "s"} · pitch, pricing and product answers come from these pages.` }
                      : ragLive && ragFailed
                        ? { bg: "#FFF7ED", bd: "#FED7AA", fg: "#9A3412", label: "Knowledge partial", sub: `${ragLive} live · ${ragFailed} failed · Re-crawl the failed URL so the agent is not answering from a thin index.` }
                        : ragFailed
                          ? { bg: "#FEF2F2", bd: "#FECACA", fg: "#991B1B", label: "Knowledge offline", sub: "All sources failed. Re-crawl before expecting website answers on a call." }
                          : { bg: "#F8FAFC", bd: C.border, fg: C.slate, label: "No sources indexed", sub: "Add your website or docs. The agent only enriches the pitch from what you index here." };
                  return (
                    <>
                  <SectionIntro
                    icon={BookOpen}
                    title="Knowledge sources & vector database"
                        desc="Websites, PDFs, documents, or objection playbooks. The crawler extracts text, chunks it, and indexes it for recall on live calls. The one-line pitch is the spine — this index is how the AI fills in product, pricing, and proof."
                      />
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, margin: "14px 0 18px", padding: "12px 14px", borderRadius: 12, background: ragTone.bg, border: `1px solid ${ragTone.bd}` }}>
                        <span style={{
                          width: 10, height: 10, borderRadius: 99, marginTop: 4, flexShrink: 0,
                          background: ragTone.fg,
                          boxShadow: ragCrawling || ragLive ? `0 0 0 4px ${ragTone.bd}` : "none",
                        }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontFamily: FONT_BODY, fontSize: 13, fontWeight: 700, color: ragTone.fg, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            {ragTone.label}
                            <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", opacity: 0.8 }}>pgvector</span>
                  </div>
                          <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: ragTone.fg, opacity: 0.85, marginTop: 3, lineHeight: 1.45 }}>{ragTone.sub}</div>
                </div>
                      </div>
                    </>
                  );
                })()}

                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {sources.map((s) => {
                    const isCrawling = s.status === "crawling" || resyncingId === s.id;
                    return (
                      <div
                        key={s.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                          padding: "12px 16px",
                          border: `1px solid ${C.border}`,
                          borderRadius: 10,
                          background: "#fff",
                          boxShadow: "0 1px 2px rgba(0,0,0,0.02)"
                        }}
                      >
                        <div style={{ width: 34, height: 34, borderRadius: 8, background: C.paper, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          {s.type === "Website URL" ? <Globe size={15} color={C.cobalt} /> : s.type.includes("Drive") ? <Link2 size={15} color={C.slate} /> : s.type === "Manual text" ? <PenLine size={15} color="#d97706" /> : <FileText size={15} color={C.slate} />}
                        </div>

                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 13, color: C.textInk }}>{s.name}</span>
                            <span style={{ fontFamily: FONT_BODY, fontSize: 10.5, fontWeight: 700, color: C.slate, background: C.paper, padding: "1px 6px", borderRadius: 4 }}>
                              {s.type}
                            </span>
                          </div>
                          <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.slateLight, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 2 }}>
                            {s.value}
                          </div>
                        </div>

                        {/* Crawling / Indexed Badge */}
                        <div>
                          {isCrawling ? (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "#fef3c7", color: "#b45309", padding: "3px 9px", borderRadius: 6, fontSize: 11, fontWeight: 700 }}>
                              <RefreshCw size={11} style={{ animation: "spin 1.5s linear infinite" }} /> Crawling & Indexing...
                            </span>
                          ) : s.status === "failed" ? (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "#fee2e2", color: "#dc2626", padding: "3px 9px", borderRadius: 6, fontSize: 11, fontWeight: 700 }} title={s.lastError || "Extraction failed"}>
                              Failed
                            </span>
                          ) : (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "#dcfce7", color: "#15803d", padding: "3px 9px", borderRadius: 6, fontSize: 11, fontWeight: 700 }}>
                              Indexed · {s.chunkCount || 0} chunks
                            </span>
                          )}
                        </div>

                        {/* Actions */}
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <button
                            onClick={() => viewChunks(s)}
                            title="Inspect text chunks"
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 4,
                              background: "#fff",
                              border: `1px solid ${C.border}`,
                              borderRadius: 6,
                              padding: "5px 9px",
                              fontFamily: FONT_BODY,
                              fontSize: 11.5,
                              color: C.slate,
                              cursor: "pointer"
                            }}
                          >
                            <Layers size={12} /> Chunks
                          </button>
                          
                          <button
                            onClick={() => resyncSource(s.id)}
                            disabled={isCrawling}
                            title="Re-crawl and update vector index"
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 4,
                              background: "#fff",
                              border: `1px solid ${C.border}`,
                              borderRadius: 6,
                              padding: "5px 9px",
                              fontFamily: FONT_BODY,
                              fontSize: 11.5,
                              color: C.slate,
                              cursor: isCrawling ? "default" : "pointer"
                            }}
                          >
                            <RefreshCw size={12} /> Re-crawl
                          </button>

                          <button
                            onClick={() => removeSource(s.id)}
                            title="Delete knowledge source"
                            style={{ background: "none", border: "none", cursor: "pointer", padding: "5px 6px", borderRadius: 6, color: C.slateLight }}
                            onMouseEnter={(e) => { e.currentTarget.style.color = "#dc2626"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.color = C.slateLight; }}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  {sources.length === 0 && (
                    <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.slateLight, padding: "28px 0", textAlign: "center", border: `1px dashed ${C.border}`, borderRadius: 10, background: "#fff" }}>
                      No knowledge sources yet — add your company website or objection playbook to activate RAG.
                    </div>
                  )}
                </div>

                {addingSource ? (
                  <div style={{ marginTop: 14, border: `1.5px solid ${C.cobalt}`, background: C.paper, borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
                    <div>
                      <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>
                        1. Select Source Format
                      </label>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {SOURCE_TYPES.map((st) => {
                          const Icon = st.icon;
                          const active = (newSource.type || "Website URL") === st.id;
                          return (
                            <button
                              key={st.id}
                              type="button"
                              onClick={() => setNewSource((n) => ({ ...n, type: st.id }))}
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 6,
                                padding: "7px 12px",
                                borderRadius: 8,
                                border: `1.5px solid ${active ? C.ink : C.border}`,
                                background: active ? C.ink : "#fff",
                                color: active ? "#fff" : C.textInk,
                                fontFamily: FONT_BODY,
                                fontSize: 12,
                                fontWeight: 600,
                                cursor: "pointer",
                                transition: "all 0.15s ease",
                                boxShadow: active ? "0 2px 6px rgba(0,0,0,0.08)" : "none"
                              }}
                            >
                              <Icon size={13} color={active ? "#fff" : C.slate} />
                              {st.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div>
                      <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>
                        2. Source Name / Identifier
                      </label>
                      <input
                        value={newSource.name}
                        onChange={(e) => setNewSource((n) => ({ ...n, name: e.target.value }))}
                        placeholder={newSource.type === "Website URL" ? "e.g. Main Company Website" : newSource.type === "Manual text" ? "e.g. Pricing Objection Playbook" : "e.g. Service Catalogue 2026"}
                        style={{ width: "100%", boxSizing: "border-box", padding: "8px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 12.5, outline: "none", background: "#fff" }}
                      />
                    </div>

                    <div>
                      <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>
                        3. {newSource.type === "Manual text" ? "Content / Script Notes" : newSource.type === "File upload" ? "File" : "URL / Document Path"}
                      </label>
                      {newSource.type === "File upload" ? (
                        <input
                          type="file"
                          aria-label="Knowledge file"
                          accept=".pdf,.docx,.txt,.md,.csv,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown,text/csv"
                          onChange={(e) => {
                            const file = e.target.files && e.target.files[0];
                            setUploadError(file && file.size > 10 * 1024 * 1024 ? "That file is over 10 MB." : "");
                            setNewSource((n) => ({ ...n, file: file || null, name: n.name || (file ? file.name.replace(/\.[^.]+$/, "") : "") }));
                          }}
                          style={{ width: "100%", boxSizing: "border-box", padding: "8px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 12.5, background: "#fff" }}
                        />
                      ) : newSource.type === "Manual text" ? (
                        <textarea
                          value={newSource.value}
                          onChange={(e) => setNewSource((n) => ({ ...n, value: e.target.value }))}
                          placeholder={SOURCE_TYPES.find((st) => st.id === newSource.type)?.placeholder}
                          rows={4}
                          style={{ width: "100%", boxSizing: "border-box", padding: "8px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 12.5, outline: "none", background: "#fff", resize: "vertical" }}
                        />
                      ) : (
                        <input
                          value={newSource.value}
                          onChange={(e) => setNewSource((n) => ({ ...n, value: e.target.value }))}
                          placeholder={SOURCE_TYPES.find((st) => st.id === (newSource.type || "Website URL"))?.placeholder}
                          style={{ width: "100%", boxSizing: "border-box", padding: "8px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 12.5, outline: "none", background: "#fff" }}
                        />
                      )}
                      <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.slateLight, marginTop: 4 }}>
                        {SOURCE_TYPES.find((st) => st.id === (newSource.type || "Website URL"))?.hint}
                      </div>
                      {uploadError && <div role="alert" style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.red, marginTop: 6 }}>{uploadError}</div>}
                    </div>

                    <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                      <button onClick={addSource} disabled={uploading} style={{ background: C.ink, color: "#fff", border: "none", borderRadius: 8, padding: "9px 20px", fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: uploading ? "wait" : "pointer", opacity: uploading ? 0.6 : 1 }}>
                        {newSource.type === "File upload" ? (uploading ? "Uploading…" : "Upload & index") : "Start Crawl & Ingest"}
                      </button>
                      <button onClick={() => setAddingSource(false)} style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 8, padding: "9px 14px", fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate, cursor: "pointer" }}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setAddingSource(true)}
                    style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 6, background: "none", border: `1px dashed ${C.border}`, borderRadius: 8, padding: "10px 14px", fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate, cursor: "pointer", width: "100%", justifyContent: "center" }}
                  >
                    <PlusCircle size={14} /> Add knowledge source to crawl
                  </button>
                )}
              </div>

              {/* Interactive RAG Vector Retrieval Tester */}
              <div style={{ background: C.paperCard, border: `1px solid ${C.border}`, borderRadius: 12, padding: 22 }}>
                <SectionIntro
                  icon={Sparkles}
                  title="Test AI knowledge retrieval (Semantic vector search)"
                  desc="Simulate a prospect asking a specific question. This runs real-time cosine vector matching against your stored chunks to verify what exact facts the AI retrieves on calls."
                />
                
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <input
                    value={testQuery}
                    onChange={(e) => setTestQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && runTestQuery()}
                    placeholder="e.g. What is your pricing structure? or Do you support CRM integration?"
                    style={{ flex: 1, padding: "9px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13, outline: "none", background: "#fff" }}
                  />
                  <button
                    onClick={runTestQuery}
                    disabled={testingQuery || !testQuery.trim()}
                    style={{
                      background: C.ink,
                      color: "#fff",
                      border: "none",
                      borderRadius: 8,
                      padding: "9px 20px",
                      fontFamily: FONT_BODY,
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: testingQuery ? "default" : "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6
                    }}
                  >
                    {testingQuery ? <RefreshCw size={13} style={{ animation: "spin 1.5s linear infinite" }} /> : <Search size={13} />}
                    Test Retrieval
                  </button>
                </div>

                {testResults && (
                  <div style={{ marginTop: 14, background: "#fff", border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                      <span style={{ fontFamily: FONT_BODY, fontSize: 12, fontWeight: 700, color: C.textInk }}>
                        Retrieved Chunks for: <span style={{ color: C.cobalt }}>"{testResults.query}"</span>
                      </span>
                      <span style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.slateLight }}>
                        {testResults.matches?.length || 0} matches found
                      </span>
                    </div>

                    {(!testResults.matches || testResults.matches.length === 0) ? (
                      <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.slateLight, padding: "10px 0" }}>
                        No vector chunks matched above the similarity threshold. Add more sources or re-crawl your website.
                      </div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        {testResults.matches.map((m, i) => (
                          <div key={m.id || i} style={{ background: C.paper, borderRadius: 8, padding: 10, border: `1px solid ${C.borderLight}` }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                              <span style={{ fontFamily: FONT_BODY, fontSize: 11.5, fontWeight: 700, color: C.textInk }}>
                                {m.title || "Knowledge Chunk"}
                              </span>
                              <span style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: "#15803d", background: "#dcfce7", padding: "1px 6px", borderRadius: 4 }}>
                                {Math.round((m.score || 0) * 100)}% Match
                              </span>
                            </div>
                            <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.textInk, lineHeight: 1.4, whiteSpace: "pre-wrap" }}>
                              {m.content}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Chunks Inspection Modal */}
              {activeChunkModal && (
                <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, padding: 20 }}>
                  <div style={{ background: "#fff", borderRadius: 12, maxWidth: 640, width: "100%", maxHeight: "80vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 25px -5px rgba(0,0,0,0.2)" }}>
                    <div style={{ padding: "16px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div>
                        <div style={{ fontFamily: FONT_BODY, fontSize: 14, fontWeight: 700, color: C.textInk }}>
                          Extracted Chunks: {activeChunkModal.source.name}
                        </div>
                        <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.slateLight }}>
                          {activeChunkModal.chunks.length} semantic passages indexed in pgvector
                        </div>
                      </div>
                      <button onClick={() => setActiveChunkModal(null)} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
                        <X size={18} color={C.slate} />
                      </button>
                    </div>

                    <div style={{ padding: 20, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12, flex: 1 }}>
                      {activeChunkModal.loading ? (
                        <div style={{ textAlign: "center", padding: 30, color: C.slate }}>Loading chunks...</div>
                      ) : activeChunkModal.chunks.length === 0 ? (
                        <div style={{ textAlign: "center", padding: 30, color: C.slateLight }}>
                          No chunks extracted yet. Click "Re-crawl" to process this source.
                        </div>
                      ) : (
                        activeChunkModal.chunks.map((chk, i) => (
                          <div key={chk.id || i} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 12, background: C.paper }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                              <span style={{ fontFamily: FONT_BODY, fontSize: 10.5, fontWeight: 800, color: C.slate, letterSpacing: "0.04em" }}>
                                CHUNK {String(i + 1).padStart(2, "0")} · {chk.content.length} chars
                              </span>
                              {chk.hasEmbedding && (
                                <span style={{ fontFamily: FONT_BODY, fontSize: 10, fontWeight: 700, color: "#15803d", background: "#dcfce7", padding: "1px 5px", borderRadius: 4 }}>
                                  384-dim Vector
                                </span>
                              )}
                            </div>
                            <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.textInk, lineHeight: 1.45, whiteSpace: "pre-wrap" }}>
                              {chk.content}
                            </div>
                          </div>
                        ))
                      )}
                    </div>

                    <div style={{ padding: "12px 20px", borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "flex-end" }}>
                      <button onClick={() => setActiveChunkModal(null)} style={{ background: C.ink, color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
                        Close
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div style={{ background: C.paperCard, border: `1px solid ${C.border}`, borderRadius: 12, padding: 22 }}>
                <SectionIntro icon={HelpCircle} title="Common questions & approved answers" desc="When a prospect asks something the AI hasn't heard before, it falls back to these — write answers the way you'd want a new hire to say them." />
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {faq.map((f) => (
                    <div key={f.id} style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                      <div style={{ display: "flex", gap: 8 }}>
                        <input value={f.q} onChange={(e) => updateFaq(f.id, "q", e.target.value)} placeholder="Question a prospect might ask" style={{ flex: 1, padding: "7px 10px", borderRadius: 7, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 12.5, outline: "none", fontWeight: 600 }} />
                        <button onClick={() => removeFaq(f.id)} style={{ background: "none", border: "none", cursor: "pointer" }}><Trash2 size={14} color={C.slateLight} /></button>
                      </div>
                      <textarea value={f.a} onChange={(e) => updateFaq(f.id, "a", e.target.value)} placeholder="Approved answer" style={{ padding: "7px 10px", borderRadius: 7, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 12.5, outline: "none", minHeight: 50, resize: "none" }} />
                    </div>
                  ))}
                </div>
                <button onClick={addFaq} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: `1px dashed ${C.border}`, borderRadius: 8, padding: "9px 12px", fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate, cursor: "pointer", width: "100%", justifyContent: "center", marginTop: 12 }}>
                  <PlusCircle size={13} /> Add a question
                </button>
              </div>

              {renderSaveBtn("Save knowledge & FAQs")}
            </div>
          )}

          {tab === "services" && (
            <div style={{ background: C.paperCard, border: `1px solid ${C.border}`, borderRadius: 12, padding: 22 }}>
              <SectionIntro icon={Package} title="Services & ideal customer" desc="What you're pitching, and who it's a good fit for — helps the AI tailor the pitch dynamically to each prospect's sector and size." />
              
              {services.length === 0 ? (
                <div style={{ textAlign: "center", padding: "36px 20px", border: `1px dashed ${C.border}`, borderRadius: 10, background: "#fff", color: C.slate, margin: "14px 0" }}>
                  <Package size={28} color={C.slateLight} style={{ margin: "0 auto 8px" }} />
                  <div style={{ fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, color: C.textInk }}>No services listed yet</div>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.slateLight, marginTop: 4 }}>Add what you offer so the voice AI can accurately pitch and answer prospect questions.</div>
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: 14, marginTop: 14 }}>
                  {services.map((s, idx) => (
                    <div
                      key={s.id}
                      style={{
                        background: "#fff",
                        border: `1px solid ${C.border}`,
                        borderRadius: 10,
                        padding: 14,
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                        boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
                        position: "relative"
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: `1px solid ${C.borderLight}`, paddingBottom: 8 }}>
                        <span style={{ fontFamily: FONT_BODY, fontSize: 10.5, fontWeight: 800, letterSpacing: "0.06em", color: C.slate, background: C.paper, padding: "2px 8px", borderRadius: 4 }}>
                          SERVICE {String(idx + 1).padStart(2, "0")}
                        </span>
                        <button
                          onClick={() => removeService(s.id)}
                          title="Remove service"
                          style={{
                            background: "none",
                            border: "none",
                            cursor: "pointer",
                            padding: "3px 6px",
                            borderRadius: 4,
                            display: "inline-flex",
                            alignItems: "center",
                            color: C.slateLight,
                            transition: "all 0.15s ease"
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.color = "#dc2626"; e.currentTarget.style.background = "#fef2f2"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.color = C.slateLight; e.currentTarget.style.background = "none"; }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>

                      <div>
                        <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.slate, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                          Service Name
                        </label>
                        <input
                          value={s.name}
                          onChange={(e) => updateService(s.id, "name", e.target.value)}
                          placeholder="e.g. AI Customer Support Automation"
                          style={{ width: "100%", boxSizing: "border-box", padding: "7px 10px", borderRadius: 7, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 12.5, outline: "none" }}
                        />
                      </div>

                      <div>
                        <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.slate, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                          Ideal Customer / Target
                        </label>
                        <input
                          value={s.ideal}
                          onChange={(e) => updateService(s.id, "ideal", e.target.value)}
                          placeholder="e.g. Mid-market SaaS ops teams 50-500 staff"
                          style={{ width: "100%", boxSizing: "border-box", padding: "7px 10px", borderRadius: 7, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 12.5, outline: "none" }}
                        />
                      </div>

                      <div>
                        <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.slate, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                          Description & Value Proposition
                        </label>
                        <textarea
                          value={s.desc}
                          onChange={(e) => updateService(s.id, "desc", e.target.value)}
                          placeholder="Short description of what it does, key ROI points, and deliverables..."
                          rows={3}
                          style={{ width: "100%", boxSizing: "border-box", padding: "7px 10px", borderRadius: 7, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 12.5, outline: "none", resize: "vertical" }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: "flex", gap: 10, marginTop: 14, alignItems: "center" }}>
                <button
                  onClick={addService}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    background: "#fff",
                    border: `1px dashed ${C.border}`,
                    borderRadius: 8,
                    padding: "9px 16px",
                    fontFamily: FONT_BODY,
                    fontSize: 12.5,
                    color: C.slate,
                    cursor: "pointer",
                    flex: 1,
                    justifyContent: "center",
                    transition: "all 0.15s ease"
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.ink; e.currentTarget.style.color = C.ink; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.slate; }}
                >
                  <PlusCircle size={14} /> Add another service
                </button>
                {renderSaveBtn("Save services")}
              </div>
            </div>
          )}

          {tab === "compliance" && (
            <div style={{ background: C.paperCard, border: `1px solid ${C.border}`, borderRadius: 12, padding: 22 }}>
              <SectionIntro icon={ShieldCheck} title="Compliance & legal" desc="Details needed for UK outbound-calling rules — shown to admins only, never spoken on calls." />
              <Field label="Registered legal company name" value={profile.legalName || ""} onChange={(v) => update("legalName", v)} placeholder="Legal entity name" />
              <Field label="ICO registration reference" value={profile.icoRef || ""} onChange={(v) => update("icoRef", v)} placeholder="ICO reference" />
              <Field label="Data protection contact" value={profile.dpoContact || ""} onChange={(v) => update("dpoContact", v)} placeholder="privacy@company.com" />
              <Field label="Do-not-call list handling notes" value={profile.dncNotes || ""} onChange={(v) => update("dncNotes", v)} placeholder="Opt-outs logged immediately and excluded from all future missions." textarea />
              {renderSaveBtn("Save changes")}
            </div>
          )}
        </div>
      </div>

      {saved && (
        <div style={{ position: "fixed", bottom: 24, right: 32, background: C.ink, color: "#fff", padding: "12px 18px", borderRadius: 10, fontFamily: FONT_BODY, fontSize: 12.5, display: "flex", alignItems: "center", gap: 10 }}>
          <CheckCircle2 size={15} color={C.teal} /> Saved — used on all future calls
        </div>
      )}

      {unsavedModalTarget && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 100000,
            background: "rgba(15, 23, 42, 0.65)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
          onClick={handleCancelLeave}
        >
          <div
            style={{
              background: "#ffffff",
              borderRadius: 16,
              width: "100%",
              maxWidth: 460,
              boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(226, 232, 240, 0.8)",
              padding: 24,
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
              <div
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 12,
                  background: "#FEF3C7",
                  border: "1px solid #FDE68A",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  color: "#D97706",
                }}
              >
                <AlertTriangle size={22} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17, color: "#0F172A", lineHeight: 1.3 }}>
                  Unsaved changes
                </div>
                <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: "#475569", marginTop: 6, lineHeight: 1.5 }}>
                  You have unsaved changes on this page. If you leave now without saving, your recent edits will be lost.
                </div>
              </div>
              <button
                type="button"
                onClick={handleCancelLeave}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#94A3B8",
                  cursor: "pointer",
                  padding: 4,
                  borderRadius: 6,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <X size={18} />
              </button>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                alignItems: "center",
                gap: 8,
                marginTop: 8,
                paddingTop: 16,
                borderTop: "1px solid #F1F5F9",
              }}
            >
              <button
                type="button"
                onClick={handleCancelLeave}
                style={{
                  padding: "8px 14px",
                  borderRadius: 8,
                  border: "1px solid #E2E8F0",
                  background: "#ffffff",
                  color: "#475569",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: FONT_BODY,
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmLeave}
                style={{
                  padding: "8px 14px",
                  borderRadius: 8,
                  border: "1px solid #FCA5A5",
                  background: "#FEF2F2",
                  color: "#DC2626",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: FONT_BODY,
                }}
              >
                Leave without saving
              </button>
              <button
                type="button"
                onClick={handleSaveAndLeave}
                disabled={saving}
                style={{
                  padding: "8px 18px",
                  borderRadius: 8,
                  border: "none",
                  background: "linear-gradient(135deg, #2a47ae 0%, #1a2d7a 100%)",
                  color: "#ffffff",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: saving ? "wait" : "pointer",
                  fontFamily: FONT_BODY,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  boxShadow: "0 4px 12px rgba(42, 71, 174, 0.25)",
                }}
              >
                {saving ? "Saving..." : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ---------------------------------- connections & key validator ---------------------------------- */
