import { describe, expect, it } from "vitest";
import { contactFor, emailFor } from "./AccountsViews";

const researched = {
  contact_name: "", email: "info@jjx.co.uk",
  research: { team: [], people: [], email_contacts: [], emails: ["info@jjx.co.uk", "sales@jjx.co.uk", "ellis.blackham@jjx.co.uk", "ali.karim@jjx.co.uk"] },
};

describe("what a saved company shows for contact and email", () => {
  it("uses what is saved on the company first", () => {
    expect(contactFor({ ...researched, contact_name: "Ann Lee", contact_title: "MD" })).toEqual({ text: "Ann Lee", title: "MD", fromResearch: false });
    expect(emailFor(researched)).toEqual({ text: "info@jjx.co.uk", fromResearch: false });
  });

  it("falls back to a person the research found, with their title", () => {
    const a = { contact_name: "", research: { team: [{ name: "Adam Bull", title: "Director", email: "" }], emails: [] } };
    expect(contactFor(a)).toEqual({ text: "Adam Bull", title: "Director", fromResearch: true });
  });

  it("shows a named mailbox when no person was named, never a role inbox like info@ or sales@", () => {
    expect(contactFor(researched)).toEqual({ text: "ellis.blackham@jjx.co.uk", title: "", fromResearch: true });
    expect(contactFor({ contact_name: "", research: { emails: ["info@jjx.co.uk", "sales@jjx.co.uk"] } })).toBeNull();
  });

  it("takes the email from research when none is saved, and shows nothing when nothing was found", () => {
    expect(emailFor({ email: "", research: { emails: ["hello@x.co.uk"] } })).toEqual({ text: "hello@x.co.uk", fromResearch: true });
    expect(emailFor({ email: "" })).toBeNull();
    expect(contactFor({ contact_name: "" })).toBeNull();
  });
});
