import { ArrowRight, BookOpen, ExternalLink, Headset, Smartphone, Workflow } from "lucide-react";
import { useEffect, useState } from "react";
import { C, FONT_BODY } from "../app/constants";
import { AppChrome } from "../app/ui";
import { api } from "../api/apiClient";
import { fmt, money } from "../team/CreditsTab";
import { navigateHash } from "../utils/route";
import { openWorkflows } from "../workflows/openWorkflows";
import { openSupport } from "./openSupport";
import { APPS } from "./apps";
import { NextStep } from "./OnboardingChecklist";
import { settingsHashForTeam } from "./settingsPages";
import { BillingReturnBanner } from "./BillingReturnBanner";
import { BrandLockup } from "./BrandMark";
import { UserProfileMenu } from "./PluginHub";
import { planName } from "./planName";
import { InstallStepsSheet } from "../components/InstallSteps";
import { useShowInstallSteps } from "../components/installState";
import { useBodyClass, usePhone } from "../components/usePhone";

const LIVE_PLAN = ["active", "past_due", "trialing"];
const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))", gap: 16 };
const sectionHead = { fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, color: C.slate, margin: "0 0 10px" };
const line = { fontFamily: FONT_BODY, fontSize: 13, fontWeight: 500, fontVariantNumeric: "tabular-nums", margin: 0 };

// A person's first visit is a hello, not a welcome back.
const greeting = (firstName, needsName, firstVisit) => {
  const named = firstName && !needsName;
  if (firstVisit) return named ? `Hi, ${firstName}` : "Hi there";
  return named ? `Welcome back, ${firstName}` : "Welcome back";
};

// What a card or tile says about an app, in plain words (plan 13, 3.3). An app you have: its credits, or its plan. Running out is
// amber with a way to top up, not red. An app you haven't added is an offer in neutral colours, never "Out of credits".
export function appStatus(state, unit) {
  const { wallet, plan, from, vat = "" } = state || {};
  const left = wallet ? Math.max(wallet.balance, 0) : 0;
  if (plan) {
    if (wallet && wallet.empty) return { text: "Out of credits: top up to carry on", tone: "amber" };
    if (left > 0) return { text: `${fmt(left)} ${unit} left`, tone: wallet.low ? "amber" : "ink" };
    return { text: planName(plan.name), tone: "ink" };
  }
  if (!wallet && !from) return null; // nothing known (not an admin): just the app
  if (left > 0 && !wallet.empty) return { text: `${fmt(left)} ${unit} left to try it`, tone: "muted" };
  if (from) return { text: `From ${money(from.priceUsdCents, from.currency)}/month${vat}`, tone: "muted" };
  return { text: "Not added yet", tone: "muted" };
}
const TONE = { ink: C.textInk, amber: C.amber, muted: C.slate };

// One app of the suite. `state` (admins only) says whether the organisation has a plan for it, what is left in its wallet and what a
// plan starts at. One button each: Open for an app you have (or when plans aren't for you to buy), See plans for one you haven't added,
// with a quiet "or try it first" beside it.
function AppCard({ app, state, unit, onOpen, onPlans }) {
  const Icon = app.icon;
  const { plan, canBuy } = state;
  const offer = !plan && canBuy;
  const status = appStatus(state, unit);
  return (
    <div className="ui-card app-card" style={{ "--accent": app.accent, padding: 20, display: "flex", flexDirection: "column", minWidth: 0, background: offer ? C.paperSoft : undefined }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ width: 40, height: 40, borderRadius: 8, background: offer ? C.surface : `${app.accent}14`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Icon size={20} color={offer ? C.slate : app.accent} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: 16, color: C.ink }}>{offer ? `Add ${app.name}` : app.name}</div>
          <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.slate }}>{app.role}</div>
        </div>
      </div>
      <p style={{ fontFamily: FONT_BODY, fontSize: 13.5, color: C.slate, margin: "12px 0 0", lineHeight: 1.5, flex: 1 }}>{app.blurb}</p>
      <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        {status ? <p style={{ ...line, flex: "1 1 140px", color: TONE[status.tone] }}>{status.text}</p> : <span style={{ flex: 1 }} />}
        {offer ? (
          <>
            <button type="button" className="ui-btn ui-btn--link" onClick={onOpen} style={{ all: "unset", cursor: "pointer", fontFamily: FONT_BODY, fontSize: 13, color: C.slate, textDecoration: "underline" }}>or try it first</button>
            <button type="button" className="ui-btn ui-btn--secondary" onClick={onPlans}>See plans</button>
          </>
        ) : (
          <button type="button" className="ui-btn ui-btn--primary" onClick={plan && state.wallet?.empty ? onPlans : onOpen}>
            {plan && state.wallet?.empty ? "Top up" : <>Open <ArrowRight size={15} /></>}
          </button>
        )}
      </div>
    </div>
  );
}

