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
});
