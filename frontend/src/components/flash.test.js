import { describe, expect, it } from "vitest";
import { failText } from "./flash";

describe("failText", () => {
  it("uses the server's message", () => {
    expect(failText(new Error("That number is already saved."))).toBe("That number is already saved.");
  });
  it("falls back when there is no message", () => {
    expect(failText(null, "Could not save.")).toBe("Could not save.");
    expect(failText(new Error("  "), "Could not save.")).toBe("Could not save.");
  });
  it("hides browser network wording", () => {
    expect(failText(new TypeError("Failed to fetch"), "Could not save.")).toBe("Could not save.");
    expect(failText(new TypeError("NetworkError when attempting to fetch resource."), "x")).toBe("x");
  });
  it("has a default", () => {
    expect(failText(undefined)).toBe("That did not work. Try again.");
  });
});
