import { describe, expect, it } from "vitest";
import {
  ACTION_WORDS, KIND_FILTERS, STAGE_TIPS, actionTip, addedMessage, bookingState, callState, emailState, filterFor,
  journeyLine, journeyOption, kindCount, pillText, scoreBand, withFind,
} from "./activityLogic";

const voiceOn = { available: true, loading: false };

describe("call state", () => {
  it("is ready with a phone and Voice", () => {
    expect(callState({ lead: { can_call: true }, phone: "0123", voice: voiceOn }).ok).toBe(true);
  });
  it("says why it is off, in the order that matters", () => {
    expect(callState({ lead: { stage: "do_not_contact" }, phone: "0123", voice: voiceOn }).reason).toBe("On your do-not-contact list.");
    expect(callState({ lead: { blocked_reason: "no_phone" }, voice: voiceOn }).reason).toBe("No phone number yet.");
    expect(callState({ lead: {}, phone: "", voice: voiceOn }).reason).toBe("No phone number yet.");
    expect(callState({ lead: { blocked_reason: "failed_check" }, phone: "1", voice: voiceOn }).reason).toBe("The phone number failed the check.");
    const plan = callState({ lead: { can_call: true }, phone: "1", voice: { available: false } });
    expect(plan).toMatchObject({ ok: false, reason: "Add Voice to your plan to call.", plan: true });
  });
  it("points a missing phone to where this screen finds one", () => {
    const s = withFind(callState({ lead: {}, voice: voiceOn }), { text: "Find one on the Overview tab.", tab: "overview" });
    expect(s).toMatchObject({ fix: "Find one on the Overview tab.", fixTab: "overview" });
    const plan = withFind(callState({ lead: { can_call: true }, phone: "1", voice: {} }), { text: "x", tab: "y" });
    expect(plan.fix).toBe("");
  });
});

describe("email and booking states", () => {
  it("needs an address and no do-not-contact", () => {
    expect(emailState({ email: "a@b.co" }).ok).toBe(true);
    expect(emailState({ email: " " }).reason).toBe("No email address yet.");
    expect(emailState({ lead: { stage: "do_not_contact" }, email: "a@b.co" }).ok).toBe(false);
  });
  it("booking needs Voice", () => {
    expect(bookingState({ booking: { available: true } }).ok).toBe(true);
    expect(bookingState({ booking: { available: false } })).toMatchObject({ ok: false, plan: true });
  });
});

describe("tooltips never repeat the label", () => {
  it("action tips say what happens, or why it is off and the fix", () => {
    for (const [key, w] of Object.entries(ACTION_WORDS)) {
      const tip = actionTip(key, { ok: true });
      expect(tip).not.toBe(w.label);
      expect(tip.split(" ").length).toBeGreaterThan(5);
    }
    expect(actionTip("email", withFind(emailState({ email: "" }), { text: "Use Check & improve." }))).toBe("No email address yet. Use Check & improve.");
  });
  it("every filter says what shows there and how to make one", () => {
    for (const f of KIND_FILTERS) {
      expect(f.tip.toLowerCase()).not.toBe(`show only ${f.label.toLowerCase()}`);
      expect(f.tip.length).toBeGreaterThan(f.label.length + 20);
      expect(f.empty).toMatch(/\.$/);
    }
    expect(filterFor("call").tip).toMatch(/Start one with Call above/);
    expect(filterFor("email").tip).toMatch(/Write an email above/);
    expect(filterFor("nonsense").kind).toBe("");
  });
  it("every stage has a meaning", () => {
    ["new", "contacted", "interested", "meeting", "won", "lost", "do_not_contact"].forEach((s) => expect(STAGE_TIPS[s]).toBeTruthy());
  });
});

describe("counts and score", () => {
  it("counts each kind and sums for All", () => {
    const counts = { call: 2, email: 3, note: 1 };
    expect(kindCount(counts, "call")).toBe(2);
    expect(kindCount(counts, "post")).toBe(0);
    expect(kindCount(counts, "")).toBe(6);
    expect(pillText("Calls", 0)).toBe("Calls 0");
  });
  it("puts the score in a band", () => {
    expect(scoreBand(13)).toBe("low");
    expect(scoreBand(30)).toBe("medium");
    expect(scoreBand(60)).toBe("high");
  });
});

describe("journey words", () => {
  it("says where the company is", () => {
    expect(journeyLine(null)).toBe("Not in a journey yet");
    expect(journeyLine({ name: "Intro", status: "running", person_status: "active", step: 2, steps_total: 4 })).toBe("In journey: Intro · step 2 of 4");
    expect(journeyLine({ name: "Intro", status: "draft", person_status: "active", step: 1 })).toBe("In journey: Intro · step 1, journey not started");
    expect(journeyLine({ name: "Intro", status: "running", person_status: "replied" })).toBe("In journey: Intro · replied");
  });
  it("lists steps and status for the menu", () => {
    expect(journeyOption({ step_count: 3, status: "running" })).toBe("3 steps · running");
    expect(journeyOption({ step_count: 1, status: "draft" })).toBe("1 step · not started");
  });
  it("says what happens after adding", () => {
    expect(addedMessage("Acme", { journey: "Intro", status: "running" })).toBe("Added Acme to Intro. Step 1 goes out at the journey's next sending time.");
    expect(addedMessage("Acme", { journey: "Intro", status: "draft" })).toMatch(/Nothing is sent until you start the journey/);
  });
});
