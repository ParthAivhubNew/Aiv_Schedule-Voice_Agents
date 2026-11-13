import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { plainSector, PROFILE, Reach } from "./FindLeadsParts";

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

describe("a contact our registry holds but this organisation has not opened", () => {
  it("shows Held, not a button", () => {
    const html = renderToStaticMarkup(React.createElement(Reach, { value: "", kind: "phone", closed: true, onOpen: () => {} }));
    expect(html).toContain("Held");
    expect(html).not.toContain("<button");
    expect(html).not.toMatch(/free/i);
  });
});

describe("nameAsKeywordTown", () => {
  it("reads a trade and a town typed as a company name", async () => {
    const { nameAsKeywordTown } = await import("./companyLogic");
    expect(nameAsKeywordTown("accountants reading")).toEqual({ keyword: "accountants", town: "Reading" });
    expect(nameAsKeywordTown("Plumbers in high wycombe")).toEqual({ keyword: "plumbers", town: "High Wycombe" });
    expect(nameAsKeywordTown("Tesco")).toBe(null);
  });
});
