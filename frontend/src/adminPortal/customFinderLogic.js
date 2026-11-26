// The form for an e-mail finder set up in the portal (backend/app/providers/generic_http.py): the server's config to the form's text
// fields and back. The server checks everything again; this only spares staff a round trip for broken JSON.

export const BLANK = {
  id: "", name: "", method: "GET", url: "", keyIn: "header", keyName: "Authorization", keyPrefix: "Bearer ",
  query: '{\n  "first_name": "{first_name}",\n  "last_name": "{last_name}",\n  "domain": "{domain}"\n}', body: "",
  emailPath: "data.email", statusPath: "", verifiedValues: "", catchAllValues: "", trustAll: false,
  priceUsd: "", billing: "per_find", exportable: true, clientLabel: "Licensed business data", order: 90, docsUrl: "", key: "",
};

// "Finder X Pro" -> "finder_x_pro": the id a new provider gets from its name, as the server allows ids.
export function idFromName(name) {
  const id = String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^[^a-z]+/, "");
  return id.slice(0, 41);
}

const pretty = (obj) => (obj && Object.keys(obj).length ? JSON.stringify(obj, null, 2) : "");

// A saved config as form fields.
export function toForm(cfg) {
  if (!cfg) return { ...BLANK };
  return {
    ...BLANK, ...cfg,
    query: pretty(cfg.query), body: pretty(cfg.body),
    verifiedValues: (cfg.verifiedValues || []).join(", "), catchAllValues: (cfg.catchAllValues || []).join(", "),
    priceUsd: cfg.priceUsd === undefined || cfg.priceUsd === null ? "" : String(cfg.priceUsd), key: "",
  };
}

function parseObject(text, label) {
  const t = String(text || "").trim();
  if (!t) return {};
  let out;
  try {
    out = JSON.parse(t);
  } catch {
    throw new Error(`${label} isn't valid JSON.`);
  }
  if (!out || typeof out !== "object" || Array.isArray(out)) throw new Error(`${label} must be a JSON object, in { }.`);
  return out;
}

// The form as the body of PUT /providers/custom: { config, key }. Throws a plain-English error for JSON staff need to fix.
export function fromForm(form) {
  const config = {
    ...form,
    id: form.id || idFromName(form.name),
    query: parseObject(form.query, "The query"),
    body: form.method === "POST" ? parseObject(form.body, "The body") : {},
    priceUsd: form.priceUsd === "" ? 0 : Number(form.priceUsd),
    order: Number(form.order) || 90,
  };
  delete config.key;
  delete config.keySaved;
  return { config, key: form.key || "" };
}
