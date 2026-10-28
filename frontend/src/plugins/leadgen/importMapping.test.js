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

describe("default matches", () => {
  it("keeps every column that is not one of our fields, under its own name", () => {
    const map = guessMapping(["Business Name", "URN", "Postcode District", "UK 03 Sic Desc."]);
    expect(map["Business Name"]).toBe("name");
    expect(map.URN).toBe(`${CUSTOM}URN`);
    expect(map["Postcode District"]).toBe(`${CUSTOM}Postcode District`);
    expect(map["UK 03 Sic Desc."]).toBe("industry");
  });

  it("never gives a kept column the name of one of our fields, or the same name twice, or leaves it unnamed", () => {
    const map = guessMapping(["Notes", "Comment", "id", "ID", ""]);
    expect(map.Notes).toBe("notes");
    expect(map.Comment).toBe(`${CUSTOM}Comment`);
    expect(map.id).toBe(`${CUSTOM}id`);
    expect(map.ID).toBe("__skip__");
    expect(map[""]).toBe("__skip__");
  });
});

describe("a real client file", () => {
  const cols = ["Company", "Phone", "Email", "Contact", "Complete Check", "Found by", "URN", "Address Line 1", "Address Line 2", "Locality", "Town", "Postcode", "Postcode District",
    "Contact title", "Contact forename", "Contact surname", "UK 03 Sic Desc.", "Easy Sector Code", "Easy Sector Desc.", "Employees", "Tps", "Ctps"];
  const rec = { Company: "Hawes Construction Ltd", Phone: "7702167658", "Address Line 1": "138-144 London Road", Locality: "Wheatley", Town: "Oxford", Postcode: "OX33 1JH",
    "Contact title": "Mr", "Contact forename": "Matthew", "Contact surname": "Hawes", "UK 03 Sic Desc.": "Construction of domestic buildings", "Easy Sector Code": "196", "Easy Sector Desc.": "Builders" };
  const map = guessMapping(cols, [rec]);

  it("puts each column where it belongs", () => {
    expect(map.Company).toBe("name");
    expect(map.Phone).toBe("phone");
    expect(map.Contact).toBe("contact_name");
    expect(map["Contact forename"]).toBe("contact_first");
    expect(map["Contact surname"]).toBe("contact_last");
    expect(map.Town).toBe("region");
    expect(map["UK 03 Sic Desc."]).toBe("industry");
  });

  it("keeps salutations, codes, addresses and postcodes as the user's own columns instead of mis-filing them", () => {
    expect(map["Contact title"]).toBe(`${CUSTOM}Contact title`);
    expect(map["Easy Sector Code"]).toBe(`${CUSTOM}Easy Sector Code`);
    expect(map["Address Line 1"]).toBe(`${CUSTOM}Address Line 1`);
    expect(map.Postcode).toBe(`${CUSTOM}Postcode`);
    expect(map.Locality).toBe(`${CUSTOM}Locality`);
  });

  it("builds the contact from first and last name, and restores a UK number's leading zero", () => {
    const [row] = applyMapping(cols, [rec], map);
    expect(row.contact_name).toBe("Matthew Hawes");
    expect(row.phone).toBe("07702167658");
    expect(row.region).toBe("Oxford");
    expect(row.industry).toBe("Construction of domestic buildings");
    expect(row.contact_first).toBeUndefined();
  });

  it("still treats a real job title as a job title", () => {
    const m = guessMapping(["Name", "Title"], [{ Name: "A", Title: "Managing Director" }]);
    expect(m.Title).toBe("contact_title");
    expect(guessMapping(["Name", "Job Title"])["Job Title"]).toBe("contact_title");
  });
});

describe("people without a company", () => {
  it("are saved under their own name and the mapping says so", async () => {
    const { withPeople, mappingWarnings } = await import("./importMapping");
    const rows = withPeople([{ contact_name: "Mayur Doshi", phone: "0758" }, { name: "Acme", contact_name: "A B" }, { website: "x.co.uk" }]);
    expect(rows[0].name).toBe("Mayur Doshi");
    expect(rows[1].name).toBe("Acme");
    expect(rows[2].name).toBeUndefined();
    const warn = mappingWarnings({ "Contact Name": "contact_name", Mobile: "phone" }, rows);
    expect(warn.some((w) => /saved as a person/.test(w))).toBe(true);
    expect(warn.some((w) => /nothing to save/.test(w))).toBe(false);
  });
});
