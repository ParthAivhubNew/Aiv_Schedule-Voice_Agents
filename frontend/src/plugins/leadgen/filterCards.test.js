import { describe, expect, it } from "vitest";
import { PINNED_FILTERS, buildFilterCards } from "./FilterCards.jsx";

const items = [{ s: "ready" }, { s: "ready" }, { s: "fixes" }, { s: "warm" }];
const is = (s) => (a) => a.s === s;
const filters = [
  ["all", "All", () => true, "Every company"],
  ["new", "New data found", is("new"), ""],
  ["ready", "Ready to email", is("ready"), "Has an email"],
  ["fixes", "Fixes to review", is("fixes"), ""],
  ["attention", "Needs attention", is("attention"), ""],
  ["flagged", "Import warnings", is("flagged"), ""],
  ["noemail", "No email found", is("noemail"), ""],
  ["h_never", "Never called", is("never"), ""],
  ["h_warm", "Warm", is("warm"), "Engaged"],
  ["h_interested", "Interested", is("interested"), ""],
];

describe("buildFilterCards", () => {
  it("puts the eight pinned cards first in their set order, even at zero", () => {
    const cards = buildFilterCards(items, filters);
    expect(cards.slice(0, 8).map((c) => c.id)).toEqual(PINNED_FILTERS);
    expect(cards.find((c) => c.id === "attention").count).toBe(0);
  });

  it("counts each filter and keeps the tip", () => {
    const cards = buildFilterCards(items, filters);
    expect(cards[0]).toMatchObject({ id: "all", label: "All", count: 4, tip: "Every company" });
    expect(cards.find((c) => c.id === "ready").count).toBe(2);
  });

  it("adds other filters after the pinned ones only when a company matches", () => {
    const ids = buildFilterCards(items, filters).map((c) => c.id);
    expect(ids.slice(8)).toEqual(["h_warm"]);
  });

  it("gives every card a tone", () => {
    for (const c of buildFilterCards(items, [...filters, ["v_other", "Other", () => true]])) expect(c.tone).toBeTruthy();
  });
});
