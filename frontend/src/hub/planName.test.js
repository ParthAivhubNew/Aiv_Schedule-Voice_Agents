import { describe, expect, it } from "vitest";
import { planName } from "./planName";

describe("planName", () => {
  it("turns plan codes into plain names", () => {
    expect(planName("growthlead")).toBe("Growth");
    expect(planName("startervoice")).toBe("Starter");
    expect(planName("growthsocial")).toBe("Growth");
  });
  it("leaves names written for people alone", () => {
    expect(planName("Voice Starter")).toBe("Voice Starter");
    expect(planName("Growth")).toBe("Growth");
    expect(planName("")).toBe("");
  });
});
