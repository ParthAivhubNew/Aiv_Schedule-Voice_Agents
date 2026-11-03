import { describe, expect, it } from "vitest";
import { dockText, orderCards, sureWord } from "./jobDockLogic";

describe("dock text", () => {
  it("shows progress and the number waiting while a check runs", () => {
    expect(dockText({ status: "running", done: 40, total: 200 }, 3)).toBe("Checking 40 of 200 · 3 need you");
    expect(dockText({ status: "running", done: 40, total: 200, pause: true }, 0)).toBe("Paused at 40 of 200");
  });
  it("stays while picks are waiting after the job ends, and goes when nothing is left", () => {
    expect(dockText({ status: "done", done: 200, total: 200 }, 1)).toBe("Done · 1 needs you");
    expect(dockText({ status: "done", done: 200, total: 200 }, 0)).toBe("");
    expect(dockText(null, 0)).toBe("");
  });
});

describe("other jobs", () => {
  const post = { id: "social_posts", title: "Writing posts", done: 3, total: 10 };
  it("shows a Social or Voice job on its own, and counts several", () => {
    expect(dockText(null, 0, [post])).toBe("Writing posts 3 of 10");
    expect(dockText(null, 0, [post, { ...post, id: "x" }])).toBe("2 jobs running");
  });
  it("adds them to a running check", () => {
    expect(dockText({ status: "running", done: 4, total: 9 }, 0, [post])).toBe("Checking 4 of 9 · +1 more");
  });
});

describe("cards", () => {
  const cards = [{ account_id: "a", field: "phone" }, { account_id: "b", field: "email", skipped: true }, { account_id: "c", field: "phone" }];
  it("puts skipped cards last", () => {
    expect(orderCards(cards).map((c) => c.account_id)).toEqual(["a", "c", "b"]);
    expect(orderCards(cards, ["a:phone"]).map((c) => c.account_id)).toEqual(["c", "a", "b"]);
  });
  it("names the first option the best guess, in words", () => {
    expect(sureWord(0)).toBe("Best guess");
    expect(sureWord(2)).toBe("Also found");
  });
});
