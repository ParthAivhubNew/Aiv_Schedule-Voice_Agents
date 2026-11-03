import { describe, expect, it } from "vitest";
import { searchKey, skipRepeat } from "./searchGuard";

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
