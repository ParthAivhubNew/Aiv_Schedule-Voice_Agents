import { describe, expect, it } from "vitest";
import { distance, matchTerms, termKey } from "./industryMatch";

const TERMS = [
  { k: "sic", code: "69201", label: "Accounting activities", n: 24000 },
  { k: "sic", code: "69202", label: "Bookkeeping activities", n: 9000 },
  { k: "sic", code: "69203", label: "Tax consultancy", n: 5000 },
  { k: "sic", code: "49320", label: "Taxi operation", n: 40000 },
  { k: "sic", code: "62012", label: "Business and domestic software development", n: 99000 },
  { k: "sic", code: "62020", label: "Information technology consultancy activities", n: 129000 },
  { k: "sic", code: "86230", label: "Dental practice activities", n: 14000 },
  { k: "sic", code: "99999", label: "Dormant Company", n: 104000, hidden: true },
  { k: "type", label: "Dentist", n: 10851 },
  { k: "type", label: "Restaurant/Cafe/Canteen", n: 140778 },
  { k: "type", label: "Charity", n: 368403 },
];
const FAMILIES = [
  { name: "accounting", words: ["accountancy", "accounting", "accountant", "accountants", "bookkeeping", "tax"], codes: ["69201", "69202", "69203"] },
  { name: "dental", words: ["dentist", "dentists", "dental"], codes: ["86230"] },
  { name: "restaurants", words: ["restaurant", "restaurants", "cafe", "cafes", "takeaway"], codes: ["56101"] },
];
const labels = (q, taken) => matchTerms(q, TERMS, FAMILIES, taken).map((t) => t.label);

describe("matching what is typed to real industries", () => {
  it("finds a trade word and its family's codes, most companies first within a tier", () => {
    expect(labels("accountants")).toEqual(["Accounting activities", "Bookkeeping activities", "Tax consultancy"]);
    expect(labels("dentist")).toEqual(["All dental", "Dentist", "Dental practice activities"]);
  });
  it("offers one pick for a whole trade when a register type is named like it", () => {
    const g = matchTerms("dentist", TERMS, FAMILIES)[0];
    expect(g).toMatchObject({ k: "group", name: "dental", codes: ["86230"], types: ["Dentist"] });
    expect(g.n).toBe(14000 + 10851);
    // accounting has SIC codes only, so there is nothing to combine: the codes are offered on their own
    expect(matchTerms("accountants", TERMS, FAMILIES).some((t) => t.k === "group")).toBe(false);
    // restaurants: its SIC code is not in this list, so the group would hold just the one type: that is offered as itself
    expect(matchTerms("restaurant", TERMS, FAMILIES).map((t) => t.label)).toEqual(["Restaurant/Cafe/Canteen"]);
  });
  it("drops the group once everything in it is chosen", () => {
    expect(matchTerms("dentist", TERMS, FAMILIES, new Set(["sic:86230", "type:Dentist"])).some((t) => t.k === "group")).toBe(false);
    expect(matchTerms("dentist", TERMS, FAMILIES, new Set(["type:Dentist"])).some((t) => t.k === "group")).toBe(false); // no type left to add
  });
  it("matches the start of a code, and the start of a word while typing", () => {
    expect(labels("692")).toEqual(["Accounting activities", "Bookkeeping activities", "Tax consultancy"]);
    expect(labels("acc")).toEqual(["Accounting activities"]);
    expect(labels("rest")).toEqual(["Restaurant/Cafe/Canteen"]);
  });
  it("puts a whole word before a word start, and never mixes tax with taxi through spelling", () => {
    expect(labels("tax")[0]).toBe("Tax consultancy");
    expect(labels("tax")).toContain("Taxi operation"); // a word that merely starts with it is still offered while typing, but last
    expect(labels("tax").indexOf("Taxi operation")).toBeGreaterThan(labels("tax").indexOf("Tax consultancy"));
  });
  it("corrects a close spelling of a long word, not a short one", () => {
    expect(labels("accoutants")).toContain("Accounting activities"); // through the trade family's close words
    expect(labels("softwre")).toContain("Business and domestic software development");
    expect(labels("taxx")).toEqual([]);
  });
  it("skips what is already chosen, hidden values, and text under two letters", () => {
    expect(labels("accounting", new Set(["sic:69201"]))).not.toContain("Accounting activities");
    expect(labels("dorm")).toEqual(["Dormant Company"]);
    expect(labels("comp")).not.toContain("Dormant Company");
    expect(labels("a")).toEqual([]);
    expect(labels("")).toEqual([]);
  });
  it("gives every term a distinct key", () => {
    expect(new Set(TERMS.map(termKey)).size).toBe(TERMS.length);
  });
});

describe("edit distance", () => {
  it("counts changes and stops early", () => {
    expect(distance("software", "softwre", 2)).toBe(1);
    expect(distance("abc", "xyz", 1)).toBe(2);
    expect(distance("abcdef", "a", 1)).toBe(2);
  });
});
