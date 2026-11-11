import { describe, expect, it } from "vitest";
import { CONSENT_OPTIONS, consentMissing } from "./ConsentDeclaration";

describe("the consent question", () => {
  it("offers the four answers, with not sure as a normal choice", () => {
    expect(CONSENT_OPTIONS.map(([v]) => v)).toEqual(["opted_in", "existing_customer", "enquiry", "not_sure"]);
  });
  it("asks for where, when and a confirmation, but nothing more for not sure", () => {
    expect(consentMissing({ basis: "" })).toBe("Pick how they agreed to hear from you.");
    expect(consentMissing({ basis: "not_sure" })).toBe("");
    expect(consentMissing({ basis: "opted_in", source: " " })).toBe("Say where they agreed.");
    expect(consentMissing({ basis: "opted_in", source: "Website form" })).toBe("Give the date they agreed.");
    expect(consentMissing({ basis: "enquiry", source: "Phone", agreed_on: "2026-01-02" })).toBe("Tick the box to confirm.");
    expect(consentMissing({ basis: "enquiry", source: "Phone", agreed_on: "2026-01-02", confirmed: true })).toBe("");
  });
});
