import { describe, expect, it } from "vitest";
import { ago } from "./notificationTime";

describe("notification age", () => {
  const now = Date.parse("2026-11-05T12:00:00Z");
  it("reads the moment from the id", () => {
    expect(ago({ id: `n_${now - 30_000}`, time: "just now" }, now)).toBe("just now");
    expect(ago({ id: `n_${now - 5 * 60_000}`, time: "just now" }, now)).toBe("5 min ago");
    expect(ago({ id: `n_${now - 3 * 3600_000}` }, now)).toBe("3 hours ago");
    expect(ago({ id: `n_${now - 2 * 86400_000}` }, now)).toBe("2 days ago");
  });
  it("prefers an ISO time and keeps the old text when there is no moment", () => {
    expect(ago({ at: "2026-11-05T11:00:00Z" }, now)).toBe("1 hour ago");
    expect(ago({ id: "abc", time: "Yesterday" }, now)).toBe("Yesterday");
  });
});
