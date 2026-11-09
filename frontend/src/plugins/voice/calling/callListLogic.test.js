import { describe, expect, it } from "vitest";
import { bulkCallPrompt, countCalls, filterCalls, listDetails, outcomeKey, rowDetails, withView } from "./callListLogic";

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

describe("rowDetails", () => {
  it("counts only what the row holds", () => {
    const d = rowDetails({ company: "Acme Dental", contact: "Ann", email: "ann@acme.co.uk", website: "acme.co.uk" }, "01132345678");
    expect(d.pct).toBe(100);
    expect(d.missing).toEqual([]);
    const e = rowDetails({ company: "Acme Dental" }, "");
    expect(e.pct).toBe(20);
    expect(e.missing).toEqual(["phone", "contact name", "email", "website"]);
  });
  it("does not count a short, malformed or dead number, or an email without a domain", () => {
    expect(rowDetails({}, "12345").has.phone).toBe(false);
    expect(rowDetails({ check: { status: "not_working" } }, "01132345678").has.phone).toBe(false);
    expect(rowDetails({ check: { status: "good" } }, "01132345678").has.phone).toBe(true);
    expect(rowDetails({ email: "ann@" }, "").has.email).toBe(false);
  });
});

describe("listDetails", () => {
  it("averages the rows and counts working phones and full rows", () => {
    const rows = [
      { company: "A", contact: "Ann", email: "a@a.com", website: "a.com", phone: "01132345678" },
      { company: "B", phone: "" },
    ];
    expect(listDetails(rows)).toEqual({ pct: 60, phones: 1, full: 1 });
    expect(listDetails([])).toEqual({ pct: 0, phones: 0, full: 0 });
  });
});

describe("bulkCallPrompt", () => {
  it("names the count, the pace and the price", () => {
    expect(bulkCallPrompt({ count: 1200, cap: 2, perMinute: 1, balance: 3400 }))
      .toBe("Call 1,200 contacts, 2 at a time?\nCalls cost 1 credit a minute.\nYou have 3,400 Voice credits.");
  });
  it("still describes the price when the wallet could not be read", () => {
    expect(bulkCallPrompt({ count: 3 })).toBe("Call 3 contacts, 1 at a time?\nCalls are paid by the minute from your Voice credits.");
  });
  it("leaves the price out when calls are not charged", () => {
    expect(bulkCallPrompt({ count: 2, perMinute: 0, balance: 10 })).toBe("Call 2 contacts, 1 at a time?\nYou have 10 Voice credits.");
  });
});
