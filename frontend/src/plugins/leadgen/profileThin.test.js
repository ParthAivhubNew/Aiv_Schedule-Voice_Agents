import { describe, expect, it } from "vitest";
import { profileIsThin } from "./profileThin";

describe("profileIsThin", () => {
  it("is thin with nothing stored", () => {
    expect(profileIsThin({ profile: {}, edit: {}, services: 0 })).toBe(true);
    expect(profileIsThin(null)).toBe(true);
  });
  it("is thin with only a name and what is sold", () => {
    expect(profileIsThin({ profile: { company: "Acme", sells: "Payroll" }, edit: {} })).toBe(true);
  });
  it("is not thin with the basics and one more field", () => {
    expect(profileIsThin({ profile: { company: "Acme", sells: "Payroll", audience: "Small firms" }, edit: {} })).toBe(false);
  });
  it("counts saved services as what the business sells", () => {
    expect(profileIsThin({ profile: { company: "Acme", website: "acme.com", tone: "Warm" }, edit: {}, services: 2 })).toBe(false);
  });
  it("is thin without a company name even when much else is filled", () => {
    expect(profileIsThin({ profile: { sells: "x", website: "a.com", audience: "y", offer: "z" }, edit: {} })).toBe(true);
  });
});
