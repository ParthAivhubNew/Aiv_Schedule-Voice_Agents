// Pure helpers for Import & match, the review queue and Monthly changes.

export const KIND_LABELS = {
  status_changed: "Status changed",
  name_changed: "Name changed",
  address_changed: "Address changed",
  new_company: "New company",
  officer_appointed: "Director appointed",
  officer_resigned: "Director resigned",
  gazette_notice: "Insolvency notice",
};

export const STATUS_LABELS = {
  pending: "Waiting",
  auto: "Matched automatically",
  review: "Needs review",
  none: "No match",
  accepted: "Confirmed by a person",
  rejected: "Marked as no match",
  duplicate: "Duplicate",
};

export const ROW_FILTERS = ["", "auto", "review", "none", "accepted", "rejected", "duplicate", "pending"];

export const IMPORT_STATUS_LABELS = { uploaded: "Uploaded", matching: "Matching", done: "Done", failed: "Failed" };

export const REQUIRED_COLUMNS = ["Account ID", "Account Name"];
export const OPTIONAL_COLUMNS = ["Company Number", "Billing Street", "Billing City", "Billing Postal Code", "Phone", "Website"];
export const MAX_ROWS = 100000;
export const MAX_BYTES = 40 * 1024 * 1024;
export const MAX_DAYS = 366;

export const kindLabel = (kind) => KIND_LABELS[kind] || String(kind || "").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
export const statusLabel = (s) => STATUS_LABELS[s] || s || "";
export const importStatusLabel = (s) => IMPORT_STATUS_LABELS[s] || s || "";

export const isBusy = (imp) => !!imp && (imp.status === "uploaded" || imp.status === "matching");

// Kind chips in the order of KIND_LABELS, then any kind we do not know, skipping zeros.
export function kindChips(byKind) {
  const src = byKind || {};
  const known = Object.keys(KIND_LABELS).filter((k) => src[k] > 0);
  const other = Object.keys(src).filter((k) => !(k in KIND_LABELS) && src[k] > 0);
  return [...known, ...other].map((k) => ({ kind: k, label: kindLabel(k), count: src[k] }));
}

// The four counts shown on an import: a person's decision counts with the automatic one.
export function importChips(counts) {
  const c = counts || {};
  return [
    { key: "auto", label: "Matched automatically", count: (c.auto || 0) + (c.accepted || 0), tone: "good" },
    { key: "review", label: "Needs review", count: c.review || 0, tone: "warn" },
    { key: "none", label: "No match", count: (c.none || 0) + (c.rejected || 0), tone: "plain" },
    { key: "duplicate", label: "Duplicates", count: c.duplicate || 0, tone: "plain" },
  ];
}

export function progressPercent(imp) {
  if (!imp) return 0;
  if (imp.status === "done") return 100;
  const total = Number(imp.row_count) || 0;
  const done = Number(imp.stats?.processed) || 0;
  if (!total) return 0;
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}

export const formatScore = (score) => (typeof score === "number" && isFinite(score) ? `${Math.round(Math.max(0, Math.min(1, score)) * 100)}%` : "");

export const pct = (x) => `${Math.round(Number(x) * 100)}`;

// Returns an error message, or "" when the pair is usable. Accepts numbers or text from the inputs.
export function validateThresholds(auto, review) {
  const a = Number(auto), r = Number(review);
  if (auto === "" || review === "" || !isFinite(a) || !isFinite(r)) return "Enter both numbers.";
  if (r <= 0) return "The review level must be above 0.";
  if (r >= a) return "The review level must be lower than the automatic level.";
  if (a > 1) return "The automatic level can be at most 100.";
  return "";
}

// The inputs work in whole percentages; the API takes 0 to 1.
export const percentToFraction = (p) => Math.round(Number(p)) / 100;
export const validatePercentThresholds = (autoPct, reviewPct) => validateThresholds(autoPct === "" ? "" : percentToFraction(autoPct), reviewPct === "" ? "" : percentToFraction(reviewPct));

const DAY = 86400000;
const parseDay = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s || "") ? Date.parse(`${s}T00:00:00Z`) : NaN);

export function validateRange(start, end) {
  const a = parseDay(start), b = parseDay(end);
  if (isNaN(a) || isNaN(b)) return "Choose both dates.";
  if (b < a) return "The end date must be on or after the start date.";
  if (Math.round((b - a) / DAY) + 1 > MAX_DAYS) return `Choose a period of ${MAX_DAYS} days or fewer.`;
  return "";
}

export const templateCsv = () => `${[...REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS].join(",")}\r\n`;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export function periodLabel(period) {
  const m = /^(\d{4})-(\d{2})$/.exec(period || "");
  return m && MONTHS[Number(m[2]) - 1] ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : period || "";
}

export function whenText(iso) {
  const d = iso ? new Date(iso) : null;
  return d && !isNaN(d) ? d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
}

// Role check: administrators and managers only, as on the server.
export function canUseRecords(operator) {
  if (!operator) return false;
  if (operator.is_admin || operator.role === "Admin" || operator.role === "Manager") return true;
  return (operator.roles || []).some((r) => (typeof r === "string" ? r : r?.name) === "Manager" || r?.is_admin);
}
export const isAdminOperator = (operator) => !!operator && (!!operator.is_admin || operator.role === "Admin");

export function decisionMessage(e) {
  if (e?.status === 409) return "Someone else already decided this.";
  if (e?.status === 404) return "That record is no longer in the queue.";
  if (e?.status === 400) return e.message || "That company number is not on the register.";
  if (e?.status === 403) return "Only administrators and managers can do this.";
  return e?.message || "That did not save. Try again.";
}

// Suppress review hotkeys (Y/N) if typing in input, textarea, select, button, or contenteditable, or with modifier keys.
export function shouldIgnoreReviewKey(e) {
  if (!e) return true;
  if (e.metaKey || e.ctrlKey || e.altKey) return true;
  const t = e.target;
  const tag = (t?.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select" || tag === "button" || t?.isContentEditable) return true;
  return false;
}

// Remove decided item from local queue state and decrement count
export function reduceQueueAfterDecision(currentData, decidedItemId) {
  if (!currentData) return { total: 0, items: [] };
  const items = (currentData.items || []).filter((x) => x.id !== decidedItemId);
  const total = Math.max(0, (currentData.total || 1) - 1);
  return { ...currentData, total, items };
}

export function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
