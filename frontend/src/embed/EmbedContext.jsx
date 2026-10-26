import React, { createContext, useContext } from "react";

// Set when an app is shown inside a partner's page. `views` lists the pages of the app that screen shows.
const EmbedContext = createContext(null);

export function EmbedProvider({ views, children }) {
  return <EmbedContext.Provider value={{ views: views || [] }}>{children}</EmbedContext.Provider>;
}

export function useEmbedded() {
  return useContext(EmbedContext) !== null;
}

// The pages of the app to keep in its menu, or null when it is not embedded (or shows every page).
export function useEmbedViews() {
  const ctx = useContext(EmbedContext);
  return ctx && ctx.views.length ? ctx.views : null;
}

// Keeps only the menu items an embedded screen may show.
export function onlyEmbedViews(items, views) {
  return views ? items.filter((item) => views.includes(item.id)) : items;
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
