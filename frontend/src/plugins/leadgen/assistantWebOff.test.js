import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (f) => readFileSync(new URL(f, import.meta.url), "utf8");

describe("Web search for a person with an area limit", () => {
  it("has no switch and is never sent as on", () => {
    const s = read("./AssistantPanel.jsx");
    expect(s).toContain("webOff = false");
    expect(s).toContain("const web = webSaved && !webOff");
    expect(s).toContain("cfg.leads && !webOff ?");
  });
  it("is given to both assistant panels from the signed-in person's access", () => {
    const s = read("./LeadGenerationPlugin.jsx");
    expect(s.split("webOff={access.limited}").length - 1).toBe(2);
  });
});
