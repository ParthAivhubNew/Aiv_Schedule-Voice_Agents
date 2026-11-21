import { describe, expect, it } from "vitest";
import { buildTitle, defaultPolicy, isHost, normaliseAccent, normaliseHost, NO_BRAND, parseDistricts, parseExtra, resolveBrand, withPolicyDefaults } from "./brandLogic";

describe("brandLogic", () => {
  it("normalises a host", () => {
    expect(normaliseHost("HTTPS://Outreach.Example.com:8080/signin?x=1")).toBe("outreach.example.com");
    expect(normaliseHost("")).toBe("");
    expect(isHost("outreach.example.com")).toBe(true);
    expect(isHost("localhost")).toBe(false);
  });
  it("validates accent colours", () => {
    expect(normaliseAccent("#ABC")).toBe("#aabbcc");
    expect(normaliseAccent("1f6feb")).toBe("#1f6feb");
    expect(normaliseAccent("")).toBe("");
    expect(normaliseAccent("blue")).toBeNull();
    expect(normaliseAccent("#12345")).toBeNull();
  });
  it("validates districts", () => {
    expect(parseDistricts("bn1, BN 3").invalid).toEqual(["BN", "3"]); // a district has no space inside
    expect(parseDistricts("BN1, bn3, W1A")).toEqual({ districts: ["BN1", "BN3", "W1A"], invalid: [] });
    expect(parseDistricts("BN1, hello").invalid).toEqual(["HELLO"]);
  });
  it("splits extra exclusions", () => {
    expect(parseExtra("85200, church\ncare home,85200")).toEqual(["85200", "church", "care home"]);
  });
  it("fills policy defaults", () => {
    expect(withPolicyDefaults(null)).toEqual(defaultPolicy());
    const p = withPolicyDefaults({ signin: { google: false }, geo: { districts: ["BN1"] } });
    expect(p.signin).toEqual({ password: true, google: false, microsoft: true });
    expect(p.geo.districts).toEqual(["BN1"]);
    expect(p.screening).toEqual({ block_unscreened: false });
    expect(withPolicyDefaults({ screening: { block_unscreened: true } }).screening.block_unscreened).toBe(true);
  });
  it("builds the title", () => {
    expect(buildTitle("FSB Outreach", "Leads")).toBe("FSB Outreach | Leads");
    expect(buildTitle("", "Outreach by Aivhub")).toBe("Outreach by Aivhub");
    expect(buildTitle("FSB", "FSB")).toBe("FSB");
  });
  it("gives today's look when there is no brand", () => {
    expect(resolveBrand({ host: {}, me: {}, policy: {} })).toEqual(NO_BRAND);
    expect(resolveBrand()).toEqual(NO_BRAND);
  });
  it("resolves a brand from the host, then from the account", () => {
    const host = { name: "FSB", displayName: "FSB Outreach", logoUrl: "https://x/l.png", accent: "#123", poweredBy: true, signin: { password: true, google: false, microsoft: true } };
    const before = resolveBrand({ host });
    expect(before).toMatchObject({ active: true, name: "FSB Outreach", accent: "#112233", hideCredits: false });
    expect(before.signin.google).toBe(false);
    const after = resolveBrand({ host, me: { ...host, hideCredits: true, standingExclusions: true }, policy: { memberSuppression: true } });
    expect(after).toMatchObject({ hideCredits: true, standingExclusions: true, memberSuppression: true });
  });
  it("shows the standing-exclusions note even for an account without a brand", () => {
    expect(resolveBrand({ me: {}, policy: { standingExclusions: true } })).toMatchObject({ active: false, standingExclusions: true });
  });
});
