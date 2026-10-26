// The look of an embedded screen. A partner passes an appearance when it mounts a screen, or saves a default in its
// dashboard. Only the keys below are read and each value is checked, so a partner can change colours, font and corners
// but cannot inject styles. backend/app/services/embed_theme.py applies the same rules to the saved default.

export const COLOR_KEYS = ["colorPrimary", "colorBackground", "colorSurface", "colorText", "colorDanger"];
export const FONTS = {
  system: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  inter: '"Inter", system-ui, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  rounded: 'ui-rounded, "Nunito", "Segoe UI", system-ui, sans-serif',
  mono: 'ui-monospace, "JetBrains Mono", Menlo, monospace',
};
export const MAX_RADIUS = 24;
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

// The valid part of an appearance: { variables }. Unknown or bad values are dropped.
export function cleanAppearance(raw) {
  const vars = raw && typeof raw === "object" && raw.variables && typeof raw.variables === "object" ? raw.variables : {};
  const out = {};
  COLOR_KEYS.forEach((k) => {
    if (typeof vars[k] === "string" && HEX.test(vars[k].trim())) out[k] = vars[k].trim().toLowerCase();
  });
  if (typeof vars.fontFamily === "string" && Object.prototype.hasOwnProperty.call(FONTS, vars.fontFamily)) out.fontFamily = vars.fontFamily;
  if (typeof vars.borderRadius === "number" && Number.isFinite(vars.borderRadius) && vars.borderRadius >= 0 && vars.borderRadius <= MAX_RADIUS) {
    out.borderRadius = Math.round(vars.borderRadius);
  }
  return { variables: out };
}

function rgb(hex) {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

// `amount` of the way from colour a to colour b.
export function mix(a, b, amount) {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  const c = (x, y) => Math.round(x + (y - x) * amount).toString(16).padStart(2, "0");
  return `#${c(r1, r2)}${c(g1, g2)}${c(b1, b2)}`;
}

// The CSS variables an appearance sets: { accent: {...}, root: {...} }. `accent` is also forced onto the elements an app
// tints itself (its own --ui-accent in an inline style), so the partner's colour wins over the app's own.
export function themeVars(appearance) {
  const v = cleanAppearance(appearance).variables;
  const accent = {};
  const root = {};
  if (v.colorPrimary) {
    const p = v.colorPrimary;
    Object.assign(accent, {
      "--ui-accent": p, "--ui-accent-hover": mix(p, "#000000", 0.12), "--ui-accent-soft": mix(p, "#ffffff", 0.9),
      "--ui-accent-ink": mix(p, "#000000", 0.28), "--ui-ring": `rgba(${rgb(p).join(", ")}, 0.22)`, "--ui-side-active-icon": mix(p, "#ffffff", 0.45),
    });
  }
  if (v.colorBackground) Object.assign(root, { "--ui-bg": v.colorBackground, "--ui-sunken": mix(v.colorBackground, v.colorSurface || "#ffffff", 0.5), "--ui-hover": mix(v.colorBackground, "#000000", 0.04) });
  if (v.colorSurface) root["--ui-surface"] = v.colorSurface;
  if (v.colorText) {
    const bg = v.colorBackground || "#ffffff";
    Object.assign(root, { "--ui-ink": v.colorText, "--ui-ink-2": mix(v.colorText, bg, 0.2), "--ui-muted": mix(v.colorText, bg, 0.5), "--ui-faint": mix(v.colorText, bg, 0.65) });
  }
  if (v.colorDanger) Object.assign(root, { "--ui-bad": v.colorDanger, "--ui-bad-soft": mix(v.colorDanger, "#ffffff", 0.9) });
  if (v.borderRadius !== undefined) Object.assign(root, { "--ui-r": `${v.borderRadius}px`, "--ui-r-sm": `${Math.max(0, v.borderRadius - 2)}px` });
  return { accent, root, font: v.fontFamily ? FONTS[v.fontFamily] : "", background: v.colorBackground || "" };
}

// The CSS for an appearance, for the page of an embedded screen.
export function themeCss(appearance) {
  const { accent, root, font, background } = themeVars(appearance);
  const decl = (o, important) => Object.entries(o).map(([k, val]) => `${k}: ${val}${important ? " !important" : ""}`).join("; ");
  const css = [];
  if (Object.keys(accent).length || Object.keys(root).length) css.push(`:root { ${decl({ ...accent, ...root })}; }`);
  if (Object.keys(accent).length) css.push(`[style*="--ui-accent"] { ${decl(accent, true)}; }`);
  if (font) css.push(`body, button, input, select, textarea, .app-shell * :not(code):not(pre) { font-family: ${font} !important; }`);
  if (background) css.push(`body { background: ${background}; }`);
  return css.join("\n");
}

// Puts an appearance on the page. Safe to call again: the last one wins.
export function applyAppearance(appearance) {
  let el = document.getElementById("embed-theme");
  if (!el) {
    el = document.createElement("style");
    el.id = "embed-theme";
    document.head.appendChild(el);
  }
  el.textContent = themeCss(appearance);
}
