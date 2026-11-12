import { describe, expect, it } from "vitest";
import { toCsv } from "./downloadCsv";

describe("toCsv", () => {
  it("quotes commas, quotes and new lines", () => {
    expect(toCsv([["a", 'b "c"', "d,e", "f\ng"]])).toBe('a,"b ""c""","d,e","f\ng"');
  });
  it("keeps a formula-looking cell as text", () => {
    expect(toCsv([["=SUM(A1)", "+44 20 7946 0000"]])).toBe("'=SUM(A1),'+44 20 7946 0000");
  });
  it("writes blanks for missing values", () => {
    expect(toCsv([[null, undefined, 0]])).toBe(",,0");
  });
});
