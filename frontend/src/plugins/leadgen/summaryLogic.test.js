import { describe, expect, it } from "vitest";
import { nextTarget, summaryRows } from "./summaryLogic";

describe("the Summary tab rows", () => {
  it("prefers the saved email over the register's and carries the checked date", () => {
    const rows = summaryRows({
      profile: { best_contact: { name: "LEE, Ann", role: "director", email: "ann@register.example", source: "register" }, mine: { email: "hello@bright.example", checks: { email: "verified", checked_at: "2026-11-03T10:00:00Z" } } },
      account: null,
    });
    expect(rows.email).toEqual({ value: "hello@bright.example", source: "Your file", checked: "3 Nov 2026" });
  });

  it("says Web or Found by us for a value we filled in", () => {
    const rows = summaryRows({ profile: null, account: { email: "a@b.co.uk", phone: "0113 496 0000", found: { filled: [{ field: "email", how: "web" }, { field: "phone", how: "check" }] }, verification: { phone: { verified: true }, checked_at: "2026-11-04T09:00:00Z" } } });
    expect(rows.email.source).toBe("Web");
    expect(rows.phone).toEqual({ value: "0113 496 0000", source: "Found by us", checked: "4 Nov 2026" });
  });

  it("falls back to the register's director when nobody is saved", () => {
    const rows = summaryRows({ profile: { best_contact: { name: "LEE, Ann", role: "director", email: "", source: "register" }, fit: { score: 72, reasons: ["x"] } }, account: null });
    expect(rows.who).toEqual({ name: "Ann Lee", role: "director", source: "Register" });
    expect(rows.email).toBeNull();
    expect(rows.fit.score).toBe(72);
  });

  it("uses the saved row's next step and points each step at a tab", () => {
    const rows = summaryRows({ profile: { next_action: { key: "find", label: "Find a contact" } }, account: { next_step: { key: "call", label: "Call Ann" } } });
    expect(rows.next.key).toBe("call");
    expect(nextTarget({ key: "find" }).tab).toBe("research");
    expect(nextTarget({ key: "skip" })).toBeNull();
  });
});
