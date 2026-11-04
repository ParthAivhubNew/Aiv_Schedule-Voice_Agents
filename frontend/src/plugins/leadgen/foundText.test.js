import { describe, expect, it } from "vitest";
import { foundHeading } from "./foundText";

const rows = (n) => Array.from({ length: n }, (_, i) => ({ id: `c${i}`, name: `Co ${i}` }));

describe("foundHeading", () => {
  it("says how many are listed and how many match", () => {
    const h = foundHeading({ total: 312, top: rows(20), asked: 20 });
    expect(h.title).toBe("20 companies, out of 312 that match");
    expect(h.note).toContain("20 you asked for");
  });
  it("adds a plus when the total is capped", () => {
    expect(foundHeading({ total: 10000, capped: true, top: rows(8) }).title).toBe("8 companies, out of 10,000+ that match");
  });
  it("has no note when everything that matched is listed", () => {
    expect(foundHeading({ total: 3, top: rows(3) })).toEqual({ title: "3 companies", note: "" });
    expect(foundHeading({ total: 1, top: rows(1) }).title).toBe("1 company");
  });
  it("handles nothing found", () => {
    expect(foundHeading({ total: 0, top: [] }).title).toBe("No companies found");
  });
});

import { webResultText } from "./foundText";

describe("webResultText", () => {
  it("says plainly when fewer than asked were found, and what is charged", () => {
    const t = webResultText(14, 20, "plumbers in Leeds");
    expect(t).toContain("Found 14 of the 20 you asked for");
    expect(t).toContain("only 14 are charged");
  });
  it("is plain when the number was met or none was asked", () => {
    expect(webResultText(20, 20, "x")).toMatch(/^Found 20 on the web\./);
    expect(webResultText(5, 0, "x")).toMatch(/^Found 5 on the web\./);
  });
  it("says nothing was charged for no results", () => {
    expect(webResultText(0, 20, "x")).toContain("Nothing was charged");
  });
});
