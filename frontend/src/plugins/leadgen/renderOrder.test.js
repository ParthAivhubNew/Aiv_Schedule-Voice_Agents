import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// A `const` used before its line runs crashes the whole screen with "Cannot access 'x' before initialization", and a build or a unit
// test does not notice it. These refs are assigned on every render, so they must be declared above that line.
describe("Find Leads render order", () => {
  const src = readFileSync(new URL("./find/FindLeadsSearch.jsx", import.meta.url), "utf8");
  for (const name of ["excludedRef", "selKeyRef"]) {
    it(`${name} is declared before it is first assigned`, () => {
      const declared = src.indexOf(`const ${name} = useRef(`);
      const used = src.indexOf(`${name}.current =`);
      expect(declared).toBeGreaterThan(-1);
      expect(used).toBeGreaterThan(-1);
      expect(declared).toBeLessThan(used);
    });
  }

  it("the map area's values come from useMapArea before anything reads them", () => {
    const code = src.replace(/\/\/[^\n]*/g, ""); // comments may mention the area anywhere
    const start = code.indexOf("const countHold = useHold();");
    expect(code.indexOf("= useMapArea({")).toBeGreaterThan(start);
    for (const name of ["area", "areaStep", "countArea", "supersedeArea", "countHold"]) {
      const first = code.search(new RegExp(`(?<![\\w.'"])${name}\\b`));
      expect(first, name).toBeGreaterThanOrEqual(start);
    }
  });

  it("a drawn map area switches the opening list's retries off", () => {
    // The retry used to see the area's emptied list as a failed opening list and ran a normal search over the area's count.
    const retry = src.slice(src.indexOf("const openingActive = useRef(true);"), src.indexOf("const ranFor = useRef("));
    expect(retry).toMatch(/if \(area\) \{ openingActive\.current = false; return undefined; \}/);
    expect(retry).toMatch(/\[error, busy, searched, companies\.length, area\]/);
  });
});
