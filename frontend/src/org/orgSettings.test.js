import { describe, expect, it } from "vitest";
import { formatOrgTime, orgDateTime, orgInstant, tzLabel } from "./orgSettings";

describe("organisation time helpers", () => {
  it("turns a wall-clock date and time in the org timezone into the right instant", () => {
    // 09:00 in Kolkata (UTC+5:30) is 03:30 UTC, whatever timezone the browser is in.
    expect(new Date(orgInstant("2026-10-05", "09:00", "Asia/Kolkata")).toISOString()).toBe("2026-10-05T03:30:00.000Z");
  });

  it("handles daylight saving", () => {
    expect(new Date(orgInstant("2026-10-20", "09:00", "Europe/London")).getUTCHours()).toBe(8);
    expect(new Date(orgInstant("2026-10-30", "09:00", "Europe/London")).getUTCHours()).toBe(9);
    expect(new Date(orgInstant("2026-03-10", "09:00", "America/New_York")).getUTCHours()).toBe(13);
  });

  it("round-trips an instant back to the org date and time", () => {
    const ms = orgInstant("2026-12-31", "23:45", "Pacific/Auckland");
    expect(orgDateTime(ms, "Pacific/Auckland")).toEqual({ date: "2026-12-31", time: "23:45" });
  });

  it("rejects a bad date", () => {
    expect(Number.isNaN(orgInstant("nope", "09:00", "UTC"))).toBe(true);
  });

  it("formats times in 12h or 24h", () => {
    expect(formatOrgTime("21:05", "12h")).toBe("9:05 PM");
    expect(formatOrgTime("00:30", "12h")).toBe("12:30 AM");
    expect(formatOrgTime("9:05", "24h")).toBe("09:05");
  });

  it("labels the timezone with its offset", () => {
    expect(tzLabel("Asia/Kolkata")).toContain("Asia/Kolkata");
  });
});
