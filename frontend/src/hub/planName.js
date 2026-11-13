// A plan shown in plain words. Names an admin typed as a code ("growthlead", "startervoice") read as "Growth", "Starter";
// a name written for people ("Voice Starter") is left exactly as it is.
export function planName(name) {
  const s = String(name || "").trim();
  if (!/^[a-z][a-z0-9_-]*$/.test(s)) return s;
  const base = s.replace(/[_-]+/g, " ").replace(/\s*(leads?|lead ?gen|voice|social|scheduler|calling)$/, "").replace(/(leads?|voice|social|scheduler|calling)$/, "").trim() || s;
  return base.replace(/\b\w/g, (c) => c.toUpperCase());
}
