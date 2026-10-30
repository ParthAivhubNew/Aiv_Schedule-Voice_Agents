import { describe, expect, it } from "vitest";
import { blankAction, blankWorkflow, problem, summary } from "./workflowModel";

const meta = {
  event_info: { "call.completed": { label: "A call finished", hint: "When a call ends", lead: true, outcomes: ["no_answer"] }, "post.published": { label: "A post went live", hint: "When a post goes live", lead: false, outcomes: [] } },
  actions: { set_stage: "Move the lead to a stage", follow_up: "Plan a follow-up for the lead", webhook: "Send the details to my own web address (webhook)", notify: "Send me a notification" },
  condition_fields: { stage: { label: "Stage", ops: ["is", "is_not"], values: ["new", "won"] } },
};
const ok = (over = {}) => ({ ...blankWorkflow(), name: "Callback", do: [{ type: "action", action: "set_stage", value: "won" }], ...over });

describe("problem", () => {
  it("says what is missing, in the order the person fills it in", () => {
    expect(problem(blankWorkflow(), meta)).toBe("Give the workflow a name.");
    expect(problem(ok({ do: [blankAction()] }), meta)).toBe("step 1: fill it in.");
    expect(problem(ok({ conditions: [{ field: "stage", op: "is", value: "" }] }), meta)).toBe("Finish the filter, or remove it.");
    expect(problem(ok({ do: [{ type: "action", action: "set_stage", value: "" }] }), meta)).toBe("step 1: choose a stage.");
    expect(problem(ok({ do: [{ type: "action", action: "webhook", value: "ftp://x" }] }), meta)).toBe("step 1: the web address must start with https://.");
    expect(problem(ok({ do: [{ type: "wait", hours: 0 }] }), meta)).toBe("step 1: wait between 1 hour and 30 days.");
  });

  it("looks inside an if, and names the path", () => {
    const flow = { type: "if", cond: { field: "stage", op: "is", value: "new" }, then: [{ type: "action", action: "follow_up", value: "" }], else: [] };
    expect(problem(ok({ do: [flow] }), meta)).toBe("step 1, yes: step 1: fill it in.");
    expect(problem(ok({ do: [{ ...flow, then: [], else: [] }] }), meta)).toBe("step 1: add something to do under the if.");
  });

  it("accepts a finished workflow", () => {
    expect(problem(ok(), meta)).toBe("");
    expect(problem(ok({ do: [{ type: "action", action: "webhook", value: "https://hooks.example.com/in" }, { type: "wait", hours: 48 }, { type: "stop" }] }), meta)).toBe("");
  });
});

describe("summary", () => {
  it("reads as one line: when, the result, then each block", () => {
    const w = ok({ when: { outcome: "no_answer" }, do: [{ type: "action", action: "follow_up", value: "x", days: 2 }, { type: "wait", hours: 48 }, { type: "if", cond: { field: "stage", op: "is", value: "new" }, then: [], else: [] }] });
    expect(summary(w, meta)).toBe("When a call ends: no answer → Plan a follow-up for the lead, then Wait 2 days, then If stage is new");
  });
});
