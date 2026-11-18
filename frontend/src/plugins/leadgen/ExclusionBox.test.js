import { describe, expect, it } from "vitest";
import { closest, wordAt } from "./ExclusionBox";

const LIST = ["Places of Worship", "Hospitals", "Schools (Special)", "church", "chapel", "Chambers of Commerce", "casino"];

describe("the word being typed", () => {
  it("is what follows the last comma or line break", () => {
    expect(wordAt("church, hosp")).toEqual({ head: "church, ", word: "hosp" });
    expect(wordAt("church,\nsch")).toEqual({ head: "church,\n", word: "sch" });
    expect(wordAt("hosp")).toEqual({ head: "", word: "hosp" });
  });
});

describe("the closest suggestion", () => {
  it("finishes what is typed, ignoring capitals", () => {
    expect(closest("hosp", LIST)).toBe("Hospitals");
    expect(closest("church, PLA", LIST)).toBe("Places of Worship");
  });
  it("takes the shortest match and says nothing under two letters", () => {
    expect(closest("ch", LIST)).toBe("chapel");
    expect(closest("c", LIST)).toBe("");
  });
  it("does not offer what is already in the list, or a finished word", () => {
    expect(closest("church, chu", LIST)).toBe("");
    expect(closest("Hospitals", LIST)).toBe("");
    expect(closest("zzz", LIST)).toBe("");
  });
});
