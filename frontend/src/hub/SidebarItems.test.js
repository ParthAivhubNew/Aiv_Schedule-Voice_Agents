import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { isFsbAccount, SidebarAccountBadge } from "./SidebarAccountBadge";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("Support and Documentation in the sidebars", () => {
  const shell = read("./PluginShell.jsx");
  const voice = read("../plugins/voice/calling/CallingWorkspace.jsx");
  const leads = read("../plugins/leadgen/LeadGenerationPlugin.jsx");
  const social = read("../plugins/scheduler/SocialWorkspace.jsx");

  it("Support sits directly above the credits in the shared sidebar, and is hidden when embedded", () => {
    const support = shell.indexOf('id: "support"');
    const credits = shell.indexOf('className="sb-credits"');
    expect(support).toBeGreaterThan(-1);
    expect(support).toBeLessThan(credits);
    expect(shell.slice(shell.lastIndexOf("{!embedded", support), support)).toContain("{!embedded");
  });

  it("Support sits directly above the credits in Voice's own sidebar", () => {
    const support = voice.indexOf('id: "support"');
    const credits = voice.indexOf('className="sb-credits"');
    expect(support).toBeGreaterThan(-1);
    expect(support).toBeLessThan(credits);
  });

  it("Documentation is a tab among the others, not at the bottom", () => {
    expect(shell.includes('id: "documentation"')).toBe(false); // nothing in the bottom block any more
    expect(leads).toContain('id: "documentation"');
    expect(social).toContain('id: "documentation"');
    expect(voice).toContain('id: "documentation"');
    // Voice: right after Workflows, inside the nav list and before the spacer above the bottom block
    expect(voice.indexOf('id: "workflows"')).toBeLessThan(voice.indexOf('id: "documentation"'));
    expect(voice.indexOf('id: "documentation"')).toBeLessThan(voice.indexOf('className="app-sidebar-spacer"', voice.indexOf('id: "documentation"')));
  });

  it("each app's Documentation tab opens its own guide in a new tab", () => {
    expect(leads).toContain('window.open("/help/leads", "_blank")');
    expect(social).toContain('window.open("/help/social", "_blank")');
    expect(voice).toContain('window.open("/help/voice", "_blank")');
  });

  it("Documentation stays available when a plan is locked", () => {
    expect(leads).toContain('item.id !== "documentation"');
  });

  it("places FSB account badge directly below credits in PluginShell and CallingWorkspace", () => {
    expect(shell).toContain("<SidebarAccountBadge");
    expect(voice).toContain("<SidebarAccountBadge");
    const shellCredits = shell.indexOf('className="sb-credits"');
    const shellBadge = shell.indexOf("<SidebarAccountBadge");
    expect(shellBadge).toBeGreaterThan(shellCredits);

    const voiceCredits = voice.indexOf('className="sb-credits"');
    const voiceBadge = voice.indexOf("<SidebarAccountBadge");
    expect(voiceBadge).toBeGreaterThan(voiceCredits);
  });

  it("isFsbAccount identifies dedicated FSB account and rejects all others", () => {
    expect(isFsbAccount({ username: "fsboutreach" })).toBe(true);
    expect(isFsbAccount({ username: "FSBOUTREACH" })).toBe(true);
    expect(isFsbAccount({ email: "fsboutreach@fsb.org.uk" })).toBe(true);
    expect(isFsbAccount({ username: "fsboutreach", email: "fsboutreach@fsb.org.uk" })).toBe(true);

    expect(isFsbAccount({ username: "op1", email: "user@example.com", org_name: "Acme Corp" })).toBe(false);
    expect(isFsbAccount({ username: "other", org_name: "Federation of Small Businesses" })).toBe(false);
    expect(isFsbAccount({ username: "admin", org_name: "FSB" })).toBe(false);
    expect(isFsbAccount(null)).toBe(false);
    expect(isFsbAccount({})).toBe(false);
  });

  it("SidebarAccountBadge draws FSB logo and company name only for FSB accounts, linking to website", () => {
    const fsbOp = { username: "fsboutreach", org_name: "Federation of Small Businesses" };
    const html = renderToStaticMarkup(React.createElement(SidebarAccountBadge, { operator: fsbOp }));
    expect(html).toContain("Federation of Small Businesses");
    expect(html).toContain("FSB Account");
    expect(html).toContain("fsb");
    expect(html).toContain("<svg");
    expect(html).toContain('href="https://account.fsb.org.uk/"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');

    const collapsedHtml = renderToStaticMarkup(React.createElement(SidebarAccountBadge, { operator: fsbOp, collapsed: true }));
    expect(collapsedHtml).toContain('title="Federation of Small Businesses (opens in new tab)"');
    expect(collapsedHtml).toContain("<svg");
    expect(collapsedHtml).toContain('href="https://account.fsb.org.uk/"');
    expect(collapsedHtml).toContain('target="_blank"');
    expect(collapsedHtml).not.toContain("FSB Account");

    const otherHtml = renderToStaticMarkup(React.createElement(SidebarAccountBadge, { operator: { username: "other_user" } }));
    expect(otherHtml).toBe("");
  });
});
