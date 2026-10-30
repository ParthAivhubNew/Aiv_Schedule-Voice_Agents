import { cloneElement, useState, useEffect, useRef, useMemo } from "react";
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
  Route,
  Send,
  RefreshCw,
  Plus,
  ArrowRight,
  SlidersHorizontal,
  Check,
  LogOut,
  Activity,
  Globe,
  Tag,
  MessageSquare,
  ListChecks,
  Lock,
  Mail,
  Plug,
  Bot,
  Users,
  FileSpreadsheet,
  Workflow,
} from "lucide-react";
import { PluginHeader, PluginSidebar } from "../../hub/PluginShell";
import { AppChrome } from "../../app/ui";
import { MobileNavBackdrop, MobileNavButton, useMobileNav } from "../../components/MobileNav";
import { NAV_TEXT, C, FONT_DISPLAY, FONT_BODY, HUB_PAPER } from "../../tokens";
import { navigateHash, onRouteChange, replaceHash, routeHash } from "../../utils/route";
import { SubscriptionPage } from "../../team/SubscriptionPage";
import { usePluginAccess } from "../../components/PluginAccessGate";
import { CampaignsView, MailboxesView, useOutreachData } from "./OutreachViews";
import { MailView } from "./MailView";
import { AccountPanel, AccountsView, AddAccountForm, useLeadAccounts } from "./AccountsViews";
import { FindLeadsView } from "./FindLeadsView";
import { AssistantButton, AssistantPanel, assistantHasChat } from "./AssistantPanel";
import { ListsView, useLeadLists } from "./Lists";
import { DialogHost } from "./Dialogs";
import { NewCampaign } from "./CampaignSimple";
import { JourneysView } from "./JourneysView";
import { CompanyPage } from "./CompanyPage";
import { ProfileBox } from "./EmailWriter";
import { SavedPeople, SavedTabs, peopleOf } from "./SavedPeople";
import { takeOpenLead } from "../../connections/ConnectedHome";
import { openWorkflows } from "../../workflows/openWorkflows";
import { EmbedPlanNotice, onlyEmbedViews, useEmbedViews } from "../../embed/EmbedContext";


// Leads is purple: its buttons, selections and highlights follow this instead of Voice's blue.
const ACCENT = { "--ui-accent": "#7C3AED", "--ui-accent-hover": "#6D28D9", "--ui-accent-soft": "#F3EEFF", "--ui-accent-ink": "#5B21B6", "--ui-ring": "rgba(124, 58, 237, 0.22)", "--ui-side-active-icon": "#B79DFB" };

const SAVED_VIEWS = ["saved_people", "saved_companies", "lists"];

