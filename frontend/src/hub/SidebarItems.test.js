import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

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
});
