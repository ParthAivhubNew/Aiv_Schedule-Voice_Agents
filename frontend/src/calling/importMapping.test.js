import { describe, expect, it } from "vitest";
import { applyMapping, guessMapping, KEEP, mappingWarnings, SKIP } from "./importMapping";

const headers = ["Business Name", "Tel No.", "E-mail Address", "Forename", "Surname", "Job Title", "Favourite colour"];
const records = [
  { "Business Name": "Acme Ltd", "Tel No.": "020 7946 0000", "E-mail Address": "a@acme.co.uk", Forename: "Ann", Surname: "Lee", "Job Title": "CEO", "Favourite colour": "Blue" },
  { "Business Name": "Beta", "Tel No.": "", "E-mail Address": "", Forename: "Bob", Surname: "Ray", "Job Title": "", "Favourite colour": "Red" },
];

describe("contact file column matching", () => {
  it("guesses the standard columns and keeps unknown ones as extra columns", () => {
    const m = guessMapping(headers);
    expect(m["Business Name"]).toBe("company");
    expect(m["Tel No."]).toBe("phone");
    expect(m["E-mail Address"]).toBe("email");
    expect(m.Forename).toBe("first_name");
    expect(m.Surname).toBe("last_name");
    expect(m["Job Title"]).toBe("job_title");
    expect(m["Favourite colour"]).toBe(KEEP);
  });

  it("renames matched columns, keeps extras, drops skipped", () => {
    const m = { ...guessMapping(headers), "Job Title": SKIP };
    const out = applyMapping(headers, records, m);
    expect(out.headers).toEqual(["Company name", "Phone", "Email", "Contact name", "Favourite colour"]);
    expect(out.records[0]).toEqual({ "Company name": "Acme Ltd", Phone: "020 7946 0000", Email: "a@acme.co.uk", "Contact name": "Ann Lee", "Favourite colour": "Blue" });
  });

  it("warns about missing phones", () => {
    const w = mappingWarnings(guessMapping(headers), records);
    expect(w.some((x) => x.includes("1 of 2 rows have no phone"))).toBe(true);
    const noPhone = mappingWarnings({ "Business Name": "company" }, records);
    expect(noPhone[0]).toMatch(/No column is matched to Phone/);
  });
});
