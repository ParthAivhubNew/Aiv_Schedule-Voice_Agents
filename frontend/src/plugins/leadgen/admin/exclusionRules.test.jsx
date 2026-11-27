import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../api/apiClient", () => ({ api: new Proxy({}, { get: () => () => new Promise(() => {}) }) }));

import { ADMIN_TABS, AdministrationBody } from "./AdministrationView";
import { ExclusionRulesBody } from "./ExclusionRules";
import {
  EMPTY_LINE, EVERYONE_LINE, NOTHING_TYPED, QUICK_ADDS, addChanges, byLine, effectLine, groupRules, historyLine, removeChanges, ruleName, splitItems, summaryLine, switchChanges,
} from "./exclusionLogic";

const html = (el) => renderToStaticMarkup(el);
const rule = (o) => ({ id: "x1", kind: "sic", kindLabel: "Industry (SIC code)", value: "85200", mode: "exclude", enabled: true, label: "", meaning: "Leaves out companies with SIC code 85200", createdBy: "boss@fsb.example", createdAt: "2026-12-02T10:00:00Z", updatedAt: "2026-12-02T10:00:00Z", ...o });
const data = { max: 500, enabled: 3, rules: [
  rule({ id: "r1" }),
  rule({ id: "r2", kind: "name_word", kindLabel: "Word in the name", value: "church", meaning: 'Leaves out names with the word "church"', createdBy: "system", enabled: false }),
  rule({ id: "r3", kind: "charity_register", kindLabel: "Register check", value: "", meaning: "Leaves out everything on the Charity Commission register" }),
  rule({ id: "r4", kind: "name_word", kindLabel: "Word in the name", value: "driving school", mode: "keep", meaning: 'Keeps names with "driving school", even when a word above matches' }),
] };

describe("reading what an admin typed", () => {
  it("splits on commas, semicolons and new lines and keeps phrases whole", () => {
    expect(splitItems("85200, church\ndriving school; Charity register ,, ")).toEqual(["85200", "church", "driving school", "Charity register"]);
    expect(splitItems("")).toEqual([]);
  });
  it("groups rules in a fixed order with keep rules last", () => {
    const g = groupRules(data.rules);
    expect(g.map((x) => x.title)).toEqual(["Register check", "Industry (SIC code)", "Word in the name", "Always keep"]);
    expect(g[2].rules.map((r) => r.value)).toEqual(["church"]);
    expect(groupRules([])).toEqual([]);
  });
  it("names a rule for its buttons", () => {
    expect(ruleName(rule({}))).toBe("SIC 85200");
    expect(ruleName(rule({ kind: "charity_register", value: "" }))).toBe("Charity register");
    expect(ruleName(rule({ kind: "status_only", value: "" }))).toBe("Active companies only");
    expect(ruleName(rule({ kind: "ch_number_only", value: "" }))).toBe("Companies House companies only");
    expect(ruleName(rule({ kind: "name_word", value: "church" }))).toBe("church");
  });
  it("counts what is on", () => {
    expect(summaryLine(data)).toBe("3 rules on, 1 switched off");
    expect(summaryLine({ rules: [] })).toBe("No rules yet");
  });
});

describe("the plain lines the confirm shows", () => {
  const p = { all: 1000, before: 800, after: 700 };
  it("says how many more companies a change leaves out", () => {
    expect(effectLine(p)).toBe("Leaves out about 100 more companies: 300 of 1,000 (30%) would be left out in total.");
    expect(effectLine({ all: 1000, before: 700, after: 800 })).toContain("Brings back about 100 companies");
    expect(effectLine({ all: 1000, before: 800, after: 800 })).toBe("This does not change how many companies are left out.");
  });
  it("says nothing when counting took too long", () => {
    expect(effectLine({ all: null, before: 1, after: 1 })).toBe("");
    expect(effectLine(null)).toBe("");
  });
  it("asks one short question: what changes and who it reaches, with no counting", () => {
    expect(addChanges(["85200", "church"])).toEqual(["Add: 85200", "Add: church", EVERYONE_LINE]);
    const many = addChanges(Array.from({ length: 9 }, (_, i) => `w${i}`));
    expect(many).toHaveLength(8);
    expect(many[6]).toBe("and 3 more items");
    expect(switchChanges(rule({}), false)).toEqual(["Switch off: SIC 85200", EVERYONE_LINE]);
    expect(switchChanges(rule({}), true)[0]).toBe("Switch on: SIC 85200");
    expect(removeChanges(rule({}))).toEqual(["Delete: SIC 85200. This cannot be undone", EVERYONE_LINE]);
  });
  it("says who added a rule and when", () => {
    expect(byLine(rule({}))).toBe("Added by boss@fsb.example · 02-12-2026");
    expect(byLine(rule({ createdBy: "system" }))).toBe("Starting list · 02-12-2026");
    expect(byLine(rule({ createdBy: "", createdAt: null }))).toBe("");
  });
  it("turns an audit row into a sentence", () => {
    const at = "2026-12-03T09:00:00Z";
    expect(historyLine({ action: "org_exclusion.added", actor_name: "boss@fsb.example", detail: { added: 3, items: "sic:85200" }, at }))
      .toBe("boss@fsb.example added 3 rules (sic:85200) on 03-12-2026");
    expect(historyLine({ action: "org_exclusion.removed", actor_name: "", target: "sic:85200", detail: {}, at })).toBe("Someone removed sic:85200 on 03-12-2026");
    expect(historyLine({ action: "exclusions.moved_to_rules", actor_name: "system", detail: {}, at })).toBe("system moved the starting list into rules on 03-12-2026");
  });
});

