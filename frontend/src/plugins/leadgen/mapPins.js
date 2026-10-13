// What a pin on the map looks like: an icon and colour for the kind of business, so a map of dentists
// shows teeth and a map of cafes shows cups. The kind is read from the company's own words first
// (industry, registered activity, name), then from what the user searched for.

const KINDS = [
  ["food", "Food and drink", "🍴", "#EA580C", /cafe|coffee|restaurant|takeaway|\bbar\b|\bpub\b|cater|bakery|bakers|food|hotel|\binn\b|brew/],
  ["accounting", "Accountants", "🧾", "#2563EB", /account|bookkeep|\btax\b|audit|payroll/],
  ["legal", "Legal", "⚖️", "#7C3AED", /solicitor|legal|\blaw\b|barrister|conveyanc/],
  ["construction", "Construction and trades", "🏗️", "#CA8A04", /construct|build|plumb|electric|roof|joiner|civil|engineer|scaffold|carpent|heating|glazing/],
  ["health", "Health and care", "🩺", "#DC2626", /dental|dentist|doctor|medical|health|clinic|pharmac|physio|\bcare\b|nursing|optic|veterin/],
  ["beauty", "Hair and beauty", "💇", "#C026D3", /\bhair|beauty|salon|barber|\bnail|\bspa\b|tattoo/],
  ["motor", "Motor trade", "🚗", "#475569", /garage|motor|\bcars?\b|vehicle|\bauto|taxi|tyre|mot\b/],
  ["property", "Property", "🏠", "#16A34A", /estate agent|property|lettings|real estate|housing|landlord/],
  ["finance", "Finance and insurance", "💷", "#059669", /\bbank|financ|insurance|invest|mortgage|\bloan|broker/],
  ["tech", "Technology", "💻", "#0891B2", /software|computer|\bit\b|technolog|digital|\bweb|\bdata\b|telecom|cyber/],
  ["education", "Education", "🎓", "#4F46E5", /school|college|educat|training|tuition|nursery|academy/],
  ["transport", "Transport", "🚚", "#B45309", /transport|logistic|haulage|courier|freight|delivery|removal/],
  ["retail", "Shops", "🛍️", "#DB2777", /retail|\bshop|\bstore|boutique|wholesale|florist|newsagent/],
];
const OTHER = { kind: "other", label: "Other businesses", icon: "🏢", color: "#111111" };

const asKind = ([kind, label, icon, color]) => ({ kind, label, icon, color });

// The icon kind for one company; `hint` is what the user searched for, used when the company's own words say nothing.
export function pinKind(c, hint = "") {
  const own = [c?.industry, c?.sic_text, c?.name].filter(Boolean).join(" ").toLowerCase();
  const found = KINDS.find((k) => k[4].test(own)) || KINDS.find((k) => k[4].test(String(hint || "").toLowerCase()));
  return found ? asKind(found) : OTHER;
}

// The round badge a pin is drawn as. A star marks a favourite, a tick a company already saved.
export function pinHtml(kind, { saved = false, favourite = false } = {}) {
  const mark = favourite ? "★" : saved ? "✓" : "";
  const badge = mark
    ? `<span style="position:absolute;right:-5px;top:-6px;min-width:14px;height:14px;border-radius:7px;background:${favourite ? "#F59E0B" : "#16A34A"};color:#fff;font:700 10px/14px sans-serif;text-align:center;border:1.5px solid #fff">${mark}</span>`
    : "";
  return `<div style="position:relative;width:30px;height:30px;border-radius:50%;background:${kind.color};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;font-size:15px;line-height:1">${kind.icon}${badge}</div>`;
}

// Which kinds are on the map and how many of each, for the legend, most common first.
export function legendFor(companies, hint = "") {
  const seen = new Map();
  (companies || []).forEach((c) => {
    const k = pinKind(c, hint);
    seen.set(k.kind, { ...k, count: (seen.get(k.kind)?.count || 0) + 1 });
  });
  return [...seen.values()].sort((a, b) => b.count - a.count);
}

export const directionsUrl = (c) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([c.name, c.postcode].filter(Boolean).join(" "))}`;
