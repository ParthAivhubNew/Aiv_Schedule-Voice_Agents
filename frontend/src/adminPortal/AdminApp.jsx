import React, { useEffect, useState } from "react";
import { Boxes, ClipboardList, Coins, Handshake, KeyRound, Plug, LayoutDashboard, LogOut, Mail, Palette, PoundSterling, Presentation, ScrollText, ShieldCheck, Sparkles, Users, UserCog, Wallet } from "lucide-react";
import { C, FONT_BODY, FONT_DISPLAY } from "../tokens";
import { STAFF_SIGNED_OUT, adminApi, savedStaff, signOut } from "./adminApi";
import { AlertsBanner } from "./Alerts";
import { Balances } from "./Balances";
import { ApiAccess } from "./ApiAccess";
import { AssistantFeedback } from "./AssistantFeedback";
import { Billing } from "./Billing";
import { Brands } from "./Brands";
import { Clients } from "./Clients";
import { Dashboard } from "./Dashboard";
import { DemoOrgs } from "./DemoOrgs";
import { Logs } from "./Logs";
import { PlatformKeys } from "./PlatformKeys";
import { PlatformMailbox } from "./PlatformMailbox";
import { Partners } from "./Partners";
import { Providers } from "./Providers";
import { Revenue } from "./Revenue";
import { Queue } from "./Queue";
import { SignIn } from "./SignIn";
import { Staff } from "./Staff";
import { PageTitle } from "./ui";

// The staff menu in five groups (plan 13): who our customers are, money, the platform we run, and day-to-day operations.
const PAGES = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, group: "Overview" },
  { id: "clients", label: "Clients", icon: Users, group: "Customers" },
  { id: "demos", label: "Demo organisations", icon: Presentation, group: "Customers" },
  { id: "partners", label: "Partners", icon: Handshake, group: "Customers" },
  { id: "brands", label: "Brands", icon: Palette, group: "Customers" },
  { id: "revenue", label: "Revenue", icon: PoundSterling, group: "Money" },
  { id: "billing", label: "Plans & pricing", icon: Coins, group: "Money" },
  { id: "balances", label: "Balances", icon: Wallet, group: "Money" },
  { id: "providers", label: "Providers", icon: Boxes, group: "Platform" },
  { id: "keys", label: "Platform keys", icon: KeyRound, group: "Platform" },
  { id: "mailbox", label: "Mailbox", icon: Mail, group: "Platform" },
  { id: "api", label: "API access", icon: Plug, group: "Platform" },
  { id: "assistant", label: "Assistant", icon: Sparkles, group: "Platform" },
  { id: "queue", label: "Queue", icon: ClipboardList, group: "Operations" },
  { id: "logs", label: "Logs", icon: ScrollText, group: "Operations" },
  { id: "staff", label: "Staff", icon: UserCog, group: "Operations" },
];

// /admin/<page>[/<client id>]
function readPath() {
  const [, , page, id] = window.location.pathname.split("/");
  return { page: PAGES.some((p) => p.id === page) ? page : "dashboard", id: decodeURIComponent(id || "") };
}

