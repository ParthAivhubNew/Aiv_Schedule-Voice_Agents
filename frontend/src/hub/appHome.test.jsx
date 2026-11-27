import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("../api/apiClient", () => ({ api: { getBillingOverview: () => Promise.resolve(null), getOnboarding: () => Promise.resolve(null), getToday: () => Promise.resolve(null) } }));

import { appStatus } from "./AppHome";

const plan = { name: "Starter" };
const from = { priceUsdCents: 19999, currency: "gbp" };

// Plan 13, step 5: Home says what's happening, and an app you haven't added is an offer, not a problem.
describe("what Home says about an app", () => {
  it("an app you have shows its credits, or its plan", () => {
    expect(appStatus({ plan, wallet: { balance: 550 } }, "credits")).toEqual({ text: "550 credits left", tone: "ink" });
    expect(appStatus({ plan, wallet: { balance: 20, low: true } }, "credits").tone).toBe("amber");
    expect(appStatus({ plan, wallet: { balance: 0 } }, "credits").text).toBe("Starter");
  });

  it("running out is amber with a way on, never red", () => {
    expect(appStatus({ plan, wallet: { balance: 0, empty: true } }, "credits")).toEqual({ text: "Out of credits: top up to carry on", tone: "amber" });
  });

  it("an app you haven't added never says Out of credits", () => {
    const s = appStatus({ wallet: { balance: 0, empty: true }, from, vat: " + VAT" }, "credits");
    expect(s.text).not.toMatch(/Out of credits/);
    expect(s.text).toMatch(/^From .*\/month \+ VAT$/);
    expect(s.tone).toBe("muted");
    expect(appStatus({ wallet: { balance: 50 }, from }, "credits")).toEqual({ text: "50 credits left to try it", tone: "muted" });
    expect(appStatus({ wallet: { balance: 0, empty: true } }, "credits").text).toBe("Not added yet");
    expect(appStatus({}, "credits")).toBeNull();
  });

  it("Home shows one next step, not the checklist, and no second help footer", () => {
    const src = readFileSync(new URL("./AppHome.jsx", import.meta.url), "utf8");
    expect(src).toContain("<NextStep");
    expect(src).not.toContain("<OnboardingChecklist");
    expect(src).not.toContain("Need help or looking for product guides?");
    expect(src).not.toContain("Manage plan");
    expect(src).not.toMatch(/C\.red/);
  });
});

import { homeActivity, homeSummary } from "./homeActivity";

describe("Home's live numbers", () => {
  const today = { replies_waiting: 3, approvals_waiting: 0, meetings_this_week: 2, calls_7d: 14, posts_to_approve: 1, posts_scheduled: 5, tasks_overdue: 1, tasks_today: 2,
    links: { replies: "#/leadgen/mail", posts_to_approve: "#/scheduler/plan", meetings: "#/voice/schedule", calls: "#/voice/logs" } };

  it("puts what needs someone first, four at most, from the server's numbers only", () => {
    const a = homeActivity(today);
    expect(a.tiles.map((t) => t.key)).toEqual(["replies_waiting", "posts_to_approve", "tasks", "meetings_this_week"]);
    expect(a.tiles[0]).toMatchObject({ value: "3", label: "replies waiting", href: "#/leadgen/mail", app: "leadgen" });
    expect(a.tiles[2].label).toBe("tasks due, 1 late");
    expect(a.waiting).toBe(7);
    expect(a.byApp.voice.map((t) => t.label)).toEqual(["meetings this week", "calls in the last 7 days"]);
    expect(a.byApp.scheduler.map((t) => t.label)).toEqual(["post to approve", "posts lined up"]);
  });

  it("leaves out what the server didn't send", () => {
    const a = homeActivity({ posts_to_approve: 0, posts_scheduled: 0, links: {} });
    expect(Object.keys(a.byApp)).toEqual(["scheduler"]);
    expect(homeActivity(null).tiles).toEqual([]);
  });

  it("says in one line how the day looks", () => {
    expect(homeSummary(homeActivity(today), true)).toBe("7 things need you today.");
    expect(homeSummary(homeActivity({ replies_waiting: 0, links: {} }), true)).toBe("You're all caught up. Nothing is waiting for you.");
    expect(homeSummary(homeActivity(null), false)).toBe("Pick an app to get started.");
  });
});
