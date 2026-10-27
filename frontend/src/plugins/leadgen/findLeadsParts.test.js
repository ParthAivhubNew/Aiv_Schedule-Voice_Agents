import { describe, expect, it } from "vitest";
import { plainSector, PROFILE } from "./FindLeadsParts";

describe("how a result is described in the table", () => {
  it("drops the SIC code in front of a sector", () => {
    expect(plainSector("47110 - Retail sale in non-specialised stores")).toBe("Retail sale in non-specialised stores");
    expect(plainSector("Retail")).toBe("Retail");
    expect(plainSector("")).toBe("");
  });

  it("names the three groups of results and what each one holds", () => {
    expect(Object.keys(PROFILE)).toEqual(["full", "partial", "basic"]);
    expect(PROFILE.basic.note).toMatch(/registry facts only/i);
  });
});
