// Pure helpers for the Administration screen: filtering, sorting and paging users, and counting permissions.
import { C } from "../../../tokens";

export const PAGE_SIZES = [10, 25, 50];
export const LEVELS = ["none", "view", "full"];
export const LEVEL_NAMES = { none: "None", view: "View", full: "Full" };

export const userRoles = (u) => (Array.isArray(u && u.roles) ? u.roles : []);
export const isAdminUser = (u) => !!u && (!!u.is_admin || userRoles(u).some((r) => r.is_admin));
export const userStatus = (u) => (u && u.is_active === false ? "inactive" : "active");
export const primaryRoleName = (u) => (isAdminUser(u) && !userRoles(u).length ? "Admin" : (userRoles(u)[0] || {}).name || "No role");

// "02-11-2026", or the fallback when there is no date.
export function formatDate(iso, empty = "-") {
  if (!iso) return empty;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return empty;
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}-${p(d.getUTCMonth() + 1)}-${d.getUTCFullYear()}`;
}
export const formatLastLogin = (iso) => formatDate(iso, "Never");

// The chips above the table: All, then each role that has people (and roles with nobody, shown as 0).
export function roleChips(users, roles) {
  const list = users || [];
  const chips = [{ id: "all", name: "All", count: list.length }];
  (roles || []).forEach((r) => chips.push({ id: r.id, name: r.name, count: list.filter((u) => userRoles(u).some((x) => x.id === r.id)).length }));
  return chips;
}

export function filterUsers(users, { query = "", roleId = "all" } = {}) {
  const q = String(query || "").trim().toLowerCase();
  return (users || []).filter((u) => {
    if (roleId && roleId !== "all" && !userRoles(u).some((r) => r.id === roleId)) return false;
    if (!q) return true;
    return [u.name, u.email, u.username, primaryRoleName(u)].some((v) => String(v || "").toLowerCase().includes(q));
  });
}

export const SORT_KEYS = ["user", "role", "created", "last_login", "status"];
const sortValue = (u, key) => {
  if (key === "user") return String(u.name || u.username || "").toLowerCase();
  if (key === "role") return primaryRoleName(u).toLowerCase();
  if (key === "created") return u.member_since ? Date.parse(u.member_since) || 0 : 0;
  if (key === "last_login") return u.last_login_at ? Date.parse(u.last_login_at) || 0 : 0;
  if (key === "status") return userStatus(u);
  return "";
};
// Stable sort; people who never signed in sort as the oldest.
export function sortUsers(users, key, dir = "asc") {
  const sign = dir === "desc" ? -1 : 1;
  return (users || []).map((u, i) => [u, i]).sort(([a, i], [b, j]) => {
    const x = sortValue(a, key);
    const y = sortValue(b, key);
    if (x < y) return -sign;
    if (x > y) return sign;
    return i - j;
  }).map(([u]) => u);
}
// Clicking the same column flips the direction; a new column starts ascending (dates start newest first).
export function nextSort(current, key) {
  if (current && current.key === key) return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  return { key, dir: key === "created" || key === "last_login" ? "desc" : "asc" };
}

export function paginate(items, page, size) {
  const total = (items || []).length;
  const per = PAGE_SIZES.includes(Number(size)) ? Number(size) : PAGE_SIZES[0];
  const pages = Math.max(1, Math.ceil(total / per));
  const at = Math.min(Math.max(1, Number(page) || 1), pages);
  const start = (at - 1) * per;
  const rows = (items || []).slice(start, start + per);
  return { rows, page: at, pages, total, size: per, from: total ? start + 1 : 0, to: start + rows.length };
}
export const showingLine = (p) => `Showing ${p.from}-${p.to} of ${p.total}`;

export const plural = (n, one, many) => `${n} ${n === 1 ? one : many || `${one}s`}`;

// Chip colours for a role, from the product's own tokens. Admin is always the same; others spread by name.
const TONES = [
  { bg: C.tealSoft, fg: C.teal },
  { bg: C.amberSoft, fg: C.amber },
  { bg: C.greenSoft, fg: C.green },
  { bg: C.paperSoft, fg: C.slate },
  { bg: C.redSoft, fg: C.red },
];
export function roleTone(role) {
  if (role && role.is_admin) return { bg: C.cobaltSoft, fg: C.cobaltDeep };
  const name = String((role && role.name) || "");
  let h = 0;
  for (let i = 0; i < name.length; i += 1) h = (h * 31 + name.charCodeAt(i)) % 997;
  return TONES[h % TONES.length];
}

// ── Permissions ──────────────────────────────────────────────────────────
export const levelOf = (levels, key) => (levels && LEVELS.includes(levels[key]) ? levels[key] : "none");
export const grantedCount = (levels, sections) => (sections || []).filter((s) => levelOf(levels, s.key) !== "none").length;
// An admin role has everything.
export const roleGranted = (role, sections) => (role && role.is_admin ? (sections || []).length : grantedCount(role && role.levels, sections));
export const grantedLine = (n) => `${plural(n, "permission")} granted`;
export const roleListLine = (role, sections) => `${roleGranted(role, sections)} granted · ${plural(Number(role.users) || 0, "user")}`;

export function groupSections(sections) {
  const out = [];
  (sections || []).forEach((s) => {
    let g = out.find((x) => x.name === s.group);
    if (!g) { g = { name: s.group, items: [] }; out.push(g); }
    g.items.push(s);
  });
  return out;
}

// Groups left after a search by name: a group matches by its own name or by any section in it.
export function searchGroups(groups, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return groups;
  return groups.map((g) => {
    if (g.name.toLowerCase().includes(q)) return g;
    const items = g.items.filter((s) => `${s.label} ${s.description || ""}`.toLowerCase().includes(q));
    return items.length ? { ...g, items } : null;
  }).filter(Boolean);
}

// Off, Partial or On for a group of sections.
export function groupState(levels, items) {
  const on = grantedCount(levels, items);
  const state = on === 0 ? "off" : on === items.length ? "on" : "partial";
  return { on, total: items.length, state, label: { off: "Off", on: "On", partial: "Partial" }[state] };
}

export const setLevel = (levels, key, level) => ({ ...levels, [key]: LEVELS.includes(level) ? level : "none" });
export function setGroupLevel(levels, items, level) {
  const next = { ...levels };
  items.forEach((s) => { next[s.key] = LEVELS.includes(level) ? level : "none"; });
  return next;
}
export function sameLevels(a, b, sections) {
  return (sections || []).every((s) => levelOf(a, s.key) === levelOf(b, s.key));
}

// ── People in a role ─────────────────────────────────────────────────────
export const peopleIn = (users, roleId) => (users || []).filter((u) => userRoles(u).some((r) => r.id === roleId));
export const peopleNotIn = (users, roleId) => (users || []).filter((u) => !userRoles(u).some((r) => r.id === roleId));
export const peopleLine = (n, roleName) => `${plural(n, "person is", "people are")} in ${roleName}.`;
export function roleIdsAfterAdd(user, roleId) {
  const ids = userRoles(user).map((r) => r.id);
  return ids.includes(roleId) ? ids : [...ids, roleId];
}
// Moving takes the person out of `fromId` and into `toId`; their other roles stay.
export function roleIdsAfterMove(user, fromId, toId) {
  const ids = userRoles(user).map((r) => r.id).filter((id) => id !== fromId);
  return ids.includes(toId) ? ids : [...ids, toId];
}
