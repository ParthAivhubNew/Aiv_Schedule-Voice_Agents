import { describe, expect, it } from "vitest";
import { pluralise, usageCount } from "./usageUnits";

describe("usage units", () => {
  it("pluralises the way English does", () => {
    expect(pluralise(7, "search")).toBe("searches");
    expect(pluralise(1, "search")).toBe("search");
    expect(pluralise(2, "minute of call")).toBe("minutes of call");
    expect(pluralise(3, "reply")).toBe("replies");
    expect(pluralise(2, "email")).toBe("emails");
  });
  it("turns a per-5 price into plain counts", () => {
    expect(usageCount(0.6, "5 numbers").text).toBe("3 numbers");
    expect(usageCount(1, "5 numbers").text).toBe("5 numbers");
    expect(usageCount(7, "search").text).toBe("7 searches");
  });
});
