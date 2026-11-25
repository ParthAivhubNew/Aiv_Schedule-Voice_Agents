import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../brand/brandApi", () => ({ getOrgRules: () => Promise.resolve({}), getRuleSets: () => Promise.resolve({ sets: [] }),
  previewOrgRules: () => Promise.resolve({}), saveOrgRules: () => Promise.resolve({}) }));

import { RulesTab } from "./RulesTab";
import { draftFrom, fromBrand, previewLine, toPayload } from "./rulesLogic";

const SETS = [{ id: "standard_b2b", label: "Standard B2B exclusions", desc: "Active Companies House companies only." }];

describe("company rules", () => {
  it("turns the form into the policy the server takes", () => {
    const d = { ...draftFrom({}), sets: ["standard_b2b"], extraText: "84110\ncare home, 84110", districtsText: "bn1, BN3", sources: { google: true } };
    const { payload, problems } = toPayload(d);
    expect(problems).toEqual([]);
    expect(payload.exclusions).toEqual({ sets: ["standard_b2b"], fsb: true, extra: ["84110", "care home"], locked: true });
    expect(payload.geo.districts).toEqual(["BN1", "BN3"]);
    expect(toPayload({ ...d, districtsText: "nowhere" }).problems[0]).toContain("NOWHERE");
    expect(toPayload({ ...d, signin: { password: false, google: false, microsoft: false } }).problems[0]).toContain("at least one sign-in");
    expect(draftFrom({ exclusions: { fsb: true } }).sets).toEqual(["standard_b2b"]);  // the old flag reads as the rule set
  });

  it("shows what the brand set as set", () => {
    const brand = fromBrand({ exclusions: { fsb: true, extra: ["x1", "x2"] }, restricted_sources: { google: true }, signin: { password: false } });
    expect(brand.sets).toEqual(["standard_b2b"]);
    expect(brand.sources).toEqual({ google: true });
    expect(brand.signinOff).toEqual({ password: true });
    const html = renderToStaticMarkup(<RulesTab initial={{ brand: { exclusions: { fsb: true }, restricted_sources: { google: true } }, brandName: "FSB", company: {} }} initialSets={SETS} />);
    expect(html).toContain("Standard B2B exclusions");
    expect(html).toContain("Set by FSB");
    expect(html).toContain("Save rules");
    expect(previewLine({ total: 65210, kept: 59349, hidden: 5861, inArea: true })).toBe("Hides 5,861 of 65,210 companies in your area. 59,349 stay in your searches.");
    expect(previewLine({ tooBig: true, note: "Too many" })).toBe("Too many");
  });
});
