import { describe, expect, it } from "vitest";
import { countCalls, filterCalls, outcomeKey, withView } from "./callListLogic";

const row = (over) => ({ id: "r", company: "Acme Dental", phone: "01132345678", lastOutcome: "", callTimes: 0, ...over });

describe("outcomeKey", () => {
  it("reads the wording the call log uses, spaced or snake_case", () => {
    expect(outcomeKey(row())).toBe("not_called");
    expect(outcomeKey(row({ lastOutcome: "Meeting booked" }))).toBe("meeting");
    expect(outcomeKey(row({ lastOutcome: "no_answer" }))).toBe("no_answer");
    expect(outcomeKey(row({ lastOutcome: "Left a voicemail" }))).toBe("no_answer");
    expect(outcomeKey(row({ lastOutcome: "Not interested" }))).toBe("not_interested");
    expect(outcomeKey(row({ lastOutcome: "Interested" }))).toBe("interested");
    expect(outcomeKey(row({ lastOutcome: "Asked not to be called" }))).toBe("dnc");
    expect(outcomeKey(row({ lastOutcome: "Spoke with them" }))).toBe("spoke");
  });
});

describe("filterCalls", () => {
  const rows = [
    row({ id: "a", company: "Acme Dental", town: "Leeds" }),
    row({ id: "b", company: "Birch Vets", phone: "", lastOutcome: "no_answer" }),
    row({ id: "c", company: "Cedar Care", phone: "07700900123", lastOutcome: "Interested", callTimes: 2 }),
  ];
  it("filters by chip and by every word in the search", () => {
    expect(filterCalls(rows, { status: "interested" }).map((r) => r.id)).toEqual(["c"]);
    expect(filterCalls(rows, { status: "no_phone" }).map((r) => r.id)).toEqual(["b"]);
    expect(filterCalls(rows, { q: "dental leeds" }).map((r) => r.id)).toEqual(["a"]);
    expect(filterCalls(rows, { q: "0770 090" }).map((r) => r.id)).toEqual(["c"]);
    expect(filterCalls(rows, { q: "nothing here" })).toEqual([]);
  });
});

describe("countCalls", () => {
  it("counts the cards and each chip", () => {
    const rows = [row({ id: "a" }), row({ id: "b", phone: "", lastOutcome: "no_answer" }), row({ id: "c", lastOutcome: "Interested", callTimes: 1 }), row({ id: "d", lastOutcome: "Do not call" })];
    const c = countCalls(rows);
    expect(c.contacts).toBe(4);
    expect(c.ready).toBe(2); // a and c: b has no phone, d asked not to be called
    expect(c.called).toBe(3);
    expect(c.interested).toBe(1);
    expect(c.chips.no_phone).toBe(1);
    expect(c.chips.not_called).toBe(1);
  });
});

describe("withView", () => {
  it("replaces a view of the same name and ignores a blank one", () => {
    const v = withView([{ name: "Hot", status: "interested", q: "" }], { name: "hot", status: "meeting", q: "leeds" });
    expect(v).toEqual([{ name: "hot", status: "meeting", q: "leeds" }]);
    expect(withView(v, { name: "  " })).toBe(v);
  });
});
