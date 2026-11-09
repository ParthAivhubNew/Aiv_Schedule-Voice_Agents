// Notes on a company or a person at it: the plain rules the note list, the popover and the tables share.

export const NOTE_MAX = 2000;

export function cleanNote(text) {
  return String(text || "").replace(/\r\n?/g, "\n").trim();
}

export function noteProblem(text) {
  const t = cleanNote(text);
  if (!t) return "Write a note first.";
  if (t.length > NOTE_MAX) return `A note can be up to ${NOTE_MAX.toLocaleString()} characters.`;
  return "";
}

// Ctrl+Enter (Cmd+Enter on a Mac) adds the note.
export function isAddShortcut(e) {
  return e.key === "Enter" && (e.ctrlKey || e.metaKey);
}

// The register name as the server keys it: lower case, single spaces.
export function personKey(name) {
  return String(name || "").replace(/\s+/g, " ").trim().toLowerCase();
}

// One id for a company's notes in the counts cache, and one for a person at a company.
export function companyRef(id) {
  return String(id || "");
}

export function personRef(companyId, name) {
  return `${companyId || ""}|${personKey(name)}`;
}

export function noteWhen(iso, now = new Date()) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleString("en-GB", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }), hour: "2-digit", minute: "2-digit" });
}

// Who wrote it and when, for one line: "Ann Lee · 9 Nov, 10:04", or "Earlier note" for the old single notes field.
export function noteByline(n) {
  if (!n) return "";
  if (n.earlier) return "Earlier note";
  return [n.author_name, noteWhen(n.created_at)].filter(Boolean).join(" · ");
}

export function oneLine(text, max = 140) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export function countWords(n) {
  return n ? `${n} ${n === 1 ? "note" : "notes"}` : "No notes";
}

// Splits ids into batches the counts endpoint accepts.
export function batches(ids, size = 200) {
  const out = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}
