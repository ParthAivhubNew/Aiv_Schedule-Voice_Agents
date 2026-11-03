import { describe, expect, it } from "vitest";
import { mergeDuplicates } from "./duplicateNotice";

describe("mergeDuplicates", () => {
  it("starts a notice from the first announcement", () => {
    const n = mergeDuplicates(null, { kind: "save", total: 2, pairs: [{ a: 1 }, { a: 2 }] });
    expect(n.total).toBe(2);
    expect(n.pairs).toHaveLength(2);
  });
  it("joins batches of one file into one notice", () => {
    const first = { kind: "save", total: 2, pairs: [{ a: 1 }, { a: 2 }] };
    const n = mergeDuplicates(first, { kind: "save", total: 3, pairs: [{ a: 3 }] });
    expect(n.total).toBe(5);
    expect(n.pairs).toHaveLength(3);
  });
  it("keeps only the first 300 to show, but counts them all", () => {
    const big = { kind: "save", total: 400, pairs: Array.from({ length: 300 }, (_, i) => ({ i })) };
    const n = mergeDuplicates(big, { kind: "save", total: 50, pairs: [{ i: 301 }] });
    expect(n.total).toBe(450);
    expect(n.pairs).toHaveLength(300);
  });
  it("starts again when the kind changes", () => {
    const n = mergeDuplicates({ kind: "save", total: 4, pairs: [{}] }, { kind: "list", total: 1, items: [{ id: "a" }] });
    expect(n.kind).toBe("list");
    expect(n.total).toBe(1);
  });
});