// Phone Home: the three apps as large tiles, two on top and one centred below, on one screen with
// nothing to scroll. The tiles keep one order (they do not shuffle once plans load under a finger about to tap).
// Each tile opens its app; plans and credits are in the profile menu and inside the app.
function PhoneHome({ operator, firstName, needsName, firstVisit, apps, statusOf, onPick, menuProps }) {
  const [installOpen, setInstallOpen] = useState(false);
  const installable = useShowInstallSteps();
  useBodyClass("phone-home-on");
  return (
    <div className="phone-home" style={{ display: "flex", flexDirection: "column", background: C.paper, fontFamily: FONT_BODY }}>
      <AppChrome />
      <header style={{ height: 56, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "0 16px", background: C.surface, borderBottom: `1px solid ${C.border}` }}>
        <BrandLockup size={28} />
        <UserProfileMenu operator={operator} compact {...menuProps} />
      </header>
      <main style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: "20px 16px calc(16px + env(safe-area-inset-bottom))", boxSizing: "border-box" }}>
        <h1 style={{ fontWeight: 600, fontSize: 22, color: C.ink, letterSpacing: "-0.02em", margin: 0 }}>
          {greeting(firstName, needsName, firstVisit)}
        </h1>
        <p style={{ fontSize: 15, color: C.slate, margin: "4px 0 0" }}>{firstVisit ? "Good to have you here. Pick an app to get started." : "Choose an app to open."}</p>
        <BillingReturnBanner />
        <div className="home-triangle">
          {apps.map((app, i) => {
            const Icon = app.icon;
            const status = statusOf(app);
            return (
              <button key={app.id} type="button" className={i === 2 ? "home-tile home-tile--base" : "home-tile"} onClick={() => onPick(app.id)} style={{ "--accent": app.accent }}>
                <span className="home-tile-icon" style={{ background: `${app.accent}14` }}>
                  <Icon size={28} color={app.accent} />
                </span>
                <span style={{ fontSize: 18, fontWeight: 700, color: C.ink }}>{app.name}</span>
                <span style={{ fontSize: 14, color: C.slate }}>{app.role}</span>
                {status ? <span style={{ fontSize: 13, fontWeight: 500, color: status.tone }}>{status.text}</span> : null}
              </button>
            );
          })}
        </div>
        {installable ? (
          <button type="button" onClick={() => setInstallOpen(true)} style={{ minHeight: 48, border: `1px solid ${C.border}`, borderRadius: 12, background: C.surface, color: C.cobalt, fontFamily: FONT_BODY, fontSize: 15, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, cursor: "pointer" }}>
            <Smartphone size={18} /> Get the app on your phone
          </button>
        ) : null}
        <InstallStepsSheet open={installOpen} onClose={() => setInstallOpen(false)} />
      </main>
    </div>
  );
}

