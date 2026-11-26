import { describe, expect, it } from "vitest";
import { DRAFT_EVENT, sendDraft, takePendingDraft } from "./draftHandoff";
import { draftTitle } from "../plugins/leadgen/find/findLogic";

describe("handing a search to Find Leads", () => {
  it("waits for Leads to start, and tells an open Leads screen at once", () => {
    const hadWindow = "window" in globalThis;
    if (!hadWindow) globalThis.window = new EventTarget(); // the tests run without a browser
    const heard = [];
    const listen = () => heard.push(takePendingDraft());
    window.addEventListener(DRAFT_EVENT, listen);
    try {
      sendDraft({ filters: { sic_codes: ["69201"] }, meta: { sample: true } });
    } finally {
      window.removeEventListener(DRAFT_EVENT, listen);
    }
    expect(heard).toEqual([{ filters: { sic_codes: ["69201"] }, meta: { sample: true } }]);
    expect(takePendingDraft()).toBe(null); // taken once
    sendDraft({ filters: { towns: ["Leeds"] } }); // nobody listening: it waits
    expect(takePendingDraft()).toEqual({ filters: { towns: ["Leeds"] } });
    if (!hadWindow) delete globalThis.window;
  });

  it("says where the search came from", () => {
    expect(draftTitle({ asked: 20 })).toBe("Draft from the AI assistant");
    expect(draftTitle({ sample: true })).toMatch(/^A sample search/);
    expect(draftTitle({ own: true })).toMatch(/^Your ideal customers/);
  });
});
