import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BrandContext, useBrand } from "./BrandContext";
import { NO_BRAND, resolveBrand } from "./brandLogic";
import { PoweredBy } from "./PoweredBy";
import { StandingChip } from "./StandingChip";
import { BrandLockup, BrandMark } from "../hub/BrandMark";

const FSB = resolveBrand({ host: { name: "FSB", displayName: "FSB Outreach", logoUrl: "https://x.example/l.png", accent: "#112233", poweredBy: true } });
const wrap = (value, node) => renderToStaticMarkup(<BrandContext.Provider value={value}>{node}</BrandContext.Provider>);
const src = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

function Probe() {
  const b = useBrand();
  return <span>{b.active ? b.name : "plain"}</span>;
}

describe("brand consumers", () => {
  it("render today's look with no provider", () => {
    expect(renderToStaticMarkup(<Probe />)).toContain("plain");
    expect(renderToStaticMarkup(<PoweredBy />)).toBe("");
    expect(renderToStaticMarkup(<StandingChip />)).toBe("");
    expect(renderToStaticMarkup(<BrandLockup />)).toContain("BY AIVHUB");
  });
  it("show the brand when there is one", () => {
    expect(wrap(FSB, <Probe />)).toContain("FSB Outreach");
    expect(wrap(FSB, <PoweredBy />)).toContain("Powered by Outreach");
    const lockup = wrap(FSB, <BrandLockup />);
    expect(lockup).toContain("FSB Outreach");
    expect(lockup).toContain("https://x.example/l.png");
    expect(lockup).not.toContain("BY AIVHUB");
  });
  it("hide the powered-by line when the brand turns it off", () => {
    expect(wrap({ ...FSB, poweredBy: false }, <PoweredBy />)).toBe("");
  });
  it("show the chip only when standing exclusions are on", () => {
    expect(wrap({ ...NO_BRAND, standingExclusions: true }, <StandingChip />)).toContain("Standing exclusions on");
    expect(wrap(NO_BRAND, <StandingChip />)).toBe("");
  });
});

describe("wiring", () => {
  it("has the menu item, the view and the login hooks", () => {
    const plugin = src("../plugins/leadgen/LeadGenerationPlugin.jsx");
    expect(plugin).not.toContain('id: "member_list", label:'); // hidden from the menu on purpose; the screen is kept
    expect(plugin).toContain("<MemberList");
    const login = src("../hub/LoginScreen.jsx");
    expect(login).toContain("useBrand()");
    expect(login).toContain("brand.signin.google");
    expect(login).toContain("Ask your administrator for an invitation.");
    expect(login).toContain("<PoweredBy");
    expect(src("../hub/PluginShell.jsx")).toContain("hideCredits");
    expect(src("../plugins/voice/calling/CallingWorkspace.jsx")).toContain("brand.hideCredits");
    expect(src("../plugins/leadgen/find/FindLeadsSearch.jsx")).toContain("<StandingChip canSeeRules={isAdmin} />");
    expect(src("../main.jsx")).toContain("<BrandProvider>");
    expect(src("../adminPortal/AdminApp.jsx")).toContain('id: "brands"');
  });
});

describe("a brand's accent is the app's accent (plan 10, Phase 4 item 3)", async () => {
  const { accentShades, contrastWithWhite } = await import("./brandLogic");
  it("gives the full set of shades, readable on buttons", () => {
    const s = accentShades("#006972");
    expect(s["--ui-accent"]).toBe("#006972");
    expect(Object.keys(s)).toEqual(["--ui-accent", "--ui-accent-hover", "--ui-accent-soft", "--ui-accent-ink", "--ui-ring", "--ui-side-active-icon"]);
    const light = accentShades("#FFE066"); // too light for white text: darkened until it reads
    expect(contrastWithWhite(light["--ui-accent"])).toBeGreaterThanOrEqual(4.5);
    expect(accentShades("not a colour")).toBe(null);
    expect(contrastWithWhite("#3457D5")).toBeGreaterThan(4.5); // the default cobalt already reads
  });
});

describe("the top of the sidebar", () => {
  it("always shows the Outreach logo and name, whatever the brand; the company sits in the badge at the bottom", () => {
    expect(FSB.active && FSB.logoUrl).toBeTruthy();
    const own = wrap({ ...FSB, loading: false }, <BrandMark size={32} outreach />);
    expect(own).toContain("<svg");
    expect(own).not.toContain("x.example/l.png");
    expect(wrap({ ...FSB, loading: false }, <BrandMark size={32} />)).toContain("x.example/l.png"); // elsewhere the brand's logo still shows
    const shell = src("../hub/PluginShell.jsx");
    const head = shell.slice(shell.indexOf("export function SidebarHead"), shell.indexOf("export function PluginSidebar"));
    expect(head).toContain("<BrandMark size={32} outreach />");
    expect(head).toContain(">Outreach<");
    expect(head).toContain("BY AIVHUB");
    expect(head).not.toContain("brand.name");
  });
});
