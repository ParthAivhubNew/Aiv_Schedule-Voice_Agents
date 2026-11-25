import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BrandContext, useBrand } from "./BrandContext";
import { NO_BRAND, resolveBrand } from "./brandLogic";
import { PoweredBy } from "./PoweredBy";
import { StandingChip } from "./StandingChip";
import { BrandLockup } from "../hub/BrandMark";

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
    expect(src("../plugins/leadgen/FindLeadsView.jsx")).toContain("<StandingChip canSeeRules={isAdmin} />");
    expect(src("../main.jsx")).toContain("<BrandProvider>");
    expect(src("../adminPortal/AdminApp.jsx")).toContain('id: "brands"');
  });
});
