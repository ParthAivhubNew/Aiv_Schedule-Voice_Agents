import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../api/apiClient", () => ({ api: { getLeadSourcesSummary: () => Promise.resolve({}) } }));

import { coverageLine, LeadSourcesCard } from "./LeadSources";
import { detailSources, WhereFrom } from "./WhereFrom";
import { originOptions } from "./originLabels";

// Plan 10, Phase 2: where each company came from, on the screens. Everything shown is what the server sent.
describe("lead sources", () => {
  it("offers a Came-from choice per origin with its count", () => {
    const rows = [{ source: "import" }, { source: "import" }, { source: "inbound_call" }, { source: "find_leads" }, { source: "weird" }];
    expect(originOptions(rows)).toEqual([{ key: "scout", label: "Find Leads", count: 1 }, { key: "import", label: "Your file", count: 2 },
      { key: "inbound_call", label: "Inbound call", count: 1 }, { key: "manual", label: "Added by hand", count: 1 }]);
  });

  it("shows origins, how far each got, and where details came from", () => {
    const data = { total: 4, origins: [{ key: "import", label: "Your file", count: 2, reached: { contacted: 2, interested: 1, meeting: 1, won: 1 } }],
      coverage: [{ field: "phone", with: 3, bySource: [{ label: "Your file", count: 2 }, { label: "Not recorded", count: 1 }] },
        { field: "email", with: 0, bySource: [] }, { field: "website", with: 0, bySource: [] }] };
    const html = renderToStaticMarkup(<LeadSourcesCard initialData={data} />);
    expect(html).toContain("Lead sources");
    expect(html).toContain("Your file");
    expect(html).toContain("3 of 4 (75%)");
    expect(html).toContain("Your file 2, Not recorded 1");
    expect(coverageLine(0, 0)).toBe("0");
    expect(renderToStaticMarkup(<LeadSourcesCard initialData={{ total: 0, origins: [], coverage: [] }} />)).toBe("");
  });

  it("says how a company joined, where each detail came from and which registers list it", () => {
    const c = {
      mine: { source: "import", added: "2026-11-03T10:00:00Z", source_detail: { text: "From the file members.csv", url: "" }, phone: "01273 555123",
        field_sources: { phone: "import" }, website: "", email: "" },
      contact: { website: { value: "acme.co.uk", label: "From a web scrape" }, email: { value: "" } },
      registers: ["Companies House", "Charity Commission"],
    };
    expect(detailSources(c)).toEqual([{ kind: "website", name: "Website", label: "From a web scrape" }, { kind: "phone", name: "Phone", label: "Your file" }]);
    const html = renderToStaticMarkup(<WhereFrom c={c} />);
    expect(html).toContain("Imported from your file · 3 Nov 2026");
    expect(html).toContain("From the file members.csv");
    expect(html).toContain("Charity Commission");
    expect(renderToStaticMarkup(<WhereFrom c={{}} />)).toBe("");
  });
});
