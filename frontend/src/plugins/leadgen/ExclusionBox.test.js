import { describe, expect, it } from "vitest";
import { closest, items, keyOf, kindOf, matches, wordAt } from "./ExclusionBox";

const CATS = new Set(["places of worship", "hospitals", "schools special", "banks and financial institutions"]);

describe("what each chip is read as", () => {
  it("tells category, word, SIC code, postcode and company number apart", () => {
    expect(kindOf("Places of Worship", CATS)).toBe("Category");
    expect(kindOf("Schools (Special)", CATS)).toBe("Category");
    expect(kindOf("church", CATS)).toBe("Word");
    expect(kindOf("56101", CATS)).toBe("SIC code");
    expect(kindOf("56", CATS)).toBe("SIC code");
    expect(kindOf("bn9", CATS)).toBe("Postcode");
    expect(kindOf("BN1 4", CATS)).toBe("Postcode");
    expect(kindOf("01234567", CATS)).toBe("Company no.");
    expect(kindOf("SC123456", CATS)).toBe("Company no.");
  });
  it("reads a label the way the server does", () => {
    expect(keyOf("Banks & Financial  Institutions")).toBe("banks and financial institutions");
    expect(items("a, b\nc,, d ")).toEqual(["a", "b", "c", "d"]);
  });
});

describe("the dropdown", () => {
  const L = ["Places of Worship", "Hospitals", "hospital", "Schools (Special)", "worship", "church"];
  it("lists what starts with the text first, then what has a word starting with it", () => {
    expect(matches("hosp", L, new Set())).toEqual(["hospital", "Hospitals"]);
    expect(matches("wor", L, new Set())).toEqual(["worship", "Places of Worship"]);
  });
  it("skips what is already added, and short or empty text", () => {
    expect(matches("hosp", L, new Set(["hospital"]))).toEqual(["Hospitals"]);
    expect(matches("h", L, new Set())).toEqual([]);
    expect(matches("", L, new Set())).toEqual([]);
  });
  it("offers at most six", () => {
    expect(matches("ab", Array.from({ length: 20 }, (_, i) => `ab${i}`), new Set())).toHaveLength(6);
  });
});

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
