import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../api/apiClient", () => ({ api: new Proxy({}, { get: () => () => new Promise(() => {}) }) }));

import { CandidateCard, Chip, ImportMatchView, RecordCard, ReviewQueue } from "./ImportMatch";
import { MonthlyChangesView, ReportCard } from "./MonthlyChanges";
import {
  canUseRecords, decisionMessage, formatScore, importChips, kindChips, kindLabel, periodLabel, progressPercent,
  reduceQueueAfterDecision, shouldIgnoreReviewKey, statusLabel, templateCsv, validatePercentThresholds, validateRange, validateThresholds,
} from "./importMatchLogic";

describe("labels", () => {
  it("names every change kind in plain words", () => {
    expect(kindLabel("status_changed")).toBe("Status changed");
    expect(kindLabel("officer_appointed")).toBe("Director appointed");
    expect(kindLabel("officer_resigned")).toBe("Director resigned");
    expect(kindLabel("gazette_notice")).toBe("Insolvency notice");
    expect(kindLabel("new_company")).toBe("New company");
    expect(kindLabel("odd_kind")).toBe("Odd kind");
  });
  it("names the match statuses", () => {
    expect(statusLabel("auto")).toBe("Matched automatically");
    expect(statusLabel("review")).toBe("Needs review");
    expect(statusLabel("none")).toBe("No match");
    expect(statusLabel("duplicate")).toBe("Duplicate");
  });
  it("lists only non-zero kinds, in a fixed order", () => {
    expect(kindChips({ officer_resigned: 2, status_changed: 5, name_changed: 0 }).map((c) => c.label)).toEqual(["Status changed", "Director resigned"]);
  });
  it("folds a person's decision into the automatic counts", () => {
    const chips = importChips({ auto: 3, accepted: 2, review: 4, none: 1, rejected: 1, duplicate: 7 });
    expect(chips.map((c) => c.count)).toEqual([5, 4, 2, 7]);
  });
});

describe("numbers and dates", () => {
  it("works out progress", () => {
    expect(progressPercent({ status: "matching", row_count: 200, stats: { processed: 50 } })).toBe(25);
    expect(progressPercent({ status: "done", row_count: 200, stats: {} })).toBe(100);
    expect(progressPercent({ status: "matching", row_count: 0, stats: {} })).toBe(0);
  });
  it("formats a score as a percentage", () => {
    expect(formatScore(0.846)).toBe("85%");
    expect(formatScore(1)).toBe("100%");
    expect(formatScore(null)).toBe("");
  });
  it("validates thresholds", () => {
    expect(validateThresholds(0.92, 0.7)).toBe("");
    expect(validateThresholds(0.7, 0.7)).not.toBe("");
    expect(validateThresholds(0.7, 0)).not.toBe("");
    expect(validateThresholds(1.2, 0.5)).not.toBe("");
    expect(validateThresholds("", 0.5)).not.toBe("");
    expect(validatePercentThresholds("92", "70")).toBe("");
    expect(validatePercentThresholds("60", "70")).not.toBe("");
  });
  it("validates a date range", () => {
    expect(validateRange("2026-01-01", "2026-01-31")).toBe("");
    expect(validateRange("2026-02-01", "2026-01-31")).not.toBe("");
    expect(validateRange("2026-01-01", "")).not.toBe("");
    expect(validateRange("2025-01-01", "2025-12-31")).toBe("");
    expect(validateRange("2025-01-01", "2026-01-02")).not.toBe("");
  });
  it("builds a header-only template", () => {
    expect(templateCsv()).toBe("Account ID,Account Name,Company Number,Billing Street,Billing City,Billing Postal Code,Phone,Website\r\n");
  });
  it("labels a month", () => { expect(periodLabel("2026-10")).toBe("October 2026"); });
  it("lets administrators and managers in only", () => {
    expect(canUseRecords({ is_admin: true })).toBe(true);
    expect(canUseRecords({ role: "Manager" })).toBe(true);
    expect(canUseRecords({ role: "Operator", roles: [{ name: "Manager" }] })).toBe(true);
    expect(canUseRecords({ role: "Operator", roles: [{ name: "Viewer" }] })).toBe(false);
    expect(canUseRecords(null)).toBe(false);
  });
  it("explains a clash and an unknown number", () => {
    expect(decisionMessage({ status: 409 })).toBe("Someone else already decided this.");
    expect(decisionMessage({ status: 400, message: "Not on the register" })).toBe("Not on the register");
  });
});

