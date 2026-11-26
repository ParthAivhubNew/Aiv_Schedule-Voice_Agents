import { describe, expect, it } from "vitest";
import { groupAlerts } from "./Alerts";

// Plan 13: the staff banner said "36 alerts need a look" when 33 of them were the same config check, raised again at each restart.
describe("staff alerts are grouped by kind", () => {
  const cfg = (id, at, extra = {}) => ({ id, code: "CFG-01", org: "platform", detail: "block: stripe_test", ref: "", at, ...extra });
  it("shows a repeated alert once, with how many times and since when", () => {
    const g = groupAlerts([cfg("c", "2026-11-26T21:03:00"), cfg("b", "2026-11-26T11:43:00", { count: 4, first_at: "2026-11-20T09:00:00" }), cfg("a", "2026-11-26T11:34:00")]);
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ ids: ["c", "b", "a"], count: 6, first_at: "2026-11-20T09:00:00", at: "2026-11-26T21:03:00" });
  });
  it("keeps different alerts, and different references, apart, newest first", () => {
    const g = groupAlerts([
      cfg("a", "2026-11-26T10:00:00"),
      { id: "x", code: "AI-99", org: "acme", detail: "KeyError", ref: "ERR-1", at: "2026-11-26T12:00:00" },
      { id: "y", code: "AI-99", org: "acme", detail: "KeyError", ref: "ERR-2", at: "2026-11-26T11:00:00" },
    ]);
    expect(g.map((a) => a.ids[0])).toEqual(["x", "y", "a"]);
  });
});
