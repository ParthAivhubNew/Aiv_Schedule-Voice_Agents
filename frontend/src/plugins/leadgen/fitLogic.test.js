import { describe, expect, it } from "vitest";
import { byFit, fitTip, fitTone, icpSummary, isIcpSet, sortOptions, splitAreas } from "./fitLogic";

describe("fit score helpers", () => {
  it("shows no tone without a score", () => {
    expect(fitTone(null)).toBeNull();
    expect(fitTone(undefined)).toBeNull();
    expect(fitTone(85).word).toBe("Strong fit");
    expect(fitTone(45).word).toBe("Some fit");
    expect(fitTone(10).word).toBe("Weak fit");
  });

  it("lists every reason the server sent, and says so when there are none", () => {
    const tip = fitTip({ score: 72, reasons: ["Director on the register: Jane Smith", "Registered office in LS1, inside LS"] });
    expect(tip).toContain("Fit 72 of 100");
    expect(tip).toContain("Jane Smith");
    expect(tip).toContain("inside LS");
    expect(fitTip({ score: 0, reasons: [] })).toContain("Nothing we hold matches");
    expect(fitTip(null)).toBe("");
  });

  it("puts the best fit first and unscored rows last, keeping ties in order", () => {
    const rows = [{ id: "a", fit: { score: 40 } }, { id: "b", fit: null }, { id: "c", fit: { score: 90 } }, { id: "d", fit: { score: 40 } }, { id: "e" }];
    expect(byFit(rows).map((r) => r.id)).toEqual(["c", "a", "d", "b", "e"]);
  });

  it("knows when an ideal customer is set", () => {
    expect(isIcpSet(null)).toBe(false);
    expect(isIcpSet({ exclude_charities: true })).toBe(false);
    expect(isIcpSet({ sic_codes: ["56102"] })).toBe(true);
    expect(isIcpSet({ areas: [{ postcode: "LS1 4AP", radius_miles: 10 }] })).toBe(true);
  });

  it("words the ideal customer in one line", () => {
    const line = icpSummary({ sic_codes: ["56102"], sic_labels: { 56102: "Unlicensed restaurants and cafes" }, postcode_areas: ["LS"],
      areas: [{ postcode: "M1 1AA", radius_miles: 5 }], size_bands: ["micro"], company_types: ["ltd"], exclude_charities: true }, { ltd: "Private limited company" });
    expect(line).toBe("Unlicensed restaurants and cafes (56102) · LS, within 5 miles of M1 1AA · Micro · Private limited company · no charities");
  });

  it("reads typed postcode areas", () => {
    expect(splitAreas("ls, M1  bd1,LS")).toEqual(["LS", "M1", "BD1"]);
  });

  it("offers Best fit only once an ideal customer is set", () => {
    expect(sortOptions(true)[0]).toEqual(["fit", "Best fit"]);
    expect(sortOptions(false)[0]).toEqual(["best", "Best match"]);
    expect(sortOptions(true).map(([v]) => v)).not.toContain("best");
  });
});
