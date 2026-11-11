import { describe, expect, it } from "vitest";
import { deleteResult, deleteSummary, toggleAll, toggleOne } from "./retentionLogic";

describe("retention review", () => {
  it("select all picks everything, then clears", () => {
    const ids = ["a", "b", "c"];
    const all = toggleAll(ids, new Set());
    expect([...all]).toEqual(ids);
    expect(toggleAll(ids, all).size).toBe(0);
  });
  it("toggles one without touching the others", () => {
    const s = toggleOne(new Set(["a"]), "b");
    expect([...s].sort()).toEqual(["a", "b"]);
    expect([...toggleOne(s, "a")]).toEqual(["b"]);
  });
  it("words the button and the result", () => {
    expect(deleteSummary(1)).toBe("Delete 1 company");
    expect(deleteSummary(2500)).toBe("Delete 2,500 companies");
    expect(deleteResult({ deleted: 3, locked: 0 })).toBe("Deleted 3 companies.");
    expect(deleteResult({ deleted: 0, locked: 1 })).toContain("1 is being checked");
  });
});
