import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SidebarAccountBadge } from "./SidebarAccountBadge";
import { accountLinkOf, resolveBrand } from "../brand/brandLogic";

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

  // The badge is a brand setting (theme.accountLink), never a list of usernames (plan 12, F3).
  const FSB = { active: true, name: "Federation of Small Businesses", shortName: "FSB", logoUrl: "", accent: "",
    accountLink: { url: "https://account.fsb.org.uk/", label: "Federation of Small Businesses" } };

  it("SidebarAccountBadge shows the crown only for an admin", () => {
    const admin = renderToStaticMarkup(React.createElement(SidebarAccountBadge, { operator: { username: "anyone", is_admin: true }, brand: FSB }));
    const user = renderToStaticMarkup(React.createElement(SidebarAccountBadge, { operator: { username: "anyone", is_admin: false }, brand: FSB }));
    expect(admin).toContain("Administrator");
    expect(user).not.toContain("Administrator");
  });

  it("SidebarAccountBadge draws the brand's mark and name only when its brand has an account link", () => {
    const html = renderToStaticMarkup(React.createElement(SidebarAccountBadge, { operator: { username: "x" }, brand: FSB }));
    expect(html).toContain("Federation of Small Businesses");
    expect(html).toContain("FSB account");
    expect(html).toContain("fsb");
    expect(html).toContain("<svg");
    expect(html).toContain('href="https://account.fsb.org.uk/"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');

    const collapsedHtml = renderToStaticMarkup(React.createElement(SidebarAccountBadge, { operator: {}, brand: FSB, collapsed: true }));
    expect(collapsedHtml).toContain('title="Federation of Small Businesses (opens in new tab)"');
    expect(collapsedHtml).toContain('href="https://account.fsb.org.uk/"');
    expect(collapsedHtml).not.toContain("FSB account");

    // a username that used to be special shows nothing without the brand setting
    expect(renderToStaticMarkup(React.createElement(SidebarAccountBadge, { operator: { username: "fsbadmin" } }))).toBe("");
    expect(renderToStaticMarkup(React.createElement(SidebarAccountBadge, { operator: {}, brand: { ...FSB, accountLink: null } }))).toBe("");
  });

  it("reads the account link from the brand's theme, https only", () => {
    expect(accountLinkOf({ accountLink: { url: "https://account.fsb.org.uk/", label: "FSB" } })).toEqual({ url: "https://account.fsb.org.uk/", label: "FSB" });
    expect(accountLinkOf({ accountLink: { url: "javascript:alert(1)" } })).toBe(null);
    expect(accountLinkOf({ accountLink: { url: "http://plain.example" } })).toBe(null);
    expect(accountLinkOf({})).toBe(null);
    expect(resolveBrand({ me: { name: "FSB", displayName: "Federation of Small Businesses", theme: { accountLink: { url: "https://account.fsb.org.uk/" } } } }).accountLink)
      .toEqual({ url: "https://account.fsb.org.uk/", label: "" });
    expect(resolveBrand({ host: { name: "FSB", theme: { accountLink: { url: "https://account.fsb.org.uk/" } } } }).accountLink).toBe(null); // signed-in accounts only
  });
});
