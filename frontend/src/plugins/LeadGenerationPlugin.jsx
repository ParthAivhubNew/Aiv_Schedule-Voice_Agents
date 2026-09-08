import React, { useState } from "react";
import {
  Search,
  Sparkles,
  Building2,
  Phone,
  Mail,
  ExternalLink,
  ChevronRight,
  Filter,
  Download,
  Users,
  CheckCircle2,
  TrendingUp,
  LayoutGrid,
  Send,
  PhoneCall,
  CalendarDays,
  Bot,
  RefreshCw,
  Plus,
  ArrowRight,
  SlidersHorizontal,
  FileSpreadsheet,
  Check
} from "lucide-react";
import { C, FONT_DISPLAY, FONT_BODY, FONT_MONO, HUB_PAPER } from "../tokens";

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
    tags: ["High Value", "Urgent Need", "Verified Phone"]
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
    openingHook: "Shift transitions currently recorded via manual whiteboards. Needs automated voice notices for shift supervisors.",
    techStack: ["SAP S/4HANA", "Microsoft Teams"],
    revenueEst: "$42M/yr",
    tags: ["Enterprise", "Midwest Hub"]
  },
  {
    id: "lead_5",
    companyName: "Kensington Capital Partners",
    domain: "kensingtoncap.co.uk",
    website: "https://kensingtoncap.co.uk",
    industry: "Commercial Finance",
    region: "Mayfair, London (UK)",
    employees: "30 employees",
    decisionMaker: "James Whitfield",
    title: "Managing Partner",
    phone: "+44 20 7946 0883",
    email: "j.whitfield@kensingtoncap.co.uk",
    matchScore: 94,
    status: "new",
    openingHook: "Heavy deal intake flow requiring preliminary financial qualification calls before partner review.",
    techStack: ["Salesforce Financial Cloud", "DocuSign", "Bloomberg"],
    revenueEst: "£14M/yr",
    tags: ["High AOV", "Executive Buyer"]
  },
  {
    id: "lead_6",
    companyName: "Summit Horizon Solar",
    domain: "summithorizon.com",
    website: "https://summithorizon.com",
    industry: "Renewable Energy",
    region: "Phoenix, Arizona (US)",
    employees: "65 employees",
    decisionMaker: "Chloe Hernandez",
    title: "VP of Business Development",
    phone: "+1 (602) 555-0177",
    email: "chloe@summithorizon.com",
    matchScore: 91,
    status: "new",
    openingHook: "Solar inbound web leads dropping after 15 minutes of non-response. Immediate voice callback agent will double conversion.",
    techStack: ["Zoho CRM", "Podium", "Zapier"],
    revenueEst: "$12M/yr",
    tags: ["Speed to Lead", "Fast Sales Cycle"]
  }
];

