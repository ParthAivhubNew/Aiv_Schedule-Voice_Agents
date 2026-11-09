import { describe, expect, it } from "vitest";
import { countText, pagePicked, selectionLine, toggleOne, togglePage } from "./bulkSelect";

const page = ["a", "b", "c"];

describe("ticking rows across pages", () => {
  it("ticks and unticks one row", () => {
    const on = toggleOne(new Set(), "a");
    expect([...on]).toEqual(["a"]);
    expect(toggleOne(on, "a").size).toBe(0);
  });
  it("the header box ticks the page and keeps ticks on other pages", () => {
    const next = togglePage(new Set(["z"]), page);
    expect(pagePicked(next, page)).toBe(true);
    expect(next.has("z")).toBe(true);
    const off = togglePage(next, page);
    expect([...off]).toEqual(["z"]);
  });
  it("a part-ticked page is ticked in full", () => {
    expect(pagePicked(togglePage(new Set(["a"]), page), page)).toBe(true);
  });
});

describe("the line above the table", () => {
  it("offers every matching row once the page is ticked", () => {
    const line = selectionLine({ count: 3, everything: false, ids: new Set(page), pageIds: page, total: 24 });
    expect(line.text).toBe("3 selected out of 24.");
    expect(line.offer).toBe("Select all 24");
  });
  it("offers nothing while the page is only part ticked", () => {
    expect(selectionLine({ count: 1, everything: false, ids: new Set(["a"]), pageIds: page, total: 24 }).offer).toBeNull();
  });
  it("says all are selected after Select all", () => {
    const ids = new Set(Array.from({ length: 24 }, (_, i) => `r${i}`));
    expect(selectionLine({ count: 24, everything: true, ids, pageIds: page, total: 24 }).text).toBe("All 24 companies selected.");
  });
  it("is honest when more match than one bulk action takes", () => {
    const line = selectionLine({ count: 3, everything: false, ids: new Set(page), pageIds: page, total: 10000, capped: true, reach: 2000 });
    expect(line.text).toBe("3 selected out of 10,000+.");
    expect(line.offer).toBe("Select the first 2,000");
    const all = selectionLine({ count: 2000, everything: true, ids: new Set(page), pageIds: page, total: 10000, capped: true, reach: 2000 });
    expect(all.text).toContain("The first 2,000 of 10,000+ companies are selected");
  });
  it("shows nothing when nothing is ticked", () => {
    expect(selectionLine({ count: 0, everything: false, ids: new Set(), pageIds: page, total: 24 })).toBeNull();
  });
  it("writes a capped count with a plus", () => {
    expect(countText(10000, true)).toBe("10,000+");
    expect(countText(1234)).toBe("1,234");
  });
});
