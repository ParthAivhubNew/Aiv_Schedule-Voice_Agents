import { describe, expect, it } from "vitest";
import { GENERAL_INBOXES, ROLE_INBOXES, inboxKind } from "./inboxes";

describe("which mailboxes are a person", () => {
  it("tells a person from a sales inbox from a department", () => {
    expect(inboxKind("john.roberts@ao.com")).toBe("person");
    expect(inboxKind("sales@ao.com")).toBe("general");
    expect(inboxKind("info-leeds@ao.com")).toBe("general");
    expect(inboxKind("ir@ao.com")).toBe("role");
    expect(inboxKind("no-reply@ao.com")).toBe("role");
    expect(inboxKind("customer.service@ao.com")).toBe("role");
  });

  it("still treats every word the Contact column used to skip as not a person", () => {
    const before = ["info", "sales", "admin", "contact", "hello", "office", "enquiries", "enquiry", "support", "accounts", "mail", "team", "hr", "jobs", "careers", "marketing", "service", "bookings", "orders", "reception", "help", "general"];
    for (const w of before) expect(GENERAL_INBOXES.has(w) || ROLE_INBOXES.has(w)).toBe(true);
  });
});
