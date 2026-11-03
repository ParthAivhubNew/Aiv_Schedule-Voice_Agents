// Pure helpers for the Inbound forms screens (kept apart so they can be tested without the page).

const TYPE_LABEL = { name: "Name", email: "Email", phone: "Phone", text: "Short text", dropdown: "Dropdown", checkbox: "Checkbox" };
const DEFAULT_LABEL = { name: "Name", email: "Email", phone: "Phone", text: "Your question", dropdown: "Choose one", checkbox: "I agree to be contacted" };

export const fieldTypeLabel = (type) => TYPE_LABEL[type] || type;

// A new field of this type with an id no other field uses.
export function newField(type, existing) {
  const taken = new Set(existing.map((f) => f.id));
  let id = type;
  for (let n = 2; taken.has(id); n += 1) id = `${type}_${n}`;
  const maps = type === "name" ? "contact_name" : type === "email" ? "email" : type === "phone" ? "phone" : `custom:${id}`;
  return { id, type, label: DEFAULT_LABEL[type] || type, placeholder: "", required: false, maps_to: maps, options: type === "dropdown" ? ["Option 1", "Option 2"] : [] };
}

// The list with the item at `index` moved by `by` places (-1 up, 1 down); unchanged if that runs off either end.
export function moveItem(list, index, by) {
  const to = index + by;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return list;
  const out = list.slice();
  [out[index], out[to]] = [out[to], out[index]];
  return out;
}

// The public page link and the iframe snippet for a published form.
export function formLinks(origin, key) {
  const page = `${origin}/api/f/${encodeURIComponent(key)}/page`;
  return { page, iframe: `<iframe src="${page}" title="Contact form" width="100%" height="520" style="border:0" loading="lazy"></iframe>` };
}

// "Today", "Yesterday" or the date.
export function whenShort(iso, now = Date.now()) {
  if (!iso) return "–";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "–";
  const days = Math.floor((now - d.getTime()) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: days > 300 ? "numeric" : undefined });
}
