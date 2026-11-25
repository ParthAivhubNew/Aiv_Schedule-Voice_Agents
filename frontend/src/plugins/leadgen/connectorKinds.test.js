import { describe, expect, it } from "vitest";
import { byGroup, countLine, filterConnectors, kindLabels, summary, toneOf } from "./connectorsLogic";

// The Connectors screen only arranges what the server sent (GET /leadgen/connectors): these helpers never decide a status.
const LIST = [
  { id: "ds_companies_house", name: "Companies House (UK)", group: "registers", status: "paused", provides: ["company", "people"], records: 71797, leads: 12 },
  { id: "ds_cqc", name: "CQC care directory", group: "registers", status: "error", provides: ["sole", "phone"], records: 987, leads: 0 },
  { id: "email_finders", name: "E-mail finder (verified)", group: "services", status: "connected", provides: ["email"], uses30d: 40, desc: "Finds a work e-mail" },
  { id: "experian", name: "Experian", group: "data", status: "coming_soon", provides: ["credit"] },
];

describe("connectors", () => {
  it("filters by group, kind of data and words", () => {
    expect(filterConnectors(LIST, { group: "registers" }).map((c) => c.id)).toEqual(["ds_companies_house", "ds_cqc"]);
    expect(filterConnectors(LIST, { kind: "sole" }).map((c) => c.id)).toEqual(["ds_cqc"]);
    expect(filterConnectors(LIST, { query: "work e-mail" }).map((c) => c.id)).toEqual(["email_finders"]);
    expect(filterConnectors(LIST, { kind: "made_up" })).toEqual([]);
  });
  it("groups in the server's order and drops empty groups", () => {
    const groups = [{ id: "registers", label: "Official registers" }, { id: "keys", label: "Provider keys" }, { id: "data", label: "Business data" }];
    expect(byGroup(LIST, groups).map((g) => [g.id, g.items.length])).toEqual([["registers", 2], ["data", 1]]);
  });
  it("says only the counts the server knows", () => {
    expect(countLine(LIST[0])).toBe("71,797 records · 12 of your companies");
    expect(countLine(LIST[1])).toBe("987 records");
    expect(countLine(LIST[2])).toBe("40 look-ups in 30 days");
    expect(countLine(LIST[3])).toBe("");
  });
  it("counts what works, what needs a look and what isn't built", () => {
    expect(summary(LIST)).toEqual({ connected: 1, attention: 2, soon: 1, other: 0 });
    expect([toneOf("connected"), toneOf("paused"), toneOf("error"), toneOf("coming_soon"), toneOf("anything")]).toEqual(["good", "warn", "bad", "soon", "muted"]);
    expect(kindLabels(LIST[0], [{ id: "company", label: "Company details" }])).toEqual(["Company details", "people"]);
  });
});
