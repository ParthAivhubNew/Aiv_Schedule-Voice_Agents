import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../api/apiClient", () => ({ api: { searchEverything: () => Promise.resolve({ groups: [] }) } }));

import { commandItems, matchCommands } from "./commandItems";
import { SearchButton } from "./CommandPalette";

const owner = { is_admin: true, role: "Admin" };
const labels = (rows) => rows.map((r) => r.label);

// Plan 13, step 7: one search for every page, setting, company and person.
describe("what ⌘K can open", () => {
  it("lists every app's pages and the Settings sections this person may open", () => {
    const items = commandItems(owner);
    for (const name of ["Find Leads", "Journeys", "Conversations", "Post calendar", "Users", "Company rules", "API keys & webhooks", "Workflows"]) expect(labels(items)).toContain(name);
    expect(items.find((i) => i.label === "Users").go).toBe("#/settings/users");
    expect(items.find((i) => i.label === "Calendar & meetings").go).toBe("calendar");
    expect(labels(items)).not.toContain("Leads settings"); // the Apps rows point at pages already listed
    const user = commandItems({ role: "User", permissions: { team: "none" } });
    expect(labels(user)).not.toContain("Users");
    expect(labels(user)).not.toContain("API keys & webhooks");
  });

  it("matches every word, best names first", () => {
    const items = commandItems(owner);
    expect(labels(matchCommands(items, "find"))[0]).toBe("Find Leads");
    expect(labels(matchCommands(items, "plan credits"))).toEqual(expect.arrayContaining(["Leads plan & credits", "Voice plan & credits"]));
    expect(labels(matchCommands(items, "calls past"))).toContain("Conversations"); // found by the line under it
    expect(matchCommands(items, "zzzz")).toEqual([]);
    expect(matchCommands(items, "").length).toBeGreaterThan(3); // a few places to start, before anything is typed
  });

  it("the header button names its keys, and the box opens on ⌘K / Ctrl K or the button", () => {
    const src = readFileSync(new URL("./CommandPalette.jsx", import.meta.url), "utf8");
    expect(src).toContain('(e.metaKey || e.ctrlKey) && !e.altKey && String(e.key).toLowerCase() === "k"');
    expect(src).toContain("window.addEventListener(OPEN_SEARCH, show)");
    const btn = renderToStaticMarkup(<SearchButton />);
    expect(btn).toContain("Search");
    expect(btn).toMatch(/⌘K|Ctrl K/);
  });

  it("is in every app's header and on Home, and mounted once for the signed-in person", () => {
    expect(readFileSync(new URL("./AccountBar.jsx", import.meta.url), "utf8")).toContain("<SearchButton />");
    expect(readFileSync(new URL("./AppHome.jsx", import.meta.url), "utf8")).toContain("<SearchButton />");
    expect(readFileSync(new URL("../App.jsx", import.meta.url), "utf8")).toContain("{operator ? <CommandPalette operator={operator} /> : null}");
  });
});
