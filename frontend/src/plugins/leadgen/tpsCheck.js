import { api } from "../../api/apiClient";

export const TPS_CHUNK = 500;

export const TPS_LABEL = {
  listed: "On TPS",
  ctps: "On CTPS",
  clear: "Clear",
  not_uk: "Not a UK number",
  unknown: "Couldn't check",
};

// The same number written two ways (07700 900001, +44 7700 900001) must land on one key.
export function tpsKey(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  else if (d.startsWith("0")) d = `44${d.slice(1)}`;
  return d;
}

// CTPS wins over TPS in the label because it covers companies.
export function tpsLabel(status, ctps) {
  if (ctps) return TPS_LABEL.ctps;
  return TPS_LABEL[status] || TPS_LABEL.unknown;
}

export function uniqueNumbers(numbers) {
  const seen = new Set();
  const out = [];
  for (const n of numbers || []) {
    const text = String(n || "").trim();
    const k = tpsKey(text);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(text);
  }
  return out;
}

export function chunkNumbers(numbers, size = TPS_CHUNK) {
  const out = [];
  for (let i = 0; i < numbers.length; i += size) out.push(numbers.slice(i, i + size));
  return out;
}

export function summarise(rows) {
  const s = { listed: 0, ctps: 0, clear: 0, not_uk: 0, couldnt_check: 0 };
  for (const r of rows || []) {
    if (r.ctps) s.ctps += 1;
    if (r.status === "listed") s.listed += 1;
    else if (r.status === "clear") s.clear += 1;
    else if (r.status === "not_uk") s.not_uk += 1;
    else if (r.status === "unknown") s.couldnt_check += 1;
  }
  return s;
}

export function creditsWord(n) {
  const v = Number(n) || 0;
  return `${v.toLocaleString()} credit${v === 1 ? "" : "s"}`;
}

export function dateWord(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function badgeTip(checkedAt) {
  const when = dateWord(checkedAt);
  return `Checked against the TPS and CTPS registers${when ? ` on ${when}` : ""}. A result lasts 28 days.`;
}

// Runs the list in chunks of 500, one after another. A failure part-way keeps what was done.
export async function runTpsChecks(numbers, wallet, onProgress, shouldStop) {
  const rows = [];
  let charged = 0;
  let note = "";
  let error = "";
  for (const part of chunkNumbers(numbers)) {
    if (shouldStop && shouldStop()) break;
    onProgress?.(rows.length, numbers.length);
    try {
      const out = await api.tpsRun(part, wallet);
      rows.push(...(out.rows || []));
      charged += Number(out.credits_charged) || 0;
      if (out.note) note = out.note;
    } catch (e) {
      error = e?.message || "Couldn't finish the check. Numbers already checked keep their results.";
      break;
    }
  }
  onProgress?.(rows.length, numbers.length);
  return { rows, charged, note, error };
}

// A long list is estimated in chunks too, and the answers are added up.
export async function estimateTps(numbers, wallet) {
  let total = null;
  for (const part of chunkNumbers(numbers)) {
    const out = await api.tpsEstimate(part, wallet);
    if (!total) total = { ...out, rows: [...(out.rows || [])] };
    else {
      total.rows.push(...(out.rows || []));
      total.to_check += out.to_check || 0;
      total.credits += out.credits || 0;
      total.ready = total.ready && out.ready;
    }
  }
  return total || { ready: true, rows: [], to_check: 0, credits: 0, balance: 0, enforced: false };
}

export function tpsByKey(rows) {
  const m = new Map();
  for (const r of rows || []) m.set(tpsKey(r.number), { status: r.status, ctps: !!r.ctps, checkedAt: r.checked_at || null });
  return m;
}

// The line shown BEFORE anything is spent: "3 numbers to check, 7 already checked, cost 2 credits." Numbers checked in the last 28 days and
// numbers outside the UK are free; the UK ones are counted apart so the sums add up.
export function previewParts(est, total) {
  const toCheck = Number(est?.to_check) || 0;
  const notUk = (est?.rows || []).filter((r) => r.status === "not_uk").length;
  const already = Math.max(0, total - toCheck - notUk);
  return { toCheck, already, notUk, credits: Number(est?.credits) || 0 };
}

export function previewLine(est, total) {
  const { toCheck, already, notUk, credits } = previewParts(est, total);
  const n = (v) => v.toLocaleString();
  return `${n(toCheck)} ${toCheck === 1 ? "number" : "numbers"} to check, ${n(already)} already checked, cost ${creditsWord(credits)}.${notUk ? ` ${n(notUk)} ${notUk === 1 ? "is" : "are"} not UK ${notUk === 1 ? "number" : "numbers"} and ${notUk === 1 ? "is" : "are"} left out.` : ""}`;
}

// One sentence about the phone screening that ran with a company check, added to the check's message. Empty when nothing was needed.
export function screeningNote(check) {
  const c = check || {};
  if (c.status === "done" && c.screened) return ` Phone numbers screened against TPS and CTPS${c.credits ? `: ${creditsWord(c.credits)} used` : ""}.`;
  if (c.status === "no_credits") return " Phone screening was skipped: not enough credits.";
  if (c.status === "no_key") return " Phone screening isn't switched on yet.";
  if (c.status === "service") return " Phone screening couldn't be reached this time.";
  return "";
}
