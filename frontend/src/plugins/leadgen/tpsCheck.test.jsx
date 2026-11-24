import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/apiClient", () => ({ api: { tpsEstimate: vi.fn(), tpsRun: vi.fn() } }));

import { api } from "../../api/apiClient";
import { TpsBadge, TpsEstimateView, TpsResultsView } from "./TpsCheckDialog";
import { chunkNumbers, estimateTps, runTpsChecks, tpsKey, uniqueNumbers } from "./tpsCheck";

const html = (el) => renderToStaticMarkup(el);
const est = (o) => ({ ready: true, rows: [], to_check: 3, credits: 2, balance: 10, enforced: true, ...o });

beforeEach(() => { api.tpsEstimate.mockReset(); api.tpsRun.mockReset(); });

describe("estimate view", () => {
  it("says checking is not switched on", () => {
    expect(html(<TpsEstimateView est={est({ ready: false })} total={5} />)).toContain("TPS and CTPS checking is not switched on yet. Ask your administrator.");
  });
  it("shows counts, cost and balance", () => {
    const out = html(<TpsEstimateView est={est()} total={10} />);
    expect(out).toContain("3 numbers to check, 7 already checked, cost 2 credits.");
    expect(out).toContain("You have 10 credits.");
    expect(out).toContain("free");
  });
  it("warns when credits are too low", () => {
    expect(html(<TpsEstimateView est={est({ credits: 20, balance: 1 })} total={10} />)).toContain("Plan &amp; credits");
    expect(html(<TpsEstimateView est={est({ credits: 20, balance: 1, enforced: false })} total={10} />)).not.toContain("Plan &amp; credits");
  });
});

describe("results and badge", () => {
  const rows = [
    { number: "+447700900001", status: "listed", ctps: false, checked_at: "2026-11-20T10:00:00Z" },
    { number: "+447700900002", status: "listed", ctps: true, checked_at: null },
    { number: "+447700900003", status: "clear", ctps: false, checked_at: null },
    { number: "+33123456789", status: "not_uk", ctps: false, checked_at: null },
    { number: "+447700900004", status: "unknown", ctps: false, checked_at: null },
  ];
  it("uses the plain labels", () => {
    const out = html(<TpsResultsView rows={rows} charged={2} note="" />);
    for (const w of ["On TPS", "On CTPS", "Clear", "Not a UK number", "Couldn&#x27;t check", "2 credits charged"]) expect(out).toContain(w);
  });
  it("badge has a text label and the 28 day tooltip", () => {
    const out = html(<TpsBadge status="clear" ctps={false} checkedAt="2026-11-20T10:00:00Z" />);
    expect(out).toContain("Clear");
    expect(out).toContain("Checked against the TPS and CTPS registers on 20 Nov 2026. A result lasts 28 days.");
    expect(html(<TpsBadge />)).toContain("Not screened");
  });
});

describe("running", () => {
  it("splits into chunks of 500 and reports progress", async () => {
    const numbers = Array.from({ length: 1200 }, (_, i) => `+4477009${String(10000 + i)}`);
    api.tpsRun.mockImplementation(async (part) => ({ rows: part.map((n) => ({ number: n, status: "clear", ctps: false })), credits_charged: 1, note: "" }));
    const seen = [];
    const out = await runTpsChecks(numbers, "voice", (d, t) => seen.push([d, t]));
    expect(api.tpsRun.mock.calls.map((c) => c[0].length)).toEqual([500, 500, 200]);
    expect(api.tpsRun.mock.calls[0][1]).toBe("voice");
    expect(out.rows).toHaveLength(1200);
    expect(out.charged).toBe(3);
    expect(seen).toContainEqual([500, 1200]);
  });
  it("keeps finished batches when one fails", async () => {
    api.tpsRun.mockResolvedValueOnce({ rows: [{ number: "+441", status: "clear" }], credits_charged: 1 }).mockRejectedValueOnce(new Error("Not enough credits"));
    const out = await runTpsChecks(Array.from({ length: 600 }, (_, i) => `07700${100000 + i}`), "leadgen");
    expect(out.rows).toHaveLength(1);
    expect(out.error).toBe("Not enough credits");
  });
  it("adds up estimates across batches", async () => {
    api.tpsEstimate.mockResolvedValue(est({ to_check: 500, credits: 200 }));
    const total = await estimateTps(Array.from({ length: 700 }, (_, i) => `07700${100000 + i}`), "leadgen");
    expect(total.to_check).toBe(1000);
    expect(total.credits).toBe(400);
  });
  it("matches numbers written differently", () => {
    expect(tpsKey("07700 900001")).toBe(tpsKey("+44 7700 900001"));
    expect(uniqueNumbers(["07700 900001", "+447700900001", ""])).toHaveLength(1);
    expect(chunkNumbers([1, 2, 3], 2)).toEqual([[1, 2], [3]]);
  });
});

describe("wiring", () => {
  const read = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
  it("Leads has the bulk action with the leadgen wallet", () => {
    const s = read("./AccountsViews.jsx");
    expect(s).toContain("Check TPS/CTPS");
    expect(s).toContain('wallet="leadgen"');
  });
  it("Voice call list has the button with the voice wallet", () => {
    expect(read("../voice/calling/TpsCheckBar.jsx")).toContain('wallet="voice"');
    expect(read("../voice/calling/TpsCheckBar.jsx")).toContain("Check TPS/CTPS");
    expect(read("../voice/calling/CallingWorkspace.jsx")).toContain("<TpsCheckBar");
  });
});

describe("the screening sentence added to a company check", () => {
  it("says what happened, and nothing when nothing was needed", async () => {
    const { screeningNote } = await import("./tpsCheck");
    expect(screeningNote({ status: "done", screened: 2, credits: 1 })).toBe(" Phone numbers screened against TPS and CTPS: 1 credit used.");
    expect(screeningNote({ status: "done", screened: 0, credits: 0 })).toBe("");
    expect(screeningNote({ status: "nothing" })).toBe("");
    expect(screeningNote(undefined)).toBe("");
    expect(screeningNote({ status: "no_credits" })).toContain("not enough credits");
    expect(screeningNote({ status: "no_key" })).toContain("isn't switched on");
    expect(screeningNote({ status: "service" })).toContain("couldn't be reached");
  });
});