describe("screens", () => {
  it("draws Import & match with its two tabs", () => {
    const html = renderToStaticMarkup(<ImportMatchView operator={{ role: "Manager" }} toast={() => {}} />);
    expect(html).toContain("Imports");
    expect(html).toContain("Needs review");
  });
  it("draws the record and candidate cards", () => {
    const a = renderToStaticMarkup(<RecordCard fsb={{ name: "Acme Ltd", postcode: "AB1 2CD", phone: "0123" }} />);
    expect(a).toContain("Acme Ltd");
    expect(a).toContain("Your record");
    const b = renderToStaticMarkup(<CandidateCard cand={{ name: "ACME LIMITED", company_number: "01234567", status: "active", sic_text: "Retail" }} />);
    expect(b).toContain("01234567");
    expect(b).toContain("Industry (SIC)");
    expect(renderToStaticMarkup(<Chip tone="good">Done</Chip>)).toContain("Done");
  });
  it("draws a month card with its counts", () => {
    const html = renderToStaticMarkup(<ReportCard report={{ id: "r", period: "2026-10", summary: { text: "5 changes at 3 companies.", companies: 3, total: 5, by_kind: { status_changed: 5 } } }} onDownload={() => {}} />);
    expect(html).toContain("October 2026");
    expect(html).toContain("5 changes at 3 companies.");
    expect(html).toContain("Status changed: 5");
    expect(html).toContain("Download details");
  });
  it("draws Monthly changes while loading", () => {
    expect(() => renderToStaticMarkup(<MonthlyChangesView toast={() => {}} />)).not.toThrow();
  });
});

