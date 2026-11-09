import { describe, expect, it } from "vitest";
import { pinnedOf, togglePin } from "./GridTools";

const fresh = { hidden: [], pinned: [], unpinned: [], widths: {}, names: {}, mode: "mine" };
const DEFAULTS = ["Company"];

describe("a column the table pins by default", () => {
  it("starts pinned", () => {
    expect(pinnedOf(fresh, DEFAULTS)).toEqual(["Company"]);
  });
  it("unpins, and the unpin is what is saved", () => {
    const off = togglePin(fresh, "Company", DEFAULTS);
    expect(pinnedOf(off, DEFAULTS)).toEqual([]);
    expect(off.unpinned).toEqual(["Company"]);
    const reloaded = JSON.parse(JSON.stringify(off));
    expect(pinnedOf(reloaded, DEFAULTS)).toEqual([]);
  });
  it("pins again after an unpin", () => {
    const back = togglePin(togglePin(fresh, "Company", DEFAULTS), "Company", DEFAULTS);
    expect(pinnedOf(back, DEFAULTS)).toEqual(["Company"]);
    expect(back.unpinned).toEqual([]);
  });
  it("keeps the person's own pins next to the default", () => {
    const more = togglePin(fresh, "Phone", DEFAULTS);
    expect(pinnedOf(more, DEFAULTS)).toEqual(["Company", "Phone"]);
    expect(pinnedOf(togglePin(more, "Phone", DEFAULTS), DEFAULTS)).toEqual(["Company"]);
  });
  it("the Default layout shows the table's own pins", () => {
    const off = togglePin(fresh, "Company", DEFAULTS);
    expect(pinnedOf({ ...off, mode: "default" }, DEFAULTS)).toEqual(["Company"]);
  });
  it("a layout saved before this change (no unpinned list) still works", () => {
    expect(pinnedOf({ ...fresh, unpinned: undefined }, DEFAULTS)).toEqual(["Company"]);
  });
});
