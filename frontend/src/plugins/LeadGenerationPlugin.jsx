import React, { useState } from "react";
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
  Tag
} from "lucide-react";
import { C, FONT_DISPLAY, FONT_BODY, FONT_MONO, HUB_PAPER, initialsFromName } from "../tokens";

const INITIAL_DUMMY_LEADS = [
  {
    id: "lead_1",
    companyName: "Apex Freight Logistics Inc.",
    domain: "apexfreight.com",
    website: "https://apexfreight.com",
    industry: "Logistics & Fleet",
    region: "Dallas, Texas (US)",
    employees: "85 employees",
    decisionMaker: "Marcus Vance",
    title: "VP of Fleet Operations",
    phone: "+1 (214) 555-0182",
    email: "m.vance@apexfreight.com",
    matchScore: 98,
    status: "new",
    openingHook: "Expanding Austin & Dallas distribution depots. High dispatch friction; prime fit for automated voice alerts & status check-ins.",
    techStack: ["Fleetio", "McLeod Software", "QuickBooks Enterprise"],
    revenueEst: "$18M/yr",
    tags: ["High Intent", "Verified Phone", "Fleet Expansion"]
  },
  {
    id: "lead_2",
    companyName: "CloudScale Systems Ltd",
    domain: "cloudscale.io",
    website: "https://cloudscale.io",
    industry: "B2B SaaS / DevOps",
    region: "London (UK)",
    employees: "45 employees",
    decisionMaker: "Sarah Lindqvist",
    title: "Chief Operating Officer",
    phone: "+44 20 7946 0921",
    email: "s.lindqvist@cloudscale.io",
    matchScore: 95,
    status: "new",
    openingHook: "Announced Series A funding last month. Scaling customer onboarding team; pitch automated meeting qualification and scheduled follow-ups.",
    techStack: ["HubSpot", "Slack", "Stripe", "AWS"],
    revenueEst: "£6.5M/yr",
    tags: ["Funded", "Tech Forward", "UK Market"]
  },
  {
    id: "lead_3",
    companyName: "Beacon Health Diagnostics",
    domain: "beaconhealth.org",
    website: "https://beaconhealth.org",
    industry: "Healthcare & Clinics",
    region: "Chicago, Illinois (US)",
    employees: "120 employees",
    decisionMaker: "Dr. Arthur Pendelton",
    title: "Director of Clinical Operations",
    phone: "+1 (312) 555-0199",
    email: "a.pendelton@beaconhealth.org",
    matchScore: 93,
    status: "new",
    openingHook: "High no-show rate on specialty ultrasound appointments. Looking for HIPAA-compliant reminder workflows.",
    techStack: ["Epic EHR", "AthenaHealth", "Twilio SMS"],
    revenueEst: "$24M/yr",
    tags: ["High Volume", "Appointment Heavy"]
  },
  {
    id: "lead_4",
    companyName: "Vanguard Precision Manufacturing",
    domain: "vanguardprecision.com",
    website: "https://vanguardprecision.com",
    industry: "Industrial Manufacturing",
    region: "Detroit, Michigan (US)",
    employees: "210 employees",
    decisionMaker: "Elena Rostova",
    title: "Head of Operations & Supply",
    phone: "+1 (313) 555-0144",
    email: "elena.r@vanguardprecision.com",
    matchScore: 89,
    status: "new",
    openingHook: "Supplier delays causing shift disruptions on CNC floor. Seeking automated real-time dispatch check-ins.",
    techStack: ["SAP S/4HANA", "Plex MES", "Microsoft Teams"],
    revenueEst: "$42M/yr",
    tags: ["Enterprise", "Supply Chain"]
  },
  {
    id: "lead_5",
    companyName: "Kensington Wealth Partners",
    domain: "kensingtonwealth.co.uk",
    website: "https://kensingtonwealth.co.uk",
    industry: "Financial Advisory",
    region: "Edinburgh (UK)",
    employees: "35 employees",
    decisionMaker: "Julian Kensington",
    title: "Managing Partner",
    phone: "+44 131 496 0882",
    email: "j.kensington@kensingtonwealth.co.uk",
    matchScore: 88,
    status: "new",
    openingHook: "Advisors spend 15+ hrs/week rescheduling client portfolio reviews. High willingness to adopt AI scheduling.",
    techStack: ["Salesforce Financial Cloud", "Calendly Enterprise"],
    revenueEst: "£9M/yr",
    tags: ["High Ticket", "HNW Clients"]
  },
  {
    id: "lead_6",
    companyName: "Summit Horizon Solar",
    domain: "summithorizonsolar.com",
    website: "https://summithorizonsolar.com",
    industry: "Renewable Energy",
    region: "Denver, Colorado (US)",
    employees: "60 employees",
    decisionMaker: "Liam Thorne",
    title: "VP of Field Projects",
    phone: "+1 (303) 555-0167",
    email: "lthorne@summithorizonsolar.com",
    matchScore: 87,
    status: "new",
    openingHook: "Rapid residential solar boom. Field installation crews missing appointment site verifications.",
    techStack: ["JobNimbus", "Zoho CRM", "Google Maps Platform"],
    revenueEst: "$14M/yr",
    tags: ["High Growth", "Clean Energy"]
  }
];

