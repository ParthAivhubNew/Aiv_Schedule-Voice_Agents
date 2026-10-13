import { describe, expect, it } from "vitest";
import { legendFor, pinHtml, pinKind } from "./mapPins";

describe("map pins", () => {
  it("picks the icon from the company's own words", () => {
    expect(pinKind({ name: "Bright Smile Dental Practice" }).kind).toBe("health");
    expect(pinKind({ name: "ERP ACCOUNTANCY LTD" }).kind).toBe("accounting");
    expect(pinKind({ name: "Acme Ltd", industry: "Coffee shop" }).kind).toBe("food");
    expect(pinKind({ name: "Acme Ltd", sic_text: "Plumbing, heat and air-conditioning installation" }).kind).toBe("construction");
  });

  it("falls back to what the user searched for, then to a plain business pin", () => {
    expect(pinKind({ name: "Acme Ltd" }, "dentist").kind).toBe("health");
    expect(pinKind({ name: "Acme Ltd" }).kind).toBe("other");
    expect(pinKind({ name: "Acme Ltd" }, "").icon).toBe("🏢");
  });

  it("does not read a kind into a word that only contains one", () => {
    expect(pinKind({ name: "Mitchell Holdings" }).kind).toBe("other"); // "it" and "mot" are not words here
    expect(pinKind({ name: "Barnard Bartlett" }).kind).toBe("other");
  });

  it("marks favourites and saved companies", () => {
    const kind = pinKind({ name: "X Cafe" });
    expect(pinHtml(kind, { favourite: true })).toContain("★");
    expect(pinHtml(kind, { saved: true })).toContain("✓");
    expect(pinHtml(kind)).not.toContain("★");
  });

  it("counts the kinds on the map, most common first", () => {
    const legend = legendFor([{ name: "A Cafe" }, { name: "B Cafe" }, { name: "C Accountants" }]);
    expect(legend.map((l) => [l.kind, l.count])).toEqual([["food", 2], ["accounting", 1]]);
  });
});
