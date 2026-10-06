import React, { useState, useEffect } from "react";
import {
  Search,
  Sparkles,
  Building2,
  Mail,
  ExternalLink,
  ChevronLeft,
  Filter,
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
  FileText,
  LogOut,
  Layers,
  Activity,
  Globe,
  Tag,
  CreditCard,
  MessageSquare,
  ShieldAlert,
  Lock,
  ArrowUp
} from "lucide-react";
import { AppSwitcher } from "../../hub/AppSwitcher";
import { MobileNavBackdrop, MobileNavButton, useMobileNav } from "../../components/MobileNav";
import { NAV_TEXT, C, FONT_DISPLAY, FONT_BODY, HUB_PAPER, initialsFromName } from "../../tokens";
import { api } from "../../api/apiClient";
import { navigateHash, onRouteChange, replaceHash, routeHash } from "../../utils/route";
import { SubscriptionPage } from "../../team/SubscriptionPage";
import { usePluginAccess } from "../../components/PluginAccessGate";
import { CampaignsView, DoNotEmailView, FindView, MailboxesView, RepliesView } from "./OutreachViews";
import { AccountPanel, AccountsView, AddAccountForm, ContactsView, DossiersView, ImportView, ScoutView, useLeadAccounts } from "./AccountsViews";


export default function LeadGenerationPlugin({
  operator,
  onBackToHub,
  onLogout,
  profile,
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
  const nav = useMobileNav(view);

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
  const [openAccount, setOpenAccount] = useState(null); // the saved account shown in the side panel
  const [toastMessage, setToastMessage] = useState(null);

  // Open AI Lead Copilot Chat State
  const [copilotChatMessages, setCopilotChatMessages] = useState([
    {
      id: "m_init",
      role: "assistant",
      text: "I can find target companies on the web, sharpen your ideal customer profile, research a market or draft outreach. What are you working on?",
      time: "Just now",
      leads: []
    }
  ]);
  const [copilotInput, setCopilotInput] = useState("");
  const [isCopilotTyping, setIsCopilotTyping] = useState(false);
  const copilotScrollRef = React.useRef(null);
  useEffect(() => {
    if (copilotScrollRef.current) copilotScrollRef.current.scrollIntoView({ block: "nearest" });
  }, [copilotChatMessages.length, isCopilotTyping]);

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
      const res = await api.copilotChat({
        message: query,
        history: copilotChatMessages.map((m) => ({ role: m.role, content: m.text })),
        plugin: "leadgen"
      });

      const aiMsg = {
        id: "m_" + (Date.now() + 1),
        role: "assistant",
        text: res?.reply || "I processed your request. How else can I help?",
        leads: res?.leads || [],
        time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        model: res?.model
      };
      setCopilotChatMessages((prev) => [...prev, aiMsg]);
    } catch (err) {
      setCopilotChatMessages((prev) => [
        ...prev,
        {
          id: "m_" + (Date.now() + 1),
          role: "assistant",
          text: /credits/i.test(err.message || "") ? err.message : `Couldn't reach the AI: ${err.message || "no answer from the AI service."} Try again in a moment.`,
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

  // Saves a company the Copilot found, with only what the web search returned.
  const handleAddCopilotLead = (lead) => {
    store.save([{ name: lead.name || lead.companyName || "", website: lead.site || lead.website || "", phone: lead.phone || "",
      notes: lead.snippet || "", source: "copilot", source_url: lead.sourceUrl || "" }]);
  };
  const [showAddModal, setShowAddModal] = useState(false);

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };
  const store = useLeadAccounts(showToast);
  const withContact = store.accounts.filter((a) => a.contact_name || a.email).length;

  // Navigation Items on Left
  const navItems = [
    { id: "copilot", label: "AI Lead Copilot", icon: Sparkles, section: "Find Leads" },
    { id: "scout", label: "AI Lead Scout", icon: Search, section: "Find Leads" },
    { id: "find_email", label: "Find Work Email", icon: Mail, section: "Find Leads" },
    { id: "accounts", label: "Saved Accounts", icon: Building2, count: store.accounts.length || null, section: "Enrichment" },
    { id: "contacts", label: "Decision Makers", icon: Users, count: withContact || null, section: "Enrichment" },
    { id: "dossiers", label: "Account Dossiers", icon: FileText, section: "Enrichment" },
    { id: "import_export", label: "Import", icon: FileSpreadsheet, section: "Enrichment" },
    { id: "sequences", label: "Email Sequences", icon: Send, section: "Email Outreach" },
    { id: "replies", label: "Inbox & Replies", icon: MessageSquare, section: "Email Outreach" },
    { id: "mailboxes", label: "Mailboxes & Warmup", icon: Layers, section: "Mailboxes" },
    { id: "suppression", label: "Do Not Email", icon: ShieldAlert, section: "Mailboxes" },
    ...(operator?.is_admin ? [{ id: "subscription", label: "Subscription", icon: CreditCard, section: "Billing" }] : []),
  ];

  const viewTitles = {
    copilot: { title: "AI Lead Copilot (Open Assistant)", desc: "Interactive AI partner for lead engineering, strategy, market research, and prompt optimization." },
    scout: { title: "AI Lead Scout", desc: "Find companies with a live web search, then save the ones you want." },
    find_email: { title: "Find Work Email (Waterfall Finder)", desc: "Verify and research single work emails using 5-layer intelligence waterfall (1 credit on find)." },
    accounts: { title: "Saved Accounts", desc: "The companies you saved. Research one to fill in its details." },
    contacts: { title: "Decision Makers", desc: "The people at your saved accounts, with the contact details found for them." },
    dossiers: { title: "Account Dossiers", desc: "What research found about each saved company, with its sources." },
    import_export: { title: "Import", desc: "Add companies from an Excel or CSV file." },
    sequences: { title: "Cold Email Sequences & Campaigns", desc: "Multi-step email cadences, automated follow-up schedules, and response analytics." },
    replies: { title: "Inbox & Reply Categorization", desc: "Classified prospect replies with intent tagging and instant thread actions." },
    mailboxes: { title: "Connected Mailboxes & Deliverability", desc: "SMTP/IMAP connections, automated warmup ramp, SPF/DKIM/DMARC DNS health." },
    suppression: { title: "Do-Not-Email List", desc: "Suppression registry for unsubscribes, manual exclusions, and hard bounce protection." },
    subscription: { title: "Subscription & Credits", desc: "Your Leads plan and credits. Change plan, top up, or cancel." },
  };

  return (
    <div className={nav.open ? "app-shell is-nav-open" : "app-shell"} style={{ display: "flex", height: "100vh", background: HUB_PAPER, fontFamily: FONT_BODY, overflow: "hidden" }}>
      <MobileNavBackdrop nav={nav} />
      
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
            Leads
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
                    showToast("Choose a plan or buy a top-up to unlock Leads.");
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
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <MobileNavButton nav={nav} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 20, color: C.ink, letterSpacing: "-0.02em" }}>
                {viewTitles[view]?.title || "Leads"}
              </div>
              <div className="hide-mobile" style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate, marginTop: 2 }}>
                {viewTitles[view]?.desc || ""}
              </div>
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
                  <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate }}>Choose a plan or buy a top-up below to unlock Leads.</div>
                </div>
              </div>
              <SubscriptionPage wallet="leadgen" back="/leadgen/subscription" />
            </div>
          ) : (
            <>
          {/* AI LEAD COPILOT: open chat about targets, ideal customers, markets and outreach */}
          {view === "copilot" && (
            <div className="ui-card" style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 150px)", minHeight: 440, overflow: "hidden" }}>
              <div className="ui-scroll" style={{ flex: 1, overflowY: "auto", padding: "20px 20px 8px", display: "flex", flexDirection: "column", gap: 16 }}>
                {copilotChatMessages.map((m) => (m.role === "user" ? (
                  <div key={m.id} style={{ alignSelf: "flex-end", maxWidth: "80%", background: "var(--ui-accent-soft)", color: "var(--ui-accent-ink)", padding: "9px 13px", borderRadius: 8, fontFamily: FONT_BODY, fontSize: 13.5, lineHeight: 1.55, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                    {m.text}
                  </div>
                ) : (
                  <div key={m.id} style={{ display: "flex", gap: 10, maxWidth: "88%" }}>
                    <div style={{ width: 28, height: 28, borderRadius: 6, background: "#8B5CF614", color: "#8B5CF6", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <Sparkles size={15} />
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontFamily: FONT_BODY, fontSize: 13.5, lineHeight: 1.6, color: C.textInk, whiteSpace: "pre-wrap", overflowWrap: "anywhere", paddingTop: 4 }}>{m.text}</div>
                      {m.leads && m.leads.length ? (
                        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                          {m.leads.map((l, i) => (
                            <div key={l.id || i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", border: `1px solid ${C.border}`, borderRadius: 6, background: "#fff" }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: 13.5, color: C.ink }}>{l.name || l.companyName}</div>
                                <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {[l.site || l.website || l.domain, l.phone].filter(Boolean).join(" · ") || "No website or phone found"}
                                </div>
                              </div>
                              <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={() => handleAddCopilotLead(l)}>
                                <Plus size={14} /> Save
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                )))}
                {copilotChatMessages.length <= 1 && !isCopilotTyping ? (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 6, paddingLeft: 38 }}>
                    <span style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.slateLight }}>Try</span>
                    {[
                      [Search, "Find 20 logistics companies in Manchester"],
                      [Users, "Who should I target with an AI phone receptionist?"],
                      [Send, "Write a short cold email to a dental practice"],
                    ].map(([Icon, text]) => (
                      <button key={text} type="button" className="ui-chip" onClick={() => handleSendCopilotChat(null, text)}>
                        <Icon size={14} color={C.slate} /> {text}
                      </button>
                    ))}
                  </div>
                ) : null}
                {isCopilotTyping ? <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.slate, paddingLeft: 38 }}>Thinking…</div> : null}
                <div ref={copilotScrollRef} />
              </div>
              <form onSubmit={handleSendCopilotChat} style={{ padding: 12, borderTop: `1px solid ${C.border}` }}>
                <div className="ui-field" style={{ display: "flex", alignItems: "flex-end", gap: 8, border: `1px solid ${C.border}`, borderRadius: 8, padding: "6px 6px 6px 12px", background: "#fff" }}>
                  <textarea
                    value={copilotInput}
                    onChange={(e) => setCopilotInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSendCopilotChat();
                      }
                    }}
                    rows={2}
                    placeholder="Ask about target companies, your ideal customer or outreach"
                    aria-label="Message the Copilot"
                    style={{ flex: 1, minWidth: 0, border: 0, outline: 0, resize: "none", fontFamily: FONT_BODY, fontSize: 13.5, lineHeight: 1.5, padding: "4px 0", background: "transparent", color: C.textInk }}
                  />
                  <button type="submit" className="ui-btn ui-btn--primary" title="Send" disabled={!copilotInput.trim() || isCopilotTyping} style={{ width: 34, height: 34, padding: 0 }}>
                    <ArrowUp size={16} />
                  </button>
                </div>
                <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.slateLight, marginTop: 8 }}>
                  Enter to send, Shift + Enter for a new line. Company searches use public web results.
                </div>
              </form>
            </div>
          )}

          {view === "scout" && <ScoutView store={store} />}

          {view === "accounts" && <AccountsView store={store} onOpen={setOpenAccount} onAdd={() => setShowAddModal(true)} onGo={setView} />}

          {view === "contacts" && <ContactsView store={store} onOpen={setOpenAccount} onToast={showToast} onGo={setView} />}

          {view === "dossiers" && <DossiersView store={store} onOpen={setOpenAccount} onGo={setView} />}

          {view === "find_email" && <FindView />}

          {view === "sequences" && <CampaignsView />}

          {view === "replies" && <RepliesView />}

          {view === "mailboxes" && <MailboxesView />}

          {view === "suppression" && <DoNotEmailView />}

          {view === "subscription" && operator?.is_admin && <SubscriptionPage wallet="leadgen" back="/leadgen/subscription" />}

          {view === "import_export" && <ImportView store={store} onGo={setView} />}
            </>
          )}
        </div>

      </div>

      {openAccount && <AccountPanel key={openAccount.id} account={openAccount} store={store} onClose={() => setOpenAccount(null)} />}

      {showAddModal && <AddAccountForm store={store} onClose={() => setShowAddModal(false)} />}

      {/* Toast */}
      {toastMessage && (
        <div style={{ position: "fixed", bottom: 24, right: 24, background: C.ink, color: "#fff", padding: "10px 18px", borderRadius: 8, fontSize: 12.5, fontWeight: 600, boxShadow: "0 8px 24px rgba(0,0,0,0.2)", zIndex: 9999 }}>
          {toastMessage}
        </div>
      )}

    </div>
  );
}