export default function LeadGenerationPlugin({
  operator,
  onBackToHub,
  onLogout,
  profile,
  commonAi,
  onOpenCommonAi,
  onNavigateToPlugin,
  onPushToEmail,
  onPushToVoice
}) {
  const [leads, setLeads] = useState(INITIAL_DUMMY_LEADS);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIndustry, setSelectedIndustry] = useState("all");
  const [isSearching, setIsSearching] = useState(false);
  const [selectedLead, setSelectedLead] = useState(null);
  const [toastMessage, setToastMessage] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());

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
        openingHook: `Actively researching automation solutions for "${searchQuery}". Match score high based on recent hiring signals.`,
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

  const handlePushSelectedToEmail = () => {
    const list = leads.filter((l) => selectedIds.has(l.id));
    const targetList = list.length ? list : leads.slice(0, 3);
    if (onPushToEmail) {
      onPushToEmail(targetList);
      showToast(`Pushed ${targetList.length} leads to 3. Email Generation & Dispatch!`);
    }
  };

  const handlePushSelectedToVoice = () => {
    const list = leads.filter((l) => selectedIds.has(l.id));
    const targetList = list.length ? list : leads.slice(0, 3);
    if (onPushToVoice) {
      onPushToVoice(targetList);
      showToast(`Pushed ${targetList.length} leads to 4. AI Voice Calling Assistant!`);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: HUB_PAPER, fontFamily: FONT_BODY, display: "flex", flexDirection: "column" }}>
      {/* Top Bar */}
      <header
        style={{
          background: "#fff",
          borderBottom: `1px solid ${C.border}`,
          padding: "14px 28px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between"
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {onBackToHub && (
            <button
              onClick={onBackToHub}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 12px",
                borderRadius: 8,
                border: `1px solid ${C.border}`,
                background: "#fff",
                color: C.textInk,
                fontFamily: FONT_BODY,
                fontSize: 12.5,
                fontWeight: 600,
                cursor: "pointer"
              }}
            >
              <LayoutGrid size={14} /> All Plugins
            </button>
          )}

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span
              style={{
                width: 28,
                height: 28,
                borderRadius: 7,
                background: "linear-gradient(135deg, #1A56DB 0%, #2563EB 100%)",
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 800,
                fontSize: 14
              }}
            >
              1
            </span>
            <div>
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, color: C.ink }}>
                Lead Generation Plugin
              </div>
              <div style={{ fontSize: 11.5, color: C.slate }}>
                AI Web Prospecting, Account Scoring & Decision-Maker Discovery
              </div>
            </div>
          </div>
        </div>

        {/* Funnel Switcher Buttons */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ display: "flex", background: C.paperSoft, padding: 3, borderRadius: 8, gap: 4 }}>
            <button
              disabled
              style={{ padding: "5px 10px", borderRadius: 6, border: "none", background: "#fff", color: "#1A56DB", fontWeight: 700, fontSize: 11.5, boxShadow: "0 1px 2px rgba(0,0,0,0.06)" }}
            >
              1. Lead Gen
            </button>
            <button
              onClick={() => onNavigateToPlugin && onNavigateToPlugin("scheduler")}
              style={{ padding: "5px 10px", borderRadius: 6, border: "none", background: "transparent", color: C.slate, fontWeight: 600, fontSize: 11.5, cursor: "pointer" }}
            >
              2. Post Scheduler
            </button>
            <button
              onClick={() => onNavigateToPlugin && onNavigateToPlugin("emailoutreach")}
              style={{ padding: "5px 10px", borderRadius: 6, border: "none", background: "transparent", color: C.slate, fontWeight: 600, fontSize: 11.5, cursor: "pointer" }}
            >
              3. Email Dispatch
            </button>
            <button
              onClick={() => onNavigateToPlugin && onNavigateToPlugin("voice")}
              style={{ padding: "5px 10px", borderRadius: 6, border: "none", background: "transparent", color: C.slate, fontWeight: 600, fontSize: 11.5, cursor: "pointer" }}
            >
              4. Voice Assistant
            </button>
          </div>

          <button
            onClick={onOpenCommonAi}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "7px 12px",
              borderRadius: 8,
              border: `1px solid ${C.border}`,
              background: "#fff",
              color: C.ink,
              fontFamily: FONT_BODY,
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer"
            }}
          >
            <Sparkles size={14} color="#1A56DB" /> AI Config
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main style={{ flex: 1, padding: "28px 36px", overflowY: "auto", maxWidth: 1240, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
        
        {/* KPI Strip */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 24 }}>
          <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, padding: "16px 20px" }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: C.slate, textTransform: "uppercase" }}>Target Accounts Discovered</div>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 26, color: "#1A56DB", marginTop: 4 }}>
              {leads.length}
            </div>
            <div style={{ fontSize: 11, color: C.slateLight, marginTop: 2 }}>From live web search & company registers</div>
          </div>

          <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, padding: "16px 20px" }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: C.slate, textTransform: "uppercase" }}>Verified Decision-Makers</div>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 26, color: C.green, marginTop: 4 }}>
              {leads.length} <span style={{ fontSize: 13, color: C.slate, fontWeight: 500 }}>100% matched</span>
            </div>
            <div style={{ fontSize: 11, color: C.slateLight, marginTop: 2 }}>C-Suite, VP Ops & Directors</div>
          </div>

          <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, padding: "16px 20px" }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: C.slate, textTransform: "uppercase" }}>Ready for 3. Email Sequencer</div>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 26, color: "#7C3AED", marginTop: 4 }}>
              {leads.length}
            </div>
            <div style={{ fontSize: 11, color: C.slateLight, marginTop: 2 }}>Direct emails validated</div>
          </div>

          <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, padding: "16px 20px" }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: C.slate, textTransform: "uppercase" }}>Ready for 4. Voice Calls</div>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 26, color: C.cobalt, marginTop: 4 }}>
              {leads.length}
            </div>
            <div style={{ fontSize: 11, color: C.slateLight, marginTop: 2 }}>Direct lines & switchboards</div>
          </div>
        </div>

        {/* AI Discovery Search Control Box */}
        <div style={{ background: "#fff", border: `1.5px solid ${C.border}`, borderRadius: 14, padding: "20px 24px", marginBottom: 24, boxShadow: "0 2px 8px rgba(0,0,0,0.03)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Sparkles size={18} color="#1A56DB" />
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17, color: C.ink }}>
                AI Autonomous Account Prospecting
              </div>
            </div>
            <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 6, background: "#EFF6FF", color: "#1A56DB", border: "1px solid #BFDBFE" }}>
              Live Autonomous Web Scanner
            </span>
          </div>

          <form onSubmit={handleSimulatedSearch} style={{ display: "flex", gap: 10 }}>
            <div style={{ position: "relative", flex: 1 }}>
              <Search size={16} color={C.slateLight} style={{ position: "absolute", left: 14, top: 12 }} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="e.g. Find freight dispatchers in Texas, B2B SaaS in London, or commercial solar contractors..."
                disabled={isSearching}
                style={{
                  width: "100%",
                  padding: "10px 14px 10px 38px",
                  borderRadius: 9,
                  border: `1px solid ${C.border}`,
                  fontFamily: FONT_BODY,
                  fontSize: 13.5,
                  outline: "none",
                  boxSizing: "border-box"
                }}
              />
            </div>

            <select
              value={selectedIndustry}
              onChange={(e) => setSelectedIndustry(e.target.value)}
              style={{
                padding: "0 14px",
                borderRadius: 9,
                border: `1px solid ${C.border}`,
                background: "#fff",
                fontFamily: FONT_BODY,
                fontSize: 13,
                color: C.textInk,
                cursor: "pointer"
              }}
            >
              <option value="all">All Industries</option>
              <option value="Logistics & Fleet">Logistics & Fleet</option>
              <option value="B2B SaaS / DevOps">B2B SaaS / DevOps</option>
              <option value="Healthcare & Clinics">Healthcare & Clinics</option>
              <option value="Industrial Manufacturing">Manufacturing</option>
              <option value="Commercial Finance">Commercial Finance</option>
              <option value="Renewable Energy">Renewable Energy</option>
            </select>

            <button
              type="submit"
              disabled={isSearching || !searchQuery.trim()}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 20px",
                borderRadius: 9,
                background: "linear-gradient(135deg, #1A56DB 0%, #2563EB 100%)",
                color: "#fff",
                border: "none",
                fontFamily: FONT_BODY,
                fontSize: 13,
                fontWeight: 700,
                cursor: isSearching ? "wait" : "pointer",
                boxShadow: "0 2px 6px rgba(26,86,219,0.25)"
              }}
            >
              {isSearching ? <RefreshCw size={15} className="animate-spin" /> : <Sparkles size={15} />}
              {isSearching ? "Scouring Web..." : "Run AI Discovery"}
            </button>
          </form>
        </div>

        {/* Action Header & Leads Table */}
        <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden" }}>
          {/* Table Toolbar */}
          <div style={{ padding: "16px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", background: HUB_PAPER }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, color: C.ink }}>
                Discovered Accounts ({filteredLeads.length})
              </div>
              <span style={{ fontSize: 11.5, color: C.slate }}>
                {selectedIds.size > 0 ? `${selectedIds.size} accounts selected` : "Select accounts to hand off"}
              </span>
            </div>

            {/* Handoff Actions into Plugin 3 & 4 */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                onClick={handlePushSelectedToEmail}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "8px 14px",
                  borderRadius: 8,
                  background: "#7C3AED",
                  color: "#fff",
                  fontFamily: FONT_BODY,
                  fontSize: 12,
                  fontWeight: 600,
                  border: "none",
                  cursor: "pointer"
                }}
              >
                <Send size={13} /> Send to 3. Email Sequencer
              </button>

              <button
                onClick={handlePushSelectedToVoice}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "8px 14px",
                  borderRadius: 8,
                  background: C.ink,
                  color: "#fff",
                  fontFamily: FONT_BODY,
                  fontSize: 12,
                  fontWeight: 600,
                  border: "none",
                  cursor: "pointer"
                }}
              >
                <PhoneCall size={13} /> Send to 4. Voice Dialer
              </button>
            </div>
          </div>

          {/* Table Rows */}
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#F8FAFC", borderBottom: `1px solid ${C.border}`, color: C.slate, fontSize: 11.5, textTransform: "uppercase", fontWeight: 700 }}>
                  <th style={{ padding: "12px 16px", width: 40 }}>
                    <input
                      type="checkbox"
                      checked={selectedIds.size === filteredLeads.length && filteredLeads.length > 0}
                      onChange={(e) => {
                        if (e.target.checked) setSelectedIds(new Set(filteredLeads.map((l) => l.id)));
                        else setSelectedIds(new Set());
                      }}
                    />
                  </th>
                  <th style={{ padding: "12px 16px" }}>Company & Industry</th>
                  <th style={{ padding: "12px 16px" }}>Decision-Maker</th>
                  <th style={{ padding: "12px 16px" }}>Verified Contact</th>
                  <th style={{ padding: "12px 16px" }}>AI Fit Score</th>
                  <th style={{ padding: "12px 16px" }}>Outreach Angle & Hook</th>
                  <th style={{ padding: "12px 16px", textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredLeads.map((lead) => {
                  const isChecked = selectedIds.has(lead.id);
                  return (
                    <tr
                      key={lead.id}
                      style={{
                        borderBottom: `1px solid ${C.border}`,
                        background: isChecked ? "#F0F7FF" : "#fff",
                        transition: "background 0.15s"
                      }}
                    >
                      <td style={{ padding: "14px 16px" }}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleToggleSelect(lead.id)}
                        />
                      </td>

                      <td style={{ padding: "14px 16px" }}>
                        <div style={{ fontWeight: 700, color: C.textInk, display: "flex", alignItems: "center", gap: 6 }}>
                          <Building2 size={14} color="#1A56DB" />
                          {lead.companyName}
                        </div>
                        <div style={{ fontSize: 11.5, color: C.slate, marginTop: 2, display: "flex", alignItems: "center", gap: 6 }}>
                          <span>{lead.industry}</span>
                          <span>•</span>
                          <span>{lead.region}</span>
                        </div>
                      </td>

                      <td style={{ padding: "14px 16px" }}>
                        <div style={{ fontWeight: 600, color: C.ink }}>{lead.decisionMaker}</div>
                        <div style={{ fontSize: 11.5, color: C.slate, marginTop: 1 }}>{lead.title}</div>
                      </td>

                      <td style={{ padding: "14px 16px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: C.ink }}>
                          <Phone size={12} color={C.green} /> {lead.phone}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: C.slate, marginTop: 3 }}>
                          <Mail size={12} color="#1A56DB" /> {lead.email}
                        </div>
                      </td>

                      <td style={{ padding: "14px 16px" }}>
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                            padding: "3px 8px",
                            borderRadius: 6,
                            background: lead.matchScore >= 90 ? "#DCFCE7" : "#FEF3C7",
                            color: lead.matchScore >= 90 ? "#166534" : "#92400E",
                            fontWeight: 700,
                            fontSize: 12
                          }}
                        >
                          <TrendingUp size={12} /> {lead.matchScore}% Fit
                        </span>
                      </td>

                      <td style={{ padding: "14px 16px", maxWidth: 280 }}>
                        <div style={{ fontSize: 11.5, color: C.textInk, lineHeight: 1.45, fontStyle: "italic" }}>
                          "{lead.openingHook}"
                        </div>
                      </td>

                      <td style={{ padding: "14px 16px", textAlign: "right" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6 }}>
                          <button
                            onClick={() => setSelectedLead(lead)}
                            title="Inspect Deep Dossier"
                            style={{
                              padding: "5px 9px",
                              borderRadius: 6,
                              border: `1px solid ${C.border}`,
                              background: "#fff",
                              color: C.textInk,
                              fontSize: 11.5,
                              fontWeight: 600,
                              cursor: "pointer"
                            }}
                          >
                            Dossier
                          </button>

                          <button
                            onClick={() => {
                              if (onPushToEmail) {
                                onPushToEmail([lead]);
                                showToast(`Queued ${lead.companyName} into Email Sequencer!`);
                              }
                            }}
                            title="Push to 3. Email Sequencer"
                            style={{
                              padding: "5px 8px",
                              borderRadius: 6,
                              background: "#7C3AED",
                              color: "#fff",
                              border: "none",
                              fontSize: 11.5,
                              fontWeight: 600,
                              cursor: "pointer"
                            }}
                          >
                            Email
                          </button>

                          <button
                            onClick={() => {
                              if (onPushToVoice) {
                                onPushToVoice([lead]);
                                showToast(`Queued ${lead.companyName} into Voice Assistant dialer!`);
                              }
                            }}
                            title="Push to 4. Voice Dialer"
                            style={{
                              padding: "5px 8px",
                              borderRadius: 6,
                              background: C.ink,
                              color: "#fff",
                              border: "none",
                              fontSize: 11.5,
                              fontWeight: 600,
                              cursor: "pointer"
                            }}
                          >
                            Call
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {/* Dossier Modal */}
      {selectedLead && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(18,20,28,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20 }}>
          <div style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 560, padding: 24, boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
              <div>
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "#1A56DB", background: "#EFF6FF", padding: "2px 8px", borderRadius: 4 }}>
                  AI Enriched Account Dossier
                </span>
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 20, color: C.ink, marginTop: 4 }}>
                  {selectedLead.companyName}
                </div>
                <a href={selectedLead.website} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: C.slate, display: "inline-flex", alignItems: "center", gap: 4, textDecoration: "none", marginTop: 2 }}>
                  {selectedLead.domain} <ExternalLink size={11} />
                </a>
              </div>
              <button onClick={() => setSelectedLead(null)} style={{ background: "none", border: "none", cursor: "pointer", color: C.slate, fontSize: 18, fontWeight: 700 }}>✕</button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, background: HUB_PAPER, padding: 14, borderRadius: 10, marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 11, color: C.slate, fontWeight: 600 }}>DECISION MAKER</div>
                <div style={{ fontWeight: 700, fontSize: 13, color: C.ink, marginTop: 2 }}>{selectedLead.decisionMaker}</div>
                <div style={{ fontSize: 11.5, color: C.slate }}>{selectedLead.title}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: C.slate, fontWeight: 600 }}>CONTACT CHANNELS</div>
                <div style={{ fontSize: 12, color: C.green, fontWeight: 600, marginTop: 2 }}>📞 {selectedLead.phone}</div>
                <div style={{ fontSize: 12, color: "#1A56DB", marginTop: 1 }}>✉️ {selectedLead.email}</div>
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.ink, marginBottom: 4 }}>AI Conversation Angle & Icebreaker</div>
              <div style={{ fontSize: 12.5, color: C.slate, background: "#F0F9FF", border: "1px solid #BAE6FD", padding: "10px 12px", borderRadius: 8, lineHeight: 1.5 }}>
                {selectedLead.openingHook}
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
              <div>
                <div style={{ fontSize: 11, color: C.slate, fontWeight: 600, marginBottom: 4 }}>DETECTED TECH STACK</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {selectedLead.techStack.map((t, idx) => (
                    <span key={idx} style={{ fontSize: 11, background: C.paperSoft, padding: "2px 7px", borderRadius: 4, color: C.textInk, fontWeight: 500 }}>
                      {t}
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: C.slate, fontWeight: 600, marginBottom: 4 }}>ESTIMATED ANNUAL REVENUE</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>{selectedLead.revenueEst}</div>
                <div style={{ fontSize: 11, color: C.slate }}>{selectedLead.employees}</div>
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                onClick={() => {
                  if (onPushToEmail) {
                    onPushToEmail([selectedLead]);
                    setSelectedLead(null);
                    showToast(`Queued into Email Sequencer!`);
                  }
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "9px 14px",
                  borderRadius: 8,
                  background: "#7C3AED",
                  color: "#fff",
                  border: "none",
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: "pointer"
                }}
              >
                <Send size={13} /> Send to Email Outreach
              </button>

              <button
                onClick={() => {
                  if (onPushToVoice) {
                    onPushToVoice([selectedLead]);
                    setSelectedLead(null);
                    showToast(`Queued into Voice Assistant dialer!`);
                  }
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "9px 14px",
                  borderRadius: 8,
                  background: C.ink,
                  color: "#fff",
                  border: "none",
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: "pointer"
                }}
              >
                <PhoneCall size={13} /> Start Voice Dial
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Toast */}
      {toastMessage && (
        <div style={{ position: "fixed", bottom: 24, right: 28, background: C.ink, color: "#fff", padding: "12px 20px", borderRadius: 10, fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.25)", zIndex: 1000 }}>
          <CheckCircle2 size={16} color={C.teal} /> {toastMessage}
        </div>
      )}
    </div>
  );
}
