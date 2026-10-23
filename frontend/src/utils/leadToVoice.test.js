import { beforeEach, describe, expect, it } from "vitest";
import { buildCallList, declineOffer, forgetDeclined, getOpenList, justHandedOff, setOpenList, stageCallList, takeCallList, wasDeclined } from "./leadToVoice";

describe("saying no to bringing a list across", () => {
  beforeEach(() => forgetDeclined());

  it("is remembered for that list only, in that direction", () => {
    const list = { name: "Plumbers", count: 40 };
    expect(wasDeclined("voice", "leadgen", list)).toBe(false);
    declineOffer("voice", "leadgen", list);
    expect(wasDeclined("voice", "leadgen", list)).toBe(true);
    expect(wasDeclined("leadgen", "voice", list)).toBe(false); // the other direction is a separate question
    expect(wasDeclined("voice", "leadgen", { name: "Plumbers", count: 41 })).toBe(false); // the list changed: ask again
    expect(wasDeclined("voice", "leadgen", { name: "Roofers", count: 40 })).toBe(false);
  });

  it("does not touch the list that stays where it is", () => {
    const list = { name: "Plumbers", count: 40, leadIds: ["a"] };
    setOpenList("voice", list);
    declineOffer("voice", "leadgen", list);
    expect(getOpenList("voice")).toBe(list);
    setOpenList("voice", null);
  });
});

describe("what goes across when they say yes", () => {
  it("takes only companies with a phone number the server allows, and counts the rest", () => {
    const accounts = [{ id: "1", name: "A" }, { id: "2", name: "B" }, { id: "3", name: "C" }];
    const phone = (a) => ({ text: a.id === "3" ? "" : `070${a.id}` });
    const out = buildCallList("L", accounts, phone, () => null, () => null, ["1"]);
    expect(out.records.map((r) => r["Lead ID"])).toEqual(["1"]);
    expect(out.skipped).toBe(2);
  });
});

describe("a list sent across on purpose is not asked about again", () => {
  const store = {};
  beforeEach(() => {
    globalThis.localStorage = { setItem: (k, v) => { store[k] = v; }, getItem: (k) => store[k] ?? null, removeItem: (k) => { delete store[k]; } };
    globalThis.window = { dispatchEvent: () => true };
    globalThis.CustomEvent = class { constructor(type) { this.type = type; } };
  });

  it("knows a hand-off just happened, and keeps the staged list for Voice to take once", () => {
    expect(justHandedOff()).toBe(false);
    expect(stageCallList({ name: "Plumbers", headers: ["Company name", "Phone"], records: [{ "Company name": "A", Phone: "0701" }], skipped: 1 })).toBe(true);
    expect(justHandedOff()).toBe(true);
    const got = takeCallList();
    expect(got.name).toBe("Plumbers");
    expect(takeCallList()).toBe(null);
  });
});
