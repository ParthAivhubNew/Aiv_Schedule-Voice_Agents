import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LabelTip, MoreMenu } from "../FindLeadsParts";

const read = (f) => readFileSync(new URL(f, import.meta.url), "utf8");

// Plan 13, step 6: Find Leads' toolbar is search, Filters and Saved searches; the rest sits on the results.
describe("a calmer Find Leads", () => {
  it("has one Import, in the results' ⋯ menu, and none in the page header or toolbar", () => {
    const search = read("./FindLeadsSearch.jsx");
    expect(search).toContain('label: "Import a spreadsheet"');
    expect(search).not.toContain("<Upload size={14} /> Import");
    // The page header has Import only on Lists, where imported companies end up.
    const plugin = read("../LeadGenerationPlugin.jsx");
    expect(plugin.match(/<Upload size=\{14\} \/> Import/g)).toHaveLength(1);
    expect(plugin).toContain('(view === "lists" || view === "saved_companies") && !isLocked && !embedViews ? (');
  });

  it("moves Companies / People and List / Map onto the results header once there are results", () => {
    const search = read("./FindLeadsSearch.jsx");
    expect(search).toContain("{showResults || firstLoad ? null : lookFor}");
    expect(search).toContain("<ResultsCard controls={lookFor} more={more}");
    const card = read("./ResultsCard.jsx");
    expect(card).toContain("{controls}");
    expect(card).toContain("<MoreMenu items={more}");
  });

  it("shows filter help as an ⓘ, not a paragraph", () => {
    const panel = read("./FilterPanel.jsx");
    expect(panel).not.toContain("<span style={{ ...muted, fontSize: 12 }}>A common word");
    const html = renderToStaticMarkup(<LabelTip tip="Words are matched">Include</LabelTip>);
    expect(html).toContain("Include");
    expect(html).toContain('aria-label="Words are matched"');
    expect(html).toContain('tabindex="0"');
  });

  it("the ⋯ menu is a labelled button, closed until pressed, and hides with nothing in it", () => {
    const html = renderToStaticMarkup(<MoreMenu items={[{ id: "a", label: "Import a spreadsheet", onClick: () => {} }]} label="More" />);
    expect(html).toContain('aria-label="More"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("Import a spreadsheet");
    expect(renderToStaticMarkup(<MoreMenu items={[null]} />)).toBe("");
  });
});

describe("the collapsed menu", () => {
  it("shows its expand button over the logo on hover, not on a row of its own", () => {
    const css = readFileSync(new URL("../../../app/global.css", import.meta.url), "utf8");
    expect(css).toContain("body.sidebar-collapsed .app-sidebar .sb-head:hover .sidebar-toggle");
    expect(css).not.toContain("body.sidebar-collapsed .app-sidebar .sb-head { flex-direction: column");
  });
});
