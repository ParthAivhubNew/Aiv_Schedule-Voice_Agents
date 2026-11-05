import React, { Suspense, lazy, useEffect, useState } from "react";
import { setVirtualRoute } from "../utils/route";

const LeadGenerationPlugin = lazy(() => import("../plugins/leadgen/LeadGenerationPlugin"));
const SocialWorkspaceGate = lazy(() => import("../plugins/scheduler/SocialWorkspace").then((m) => ({ default: m.SocialWorkspaceGate })));
const CallingWorkspace = lazy(() => import("../plugins/voice/calling/CallingWorkspace").then((m) => ({ default: m.CallingWorkspace })));

// Leads, Voice and Social behind one sign-in. The page may hide tabs (data-tabs="leads,voice"); it can never add one the pass does not cover.
export const TABS = [
  { id: "leads", label: "Leads", start: "/leadgen/find_leads" },
  { id: "voice", label: "Voice", start: "/voice/list" },
  { id: "social", label: "Social", start: "/scheduler/plan" },
];
const BAR = 44;

// "leads, Voice" -> ["leads", "voice"], in the order of TABS; anything unknown is dropped and an empty result means every tab.
export function tabsFor(asked) {
  const want = String(asked || "").toLowerCase().split(/[\s,]+/).filter(Boolean);
  const out = TABS.filter((t) => want.includes(t.id));
  return out.length ? out : TABS;
}

// The three apps size themselves to the whole window; inside the workspace they get the space under the tab bar instead.
const css = `
.ws-body .app-shell, .ws-body .app-main, .ws-body .app-sidebar { height: 100% !important; }
.ws-tab { border: 0; background: none; cursor: pointer; padding: 0 16px; height: ${BAR}px; font: inherit; font-size: 13.5px; font-weight: 600; color: var(--ui-muted, #64748b); border-bottom: 2px solid transparent; }
.ws-tab[aria-selected="true"] { color: var(--ui-accent, #2f5be0); border-bottom-color: var(--ui-accent, #2f5be0); }
.ws-tab:hover { color: var(--ui-ink, #0f172a); }
.ws-tab:focus-visible { outline: 2px solid var(--ui-ring, #2f5be0); outline-offset: -2px; }
`;

export default function WorkspaceScreen({ props, tabs: asked }) {
  const tabs = tabsFor(asked);
  const [tab, setTab] = useState(tabs[0].id);
  const pick = (t) => {
    setVirtualRoute(t.start); // an app opens where its own start page is
    setTab(t.id);
  };
  const shown = tabs.some((t) => t.id === tab) ? tab : tabs[0].id;
  useEffect(() => {
    // Outreach.find(company) from the page: open Leads, which picks the company up from window.__outreachFind
    const onFind = () => { const t = tabs.find((x) => x.id === "leads"); if (t) pick(t); };
    window.addEventListener("outreach-find", onFind);
    return () => window.removeEventListener("outreach-find", onFind);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked]);
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--ui-bg, #fff)" }}>
      <style>{css}</style>
      {tabs.length > 1 && (
        <div role="tablist" aria-label="Outreach" style={{ display: "flex", gap: 4, padding: "0 12px", height: BAR, flex: "none", borderBottom: "1px solid var(--ui-line, #e2e8f0)", background: "var(--ui-surface, #fff)" }}>
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" className="ws-tab" aria-selected={shown === t.id} onClick={() => pick(t)}>{t.label}</button>
          ))}
        </div>
      )}
      <div className="ws-body" style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        <Suspense fallback={<div role="status" style={{ padding: 24, color: "var(--ui-muted)", fontSize: 14 }}>Opening…</div>}>
          {shown === "leads" && <LeadGenerationPlugin key="leads" {...props} />}
          {shown === "voice" && <CallingWorkspace key="voice" {...props} />}
          {shown === "social" && <SocialWorkspaceGate key="social" {...props} />}
        </Suspense>
      </div>
    </div>
  );
}
