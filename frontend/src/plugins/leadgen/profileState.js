// What the company profiles remember in this browser: the last tab chosen per screen, and which sections are open.
// Storage can be missing or blocked (private windows, previews), so every read and write falls back quietly.

const TAB_KEY = "aivhub_profile_tab:";
const OPEN_KEY = "aivhub_profile_open:";

function read(key) {
  try { return window.localStorage.getItem(key); } catch { return null; }
}

function write(key, value) {
  try { window.localStorage.setItem(key, value); } catch { /* not remembered, still works */ }
}

export function readTab(screen, allowed, fallback) {
  const v = read(TAB_KEY + screen);
  return allowed.includes(v) ? v : fallback;
}

export function writeTab(screen, tab) {
  write(TAB_KEY + screen, tab);
}

// A section's saved state, or its default (only the first section of each tab starts open).
export function readOpen(id, defaultOpen) {
  const v = read(OPEN_KEY + id);
  return v === "1" ? true : v === "0" ? false : Boolean(defaultOpen);
}

export function writeOpen(id, open) {
  write(OPEN_KEY + id, open ? "1" : "0");
}

// Arrow keys, Home and End move between tabs, wrapping round. Returns the new index, or -1 for any other key.
export function nextTabIndex(index, key, count) {
  if (!count) return -1;
  if (key === "ArrowRight" || key === "ArrowDown") return (index + 1) % count;
  if (key === "ArrowLeft" || key === "ArrowUp") return (index - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return -1;
}

// "4 of 7 details"
export function filledSummary(values, noun = "details") {
  const all = values.length;
  const have = values.filter((v) => String(v ?? "").trim()).length;
  return `${have} of ${all} ${noun}`;
}
