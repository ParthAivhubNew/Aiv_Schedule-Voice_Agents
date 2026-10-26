import React, { useEffect } from "react";
import { LogOut, Menu } from "lucide-react";
import { C } from "../tokens";
import { MobileNavButton } from "../components/MobileNav";
import { useBodyClass } from "../components/usePhone";
import { PluginCredits } from "../team/PluginCredits";
import { AppSwitcher } from "./AppSwitcher";
import { NavItem } from "./NavItem";
import { SidebarBrand, useEmbedded } from "../embed/EmbedContext";

// The left side of every app, built the same way as Voice's: the app's name and icon, the Home/app switcher,
// the pages in labelled groups, then (at the bottom) the app's credits and Log out.
// groups: [{ label, items: [{ id, label, icon, active, locked, count, title, onClick }] }]
export function PluginSidebar({ appId, name, icon: Icon, accent, groups, wallet, operator, onOpenPlan, onHome, onLogout, refreshKey, nav, tabs }) {
  const embedded = useEmbedded(); // inside a partner's page: no switching apps, no credits or log out (the partner owns those)
  const tabItems = tabs ? tabs.map((id) => groups.flatMap((g) => g.items.filter(Boolean)).find((it) => it.id === id)).filter(Boolean) : [];
  return (
    <>
    <div className="app-sidebar ui-scroll" style={{ width: 236, minWidth: 236, background: "var(--ui-side-bg)", height: "100vh", display: "flex", flexDirection: "column", padding: "16px 12px 12px", boxSizing: "border-box", overflowY: "auto" }}>
      <SidebarBrand icon={Icon} accent={accent} name={name} />
      {!embedded && <AppSwitcher current={appId} onHome={onHome} />}
      <nav className="app-sidebar-nav" aria-label={name} style={{ display: "flex", flexDirection: "column" }}>
        {groups.map((group) => {
          const items = group.items.filter(Boolean);
          if (!items.length) return null;
          return (
            <React.Fragment key={group.label}>
              <div className="ui-nav-label">{group.label}</div>
              {items.map((it) => <NavItem key={it.id} item={it} />)}
            </React.Fragment>
          );
        })}
      </nav>
      <div className="app-sidebar-spacer" style={{ flex: 1, minHeight: 16 }} />
      {wallet && !embedded ? <PluginCredits wallet={wallet} operator={operator} onOpen={onOpenPlan} refreshKey={refreshKey} /> : null}
      {!embedded && (
        <button type="button" className="ui-nav-item" onClick={onLogout} style={{ color: "var(--ui-side-muted)" }}>
          <LogOut size={16} strokeWidth={1.75} /> Log out
        </button>
      )}
    </div>
    {tabItems.length && nav ? <PhoneTabBar items={tabItems} nav={nav} accent={accent} /> : null}
    </>
  );
}

// Phones: the app's main pages as a bar along the bottom, always in reach of a thumb, and "More"
// for the drawer with everything else. items: [{ id, label, icon, active, locked, count, onClick }]
export function PhoneTabBar({ items, nav, accent }) {
  useBodyClass("has-phone-tabs");
  // While the keyboard is up the bar steps aside, so a chat box or form keeps the room above the keys.
  useEffect(() => {
    const typing = (el) => el && (el.isContentEditable || (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && !/^(checkbox|radio|button|submit|range|color|file)$/.test(el.type)));
    const sync = () => document.body.classList.toggle("phone-typing", Boolean(typing(document.activeElement)));
    const later = () => setTimeout(sync, 0);
    document.addEventListener("focusin", sync);
    document.addEventListener("focusout", later);
    return () => {
      document.removeEventListener("focusin", sync);
      document.removeEventListener("focusout", later);
      document.body.classList.remove("phone-typing");
    };
  }, []);
  return (
    <nav className="phone-tabs" aria-label="Main pages" style={{ "--tab-accent": accent || C.cobalt }}>
      {items.map((it) => {
        const TabIcon = it.icon;
        return (
          <button key={it.id} type="button" className="phone-tab" onClick={it.onClick} aria-current={it.active ? "page" : undefined} data-locked={it.locked ? "true" : undefined}>
            <span className="phone-tab-icon">
              <TabIcon size={22} strokeWidth={1.75} />
              {it.count ? <span className="phone-tab-count">{it.count}</span> : null}
            </span>
            <span className="phone-tab-label">{it.short || it.label}</span>
          </button>
        );
      })}
      <button type="button" className="phone-tab" onClick={nav.toggle} aria-expanded={nav.open} aria-label="More pages and settings">
        <span className="phone-tab-icon"><Menu size={22} strokeWidth={1.75} /></span>
        <span className="phone-tab-label">More</span>
      </button>
    </nav>
  );
}

// The bar across the top of every app, the same as Voice's: the page's name, a short line about it, then
// anything the page needs (children), your credits, notifications and profile (accountBar).
export function PluginHeader({ nav, title, sub, children, accountBar }) {
  return (
    <div style={{ minHeight: 56, padding: "8px 16px 8px 24px", boxSizing: "border-box", borderBottom: `1px solid ${C.border}`, background: "#fff", display: "flex", alignItems: "center", gap: 12, position: "relative", zIndex: 60, overflow: "visible", flexShrink: 0 }}>
      <MobileNavButton nav={nav} />
      <h1 style={{ margin: 0, fontWeight: 600, fontSize: 16, letterSpacing: "-0.01em", color: C.textInk, whiteSpace: "nowrap" }}>{title}</h1>
      <div className="hide-mobile" style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: C.slate, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</div>
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
        {children}
        {accountBar}
      </div>
    </div>
  );
}