export default function LeadGenerationPlugin({
  operator,
  onBackToHub,
  onLogout,
  profile,
  commonAi,
}) {
  const [view, setView] = useState("scout"); // "scout" | "accounts" | "contacts" | "dossiers" | "import_export"
  const [leads, setLeads] = useState(INITIAL_DUMMY_LEADS);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIndustry, setSelectedIndustry] = useState("all");
  const [isSearching, setIsSearching] = useState(false);
  const [selectedLead, setSelectedLead] = useState(null);
  const [toastMessage, setToastMessage] = useState(null);
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

  const handleSimulatedSearch = (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setIsSearching(true);

    setTimeout(() => {
      const queryName = searchQuery.split(" ")[0] || "Target";
      const newLead = {
        id: "lead_" + Date.now(),
        companyName: `${queryName} Dynamics Global`,
        domain: `${queryName.toLowerCase()}dynamics.com`,
        website: `https://${queryName.toLowerCase()}dynamics.com`,
        industry: selectedIndustry !== "all" ? selectedIndustry : "B2B Technology",
        region: "United States / Remote",
        employees: "50-100 employees",
        decisionMaker: "Alex Mercer",
        title: "VP of Operations",
        phone: "+1 (800) 555-0149",
        email: `a.mercer@${queryName.toLowerCase()}dynamics.com`,
        matchScore: Math.floor(Math.random() * 8) + 91,
        status: "new",
        openingHook: `Actively researching operations solutions for "${searchQuery}". High match score based on current market expansion.`,
        techStack: ["HubSpot", "Google Workspace", "PostgreSQL"],
        revenueEst: "$10M - $25M",
        tags: ["Live Web Discovery", "High Fit"]
      };

      setLeads((prev) => [newLead, ...prev]);
      setIsSearching(false);
      showToast(`AI discovered and enriched 1 new high-intent account for "${searchQuery}"!`);
    }, 1200);
  };

  const handleToggleSelect = (id) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
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
    { id: "scout", label: "AI Lead Scout", icon: Sparkles, count: "Live" },
    { id: "accounts", label: "Saved Accounts", icon: Building2, count: leads.length },
    { id: "contacts", label: "Decision Makers", icon: Users, count: leads.length },
    { id: "dossiers", label: "Account Dossiers", icon: FileText },
    { id: "import_export", label: "Import & Export", icon: FileSpreadsheet },
  ];

  const viewTitles = {
    scout: { title: "AI Lead Scout", desc: "Discover qualified target accounts through autonomous live web search & market crawling." },
    accounts: { title: "Saved Target Accounts", desc: "Manage qualified company pipeline, operational metrics, and review statuses." },
    contacts: { title: "Verified Decision Makers", desc: "Direct phone numbers, email addresses, and executive titles for key buyers." },
    dossiers: { title: "Intelligence Dossiers", desc: "Deep operational briefings, verified tech stacks, and personalized conversation angles." },
    import_export: { title: "Import & Export", desc: "Bulk CSV upload, data hygiene verification, and account list export." },
  };

  return (
    <div style={{ display: "flex", height: "100vh", background: HUB_PAPER, fontFamily: FONT_BODY, overflow: "hidden" }}>
      
      {/* ----------------- LEFT DARK SIDEBAR (MATCHING OTHER PLUGINS) ----------------- */}
      <div
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

        {/* Back to Workspace button */}
        {onBackToHub && (
          <button
            onClick={onBackToHub}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              margin: "0 4px 16px 4px",
              padding: "8px 10px",
              borderRadius: 8,
              border: `1px solid ${C.inkLine}`,
              background: "transparent",
              color: "#C8CCD6",
              fontFamily: FONT_BODY,
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
          >
            <ChevronLeft size={14} /> Back to Plugins
          </button>
        )}

        {/* Navigation items */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = view === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setView(item.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "9px 10px",
                  borderRadius: 8,
                  border: "none",
                  cursor: "pointer",
                  background: active ? "rgba(255,255,255,0.09)" : "transparent",
                  color: active ? "#fff" : "#9AA0AE",
                  fontFamily: FONT_BODY,
                  fontSize: 13.5,
                  fontWeight: active ? 600 : 500,
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
        <div style={{ marginTop: "auto", padding: "12px 10px", borderTop: `1px solid ${C.inkLine}` }}>
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
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, height: "100vh" }}>
        
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
          
          {/* VIEW 1: AI LEAD SCOUT */}
          {view === "scout" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              
              {/* Search Hero Card */}
              <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 14, padding: "20px 24px", boxShadow: "0 2px 8px rgba(0,0,0,0.03)" }}>
                <form onSubmit={handleSimulatedSearch} style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <div style={{ position: "relative", flex: 1 }}>
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

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
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
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
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
              <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
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
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
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

                  <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 14 }}>
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
                <button
                  onClick={() => showToast("CSV upload simulator: Ready to map custom columns.")}
                  style={{ marginTop: 16, padding: "9px 20px", borderRadius: 8, background: C.ink, color: "#fff", border: "none", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}
                >
                  Browse Files
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
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
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
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
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
