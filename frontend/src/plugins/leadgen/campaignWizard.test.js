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
