import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TPS_NOTE, hasSource, hasTpsCheck, screeningOf, sourceKeysOf, sourceOptions, tpsMarks } from "./listFilters";
import { personHasSource, personTps } from "./peopleFilters";
import { SourceSelect, TpsChip, TpsNote, TpsPill } from "./ListFilterBar";

const clear = { status: "clear", ctps: false, checked_at: "2026-11-20T09:30:00Z" };
const listed = { status: "listed", ctps: true, checked_at: "2026-11-21T09:30:00Z" };
const rows = [
  { id: "1", phone: "0113 550 0412", phone_screening: clear, field_sources: { phone: "website", email: "import" } },
  { id: "2", phone: "020 7123 4567", phone_screening: listed, field_sources: { phone: "register", website: "register" } },
  { id: "3", phone: "07700 900999", phone_screening: null, field_sources: { phone: "google_places" } },
  { id: "4", phone: "", field_sources: {} },
  { id: "5", phone: "", research: { team: [{ name: "Tom", phone: "0161 000 0000", phone_screening: clear }] }, field_sources: { email: "apollo:pdl" } },
];

describe("TPS filter", () => {
  it("counts only screened phones, including a team member's number shown for the company", () => {
    expect(hasTpsCheck(rows[0], "0113 550 0412")).toBe(true);
    expect(hasTpsCheck(rows[2], "07700 900999")).toBe(false);
    expect(hasTpsCheck(rows[3], undefined)).toBe(false);
    expect(hasTpsCheck(rows[4], "0161 000 0000")).toBe(true);
    expect(screeningOf(rows[0], "something else")).toBeNull();
  });

  it("words the chips and dates the title, and says nothing for an unscreened number", () => {
    expect(tpsMarks(clear).map((m) => m.text)).toEqual(["TPS clear"]);
    expect(tpsMarks(listed).map((m) => m.text)).toEqual(["On TPS", "On CTPS"]);
    expect(tpsMarks({ status: "unknown", ctps: true }).map((m) => m.text)).toEqual(["On CTPS"]);
    expect(tpsMarks(clear)[0].title).toContain("20 Nov 2026");
    expect(tpsMarks(null)).toEqual([]);
  });
});

describe("Data from filter", () => {
  it("collects the source of the phone, email and website, ignoring a vendor suffix", () => {
    expect([...sourceKeysOf(rows[0])].sort()).toEqual(["import", "website"]);
    expect([...sourceKeysOf(rows[4])]).toEqual(["apollo"]);
    expect(hasSource(rows[2], "google_places")).toBe(true);
    expect(hasSource(rows[3], "register")).toBe(false);
  });

  it("lists only sources that have rows, with plain names and counts", () => {
    const opts = sourceOptions(rows);
    expect(opts.map((o) => [o.label, o.count])).toEqual([["Official register", 1], ["Company website", 1], ["Your file", 1], ["Google", 1], ["Enrichment data", 1]]);
    expect(sourceOptions([])).toEqual([]);
  });

  it("applies to saved people through the company they were saved on, and not to people a check found", () => {
    const own = { own: true, phone: "0113 550 0412", account: rows[0] };
    const found = { own: false, phone: "0161 000 0000", account: rows[0], screening: clear };
    expect(personHasSource(own, "website")).toBe(true);
    expect(personHasSource(found, "website")).toBe(false);
    expect(personTps(own)).toEqual(clear);
    expect(personTps(found)).toEqual(clear);
    expect(personTps({ own: true, phone: "0999", account: rows[0] })).toBeNull();
  });
});

describe("filter bar markup", () => {
  it("shows the pill with its count and pressed state, the select with counts, and the note", () => {
    const pill = renderToStaticMarkup(<TpsPill count={1234} on={false} onClick={() => {}} />);
    expect(pill).toContain("TPS checked 1,234");
    expect(pill).toContain('aria-pressed="false"');
    expect(renderToStaticMarkup(<TpsPill count={2} on onClick={() => {}} />)).toContain('aria-pressed="true"');
    const select = renderToStaticMarkup(<SourceSelect options={sourceOptions(rows)} value="" onChange={() => {}} />);
    expect(select).toContain("Data from");
    expect(select).toContain("Company website (1)");
    expect(renderToStaticMarkup(<SourceSelect options={[]} value="" onChange={() => {}} />)).toBe("");
    expect(renderToStaticMarkup(<TpsNote />)).toContain(TPS_NOTE);
    expect(TPS_NOTE).toBe("Showing contacts with at least one phone number checked against the TPS and CTPS registers (any number on the record).");
  });

  it("renders the TPS chip as text with a dated title, or nothing", () => {
    const html = renderToStaticMarkup(<TpsChip screening={listed} />);
    expect(html).toContain(">On TPS<");
    expect(html).toContain(">On CTPS<");
    expect(html).toContain("on 21 Nov 2026");
    expect(renderToStaticMarkup(<TpsChip screening={null} />)).toBe("");
  });
});
