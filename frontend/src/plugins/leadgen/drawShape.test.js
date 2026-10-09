import { describe, expect, it } from "vitest";
import { amountChoices, MAX_CORNERS, shapeFromPath } from "./drawShape";

describe("pencil shapes", () => {
  it("turns a wobbly hand-drawn loop into a few corners", () => {
    const path = [];
    for (let i = 0; i <= 200; i += 1) {
      const a = (i / 200) * Math.PI * 2;
      path.push([51.45 + 0.03 * Math.sin(a) + (i % 2) * 0.00001, -1 + 0.04 * Math.cos(a)]);
    }
    const shape = shapeFromPath(path);
    expect(shape.length).toBeGreaterThanOrEqual(3);
    expect(shape.length).toBeLessThan(path.length);
    expect(shape.every((p) => p.length === 2)).toBe(true);
  });

  it("never sends more corners than the server allows", () => {
    const path = Array.from({ length: 4000 }, (_, i) => [51 + Math.sin(i / 7) * 0.2 + (i / 4000) * 0.3, -1 + Math.cos(i / 5) * 0.2]);
    expect(shapeFromPath(path).length).toBeLessThanOrEqual(MAX_CORNERS);
  });

  it("ignores a slip of the hand", () => {
    expect(shapeFromPath([[51.45, -1], [51.45001, -1.00001], [51.45002, -1]])).toBeNull();
    expect(shapeFromPath([[51.45, -1], [51.46, -1.01]])).toBeNull();
    expect(shapeFromPath([])).toBeNull();
  });

  it("drops a last point that lands on the first, so the shape closes cleanly", () => {
    const shape = shapeFromPath([[51.4, -1.0], [51.4, -0.9], [51.5, -0.9], [51.5, -1.0], [51.4, -1.0]]);
    expect(shape).toEqual([[51.4, -1], [51.4, -0.9], [51.5, -0.9], [51.5, -1]]);
  });
});

describe("how many to show", () => {
  it("offers only amounts below what is there, and All last", () => {
    expect(amountChoices(3200).map((c) => c.label)).toEqual(["100", "500", "1,000", "All 3,200"]);
    expect(amountChoices(300).map((c) => c.label)).toEqual(["100", "All 300"]);
    expect(amountChoices(40).map((c) => c.label)).toEqual(["All 40"]);
    expect(amountChoices(40).at(-1).value).toBe(Infinity);
  });
});
