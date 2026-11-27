import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("../api/apiClient", () => ({ api: { getBillingOverview: () => Promise.resolve(null), getOnboarding: () => Promise.resolve(null) } }));

import { appStatus } from "./AppHome";

const plan = { name: "Starter" };
const from = { priceUsdCents: 19999, currency: "gbp" };

// Plan 13, step 5: Home says what's happening, and an app you haven't added is an offer, not a problem.
describe("what Home says about an app", () => {
  it("an app you have shows its credits, or its plan", () => {
    expect(appStatus({ plan, wallet: { balance: 550 } }, "credits")).toEqual({ text: "550 credits left", tone: "ink" });
    expect(appStatus({ plan, wallet: { balance: 20, low: true } }, "credits").tone).toBe("amber");
    expect(appStatus({ plan, wallet: { balance: 0 } }, "credits").text).toBe("Starter");
  });

  it("running out is amber with a way on, never red", () => {
    expect(appStatus({ plan, wallet: { balance: 0, empty: true } }, "credits")).toEqual({ text: "Out of credits: top up to carry on", tone: "amber" });
  });

  it("an app you haven't added never says Out of credits", () => {
    const s = appStatus({ wallet: { balance: 0, empty: true }, from, vat: " + VAT" }, "credits");
    expect(s.text).not.toMatch(/Out of credits/);
    expect(s.text).toMatch(/^From .*\/month \+ VAT$/);
    expect(s.tone).toBe("muted");
    expect(appStatus({ wallet: { balance: 50 }, from }, "credits")).toEqual({ text: "50 credits left to try it", tone: "muted" });
    expect(appStatus({ wallet: { balance: 0, empty: true } }, "credits").text).toBe("Not added yet");
    expect(appStatus({}, "credits")).toBeNull();
  });

  it("Home shows one next step, not the checklist, and no second help footer", () => {
    const src = readFileSync(new URL("./AppHome.jsx", import.meta.url), "utf8");
    expect(src).toContain("<NextStep");
    expect(src).not.toContain("<OnboardingChecklist");
    expect(src).not.toContain("Need help or looking for product guides?");
    expect(src).not.toContain("Manage plan");
    expect(src).not.toMatch(/C\.red/);
  });
});