export default function LeadGenerationPlugin({
  operator,
  onBackToHub,
  onLogout,
  accountBar,
  profile,
}) {
  const normalizeLeadgenView = (raw) => {
    if (!raw) return "find_leads";
    if (raw === "campaigns" || raw === "email" || raw.startsWith("email/") || raw === "sequences" || raw === "find_email") return "outreach";
    if (raw === "warmup") return "mailboxes";
    if (raw === "contacts") return "saved_people";
    if (raw === "dossiers" || raw === "accounts") return "saved_companies";
    if (raw === "suppression" || raw === "replies") return "mail";
    if (raw === "copilot" || raw === "scout" || raw === "import_export" || raw === "today") return "find_leads";
    return raw;
  };

  const { hasPlan, loading: planLoading } = usePluginAccess("leadgen");
  const isLocked = !planLoading && !hasPlan;

  const [view, setView] = useState(() => {
    try {
      const hash = routeHash().replace(/^#\/?/, "");
      const parts = hash.split("/");
      if (parts[0] === "leadgen" && parts[1] === "company" && parts[2]) return "company";
      if (parts[0] === "leadgen" && parts[1]) return normalizeLeadgenView(parts[1] === "company" ? "find_leads" : parts[1]);
      if (parts[0] === "emailoutreach") return "outreach";
      const saved = localStorage.getItem("aivhub_leadgen_view") || "find_leads";
      return normalizeLeadgenView(saved === "company" ? "find_leads" : saved);
    } catch (_) {
      return "find_leads";
    }
  });
  const [companyId, setCompanyId] = useState(() => { try { const p = routeHash().replace(/^#\/?/, "").split("/"); return p[0] === "leadgen" && p[1] === "company" ? p[2] || "" : ""; } catch (_) { return ""; } }); // the company page being shown
  const cameFrom = useRef("find_leads"); // where the company page's back button goes
  const [assistantSeed, setAssistantSeed] = useState(null); // a message the assistant sends when opened from a page ("Ask AI" on a company)
  const openCompany = (id) => { cameFrom.current = view === "company" ? cameFrom.current : view; setCompanyId(id); setView("company"); };
  const askAbout = (message) => { setAssistantSeed({ id: Date.now(), text: message }); setAssistantOpen(true); };
  const nav = useMobileNav(view);
  const embedViews = useEmbedViews(); // set when this app is shown inside a partner's page: only those pages
  // Find Leads stays alive (just hidden) once opened, so a search, its results and a drawn map area are
  // still there when the user comes back from another tab.
  const [findOpened, setFindOpened] = useState(view === "find_leads");
  useEffect(() => { if (view === "find_leads") setFindOpened(true); }, [view]);

  // Any navigation that might carry an old/legacy tab id (a child view's onGo/onOpen callback,
  // or a saved deep link) must go through this, not the raw setter -- see normalizeLeadgenView.
  const goImport = () => { setFindOpened(true); setView("find_leads"); setImportAsk(Date.now()); if (window.innerWidth <= 820) setAssistantOpen(false); };
  const goTo = (raw) => setView(normalizeLeadgenView(raw));

  // Leaving the full-screen assistant for another tab docks it in the right corner, so the chat carries on beside the page.
  const lastView = useRef(view);
  useEffect(() => {
    if (lastView.current === "assistant" && view !== "assistant" && assistantHasChat() && window.innerWidth > 820) setAssistantOpen(true);
    lastView.current = view;
  }, [view]);

  useEffect(() => {
    try {
      if (view !== "company") localStorage.setItem("aivhub_leadgen_view", view);
      const target = view === "company" && companyId ? `#/leadgen/company/${companyId}` : `#/leadgen/${view}`;
      if (routeHash() !== target) {
        replaceHash(target);
      }
    } catch (_) {}
  }, [view, companyId]);

  useEffect(() => {
    const onHash = () => {
      try {
        const hash = routeHash().replace(/^#\/?/, "");
        const parts = hash.split("/");
        if (parts[0] === "leadgen" && parts[1] === "company" && parts[2]) {
          if (parts[2] !== companyId) setCompanyId(parts[2]);
          if (view !== "company") setView("company");
        } else if (parts[0] === "leadgen" && parts[1]) {
          const norm = normalizeLeadgenView(parts[1]);
          if (norm !== view) setView(norm);
        } else if (parts[0] === "emailoutreach") {
          setView("outreach");
        }
      } catch (_) {}
    };
    return onRouteChange(onHash);
  }, [view, companyId]);
  const [openAccount, setOpenAccount] = useState(null); // the saved account shown in the side panel
  const [toastMessage, setToastMessage] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false); // the AI assistant panel beside the page
  const [journeyId, setJourneyId] = useState(""); // a journey to open on the Journeys page (from the chat)
  const [journeyList, setJourneyList] = useState(""); // a list to start a new journey with (from Lists)
  const startJourney = (listId) => { setWizard(null); setJourneyId(""); setJourneyList(listId || ""); setView("outreach"); };
  const openJourney = (id) => { setWizard(null); setJourneyList(""); setJourneyId(id); setView("outreach"); };
  const [importAsk, setImportAsk] = useState(0); // bumped to open the spreadsheet import inside Find Leads
  const [incoming, setIncoming] = useState(null); // a search the assistant sends to Find Leads: { id, filters }

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };
  const listsStore = useLeadLists(showToast);
  const store = useLeadAccounts(showToast, listsStore.reload);
  const savedPeopleCount = useMemo(() => peopleOf(store.accounts).length, [store.accounts]);
  const outreach = useOutreachData();
  // Home links straight to a company: open its panel once the companies have loaded.
  const [wantedLead, setWantedLead] = useState(() => takeOpenLead());
  useEffect(() => {
    const onOpen = (ev) => setWantedLead((ev && ev.detail) || "");
    window.addEventListener("aivhub:open-lead", onOpen);
    return () => window.removeEventListener("aivhub:open-lead", onOpen);
  }, []);
  useEffect(() => {
    if (!wantedLead || store.loading) return;
    const hit = store.accounts.find((a) => a.id === wantedLead);
    if (hit) setOpenAccount(hit);
    setWantedLead("");
  }, [wantedLead, store.loading, store.accounts]);
  const [wizard, setWizard] = useState(null); // { listId } while the new-campaign steps are open
  // Which campaign view Mail opens on, when something asked for one: a link to the replies or the do-not-email list,
  // or a mailbox's "View sent".
  const [inboxStart, setInboxStart] = useState(() => {
    try {
      const part = routeHash().replace(/^#\/?/, "").split("/")[1];
      return part === "replies" ? { sub: "replies" } : part === "suppression" ? { sub: "suppression" } : null;
    } catch (_) {
      return null;
    }
  });

  // Pages of the app, in the same two groups as Voice's: the work, then the setup.
  const navItems = onlyEmbedViews([
    { id: "assistant", label: "AI Assistant", short: "Ask", icon: Bot, group: "Outreach", embedIds: ["assistant"] },
    { id: "find_leads", label: "Find Leads", short: "Find", icon: Sparkles, group: "Outreach" },
    { id: "lists", label: "Lists", short: "Lists", icon: ListChecks, count: store.accounts.length || null, group: "Outreach", embedIds: ["lists", "saved_people", "saved_companies"] }, // Companies and People are tabs on the same page
    { id: "outreach", label: "Journeys", icon: Route, group: "Outreach" },
    { id: "mail", label: "Mail", icon: Mail, group: "Outreach", embedIds: ["mail", "mailboxes"] }, // Mail has two pages, listed under it in the menu
    { id: "workflows", label: "Workflows", icon: Workflow, group: "Setup" },
    { id: "business", label: "About your business", icon: Building2, group: "Setup" },
  ], embedViews);
  const navGroups = ["Outreach", "Setup"].map((label) => ({
    label,
    items: navItems.filter((item) => item.group === label).map((item) => ({
      id: item.id,
      label: item.label,
      short: item.short,
      icon: item.icon,
      count: item.count,
      active: view === item.id || (item.id === "mail" && view === "mailboxes") || (item.id === "lists" && SAVED_VIEWS.includes(view)),
      locked: isLocked && item.id !== "subscription",
      title: isLocked && item.id !== "subscription" ? "Choose a plan or top up to unlock this" : `Open ${item.label}`,
      // Mail's two pages are sub-items under it, the way the other apps list theirs.
      children: item.id === "mail" ? (() => {
        const subs = onlyEmbedViews([
          { id: "mail", label: "Inbox and sent", icon: Mail, title: "Replies, sent emails and the do-not-email list" },
          { id: "mailboxes", label: "Email accounts", icon: Plug, title: "Connect the email accounts you send from, warm them up and check their health" },
        ], embedViews).map((t) => ({ ...t, active: view === t.id, onClick: () => { if (t.id === "mail") setInboxStart(null); setView(t.id); } }));
        return subs.length > 1 && !isLocked ? subs : undefined;
      })() : undefined,
      onClick: () => {
        if (isLocked && item.id !== "subscription") {
          showToast("Choose a plan or buy a top-up to unlock Leads.");
          return;
        }
        if (item.id === "workflows") {  // one page for the whole company, not a Leads screen
          openWorkflows({ from: "leads", event: "campaign.reply" });
          return;
        }
        if (item.id === "lists") {
          setView(SAVED_VIEWS.includes(view) ? view : "lists");
          return;
        }
        if (item.id === "mail") {
          setInboxStart(null);
          // Opens on Mail, or on Email accounts when that is the only half this screen may show
          setView(embedViews && !embedViews.includes("mail") ? "mailboxes" : view === "mailboxes" ? "mailboxes" : "mail");
          return;
        }
        setView(item.id);
      },
    })),
  }));

  const viewTitles = {
    assistant: { title: "AI Assistant", desc: "Ask in plain words. It reads your companies, campaigns and mailboxes, and does nothing that costs credits until you confirm." },
    find_leads: { title: "Find Leads", desc: "Every company on the register, best profiles first. Filter them, or ask the AI Assistant." },
    saved_people: { title: "Lists · People", desc: "Every person at the companies you saved: who they are, how to reach them, and where each company stands." },
    saved_companies: { title: "Lists · Companies", desc: "Every company you saved or imported, whichever list it is in. Check and improve them, then start a campaign." },
    lists: { title: "Lists", desc: "Everything you save or import lands in a list. Get contact details, fix what is wrong, then start a campaign." },
    outreach: { title: "Journeys", desc: "A path through emails, calls and tasks for each person: set it up once, and it stops when they reply, book or opt out." },
    mail: { title: "Inbox and sent", desc: "Everything your campaigns sent and got back: replies, sent emails and the do-not-email list." },
    mailboxes: { title: "Email accounts", desc: "Connect the email accounts you send from, warm them up, and keep their sender reputation healthy." },
    business: { title: "About your business", desc: "What the AI may say about you when it writes emails. It is your company profile, shared with your other Outreach tools." },
    subscription: { title: "Plan & credits", desc: "Your Leads plan and credits. Change plan, top up, or cancel." },
  };

  return (
    <div className={nav.open ? "app-shell is-nav-open" : "app-shell"} style={{ display: "flex", height: "100vh", background: HUB_PAPER, fontFamily: FONT_BODY, overflow: "hidden", ...ACCENT }}>
      <MobileNavBackdrop nav={nav} />
      
      <AppChrome />
      <PluginSidebar appId="leadgen" name="Leads" icon={Search} accent="#8B5CF6" groups={navGroups} wallet="leadgen" operator={operator}
        onOpenPlan={() => setView("subscription")} onHome={onBackToHub} onLogout={onLogout} refreshKey={view} nav={nav} tabs={["find_leads", "lists", "outreach", "mail"]} />

      {/* ----------------- RIGHT WORKSPACE AREA ----------------- */}
      <div className="app-main" style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, height: "100vh" }}>
        
        <PluginHeader assistant={false} nav={nav} title={viewTitles[view]?.title || "Leads"} sub={viewTitles[view]?.desc || ""}
          accountBar={accountBar ? cloneElement(accountBar, { wallet: !isLocked || view === "subscription" ? "leadgen" : null, app: "Leads", onOpenPlan: () => setView("subscription") }) : null}>
          {view === "find_leads" && !isLocked && !embedViews ? (
            <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm phone-gone" title="Bring in your own spreadsheet of companies" onClick={goImport}><FileSpreadsheet size={14} /> Import</button>
          ) : null}
          {!isLocked && !embedViews && view !== "assistant" ? <AssistantButton open={assistantOpen} onClick={() => setAssistantOpen((v) => !v)} /> : null}
          {(view === "lists" || view === "saved_companies" || view === "saved_people") && (
            <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm phone-gone" title="Type in one company yourself" onClick={() => setShowAddModal(true)}>
              <Plus size={14} /> Add one company
            </button>
          )}
        </PluginHeader>

        {/* Main Content Area */}
        <div className={view === "find_leads" ? "app-page fl-fit" : "app-page"} style={view === "assistant" ? { flex: 1, minHeight: 0, overflow: "hidden", padding: 0, display: "flex" } : view === "outreach" && !wizard && !embedViews ? { flex: 1, minHeight: 0, overflow: "hidden", padding: "16px 24px 8px", display: "flex", flexDirection: "column" } : { flex: 1, overflowY: "auto", padding: "20px 24px 24px" }}>
          {isLocked && embedViews ? <EmbedPlanNotice app="Leads" /> : isLocked && view !== "subscription" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div
                style={{
                  background: "linear-gradient(135deg, rgba(139,92,246,0.10), rgba(139,92,246,0.03))",
                  border: "1px solid rgba(139,92,246,0.30)",
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
                  <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, color: "#5B21B6" }}>Subscription Required</div>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate }}>Choose a plan or buy a top-up below to unlock Leads.</div>
                </div>
              </div>
              <SubscriptionPage wallet="leadgen" back="/leadgen/subscription" />
            </div>
          ) : (
            <>
          {(findOpened || view === "find_leads") && (
            <div className="fl-host" style={view === "find_leads" ? undefined : { display: "none" }}><FindLeadsView store={store} listsStore={listsStore} onGo={goTo} incoming={incoming} importAsk={importAsk} onAskAssistant={() => setAssistantOpen(true)} onOpenCompany={openCompany} /></div>
          )}


          {view === "assistant" && !embedViews && (
            <AssistantPanel page open onClose={() => goTo("find_leads")} onGo={goTo} store={store} onImport={goImport}
              lists={listsStore.lists.map((l) => ({ id: l.id, name: l.name, count: (l.ids || []).length }))}
              onOpenList={() => goTo("lists")} onCampaign={startJourney} onOpenJourney={openJourney} onOpenCompany={openCompany} seed={assistantSeed}
              onShowResults={(filters) => { setIncoming({ id: Date.now(), filters }); setFindOpened(true); setView("find_leads"); }} />
          )}

          {SAVED_VIEWS.includes(view) && (
            <div style={{ marginBottom: 14 }}>
              <SavedTabs view={view} onChange={setView} counts={{ lists: listsStore.lists.length, saved_companies: store.accounts.length, saved_people: savedPeopleCount }} />
            </div>
          )}

          {view === "saved_people" && <SavedPeople store={store} onOpen={setOpenAccount} onGo={goTo} />}

          {view === "saved_companies" && <AccountsView store={store} listsStore={listsStore} onOpen={setOpenAccount} onAdd={() => setShowAddModal(true)} onGo={goTo} onCampaign={startJourney} onOpenJourney={openJourney} />}

          {view === "lists" && <ListsView store={store} listsStore={listsStore} onGo={goTo} onOpen={setOpenAccount} onAdd={() => setShowAddModal(true)} onCampaign={startJourney} onOpenJourney={openJourney} />}

          {view === "company" && companyId && (
            <CompanyPage id={companyId} store={store} onBack={() => setView(cameFrom.current || "find_leads")} onGo={goTo} onAskAi={askAbout} onOpenJourney={openJourney} />
          )}

          {view === "outreach" && (wizard
            ? <NewCampaign store={store} listsStore={listsStore} outreach={outreach} initialListId={wizard.listId}
                onOpenBusiness={() => { setWizard(null); setView("business"); }} onOpenMailboxes={() => { setWizard(null); setView("mailboxes"); }} onOpenLists={() => { setWizard(null); setView("lists"); }}
                onCancel={() => setWizard(null)} onDone={() => { setWizard(null); outreach.reloadCampaigns(); }} />
            : <JourneysView outreach={outreach} listsStore={listsStore} onGo={goTo} onAskAssistant={() => setAssistantOpen(true)} onGuided={() => setWizard({ listId: "" })}
                initialId={journeyId} initialListId={journeyList} onConsumed={() => setJourneyList("")} />)}

          {view === "mail" && <MailView operator={operator} outreach={outreach} start={inboxStart} key={inboxStart ? `${inboxStart.sub}${inboxStart.mailboxId || ""}` : "mail"} />}

          {view === "mailboxes" && <MailboxesView outreach={outreach} onViewSent={(id) => { setInboxStart({ sub: "sent", mailboxId: id }); setView("mail"); }} />}
          {view === "business" && <ProfileBox page />}

          {view === "subscription" && operator?.is_admin && <SubscriptionPage wallet="leadgen" back="/leadgen/subscription" />}
            </>
          )}
        </div>

      </div>

      {!isLocked && !embedViews && view !== "assistant" ? (
        <AssistantPanel open={assistantOpen} onClose={() => setAssistantOpen(false)} onGo={goTo} store={store} onImport={goImport} onExpand={() => { setAssistantOpen(false); setView("assistant"); }}
          lists={listsStore.lists.map((l) => ({ id: l.id, name: l.name, count: (l.ids || []).length }))}
          onOpenList={() => goTo("lists")} onCampaign={startJourney} onOpenJourney={openJourney} onOpenCompany={openCompany} seed={assistantSeed}
          onShowResults={(filters) => { setIncoming({ id: Date.now(), filters }); setFindOpened(true); setView("find_leads"); if (window.innerWidth <= 820) setAssistantOpen(false); }} />
      ) : null}

      {openAccount && <AccountPanel key={openAccount.id} account={openAccount} store={store} onClose={() => setOpenAccount(null)} />}

      {showAddModal && <AddAccountForm store={store} onClose={() => setShowAddModal(false)} />}

      {/* Toast */}
      <DialogHost />
      {toastMessage && (
        <div className="app-toast" style={{ position: "fixed", bottom: 24, right: 24, background: C.ink, color: "#fff", padding: "10px 18px", borderRadius: 8, fontSize: 12.5, fontWeight: 600, boxShadow: "0 8px 24px rgba(0,0,0,0.2)", zIndex: 9999 }}>
          {toastMessage}
        </div>
      )}

    </div>
  );
}
