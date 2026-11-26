import { describe, expect, it } from "vitest";
import { actionPrice, appsInOrder, creditsLine, money } from "./pricingLogic";

describe("the public pricing page", () => {
  it("shows money the British way, without pence on whole amounts", () => {
    expect(money(4999, "gbp")).toBe("£49.99");
    expect(money(9900, "GBP")).toBe("£99");
    expect(money(1900, "USD")).toBe("US$19");
  });

  it("says what a plan's credits buy in the app's own terms", () => {
    expect(creditsLine("leadgen", 500)).toBe("500 credits a month");
    expect(creditsLine("voice", 600)).toBe("600 credits a month: 10 hours of calls");
    expect(creditsLine("voice", 90, { monthly: false })).toBe("90 credits: 90 minutes of calls");
  });

  it("prices each action from the rate card", () => {
    expect(actionPrice({ credits: 1, unit: "minute" })).toBe("1 credit per minute");
    expect(actionPrice({ credits: 1, unit: "5 numbers" })).toBe("1 credit per 5 numbers");
    expect(actionPrice({ credits: 0, unit: "minute" })).toBe("Free");
  });

  it("puts Leads first and each app's plans cheapest first", () => {
    const out = appsInOrder([{ id: "voice", plans: [{ priceCents: 9999 }, { priceCents: 4999 }] }, { id: "leadgen", plans: [] }]);
    expect(out.map((a) => a.id)).toEqual(["leadgen", "voice"]);
    expect(out[1].plans.map((p) => p.priceCents)).toEqual([4999, 9999]);
  });
});