export function AdminApp() {
  const [staff, setStaff] = useState(savedStaff);
  const [route, setRoute] = useState(readPath);

  useEffect(() => {
    const out = () => setStaff(null);
    const back = () => setRoute(readPath());
    window.addEventListener(STAFF_SIGNED_OUT, out);
    window.addEventListener("popstate", back);
    return () => {
      window.removeEventListener(STAFF_SIGNED_OUT, out);
      window.removeEventListener("popstate", back);
    };
  }, []);

  // The saved session may have ended (expired, switched off, two-factor reset): check it once.
  const signedIn = Boolean(staff);
  useEffect(() => {
    if (signedIn) adminApi.me().then(setStaff, () => {});
  }, [signedIn]);

  const go = (page, id = "") => {
    const path = `/admin/${page}${id ? `/${encodeURIComponent(id)}` : ""}`;
    if (window.location.pathname !== path) window.history.pushState(null, "", path);
    setRoute({ page, id });
    window.scrollTo(0, 0);
  };

  if (!staff) return <SignIn onSignedIn={setStaff} />;
  const canEdit = staff.role === "staff_admin";
  const { page, id } = route;

  return (
    <div className="admin-shell" style={{ minHeight: "100vh", background: C.paper, fontFamily: FONT_BODY, color: C.textInk }}>
      <style>{`
        .admin-shell { display: grid; grid-template-columns: 220px minmax(0, 1fr); }
        .admin-nav { position: sticky; top: 0; height: 100vh; box-sizing: border-box; overflow-y: auto; display: flex; flex-direction: column; }
        .admin-nav-links { display: flex; flex-direction: column; gap: 1px; }
        .admin-nav-signout { display: none !important; }
        @media (max-width: 760px) {
          .admin-shell { grid-template-columns: minmax(0, 1fr); }
          .admin-nav { position: static; height: auto; }
          .admin-nav-links { flex-direction: row; overflow-x: auto; }
          .admin-nav-group { display: none; }
          .admin-nav-foot { display: none !important; }
          .admin-nav-signout { display: flex !important; }
        }
      `}</style>
      <nav className="admin-nav" aria-label="Admin" style={{ background: C.ink, color: "#fff", padding: "18px 12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 8px 12px" }}>
          <ShieldCheck size={20} color="#8FA6FF" />
          <div>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15 }}>Outreach admin</div>
            <div style={{ fontSize: 11, color: "#9CA3AF" }}>Aivhub staff only</div>
          </div>
        </div>
        <div className="admin-nav-links">
          {PAGES.map(({ id: pid, label, icon: Icon, group }, i) => (
            <React.Fragment key={pid}>
            {group !== PAGES[i - 1]?.group ? <div className="admin-nav-group" style={{ padding: i ? "10px 10px 3px" : "0 10px 3px", fontSize: 10.5, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "#7C8293" }}>{group}</div> : null}
            <button type="button" onClick={() => go(pid)} aria-current={page === pid ? "page" : undefined}
              style={{ display: "flex", alignItems: "center", gap: 9, padding: "6px 10px", borderRadius: 8, border: "none", cursor: "pointer", whiteSpace: "nowrap",
                background: page === pid ? C.inkLine : "transparent", color: page === pid ? "#fff" : "#C7CAD3", fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, textAlign: "left" }}>
              <Icon size={15} /> {label}
            </button>
            </React.Fragment>
          ))}
          <button type="button" className="admin-nav-signout" onClick={signOut} style={{ display: "flex", alignItems: "center", gap: 9, padding: "6px 10px", borderRadius: 9, border: "none", cursor: "pointer", background: "transparent", color: "#C7CAD3", fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>
            <LogOut size={15} /> Sign out
          </button>
        </div>
        <div className="admin-nav-foot" style={{ marginTop: "auto", padding: "12px 8px 0", borderTop: `1px solid ${C.inkLine}`, fontSize: 12 }}>
          <div style={{ fontWeight: 600 }}>{staff.name || staff.email}</div>
          <div style={{ color: "#9CA3AF", wordBreak: "break-all" }}>{staff.email}</div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <span style={{ color: "#9CA3AF" }}>{canEdit ? "Admin" : "Support (view only)"}</span>
            <button type="button" onClick={signOut} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 8px", borderRadius: 7, border: `1px solid ${C.inkLine}`, background: "transparent", color: "#C7CAD3", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
              <LogOut size={13} /> Sign out
            </button>
          </div>
        </div>
      </nav>
      <main style={{ padding: "24px 16px 48px", minWidth: 0, maxWidth: 1240, width: "100%", boxSizing: "border-box", margin: "0 auto" }}>
        <AlertsBanner go={go} />
        {page === "dashboard" && <Dashboard go={go} />}
        {page === "clients" && <Clients canEdit={canEdit} openId={id} open={(cid) => go("clients", cid)} />}
        {page === "queue" && <Queue canEdit={canEdit} openClient={(cid) => go("clients", cid)} />}
        {page === "revenue" && <Revenue canEdit={canEdit} />}
        {page === "billing" && <Billing canEdit={canEdit} />}
        {page === "balances" && <Balances canEdit={canEdit} />}
        {page === "keys" && <PlatformKeys canEdit={canEdit} />}
        {page === "providers" && <Providers />}
        {page === "demos" && <DemoOrgs />}
        {page === "mailbox" && (
          <>
            <PageTitle title="Platform mailbox" sub="The one mailbox that sends every system email: invites, password resets, low-balance alerts." />
            <PlatformMailbox canEdit={canEdit} />
          </>
        )}
        {page === "api" && <ApiAccess canEdit={canEdit} />}
        {page === "partners" && <Partners canEdit={canEdit} />}
        {page === "brands" && <Brands canEdit={canEdit} />}
        {page === "assistant" && <AssistantFeedback canEdit={canEdit} />}
        {page === "logs" && <Logs />}
        {page === "staff" && <Staff me={staff} canEdit={canEdit} />}
      </main>
    </div>
  );
}
