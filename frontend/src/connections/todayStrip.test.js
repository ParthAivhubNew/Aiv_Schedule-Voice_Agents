import { describe, expect, it } from "vitest";
import { todayTiles } from "./todayStrip";

const full = { replies_waiting: 2, approvals_waiting: 1, meetings_this_week: 3, bounce_rate_7d: 0.016, credits_used_7d: 40, credits_left: 960, links: { replies: "#/leadgen/mail", credits: "#/leadgen/subscription" } };

describe("Today strip", () => {
  it("shows five tiles with plain labels", () => {
    const t = todayTiles(full);
    expect(t.map((x) => x.key)).toEqual(["replies", "approvals", "meetings", "bounces", "credits"]);
    expect(t[0]).toMatchObject({ value: "2", label: "replies waiting", href: "#/leadgen/mail" });
    expect(t[1].label).toBe("email to approve");
  });
  it("turns the bounce tile amber from 1.5%", () => {
    expect(todayTiles({ ...full, bounce_rate_7d: 0.014 }).find((x) => x.key === "bounces").warn).toBe(false);
    const hot = todayTiles(full).find((x) => x.key === "bounces");
    expect(hot).toMatchObject({ warn: true, value: "1.6%", note: "Above 2% we pause sending from that mailbox." });
  });
  it("leaves out what the server did not send", () => {
    expect(todayTiles({ credits_left: 5, credits_used_7d: 0 }).map((x) => x.key)).toEqual(["credits"]);
    expect(todayTiles(null)).toEqual([]);
  });
});
