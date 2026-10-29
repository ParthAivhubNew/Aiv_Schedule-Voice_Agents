import { describe, expect, it } from "vitest";
import { peopleOf } from "./plugins/leadgen/SavedPeople";

describe("peopleOf", () => {
  const acme = { id: "a1", name: "Acme", contact_name: "Sam Lee", contact_title: "Owner", email: "sam@acme.test", phone: "0113 000", research: { team: [{ name: "Sam Lee", title: "Director" }, { name: "Priya Shah", title: "Buyer", email: "priya@acme.test" }] } };

  it("lists the saved contact and the team a check found, once each", () => {
    const rows = peopleOf([acme]);
    expect(rows.map((r) => r.name)).toEqual(["Sam Lee", "Priya Shah"]);
    expect(rows[0]).toMatchObject({ title: "Owner", email: "sam@acme.test", found: false });
    expect(rows[1]).toMatchObject({ title: "Buyer", email: "priya@acme.test", found: true });
  });

  it("skips a company with nobody named and never invents a person", () => {
    expect(peopleOf([{ id: "a2", name: "Quiet Ltd", email: "info@quiet.test" }])).toEqual([]);
  });
});
