import { describe, expect, it } from "vitest";
import { addedText, blankStep, blockers, headline, moveStep, opensNote, planWords, rateText, resultsBar, stepLine, stepTable, stepsForSave, waitText, withTag } from "./journeyLogic";

describe("what a journey's steps say", () => {
  it("describes the wait before each step", () => {
    expect(waitText({}, 0)).toBe("First step");
    expect(waitText({ delay_days: 3 }, 1)).toBe("After 3 days");
    expect(waitText({ delay_days: 1, delay_hours: 2 }, 2)).toBe("After 1 day 2 hours");
    expect(waitText({}, 1)).toBe("Straight after");
  });

  it("gives each kind of step one plain line", () => {
    expect(stepLine({ channel: "email", subject: "Hello" })).toBe("Hello");
    expect(stepLine({ channel: "email", subject: "" })).toBe("Follow-up in the same thread");
    expect(stepLine({ channel: "call", goal: "Ask one question" })).toBe("Call: Ask one question");
    expect(stepLine({ channel: "task", title: "Look at their site" })).toBe("Look at their site");
    expect(stepLine({ channel: "linkedin_task", title: "" })).toBe("LinkedIn task");
  });
});

describe("the numbers under a journey's name", () => {
  it("says only what is not zero", () => {
    expect(headline({ people: 40, in_progress: 34, by_status: { replied: 5, booked: 0 } }, 2)).toBe("34 in progress · 5 replied · 2 tasks for you");
    expect(headline({ people: 0, in_progress: 0, by_status: {} }, 0)).toBe("Nobody in it yet");
    expect(headline({ people: 8, in_progress: 0, by_status: {} }, 1)).toBe("1 task for you");
  });
});

describe("editing steps", () => {
  it("moving a step down keeps the first one without a wait and gives the one pushed back a wait", () => {
    const steps = [{ channel: "email", delay_days: 0 }, { channel: "email", delay_days: 3 }];
    const moved = moveStep(steps, 1, -1);
    expect(moved[0].delay_days).toBe(0);
    expect(moved[1].delay_days).toBe(2);
    expect(moveStep(steps, 0, -1)).toBe(steps);
  });

  it("a new step gets a sensible wait and the fields its kind needs", () => {
    expect(blankStep("email", 0).delay_days).toBe(0);
    expect(blankStep("email", 2).delay_days).toBe(2);
    expect(blankStep("task", 2).delay_days).toBe(1);
    expect(blankStep("call", 1).condition).toBe("no_reply");
  });

  it("sends the server only what it reads and keeps each step's key", () => {
    const [s] = stepsForSave([{ key: "sk_1", channel: "call", delay_days: "2", extra: "ignored", retries: "1" }]);
    expect(s.key).toBe("sk_1");
    expect(s.delay_days).toBe(2);
    expect(s.retries).toBe(1);
    expect("extra" in s).toBe(false);
  });
});

describe("before starting", () => {
  it("lists only what must be fixed", () => {
    expect(blockers([{ level: "red", text: "a" }, { level: "amber", text: "b" }, { level: "green", text: "c" }]).map((b) => b.text)).toEqual(["a"]);
    expect(blockers(undefined)).toEqual([]);
  });

  it("says what adding people did and why some were left out", () => {
    expect(addedText({ added: 12, skipped: { duplicate: 2, invalid: 1, do_not_email: 0 } })).toBe("Added 12. Skipped: 2 already in, 1 without a valid email.");
    expect(addedText({ added: 3, dry_run: true, skipped: {} })).toBe("Would add 3.");
  });
});

describe("people kept out and queued", () => {
  it("says who was left out and that a draft waits for Start", () => {
    const text = addedText({ added: 4, queued: true, excluded_total: 1, skipped: { problem: 1 }, plan: { email: 2, quick_choice: 1, reach_other_way: 1 } });
    expect(text).toContain("1 left out: 1 closed or wrong company number.");
    expect(text).toContain("2 get email, 1 needs a quick choice, 1 is reached another way.");
    expect(text).not.toMatch(/own risk|breach/);
    expect(text).toContain("They start when you press Start.");
  });
  it("puts what happens to everyone in plain words, singular and plural", () => {
    expect(planWords({ email: 186, quick_choice: 9, reach_other_way: 5 })).toBe("186 get email, 9 need a quick choice, 5 are reached another way");
    expect(planWords({ email: 1 })).toBe("1 gets email");
    expect(addedText({ added: 3, plan: { email: 3 }, skipped: {} })).toBe("Added 3.");
  });
  it("counts a draft's people as queued and uses the singular", () => {
    expect(headline({ in_progress: 4, by_status: {} }, 0, "draft")).toBe("4 queued");
    expect(headline({ people: 1, in_progress: 0, by_status: {} })).toBe("1 person");
  });
});

describe("results bar", () => {
  it("shows seven numbers in order and treats missing ones as zero", () => {
    const bar = resultsBar({ sent: 10, delivered: 9, opened: 4, replied: 2, bounced: 1, opted_out: 1 });
    expect(bar.map((b) => b.label)).toEqual(["Sent", "Delivered", "Opened", "Replied", "Booked", "Bounced", "Opted out"]);
    expect(bar.find((b) => b.key === "booked").value).toBe(0);
    expect(bar.find((b) => b.key === "delivered").value).toBe(9);
  });
  it("explains opens by whether tracking is on", () => {
    expect(opensNote({ opens_tracked: false })).toContain("open tracking is off in Settings");
    expect(opensNote({ opens_tracked: true })).toBe("Opens are a minimum; some mail apps hide them.");
  });
  it("formats rates and inserts a tag once", () => {
    expect(rateText(33.3)).toBe("33.3%");
    expect(rateText(null)).toBe("-");
    expect(withTag("Hi", "{{source_line}}")).toBe("Hi\n\n{{source_line}}");
    expect(withTag("Hi {{source_line}}", "{{source_line}}")).toBe("Hi {{source_line}}");
  });
  it("keeps email steps in the table", () => {
    expect(stepTable({ by_step: [{ channel: "email", sent: 0 }, { channel: "call", sent: 0 }] })).toHaveLength(1);
  });
});
