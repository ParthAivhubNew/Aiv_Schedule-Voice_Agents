import { describe, expect, it } from "vitest";
import { contactRows, filingRows, niceName, orderSignals, peopleCount, personMeta, personName, shortDate, subLine } from "./companyLogic";

describe("how a company is named and described", () => {
  it("makes an all-capitals register name readable and leaves mixed case alone", () => {
    expect(niceName("BRIGHT CAFE LIMITED")).toBe("Bright Cafe Limited");
    expect(niceName("TESCO PLC")).toBe("Tesco PLC");
    expect(niceName("Joe's Kitchen")).toBe("Joe's Kitchen");
    expect(niceName("")).toBe("");
  });

  it("gives one line with only what is known", () => {
    expect(subLine({ type: "Private Limited Company", region: "LEEDS", age: "6 years old", size: "Small" })).toBe("Private Limited Company · Leeds · 6 years old · Small company");
    expect(subLine({ type: "", region: "", incorporated: "1 Mar 2020", size: "" })).toBe("since 2020");
    expect(subLine({})).toBe("");
  });
});

describe("contact details", () => {
  it("links each one and says where it came from", () => {
    const rows = contactRows({ website: { value: "https://www.bright.co.uk/", source: "register", label: "On the register" }, phone: { value: "0113 496 0123", source: "web", label: "Found on the web" }, email: { value: "", source: "missing", label: "Not known yet" } });
    expect(rows.map((r) => r.kind)).toEqual(["website", "phone", "email"]);
    expect(rows[0]).toMatchObject({ shown: "bright.co.uk", href: "https://www.bright.co.uk/", sourceWord: "Register", canFind: false });
    expect(rows[1]).toMatchObject({ href: "tel:01134960123", sourceWord: "Web" });
    expect(rows[2]).toMatchObject({ href: "", sourceWord: "Not known", canFind: true });
  });

  it("offers to find a missing website or phone", () => {
    const rows = contactRows({});
    expect(rows[0].canFind).toBe(true);
    expect(rows[1].canFind).toBe(true);
  });
});

describe("why now, people and filings", () => {
  it("shows opportunities first, then cautions", () => {
    expect(orderSignals([{ tone: "caution", key: "a" }, { tone: "info", key: "b" }, { tone: "opportunity", key: "c" }]).map((s) => s.key)).toEqual(["c", "a", "b"]);
  });

  it("writes a person's second line from the register only", () => {
    expect(personMeta({ years_in_role: 0, nationality: "British", occupation: "Director", country_of_residence: "England", born_year: "1975" })).toBe("joined this year · British · Director · lives in England · born 1975");
    expect(personMeta({ years_in_role: 1 })).toBe("1 year in the role");
    expect(personMeta({})).toBe("");
  });

  it("lists only the filings that are stored and marks overdue accounts", () => {
    const rows = filingRows({ accounts: { category: "Small company accounts", last_made: "30 Sep 2025", next_due: "30 Jun 2026", overdue: true }, confirmation: { last: "", next_due: "5 Jan 2027" }, charges: { outstanding: 1, satisfied: 2, total: 3 } });
    expect(rows.map((r) => r.label)).toEqual(["Accounts filed as", "Last accounts", "Next accounts due", "Next confirmation statement", "Charges"]);
    expect(rows[2]).toMatchObject({ warn: true, note: "overdue" });
    expect(filingRows({ accounts: {}, charges: { total: 0 } })).toEqual([]);
  });

  it("counts the people on the register", () => {
    expect(peopleCount({ officers: [{ first_name: "Ann", last_name: "Lee" }, { first_name: "Bo", last_name: "Hu" }], controllers: [{ name: "Ms Cy Dee" }] })).toBe(3);
    expect(peopleCount({ officers: [{ first_name: "Martin", last_name: "Zawadzki" }], controllers: [{ name: "Mr Martin Richard Zawadzki" }] })).toBe(1);
    expect(peopleCount(undefined)).toBe(0);
  });
});

describe("names and dates from the register", () => {
  it("turns SURNAME, Forename into Forename Surname", () => {
    expect(personName("OLD, Sam")).toBe("Sam Old");
    expect(personName("MURPHY, Ken Patrick")).toBe("Ken Patrick Murphy");
    expect(personName("Jo Bloggs")).toBe("Jo Bloggs");
  });

  it("shows a date the way people say it", () => {
    expect(shortDate("2026-08-31")).toBe("31 Aug 2026");
    expect(shortDate("not a date")).toBe("not a date");
  });
});
