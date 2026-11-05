import { describe, expect, it } from "vitest";
import { tabsFor, TABS } from "./WorkspaceScreen";

describe("tabsFor", () => {
  it("shows every tab when the page asks for none", () => {
    expect(tabsFor("").map((t) => t.id)).toEqual(["leads", "voice", "social"]);
    expect(tabsFor(undefined)).toEqual(TABS);
  });

  it("keeps only the tabs asked for, in the app's own order", () => {
    expect(tabsFor("social, Leads").map((t) => t.id)).toEqual(["leads", "social"]);
  });

  it("drops names it does not know, and cannot be used to add one", () => {
    expect(tabsFor("account,admin").map((t) => t.id)).toEqual(["leads", "voice", "social"]);
    expect(tabsFor("voice,account").map((t) => t.id)).toEqual(["voice"]);
  });
});
