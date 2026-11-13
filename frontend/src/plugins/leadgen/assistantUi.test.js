import { describe, expect, it } from "vitest";
import { choiceAction, compactCount, customizeText, filtersText, isHashScreen, liveChoices, questionFor, restoreChat, savedActs, savedMessage, viewCountText, viewFromFound, FEEDBACK_REASONS, LOST_NOTE } from "./assistantUi";
import { profileGaps, profileIsThin } from "./profileThin";
import { setPendingDraft, takePendingDraft } from "../../utils/draftHandoff";

describe("the draft card's numbers", () => {
  it("shortens big counts and leaves small ones exact", () => {
    expect(compactCount(0)).toBe("0");
    expect(compactCount(999)).toBe("999");
    expect(compactCount(1000)).toBe("1K");
    expect(compactCount(3162)).toBe("3.2K");
    expect(compactCount(12400)).toBe("12K");
    expect(compactCount(1250000)).toBe("1.3M");
  });

  it("says how many of the matches were asked for, and marks a capped count", () => {
    expect(viewCountText({ total: 3162 })).toBe("3.2K");
    expect(viewCountText({ total: 3162, asked: 200 })).toBe("200 of 3.2K");
    expect(viewCountText({ total: 150, asked: 200 })).toBe("150"); // asked for more than there is: no "of"
    expect(viewCountText({ total: 12000, capped: true })).toBe("12K+");
  });

  it("names the filters, and says nothing for none", () => {
    expect(filtersText(0)).toBe("");
    expect(filtersText(1)).toBe("1 filter");
    expect(filtersText(2)).toBe("2 filters");
  });

  it("still gives a search answer without a card from the server a card, and no card for no companies", () => {
    expect(viewFromFound({ total: 40, asked: 20 })).toMatchObject({ kind: "companies", total: 40, asked: 20, screen: "find_leads" });
    expect(viewFromFound({ total: 0 })).toBeNull();
    expect(viewFromFound(null)).toBeNull();
  });

  it("knows a hash screen from the results screen", () => {
    expect(isHashScreen("#/voice/logs")).toBe(true);
    expect(isHashScreen("find_leads")).toBe(false);
  });
});

describe("pick one", () => {
  it("sends the words, opens the card's screen, or opens a named screen", () => {
    expect(choiceAction({ prompt: "Only the ones with an email" })).toEqual({ type: "send", text: "Only the ones with an email" });
    expect(choiceAction({ open: "view" })).toEqual({ type: "view" });
    expect(choiceAction({ open: "#/voice/logs" })).toEqual({ type: "screen", hash: "#/voice/logs" });
    expect(choiceAction({ label: "x" })).toEqual({ type: "none" });
    expect(choiceAction(null)).toEqual({ type: "none" });
  });

  it("is live only on the newest answer, until one option is used, and never while answering", () => {
    const a = { id: "a1", role: "assistant", choices: [{ id: "open" }] };
    const msgs = [{ id: "u1", role: "user", text: "x" }, a];
    expect(liveChoices(msgs, {}, false)).toBe(a);
    expect(liveChoices(msgs, { "choice:a1": { state: "done" } }, false)).toBeNull();
    expect(liveChoices(msgs, {}, true)).toBeNull();
    expect(liveChoices([...msgs, { id: "u2", role: "user", text: "y" }], {}, false)).toBeNull(); // a newer message ends it
    expect(liveChoices([{ id: "a2", role: "assistant", choices: [] }], {}, false)).toBeNull();
  });
});

describe("thumbs", () => {
  it("finds the question an answer belongs to", () => {
    const msgs = [{ role: "user", text: "first" }, { role: "assistant", text: "a" }, { role: "user", text: "second" }, { role: "assistant", text: "b" }];
    expect(questionFor(msgs, 1)).toBe("first");
    expect(questionFor(msgs, 3)).toBe("second");
    expect(questionFor(msgs, 0)).toBe("");
  });

  it("offers the same reasons the server knows", () => {
    expect(FEEDBACK_REASONS.map((r) => r.id)).toEqual(["wrong_companies", "wrong_info", "missed_ask", "too_long", "other"]);
  });
});

describe("Customize your AI", () => {
  it("lists only the core facts that are missing, and never the optional ones", () => {
    expect(profileGaps({})).toEqual(["your company name", "what you sell", "who buys it", "your main offer"]);
    expect(profileGaps({ profile: { company: "Brew House", sells: "Coffee" } })).toEqual(["who buys it", "your main offer"]);
    expect(profileGaps({ edit: { company: "Brew House", sells: "Coffee", audience: "Offices", offer: "Free trial" } })).toEqual([]); // tone and website are optional
    expect(profileGaps({ profile: { company: "Brew House" }, services: 3 })).toEqual(["who buys it", "your main offer"]); // saved services count as what it sells
  });

  it("asks for at most two things, in one short sentence", () => {
    expect(customizeText([])).toBe("");
    expect(customizeText(["what you sell"])).toBe("Tell me what you sell so my answers fit your business.");
    expect(customizeText(["what you sell", "who buys it", "your main offer"])).toBe("Tell me what you sell and who buys it so my answers fit your business.");
  });

  it("still calls a profile thin by the same rule as before", () => {
    expect(profileIsThin({})).toBe(true);
    expect(profileGaps({ profile: { company: "A", sells: "B", audience: "C", offer: "D" } })).toEqual([]);
  });
});