describe("the screen", () => {
  it("is a tab of Administration, for admins only", () => {
    expect(ADMIN_TABS.map((t) => t.id)).toContain("exclusions");
    expect(html(<AdministrationBody operator={{ is_admin: false }} tab="exclusions" onTab={() => {}}><span>x</span></AdministrationBody>)).not.toContain("Exclusions");
    expect(html(<AdministrationBody operator={{ is_admin: true }} tab="exclusions" onTab={() => {}}><span>x</span></AdministrationBody>)).toContain("Exclusions");
  });
  it("shows the result of a check", () => {
    expect(html(<ExclusionRulesBody data={data} effect="Leaves out about 100 more companies." />)).toContain("Leaves out about 100 more companies.");
  });
  it("shows the rules grouped, with a switch and a delete on each, and who added it", () => {
    const h = html(<ExclusionRulesBody data={data} />);
    for (const title of ["Register check", "Industry (SIC code)", "Always keep"]) expect(h).toContain(title);
    expect(h).toContain("Switch off SIC 85200");
    expect(h).toContain("Switch on church");
    expect(h).toContain("Delete Charity register");
    expect(h).toContain("Added by boss@fsb.example");
    expect(h).toContain("Starting list");
    expect(h).toContain("Switched off");
    expect(h).toContain("4 of 500 rules used");
    expect(h).toContain("3 rules on, 1 switched off");
  });
  it("offers the box, the three common rules and no download of any list", () => {
    const h = html(<ExclusionRulesBody data={data} />);
    expect(h).toContain('aria-label="Common rules"');
    expect(QUICK_ADDS.map((q) => q.label)).toEqual(["Active companies only"]);
    expect(h).toContain("Check effect");
    expect(h).not.toContain('class="exc-quick" disabled="">Companies House');
    expect(h).not.toContain('class="exc-quick" disabled="">Charity register');
    expect(h).toContain("Leave out");
    expect(h).not.toMatch(/download|export/i);
  });
  it("says so when the list is empty", () => {
    expect(html(<ExclusionRulesBody data={{ rules: [], max: 500, enabled: 0 }} />)).toContain(EMPTY_LINE);
  });
  it("shows an error and the loading state", () => {
    expect(html(<ExclusionRulesBody data={null} error="Couldn't load the exclusion list. Try again." />)).toContain('role="alert"');
    expect(html(<ExclusionRulesBody data={null} loading />)).toContain("Loading the exclusion list");
  });
  it("shows a problem to the screen reader and disables the buttons while busy", () => {
    const h = html(<ExclusionRulesBody data={data} problem={NOTHING_TYPED} busy draft="church" />);
    expect(h).toContain(NOTHING_TYPED);
    expect(h).toContain("disabled");
  });
  it("lists recent changes when opened", () => {
    const h = html(<ExclusionRulesBody data={data} historyOpen history={[{ id: "a1", action: "org_exclusion.removed", actor_name: "boss", target: "sic:85200", detail: {}, at: "2026-12-03T09:00:00Z" }]} />);
    expect(h).toContain("boss removed sic:85200 on 03-12-2026");
  });
});

describe("wiring", () => {
  const src = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
  it("uses the real exclusion routes and asks once before every change", () => {
    const api = readFileSync(new URL("../../../api/apiClient.js", import.meta.url), "utf8");
    for (const route of ["/org/exclusions'", "/org/exclusions/preview", "/org/exclusions/history"]) expect(api).toContain(route);
    const s = src("./ExclusionRules.jsx");
    for (const call of ["askConfirm", "api.previewExclusions", "api.addExclusions", "api.changeExclusion", "api.removeExclusion"]) expect(s).toContain(call);
    expect(s).not.toContain("confirmTwice"); // one short question, and no register count before it
  });
  it("leaves no hard-coded FSB filter in the Find Leads screen or the staff brand editor", () => {
    expect(readFileSync(new URL("../FindLeadsView.jsx", import.meta.url), "utf8")).not.toContain("fsb_exclusions");
    const brands = readFileSync(new URL("../../../adminPortal/Brands.jsx", import.meta.url), "utf8");
    expect(brands).not.toContain("FSB exclusion rules");
    expect(brands).not.toContain("Extra exclusions");
  });
});
