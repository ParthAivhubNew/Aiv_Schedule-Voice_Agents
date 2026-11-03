import { describe, expect, it } from "vitest";
import { fieldTypeLabel, formLinks, moveItem, newField, whenShort } from "./inboundFormLogic";

describe("inbound form helpers", () => {
  it("gives a new field an id no other field uses", () => {
    const f = newField("text", [{ id: "text" }, { id: "text_2" }]);
    expect(f.id).toBe("text_3");
    expect(f.maps_to).toBe("custom:text_3");
  });

  it("maps name, email and phone fields to the matching lead columns", () => {
    expect(newField("name", []).maps_to).toBe("contact_name");
    expect(newField("email", []).maps_to).toBe("email");
    expect(newField("phone", []).maps_to).toBe("phone");
  });

  it("starts a dropdown with two options so it can be published", () => {
    expect(newField("dropdown", []).options.length).toBe(2);
  });

  it("moves an item up or down and stops at the ends", () => {
    expect(moveItem(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
    expect(moveItem(["a", "b", "c"], 1, 1)).toEqual(["a", "c", "b"]);
    const list = ["a", "b"];
    expect(moveItem(list, 0, -1)).toBe(list);
    expect(moveItem(list, 1, 1)).toBe(list);
  });

  it("builds the page link and an iframe for a published form", () => {
    const { page, iframe } = formLinks("https://app.example.com", "ab_C-9");
    expect(page).toBe("https://app.example.com/api/f/ab_C-9/page");
    expect(iframe).toContain(`src="${page}"`);
  });

  it("names field types and dates in plain words", () => {
    expect(fieldTypeLabel("text")).toBe("Short text");
    const now = Date.UTC(2026, 10, 3, 12);
    expect(whenShort(new Date(now - 3600e3).toISOString(), now)).toBe("Today");
    expect(whenShort(new Date(now - 30 * 3600e3).toISOString(), now)).toBe("Yesterday");
    expect(whenShort("", now)).toBe("–");
  });
});
