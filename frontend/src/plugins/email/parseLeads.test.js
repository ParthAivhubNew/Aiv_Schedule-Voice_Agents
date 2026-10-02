import { describe, expect, it } from "vitest";
import { parseLeads } from "./OutreachViews";

describe("parseLeads", () => {
  it("reads email, first, last, company per line", () => {
    expect(parseLeads("ann@client.com, Ann, Lee, Client Ltd\n\nbo@corp.io\tBo")).toEqual([
      { email: "ann@client.com", first_name: "Ann", last_name: "Lee", company: "Client Ltd" },
      { email: "bo@corp.io", first_name: "Bo" },
    ]);
  });

  it("follows a CSV header in any order and drops rows without an email", () => {
    const csv = 'Company,First Name,Email\n"Client Ltd",Ann,ann@client.com\nNo Email Co,Cy,';
    expect(parseLeads(csv)).toEqual([{ company: "Client Ltd", first_name: "Ann", email: "ann@client.com" }]);
  });
});
