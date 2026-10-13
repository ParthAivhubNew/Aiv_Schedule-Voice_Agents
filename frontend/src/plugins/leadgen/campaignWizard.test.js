import { describe, expect, it } from "vitest";
import { leadsFromList } from "./CampaignWizard";

describe("leadsFromList", () => {
  it("makes one lead per company with an email and skips the rest", () => {
    const leads = leadsFromList([
      { name: "Kirkgate Dental", email: "ann.lee@kirkgate.example", contact_name: "Ann Lee" },
      { name: "Headrow Lettings" },
    ]);
    expect(leads).toEqual([{ email: "ann.lee@kirkgate.example", first_name: "Ann", last_name: "Lee", company: "Kirkgate Dental" }]);
  });
});

import { fill } from "./CampaignWizard";
import { unknownFields } from "./EmailWriter";

describe("what a person will actually receive", () => {
  const lead = { first_name: "Sam", last_name: "Lee", company: "Kirkgate Dental" };
  it("fills the merge fields and leaves no gap when there is no opening line", () => {
    const body = "Hi {{first_name}},\n\n{{personal_line}}\n\nWe help {{company}}.";
    expect(fill(body, lead, "Running a practice in Leeds keeps you busy.")).toBe("Hi Sam,\n\nRunning a practice in Leeds keeps you busy.\n\nWe help Kirkgate Dental.");
    expect(fill(body, lead, "")).toBe("Hi Sam,\n\nWe help Kirkgate Dental.");
  });
  it("flags a merge field that could never be filled in", () => {
    expect(unknownFields("Hi {{first_name}}", "Offer: {{discount}} and {{ Frist_Name }}")).toEqual(["{{discount}}", "{{ Frist_Name }}"]);
    expect(unknownFields("Hi {{firstName}} at {{company}}", "{{personal_line}}")).toEqual([]);
  });
});
