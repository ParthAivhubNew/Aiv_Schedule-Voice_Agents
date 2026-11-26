import { cloneElement, useCallback, useState, useEffect, useRef, useMemo } from "react";
import { NOTICE_EVENT, notice } from "../../utils/notice";
import { WRITE_EMAIL_EVENT } from "../../utils/writeEmail";
import { OPEN_JOURNEY_EVENT } from "../../utils/openJourney";
import { api } from "../../api/apiClient";
import { DRAFT_EVENT, takePendingDraft } from "../../utils/draftHandoff";
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
  Shield,
  FileSpreadsheet,
  Upload,
  Workflow,
  FileText, FileUp, CalendarClock, Wallet } from "lucide-react";
import { PluginHeader, PluginSidebar } from "../../hub/PluginShell";
import { AppChrome } from "../../app/ui";
import { MobileNavBackdrop, MobileNavButton, useMobileNav } from "../../components/MobileNav";
import { NAV_TEXT, C, FONT_DISPLAY, FONT_BODY, HUB_PAPER } from "../../tokens";
import { APPS } from "../../hub/apps";
import { navigateHash, onRouteChange, replaceHash, routeHash } from "../../utils/route";
import { SubscriptionPage } from "../../team/SubscriptionPage";
import { usePluginAccess } from "../../components/PluginAccessGate";
import { MailboxesView, useOutreachData } from "./OutreachViews";
import { Compose, MailView } from "./MailView";
import { AccountPanel, AccountsView, AddAccountForm, useLeadAccounts } from "./AccountsViews";
import { FindLeadsView } from "./FindLeadsView";
import { AssistantButton, AssistantPanel, assistantHasChat } from "./AssistantPanel";
import { WORKFLOWS_HEADER, workflowsOpenNow } from "../../workflows/openWorkflows";
import { ListsView, useLeadLists } from "./Lists";
import { DialogHost } from "./Dialogs";
import { NewCampaign } from "./CampaignSimple";
import { JourneysView } from "./JourneysView";
import { InboundFormsView } from "./InboundForms";
import { RetentionReview } from "./RetentionReview";
import { MemberList } from "./MemberList";
import { DataAccess } from "./DataAccess";
import { AdministrationView } from "./admin/AdministrationView";
import { AccessNotice } from "./AccessNotice";
import { accessFlags, EXPORT_OFF_LINE } from "./accessLogic";
import { useBrand } from "../../brand/BrandContext";
import { ImportMatchView } from "./ImportMatch";
import { MonthlyChangesView } from "./MonthlyChanges";
import { ConnectorsView } from "./ConnectorsView";
import { canUseRecords, isAdminOperator } from "./importMatchLogic";
import { returnToList } from "./openList";
import { CompanyPage } from "./CompanyPage";
import { ProfileBox } from "./EmailWriter";
import { SavedPeople, SavedTabs, peopleOf } from "./SavedPeople";
import { takeOpenLead } from "../../connections/ConnectedHome";
import { openWorkflows } from "../../workflows/openWorkflows";
import { EmbedPlanNotice, onlyEmbedViews, useEmbedViews } from "../../embed/EmbedContext";
import { Banner, Toast } from "../../app/ui";

const LEADS_ACCENT = APPS.find((a) => a.id === "leadgen")?.accent; // the app's own colour, on its icon only (hub/apps.js)



