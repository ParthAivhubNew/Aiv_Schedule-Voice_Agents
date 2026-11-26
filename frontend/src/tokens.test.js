import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { C, CSS_VARS, HEX } from "./tokens";
import LEADS from "./plugins/leadgen/hexBaseline.json";
import VOICE from "./plugins/voice/hexBaseline.json";
import SOCIAL from "./plugins/scheduler/hexBaseline.json";
import HOME from "./hub/hexBaseline.json";
import SETTINGS from "./settings/hexBaseline.json";
import CALENDAR from "./plugins/calendar/hexBaseline.json";

// Plan 10, Phase 4: the screens' colours have one source. CSS variables in app/global.css hold the values tokens.js HEX lists, C reads them
// as var(--name, fallback), and no file in Leads, Voice, Social, the home screen, settings or calendar may gain hard-coded colours (each folder's
// hexBaseline.json counts the ones there, to be moved onto the tokens and the count lowered, never raised).
const css = readFileSync(new URL("./app/global.css", import.meta.url), "utf8");
const declared = Object.fromEntries([...css.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));

describe("one source for the colours", () => {
  it("every colour is a CSS variable with exactly the value tokens.js lists", () => {
    for (const [key, hex] of Object.entries(HEX)) {
      const name = CSS_VARS[key];
      expect(declared[name]?.toUpperCase(), `${key} (${name})`).toBe(hex.toUpperCase());
      expect(C[key]).toBe(`var(${name}, ${hex})`);
    }
  });

  const FOLDERS = [["plugins/leadgen", LEADS], ["plugins/voice", VOICE], ["plugins/scheduler", SOCIAL], ["hub", HOME], ["settings", SETTINGS],
    ["plugins/calendar", CALENDAR]];
  it.each(FOLDERS)("no file in %s gains hard-coded colours", (folder, BASELINE) => {
    const dir = new URL(`./${folder}/`, import.meta.url).pathname;
    const files = [];
    const walk = (d) => readdirSync(d).forEach((f) => { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(jsx|js)$/.test(f) && !f.includes(".test.")) files.push(p); });
    walk(dir);
    const grew = [];
    for (const p of files) {
      const n = (readFileSync(p, "utf8").match(/#[0-9A-Fa-f]{6}\b|#[0-9A-Fa-f]{3}\b/g) || []).length;
      const key = relative(dir, p);
      if (n > (BASELINE[key] || 0)) grew.push(`${key}: ${n} hex colours (was ${BASELINE[key] || 0}). Use C from tokens.js instead.`);
    }
    expect(grew).toEqual([]);
  });
});
