import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BrandContext } from "../../brand/BrandContext";
import { NO_BRAND, resolveBrand, withPolicyDefaults } from "../../brand/brandLogic";
import { StandingChip } from "../../brand/StandingChip";
import { aiImagesOff, aiVideoOff, allowedChannels, networksLimited } from "./socialRulesUi";

const CH = [{ id: "linkedin" }, { id: "x" }, { id: "facebook" }];

describe("the company's rules on the screens (plan 12, F2)", () => {
  it("offers only the networks and AI options the rules allow", () => {
    expect(allowedChannels(CH, null)).toEqual(CH);
    expect(allowedChannels(CH, { networks: [] })).toEqual(CH);
    expect(allowedChannels(CH, { networks: ["x"] }).map((c) => c.id)).toEqual(["x"]);
    expect(allowedChannels(CH, { networks: [], networks_none: true })).toEqual([]);
    expect([aiImagesOff({ ai_images: false }), aiImagesOff(null), aiVideoOff({ ai_video: false }), networksLimited({ networks: ["x"] })]).toEqual([true, false, true, true]);
  });

  it("reads the Social rules from the account's policy", () => {
    expect(resolveBrand({ policy: { social: { networks: ["x"] } } }).social).toEqual({ networks: ["x"] });
    expect(resolveBrand({}).social).toBe(null);
  });

  it("keeps a brand's Social rules when its editor fills the defaults", () => {
    expect(withPolicyDefaults({ social: { approver: "admin", networks: ["x"] } }).social).toEqual({ approver: "admin", networks: ["x"], ai_images: true, ai_video: true });
    expect(withPolicyDefaults({}).social.networks).toEqual([]);
  });

  it("lets an admin open the company's rules from Find Leads", () => {
    const wrap = (el) => renderToStaticMarkup(<BrandContext.Provider value={{ ...NO_BRAND, standingExclusions: true }}>{el}</BrandContext.Provider>);
    expect(wrap(<StandingChip canSeeRules />)).toContain("See rules");
    expect(wrap(<StandingChip />)).not.toContain("See rules");
  });
});