describe("reopening an earlier chat", () => {
  const found = { total: 3162, capped: false, asked: 20, filters: { towns: ["leeds"], sectors: ["dentist"] }, top: Array.from({ length: 80 }, (_, i) => ({ id: `c${i}`, name: `Co ${i}` })) };
  const view = { kind: "companies", title: "Dentists in Leeds", summary: "", filter_count: 2, total: 3162, asked: 20, screen: "find_leads" };
  const proposal = { id: "p1", kind: "add_to_list", title: "Save 20 to a list", detail: "Free", params: { list_name: "Leeds dentists", how_many: 20 } };
  const live = [
    { id: "u1", role: "user", text: "dentists in Leeds" },
    { id: "a1", role: "assistant", text: "I found 3,162. A table of 20 is on screen.", found, view, proposals: [proposal], choices: [{ label: "Show all", open: "view" }], steps: [{ label: "Searched" }] },
  ];

  it("shows the same card, offers and pick-one the answer showed", () => {
    const saved = { id: "a_1", chat: live.map(savedMessage), filters: found.filters, acts: savedActs({ p1: { state: "done", text: "Saved 20." }, p2: { state: "running" } }), state: { last_total: 3162 } };
    const back = restoreChat(JSON.parse(JSON.stringify(saved)));
    const a = back.messages[1];
    expect(a.text).toBe("I found 3,162. A table of 20 is on screen.");
    expect(a.view).toEqual(view);
    expect(a.found.filters).toEqual(found.filters);
    expect(a.proposals).toEqual([proposal]);
    expect(a.choices).toHaveLength(1);
    expect(back.acts).toEqual({ p1: { state: "done", text: "Saved 20." } }); // a finished offer stays done; one still running is not kept
    expect(back.state).toEqual({ last_total: 3162 });
    expect(back.listed).toMatchObject({ total: 3162, asked: 20, filters: found.filters });
    expect(back.listed.top).toHaveLength(50);
  });

  it("a chat saved before cards were kept gets its last search's card back from the count", () => {
    const back = restoreChat({ filters: { towns: ["york"] }, chat: [{ id: "u1", role: "user", text: "cafes in York" }, { id: "a1", role: "assistant", text: "Here they are.", found: 48 }] });
    expect(back.messages[1].view).toMatchObject({ total: 48 });
    expect(back.messages[1].found.filters).toEqual({ towns: ["york"] });
  });

  it("never says something is on screen when nothing came back", () => {
    const back = restoreChat({ chat: [{ id: "u1", role: "user", text: "x" }, { id: "a1", role: "assistant", text: "Found 12 cafes. They are on screen now. Want me to save them?" }] });
    expect(back.messages[1].text).toBe(`Found 12 cafes. Want me to save them? ${LOST_NOTE}`);
    const lost = restoreChat({ chat: [{ id: "u1", role: "user", text: "x" }, { id: "a1", role: "assistant", text: "Here you go.", cards_lost: true }] });
    expect(lost.messages[1].text).toBe(`Here you go. ${LOST_NOTE}`);
    const plain = restoreChat({ chat: [{ id: "u1", role: "user", text: "x" }, { id: "a1", role: "assistant", text: "You have 3 lists." }] });
    expect(plain.messages[1].text).toBe("You have 3 lists.");
  });
});

describe("a draft opened from another plugin waits for Leads", () => {
  it("is handed over once and then gone", () => {
    setPendingDraft({ filters: { towns: ["leeds"] }, meta: { asked: 20 } });
    expect(takePendingDraft()).toEqual({ filters: { towns: ["leeds"] }, meta: { asked: 20 } });
    expect(takePendingDraft()).toBeNull();
    setPendingDraft("nonsense");
    expect(takePendingDraft()).toBeNull();
  });
});

describe("groupChats", () => {
  it("merges chats with the same title and groups them as Recent and Older", async () => {
    const { groupChats } = await import("./assistantUi");
    const now = new Date("2026-11-13T12:00:00Z").getTime();
    const chat = (id, title, at) => ({ id, title, at });
    const g = groupChats([chat("1", "Accountants in RG2", "2026-11-12T10:00:00Z"), chat("2", "accountants in rg2", "2026-11-11T10:00:00Z"), chat("3", "Plumbers", "2026-10-01T10:00:00Z")], now);
    expect(g.map(([k, rows]) => [k, rows.map((r) => [r.id, r.count])])).toEqual([["Recent", [["1", 2]]], ["Older", [["3", 1]]]]);
  });
});
