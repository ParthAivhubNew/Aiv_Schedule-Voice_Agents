import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Sidebar Support and Documentation items", () => {
  const pluginShell = readFileSync(new URL("./PluginShell.jsx", import.meta.url), "utf8");
  const callingWorkspace = readFileSync(new URL("../plugins/voice/calling/CallingWorkspace.jsx", import.meta.url), "utf8");

  it("PluginShell includes Support and Documentation directly above sb-credits", () => {
    const supportIndex = pluginShell.indexOf('id: "support"');
    const docIndex = pluginShell.indexOf('id: "documentation"');
    const creditsIndex = pluginShell.indexOf('className="sb-credits"');

    expect(supportIndex).toBeGreaterThan(-1);
    expect(docIndex).toBeGreaterThan(-1);
    expect(creditsIndex).toBeGreaterThan(-1);

    expect(supportIndex).toBeLessThan(docIndex);
    expect(docIndex).toBeLessThan(creditsIndex);
  });

  it("PluginShell hides Support and Documentation when embedded", () => {
    // Both items are inside `{!embedded && ...}`
    const block = pluginShell.slice(pluginShell.indexOf('id: "support"'), pluginShell.indexOf('className="sb-credits"'));
    const beforeBlock = pluginShell.slice(pluginShell.lastIndexOf("{!embedded", pluginShell.indexOf('id: "support"')));
    expect(beforeBlock).toContain("{!embedded");
  });

  it("CallingWorkspace includes Support and Documentation directly above sb-credits", () => {
    const supportIndex = callingWorkspace.indexOf('id: "support"');
    const docIndex = callingWorkspace.indexOf('id: "documentation"');
    const creditsIndex = callingWorkspace.indexOf('className="sb-credits"');

    expect(supportIndex).toBeGreaterThan(-1);
    expect(docIndex).toBeGreaterThan(-1);
    expect(creditsIndex).toBeGreaterThan(-1);

    expect(supportIndex).toBeLessThan(docIndex);
    expect(docIndex).toBeLessThan(creditsIndex);
  });

  it("CallingWorkspace hides Support and Documentation when embedded", () => {
    const beforeBlock = callingWorkspace.slice(callingWorkspace.lastIndexOf("{!embedded", callingWorkspace.indexOf('id: "support"')));
    expect(beforeBlock).toContain("{!embedded");
  });

  it("Support item has headset icon and Documentation has book icon with external link mark", () => {
    expect(pluginShell).toMatch(/icon:\s*Headset/);
    expect(pluginShell).toMatch(/icon:\s*BookOpen/);
    expect(pluginShell).toContain("<ExternalLink");

    expect(callingWorkspace).toMatch(/icon:\s*Headset/);
    expect(callingWorkspace).toMatch(/icon:\s*BookOpen/);
    expect(callingWorkspace).toContain("<ExternalLink");
  });
});
