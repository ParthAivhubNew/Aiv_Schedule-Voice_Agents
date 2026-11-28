import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../api/apiClient", () => ({ api: { getPlatformProvided: () => Promise.resolve({}), latestCompanyCheck: () => Promise.resolve({}), getConnectors: () => Promise.resolve({}) } }));

import { describeSources } from "./sourceBadgeLogic";
import { SourceBadge } from "./SourceBadge";
import { readFileSync } from "node:fs";
import { ConnectorDetail, ConnectorsView, TestResult } from "./ConnectorsView";
import { EnrichmentBanner, EnrichmentSourcesModal } from "./EnrichmentSourcesModal";

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
    expect(html).not.toContain("position:fixed");
  });

  it("opens with details and checks, and a not-checked company says so", () => {
    const open = renderToStaticMarkup(<SourceBadge account={full} defaultOpen />);
    expect(open).toMatch(/role="tooltip" style="position:(fixed|absolute)/); // under its button until it has measured the screen
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

// The Connectors screen shows only what the server sent (plan 10, Phases 0 and 3).
const SERVER = {
  canTest: true,
  countsAt: "2026-11-25T09:00:00",
  groups: [{ id: "registers", label: "Official registers" }, { id: "data", label: "Business data" }, { id: "services", label: "Look-ups we run for you" }],
  kinds: [{ id: "company", label: "Company details" }, { id: "credit", label: "Financial & credit" }, { id: "email", label: "Emails" }],
  connectors: [
    { id: "ds_companies_house", name: "Companies House (UK)", group: "registers", status: "paused", statusLabel: "Updates paused", logo: "companies_house",
      statusText: "Its records are searchable. New updates are paused.", desc: "Every UK registered company.", provides: ["company"], records: 71797, leads: 12 },
    { id: "experian", name: "Experian", group: "data", status: "coming_soon", statusLabel: "Coming soon", logo: "experian", desc: "Company credit and business data.",
      provides: ["credit"], askable: true, pricing: "experian" },
    { id: "email_finders", name: "E-mail finder (verified)", group: "services", status: "connected", statusLabel: "Connected", logo: "email",
      desc: "Finds a work e-mail.", provides: ["email"], testable: true, uses30d: 40 },
  ],
};

describe("the Connectors screen", () => {
  const html = renderToStaticMarkup(<ConnectorsView initialData={SERVER} />);

  it("shows the server's statuses and counts, and nothing made up", () => {
    expect(html).toContain("Updates paused");
    expect(html).toContain("71,797 records · 12 of your companies");
    expect(html).toContain("Coming soon");
    expect(html).toContain("1 connected");
    expect(html).toContain("1 need a look");
    expect(html).not.toMatch(/Authentication verified|\d+ms|5,200,000|Connected &amp; Active/);
  });

  it("keeps nothing in the browser and fakes no test", () => {
    const src = readFileSync(new URL("./ConnectorsView.jsx", import.meta.url), "utf8");
    expect(src).not.toMatch(/localStorage|setTimeout|status: 200/);
    expect(src).toContain("api.testConnector(c.id)");
  });

  it("shows a failed check as a failure", () => {
    const bad = renderToStaticMarkup(<TestResult result={{ ok: false, detail: "0 of 1 e-mail finders answered." }} />);
    expect(bad).toContain("0 of 1 e-mail finders answered.");
    expect(bad).toContain("#FEE2E2");
    const good = renderToStaticMarkup(<TestResult result={{ ok: true, detail: "It answered: it's working." }} />);
    expect(good).toContain("#DCFCE7");
  });

  it("offers Ask for it, not a key field, on a connector that isn't built", () => {
    const panel = renderToStaticMarkup(<ConnectorDetail c={SERVER.connectors[1]} kinds={SERVER.kinds} canTest onClose={() => {}} />);
    expect(panel).toContain("Ask for it");
    expect(panel).toContain("It would give you");
    expect(panel).not.toMatch(/<input|Test connection|Authorize/);
  });

  it("lets only admins press Test", () => {
    const user = renderToStaticMarkup(<ConnectorDetail c={SERVER.connectors[2]} kinds={SERVER.kinds} canTest={false} onClose={() => {}} />);
    expect(user).toContain("An account admin can test this connection.");
    expect(user).not.toContain("Test connection");
    const admin = renderToStaticMarkup(<ConnectorDetail c={SERVER.connectors[2]} kinds={SERVER.kinds} canTest onClose={() => {}} />);
    expect(admin).toContain("Test connection");
  });
});

describe("where your data comes from, on Lists", () => {
  it("lists only the sources the server says are on, with no made-up speeds", () => {
    const html = renderToStaticMarkup(<EnrichmentSourcesModal open onClose={() => {}} initialData={SERVER} />);
    expect(html).toContain("Companies House (UK)");
    expect(html).toContain("E-mail finder (verified)");
    expect(html).not.toContain("Experian");  // coming soon is not a source of anything yet
    expect(html).not.toMatch(/latency|\d+ms|Verified APIs|PAF/);
    const banner = renderToStaticMarkup(<EnrichmentBanner onOpenModal={() => {}} />);
    expect(banner).toContain("See the sources");
    expect(banner).not.toMatch(/9 Verified APIs|automatically/);
  });
});
