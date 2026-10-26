import React, { createContext, useContext } from "react";

// Set when an app is shown inside a partner's page. `views` lists the pages of the app that screen shows.
const EmbedContext = createContext(null);

export function EmbedProvider({ views, brand, children }) {
  return <EmbedContext.Provider value={{ views: views || [], brand: brand || {} }}>{children}</EmbedContext.Provider>;
}

export function useEmbedded() {
  return useContext(EmbedContext) !== null;
}

// The top of an app's sidebar: its icon and name, or, inside a partner's page, the partner's logo and name when it set them.
export function SidebarBrand({ icon: Icon, accent, name, size = 17 }) {
  const ctx = useContext(EmbedContext);
  const brand = (ctx && ctx.brand) || {};
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "2px 8px 16px" }}>
      {brand.logoUrl ? (
        <img src={brand.logoUrl} alt="" referrerPolicy="no-referrer" style={{ height: 32, maxWidth: 120, objectFit: "contain", flexShrink: 0 }} />
      ) : (
        <div style={{ width: 32, height: 32, borderRadius: 6, background: accent, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Icon size={size} />
        </div>
      )}
      <div style={{ fontWeight: 600, fontSize: 15, color: "var(--ui-side-strong, #fff)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{brand.name || name}</div>
    </div>
  );
}

// The pages of the app to keep in its menu, or null when it is not embedded (or shows every page).
export function useEmbedViews() {
  const ctx = useContext(EmbedContext);
  return ctx && ctx.views.length ? ctx.views : null;
}

// Keeps only the menu items an embedded screen may show.
export function onlyEmbedViews(items, views) {
  // An item may stand for several pages (`embedIds`): it stays when the screen may show any of them.
  return views ? items.filter((item) => (item.embedIds || [item.id]).some((id) => views.includes(id))) : items;
}

// Shown in place of an app the person's Outreach account has no plan for. Plans are managed on Outreach itself, never in a partner's page.
export function EmbedPlanNotice({ app }) {
  return (
    <div role="status" style={{ maxWidth: 440, margin: "48px auto", padding: 24, textAlign: "center", color: "var(--ui-ink-2)", fontSize: 14, lineHeight: 1.5 }}>
      <strong style={{ display: "block", marginBottom: 6, color: "var(--ui-ink)", fontSize: 16 }}>{app} is not on this account yet</strong>
      Add {app} to your Outreach plan at outreach.aivhub.com, then come back here.
    </div>
  );
}
