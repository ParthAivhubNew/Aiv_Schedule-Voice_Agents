import { ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";
import { C, FONT_BODY, FONT_DISPLAY, HUB_PAPER } from "../app/constants";
import { AppChrome } from "../app/ui";
import { api } from "../api/apiClient";
import { fmt, money } from "../team/CreditsTab";
import { navigateHash } from "../utils/route";
import { APPS } from "./apps";
import { BillingReturnBanner } from "./BillingReturnBanner";
import { BrandMark } from "./BrandMark";
import { OnboardingChecklist } from "./OnboardingChecklist";
import { UserProfileMenu } from "./PluginHub";

const LIVE_PLAN = ["active", "past_due", "trialing"];
const pill = { fontFamily: FONT_BODY, fontSize: 11.5, fontWeight: 700, borderRadius: 999, padding: "4px 10px", whiteSpace: "nowrap" };
const action = (primary) => ({
  display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 14px", borderRadius: 10, cursor: "pointer",
  fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600,
  border: primary ? `1px solid ${C.ink}` : `1px solid ${C.border}`, background: primary ? C.ink : "#fff", color: primary ? "#fff" : C.textInk,
});

// One app of the suite. `state` (admins only) says whether the organisation has a plan for it,
// what is left in its wallet and what a plan starts at.
function AppCard({ app, state, unit, onOpen, onPlans }) {
  const Icon = app.icon;
  const { wallet, plan, from, canBuy } = state;
  const left = wallet ? Math.max(wallet.balance, 0) : 0;
  return (
    <div className="app-card" style={{ "--accent": app.accent, background: "#fff", border: `1px solid ${C.border}`, borderRadius: 18, padding: 20, display: "flex", flexDirection: "column", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 14 }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: `${app.accent}18`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Icon size={21} color={app.accent} strokeWidth={2.1} />
        </div>
        {plan ? <span style={{ ...pill, color: app.accent, background: `${app.accent}14` }}>{plan.name}</span>
          : from ? <span style={{ ...pill, color: C.slate, background: C.paperSoft }}>From {money(from.priceUsdCents, from.currency)}/month</span> : null}
      </div>
      <div style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: C.slateLight, marginBottom: 4 }}>{app.role}</div>
      <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 19, color: C.ink, letterSpacing: "-0.02em", lineHeight: 1.2 }}>{app.name}</div>
      <div style={{ fontFamily: FONT_BODY, fontSize: 13.5, color: C.slate, marginTop: 8, lineHeight: 1.5, flex: 1 }}>{app.blurb}</div>
      {wallet && (wallet.empty || left > 0) && (
        <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, marginTop: 12, color: wallet.empty ? C.red : wallet.low ? C.amber : C.textInk }}>
          {wallet.empty ? "Out of credits: paused until you top up" : `${fmt(left)} ${unit} left${plan ? "" : " to try it"}`}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
        {plan || !canBuy ? (
          <>
            <button type="button" style={action(true)} onClick={onOpen}>Open <ArrowRight size={14} /></button>
            {plan && <button type="button" style={action(false)} onClick={onPlans}>Manage plan</button>}
          </>
        ) : (
          <>
            <button type="button" style={action(true)} onClick={onPlans}>See plans</button>
            <button type="button" style={action(false)} onClick={onOpen}>Open <ArrowRight size={14} /></button>
          </>
        )}
      </div>
    </div>
  );
}

function AppSection({ title, note, children }) {
  return (
    <section style={{ marginTop: 28 }}>
      <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18, color: C.ink, letterSpacing: "-0.02em" }}>{title}</div>
      {note && <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.slate, marginTop: 2 }}>{note}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 250px), 1fr))", gap: 16, marginTop: 14 }}>{children}</div>
    </section>
  );
}

// Home: the apps of the suite. The ones the organisation has a plan for come first; the others
// can be opened to try and added at any time.
export function AppHome({ operator, onPick, onLogout, commonAi, onOpenCommonAi, onOpenTeamUsers, onOpenProfileSettings, onOpenCalcomAdmin }) {
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
    return { wallet: billing.wallets.find((w) => w.key === app.wallet), plan: billing.plans.find((p) => p.id === held[app.wallet]), from: monthly[0], canBuy: onSale.length > 0 };
  };
  const unitOf = (app) => (app.wallet === "voice" && billing?.rates.voice_minute?.credits === 1 ? "minutes of calls" : "credits");
  const card = (app) => (
    <AppCard key={app.id} app={app} state={stateOf(app)} unit={unitOf(app)} onOpen={() => onPick(app.id)} onPlans={() => navigateHash(app.plans)} />
  );
  const mine = APPS.filter((app) => stateOf(app).plan);
  const rest = APPS.filter((app) => !mine.includes(app));
  const firstName = String(operator?.name || "").trim().split(/\s+/)[0];

  return (
    <div style={{ minHeight: "100vh", background: HUB_PAPER, fontFamily: FONT_BODY }}>
      <AppChrome />
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "16px clamp(16px, 4vw, 36px)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <BrandMark size={32} />
          <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 20, color: C.ink, letterSpacing: "-0.02em", whiteSpace: "nowrap" }}>OutReach<span className="hide-narrow"> by Aivhub</span></span>
        </div>
        <UserProfileMenu
          operator={operator}
          onLogout={onLogout}
          commonAi={commonAi}
          onOpenCommonAi={onOpenCommonAi}
          onOpenTeamUsers={onOpenTeamUsers}
          onOpenProfileSettings={onOpenProfileSettings}
          onOpenCalcomAdmin={onOpenCalcomAdmin}
        />
      </header>

      <main style={{ width: "100%", maxWidth: 1120, margin: "0 auto", padding: "clamp(8px, 3vw, 28px) clamp(16px, 4vw, 36px) 64px" }}>
        <h1 style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: "clamp(24px, 4vw, 32px)", color: C.ink, letterSpacing: "-0.03em", margin: "0 0 8px" }}>
          {firstName ? `Welcome back, ${firstName}` : "Welcome back"}
        </h1>
        <p style={{ fontFamily: FONT_BODY, fontSize: 15, color: C.slate, margin: "0 0 22px", maxWidth: 680, lineHeight: 1.5 }}>
          OutReach is one suite of apps that share your company profile and your team. Use the ones you have, and add the others whenever you need them.
        </p>

        <BillingReturnBanner />
        <OnboardingChecklist
          operator={operator}
          onGo={(go) => {
            if (go.startsWith("team:")) return onOpenTeamUsers(go.slice(5));
            const voice = go.match(/^#\/voice\/(\w+)/);
            if (voice) {
              try { localStorage.setItem("aivhub_voice_view", voice[1]); } catch (_) {}
            }
            navigateHash(go);
          }}
        />

        {mine.length > 0 && <AppSection title="Your apps" note="The apps you have a plan for.">{mine.map(card)}</AppSection>}
        {rest.length > 0 && (
          <AppSection
            title={mine.length > 0 ? "Add to your workspace" : "Your apps"}
            note={billing ? "Each app has its own plan. Open one to try it, and add it when you are ready." : ""}
          >
            {rest.map(card)}
          </AppSection>
        )}
      </main>
    </div>
  );
}
