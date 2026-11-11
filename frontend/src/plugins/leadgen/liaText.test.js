import { describe, expect, it } from "vitest";
import { LIA_FIELDS, liaStatus } from "./liaText";

describe("LIA card text", () => {
  it("has the four answers in order", () => {
    expect(LIA_FIELDS.map(([k]) => k)).toEqual(["purpose", "necessity", "balance", "safeguards"]);
  });
  it("says whether it was saved", () => {
    expect(liaStatus({ saved: false })).toBe("Not saved yet.");
    expect(liaStatus({ saved: true, updated_at: "2026-11-11T10:00:00Z", by: "priya" })).toBe("Last saved 2026-11-11 by priya.");
  });
});
