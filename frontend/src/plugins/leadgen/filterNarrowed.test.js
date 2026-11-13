import { describe, expect, it } from "vitest";
import { filterNarrowed } from "./filterNarrowed";

describe("filterNarrowed", () => {
  it("is true when a filter or one item of a list is taken away", () => {
    expect(filterNarrowed({ keyword: ["cafe"], towns: ["leeds"] }, { keyword: ["cafe"] })).toBe(true);
    expect(filterNarrowed({ keyword: ["cafe", "pub"] }, { keyword: ["cafe"] })).toBe(true);
    expect(filterNarrowed({ keyword: ["cafe"] }, {})).toBe(true);
  });
  it("is false when nothing changed, or something was added or edited", () => {
    expect(filterNarrowed({ keyword: ["cafe"] }, { keyword: ["cafe"] })).toBe(false);
    expect(filterNarrowed({}, { keyword: ["cafe"] })).toBe(false);
    expect(filterNarrowed({ keyword: ["cafe"] }, { keyword: ["cafes"] })).toBe(false);
    expect(filterNarrowed({ keyword: ["cafe"], towns: ["leeds"] }, { keyword: ["cafe"], towns: ["hull"] })).toBe(false);
    expect(filterNarrowed({ name_contains: "ab" }, { name_contains: "abc" })).toBe(false);
  });
});
