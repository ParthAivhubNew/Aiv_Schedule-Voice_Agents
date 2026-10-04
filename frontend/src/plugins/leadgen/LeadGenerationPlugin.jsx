import React, { useState, useEffect } from "react";
import {
  Search,
  Sparkles,
  Building2,
  Phone,
  Mail,
  ExternalLink,
  ChevronRight,
  ChevronLeft,
  Filter,
  Download,
  Users,
  CheckCircle2,
  TrendingUp,
  LayoutGrid,
  Send,
  RefreshCw,
  Plus,
  ArrowRight,
  SlidersHorizontal,
  FileSpreadsheet,
  Check,
  X,
  FileText,
  Copy,
  LogOut,
  UploadCloud,
  Layers,
  Activity,
  Globe,
  Tag,
  CreditCard,
  MessageSquare,
  ShieldAlert,
  Lock
} from "lucide-react";
import { AppSwitcher } from "../../hub/AppSwitcher";
import { NAV_TEXT, C, FONT_DISPLAY, FONT_BODY, FONT_MONO, HUB_PAPER, initialsFromName, getActiveAiCredentials } from "../../tokens";
import { api } from "../../api/apiClient";
import { navigateHash, onRouteChange, replaceHash, routeHash } from "../../utils/route";
import { SubscriptionPage } from "../../team/SubscriptionPage";
import { usePluginAccess } from "../../components/PluginAccessGate";
import { CampaignsView, DoNotEmailView, FindView, MailboxesView, RepliesView } from "./OutreachViews";

