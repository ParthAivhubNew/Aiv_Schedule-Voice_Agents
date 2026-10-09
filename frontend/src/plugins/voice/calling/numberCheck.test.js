import { describe, expect, it } from "vitest";
import { applyResults, chunks, countByStatus, filterRows, itemsFor, namesOf, statusOf, toCsv, CHECK_COLUMNS } from "./numberCheck";

const rows = [
  { id: "a", company: "Acme Corp", contact: "Sam Patel", phone: "+12125550123" },
  { id: "b", company: "Zed", name: "Row 2", phone: "" },
  { id: "c", company: "Old", phone: "+442079460000" },
];
const res = (key, status, extra = {}) => ({ key, status, line_type: "mobile", carrier: "Verizon", country: "US", found_name: "Acme Corporation", match: "match", checked_on: "2030-01-01", ...extra });

describe("number check on the list", () => {
  it("sends only rows with a number, with the names on file", () => {
    const items = itemsFor(rows, (r) => r.phone);
    expect(items.map((i) => i.key)).toEqual(["a", "c"]);
    expect(items[0].names).toEqual(["Sam Patel", "Acme Corp"]);
    expect(namesOf(rows[1])).toEqual(["Zed"]); // "Row 2" is a placeholder, not a name
  });

  it("puts answers on the right rows and leaves the others alone", () => {
    const out = applyResults(rows, [res("a", "good")]);
    expect(statusOf(out[0])).toBe("good");
    expect(out[0].check.foundName).toBe("Acme Corporation");
    expect(out[1]).toBe(rows[1]);
    expect(statusOf(out[2])).toBe("not_checked");
  });

  it("a failed re-check does not wipe a real answer", () => {
    const first = applyResults(rows, [res("a", "good")]);
    const again = applyResults(first, [res("a", "couldnt_check")]);
    expect(statusOf(again[0])).toBe("good");
    const fresh = applyResults(rows, [res("a", "couldnt_check")]);
    expect(statusOf(fresh[0])).toBe("couldnt_check");
  });

  it("counts and filters by status or by name match", () => {
    const out = applyResults(rows, [res("a", "good"), res("c", "not_working", { match: "none" })]);
    expect(countByStatus(out)).toEqual({ good: 1, not_checked: 1, not_working: 1 });
    expect(filterRows(out, "good").map((r) => r.id)).toEqual(["a"]);
    expect(filterRows(out, "not_checked").map((r) => r.id)).toEqual(["b"]);
    expect(filterRows(out, "match:match").map((r) => r.id)).toEqual(["a"]);
    expect(filterRows(out, "")).toBe(out);
  });

  it("exports any columns as CSV, quoting commas and quotes", () => {
    const out = applyResults(rows, [res("a", "good", { found_name: 'Acme, "The" Corp' })]);
    const csv = toCsv([{ id: "c", label: "Company", get: (r) => r.company }, ...CHECK_COLUMNS.slice(0, 2)], out.slice(0, 2));
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("Company,Number status,Name found");
    expect(lines[1]).toBe('Acme Corp,Good,"Acme, ""The"" Corp"');
    expect(lines[2]).toBe("Zed,Not checked,");
  });

  it("splits a long list into runs", () => {
    expect(chunks([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunks([], 2)).toEqual([]);
  });
});
