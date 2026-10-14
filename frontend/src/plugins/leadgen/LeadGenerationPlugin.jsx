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
  ListChecks,
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
import { ListsView, useLeadLists } from "./Lists";
import { CreditsChip, PlanStrip } from "./CreditsChip";
import { DialogHost } from "./Dialogs";
import { CampaignWizard } from "./CampaignWizard";
import { ProfileBox } from "./EmailWriter";


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
    if (raw === "contacts" || raw === "dossiers" || raw === "accounts") return "lists";
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
  // Find Leads stays alive (just hidden) once opened, so a search, its results and a drawn map area are
  // still there when the user comes back from another tab.
  const [findOpened, setFindOpened] = useState(view === "find_leads");
  useEffect(() => { if (view === "find_leads") setFindOpened(true); }, [view]);

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
  const listsStore = useLeadLists(showToast);
  const store = useLeadAccounts(showToast, listsStore.reload);
  const outreach = useOutreachData();
  const [wizard, setWizard] = useState(null); // { listId } while the new-campaign steps are open
  const [inboxStart, setInboxStart] = useState(null); // opens Sent & Replies on a given tab, such as one mailbox's sent emails

  // Navigation Items on Left
  const navItems = [
    { id: "find_leads", label: "Find Leads", icon: Sparkles, section: "Find Leads" },
    { id: "lists", label: "Lists", icon: ListChecks, count: store.accounts.length || null, section: "Enrichment" },
    { id: "outreach", label: "Campaigns", icon: Send, section: "Email Outreach" },
    { id: "replies", label: "Sent & Replies", icon: MessageSquare, section: "Email Outreach" },
    { id: "mailboxes", label: "Mailboxes", icon: Layers, section: "Mailboxes" },
    { id: "business", label: "About your business", icon: Building2, section: "Company" },
    ...(operator?.is_admin ? [{ id: "subscription", label: "Subscription", icon: CreditCard, section: "Billing" }] : []),
  ];

  const viewTitles = {
    find_leads: { title: "Find Leads", desc: "Search for companies, then refine with the AI in the same place -- or import a spreadsheet instead." },
    lists: { title: "Lists", desc: "Everything you save or import lands in a list. Get contact details, fix what is wrong, then start a campaign." },
    outreach: { title: "Campaigns", desc: "Email sequences sent to a list: set up in steps, with follow-ups, replies and results." },
    replies: { title: "Sent & Replies", desc: "Every email you have sent and what became of it, the replies that came back sorted by intent, and your do-not-email list." },
    mailboxes: { title: "Mailboxes", desc: "Connect the email accounts you send from, warm them up, and keep their sender reputation healthy." },
    business: { title: "About your business", desc: "What the AI may say about you when it writes emails. It is your company profile, shared with your other Outreach tools." },
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
                title={tabLocked ? "Choose a plan or top up to unlock this" : `Open ${item.label}`}
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
            <button title="Sign out of Outreach"
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
            {(!isLocked || view === "subscription") && view !== "find_leads" && view !== "lists" ? <CreditsChip onOpen={operator?.is_admin ? () => setView("subscription") : undefined} /> : null}
            {view === "lists" && (
              <button title="Type in one company yourself"
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
                <Plus size={14} /> Add one company
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
          {(view === "find_leads" || view === "lists") && <PlanStrip onOpen={operator?.is_admin ? () => setView("subscription") : undefined} />}
          {(findOpened || view === "find_leads") && (
            <div style={view === "find_leads" ? undefined : { display: "none" }}><FindLeadsView store={store} listsStore={listsStore} onGo={goTo} /></div>
          )}

          {view === "lists" && <ListsView store={store} listsStore={listsStore} onGo={goTo} onOpen={setOpenAccount} onAdd={() => setShowAddModal(true)} onCampaign={(listId) => { setWizard({ listId }); setView("outreach"); }} />}

          {view === "outreach" && (wizard
            ? <CampaignWizard store={store} listsStore={listsStore} outreach={outreach} initialListId={wizard.listId}
                onOpenBusiness={() => { setWizard(null); setView("business"); }} onCancel={() => setWizard(null)} onDone={() => { setWizard(null); outreach.reloadCampaigns(); }} />
            : <CampaignsView outreach={outreach} onNew={() => setWizard({ listId: "" })} />)}

          {view === "replies" && <RepliesView outreach={outreach} initial={inboxStart} onStarted={() => setInboxStart(null)} />}

          {view === "mailboxes" && <MailboxesView outreach={outreach} onViewSent={(id) => { setInboxStart({ sub: "sent", mailboxId: id }); setView("replies"); }} />}
          {view === "business" && <div style={{ maxWidth: 760 }}><ProfileBox page /></div>}

          {view === "subscription" && operator?.is_admin && <SubscriptionPage wallet="leadgen" back="/leadgen/subscription" />}
            </>
          )}
        </div>

      </div>

      {openAccount && <AccountPanel key={openAccount.id} account={openAccount} store={store} onClose={() => setOpenAccount(null)} />}

      {showAddModal && <AddAccountForm store={store} onClose={() => setShowAddModal(false)} />}

      {/* Toast */}
      <DialogHost />
      {toastMessage && (
        <div style={{ position: "fixed", bottom: 24, right: 24, background: C.ink, color: "#fff", padding: "10px 18px", borderRadius: 8, fontSize: 12.5, fontWeight: 600, boxShadow: "0 8px 24px rgba(0,0,0,0.2)", zIndex: 9999 }}>
          {toastMessage}
        </div>
      )}

    </div>
  );
}