// Home: the apps of the suite side by side. The ones the organisation has a plan for come first;
// the others can be opened to try and added at any time.
export function AppHome({ operator, onPick, onLogout, commonAi, onOpenCommonAi, onOpenProfileSettings, onOpenSettings }) {
  const phone = usePhone();
  // Plans and credits are for admins; everyone else simply sees the apps.
  const [billing, setBilling] = useState(null);
  useEffect(() => {
    if (!operator?.is_admin) return;
    api.getBillingOverview().then(setBilling).catch(() => setBilling(null));
  }, [operator]);

  const held = billing && LIVE_PLAN.includes(billing.subscription.status) ? billing.subscription.plans : {};
  const stateOf = (app) => {
    if (!billing) return {};
    const onSale = billing.stripeReady && app.plans ? billing.plans.filter((p) => p.wallet === app.wallet) : [];
    const monthly = onSale.filter((p) => p.kind === "plan").sort((a, b) => a.priceUsdCents - b.priceUsdCents);
    return { wallet: billing.wallets.find((w) => w.key === app.wallet), plan: billing.plans.find((p) => p.id === held[app.wallet]), from: monthly[0], canBuy: onSale.length > 0, vat: billing.taxAdded ? " + VAT" : "" };
  };
  const unitOf = (app) => (app.wallet === "voice" && billing?.rates.voice_minute?.credits === 1 ? "minutes of calls" : "credits");
  const card = (app) => (
    <AppCard key={app.id} app={app} state={stateOf(app)} unit={unitOf(app)} onOpen={() => onPick(app.id)} onPlans={() => navigateHash(app.plans)} />
  );
  const mine = APPS.filter((app) => stateOf(app).plan);
  const rest = APPS.filter((app) => !mine.includes(app));
  const firstName = String(operator?.name || "").trim().split(/\s+/)[0];
  // A name that is only the login (admin, the username) is not a real name: ask for one.
  const needsName = !firstName || [operator?.username, "admin", "administrator"].some((n) => n && firstName.toLowerCase() === String(n).toLowerCase());

  const firstVisit = Boolean(operator?.first_visit);

  const menuProps = { onLogout, commonAi, onOpenCommonAi, onOpenProfileSettings, onOpenSettings };
  const statusOf = (app) => {
    const st = appStatus(stateOf(app), unitOf(app) === "credits" ? "credits" : "minutes");
    return st ? { text: st.text.split(":")[0], tone: TONE[st.tone] } : null; // a tile has room for the first half only
  };
  if (phone) {
    return <PhoneHome operator={operator} firstName={firstName} needsName={needsName} firstVisit={firstVisit} apps={APPS} statusOf={statusOf} onPick={onPick} menuProps={menuProps} />;
  }

  return (
    <div style={{ minHeight: "100vh", background: C.paper, fontFamily: FONT_BODY }}>
      <AppChrome />
      <header style={{ height: 60, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "0 clamp(16px, 4vw, 32px)", background: C.surface, borderBottom: `1px solid ${C.border}` }}>
        <BrandLockup size={30} />
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button type="button" className="ui-btn ui-btn--ghost hide-mobile" onClick={() => openSupport({ plugin: "home" })} title="Support">
            <Headset size={16} /> Support
          </button>
          <button type="button" className="ui-btn ui-btn--ghost hide-mobile" onClick={() => window.open("/help", "_blank")} title="Documentation">
            <BookOpen size={16} /> Documentation <ExternalLink size={12} style={{ color: C.slate }} />
          </button>
          <UserProfileMenu
            operator={operator}
            onLogout={onLogout}
            commonAi={commonAi}
            onOpenCommonAi={onOpenCommonAi}
            onOpenProfileSettings={onOpenProfileSettings}
            onOpenSettings={onOpenSettings}
          />
        </div>
      </header>

      <main style={{ width: "100%", maxWidth: 1080, boxSizing: "border-box", margin: "0 auto", padding: "clamp(24px, 5vw, 44px) clamp(16px, 4vw, 32px) 64px" }}>
        <h1 style={{ fontWeight: 600, fontSize: "clamp(22px, 3vw, 26px)", color: C.ink, letterSpacing: "-0.02em", margin: 0 }}>
          {greeting(firstName, needsName, firstVisit)}
        </h1>
        <p style={{ fontSize: 14, color: C.slate, margin: "6px 0 24px", lineHeight: 1.5 }}>
          {firstVisit ? "Good to have you here. Pick an app to get started." : mine.length ? "Open an app to pick up where you left off." : "Pick an app to get started."}
          {needsName && onOpenProfileSettings ? (
            <> <button type="button" onClick={onOpenProfileSettings} style={{ all: "unset", cursor: "pointer", color: C.cobalt, fontWeight: 500 }}>Add your name</button> so we can greet you.</>
          ) : null}
        </p>
        <NextStep operator={operator} onGo={(go) => navigateHash(String(go).startsWith("team:") ? settingsHashForTeam(String(go).slice(5)) : go)} />

        <BillingReturnBanner />

        {mine.length && rest.length ? <h2 style={sectionHead}>Your apps</h2> : null}
        {mine.length ? <div style={grid}>{mine.map(card)}</div> : null}
        {rest.length ? (
          <>
            {mine.length ? <h2 style={{ ...sectionHead, marginTop: 28 }}>More apps</h2> : null}
            <div style={grid}>{rest.map(card)}</div>
          </>
        ) : null}
        <button type="button" onClick={() => openWorkflows({})} className="ui-card" style={{ all: "unset", boxSizing: "border-box", cursor: "pointer", display: "flex", alignItems: "center", gap: 14, width: "100%", marginTop: 16, padding: "16px 18px", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14 }}>
          <span aria-hidden="true" style={{ width: 40, height: 40, borderRadius: 10, background: C.cobaltSoft, color: C.cobalt, display: "inline-flex", alignItems: "center", justifyContent: "center" }}><Workflow size={20} /></span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "block", fontWeight: 600, fontSize: 15, color: C.ink }}>Workflows</span>
            <span style={{ display: "block", fontSize: 13, color: C.slate, marginTop: 2 }}>Do things automatically across your apps: when a call ends, someone replies or a meeting is booked.</span>
          </span>
        </button>
      </main>
    </div>
  );
}
