import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Plan 11, C.6: a paid button says its price before it is pressed, and that price comes from the company's own rate card
// (app/usePrice.js), never from a number typed into a screen. Help pages may quote "the standard rate"; screens may not.
const root = new URL("..", import.meta.url).pathname;
const SKIP = /(\.test\.|\/adminPortal\/|\/help\/content\/|connectorPrices\.js$)/; // staff screens, help text, vendor price lists

const files = [];
const walk = (d) => readdirSync(d).forEach((f) => {
  const p = join(d, f);
  if (statSync(p).isDirectory()) walk(p);
  else if (/\.jsx$/.test(f) && !SKIP.test(p)) files.push(p);
});
walk(root);

// Code without its comments, so a comment may still say what a rate usually is.
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, "")).replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
const TYPED = /\b\d+(\.\d+)?\s+(Leads\s+|Social\s+|Voice\s+)?credits?\b/i;

describe("prices on screens", () => {
  it("finds the screens to check", () => {
    expect(files.length).toBeGreaterThan(50);
  });
  it("no screen types in a credit price", () => {
    const found = files.flatMap((p) => code(readFileSync(p, "utf8")).split("\n")
      .map((line, i) => (TYPED.test(line) ? `${relative(root, p)}:${i + 1}: ${line.trim().slice(0, 120)}` : null))
      .filter(Boolean));
    expect(found).toEqual([]);
  });
});
