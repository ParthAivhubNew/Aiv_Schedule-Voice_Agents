import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../api/apiClient", () => ({ api: { getPlatformProvided: () => Promise.resolve({}), latestCompanyCheck: () => Promise.resolve({}) } }));

import { describeSources } from "./sourceBadgeLogic";
import { SourceBadge } from "./SourceBadge";
import { ConnectorsView, NOT_CONNECTED_CONNECTORS, NOT_CONNECTED_LABEL, NOT_CONNECTED_TEXT, NotConnectedPanel } from "./ConnectorsView";

const full = {
  name: "Acme Ltd",
  field_sources: { phone: "website", email: "import", website: "register" },
  verification: {
    verdict: "verified", checked_at: "2026-11-20T10:00:00Z", stages: ["registry", "website", "email", "phone", "phone_lookup"],
    reasons: ["Company register: active (checked live)"], website: { state: "live" }, email: { state: "ok" }, phone: { state: "ok", verified: true },
  },
};

describe("describeSources", () => {
  it("lists each field with its plain source and each check that ran with its date", () => {
    const d = describeSources(full);
    expect(d.fields).toEqual([
      { key: "website", field: "Phone", label: "Company website" },
      { key: "import", field: "Email", label: "Your file" },
      { key: "register", field: "Website", label: "Official register" },
    ]);
    expect(d.checks.map((c) => [c.name, c.result])).toEqual([
      ["Official register", "Active, checked live"],
      ["Company website", "Working"],
      ["Email address", "Looks right"],
      ["Phone format", "Looks right"],
      ["Number check", "Confirmed live"],
    ]);
    expect(d.checks[0].when).toBe("20 Nov 2026");
    expect(d.checked).toBe(true);
    expect(d.summary).toContain("5 checks");
  });

  it("never invents a check: only stages the check saved appear", () => {
    const d = describeSources({ ...full, verification: { ...full.verification, stages: ["website"] } });
    expect(d.checks.map((c) => c.name)).toEqual(["Company website"]);
  });

  it("says Not checked yet when there is no verification and no sources", () => {
    const d = describeSources({ name: "Bare Ltd" });
    expect(d.fields).toEqual([]);
    expect(d.checks).toEqual([]);
    expect(d.summary).toBe("Not checked yet");
  });

  it("falls back to the verdict when a check saved no stages, and handles a pending register", () => {
    expect(describeSources({ verification: { verdict: "unclear", checked_at: "2026-11-20T10:00:00Z" } }).checks[0]).toMatchObject({ name: "Company check", result: "Unclear" });
    const p = describeSources({ verification: { verdict: "looks_ok", stages: ["registry"], pending_registry: true, reasons: [] } });
    expect(p.checks[0].result).toBe("Has not answered yet");
  });

  it("names an unknown source as Other source and strips a suffix", () => {
    expect(describeSources({ field_sources: { phone: "website:contact", email: "mystery" } }).fields.map((f) => f.label)).toEqual(["Company website", "Other source"]);
  });

  it("adds the Google note when a value came from Google, with no supplier name beyond Google", () => {
    const d = describeSources({ field_sources: { phone: "google_places" }, restricted: { phone: true } });
    expect(d.fields[0].label).toBe("Google");
    expect(d.notes[0]).toMatch(/can't be downloaded/);
  });
});

describe("SourceBadge", () => {
  it("is a labelled button with a described popover, closed by default", () => {
    const html = renderToStaticMarkup(<SourceBadge account={full} />);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("aria-describedby");
    expect(html).toContain("Where Acme Ltd");
    expect(html).toContain('role="tooltip"');
    expect(html).toContain("min-width:44px");
    expect(html).not.toContain("position:fixed");
  });

  it("opens with details and checks, and a not-checked company says so", () => {
    const open = renderToStaticMarkup(<SourceBadge account={full} defaultOpen />);
    expect(open).toContain("position:fixed");
    expect(open).toContain("Details from");
    expect(open).toContain("Checked against");
    expect(open).toContain("Phone:");
    expect(open).toContain("Official register");
    expect(open).toContain("Active, checked live");
    const none = renderToStaticMarkup(<SourceBadge account={{ name: "Bare Ltd" }} defaultOpen />);
    expect(none).toContain("Not checked yet");
    expect(none).toContain("No source is recorded");
  });

  it("shows the restricted Google value note", () => {
    const html = renderToStaticMarkup(<SourceBadge account={{ name: "G Ltd", field_sources: { phone: "google_places" }, restricted: { phone: true } }} defaultOpen />);
    expect(html).toContain("Phone:");
    expect(html).toContain("Google");
    expect(html).toContain("can&#x27;t be downloaded");
  });
});

describe("the two new connectors", () => {
  const html = renderToStaticMarkup(<ConnectorsView operator={{}} toast={() => {}} />);

  it("sit with the data connectors and say Not connected yet", () => {
    expect(html).toContain("Experian");
    expect(html).toContain("Market Location");
    expect(html.split(NOT_CONNECTED_LABEL).length - 1).toBe(2);
    const ex = NOT_CONNECTED_CONNECTORS();
    expect(ex.map((c) => [c.name, c.category])).toEqual([["Experian", "Enrichment & Registry"], ["Market Location", "Enrichment & Registry"]]);
    expect(ex.every((c) => c.defaultStatus === "not_connected")).toBe(true);
  });

  it("have a plain panel that fakes no connection, test or key field", () => {
    const panel = renderToStaticMarkup(<NotConnectedPanel connector={NOT_CONNECTED_CONNECTORS()[0]} />);
    expect(panel).toContain("Status: Not connected yet");
    expect(panel).toContain("Company credit and business data.");
    expect(panel).toContain(NOT_CONNECTED_TEXT.replace("'", "&#x27;"));
    expect(panel).not.toMatch(/<input|Test API|Authorize/);
  });

  it("links Market Location out safely", () => {
    const ml = NOT_CONNECTED_CONNECTORS()[1];
    expect(ml.docsUrl).toBe("https://www.marketlocation.com/business-data/");
    expect(ml.linkText).toBe("marketlocation.com/business-data");
  });
});
