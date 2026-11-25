// Pure helpers for white-label brands. No React, no network, so they are easy to test.

export const DEFAULT_SIGNIN = { password: true, google: true, microsoft: true };

// What the app uses when there is no brand: exactly today's look.
export const NO_BRAND = {
  active: false, name: "", shortName: "", logoUrl: "", accent: "", poweredBy: false, hideCredits: false,
  standingExclusions: false, memberSuppression: false, signin: DEFAULT_SIGNIN, accountLink: null, social: null,
};

// The brand's own account link for the sidebar (theme.accountLink: {url, label}), or null. Only an https address is used.
export function accountLinkOf(theme) {
  const link = theme && typeof theme === "object" ? theme.accountLink : null;
  const url = link && typeof link.url === "string" ? link.url.trim() : "";
  if (!/^https:\/\/[^\s]+$/i.test(url)) return null;
  return { url, label: String(link.label || "").trim().slice(0, 80) };
}

// "https://Outreach.Example.com:8080/signin" -> "outreach.example.com" (the server matches on the bare name).
export function normaliseHost(value) {
  return String(value || "").trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, "").split("/")[0].split("?")[0].split(":")[0].replace(/^\.+|\.+$/g, "");
}

// A web address like outreach.example.com. Used for the domain box on the staff screen.
export function isHost(value) {
  return /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(normaliseHost(value));
}

// #rgb or #rrggbb. Returns the six-digit lower-case form, "" for an empty box, or null when it is not a colour.
export function normaliseAccent(value) {
  const v = String(value || "").trim();
  if (!v) return "";
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
  if (!m) return null;
  const h = m[1].toLowerCase();
  return "#" + (h.length === 3 ? h.split("").map((c) => c + c).join("") : h);
}

// A postcode district such as BN1, BN3 or W1A (letters, a digit, an optional letter or digit).
const DISTRICT = /^[A-Z]{1,2}\d[A-Z\d]?$/;

// "bn1, BN 3\nW1A" -> { districts: ["BN1","BN3","W1A"], invalid: [] }
export function parseDistricts(text) {
  const districts = [];
  const invalid = [];
  String(text || "").split(/[\s,;]+/).map((s) => s.trim().toUpperCase()).filter(Boolean).forEach((d) => {
    if (!DISTRICT.test(d)) invalid.push(d);
    else if (!districts.includes(d)) districts.push(d);
  });
  return { districts, invalid };
}

// Extra exclusions are separated by commas or new lines (an item may hold a space: "care home").
export function parseExtra(text) {
  const out = [];
  String(text || "").split(/[,\n;]+/).map((s) => s.trim()).filter(Boolean).forEach((s) => { if (!out.includes(s)) out.push(s); });
  return out;
}

export function defaultPolicy() {
  return {
    exclusions: { fsb: false, extra: [], locked: false },
    member_suppression: false,
    geo: { districts: [] },
    restricted_sources: { google: false, apollo: false, search_engines: false },
    signin: { ...DEFAULT_SIGNIN },
    screening: { block_unscreened: false },
    social: { approver: "anyone", networks: [], ai_images: true, ai_video: true },
  };
}

// Fills whatever a stored policy lacks, so the editor never meets an undefined.
export function withPolicyDefaults(policy) {
  const d = defaultPolicy();
  const p = policy && typeof policy === "object" ? policy : {};
  return {
    exclusions: { ...d.exclusions, ...(p.exclusions || {}), extra: Array.isArray(p.exclusions?.extra) ? p.exclusions.extra : [] },
    member_suppression: Boolean(p.member_suppression),
    geo: { districts: Array.isArray(p.geo?.districts) ? p.geo.districts : [] },
    restricted_sources: { ...d.restricted_sources, ...(p.restricted_sources || {}) },
    signin: { ...d.signin, ...(p.signin || {}) },
    screening: { block_unscreened: Boolean(p.screening?.block_unscreened) },
    social: { ...d.social, ...(p.social || {}), networks: Array.isArray(p.social?.networks) ? p.social.networks : [] },
  };
}

// The tab title: "FSB Outreach | Leads". With no brand the page keeps its own title.
export function buildTitle(brandName, base) {
  const name = String(brandName || "").trim();
  const rest = String(base || "").trim();
  if (!name) return rest;
  if (!rest || rest.toLowerCase().startsWith(name.toLowerCase())) return name;
  return `${name} | ${rest}`;
}

// One look for the whole app. `host` is the public look for this address, `me` the signed-in account's look
// ({} when it has no brand), `policy` the account's /org/policy answer. Either may be missing.
export function resolveBrand({ host, me, policy } = {}) {
  const look = me && me.name ? me : host && host.name ? host : null;
  const pol = policy && typeof policy === "object" ? policy : {};
  const signedIn = Boolean(me && me.name);
  const standing = Boolean(pol.standingExclusions || (signedIn && me.standingExclusions));
  const memberSuppression = Boolean(pol.memberSuppression);
  const social = pol.social && typeof pol.social === "object" ? pol.social : null; // the company's Social rules (GET /org/policy)
  if (!look) return { ...NO_BRAND, standingExclusions: standing, memberSuppression, social };
  return {
    active: true,
    name: look.displayName || look.name,
    shortName: look.name || "",
    logoUrl: look.logoUrl || "",
    accent: normaliseAccent(look.accent) || "",
    poweredBy: Boolean(look.poweredBy),
    hideCredits: signedIn ? Boolean(me.hideCredits) : false,
    standingExclusions: standing,
    memberSuppression,
    signin: { ...DEFAULT_SIGNIN, ...(look.signin || {}) },
    accountLink: signedIn ? accountLinkOf(look.theme) : null,
    social,
  };
}

// -- A brand's accent as the app's accent -----------------------------------------------------------------------------------------
const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const hexOf = (rgb) => "#" + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("").toUpperCase();
const mix = (hex, toward, share) => hexOf(rgbOf(hex).map((v, i) => v + (rgbOf(toward)[i] - v) * share));
const lum = (hex) => {
  const [r, g, b] = rgbOf(hex).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contrastWithWhite = (hex) => 1.05 / (lum(hex) + 0.05);

// The accent shades the app uses (the same set the default cobalt has in app/global.css), from a brand's colour. A colour too light for white
// text on a button is darkened until it reads (WCAG AA, 4.5:1). null when the colour isn't one.
export function accentShades(value) {
  let base = normaliseAccent(value);
  if (!base) return null;
  for (let i = 0; i < 20 && contrastWithWhite(base) < 4.5; i += 1) base = mix(base, "#000000", 0.08);
  const [r, g, b] = rgbOf(base);
  return {
    "--ui-accent": base,
    "--ui-accent-hover": mix(base, "#000000", 0.12),
    "--ui-accent-soft": mix(base, "#FFFFFF", 0.92),
    "--ui-accent-ink": mix(base, "#000000", 0.3),
    "--ui-ring": `rgba(${r}, ${g}, ${b}, 0.22)`,
    "--ui-side-active-icon": mix(base, "#FFFFFF", 0.45),
  };
}
export const ACCENT_PROPS = ["--ui-accent", "--ui-accent-hover", "--ui-accent-soft", "--ui-accent-ink", "--ui-ring", "--ui-side-active-icon"];
