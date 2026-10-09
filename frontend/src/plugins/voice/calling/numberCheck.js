// Number check on the imported list: what each result means on screen, how results sit on the
// rows, and how rows become a CSV. No network here, so it can be tested on its own.

export const NOT_CHECKED = "not_checked";

export const STATUS = {
  good: { label: "Good", tone: "ok", hint: "A real mobile or landline" },
  check: { label: "Check", tone: "warn", hint: "VoIP, toll-free or an unusual line" },
  not_working: { label: "Not working", tone: "bad", hint: "The network does not know this number" },
  do_not_call: { label: "Do not call", tone: "mute", hint: "On your do-not-call list" },
  bad_format: { label: "Bad format", tone: "mute", hint: "Not a complete phone number" },
  duplicate: { label: "Duplicate", tone: "mute", hint: "The same number appears earlier in the list" },
  couldnt_check: { label: "Couldn't check", tone: "mute", hint: "Could not be checked just now. Not charged, try again" },
  [NOT_CHECKED]: { label: "Not checked", tone: "mute", hint: "" },
};
export const STATUS_ORDER = ["good", "check", "not_working", "do_not_call", "bad_format", "duplicate", "couldnt_check", NOT_CHECKED];
export const MATCH = { match: "Match", partial: "Partial", differs: "Differs", none: "No data" };
export const LINE = { mobile: "Mobile", landline: "Landline", voip: "VoIP", toll_free: "Toll-free", other: "Other" };
export const CHUNK = 100;

export const statusOf = (row) => (row && row.check && row.check.status) || NOT_CHECKED;

export function namesOf(row) {
  return [row.contact, row.company, row.name].map((v) => String(v || "").trim()).filter((v) => v && !/^Row\s+\d+$/i.test(v));
}

// What we send for a set of rows: an id to match the answer back, the number as typed, and the
// names on file (for the "does the registered name fit" hint).
export function itemsFor(rows, phoneOf) {
  return rows.map((r) => ({ key: r.id, phone: phoneOf(r) || "", names: namesOf(r) })).filter((i) => i.phone);
}

// Put answers onto rows by id. A "couldn't check" never wipes a real answer we already had.
export function applyResults(rows, results) {
  const byKey = new Map((results || []).map((x) => [x.key, x]));
  return rows.map((r) => {
    const x = byKey.get(r.id);
    if (!x) return r;
    if (x.status === "couldnt_check" && r.check && r.check.status !== "couldnt_check") return r;
    return {
      ...r,
      check: {
        status: x.status, lineType: x.line_type, carrier: x.carrier, country: x.country,
        foundName: x.found_name, match: x.match, checkedOn: x.checked_on,
      },
    };
  });
}

export function countByStatus(rows) {
  const out = {};
  rows.forEach((r) => { const s = statusOf(r); out[s] = (out[s] || 0) + 1; });
  return out;
}

// filter: "" for everything, otherwise a status, or "match:<kind>".
export function filterRows(rows, filter) {
  if (!filter) return rows;
  if (filter.startsWith("match:")) return rows.filter((r) => r.check && r.check.match === filter.slice(6));
  return rows.filter((r) => statusOf(r) === filter);
}

export const hasChecks = (rows) => rows.some((r) => r.check);

// The columns the check adds, as plain text (also used by the CSV export).
export const CHECK_COLUMNS = [
  { id: "check_status", label: "Number status", get: (r) => STATUS[statusOf(r)].label },
  { id: "check_found", label: "Name found", get: (r) => (r.check && r.check.foundName) || "" },
  { id: "check_match", label: "Name match", get: (r) => (r.check ? MATCH[r.check.match] || "" : "") },
  { id: "check_type", label: "Line type", get: (r) => (r.check ? LINE[r.check.lineType] || "" : "") },
  { id: "check_carrier", label: "Carrier", get: (r) => (r.check && r.check.carrier) || "" },
  { id: "check_country", label: "Country", get: (r) => (r.check && r.check.country) || "" },
  { id: "check_date", label: "Checked on", get: (r) => (r.check && r.check.checkedOn) || "" },
];

const quote = (v) => {
  const s = String(v == null ? "" : v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(columns, rows) {
  const lines = [columns.map((c) => quote(c.label)).join(",")];
  rows.forEach((r) => lines.push(columns.map((c) => quote(c.get(r))).join(",")));
  return lines.join("\r\n");
}

export function downloadCsv(name, text) {
  const url = window.URL.createObjectURL(new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}

export const chunks = (list, size = CHUNK) => {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};