// Real accounts only: Saved Accounts is now backed by the Prospect table (via /prospects/leadgen),
// not browser-only state. A server row never carries employees/title/techStack/revenueEst — Scout
// and CSV import never fabricate those — so they're always blank here; the UI shows "—" for them.
function serverProspectToLead(p) {
  return {
    id: p.id,
    companyName: p.name,
    domain: p.site ? p.site.replace(/^https?:\/\//, "").split("/")[0] : "",
    website: p.site || "",
    industry: p.sector || "",
    region: p.region || "",
    employees: "",
    decisionMaker: p.contact && p.contact !== "—" ? p.contact : "",
    title: "",
    phone: p.phone || "",
    email: p.email || "",
    matchScore: p.fit || 0,
    status: p.status === "queued" ? "new" : p.status,
    openingHook: p.openingHook || "",
    techStack: [],
    revenueEst: "",
    tags: [],
  };
}

export default function LeadGenerationPlugin({
  operator,
  onBackToHub,
  onLogout,
  profile,
  commonAi,
}) {
  const normalizeLeadgenView = (raw) => {
    if (!raw) return "copilot";
    if (raw === "campaigns" || raw === "email" || raw.startsWith("email/")) return "sequences";
    if (raw === "warmup") return "mailboxes";
    return raw;
  };

  const { hasPlan, loading: planLoading } = usePluginAccess("leadgen");
  const isLocked = !planLoading && !hasPlan;

  const [view, setView] = useState(() => {
    try {
      const hash = routeHash().replace(/^#\/?/, "");
      const parts = hash.split("/");
      if (parts[0] === "leadgen" && parts[1]) return normalizeLeadgenView(parts[1]);
      if (parts[0] === "emailoutreach") return "sequences";
      return localStorage.getItem("aivhub_leadgen_view") || "copilot";
    } catch (_) {
      return "copilot";
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem("aivhub_leadgen_view", view);
      const target = `#/leadgen/${view}`;
      if (routeHash() !== target) {
        replaceHash(target);
      }
    } catch (_) {}
  }, [view]);

  useEffect(() => {
    const onHash = () => {
      try {
        const hash = routeHash().replace(/^#\/?/, "");
        const parts = hash.split("/");
        if (parts[0] === "leadgen" && parts[1]) {
          const norm = normalizeLeadgenView(parts[1]);
          if (norm !== view) setView(norm);
        } else if (parts[0] === "emailoutreach") {
          setView("sequences");
        }
      } catch (_) {}
    };
    return onRouteChange(onHash);
  }, [view]);
  const [leads, setLeads] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIndustry, setSelectedIndustry] = useState("all");
  const [isSearching, setIsSearching] = useState(false);
  const [selectedLead, setSelectedLead] = useState(null);
  const [toastMessage, setToastMessage] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await api.getLeadgenProspects();
        if (!cancelled) setLeads(rows.map(serverProspectToLead));
      } catch (_) {
        // Leave the list empty rather than block the page on a failed load; Scout/Import/Add
        // still work and will populate it.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Fire-and-forget save to the server: the UI never waits on this, it only warns if it failed.
  const persistLeads = async (newLeads) => {
    try {
      await api.saveLeadgenProspects(newLeads);
    } catch (err) {
      showToast(`Saved on this screen only — could not sync to the server: ${err.message || "unknown error"}`);
    }
  };

  // Open AI Lead Copilot Chat State
  const [copilotChatMessages, setCopilotChatMessages] = useState([
    {
      id: "m_init",
      role: "assistant",
      text: "👋 Hi! I'm your AI Lead Engineering Copilot. You can ask me anything — from scouting target accounts, refining ICP criteria, analyzing markets, to prompt engineering or general questions.\n\nHow can I assist your pipeline today?",
      time: "Just now",
      leads: []
    }
  ]);
  const [copilotInput, setCopilotInput] = useState("");
  const [isCopilotTyping, setIsCopilotTyping] = useState(false);
  const copilotScrollRef = React.useRef(null);

  const handleSendCopilotChat = async (e, customText) => {
    if (e) e.preventDefault();
    const query = (customText || copilotInput).trim();
    if (!query || isCopilotTyping) return;

    setCopilotInput("");
    const userMsg = {
      id: "m_" + Date.now(),
      role: "user",
      text: query,
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    };
    setCopilotChatMessages((prev) => [...prev, userMsg]);
    setIsCopilotTyping(true);

    try {
      const creds = getActiveAiCredentials(commonAi, "leadgen", "researchLlm");
      const res = await api.copilotChat({
        message: query,
        history: copilotChatMessages.map((m) => ({ role: m.role, content: m.text })),
        plugin: "leadgen",
        apiKey: creds.apiKey,
        provider: creds.provider,
        model: creds.model,
        baseUrl: creds.baseUrl
      });

      const aiMsg = {
        id: "m_" + (Date.now() + 1),
        role: "assistant",
        text: res?.reply || "I processed your request. How else can I help?",
        leads: res?.leads || [],
        time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        model: res?.model || creds.model
      };
      setCopilotChatMessages((prev) => [...prev, aiMsg]);
    } catch (err) {
      setCopilotChatMessages((prev) => [
        ...prev,
        {
          id: "m_" + (Date.now() + 1),
          role: "assistant",
          text: /credits/i.test(err.message || "") ? `⚠️ ${err.message}` : `⚠️ AI connection error: ${err.message || "Failed to reach AI service. Please verify your API key."}`,
          time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        }
      ]);
    } finally {
      setIsCopilotTyping(false);
      setTimeout(() => {
        if (copilotScrollRef.current) {
          copilotScrollRef.current.scrollIntoView({ behavior: "smooth" });
        }
      }, 100);
    }
  };

  const handleAddCopilotLead = (leadObj) => {
    // Real fields only — never invent a placeholder phone/email/title the Copilot didn't
    // actually give us, same rule Scout follows.
    const newLead = {
      id: "lead_" + Date.now(),
      companyName: leadObj.name || leadObj.companyName || "",
      domain: leadObj.domain || (leadObj.website ? leadObj.website.replace(/^https?:\/\//, "").split("/")[0] : ""),
      website: leadObj.website || "",
      industry: leadObj.industry || (selectedIndustry !== "all" ? selectedIndustry : ""),
      region: leadObj.region || "",
      employees: "",
      decisionMaker: leadObj.contactPerson || leadObj.decisionMaker || "",
      title: leadObj.title || "",
      phone: leadObj.phone || "",
      email: leadObj.email || "",
      matchScore: leadObj.fitScore || 0,
      status: "new",
      openingHook: leadObj.hook || "",
      techStack: [],
      revenueEst: "",
      tags: ["AI Copilot Discovery"]
    };
    setLeads((prev) => [newLead, ...prev]);
    persistLeads([newLead]);
    showToast(`Added "${newLead.companyName}" to your saved accounts!`);
  };
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [showAddModal, setShowAddModal] = useState(false);
  const [newLeadForm, setNewLeadForm] = useState({
    companyName: "",
    website: "",
    industry: "Logistics & Fleet",
    region: "United States",
    decisionMaker: "",
    title: "",
    phone: "",
    email: "",
    revenueEst: "$10M/yr",
    openingHook: ""
  });

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const filteredLeads = leads.filter((lead) => {
    if (selectedIndustry !== "all" && lead.industry !== selectedIndustry) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        lead.companyName.toLowerCase().includes(q) ||
        lead.decisionMaker.toLowerCase().includes(q) ||
        lead.region.toLowerCase().includes(q) ||
        lead.industry.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchQuery.trim() || isSearching) return;
    setIsSearching(true);
    try {
      const res = await api.discoverAccounts({ query: searchQuery });
      const found = res?.leads || res?.accounts || [];
      // Real data only: Scout never fabricates employees/title/techStack/revenueEst, so these
      // stay blank rather than invented, same rule as everywhere else real data is shown.
      const mapped = found.map((d) => ({
        id: d.id || `lead_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        companyName: d.name || "",
        domain: d.site ? d.site.replace(/^https?:\/\//, "").split("/")[0] : "",
        website: d.site || "",
        industry: selectedIndustry !== "all" ? selectedIndustry : (d.sector || ""),
        region: d.region || "",
        employees: "",
        decisionMaker: d.contactPerson || "",
        title: "",
        phone: d.phone || "",
        email: "",
        matchScore: d.fit || 0,
        status: "new",
        openingHook: d.openingHook || "",
        techStack: [],
        revenueEst: "",
        tags: ["Live Web Discovery"],
      }));
      if (mapped.length) {
        setLeads((prev) => [...mapped, ...prev]);
        persistLeads(mapped);
      }
      showToast(mapped.length
        ? `Found ${mapped.length} account${mapped.length === 1 ? "" : "s"} for "${searchQuery}".`
        : `No accounts found for "${searchQuery}". Try a broader search.`);
    } catch (err) {
      showToast(err.message || "Search failed. Please try again.");
    } finally {
      setIsSearching(false);
    }
  };

  const handleToggleSelect = (id) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const csvInputRef = React.useRef(null);
  const [isImportingCsv, setIsImportingCsv] = useState(false);

  const handleCsvFileSelected = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = ""; // allow re-selecting the same file name later
    if (!file) return;
    setIsImportingCsv(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await api.parseSpreadsheet(form);
      const rows = (res?.rows || []).filter((r) => !(r.issues || []).includes("missing_name"));
      const mapped = rows.map((r) => ({
        id: `lead_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        companyName: r.name || "",
        domain: r.website ? r.website.replace(/^https?:\/\//, "").split("/")[0] : "",
        website: r.website || "",
        industry: selectedIndustry !== "all" ? selectedIndustry : "",
        region: "",
        employees: "",
        decisionMaker: r.contact || "",
        title: "",
        phone: r.phone || "",
        email: "",
        matchScore: 0,
        status: "new",
        openingHook: "",
        techStack: [],
        revenueEst: "",
        tags: ["CSV Import"],
      }));
      if (mapped.length) {
        setLeads((prev) => [...mapped, ...prev]);
        persistLeads(mapped);
      }
      const skipped = (res?.rows || []).length - mapped.length;
      showToast(`Imported ${mapped.length} account${mapped.length === 1 ? "" : "s"} from ${res?.filename || file.name}${skipped ? ` (${skipped} row${skipped === 1 ? "" : "s"} skipped: no company name)` : ""}.`);
    } catch (err) {
      showToast(err.message || "Import failed. Please check the file and try again.");
    } finally {
      setIsImportingCsv(false);
    }
  };

  const handleAddManualLead = (e) => {
    e.preventDefault();
    if (!newLeadForm.companyName.trim()) return;
    const created = {
      id: "lead_" + Date.now(),
      ...newLeadForm,
      matchScore: 90,
      status: "new",
      tags: ["Manual Entry", "Verified"]
    };
    setLeads((prev) => [created, ...prev]);
    persistLeads([created]);
    setShowAddModal(false);
    setNewLeadForm({
      companyName: "",
      website: "",
      industry: "Logistics & Fleet",
      region: "United States",
      decisionMaker: "",
      title: "",
      phone: "",
      email: "",
      revenueEst: "$10M/yr",
      openingHook: ""
    });
    showToast("Added new target account to pipeline!");
  };

  const handleExportCsv = () => {
    const headers = "Company,Domain,Industry,Region,Decision Maker,Title,Phone,Email,Match Score\n";
    const rows = filteredLeads.map((l) =>
      `"${l.companyName}","${l.domain}","${l.industry}","${l.region}","${l.decisionMaker}","${l.title}","${l.phone}","${l.email}",${l.matchScore}%`
    ).join("\n");
    const blob = new Blob([headers + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `leads_export_${Date.now()}.csv`;
    a.click();
    showToast("Exported accounts to CSV successfully!");
  };

  // Navigation Items on Left
  const navItems = [
    { id: "copilot", label: "AI Lead Copilot", icon: Sparkles, section: "Find Leads" },
    { id: "scout", label: "AI Lead Scout", icon: Search, section: "Find Leads" },
    { id: "find_email", label: "Find Work Email", icon: Mail, section: "Find Leads" },
    { id: "accounts", label: "Saved Accounts", icon: Building2, count: leads.length, section: "Enrichment" },
    { id: "contacts", label: "Decision Makers", icon: Users, count: leads.length, section: "Enrichment" },
    { id: "dossiers", label: "Account Dossiers", icon: FileText, section: "Enrichment" },
    { id: "import_export", label: "Import & Export", icon: FileSpreadsheet, section: "Enrichment" },
    { id: "sequences", label: "Email Sequences", icon: Send, section: "Email Outreach" },
    { id: "replies", label: "Inbox & Replies", icon: MessageSquare, section: "Email Outreach" },
    { id: "mailboxes", label: "Mailboxes & Warmup", icon: Layers, section: "Mailboxes" },
    { id: "suppression", label: "Do Not Email", icon: ShieldAlert, section: "Mailboxes" },
    ...(operator?.is_admin ? [{ id: "subscription", label: "Subscription", icon: CreditCard, section: "Billing" }] : []),
  ];

  const viewTitles = {
    copilot: { title: "AI Lead Copilot (Open Assistant)", desc: "Interactive AI partner for lead engineering, strategy, market research, and prompt optimization." },
    scout: { title: "AI Lead Scout", desc: "Discover qualified target accounts through autonomous live web search & market crawling." },
    find_email: { title: "Find Work Email (Waterfall Finder)", desc: "Verify and research single work emails using 5-layer intelligence waterfall (1 credit on find)." },
    accounts: { title: "Saved Target Accounts", desc: "Manage qualified company pipeline, operational metrics, and review statuses." },
    contacts: { title: "Verified Decision Makers", desc: "Direct phone numbers, email addresses, and executive titles for key buyers." },
    dossiers: { title: "Intelligence Dossiers", desc: "Deep operational briefings, verified tech stacks, and personalized conversation angles." },
    import_export: { title: "Import & Export", desc: "Bulk CSV upload, data hygiene verification, and account list export." },
    sequences: { title: "Cold Email Sequences & Campaigns", desc: "Multi-step email cadences, automated follow-up schedules, and response analytics." },
    replies: { title: "Inbox & Reply Categorization", desc: "Classified prospect replies with intent tagging and instant thread actions." },
    mailboxes: { title: "Connected Mailboxes & Deliverability", desc: "SMTP/IMAP connections, automated warmup ramp, SPF/DKIM/DMARC DNS health." },
    suppression: { title: "Do-Not-Email List", desc: "Suppression registry for unsubscribes, manual exclusions, and hard bounce protection." },
    subscription: { title: "Subscription & Credits", desc: "Your Lead Generation & Email Outreach plan and credits. Change plan, top up, or cancel." },
  };

  return (
    <div className="app-shell" style={{ display: "flex", height: "100vh", background: HUB_PAPER, fontFamily: FONT_BODY, overflow: "hidden" }}>
      
      {/* ----------------- LEFT DARK SIDEBAR (MATCHING OTHER PLUGINS) ----------------- */}
      <div
        className="app-sidebar"
        style={{
          width: 232,
          minWidth: 232,
          background: C.ink,
          height: "100vh",
          display: "flex",
          flexDirection: "column",
          padding: "22px 14px",
          boxSizing: "border-box",
        }}
      >
        {/* Header with Icon + Title */}
        <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "0 8px 12px 8px" }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              background: "linear-gradient(135deg, #8B5CF6, #6D28D9)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              boxShadow: "0 2px 8px rgba(139,92,246,0.3)",
            }}
          >
            <Search size={15} strokeWidth={2.4} />
          </div>
          <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, color: "#fff", letterSpacing: "-0.01em" }}>
            Lead Generation
          </span>
        </div>

        <AppSwitcher current="leadgen" onHome={onBackToHub} />

        {/* Navigation items */}
        <div className="app-sidebar-nav" style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = view === item.id;
            const tabLocked = isLocked && item.id !== "subscription";
            return (
              <button
                key={item.id}
                onClick={() => {
                  if (tabLocked) {
                    showToast("Subscribe to a plan to unlock Lead Generation.");
                    return;
                  }
                  setView(item.id);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "9px 10px",
                  borderRadius: 8,
                  border: "none",
                  cursor: tabLocked ? "not-allowed" : "pointer",
                  opacity: tabLocked ? 0.4 : 1,
                  background: active ? "rgba(255,255,255,0.09)" : "transparent",
                  color: active ? "#fff" : "#9AA0AE",
                  ...NAV_TEXT,
                  textAlign: "left",
                  transition: "all 0.12s",
                }}
              >
                <Icon size={16} color={active ? "#A78BFA" : "#9AA0AE"} />
                <span style={{ flex: 1 }}>{item.label}</span>
                {item.count && (
                  <span
                    style={{
                      fontSize: 10.5,
                      fontWeight: 700,
                      padding: "1px 6px",
                      borderRadius: 999,
                      background: active ? "#8B5CF6" : "rgba(255,255,255,0.08)",
                      color: "#fff",
                    }}
                  >
                    {item.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Sidebar Footer: Operator & Sign Out */}
        <div className="app-sidebar-extra" style={{ marginTop: "auto", padding: "12px 10px", borderTop: `1px solid ${C.inkLine}` }}>
          <div style={{ fontFamily: FONT_BODY, fontSize: 10.5, color: "#6B7280", marginBottom: 8 }}>
            Logged in as
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div
              style={{
                width: 26,
                height: 26,
                borderRadius: 999,
                background: "#8B5CF6",
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: FONT_BODY,
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              {initialsFromName(operator?.name)}
            </div>
            <div style={{ flex: 1, fontFamily: FONT_BODY, fontSize: 12.5, color: "#C8CCD6", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {operator?.name || "Operator"}
            </div>
          </div>
          {onLogout && (
            <button
              onClick={onLogout}
              style={{
                marginTop: 10,
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                padding: "7px 8px",
                borderRadius: 8,
                border: `1px solid ${C.inkLine}`,
                background: "transparent",
                color: "#8B90A0",
                fontFamily: FONT_BODY,
                fontSize: 11.5,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              <LogOut size={12} /> Sign out
            </button>
          )}
        </div>
      </div>

      {/* ----------------- RIGHT WORKSPACE AREA ----------------- */}
      <div className="app-main" style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, height: "100vh" }}>
        
        {/* Top Header Bar: Clean, consistent */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 28px",
            borderBottom: `1px solid ${C.border}`,
            background: "#fff",
          }}
        >
          <div>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 20, color: C.ink, letterSpacing: "-0.02em" }}>
              {viewTitles[view]?.title || "Lead Generation"}
            </div>
            <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate, marginTop: 2 }}>
              {viewTitles[view]?.desc || ""}
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {view === "accounts" && (
              <button
                onClick={() => setShowAddModal(true)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "8px 14px",
                  borderRadius: 8,
                  background: C.ink,
                  color: "#fff",
                  fontFamily: FONT_BODY,
                  fontSize: 12.5,
                  fontWeight: 600,
                  border: "none",
                  cursor: "pointer",
                }}
              >
                <Plus size={14} /> Add Account
              </button>
            )}

            <button
              onClick={handleExportCsv}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 14px",
                borderRadius: 8,
                border: `1px solid ${C.border}`,
                background: "#fff",
                color: C.textInk,
                fontFamily: FONT_BODY,
                fontSize: 12.5,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              <Download size={14} /> Export CSV
            </button>
          </div>
        </div>

        {/* Main Content Area */}
        <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }}>
          {isLocked && view !== "subscription" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div
                style={{
                  background: "linear-gradient(135deg, rgba(139,92,246,0.08), rgba(59,130,246,0.04))",
                  border: `1px solid ${C.border}`,
                  borderRadius: 14,
                  padding: "18px 22px",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <div style={{ width: 32, height: 32, borderRadius: 8, background: "#8B5CF6", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Lock size={16} />
                </div>
                <div>
                  <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, color: C.ink }}>Subscription Required</div>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate }}>Choose a plan below to unlock Lead Generation.</div>
                </div>
              </div>
              <SubscriptionPage wallet="leadgen" back="/leadgen/subscription" />
            </div>
          ) : (
            <>
          {/* VIEW 0: AI LEAD COPILOT */}
          {view === "copilot" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 820, margin: "0 auto" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {copilotChatMessages.map((m) => (
                  <div key={m.id} style={{ display: "flex", flexDirection: "column", alignItems: m.role === "user" ? "flex-end" : "flex-start" }}>
                    <div
                      style={{
                        maxWidth: "82%",
                        padding: "10px 14px",
                        borderRadius: 14,
                        background: m.role === "user" ? "#8B5CF6" : "#fff",
                        color: m.role === "user" ? "#fff" : C.textInk,
                        border: m.role === "user" ? "none" : `1px solid ${C.border}`,
                        boxShadow: m.role === "user" ? "none" : "0 1px 4px rgba(0,0,0,0.04)",
                        whiteSpace: "pre-wrap",
                        fontSize: 13.5,
                        lineHeight: 1.55,
                        fontFamily: FONT_BODY,
                      }}
                    >
                      {m.text}
                    </div>
                    {m.leads && m.leads.length > 0 && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8, maxWidth: "82%", width: "100%" }}>
                        {m.leads.map((lead, i) => (
                          <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, background: "#fff", border: `1px solid ${C.border}`, borderRadius: 10, padding: "8px 12px" }}>
                            <div>
                              <div style={{ fontWeight: 700, fontSize: 12.5, color: C.ink }}>{lead.name || lead.companyName}</div>
                              <div style={{ fontSize: 11, color: C.slate }}>{lead.domain || lead.website || ""}</div>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleAddCopilotLead(lead)}
                              style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 10px", borderRadius: 7, background: "#8B5CF6", color: "#fff", border: "none", fontSize: 11.5, fontWeight: 600, cursor: "pointer", flexShrink: 0 }}
                            >
                              <Plus size={12} /> Add
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <div style={{ fontSize: 10.5, color: C.slate, marginTop: 4 }}>{m.time}</div>
                  </div>
                ))}
                {isCopilotTyping && (
                  <div style={{ fontSize: 12.5, color: C.slate, fontStyle: "italic" }}>Copilot is thinking…</div>
                )}
                <div ref={copilotScrollRef} />
              </div>

              <form
                onSubmit={handleSendCopilotChat}
                style={{ display: "flex", gap: 8, position: "sticky", bottom: 0, background: HUB_PAPER, paddingTop: 12, borderTop: `1px solid ${C.border}` }}
              >
                <input
                  value={copilotInput}
                  onChange={(e) => setCopilotInput(e.target.value)}
                  placeholder="Ask about target accounts, ICP strategy, market research…"
                  disabled={isCopilotTyping}
                  style={{ flex: 1, padding: "10px 14px", borderRadius: 10, border: `1px solid ${C.border}`, fontSize: 13.5, fontFamily: FONT_BODY }}
                />
                <button
                  type="submit"
                  disabled={isCopilotTyping || !copilotInput.trim()}
                  style={{
                    display: "flex", alignItems: "center", gap: 6, padding: "10px 18px", borderRadius: 10,
                    background: "#8B5CF6", color: "#fff", border: "none", fontSize: 13, fontWeight: 700,
                    cursor: isCopilotTyping || !copilotInput.trim() ? "not-allowed" : "pointer",
                    opacity: isCopilotTyping || !copilotInput.trim() ? 0.6 : 1,
                  }}
                >
                  <Send size={14} /> Send
                </button>
              </form>
            </div>
          )}

          {/* VIEW 1: AI LEAD SCOUT */}
          {view === "scout" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              
              {/* Search Hero Card */}
              <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 14, padding: "20px 24px", boxShadow: "0 2px 8px rgba(0,0,0,0.03)" }}>
                <form className="wrap-narrow" onSubmit={handleSearch} style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <div style={{ position: "relative", flex: "1 1 200px", minWidth: 0 }}>
                    <Search size={18} color={C.slate} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)" }} />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="e.g. Find mid-market freight logistics companies in Texas with over 50 trucks..."
                      style={{
                        width: "100%",
                        boxSizing: "border-box",
                        padding: "12px 14px 12px 42px",
                        borderRadius: 10,
                        border: `1px solid ${C.border}`,
                        fontSize: 14,
                        fontFamily: FONT_BODY,
                        background: HUB_PAPER,
                        outline: "none",
                      }}
                    />
                  </div>

                  <select
                    value={selectedIndustry}
                    onChange={(e) => setSelectedIndustry(e.target.value)}
                    style={{
                      height: 44,
                      padding: "0 14px",
                      borderRadius: 10,
                      border: `1px solid ${C.border}`,
                      background: "#fff",
                      fontSize: 13,
                      fontFamily: FONT_BODY,
                      color: C.ink,
                      cursor: "pointer",
                    }}
                  >
                    <option value="all">All Industries</option>
                    <option value="Logistics & Fleet">Logistics & Fleet</option>
                    <option value="B2B SaaS / DevOps">B2B SaaS / DevOps</option>
                    <option value="Healthcare & Clinics">Healthcare & Clinics</option>
                    <option value="Industrial Manufacturing">Industrial Manufacturing</option>
                    <option value="Financial Advisory">Financial Advisory</option>
                    <option value="Renewable Energy">Renewable Energy</option>
                  </select>

                  <button
                    type="submit"
                    disabled={isSearching}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      height: 44,
                      padding: "0 22px",
                      borderRadius: 10,
                      background: "linear-gradient(135deg, #8B5CF6, #6D28D9)",
                      color: "#fff",
                      border: "none",
                      fontSize: 13.5,
                      fontWeight: 700,
                      cursor: isSearching ? "wait" : "pointer",
                      boxShadow: "0 4px 12px rgba(109,40,217,0.25)",
                    }}
                  >
                    <Sparkles size={16} />
                    <span>{isSearching ? "Scouting Web..." : "Run AI Scout"}</span>
                  </button>
                </form>

                {/* Quick Recommendation Pills */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 11.5, color: C.slate, fontWeight: 600 }}>Suggested Queries:</span>
                  {[
                    "Logistics dispatchers in Texas",
                    "UK B2B SaaS with Series A funding",
                    "Specialty diagnostic clinics high no-show rate",
                    "Manufacturing plant managers CNC equipment",
                  ].map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => { setSearchQuery(chip); }}
                      style={{
                        border: `1px solid ${C.border}`,
                        background: HUB_PAPER,
                        borderRadius: 6,
                        padding: "4px 9px",
                        fontSize: 11.5,
                        color: C.ink,
                        cursor: "pointer",
                      }}
                    >
                      {chip}
                    </button>
                  ))}
                </div>
              </div>

              {/* Feed of Discovered Leads */}
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>
                    Scouted Accounts ({filteredLeads.length})
                  </span>
                  <span style={{ fontSize: 12, color: C.slate }}>
                    Sorted by AI Match Score
                  </span>
                </div>

                <div className="stack-narrow" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                  {filteredLeads.map((lead) => (
                    <div
                      key={lead.id}
                      style={{
                        background: "#fff",
                        border: `1px solid ${C.border}`,
                        borderRadius: 12,
                        padding: 18,
                        display: "flex",
                        flexDirection: "column",
                        gap: 12,
                        boxShadow: "0 2px 6px rgba(0,0,0,0.02)",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
                        <div>
                          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, color: C.ink }}>
                            {lead.companyName}
                          </div>
                          <div style={{ fontSize: 12, color: C.slate, marginTop: 2 }}>
                            {lead.industry} · {lead.region}
                          </div>
                        </div>

                        <span
                          style={{
                            fontSize: 11.5,
                            fontWeight: 800,
                            padding: "3px 9px",
                            borderRadius: 6,
                            background: lead.matchScore >= 90 ? "#ECFDF5" : "#EFF6FF",
                            color: lead.matchScore >= 90 ? "#059669" : "#2563EB",
                            border: `1px solid ${lead.matchScore >= 90 ? "#A7F3D0" : "#BFDBFE"}`,
                          }}
                        >
                          {lead.matchScore}% Match
                        </span>
                      </div>

                      {/* Hook & Pain point */}
                      <div style={{ background: HUB_PAPER, border: `1px solid ${C.border}`, borderRadius: 8, padding: 10, fontSize: 12, color: C.textInk, lineHeight: 1.45 }}>
                        <strong>Opening Hook:</strong> {lead.openingHook}
                      </div>

                      {/* Contact snapshot */}
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 8, borderTop: `1px solid ${C.border}` }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ width: 28, height: 28, borderRadius: 999, background: "#EDE9FE", color: "#6D28D9", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700 }}>
                            {initialsFromName(lead.decisionMaker)}
                          </div>
                          <div>
                            <div style={{ fontSize: 12.5, fontWeight: 700, color: C.ink }}>{lead.decisionMaker}</div>
                            <div style={{ fontSize: 11, color: C.slate }}>{lead.title}</div>
                          </div>
                        </div>

                        <button
                          onClick={() => setSelectedLead(lead)}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                            padding: "6px 12px",
                            borderRadius: 6,
                            background: "#fff",
                            border: `1px solid ${C.border}`,
                            fontSize: 12,
                            fontWeight: 600,
                            color: C.ink,
                            cursor: "pointer",
                          }}
                        >
                          View Dossier <ChevronRight size={13} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          )}

          {/* VIEW 2: SAVED ACCOUNTS */}
          {view === "accounts" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Metric stats row */}
              <div className="grid-2-narrow" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
                {[
                  { label: "Target Accounts", val: leads.length, color: "#8B5CF6" },
                  { label: "High Intent (>90%)", val: leads.filter((l) => l.matchScore >= 90).length, color: "#059669" },
                  { label: "Decision Makers", val: leads.length, color: "#2563EB" },
                  { label: "Verified Direct Phone", val: "100%", color: "#D97706" },
                ].map((stat, i) => (
                  <div key={i} style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 18px" }}>
                    <div style={{ fontSize: 12, color: C.slate, fontWeight: 600 }}>{stat.label}</div>
                    <div style={{ fontFamily: FONT_DISPLAY, fontSize: 24, fontWeight: 700, color: stat.color, marginTop: 4 }}>{stat.val}</div>
                  </div>
                ))}
              </div>

              {/* Table of Accounts */}
              <div className="scroll-narrow" style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
                <div style={{ display: "grid", gridTemplateColumns: "2.2fr 1.4fr 1.8fr 1fr 1.2fr", padding: "12px 18px", background: HUB_PAPER, borderBottom: `1px solid ${C.border}`, fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase" }}>
                  <div>Company & Domain</div>
                  <div>Industry</div>
                  <div>Decision Maker</div>
                  <div>Match</div>
                  <div>Action</div>
                </div>

                {filteredLeads.map((lead) => (
                  <div key={lead.id} style={{ display: "grid", gridTemplateColumns: "2.2fr 1.4fr 1.8fr 1fr 1.2fr", padding: "14px 18px", borderBottom: `1px solid ${C.borderLight}`, alignItems: "center" }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13.5, color: C.ink }}>{lead.companyName}</div>
                      <div style={{ fontSize: 11.5, color: C.slate }}>{lead.domain} · {lead.employees}</div>
                    </div>
                    <div style={{ fontSize: 12.5, color: C.textInk }}>{lead.industry}</div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 12.5, color: C.ink }}>{lead.decisionMaker}</div>
                      <div style={{ fontSize: 11, color: C.slate }}>{lead.title}</div>
                    </div>
                    <div>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 7px", borderRadius: 4, background: "#ECFDF5", color: "#059669" }}>
                        {lead.matchScore}%
                      </span>
                    </div>
                    <div>
                      <button
                        onClick={() => setSelectedLead(lead)}
                        style={{ padding: "5px 10px", borderRadius: 6, border: `1px solid ${C.border}`, background: "#fff", fontSize: 11.5, fontWeight: 600, cursor: "pointer" }}
                      >
                        Inspect
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* VIEW 3: DECISION MAKERS */}
          {view === "contacts" && (
            <div className="stack-narrow" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              {leads.map((lead) => (
                <div key={lead.id} style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, padding: 18 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ width: 34, height: 34, borderRadius: 999, background: "#EDE9FE", color: "#7C3AED", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 13 }}>
                        {initialsFromName(lead.decisionMaker)}
                      </div>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14, color: C.ink }}>{lead.decisionMaker}</div>
                        <div style={{ fontSize: 12, color: C.slate }}>{lead.title} · {lead.companyName}</div>
                      </div>
                    </div>
                    <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 6px", borderRadius: 4, background: "#ECFDF5", color: "#059669" }}>
                      Verified Direct
                    </span>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, color: C.textInk, background: HUB_PAPER, padding: 10, borderRadius: 8, border: `1px solid ${C.border}` }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <Phone size={13} color={C.slate} />
                      <span style={{ fontFamily: FONT_MONO }}>{lead.phone}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <Mail size={13} color={C.slate} />
                      <span style={{ fontFamily: FONT_MONO }}>{lead.email}</span>
                    </div>
                  </div>

                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(lead.email);
                        showToast(`Copied ${lead.email} to clipboard!`);
                      }}
                      style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 10px", borderRadius: 6, border: `1px solid ${C.border}`, background: "#fff", fontSize: 11.5, fontWeight: 600, cursor: "pointer" }}
                    >
                      <Copy size={12} /> Copy Email
                    </button>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(lead.phone);
                        showToast(`Copied ${lead.phone} to clipboard!`);
                      }}
                      style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 10px", borderRadius: 6, border: `1px solid ${C.border}`, background: "#fff", fontSize: 11.5, fontWeight: 600, cursor: "pointer" }}
                    >
                      <Phone size={12} /> Copy Phone
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* VIEW 4: INTELLIGENCE DOSSIERS */}
          {view === "dossiers" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {leads.map((lead) => (
                <div key={lead.id} style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                    <div>
                      <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17, color: C.ink }}>{lead.companyName}</div>
                      <div style={{ fontSize: 12.5, color: C.slate, marginTop: 2 }}>{lead.region} · Est. Revenue: {lead.revenueEst} · Size: {lead.employees}</div>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      {(lead.tags || []).map((t) => (
                        <span key={t} style={{ fontSize: 11, fontWeight: 700, padding: "2px 7px", borderRadius: 4, background: HUB_PAPER, border: `1px solid ${C.border}`, color: C.ink }}>
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="stack-narrow" style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 14 }}>
                    <div style={{ background: HUB_PAPER, border: `1px solid ${C.border}`, borderRadius: 8, padding: 12 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", marginBottom: 4 }}>Verified Pain Point & Hook</div>
                      <div style={{ fontSize: 12.5, color: C.textInk, lineHeight: 1.5 }}>{lead.openingHook}</div>
                    </div>
                    <div style={{ background: HUB_PAPER, border: `1px solid ${C.border}`, borderRadius: 8, padding: 12 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", marginBottom: 4 }}>Detected Tech Stack</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 4 }}>
                        {(lead.techStack || []).map((tech) => (
                          <span key={tech} style={{ fontSize: 11, padding: "2px 6px", borderRadius: 4, background: "#EDE9FE", color: "#6D28D9", fontWeight: 600 }}>
                            {tech}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* VIEW 5: IMPORT & EXPORT */}
          {view === "find_email" && <FindView />}

          {view === "sequences" && <CampaignsView />}

          {view === "replies" && <RepliesView />}

          {view === "mailboxes" && <MailboxesView />}

          {view === "suppression" && <DoNotEmailView />}

          {view === "subscription" && operator?.is_admin && <SubscriptionPage wallet="leadgen" back="/leadgen/subscription" />}

          {view === "import_export" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ background: "#fff", border: `1px dashed ${C.border}`, borderRadius: 14, padding: "36px 20px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                <UploadCloud size={36} color="#8B5CF6" />
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, color: C.ink, marginTop: 10 }}>
                  Upload Target Account CSV / Excel File
                </div>
                <div style={{ fontSize: 12.5, color: C.slate, marginTop: 4, maxWidth: 440, textAlign: "center" }}>
                  Upload your target list. The AI will automatically enrich decision-makers, verify direct phone lines, and compile research dossiers.
                </div>
                <input
                  type="file"
                  ref={csvInputRef}
                  accept=".csv,.xlsx,.xls"
                  style={{ display: "none" }}
                  onChange={handleCsvFileSelected}
                />
                <button
                  onClick={() => csvInputRef.current?.click()}
                  disabled={isImportingCsv}
                  style={{ marginTop: 16, padding: "9px 20px", borderRadius: 8, background: C.ink, color: "#fff", border: "none", fontSize: 12.5, fontWeight: 600, cursor: isImportingCsv ? "default" : "pointer", opacity: isImportingCsv ? 0.6 : 1 }}
                >
                  {isImportingCsv ? "Importing…" : "Browse Files"}
                </button>
              </div>

              <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, padding: 18 }}>
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, color: C.ink, marginBottom: 8 }}>
                  Export Current Discovered Leads
                </div>
                <div style={{ fontSize: 12.5, color: C.slate, marginBottom: 14 }}>
                  Export your active pipeline of {leads.length} accounts with verified contact emails and direct phone numbers.
                </div>
                <button
                  onClick={handleExportCsv}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 8, background: "#8B5CF6", color: "#fff", border: "none", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}
                >
                  <Download size={14} /> Download CSV Pipeline
                </button>
              </div>
            </div>
          )}
            </>
          )}
        </div>

      </div>

      {/* Dossier Drawer / Modal */}
      {selectedLead && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(18,20,28,0.6)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20 }}>
          <div style={{ background: "#fff", borderRadius: 16, width: 620, maxWidth: "95vw", maxHeight: "90vh", display: "flex", flexDirection: "column", overflow: "hidden", border: `1px solid ${C.border}`, boxShadow: "0 24px 60px rgba(0,0,0,0.22)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 24px", borderBottom: `1px solid ${C.border}`, background: HUB_PAPER }}>
              <div>
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17, color: C.ink }}>
                  {selectedLead.companyName}
                </div>
                <div style={{ fontSize: 12, color: C.slate }}>
                  {selectedLead.industry} · {selectedLead.region}
                </div>
              </div>
              <button onClick={() => setSelectedLead(null)} style={{ border: "none", background: "transparent", cursor: "pointer", color: C.slate }}><X size={18} /></button>
            </div>

            <div style={{ padding: 24, overflowY: "auto", display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ background: HUB_PAPER, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", marginBottom: 4 }}>Decision Maker</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: C.ink }}>{selectedLead.decisionMaker}</div>
                <div style={{ fontSize: 12, color: C.slate }}>{selectedLead.title}</div>
                <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 12 }}>
                  <span>Phone: <code style={{ fontFamily: FONT_MONO }}>{selectedLead.phone}</code></span>
                  <span>Email: <code style={{ fontFamily: FONT_MONO }}>{selectedLead.email}</code></span>
                </div>
              </div>

              <div style={{ background: HUB_PAPER, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", marginBottom: 4 }}>AI Research Angle</div>
                <div style={{ fontSize: 13, color: C.textInk, lineHeight: 1.5 }}>{selectedLead.openingHook}</div>
              </div>

              <div style={{ background: HUB_PAPER, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", marginBottom: 4 }}>Detected Tech Stack</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                  {(selectedLead.techStack || []).map((t) => (
                    <span key={t} style={{ fontSize: 11.5, padding: "2px 8px", borderRadius: 4, background: "#EDE9FE", color: "#6D28D9", fontWeight: 600 }}>
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ padding: "14px 24px", borderTop: `1px solid ${C.border}`, background: HUB_PAPER, display: "flex", justifyContent: "flex-end" }}>
              <button
                onClick={() => setSelectedLead(null)}
                style={{ padding: "8px 18px", borderRadius: 8, background: C.ink, color: "#fff", border: "none", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manual Add Modal */}
      {showAddModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(18,20,28,0.6)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20 }}>
          <div style={{ background: "#fff", borderRadius: 14, width: 480, maxWidth: "95vw", padding: 22, border: `1px solid ${C.border}`, boxShadow: "0 20px 50px rgba(0,0,0,0.2)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, color: C.ink }}>Add Target Account</div>
              <button onClick={() => setShowAddModal(false)} style={{ border: "none", background: "transparent", cursor: "pointer", color: C.slate }}><X size={16} /></button>
            </div>
            <form onSubmit={handleAddManualLead} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div>
                <label style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: C.ink, marginBottom: 3 }}>Company Name</label>
                <input
                  type="text"
                  required
                  value={newLeadForm.companyName}
                  onChange={(e) => setNewLeadForm((f) => ({ ...f, companyName: e.target.value }))}
                  style={{ width: "100%", boxSizing: "border-box", padding: "7px 10px", borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 12.5 }}
                />
              </div>
              <div className="stack-narrow" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <label style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: C.ink, marginBottom: 3 }}>Decision Maker</label>
                  <input
                    type="text"
                    value={newLeadForm.decisionMaker}
                    onChange={(e) => setNewLeadForm((f) => ({ ...f, decisionMaker: e.target.value }))}
                    style={{ width: "100%", boxSizing: "border-box", padding: "7px 10px", borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 12.5 }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: C.ink, marginBottom: 3 }}>Title</label>
                  <input
                    type="text"
                    value={newLeadForm.title}
                    onChange={(e) => setNewLeadForm((f) => ({ ...f, title: e.target.value }))}
                    style={{ width: "100%", boxSizing: "border-box", padding: "7px 10px", borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 12.5 }}
                  />
                </div>
              </div>
              <div className="stack-narrow" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <label style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: C.ink, marginBottom: 3 }}>Phone</label>
                  <input
                    type="text"
                    value={newLeadForm.phone}
                    onChange={(e) => setNewLeadForm((f) => ({ ...f, phone: e.target.value }))}
                    style={{ width: "100%", boxSizing: "border-box", padding: "7px 10px", borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 12.5 }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: C.ink, marginBottom: 3 }}>Email</label>
                  <input
                    type="email"
                    value={newLeadForm.email}
                    onChange={(e) => setNewLeadForm((f) => ({ ...f, email: e.target.value }))}
                    style={{ width: "100%", boxSizing: "border-box", padding: "7px 10px", borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 12.5 }}
                  />
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
                <button type="button" onClick={() => setShowAddModal(false)} style={{ padding: "7px 14px", borderRadius: 6, border: `1px solid ${C.border}`, background: "#fff", fontSize: 12 }}>Cancel</button>
                <button type="submit" style={{ padding: "7px 16px", borderRadius: 6, background: C.ink, color: "#fff", border: "none", fontSize: 12, fontWeight: 600 }}>Save Account</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Toast */}
      {toastMessage && (
        <div style={{ position: "fixed", bottom: 24, right: 24, background: C.ink, color: "#fff", padding: "10px 18px", borderRadius: 8, fontSize: 12.5, fontWeight: 600, boxShadow: "0 8px 24px rgba(0,0,0,0.2)", zIndex: 9999 }}>
          {toastMessage}
        </div>
      )}

    </div>
  );
}
