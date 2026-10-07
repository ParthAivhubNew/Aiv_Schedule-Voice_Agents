import { ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";
import { C, FONT_BODY } from "../app/constants";
import { AppChrome } from "../app/ui";
import { api } from "../api/apiClient";
import { fmt, money } from "../team/CreditsTab";
import { navigateHash } from "../utils/route";
import { APPS } from "./apps";
import { BillingReturnBanner } from "./BillingReturnBanner";
import { BrandLockup } from "./BrandMark";
import { UserProfileMenu } from "./PluginHub";

const LIVE_PLAN = ["active", "past_due", "trialing"];
const line = { fontFamily: FONT_BODY, fontSize: 13, fontWeight: 500, fontVariantNumeric: "tabular-nums", margin: 0 };

// One app of the suite. `state` (admins only) says whether the organisation has a plan for it,
// what is left in its wallet and what a plan starts at.
function AppCard({ app, state, unit, onOpen, onPlans }) {
  const Icon = app.icon;
  const { wallet, plan, from, canBuy, vat } = state;
  const left = wallet ? Math.max(wallet.balance, 0) : 0;
  const credits = wallet && (wallet.empty || left > 0)
    ? (wallet.empty ? "Out of credits: paused until you top up" : `${fmt(left)} ${unit} left${plan ? "" : " to try it"}`)
    : "";
  const price = !plan && from ? `From ${money(from.priceUsdCents, from.currency)}/month${vat}` : "";
  return (
    <div className="ui-card app-card" style={{ "--accent": app.accent, padding: 20, display: "flex", flexDirection: "column", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <div style={{ width: 40, height: 40, borderRadius: 6, background: `${app.accent}14`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Icon size={20} color={app.accent} />
        </div>
        {plan ? (
          <span style={{ fontFamily: FONT_BODY, fontSize: 12, fontWeight: 500, borderRadius: 999, padding: "3px 10px", whiteSpace: "nowrap", color: C.green, background: C.greenSoft }}>
            {plan.name}
          </span>
        ) : null}
      </div>
      <div style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: 16, color: C.ink, marginTop: 14 }}>{app.name}</div>
      <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.slate, marginTop: 2 }}>{app.role}</div>
      <p style={{ fontFamily: FONT_BODY, fontSize: 13.5, color: C.slate, margin: "12px 0 0", lineHeight: 1.5, flex: 1 }}>{app.blurb}</p>
      <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.border}`, display: "flex", flexDirection: "column", gap: 12 }}>
        {price || credits ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {price ? <p style={{ ...line, color: C.textInk }}>{price}</p> : null}
            {credits ? <p style={{ ...line, color: wallet.empty ? C.red : wallet.low ? C.amber : plan ? C.textInk : C.slate }}>{credits}</p> : null}
          </div>
        ) : null}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {plan || !canBuy ? (
            <>
              <button type="button" className="ui-btn ui-btn--primary" onClick={onOpen}>Open <ArrowRight size={15} /></button>
              {plan && <button type="button" className="ui-btn ui-btn--ghost" onClick={onPlans}>Manage plan</button>}
            </>
          ) : (
            <>
              <button type="button" className="ui-btn ui-btn--secondary" onClick={onPlans}>See plans</button>
              <button type="button" className="ui-btn ui-btn--ghost" onClick={onOpen}>Try it</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Home: the apps of the suite side by side. The ones the organisation has a plan for come first;
// the others can be opened to try and added at any time.
export function AppHome({ operator, onPick, onLogout, commonAi, onOpenCommonAi, onOpenTeamUsers, onOpenProfileSettings, onOpenCalcomAdmin, onOpenDeveloperKeys }) {
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

  return (
    <div style={{ minHeight: "100vh", background: C.paper, fontFamily: FONT_BODY }}>
      <AppChrome />
      <header style={{ height: 60, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "0 clamp(16px, 4vw, 32px)", background: "#fff", borderBottom: `1px solid ${C.border}` }}>
        <BrandLockup size={30} />
        <UserProfileMenu
          operator={operator}
          onLogout={onLogout}
          commonAi={commonAi}
          onOpenCommonAi={onOpenCommonAi}
          onOpenTeamUsers={onOpenTeamUsers}
          onOpenProfileSettings={onOpenProfileSettings}
          onOpenCalcomAdmin={onOpenCalcomAdmin}
          onOpenDeveloperKeys={onOpenDeveloperKeys}
        />
      </header>

      <main style={{ width: "100%", maxWidth: 1080, boxSizing: "border-box", margin: "0 auto", padding: "clamp(24px, 5vw, 44px) clamp(16px, 4vw, 32px) 64px" }}>
        <h1 style={{ fontWeight: 600, fontSize: "clamp(22px, 3vw, 26px)", color: C.ink, letterSpacing: "-0.02em", margin: 0 }}>
          {firstName ? `Welcome back, ${firstName}` : "Welcome back"}
        </h1>
        <p style={{ fontSize: 14, color: C.slate, margin: "6px 0 24px", lineHeight: 1.5 }}>
          {mine.length ? "Open an app to pick up where you left off." : "Pick an app to get started."}
        </p>

        <BillingReturnBanner />

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))", gap: 16 }}>
          {[...mine, ...rest].map(card)}
        </div>
        {billing && rest.length > 0 && (
          <p style={{ fontSize: 13, color: C.slateLight, margin: "16px 0 0" }}>
            Each app has its own plan. You can open any app to try it before you buy.
          </p>
        )}
      </main>
    </div>
  );
}
