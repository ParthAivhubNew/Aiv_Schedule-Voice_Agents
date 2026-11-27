import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Settings, Smartphone } from "lucide-react";
import { C, FONT_BODY } from "../tokens";
import { MobileNavBackdrop, useMobileNav } from "../components/MobileNav";
import { InstallStepsSheet } from "../components/InstallSteps";
import { useShowInstallSteps } from "../components/installState";
import { navigateHash, onRouteChange, routeHash } from "../utils/route";
import { ConnectionsSettingsModal } from "../connections/ConnectionsSettings";
import { DeveloperApiKeysModal } from "../settings/DeveloperApiKeysModal";
import { TeamModal } from "../team/TeamModal";
import { NavItem } from "./NavItem";
import { PluginHeader, SidebarHead, useSidebarCollapse } from "./PluginShell";
import { ProfilePage } from "./ProfilePage";
import { SidebarAccountBadge } from "./SidebarAccountBadge";
import { settingsGroups, settingsSection } from "./settingsPages";

const NOOP = () => {};

// The one Settings page for the whole company (plan 13, step 4). The sidebar is the same dark strip as every app, with
// "Back to …" at the top and the sections in groups; the section opens beside it, never in a window over the page.
// from: { name, onClick } for the Back row (the app or Home you came from).
export function SettingsPage({ operator, setOperator, accountBar, from, onHome }) {
  const installable = useShowInstallSteps();
  const groups = useMemo(() => settingsGroups(operator, { installable }), [operator, installable]);
  const [hash, setHash] = useState(routeHash);
  useEffect(() => onRouteChange(() => setHash(routeHash())), []);
  const section = settingsSection(groups, hash);
  const nav = useMobileNav(section.id);
  const [collapsed, toggleCollapsed] = useSidebarCollapse();
  const [installOpen, setInstallOpen] = useState(false);

  const pick = (it) => {
    if (it.open.startsWith("go:")) return navigateHash(it.open.slice(3));
    if (it.open === "calendar") return window.dispatchEvent(new CustomEvent("aivhub:open-calendar-settings", { detail: "accounts" }));
    navigateHash(`#/settings/${it.id}`);
    nav.close?.();
  };
  const [kind, tab] = section.open.split(":");
  const full = kind === "profile" || kind === "links" || kind === "keys"; // these draw their own heading and scroll

  return (
    <div className={nav.open ? "app-shell is-nav-open" : "app-shell"} style={{ display: "flex", height: "100vh", background: C.paper, fontFamily: FONT_BODY }}>
      <MobileNavBackdrop nav={nav} />
      <div className="app-sidebar ui-scroll" style={{ width: 236, minWidth: 236, background: "var(--ui-side-bg)", height: "100vh", display: "flex", flexDirection: "column", padding: "16px 12px 12px", boxSizing: "border-box", overflowY: "auto" }}>
        <SidebarHead icon={Settings} name="Settings" collapsed={collapsed} onToggle={toggleCollapsed} onHome={onHome} />
        <nav className="app-sidebar-nav" aria-label="Settings" style={{ display: "flex", flexDirection: "column" }}>
          {from ? <NavItem item={{ id: "settings-back", className: "ui-nav-back", label: `Back to ${from.name}`, icon: ArrowLeft, onClick: from.onClick }} /> : null}
          {groups.map((g) => (
            <React.Fragment key={g.label}>
              <div className="ui-nav-label">{g.label}</div>
              {g.items.map((it) => <NavItem key={it.id} item={{ ...it, active: it.id === section.id, onClick: () => pick(it) }} />)}
            </React.Fragment>
          ))}
        </nav>
        <div className="app-sidebar-spacer" style={{ flex: 1, minHeight: 16 }} />
        <SidebarAccountBadge operator={operator} collapsed={collapsed} />
      </div>

      <div className="app-main" style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <PluginHeader nav={nav} title="Settings" sub={section.title} accountBar={accountBar} assistant={false} />
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", background: C.surface }}>
          {kind === "profile" ? <ProfilePage inline isOpen page={tab} operator={operator} setOperator={setOperator} orgName={operator?.org_name} onClose={NOOP} /> : null}
          {kind === "links" ? <ConnectionsSettingsModal inline isOpen page={tab} onClose={NOOP} /> : null}
          {kind === "keys" ? <DeveloperApiKeysModal inline open onClose={NOOP} /> : null}
          {full ? null : (
            <div className="ui-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "20px 24px" }}>
              <h2 style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 600, color: C.textInk }}>{section.label}</h2>
              <p style={{ margin: "0 0 18px", fontSize: 13, color: C.slate }}>{section.title}</p>
              {kind === "team" ? <TeamModal isOpen only={tab} onClose={NOOP} currentUser={operator} /> : null}
              {kind === "install" ? (
                <button type="button" className="ui-btn ui-btn--primary" onClick={() => setInstallOpen(true)}><Smartphone size={16} /> Show me how</button>
              ) : null}
            </div>
          )}
        </div>
      </div>
      <InstallStepsSheet open={installOpen} onClose={() => setInstallOpen(false)} />
    </div>
  );
}
