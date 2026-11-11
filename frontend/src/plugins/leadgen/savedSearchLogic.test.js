import { describe, expect, it } from "vitest";
import { cleanFilters, coversText, nearFromReply, toggleIn, weeklyLabel } from "./savedSearchLogic";

describe("saved search helpers", () => {
  it("keeps the radius and signals when saving, and drops them when empty", () => {
    const near = nearFromReply("ls1 4ap", 5, { districts: ["LS1", "LS2"], postcode: "LS1 4AP" });
    const filters = { sic_codes: ["69201"], near, signals: ["new_director"] };
    expect(cleanFilters(filters)).toEqual(filters);
    expect(cleanFilters({ near: { districts: [] }, signals: [], towns: ["leeds"] })).toEqual({ towns: ["leeds"] });
  });

  it("says how many districts a radius covers", () => {
    expect(coversText({ districts: ["LS1", "LS2", "LS3"] })).toBe("Covers 3 postcode districts");
    expect(coversText({ districts: ["LS1"] })).toBe("Covers 1 postcode district");
    expect(coversText(null)).toBe("");
  });

  it("toggles a signal on and off", () => {
    expect(toggleIn(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleIn(["a", "b"], "a")).toEqual(["b"]);
  });

  it("labels the weekly update plainly", () => {
    expect(weeklyLabel({ weekly: true, last_run_at: null })).toBe("Updates weekly.");
    expect(weeklyLabel({ weekly: true, last_run_at: "2026-11-03T08:00:00Z", last_added: 4 })).toMatch(/^Updates weekly\. Last run .*, 4 new\.$/);
    expect(weeklyLabel({ weekly: false, last_run_at: "2026-11-03T08:00:00Z", last_added: 0 })).toMatch(/nothing new/);
    expect(weeklyLabel({ weekly: false })).toBe("Runs when you ask.");
  });
});
