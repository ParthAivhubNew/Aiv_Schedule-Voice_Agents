// "7 searches", "3 numbers": a count and its unit in words. A unit like "5 numbers" means the price is per 5, so the count is
// shown in plain numbers (0.6 of "5 numbers" is 3 numbers).
export function usageCount(units, unit) {
  const u = String(unit || "").trim();
  const per = u.match(/^(\d+)\s+(.+)$/);
  const n = per ? Math.round(Number(units) * Number(per[1])) : Number(units);
  const word = per ? per[2] : u;
  const shown = per ? (n === 1 ? word.replace(/s$/, "") : word) : pluralise(n, word); // "5 numbers" already names the plural
  return { n, text: `${n.toLocaleString()} ${shown}`.trim() };
}

export function pluralise(n, word) {
  const w = String(word || "");
  if (!w || n === 1) return w;
  if (w.includes(" ")) {
    const [first, ...rest] = w.split(" "); // "minute of call" -> "minutes of call"
    return [pluralise(n, first), ...rest].join(" ");
  }
  if (/(s|x|z|ch|sh)$/i.test(w)) return `${w}es`;
  if (/[^aeiou]y$/i.test(w)) return `${w.slice(0, -1)}ies`;
  return `${w}s`;
}
