import React, { useEffect, useState } from "react";
import { ClipboardList, Coins, LayoutDashboard, LogOut, PoundSterling, ScrollText, ShieldCheck, Sparkles, Users, UserCog } from "lucide-react";
import { C, FONT_BODY, FONT_DISPLAY } from "../tokens";
import { STAFF_SIGNED_OUT, adminApi, savedStaff, signOut } from "./adminApi";
import { Billing } from "./Billing";
import { Clients } from "./Clients";
import { Dashboard } from "./Dashboard";
import { Logs } from "./Logs";
import { PlatformAi } from "./PlatformAi";
import { Revenue } from "./Revenue";
import { Queue } from "./Queue";
import { SignIn } from "./SignIn";
import { Staff } from "./Staff";

const PAGES = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "clients", label: "Clients", icon: Users },
  { id: "queue", label: "Queue", icon: ClipboardList },
  { id: "revenue", label: "Revenue", icon: PoundSterling },
  { id: "billing", label: "Plans & pricing", icon: Coins },
  { id: "ai", label: "Platform AI", icon: Sparkles },
  { id: "logs", label: "Logs", icon: ScrollText },
  { id: "staff", label: "Staff", icon: UserCog },
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
        .admin-nav { position: sticky; top: 0; height: 100vh; display: flex; flex-direction: column; }
        .admin-nav-links { display: flex; flex-direction: column; gap: 2px; }
        @media (max-width: 760px) {
          .admin-shell { grid-template-columns: minmax(0, 1fr); }
          .admin-nav { position: static; height: auto; }
          .admin-nav-links { flex-direction: row; overflow-x: auto; }
          .admin-nav-foot { display: none !important; }
        }
      `}</style>
      <nav className="admin-nav" aria-label="Admin" style={{ background: C.ink, color: "#fff", padding: "18px 12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 8px 16px" }}>
          <ShieldCheck size={20} color="#8FA6FF" />
          <div>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15 }}>OutReach admin</div>
            <div style={{ fontSize: 11, color: "#9CA3AF" }}>Aivhub staff only</div>
          </div>
        </div>
        <div className="admin-nav-links">
          {PAGES.map(({ id: pid, label, icon: Icon }) => (
            <button key={pid} type="button" onClick={() => go(pid)} aria-current={page === pid ? "page" : undefined}
              style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 10px", borderRadius: 9, border: "none", cursor: "pointer", whiteSpace: "nowrap",
                background: page === pid ? C.inkLine : "transparent", color: page === pid ? "#fff" : "#C7CAD3", fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, textAlign: "left" }}>
              <Icon size={15} /> {label}
            </button>
          ))}
          <button type="button" onClick={signOut} style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 10px", borderRadius: 9, border: "none", cursor: "pointer", background: "transparent", color: "#C7CAD3", fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>
            <LogOut size={15} /> Sign out
          </button>
        </div>
        <div className="admin-nav-foot" style={{ marginTop: "auto", padding: "12px 8px 0", borderTop: `1px solid ${C.inkLine}`, fontSize: 12 }}>
          <div style={{ fontWeight: 600 }}>{staff.name || staff.email}</div>
          <div style={{ color: "#9CA3AF", wordBreak: "break-all" }}>{staff.email}</div>
          <div style={{ color: "#9CA3AF" }}>{canEdit ? "Admin" : "Support (view only)"}</div>
        </div>
      </nav>
      <main style={{ padding: "24px 16px 48px", minWidth: 0, maxWidth: 1240, width: "100%", boxSizing: "border-box", margin: "0 auto" }}>
        {page === "dashboard" && <Dashboard go={go} />}
        {page === "clients" && <Clients canEdit={canEdit} openId={id} open={(cid) => go("clients", cid)} />}
        {page === "queue" && <Queue canEdit={canEdit} openClient={(cid) => go("clients", cid)} />}
        {page === "revenue" && <Revenue canEdit={canEdit} />}
        {page === "billing" && <Billing canEdit={canEdit} />}
        {page === "ai" && <PlatformAi canEdit={canEdit} />}
        {page === "logs" && <Logs />}
        {page === "staff" && <Staff me={staff} canEdit={canEdit} />}
      </main>
    </div>
  );
}
