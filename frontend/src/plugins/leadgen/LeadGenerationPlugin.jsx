import { useState, useEffect } from "react";
import {
  Search,
  Sparkles,
  Building2,
  ExternalLink,
  ChevronLeft,
  Filter,
  CheckCircle2,
  TrendingUp,
  LayoutGrid,
  Send,
  RefreshCw,
  Plus,
  ArrowRight,
  SlidersHorizontal,
  Check,
  LogOut,
  Layers,
  Activity,
  Globe,
  Tag,
  CreditCard,
  MessageSquare,
  Lock
} from "lucide-react";
import { AppSwitcher } from "../../hub/AppSwitcher";
import { MobileNavBackdrop, MobileNavButton, useMobileNav } from "../../components/MobileNav";
import { NAV_TEXT, C, FONT_DISPLAY, FONT_BODY, HUB_PAPER, initialsFromName } from "../../tokens";
import { navigateHash, onRouteChange, replaceHash, routeHash } from "../../utils/route";
import { SubscriptionPage } from "../../team/SubscriptionPage";
import { usePluginAccess } from "../../components/PluginAccessGate";
import { CampaignsView, MailboxesView, RepliesView, useOutreachData } from "./OutreachViews";
import { AccountPanel, AccountsView, AddAccountForm, useLeadAccounts } from "./AccountsViews";
import { FindLeadsView } from "./FindLeadsView";


export default function LeadGenerationPlugin({
  operator,
  onBackToHub,
  onLogout,
  profile,
}) {
  const normalizeLeadgenView = (raw) => {
    if (!raw) return "find_leads";
    if (raw === "campaigns" || raw === "email" || raw.startsWith("email/") || raw === "sequences" || raw === "find_email") return "outreach";
    if (raw === "warmup") return "mailboxes";
    if (raw === "contacts" || raw === "dossiers") return "accounts";
    if (raw === "suppression") return "replies";
    if (raw === "copilot" || raw === "scout" || raw === "import_export") return "find_leads";
    return raw;
  };

  const { hasPlan, loading: planLoading } = usePluginAccess("leadgen");
  const isLocked = !planLoading && !hasPlan;

  const [view, setView] = useState(() => {
    try {
      const hash = routeHash().replace(/^#\/?/, "");
      const parts = hash.split("/");
      if (parts[0] === "leadgen" && parts[1]) return normalizeLeadgenView(parts[1]);
      if (parts[0] === "emailoutreach") return "outreach";
      return normalizeLeadgenView(localStorage.getItem("aivhub_leadgen_view") || "find_leads");
    } catch (_) {
      return "find_leads";
    }
  });
  const nav = useMobileNav(view);

  // Any navigation that might carry an old/legacy tab id (a child view's onGo/onOpen callback,
  // or a saved deep link) must go through this, not the raw setter -- see normalizeLeadgenView.
  const goTo = (raw) => setView(normalizeLeadgenView(raw));

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
          setView("outreach");
        }
      } catch (_) {}
    };
    return onRouteChange(onHash);
  }, [view]);
  const [openAccount, setOpenAccount] = useState(null); // the saved account shown in the side panel
  const [toastMessage, setToastMessage] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };
  const store = useLeadAccounts(showToast);
  const outreach = useOutreachData();

  // Navigation Items on Left
  const navItems = [
    { id: "find_leads", label: "Find Leads", icon: Sparkles, section: "Find Leads" },
    { id: "accounts", label: "Saved Accounts", icon: Building2, count: store.accounts.length || null, section: "Enrichment" },
    { id: "outreach", label: "Email Sequences", icon: Send, section: "Email Outreach" },
    { id: "replies", label: "Inbox & Replies", icon: MessageSquare, section: "Email Outreach" },
    { id: "mailboxes", label: "Mailboxes & Warmup", icon: Layers, section: "Mailboxes" },
    ...(operator?.is_admin ? [{ id: "subscription", label: "Subscription", icon: CreditCard, section: "Billing" }] : []),
  ];

  const viewTitles = {
    find_leads: { title: "Find Leads", desc: "Ask the AI Copilot, search with AI Lead Scout, or import a spreadsheet -- three ways to get companies into your saved accounts." },
    accounts: { title: "Saved Accounts", desc: "The companies you saved. Research one to fill in its details." },
    outreach: { title: "Cold Email Sequences & Campaigns", desc: "Multi-step email cadences, automated follow-up schedules, response analytics, and work-email finding." },
    replies: { title: "Inbox & Reply Categorization", desc: "Classified prospect replies with intent tagging, plus your do-not-email list." },
    mailboxes: { title: "Connected Mailboxes & Deliverability", desc: "SMTP/IMAP connections, automated warmup ramp, SPF/DKIM/DMARC DNS health." },
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
          {view === "find_leads" && <FindLeadsView store={store} onGo={goTo} />}

          {view === "accounts" && <AccountsView store={store} onOpen={setOpenAccount} onAdd={() => setShowAddModal(true)} onGo={goTo} />}

          {view === "outreach" && <CampaignsView outreach={outreach} />}

          {view === "replies" && <RepliesView />}

          {view === "mailboxes" && <MailboxesView outreach={outreach} />}

          {view === "subscription" && operator?.is_admin && <SubscriptionPage wallet="leadgen" back="/leadgen/subscription" />}
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
