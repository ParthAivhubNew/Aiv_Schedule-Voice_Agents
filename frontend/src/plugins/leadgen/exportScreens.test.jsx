import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../api/apiClient", () => ({ api: new Proxy({}, { get: () => () => new Promise(() => {}) }) }));
vi.mock("../../brand/brandApi", () => ({ getOrgPolicy: () => new Promise(() => {}) }));

import { FieldMark, SourceMark, ENRICHMENT_NOTE, GOOGLE_NOTE } from "./SourceMark";
import { ExportBody, ExportDialog, countFrom, exportError, fileNameFrom, primaryLabel, successText, withheldLine, FIELDS } from "./ExportDialog";
import { SalesforceBody, SalesforceDialog, sfCounts } from "./SalesforceDialog";
import { GoogleViewBody, GoogleCard, googleAllowed, googleError, statusWord, IDLE_LINE, NOT_FOUND } from "./GoogleView";

const src = (f) => readFileSync(new URL(`./${f}`, import.meta.url), "utf8");
const html = (el) => renderToStaticMarkup(el);
const noop = () => {};
const esc = (s) => s.replace(/'/g, "&#x27;");

describe("SourceMark", () => {
  it("carries the tooltip, a screen reader label and is focusable", () => {
    const h = html(<SourceMark note={GOOGLE_NOTE} source="google_places" />);
    // the note is the button's described tooltip (the shared Tooltip; no native title, which showed a second tooltip on hover)
    expect(h).toMatch(new RegExp(`role="tooltip"[^>]*>${esc(GOOGLE_NOTE).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}<`));
    expect(h).toContain("From Google");
    expect(h).toContain("aria-describedby");
    expect(h).toContain("<button");
  });
  it("says Restricted source for enrichment values and uses the enrichment wording", () => {
    const h = html(<SourceMark />);
    expect(h).toContain("Restricted source");
    expect(h).toContain(esc(ENRICHMENT_NOTE));
  });
  it("renders nothing without a flag, and prefers the payload's own note", () => {
    expect(html(<FieldMark flags={{}} field="phone" />)).toBe("");
    expect(html(<FieldMark flags={undefined} field="phone" />)).toBe("");
    expect(html(<FieldMark flags={{ phone: true }} notes={{ phone: "Custom note" }} field="phone" />)).toContain("Custom note");
    expect(html(<FieldMark flags={{ web_phone: true }} field="phone" />)).toContain("<button");
  });
});

describe("export helpers", () => {
  it("reads the file name from the header, with a fallback", () => {
    expect(fileNameFrom(new Headers({ "Content-Disposition": 'attachment; filename="companies-2026.csv"' }))).toBe("companies-2026.csv");
    expect(fileNameFrom(new Headers())).toBe("export.csv");
    expect(fileNameFrom(null)).toBe("export.csv");
  });
  it("reads counts and words the result", () => {
    expect(countFrom(new Headers({ "X-Withheld-Count": "4" }), "X-Withheld-Count")).toBe(4);
    expect(countFrom(null, "X")).toBe(0);
    expect(successText(1200, 3)).toBe("Exported 1,200 rows. 3 values were left out.");
    expect(successText(1, 1)).toBe("Exported 1 row. 1 value was left out.");
    expect(withheldLine({ phone: 3, website: 1, email: 0 })).toBe("Left out of the file: 3 phone numbers, 1 website.");
    expect(withheldLine({ phone: 0 })).toBe("");
  });
  it("uses the server's message for 400, 404 and 422", () => {
    expect(exportError(Object.assign(new Error("A file can hold up to 50,000 rows. Pick a smaller list."), { status: 400 }))).toBe("A file can hold up to 50,000 rows. Pick a smaller list.");
    expect(exportError(Object.assign(new Error("Request failed with status 404"), { status: 404 }))).toContain("find");
    expect(exportError(Object.assign(new Error("Bad field"), { status: 422 }))).toBe("Bad field");
  });
});

const base = { kind: "companies", error: "", fields: FIELDS.companies, format: "wide", busy: false, message: "", onToggle: noop, onFormat: noop, onClose: noop, onGo: noop };

describe("ExportBody", () => {
  it("shows the row count, fields, formats and a plain Export button with no popup", () => {
    const h = html(<ExportBody {...base} preview={{ rows: 12, withheld: 0, withheld_fields: {}, popup: "" }} />);
    expect(h).toContain("12 rows");
    expect(h).toContain("Company number");
    expect(h).toContain("One row for each company");
    expect(h).toContain("Cancel");
    expect(h).toContain("Export</button>");
    expect(h).not.toContain("Export without Google data");
  });
  it("shows the popup as given, the screening note, counts and the changed button", () => {
    const preview = { rows: 5, withheld: 4, withheld_fields: { phone: 3, website: 1, email: 0 }, popup: "Some values came from Google.", screening_note: "Check the numbers first.", unscreened_phones: 2, listed_phones: 1 };
    const h = html(<ExportBody {...base} preview={preview} />);
    expect(h).toContain("Some values came from Google.");
    expect(h).toContain("Check the numbers first.");
    expect(h).toContain("3 phone numbers, 1 website");
    expect(h).toContain("2 phone numbers have not been through");
    expect(primaryLabel(preview)).toBe("Export without Google data");
    expect(h).toContain("Export without Google data");
  });
  it("shows the server's error and the success message", () => {
    expect(html(<ExportBody {...base} preview={null} error="A file can hold up to 50,000 rows. Pick a smaller list." />)).toContain('role="alert"');
    const done = html(<ExportBody {...base} preview={{ rows: 5 }} message="Exported 5 rows. 2 values were left out." />);
    expect(done).toContain("Exported 5 rows. 2 values were left out.");
    expect(done).toContain(">Close<");
  });
  it("renders the dialog frame before any answer arrives", () => {
    const h = html(<ExportDialog kind="companies" scope={{ list_id: "lst_1" }} onClose={noop} />);
    expect(h).toContain('role="dialog"');
    expect(h).toContain("Counting the rows");
  });
});

describe("SalesforceDialog", () => {
  it("shows counts, popup, fields and the layout explanation", () => {
    const h = html(<SalesforceBody preview={{ rows: 7, records: 3, popup: "Google values are left out.", withheld_fields: { phone: 2 } }} error="" fields={["phone", "website", "email"]} format="long" busy={false} message="" onToggle={noop} onFormat={noop} onClose={noop} onGo={noop} />);
    expect(h).toContain("3 records to update, 7 rows in the file.");
    expect(h).toContain("Google values are left out.");
    expect(h).toContain("One row per change, or one row per record.");
    expect(h).toContain("Download without Google data");
    expect(sfCounts({ rows: 1, records: 1 })).toBe("1 record to update, 1 row in the file.");
  });
  it("renders its frame", () => {
    expect(html(<SalesforceDialog importId="imp_1" onClose={noop} />)).toContain("Download update file");
  });
});

describe("GoogleView", () => {
  const found = { found: true, details: { name: "Acme Ltd", address: "1 High St", phone: "01234 567890", website: "acme.example", rating: 4.5, rating_count: 12, business_status: "OPERATIONAL", hours: ["Mon: 9-5"], maps_url: "https://maps.example/x" }, attribution: "Google", note: "Shown live from Google. It is not stored and cannot be downloaded.", credits_charged: 1 };
  it("is hidden until the policy is known and when it lists google", () => {
    expect(html(<GoogleViewBody policy={null} phase="idle" onShow={noop} onClose={noop} />)).toBe("");
    expect(html(<GoogleViewBody policy={{ restrictedSources: ["google"] }} phase="idle" onShow={noop} onClose={noop} />)).toBe("");
    expect(googleAllowed({ restrictedSources: ["apollo"] })).toBe(true);
  });
  it("idle shows the button and the credit line", () => {
    const h = html(<GoogleViewBody policy={{ restrictedSources: [] }} phase="idle" onShow={noop} onClose={noop} />);
    expect(h).toContain("Show Google details");
    expect(h).toContain(IDLE_LINE);
  });
  it("shows the found card in plain words", () => {
    const h = html(<GoogleViewBody policy={{}} phase="done" result={found} onShow={noop} onClose={noop} />);
    expect(h).toContain("From Google");
    expect(h).toContain('href="tel:01234567890"');
    expect(h).toContain("4.5 out of 5 (12 reviews)");
    expect(h).toContain("Mon: 9-5");
    expect(h).toContain("Open in Google Maps");
    expect(h).toContain("cannot be downloaded");
    expect(h).not.toContain("Show Google details");
    expect(statusWord("OPERATIONAL")).toBe("Open");
    expect(statusWord("CLOSED_TEMPORARILY")).toBe("Temporarily closed");
    expect(statusWord("CLOSED_PERMANENTLY")).toBe("Permanently closed");
  });
  it("says so when Google has nothing", () => {
    expect(html(<GoogleCard result={{ found: false, details: null, attribution: "Google", note: "" }} onClose={noop} />)).toContain(NOT_FOUND);
  });
  it("shows the server's message for 402, 403 and 429", () => {
    for (const status of [402, 403, 429]) {
      const msg = `Server says ${status}`;
      const text = googleError(Object.assign(new Error(msg), { status }));
      expect(text).toBe(msg);
      expect(html(<GoogleViewBody policy={{}} phase="idle" error={text} onShow={noop} onClose={noop} />)).toContain(msg);
    }
    expect(googleError(Object.assign(new Error("Request failed with status 429"), { status: 429 }))).toContain("this hour");
  });
});

describe("wiring", () => {
  it("Lists, accounts, import detail, drawer and page use the new pieces", () => {
    expect(src("Lists.jsx")).toContain('<ExportDialog kind="companies" scope={exportTarget}');
    expect(src("Lists.jsx")).toContain("Export list");
    expect(src("AccountsViews.jsx")).toContain('<ExportDialog kind="companies" scope={{ ids: pickedIds }}');
    expect(src("AccountsViews.jsx")).toContain("<FieldMark flags={a.restricted}");
    expect(src("ImportMatch.jsx")).toContain("<SalesforceDialog importId={id}");
    expect(src("ImportMatch.jsx")).toContain("Download update file");
    expect(src("CompanyDrawer.jsx")).toContain("<GoogleView");
    expect(src("CompanyPage.jsx")).toContain("<GoogleView");
    expect(src("FindLeadsParts.jsx")).toContain("<FieldMark flags={c.restricted}");
    expect(src("SavedPeople.jsx")).toContain("FieldMark");
    expect(src("LeadGenerationPlugin.jsx")).toContain("canExport={isAdminOperator(operator) || !access.exportOff}");
  });
  it("keeps Google details out of storage and logs", () => {
    expect(src("GoogleView.jsx")).not.toMatch(/localStorage|sessionStorage|console\./);
  });
});
