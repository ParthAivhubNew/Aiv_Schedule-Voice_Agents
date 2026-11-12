// Anything a person sees in a plugin can be taken out as a spreadsheet file. No plan, credit or permission gate belongs here.
const cell = (v) => {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // a cell that starts like a formula is kept as text when opened in Excel
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const toCsv = (rows) => rows.map((r) => r.map(cell).join(",")).join("\r\n");

export function downloadCsv(filename, rows) {
  const url = URL.createObjectURL(new Blob(["\uFEFF" + toCsv(rows)], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
