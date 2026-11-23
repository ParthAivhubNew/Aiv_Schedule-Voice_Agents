import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../api/apiClient", () => ({ api: new Proxy({}, { get: () => () => new Promise(() => {}) }) }));

import { PhoneScreeningBody, SCREENING_SWITCH, screeningChanges, screeningCostLine } from "./PhoneScreeningCard";

const html = (el) => renderToStaticMarkup(el);
const noop = () => {};

describe("phone screening card", () => {
  it("says what it does and what it costs, without naming the vendor", () => {
    const out = html(<PhoneScreeningBody state={{ enabled: true, notice: null, credits_per_five: 2 }} onToggle={noop} />);
    expect(out).toContain("Check phone numbers against the TPS and CTPS registers automatically.");
    expect(out).toContain("Uses credits: 2 credits per 5 numbers checked. Numbers checked in the last 28 days are free.");
    expect(out.toLowerCase()).not.toContain("provero");
    expect(SCREENING_SWITCH).toContain("TPS and CTPS");
    expect(screeningCostLine(3)).toContain("3 credits per 5 numbers");
  });
  it("is a labelled switch that reflects the saved state", () => {
    const on = html(<PhoneScreeningBody state={{ enabled: true, notice: null }} onToggle={noop} />);
    const off = html(<PhoneScreeningBody state={{ enabled: false, notice: null }} onToggle={noop} />);
    expect(on).toContain('role="switch"');
    expect(on).toContain('checked=""');
    expect(off).not.toContain('checked=""');
    expect(on).toContain('for="ps-switch"');
  });
  it("is disabled until the state has loaded and while saving", () => {
    expect(html(<PhoneScreeningBody state={null} onToggle={noop} />)).toContain("disabled");
    expect(html(<PhoneScreeningBody state={{ enabled: true }} busy onToggle={noop} />)).toContain("disabled");
  });
  it("shows the last notice and any error", () => {
    const out = html(<PhoneScreeningBody state={{ enabled: true, notice: { text: "Some phone numbers were not screened: not enough credits." } }} error="Couldn't save. Try again." onToggle={noop} />);
    expect(out).toContain("Some phone numbers were not screened: not enough credits.");
    expect(out).toContain('role="alert"');
  });
  it("lists exactly what changes for the two-step confirmation", () => {
    expect(screeningChanges(true, 2).join(" ")).toContain("2 credits per 5 numbers");
    expect(screeningChanges(false)[0]).toBe("Turn off automatic TPS and CTPS checks");
  });
});
