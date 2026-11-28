import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../brand/brandApi", () => ({ getOrgRules: () => Promise.resolve({}), getRuleSets: () => Promise.resolve({ sets: [] }),
  previewOrgRules: () => Promise.resolve({}), saveOrgRules: () => Promise.resolve({}) }));

import { readFileSync } from "node:fs";
import { RulesForm, RulesTab } from "./RulesTab";
import { draftFrom, fromBrand, previewLine, toPayload } from "./rulesLogic";

const SETS = [{ id: "standard_b2b", label: "Standard B2B exclusions", desc: "Active Companies House companies only." }];

describe("company rules", () => {
  it("turns the form into the policy the server takes", () => {
    const d = { ...draftFrom({}), sets: ["standard_b2b"], extraText: "84110\ncare home, 84110", districtsText: "bn1, BN3", sources: { google: true } };
    const { payload, problems } = toPayload(d);
    expect(problems).toEqual([]);
    expect(payload.exclusions).toEqual({ sets: ["standard_b2b"], fsb: true, extra: [], locked: true }); // a company's own items are its Exclusions list now
    expect(toPayload(d, "brand").payload.exclusions.extra).toEqual(["84110", "care home"]);
    expect(payload.geo.districts).toEqual(["BN1", "BN3"]);
    expect(toPayload({ ...d, districtsText: "nowhere" }).problems[0]).toContain("NOWHERE");
    expect(toPayload({ ...d, signin: { password: false, google: false, microsoft: false } }).problems[0]).toContain("at least one sign-in");
    expect(draftFrom({ exclusions: { fsb: true } }).sets).toEqual(["standard_b2b"]);  // the old flag reads as the rule set
    const social = toPayload({ ...d, approver: "admin", networks: ["linkedin"], aiImages: false }).payload.social;
    expect(social).toEqual({ approver: "admin", networks: ["linkedin"], ai_images: false, ai_video: true });
  });

  it("shows what the brand set as set", () => {
    const brand = fromBrand({ exclusions: { fsb: true, extra: ["x1", "x2"] }, restricted_sources: { google: true }, signin: { password: false } });
    expect(brand.sets).toEqual(["standard_b2b"]);
    expect(brand.sources).toEqual({ google: true });
    expect(brand.signinOff).toEqual({ password: true });
    const fsb = fromBrand({ social: { approver: "admin", networks: ["linkedin", "x"], ai_video: false } });
    expect([fsb.approverAdmin, fsb.networks, fsb.aiVideoOff, fsb.aiImagesOff]).toEqual([true, ["linkedin", "x"], true, false]);
    const html = renderToStaticMarkup(<RulesTab initial={{ brand: { exclusions: { fsb: true }, restricted_sources: { google: true } }, brandName: "FSB", company: {} }} initialSets={SETS} />);
    expect(html).toContain("Standard B2B exclusions");
    expect(html).toContain("Set by FSB");
    expect(html).toContain("Save rules");
    expect(previewLine({ total: 65210, kept: 59349, hidden: 5861, inArea: true })).toBe("Hides 5,861 of 65,210 companies in your area. 59,349 stay in your searches.");
    expect(previewLine({ tooBig: true, note: "Too many" })).toBe("Too many");
  });

  it("the staff Brands page uses the same editor, at brand level (plan 12, F4)", () => {
    const html = renderToStaticMarkup(<RulesForm draft={draftFrom({ exclusions: { fsb: true } })} set={() => {}} sets={SETS} level="brand" />);
    expect(html).toContain("every company on this brand");
    expect(html).toContain("The brand&#x27;s area");
    expect(html).not.toContain("See how many this hides"); // a count needs one company's area
    expect(html).not.toContain("Set by");
    const ro = renderToStaticMarkup(<RulesForm draft={draftFrom({})} set={() => {}} sets={SETS} level="brand" disabled />);
    expect(ro).toMatch(/<fieldset disabled=""/);
    const brands = readFileSync(new URL("../adminPortal/Brands.jsx", import.meta.url), "utf8");
    expect(brands).toContain('<RulesForm draft={draft}');
    expect(brands).not.toMatch(/FSB exclusion rules|Restricted sources/); // the old hand-built editor is gone
  });
});
