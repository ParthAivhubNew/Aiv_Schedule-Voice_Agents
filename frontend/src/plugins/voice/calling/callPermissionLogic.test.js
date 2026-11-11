import { describe, expect, it } from "vitest";
import { permissionMissing, screeningPill } from "./callPermissionLogic";

describe("call permission screen", () => {
  it("says check TPS first when nothing was screened", () => {
    expect(screeningPill({ tps_status: "unknown" })).toEqual({ tone: "amber", text: "Not screened: check TPS first" });
    expect(screeningPill(null).tone).toBe("amber");
  });
  it("shows listed and clear", () => {
    expect(screeningPill({ tps_status: "listed", fresh: true }).tone).toBe("red");
    expect(screeningPill({ tps_status: "clear", fresh: true }).text).toBe("Clear on TPS");
    expect(screeningPill({ tps_status: "clear", fresh: false }).tone).toBe("amber");
  });
  it("lists what is missing, one thing at a time", () => {
    expect(permissionMissing({ number: "123" })).toMatch(/number/);
    expect(permissionMissing({ number: "+447700900123", company: " " })).toMatch(/company/);
    expect(permissionMissing({ number: "+447700900123", company: "Acme" })).toMatch(/confirm/);
    expect(permissionMissing({ number: "+447700900123", company: "Acme", confirmed: true })).toBe("");
  });
});
