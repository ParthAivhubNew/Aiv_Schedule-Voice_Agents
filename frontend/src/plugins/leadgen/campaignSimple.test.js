import { describe, expect, it } from "vitest";
import { fromFriendly, toFriendly } from "./CampaignSimple";
import { unknownFields } from "./EmailWriter";

describe("the words people see in a campaign email", () => {
  it("shows the merge fields as plain words in brackets", () => {
    expect(toFriendly("Hi {{first_name}} at {{company}}, {{ last_name }}. {{personal_line}}")).toBe("Hi [First name] at [Company], [Last name]. [Opening line]");
  });

  it("understands the short spellings the AI and old campaigns use", () => {
    expect(toFriendly("{{firstname}} {{lastname}} {{personalline}}")).toBe("[First name] [Last name] [Opening line]");
  });

  it("turns the plain words back into what the server needs", () => {
    expect(fromFriendly("Hi [First name] at [Company] [last name] [ Opening line ]")).toBe("Hi {{first_name}} at {{company}} {{last_name}} {{personal_line}}");
  });

  it("round-trips an email without changing it", () => {
    const body = "Hi {{first_name}},\n\nWe help {{company}}.\n\n{{personal_line}}\n\nThanks";
    expect(fromFriendly(toFriendly(body))).toBe(body);
  });

  it("leaves a word the app cannot fill in so it is still caught", () => {
    expect(toFriendly("Hi {{frist_name}}")).toBe("Hi {{frist_name}}");
    expect(unknownFields(fromFriendly(toFriendly("Hi {{frist_name}}")))).toEqual(["{{frist_name}}"]);
  });

  it("does not touch ordinary brackets", () => {
    expect(fromFriendly("Prices [2024] and [see below]")).toBe("Prices [2024] and [see below]");
  });
});
