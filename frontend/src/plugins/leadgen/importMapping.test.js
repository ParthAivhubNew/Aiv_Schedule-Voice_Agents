import { describe, expect, it } from "vitest";
import { applyMapping, CUSTOM, customName, guessMapping, mappingWarnings, MAX_CUSTOM } from "./importMapping";

const headers = ["Business Name", "URN", "UK 03 Sic Desc.", "Telephone No."];
const records = [{ "Business Name": "Acme", URN: "69716", "UK 03 Sic Desc.": "Washing of textiles", "Telephone No.": "0113 496 0412" }];

describe("keeping a file's own column", () => {
  it("saves the values under the name the user gave, next to the standard fields", () => {
    const map = { ...guessMapping(headers), URN: `${CUSTOM}Reference`, "UK 03 Sic Desc.": `${CUSTOM}  UK 03 Sic Desc.  ` };
    const [row] = applyMapping(headers, records, map);
    expect(row.name).toBe("Acme");
    expect(row.phone).toBe("0113 496 0412");
    expect(row.custom).toEqual({ Reference: "69716", "UK 03 Sic Desc.": "Washing of textiles" });
  });

  it("leaves a column out when it was kept but never named", () => {
    const [row] = applyMapping(headers, records, { ...guessMapping(headers), URN: CUSTOM });
    expect(row.custom).toBeUndefined();
    expect(mappingWarnings({ ...guessMapping(headers), URN: CUSTOM }, records).some((w) => /needs a name/.test(w))).toBe(true);
  });

  it("uses the first of two columns given the same name, and says so", () => {
    const map = { ...guessMapping(headers), URN: `${CUSTOM}Ref`, "UK 03 Sic Desc.": `${CUSTOM}Ref` };
    expect(applyMapping(headers, records, map)[0].custom).toEqual({ Ref: "69716" });
    expect(mappingWarnings(map, records).some((w) => /only the first is used/.test(w))).toBe(true);
  });

  it("warns when the name is one of our own fields, and keeps at most the allowed number", () => {
    expect(mappingWarnings({ URN: `${CUSTOM}Phone`, "Business Name": "name" }, records).some((w) => /already one of our fields/.test(w))).toBe(true);
    const many = Array.from({ length: MAX_CUSTOM + 5 }, (_, i) => `c${i}`);
    const rec = [Object.fromEntries(many.map((h) => [h, "v"]))];
    const map = Object.fromEntries(many.map((h) => [h, `${CUSTOM}${h}`]));
    expect(Object.keys(applyMapping(many, rec, map)[0].custom)).toHaveLength(MAX_CUSTOM);
    expect(customName(`${CUSTOM}${"z".repeat(80)}`)).toHaveLength(40);
  });
});
