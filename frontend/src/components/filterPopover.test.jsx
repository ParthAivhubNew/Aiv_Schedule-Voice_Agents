import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CountTabs, FilterChips, FilterPopover } from "./FilterPopover";

// Plan 13, step 6: every list screen gets Find Leads' pattern: one Filters menu, the filters in use as chips, counts as tabs.
describe("the list filter pattern", () => {
  it("is one Filters button with a count, closed until pressed", () => {
    const html = renderToStaticMarkup(<FilterPopover count={2}><span>inside</span></FilterPopover>);
    expect(html).toContain("Filters");
    expect(html).toContain(">2<");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("inside");
  });

  it("shows the filters in use as chips, with Clear all once there are two", () => {
    const one = renderToStaticMarkup(<FilterChips chips={[{ key: "g", text: "Google data", onRemove: () => {} }]} onClearAll={() => {}} />);
    expect(one).toContain('aria-label="Remove Google data"');
    expect(one).not.toContain("Clear all");
    const two = renderToStaticMarkup(<FilterChips chips={[{ key: "g", text: "Google data", onRemove: () => {} }, { key: "t", text: "TPS checked", onRemove: () => {} }]} onClearAll={() => {}} />);
    expect(two).toContain("Clear all");
    expect(renderToStaticMarkup(<FilterChips chips={[]} />)).toBe("");
  });

  it("draws counts as underlined tabs", () => {
    const html = renderToStaticMarkup(<CountTabs label="x" value="b" onChange={() => {}} tabs={[{ id: "a", label: "Ready", count: 3 }, { id: "b", label: "All", count: 1200 }]} />);
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain("1,200");
  });

  it("is what Lists uses, in place of the row of coloured pills", () => {
    const src = readFileSync(new URL("../plugins/leadgen/accounts/AccountsView.jsx", import.meta.url), "utf8");
    expect(src).toContain("<FilterPopover count={filtersOn.length}>");
    expect(src).toContain("<CountTabs label=\"Companies by what to do next\"");
    expect(src).not.toContain("<TpsPill");
  });
});

// Owner, 2026-11-27: the blue underline under the chosen tab isn't professional. Every tab bar now marks the chosen tab with a soft
// filled pill (var(--ui-hover)) and dark text, like the Companies / List switches. This keeps an underline from coming back.
describe("one look for chosen tabs, everywhere", () => {
  it("no tab is marked by a coloured 2px underline", async () => {
    const { readdirSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const root = new URL("..", import.meta.url).pathname;
    const hits = [];
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) { if (name !== "node_modules") walk(p); continue; }
        if (!/\.(jsx|js|css)$/.test(name) || /\.test\./.test(name)) continue;
        // A find button's "matches waiting" mark in Find Leads is an underline on an icon, not a tab: left out.
        const src = readFileSync(p, "utf8").split("\n").filter((l) => !l.includes("borderBottom: pending ?")).join("\n");
        if (/borderBottom: [^\n]*`2px solid \$\{C\.(cobalt|teal|ink)\}`|border-bottom-color: ?var\(--ui-accent|border-bottom-color: \$\{C\.cobalt\}/.test(src)
          || /borderBottom: `2px solid \$\{[^}]+\? (C\.(cobalt|teal|ink)|"var\(--ui-accent\)")/.test(src)) hits.push(p.slice(root.length));
      }
    };
    walk(root);
    expect(hits).toEqual([]);
  });
});