describe("ReviewQueue and review decisions", () => {
  it("draws skeleton when review queue is loading", () => {
    const html = renderToStaticMarkup(<ReviewQueue initialData={null} toast={() => {}} />);
    expect(html).toContain("Loading the review queue");
  });

  it("draws empty state for open queue with honest explanation", () => {
    const html = renderToStaticMarkup(<ReviewQueue initialData={{ total: 0, items: [] }} initialStatus="open" toast={() => {}} />);
    expect(html).toContain("Nothing waiting for review");
    expect(html).toContain("Records we are not sure about appear here after an import.");
    expect(html).toContain("0 to review");
  });

  it("draws empty state for decided queue with honest explanation", () => {
    const html = renderToStaticMarkup(<ReviewQueue initialData={{ total: 0, items: [] }} initialStatus="decided" toast={() => {}} />);
    expect(html).toContain("No records here");
    expect(html).toContain("Decisions appear here once someone has made them.");
    expect(html).toContain("0 records");
  });

  it("draws record vs candidate card with score, reason and action buttons", () => {
    const sample = {
      id: "fsr_1",
      match_status: "review",
      score: 0.88,
      reason: "Name and address match register with high confidence.",
      fsb: { name: "Acme Digital Consulting", address: "10 St James Street", postcode: "BN1 1AB", phone: "01273 555010" },
      candidate: { name: "ACME DIGITAL CONSULTING LIMITED", company_number: "08991234", company_status: "active", sic_text: "62020 - IT consulting" },
    };
    const html = renderToStaticMarkup(<ReviewQueue initialData={{ total: 1, items: [sample] }} toast={() => {}} />);
    expect(html).toContain("Acme Digital Consulting");
    expect(html).toContain("ACME DIGITAL CONSULTING LIMITED");
    expect(html).toContain("08991234");
    expect(html).toContain("Confidence 88%.");
    expect(html).toContain("Name and address match register with high confidence.");
    expect(html).toContain("Yes, same company");
    expect(html).toContain("No match");
    expect(html).toContain("Pick another");
    expect(html).toContain("Keyboard: Y for yes, N for no match.");
  });

  it("shows candidate selection chips when multiple candidates exist", () => {
    const multi = {
      id: "fsr_2",
      match_status: "review",
      score: 0.88,
      reason: "Two plausible company matches found.",
      fsb: { name: "Acme Digital", postcode: "BN1 1AB" },
      candidates: [
        { company_number: "08991234", name: "ACME DIGITAL CONSULTING LIMITED", score: 0.88 },
        { company_number: "09112233", name: "ACME DIGITAL MEDIA LTD", score: 0.72 },
      ],
    };
    const html = renderToStaticMarkup(<ReviewQueue initialData={{ total: 1, items: [multi] }} toast={() => {}} />);
    expect(html).toContain("Other possible companies");
    expect(html).toContain("1. ACME DIGITAL CONSULTING LIMITED (88%)");
    expect(html).toContain("2. ACME DIGITAL MEDIA LTD (72%)");
  });

  it("displays past decision info on decided items and hides decision buttons", () => {
    const decided = {
      id: "fsr_3",
      match_status: "accepted",
      score: 0.9,
      decided_by: "Demo User",
      decided_at: "2026-10-15T10:30:00Z",
      fsb: { name: "Acme Digital", postcode: "BN1 1AB" },
      candidate: { name: "ACME DIGITAL LIMITED", company_number: "08991234" },
    };
    const html = renderToStaticMarkup(<ReviewQueue initialData={{ total: 1, items: [decided] }} initialStatus="decided" toast={() => {}} />);
    expect(html).toContain("Confirmed by a person by Demo User");
    expect(html).not.toContain("Yes, same company");
    expect(html).not.toContain("Pick another");
  });

  it("suppresses keyboard shortcuts when focus is inside text fields or buttons", () => {
    expect(shouldIgnoreReviewKey({ metaKey: true, target: { tagName: "div" } })).toBe(true);
    expect(shouldIgnoreReviewKey({ ctrlKey: true, target: { tagName: "div" } })).toBe(true);
    expect(shouldIgnoreReviewKey({ altKey: true, target: { tagName: "div" } })).toBe(true);
    expect(shouldIgnoreReviewKey({ target: { tagName: "INPUT" } })).toBe(true);
    expect(shouldIgnoreReviewKey({ target: { tagName: "TEXTAREA" } })).toBe(true);
    expect(shouldIgnoreReviewKey({ target: { tagName: "SELECT" } })).toBe(true);
    expect(shouldIgnoreReviewKey({ target: { tagName: "BUTTON" } })).toBe(true);
    expect(shouldIgnoreReviewKey({ target: { isContentEditable: true } })).toBe(true);
    expect(shouldIgnoreReviewKey({ target: { tagName: "DIV" } })).toBe(false);
    expect(shouldIgnoreReviewKey({ target: { tagName: "BODY" } })).toBe(false);
  });

  it("reduces queue state correctly after a decision", () => {
    const initial = {
      total: 2,
      items: [{ id: "fsr_1" }, { id: "fsr_2" }],
    };
    const after = reduceQueueAfterDecision(initial, "fsr_1");
    expect(after.total).toBe(1);
    expect(after.items.map((x) => x.id)).toEqual(["fsr_2"]);

    const empty = reduceQueueAfterDecision(after, "fsr_2");
    expect(empty.total).toBe(0);
    expect(empty.items).toEqual([]);

    const zero = reduceQueueAfterDecision(empty, "nonexistent");
    expect(zero.total).toBe(0);
  });

  it("explains 409 conflict, 404 missing, and other error messages", () => {
    expect(decisionMessage({ status: 409 })).toBe("Someone else already decided this.");
    expect(decisionMessage({ status: 404 })).toBe("That record is no longer in the queue.");
    expect(decisionMessage({ status: 403 })).toBe("Only administrators and managers can do this.");
    expect(decisionMessage({ status: 500 })).toBe("That did not save. Try again.");
  });
});

describe("records access", () => {
  it("protects records views for administrators and managers only", () => {
    const src = readFileSync(new URL("./LeadGenerationPlugin.jsx", import.meta.url), "utf8");
    expect(src).toContain("canUseRecords(operator)");
  });
});
