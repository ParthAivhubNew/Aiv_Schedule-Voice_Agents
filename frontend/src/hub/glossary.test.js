import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (f) => readFileSync(new URL(f, import.meta.url), "utf8");

// Plan 13, step 8: one name for each thing (docs/GLOSSARY.md). These old names must not come back in menus and page titles.
describe("the glossary's names in menus and titles", () => {
  const leads = read("../plugins/leadgen/LeadGenerationPlugin.jsx");
  const voice = read("../plugins/voice/calling/CallingWorkspace.jsx");
  const social = read("../plugins/scheduler/SocialWorkspace.jsx");

  it("Leads says Data sources, Company profile and Mail", () => {
    expect(leads).toContain('{ id: "connectors", label: "Data sources"');
    expect(leads).toContain('{ id: "business", label: "Company profile"');
    expect(leads).not.toMatch(/title: "(Connectors|About your business|Inbox and sent)"/);
  });

  it("Voice says Company profile, not Business Setup", () => {
    expect(voice).toContain('{ id: "company", label: "Company profile"');
    expect(voice).not.toContain('"Business Setup"');
  });

  it("Social says Posts to approve, Social accounts and Brand look", () => {
    expect(social).toContain('label: "Posts to approve"');
    expect(social).toContain('label: "Social accounts"');
    expect(social).toContain('label: "Brand look"');
    expect(social).not.toMatch(/"(Post approve|Theme)"/);
  });

  it("no client screen calls Leads 'Lead Gen'", () => {
    for (const f of ["../hooks/useConnections.js", "../connections/ConnectionsSettings.jsx", "../plugins/scheduler/SocialListening.jsx", "../settings/DeveloperApiKeysModal.jsx"]) {
      const visible = read(f).split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
      expect(visible).not.toContain("Lead Gen");
    }
  });
});
