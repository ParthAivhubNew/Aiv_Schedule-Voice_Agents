import { describe, expect, it } from "vitest";
import { approvalBatch, approvalQuestion } from "./approveAll";

const NOW = 1_000_000_000;
const due = { soon: NOW - 1000, later: NOW + 3_600_000 };
const posts = [
  { id: "a", status: "draft", when: "later" },
  { id: "b", status: "draft", when: "soon" },
  { id: "c", status: "draft", when: "later", tooLong: true },
  { id: "d", status: "scheduled", when: "later" },
  { id: "e", status: "failed", when: "soon" },
  { id: "f", when: "later" },
];
const opts = { isBlocked: (p) => !!p.tooLong, dueMs: (p) => due[p.when], nowMs: NOW };

describe("approvalBatch", () => {
  it("takes only drafts, and leaves out the ones the single button refuses", () => {
    const b = approvalBatch(posts, opts);
    expect(b.ready.map((p) => p.id)).toEqual(["a", "b", "f"]);
    expect(b.skipped).toBe(1);
    expect(b.goNow).toBe(1);
  });

  it("handles no posts", () => {
    expect(approvalBatch([], opts)).toEqual({ ready: [], skipped: 0, goNow: 0 });
  });
});

describe("approvalQuestion", () => {
  it("states the count, what goes out now, what is left out and test mode", () => {
    const q = approvalQuestion(approvalBatch(posts, opts), true);
    expect(q).toContain("Approve 3 drafts?");
    expect(q).toContain("1 go out now");
    expect(q).toContain("1 draft left out");
    expect(q).toContain("Test mode is on");
  });

  it("says set times when nothing is due", () => {
    const q = approvalQuestion(approvalBatch([posts[0]], opts));
    expect(q).toBe("Approve 1 draft? It goes out at its set time.");
  });
});
