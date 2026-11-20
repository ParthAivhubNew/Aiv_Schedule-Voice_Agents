import { describe, expect, it } from "vitest";
import { summaryChips } from "./filterSummary";

const base = { sector: "", sic: "", industryTypes: [], notSector: "", includeSecondary: false, includeNonBusiness: false, town: "", postcode: "", notTown: "", near: null, sizes: [], types: [], signals: [] };

describe("summaryChips", () => {
  it("is empty when nothing is on", () => {
    for (const g of ["industry", "location", "size", "company", "status", "contact", "lists", "person", "signals"]) expect(summaryChips(g, base)).toEqual([]);
  });

  it("makes one chip per typed value and removes only that value", () => {
    const form = { ...base, sector: "accountancy, software" };
    const chips = summaryChips("industry", form);
    expect(chips.map((c) => c.text)).toEqual(["accountancy", "software"]);
    expect(chips[0].patch(form)).toEqual({ sector: "software" });
  });

  it("labels SIC codes and register types, and removes one code", () => {
    const form = { ...base, sic: "69201, 56101", industryTypes: ["Charity"] };
    const chips = summaryChips("industry", form, { 69201: "Accounting" });
    expect(chips.map((c) => c.text)).toEqual(["Accounting", "56101", "Charity"]);
    expect(chips[0].patch(form)).toEqual({ sic: "56101" });
    expect(chips[2].patch(form)).toEqual({ industryTypes: [] });
  });

  it("marks what is left out", () => {
    const chips = summaryChips("industry", { ...base, notSector: "church" });
    expect(chips[0].text).toBe("Not church");
  });

  it("clears the radius as one chip", () => {
    const form = { ...base, near: { postcode: "LS1 4AP", miles: 5, districts: ["LS1", "LS2"] } };
    const [chip] = summaryChips("location", form);
    expect(chip.text).toContain("LS1 4AP");
    expect(chip.patch(form)).toEqual({ near: null, nearPostcode: "", nearError: "" });
  });

  it("names sizes, types and flags in plain words", () => {
    expect(summaryChips("size", { ...base, sizes: ["medium_large"] })[0].text).toBe("Medium / large");
    expect(summaryChips("company", { ...base, types: ["llp"], noCharities: true }).map((c) => c.text)).toEqual(["LLP", "No charities"]);
    expect(summaryChips("contact", { ...base, hasEmail: true })[0].text).toBe("Has email");
  });
});
