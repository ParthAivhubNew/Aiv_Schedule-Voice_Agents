import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../api/apiClient", () => ({ api: { tpsEstimate: vi.fn(), tpsRun: vi.fn() } }));

import { allNumbers, hasAnyTpsCheck, numberCounts, numbersToCheck, screeningOfNumber } from "./phoneNumbers";
import { hasTpsCheck, TPS_NOTE } from "./listFilters";
import { personTps } from "./peopleFilters";
import { peopleOf } from "./SavedPeople";
import { previewLine } from "./tpsCheck";
import { TpsEstimateView } from "./TpsCheckDialog";
import { TpsPill } from "./ListFilterBar";
import { PhoneNumbers } from "./NumbersPanel";

const clear = { status: "clear", ctps: false, checked_at: "2026-11-20T09:30:00Z" };
const listed = { status: "listed", ctps: false, checked_at: "2026-11-21T09:30:00Z" };

const acme = {
  id: "a1", name: "Acme Ltd", phone: "0113 550 0412", phone_screening: null, contact_name: "Sam Roe",
  research: {
    phones: ["020 7123 4567", "+44 113 550 0412", "07700 900111"], phones_screening: [listed, null, null],
    team: [{ name: "Tom Fox", phone: "0161 000 0000", phone_screening: clear }, { name: "Ann Lee", phone: "07700 900111", phone_screening: null }],
    other_offices: [{ town: "Leeds", phone: "0113 999 0000", phone_screening: null }],
  },
};

describe("every number on a company", () => {
  it("lists the company number, research numbers, people and offices once each", () => {
    const keys = allNumbers(acme).map((n) => n.key);
    expect(keys).toEqual(["441135500412", "442071234567", "447700900111", "441610000000", "441139990000"]);
    expect(allNumbers({}).length).toBe(0);
  });

  it("keeps each number's own result and finds it from any spelling", () => {
    expect(screeningOfNumber(acme, "+44 20 7123 4567")).toEqual(listed);
    expect(screeningOfNumber(acme, "0161 000 0000")).toEqual(clear);
    expect(screeningOfNumber(acme, "0113 550 0412")).toBeNull();
    expect(screeningOfNumber(acme, "")).toBeNull();
  });

  it("counts a company as checked when any number has a result", () => {
    expect(hasAnyTpsCheck(acme)).toBe(true);
    expect(hasTpsCheck(acme)).toBe(true);
    expect(hasTpsCheck({ phone: "0113 550 0412", research: { phones: ["07700 900111"] } })).toBe(false);
  });

  it("gathers distinct numbers across companies for one check and counts what is checked", () => {
    const other = { id: "a2", phone: "020 7123 4567", research: {} };
    expect(numbersToCheck([acme, other])).toHaveLength(5);
    expect(numberCounts([acme, other])).toEqual({ total: 5, checked: 2, unchecked: 3 });
  });
});

describe("saved people use their own number", () => {
  it("a found person carries their result, and a saved person gets the result of their own number", () => {
    const people = peopleOf([acme]);
    const tom = people.find((p) => p.name === "Tom Fox");
    const sam = people.find((p) => p.name === "Sam Roe");
    expect(personTps(tom)).toEqual(clear);
    expect(sam.phone).toBe("0113 550 0412");
    expect(personTps(sam)).toBeNull();
    const withOwn = { ...acme, phone: "", research: { ...acme.research, phones: ["020 7123 4567"], phones_screening: [listed] } };
    expect(personTps(peopleOf([withOwn]).find((p) => p.name === "Sam Roe"))).toEqual(listed);
  });
});

describe("wording", () => {
  it("says how many to check, how many are already checked and the cost, before anything is spent", () => {
    const est = { ready: true, to_check: 3, credits: 2, balance: 10, enforced: true, rows: [{ status: "not_uk" }] };
    expect(previewLine(est, 10)).toBe("3 numbers to check, 6 already checked, cost 2 credits. 1 is not UK number and is left out.");
    expect(renderToStaticMarkup(<TpsEstimateView est={est} total={10} />)).toContain("3 numbers to check, 6 already checked, cost 2 credits.");
    expect(previewLine({ to_check: 1, credits: 1, rows: [] }, 1)).toBe("1 number to check, 0 already checked, cost 1 credit.");
  });

  it("says the filter looks at any number on the record", () => {
    expect(TPS_NOTE).toContain("any number on the record");
    expect(renderToStaticMarkup(<TpsPill count={2} on={false} onClick={() => {}} />)).toContain("any number on the record");
  });

  it("shows a chip beside each number and a check-all button", () => {
    const out = renderToStaticMarkup(<PhoneNumbers account={acme} />);
    expect(out).toContain("On TPS");
    expect(out).toContain("TPS clear");
    expect(out).toContain("Check all numbers");
    expect(out).toContain("2 of 5 numbers checked");
  });
});
