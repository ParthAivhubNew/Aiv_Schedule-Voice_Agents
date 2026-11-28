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

  // Plan 13: every app's menu has the same shape. The everyday work, then one Settings entry with the setup pages, then credits and
  // the company badge. The AI Assistant is the header's button; Support and Documentation are in the profile menu, following the app.
  it("has no Support, Documentation or AI Assistant item in any app's menu", () => {
    for (const src of [shell, voice, leads, social]) {
      expect(src).not.toContain('id: "support"');
      expect(src).not.toContain('id: "documentation"');
    }
    expect(social).not.toContain('{ id: "assistant", label: "AI Assistant"');
    expect(voice).toContain('{ label: "Outreach", ids: ["list", "logs", "schedule", "analytics"] }');
    // Leads lists the assistant as a page only inside a partner's embed, which has no header of ours.
    expect(leads).toContain('...(embedViews ? [{ id: "assistant", label: "AI Assistant"');
  });

  it("puts one Settings entry between the work and the credits, which swaps the menu to the setup pages while one is open", () => {
    const menu = shell.slice(shell.indexOf("export function SidebarMenu"), shell.indexOf("export function PluginSidebar"));
    expect(menu).toContain("if (setup && setup.active)");
    expect(menu).toContain("label: `Back to ${name}`");
    expect(menu).toContain('<div className="ui-nav-label">Settings</div>');
    expect(menu).toContain("{setup ? <NavItem item={{ ...setup, children: undefined }} /> : null}"); // no panel floating over the page
    expect(shell.indexOf("<SidebarMenu")).toBeLessThan(shell.indexOf('className="sb-credits"'));
    expect(voice).toContain('<SidebarMenu groups={[{ label: "Voice"');
    expect(voice.indexOf("<SidebarMenu")).toBeLessThan(voice.indexOf('className="sb-credits"'));
    expect(leads).toContain("settings={embedViews ? null : setupGroup.items}");
    expect(social).toContain("settings={settingsItems}");
  });

  it("opens each app's own guide and tells Support which app you are in, from the profile menu", async () => {
    const { helpForHere } = await import("./PluginHub");
    expect(helpForHere("#/leadgen/find_leads")).toEqual({ plugin: "leadgen", docs: "/help/leads" });
    expect(helpForHere("#/voice/list")).toEqual({ plugin: "voice", docs: "/help/voice" });
    expect(helpForHere("#/scheduler/plan")).toEqual({ plugin: "scheduler", docs: "/help/social" });
    expect(helpForHere("")).toEqual({ plugin: "home", docs: "/help" });
  });

  it("keeps the Settings entry's pages reachable when a plan is locked (Plan & credits always opens)", () => {
    expect(leads).toContain('locked: isLocked && item.id !== "subscription"');
    expect(voice).toContain('locked: pluginLocked && id !== "subscription"');
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