const SAVED_VIEWS = ["saved_people", "saved_companies", "lists"];
// Every screen this plugin can show. Any other address under #/leadgen/ gets a "Page not found" instead of a blank page.
const KNOWN_VIEWS = ["find_leads", "lists", "saved_people", "saved_companies", "account", "company", "outreach", "mail", "mailboxes", "inbound_forms", "import_match", "changes", "retention", "member_list", "data_access", "administration", "business", "subscription", "assistant", "connectors"];

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
    if (raw === "forms" || raw === "inbound") return "inbound_forms";
    if (raw === "copilot" || raw === "scout" || raw === "import_export" || raw === "today") return "find_leads";
    return raw;
  };

  const { hasPlan, loading: planLoading } = usePluginAccess("leadgen");
  const { memberSuppression } = useBrand();
  const access = accessFlags(operator, null);
  const showDataAccess = isAdminOperator(operator); // the screen and its menu item are for admins only
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
  const [accountPageId, setAccountPageId] = useState(""); // the saved company whose full profile page is shown
  const openAccountPage = async (id) => {
    cameFrom.current = view === "account" || view === "company" ? cameFrom.current : view;
    setOpenAccount(null);
    let register = "";
    try { register = (await api.accountRegisterPage(id)).business_record_id || ""; } catch (_) { /* the company's own page still opens */ }
    if (register) { setCompanyId(register); setView("company"); return; } // the same page the Find Leads window gives, with what you gave us added
    setAccountPageId(id);
    setView("account");
  };
  // Back from a company or its full profile: to where the person was, and if that was a list, to inside that list.
  const goBack = (fallback) => { const v = cameFrom.current && cameFrom.current !== "account" ? cameFrom.current : fallback; if (v === "lists") returnToList(); setView(v); };
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
      if (view !== "company" && view !== "account" && KNOWN_VIEWS.includes(view)) localStorage.setItem("aivhub_leadgen_view", view);
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
          if (norm === "lists" && (view === "company" || view === "account")) returnToList(); // back out of a company: into the list it was opened from
          if (norm !== view) setView(norm);
        } else if (parts[0] === "emailoutreach") {
          setView("outreach");
        }
      } catch (_) {}
    };
    return onRouteChange(onHash);
  }, [view, companyId]);
  const [openAccount, setOpenAccount] = useState(null); // the saved account shown in the side panel
  useEffect(() => { if (view === "account" && !accountPageId) setView("saved_companies"); }, [view, accountPageId]); // a reload has no company to show
  const [toastMessage, setToastMessage] = useState(null);
  const [reviewWaiting, setReviewWaiting] = useState(0); // records waiting for a person to confirm; shown beside Import & match
  useEffect(() => {
    if (isLocked || embedViews || !canUseRecords(operator)) return;
    api.getReviewQueue({ status: "open", limit: 1 }).then((r) => setReviewWaiting(r.total || 0)).catch(() => {});
  }, [isLocked, embedViews, operator]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false); // the AI assistant panel beside the page
  const [journeyId, setJourneyId] = useState(""); // a journey to open on the Journeys page (from the chat)
  const [journeyList, setJourneyList] = useState(""); // a list to start a new journey with (from Lists)
  const startJourney = (listId) => { setWizard(null); setJourneyId(""); setJourneyList(listId || ""); setView("outreach"); };
  const openJourney = (id) => { setWizard(null); setJourneyList(""); setJourneyId(id); setView("outreach"); };
  const [importAsk, setImportAsk] = useState(0); // bumped to open the spreadsheet import inside Find Leads
  const [incoming, setIncoming] = useState(null); // a search the assistant sends to Find Leads: { id, filters, meta: { asked, total } }
  useEffect(() => { // the browser extension asks Find Leads to look for the company on the page the person is reading
    const onFind = (e) => {
      const company = String((e.detail && e.detail.company) || "").trim();
      if (company) { setIncoming({ id: Date.now(), filters: { name_contains: company } }); setFindOpened(true); setView("find_leads"); }
    };
    window.addEventListener("outreach-find", onFind);
    if (window.__outreachFind) { onFind({ detail: { company: window.__outreachFind } }); window.__outreachFind = ""; } // asked before this app loaded
    return () => window.removeEventListener("outreach-find", onFind);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { // a draft the assistant (or "Get started") opened while the person was elsewhere: it waited for Leads to start
    const take = () => {
      const d = takePendingDraft();
      if (d) { setIncoming({ id: Date.now(), filters: d.filters || {}, meta: d.meta }); setFindOpened(true); setView("find_leads"); }
    };
    take();
    window.addEventListener(DRAFT_EVENT, take); // and one sent while Leads is already open
    return () => window.removeEventListener(DRAFT_EVENT, take);
  }, []);

  const toastTimer = useRef(0);
  const showToast = useCallback((msg) => {
    clearTimeout(toastTimer.current);
    setToastMessage(msg);
    toastTimer.current = setTimeout(() => setToastMessage(null), 3500);
  }, []);
  useEffect(() => {
    const onNotice = (e) => showToast(e.detail);
    window.addEventListener(NOTICE_EVENT, onNotice);
    return () => { window.removeEventListener(NOTICE_EVENT, onNotice); clearTimeout(toastTimer.current); };
  }, [showToast]);
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

  // A new message to one address, asked for from anywhere (the email shortcut on a list row): Mail opens with it filled in.
  // It opens as a popup over the current page; closing keeps the text in Drafts, Discard throws it away.
  const [quickMail, setQuickMail] = useState(null); // { to, boxes } while the popup is open
  useEffect(() => {
    const onWrite = (e) => {
      const to = String(e.detail || "");
      if (!to) return;
      if (embedViews && !embedViews.includes("mail")) { window.location.href = `mailto:${to}`; return; }
      api.mailMailboxes()
        .then((r) => {
          const boxes = r.mailboxes || [];
          if (!boxes.length) { window.location.href = `mailto:${to}`; return; }
          setQuickMail({ to, boxes });
        })
        .catch(() => { window.location.href = `mailto:${to}`; });
    };
    window.addEventListener(WRITE_EMAIL_EVENT, onWrite);
    return () => window.removeEventListener(WRITE_EMAIL_EVENT, onWrite);
  }, [embedViews]);

  // "Open this journey" from a company's bottom bar, in the side panel or the Find Leads drawer: close the panel and show it on Journeys.
  useEffect(() => {
    const onOpen = (e) => {
      const id = String(e.detail || "");
      setOpenAccount(null);
      if (id) openJourney(id); else startJourney();
    };
    window.addEventListener(OPEN_JOURNEY_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_JOURNEY_EVENT, onOpen);
  });

  // Pages of the app (plan 13): the everyday work in the menu, the setup under Settings. The AI Assistant is the header's button
  // (the same chat); only a partner's embed, which has no header of ours, lists it as a page.
  const navItems = onlyEmbedViews([
    ...(embedViews ? [{ id: "assistant", label: "AI Assistant", short: "Ask", icon: Bot, group: "Outreach", embedIds: ["assistant"] }] : []),
    { id: "find_leads", label: "Find Leads", short: "Find", icon: Sparkles, group: "Outreach" },
    { id: "lists", label: "Lists", short: "Lists", icon: ListChecks, count: store.accounts.length || null, group: "Outreach", embedIds: ["lists", "saved_people", "saved_companies"] }, // Companies and People are tabs on the same page
    { id: "outreach", label: "Journeys", icon: Route, group: "Outreach" },
    { id: "mail", label: "Mail", icon: Mail, group: "Outreach", embedIds: ["mail", "mailboxes"] }, // its Email accounts page is under Settings
    { id: "inbound_forms", label: "Forms", icon: FileText, group: "Outreach", title: "Web forms that turn visitors into leads" },
    { id: "connectors", label: "Connectors", short: "Connectors", icon: Plug, group: "Settings", title: "Where your leads' data comes from, and what's switched on" },
    { id: "mailboxes", label: "Email accounts", icon: Mail, group: "Settings", title: "Connect the email accounts you send from, warm them up and check their health" },
    { id: "business", label: "About your business", icon: Building2, group: "Settings", title: "What the AI may say about you, and who your ideal customer is" },
    { id: "workflows", label: "Workflows", icon: Workflow, group: "Settings", title: "When something happens, do something automatically" },
    ...(showDataAccess ? [{ id: "administration", label: "Administration", icon: Shield, group: "Settings", title: "Users, roles and what each person can see and do" }] : []),
    { id: "subscription", label: "Plan & credits", icon: Wallet, group: "Settings", title: "Your Leads plan and credits" },
  ], embedViews);
  const [workGroup, setupGroup] = [["Outreach"], ["Settings"]].map(([label]) => ({
    label,
    items: navItems.filter((item) => item.group === label).map((item) => ({
      id: item.id,
      label: item.label,
      short: item.short,
      icon: item.icon,
      external: item.external,
      count: item.count,
      active: view === item.id || (item.id === "administration" && view === "data_access") || (item.id === "lists" && SAVED_VIEWS.includes(view)),
      locked: isLocked && item.id !== "subscription",
      title: isLocked && item.id !== "subscription" ? "Choose a plan or top up to unlock this" : `Open ${item.label}`,
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
          // Opens on Mail, or on Email accounts when that is the only half this screen may show (Email accounts is under Settings)
          setView(embedViews && !embedViews.includes("mail") ? "mailboxes" : "mail");
          return;
        }
        setView(item.id);
      },
    })),
  }));

  const viewTitles = {
    assistant: { title: "AI Assistant", desc: "Ask in plain words. It reads your companies, journeys and mailboxes, and does nothing that costs credits until you confirm." },
    find_leads: { title: "Find Leads", desc: "Every company on the register, best profiles first. Filter them, or ask the AI Assistant." },
    saved_people: { title: "Lists · People", desc: "Every person at the companies you saved: who they are, how to reach them, and where each company stands." },
    saved_companies: { title: "Lists · Companies", desc: "Every company you saved or imported, whichever list it is in. Check and improve them, then start a journey." },
    lists: { title: "Lists", desc: "Everything you save or import lands in a list. Get contact details, fix what is wrong, then start a journey." },
    outreach: { title: "Journeys", desc: "A path through emails, calls and tasks for each person: set it up once, and it stops when they reply, book or opt out." },
    mail: { title: "Inbox and sent", desc: "Everything your journeys sent and got back: replies, sent emails and the do-not-email list." },
    inbound_forms: { title: "Forms", desc: "Build a web form, share its link, and every answer with a working email becomes a lead in the list you choose." },
    import_match: { title: "Import & match", desc: "Upload your customer records, match them to the Companies House register, and confirm the ones we are not sure about." },
    changes: { title: "Monthly changes", desc: "What changed each month at the companies you follow: status, name, address, directors and insolvency notices." },
    connectors: { title: "Connectors", desc: "Data enrichment sources, CRM integrations and custom AI engine connections." },
    retention: { title: "Review old contacts", desc: "Companies nobody has contacted for 12 months. Keep what you need and delete the rest." },
    mailboxes: { title: "Email accounts", desc: "Connect the email accounts you send from, warm them up, and keep their sender reputation healthy." },
    data_access: { title: "Data access", desc: "Choose what each person in your organisation can see and do. Admins always see everything." },
    administration: { title: "Administration", desc: "Add users, set their roles and permissions, and choose what each person can see and do." },
    member_list: { title: "Member list", desc: "Companies on this list never appear as prospects." },
    business: { title: "About your business", desc: "What the AI may say about you when it writes emails, and who your ideal customer is. It is your company profile, shared with your other Outreach tools." },
    subscription: { title: "Plan & credits", desc: "Your Leads plan and credits. Change plan, top up, or cancel." },
  };

  return (
    <div className={nav.open ? "app-shell is-nav-open" : "app-shell"} style={{ display: "flex", height: "100vh", background: HUB_PAPER, fontFamily: FONT_BODY, overflow: "hidden" }}>
      <MobileNavBackdrop nav={nav} />
      
      <AppChrome />
      <PluginSidebar appId="leadgen" name="Leads" icon={Search} accent={LEADS_ACCENT} groups={[embedViews ? { ...workGroup, items: [...workGroup.items, ...setupGroup.items] } : workGroup]} settings={embedViews ? null : setupGroup.items} wallet="leadgen" operator={operator}
        onOpenPlan={() => setView("subscription")} onHome={onBackToHub} onLogout={onLogout} refreshKey={view} nav={nav} tabs={["find_leads", "lists", "outreach", "mail"]} />

      {/* ----------------- RIGHT WORKSPACE AREA ----------------- */}
      <div className="app-main" style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, height: "100vh" }}>
        
        <PluginHeader assistant={false} nav={nav} title={viewTitles[view]?.title || "Leads"} sub={viewTitles[view]?.desc || ""}
          accountBar={accountBar ? cloneElement(accountBar, { wallet: !isLocked || view === "subscription" ? "leadgen" : null, app: "Leads", onOpenPlan: () => setView("subscription") }) : null}>
          {view === "find_leads" && !isLocked && !embedViews ? (
            <button
              type="button"
              className="ui-btn ui-btn--secondary ui-btn--sm phone-gone"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontWeight: 600,
                background: C.surface,
                border: "1px solid var(--ui-line, #E2E8F0)",
                boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
              }}
              title="Import spreadsheet of companies"
              onClick={goImport}
            >
              <Upload size={14} /> Import
            </button>
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
              <Banner tone="info" icon={Lock} title="Subscription required">Choose a plan or buy a top-up below to unlock Leads.</Banner>
              <SubscriptionPage wallet="leadgen" back="/leadgen/subscription" />
            </div>
          ) : (
            <>
          {(findOpened || view === "find_leads") && (
            <div className="fl-host" style={view === "find_leads" ? undefined : { display: "none" }}><FindLeadsView access={access} isAdmin={isAdminOperator(operator)} store={store} listsStore={listsStore} onGo={goTo} incoming={incoming} importAsk={importAsk} onAskAssistant={() => setAssistantOpen(true)} onOpenCompany={openCompany} /></div>
          )}


          {view === "assistant" && !embedViews && (
            <AssistantPanel page open onClose={() => goTo("find_leads")} onGo={goTo} store={store} onImport={goImport}
              lists={listsStore.lists.map((l) => ({ id: l.id, name: l.name, count: (l.ids || []).length }))}
              onOpenList={() => goTo("lists")} onCampaign={startJourney} onOpenJourney={openJourney} onOpenCompany={openCompany} seed={assistantSeed}
              onShowResults={(filters, meta) => { setIncoming({ id: Date.now(), filters, meta }); setFindOpened(true); setView("find_leads"); }} />
          )}

          {SAVED_VIEWS.includes(view) && (
            <div style={{ marginBottom: 14 }}>
              <SavedTabs view={view} onChange={setView} counts={{ lists: listsStore.lists.length, saved_companies: store.accounts.length, saved_people: savedPeopleCount }} />
            </div>
          )}

          {view === "saved_people" && <SavedPeople store={store} onOpen={setOpenAccount} onGo={goTo} />}

          {(view === "saved_companies" || view === "lists") ? <AccessNotice message={store.accessNotice || listsStore.accessNotice} /> : null}
          {(view === "saved_companies" || view === "lists") && access.exportOff ? <p role="status" style={{ margin: "0 0 10px", fontSize: 13, color: "#4B5260" }}>{EXPORT_OFF_LINE}</p> : null}

          {view === "saved_companies" && <AccountsView canExport={isAdminOperator(operator) || !access.exportOff} store={store} listsStore={listsStore} onOpen={setOpenAccount} onAdd={() => setShowAddModal(true)} onGo={goTo} onCampaign={startJourney} onOpenJourney={openJourney} />}

          {view === "lists" && <ListsView canExport={isAdminOperator(operator) || !access.exportOff} store={store} listsStore={listsStore} onGo={goTo} onOpen={setOpenAccount} onAdd={() => setShowAddModal(true)} onCampaign={startJourney} onOpenJourney={openJourney} />}

          {view === "account" && accountPageId && (store.accounts.find((a) => a.id === accountPageId)
            ? <AccountPanel key={accountPageId} page account={store.accounts.find((a) => a.id === accountPageId)} store={store}
                onClose={() => goBack("saved_companies")} onOpenRegister={openCompany} />
            : <div style={{ padding: 24 }}>{store.loading ? "Loading…" : "That company is no longer in your account."}</div>)}
          {view === "company" && companyId && (
            <CompanyPage key={companyId} id={companyId} store={store} onBack={() => goBack("find_leads")} onGo={goTo} onAskAi={askAbout} onOpenJourney={openJourney} />
          )}

          {view === "outreach" && (wizard
            ? <NewCampaign store={store} listsStore={listsStore} outreach={outreach} initialListId={wizard.listId}
                onOpenBusiness={() => { setWizard(null); setView("business"); }} onOpenMailboxes={() => { setWizard(null); setView("mailboxes"); }} onOpenLists={() => { setWizard(null); setView("lists"); }}
                onCancel={() => setWizard(null)} onDone={() => { setWizard(null); outreach.reloadCampaigns(); }} />
            : <JourneysView outreach={outreach} listsStore={listsStore} onGo={goTo} onAskAssistant={() => setAssistantOpen(true)} onGuided={() => setWizard({ listId: "" })}
                initialId={journeyId} initialListId={journeyList} onConsumed={() => setJourneyList("")} />)}

          {quickMail ? (
            <Compose boxes={quickMail.boxes} start={{ mailbox_id: quickMail.boxes[0].id, to: quickMail.to }}
              onClose={(drafted) => { setQuickMail(null); if (drafted) notice("Kept in Drafts."); }}
              onSent={() => { setQuickMail(null); notice("Sent."); }} />
          ) : null}
          {view === "mail" && <MailView operator={operator} outreach={outreach} start={inboxStart} key={inboxStart ? `${inboxStart.sub}${inboxStart.mailboxId || ""}` : "mail"} />}

          {view === "mailboxes" && <MailboxesView outreach={outreach} onViewSent={(id) => { setInboxStart({ sub: "sent", mailboxId: id }); setView("mail"); }} />}
          {view === "inbound_forms" && <InboundFormsView toast={showToast} onOpenLead={async (id) => { await Promise.all([store.reload(), listsStore.reload()]); setWantedLead(id); setView("saved_companies"); }} />}
          {view === "import_match" && !embedViews && canUseRecords(operator) && <ImportMatchView operator={operator} toast={showToast} onReviewCount={setReviewWaiting} />}
          {view === "changes" && !embedViews && canUseRecords(operator) && <MonthlyChangesView toast={showToast} />}
          {view === "connectors" && !embedViews && <ConnectorsView />}
          {view === "retention" && !embedViews && <RetentionReview toast={showToast} onGo={goTo} />}
          {view === "business" && <ProfileBox page />}
          {view === "member_list" && memberSuppression && operator?.is_admin && <MemberList toast={showToast} />}
          {view === "data_access" && showDataAccess && <DataAccess />}
          {view === "administration" && showDataAccess && <AdministrationView operator={operator} />}

          {(!KNOWN_VIEWS.includes(view) || ((view === "data_access" || view === "administration") && !showDataAccess)) && (
            <div role="alert" style={{ padding: "48px 16px", display: "grid", gap: 10, justifyItems: "start", maxWidth: 520 }}>
              <h2 style={{ margin: 0, fontSize: 20 }}>Page not found</h2>
              <p style={{ margin: 0, color: "#4B5260" }}>There is no page at this address. It may have moved, or the link may be mistyped.</p>
              <button type="button" className="ui-btn ui-btn--primary" onClick={() => setView("find_leads")}>Back to Find Leads</button>
            </div>
          )}
          {view === "subscription" && operator?.is_admin && <SubscriptionPage wallet="leadgen" back="/leadgen/subscription" />}
            </>
          )}
        </div>

      </div>

      {!isLocked && !embedViews && view !== "assistant" ? (
        <AssistantPanel workspace={() => ({ screen: workflowsOpenNow() ? WORKFLOWS_HEADER[0] : (viewTitles[view]?.title || "") })} open={assistantOpen} onClose={() => setAssistantOpen(false)} onGo={goTo} store={store} onImport={goImport} onExpand={() => { setAssistantOpen(false); setView("assistant"); }}
          lists={listsStore.lists.map((l) => ({ id: l.id, name: l.name, count: (l.ids || []).length }))}
          onOpenList={() => goTo("lists")} onCampaign={startJourney} onOpenJourney={openJourney} onOpenCompany={openCompany} seed={assistantSeed}
          onShowResults={(filters, meta) => { setIncoming({ id: Date.now(), filters, meta }); setFindOpened(true); setView("find_leads"); if (window.innerWidth <= 820) setAssistantOpen(false); }} />
      ) : null}

      {openAccount && <AccountPanel key={openAccount.id} account={openAccount} store={store} onClose={() => setOpenAccount(null)} onOpenPage={openAccountPage} />}

      {showAddModal && <AddAccountForm store={store} onClose={() => setShowAddModal(false)} />}

      {/* Toast */}
      <DialogHost />
      <Toast message={toastMessage} />

    </div>
  );
}
