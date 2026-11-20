import { describe, expect, it } from "vitest";
import { detailMissing, hiddenNow, isLate, searchKey, skipRepeat } from "./searchGuard";

describe("a search pressed while another runs", () => {
  const first = searchKey({ keyword: ["accountancy"] }, 0, null);
  it("is kept when the filters changed (the town was added)", () => {
    const second = searchKey({ keyword: ["accountancy"], towns: ["Leeds"] }, 0, null);
    expect(skipRepeat(true, false, second, first)).toBe(false);
  });
  it("is ignored only when it is the same search again", () => {
    expect(skipRepeat(true, false, first, first)).toBe(true);
    expect(skipRepeat(false, false, first, first)).toBe(false);
    expect(skipRepeat(true, true, first, first)).toBe(false);
  });
  it("treats another page of the same search as a different search", () => {
    expect(skipRepeat(true, false, searchKey({ keyword: ["a"] }, 100, null), searchKey({ keyword: ["a"] }, 0, null))).toBe(false);
  });
});

describe("search key", () => {
  it("treats a changed sort or tab as a different search", () => {
    const a = searchKey({ keyword: ["a"] }, 0, null, { sort: "best", tab: "companies" });
    expect(skipRepeat(true, false, searchKey({ keyword: ["a"] }, 0, null, { sort: "newest", tab: "companies" }), a)).toBe(false);
    expect(skipRepeat(true, false, searchKey({ keyword: ["a"] }, 0, null, { sort: "best", tab: "people" }), a)).toBe(false);
    expect(skipRepeat(true, false, searchKey({ keyword: ["a"] }, 0, null, { sort: "best", tab: "companies" }), a)).toBe(true);
  });
});

describe("hiddenNow", () => {
  it("adds companies hidden after the search ran, without repeats", () => {
    expect(hiddenNow(["a", "b"], ["b", "c"])).toEqual(["a", "b", "c"]);
    expect(hiddenNow(undefined, ["c"])).toEqual(["c"]);
  });
});

describe("isLate", () => {
  it("drops an answer when the run or the selection key moved on", () => {
    expect(isLate({ run: 1, key: "k" }, { run: 1, key: "k" })).toBe(false);
    expect(isLate({ run: 1, key: "k" }, { run: 2, key: "k" })).toBe(true);
    expect(isLate({ run: 1, key: "k" }, { run: 1, key: "j" })).toBe(true);
  });
});

describe("detailMissing", () => {
  it("counts a full card with nothing held, but not one the register holds a detail for", () => {
    expect(detailMissing({ website: "", phone: "1", email: "e" })).toBe(true);
    expect(detailMissing({ website: "", phone: "1", email: "e", closed: { website: true } })).toBe(false);
  });
  it("does not count a slim card from Select all", () => {
    expect(detailMissing({ website: "", phone: "", email: "", slim: true })).toBe(false);
  });
});
