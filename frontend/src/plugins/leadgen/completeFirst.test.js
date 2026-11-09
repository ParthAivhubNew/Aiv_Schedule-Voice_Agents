import { describe, expect, it } from "vitest";
import { completeFirst } from "./AccountsViews";

const co = (name, pct, extra = {}) => ({ id: name, name, completeness: { pct }, ...extra });

describe("completeFirst", () => {
  it("puts the most complete companies first and keeps the order of equals", () => {
    const out = completeFirst([co("a", 57), co("b", 86), co("c", 57), co("d", 100)]);
    expect(out.map((x) => x.name)).toEqual(["d", "b", "a", "c"]);
  });
  it("breaks a tie with an email, then a phone", () => {
    const out = completeFirst([co("plain", 71), co("phone", 71, { phone: "0113 496 0000" }), co("mail", 71, { email: "a@b.co.uk" })]);
    expect(out.map((x) => x.name)).toEqual(["mail", "phone", "plain"]);
  });
  it("does not change the list it was given", () => {
    const rows = [co("a", 10), co("b", 90)];
    completeFirst(rows);
    expect(rows.map((x) => x.name)).toEqual(["a", "b"]);
  });
});
