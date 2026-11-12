import { describe, expect, it } from "vitest";
import { applyPulled, linkRowsFor, pullIds } from "./getContacts";

const row = (o) => ({ id: "r1", company: "Acme Ltd", contact: "", phone: "", email: "", website: "", ...o });

describe("get contacts on a call list", () => {
  it("sends each row with its key and what it holds", () => {
    expect(linkRowsFor([row({ town: "Leeds", postcode: "LS1 1AA", contact: "Sam" })], () => "0113 496 0000")[0])
      .toMatchObject({ key: "r1", name: "Acme Ltd", phone: "0113 496 0000", contact_name: "Sam", region: "Leeds LS1 1AA" });
  });
  it("lists each linked company once", () => {
    expect(pullIds([row({ leadId: "a" }), row({ id: "r2", leadId: "a" }), row({ id: "r3" })])).toEqual(["a"]);
  });
  it("fills blanks and never replaces what the person had", () => {
    const [out] = applyPulled([row({ leadId: "a", phone: "0113 000", email: "" })], { a: { phone: "0999", email: "hi@acme.co.uk", website: "acme.co.uk", contact_name: "Sam Lee", verdict: "verified", group: "ready" } });
    expect(out).toMatchObject({ phone: "0113 000", email: "hi@acme.co.uk", website: "acme.co.uk", contact: "Sam Lee", lead: { verdict: "verified", group: "ready" } });
  });
  it("leaves rows without a Leads company alone", () => {
    const r = row();
    expect(applyPulled([r], { a: { verdict: "verified" } })[0]).toBe(r);
  });
});
