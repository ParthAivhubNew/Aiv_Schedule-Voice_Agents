// Every change on the Administration page is asked about twice before anything is sent to the server.
// Step 1 lists exactly what will change. Step 2 asks "Are you sure?". Cancel, Escape or a click outside at either step returns false.
import { askConfirm } from "../Dialogs";
import { LEVEL_NAMES, levelOf, plural, userRoles } from "./adminLogic";

export const REVIEW_TITLE = "Review your change";
export const REVIEW_CONTINUE = "Continue";
export const SURE_TITLE = "Are you sure?";
export const SURE_BODY = "This takes effect straight away.";
export const SURE_CONFIRM = "Yes, make the change";
export const SURE_BACK = "Go back";

// While a two-step question is open, Escape belongs to the question and must not also close the screen behind it.
let asking = 0;
export const isAskingTwice = () => asking > 0;

const bullets = (lines) => lines.map((l) => `- ${l}`).join("\n");
export const summaryLine = (n, subject) => `${plural(n, "change")}${subject ? ` to ${subject}` : ""}`;

// Resolves true only when the person says yes at both steps. `title` says what is being done; `changes` is the plain list.
export async function confirmTwice({ title, changes = [], danger = false, confirmLabel = SURE_CONFIRM, subject = "", summary = "" }) {
  const list = (changes || []).filter(Boolean);
  asking += 1;
  try {
    const first = await askConfirm({ title: REVIEW_TITLE, body: `${title}${list.length ? `\n\n${bullets(list)}` : ""}`, confirm: REVIEW_CONTINUE, cancel: "Cancel" });
    if (!first) return false;
    const second = await askConfirm({ title: SURE_TITLE, body: `${SURE_BODY}\n${summary || summaryLine(list.length, subject)}`, confirm: confirmLabel, cancel: SURE_BACK, danger });
    return !!second;
  } finally {
    asking -= 1;
  }
}

// ── Postcodes and access ─────────────────────────────────────────────────
const uniqSorted = (l) => [...new Set((l || []).map(String))].sort();
const joinList = (l) => l.join(", ");

export function postcodeDiff(before, after) {
  const a = uniqSorted(before);
  const b = uniqSorted(after);
  return { added: b.filter((x) => !a.includes(x)), removed: a.filter((x) => !b.includes(x)) };
}

// saved: { districts, allow_export, allow_google } (or null). draft: { districts, only, allowExport, allowGoogle }.
export function accessChanges(saved, draft) {
  const s = saved || {};
  const out = [];
  const wasOnly = (s.districts || []).length > 0;
  if (!!draft.only !== wasOnly) out.push(`Change from ${wasOnly ? "Only these postcodes" : "All postcodes"} to ${draft.only ? "Only these postcodes" : "All postcodes"}`);
  const { added, removed } = postcodeDiff(s.districts, draft.districts);
  if (added.length) out.push(`Add ${added.length === 1 ? "postcode" : "postcodes"} ${joinList(added)}`);
  if (removed.length) out.push(`Remove ${removed.length === 1 ? "postcode" : "postcodes"} ${joinList(removed)}`);
  const exp = s.allow_export !== false;
  if (draft.allowExport !== exp) out.push(`Turn export ${draft.allowExport ? "on" : "off"}`);
  const google = s.allow_google !== false;
  if (draft.allowGoogle !== google) out.push(`Turn live Google details ${draft.allowGoogle ? "on" : "off"}`);
  return out;
}

// ── People ───────────────────────────────────────────────────────────────
const roleName = (roles, id, fallback = "an unknown role") => ((roles || []).find((r) => r.id === id) || {}).name || fallback;

export function roleSetChanges(beforeIds, afterIds, roles, fallbackNames = {}) {
  const name = (id) => roleName(roles, id, fallbackNames[id] || "an unknown role");
  const before = [...new Set(beforeIds || [])];
  const after = [...new Set(afterIds || [])];
  const added = after.filter((id) => !before.includes(id));
  const removed = before.filter((id) => !after.includes(id));
  if (!added.length && !removed.length) return [];
  if (before.length === 1 && after.length === 1) return [`Change role from ${name(before[0])} to ${name(after[0])}`];
  const out = [];
  if (added.length) out.push(`Add ${added.length === 1 ? "role" : "roles"} ${joinList(added.map(name))}`);
  if (removed.length) out.push(`Remove ${removed.length === 1 ? "role" : "roles"} ${joinList(removed.map(name))}`);
  return out;
}

// user: the saved person. next: { name, email, roleIds, active }.
export function userChanges(user, next, roles) {
  const out = [];
  const oldName = user.name || "";
  if ((next.name || "").trim() !== oldName.trim()) out.push(`Change name from ${oldName || "blank"} to ${(next.name || "").trim() || "blank"}`);
  const oldEmail = user.email || "";
  if ((next.email || "").trim() !== oldEmail.trim()) out.push(`Change email from ${oldEmail || "none"} to ${(next.email || "").trim() || "none"}`);
  const fallback = Object.fromEntries(userRoles(user).map((r) => [r.id, r.name]));
  out.push(...roleSetChanges(userRoles(user).map((r) => r.id), next.roleIds, roles, fallback));
  if (next.active !== undefined && next.active !== (user.is_active !== false)) out.push(next.active ? `Switch on ${oldName}` : `Switch off ${oldName}: they are signed out and lose access until you switch them on again`);
  return out;
}

export function newUserChanges(form, roleIds, roles) {
  const out = [`Add the user ${form.name.trim()} (@${form.username.trim().toLowerCase()})`];
  if (form.email.trim()) out.push(`Email ${form.email.trim()}`);
  const names = (roleIds || []).map((id) => roleName(roles, id)).filter(Boolean);
  out.push(names.length ? `${names.length === 1 ? "Role" : "Roles"}: ${joinList(names)}` : "No role chosen");
  out.push("A temporary password is made for them");
  return out;
}

export const deleteUserChanges = (u) => [`Delete the user ${u.name}: they are signed out and lose access. This cannot be undone`];
export const switchUserChanges = (u, turnOn) => [turnOn ? `Switch on ${u.name}: they can sign in again` : `Switch off ${u.name}: they are signed out and lose access until you switch them on again`];

// ── Roles ────────────────────────────────────────────────────────────────
export function roleMetaChanges(role, m) {
  const out = [];
  if ((m.name || "").trim() !== (role.name || "").trim()) out.push(`Rename role from ${role.name} to ${(m.name || "").trim()}`);
  const d = (m.description || "").trim();
  if (d !== (role.description || "").trim()) out.push(d ? `Change the description to ${d}` : "Clear the description");
  if (!!m.is_admin !== !!role.is_admin) out.push(m.is_admin ? "Make this an admin role with full access" : "Take full admin access away from this role");
  return out;
}

export function newRoleChanges(m) {
  const out = [`Create the role ${(m.name || "").trim()}`];
  if ((m.description || "").trim()) out.push(`Description: ${m.description.trim()}`);
  if (m.is_admin) out.push("Admin role with full access to everything");
  return out;
}

export function roleLevelChanges(before, after, sections) {
  return (sections || []).filter((s) => levelOf(before, s.key) !== levelOf(after, s.key))
    .map((s) => `Permissions: ${s.label} ${LEVEL_NAMES[levelOf(before, s.key)]} → ${LEVEL_NAMES[levelOf(after, s.key)]}`);
}

export function switchRoleChanges(role, turnOn) {
  if (turnOn) return [`Switch on the role ${role.name}`];
  const n = Number(role.users) || 0;
  return [n ? `Switch off the role ${role.name}: ${plural(n, "person", "people")} will lose access unless they have another active role` : `Switch off the role ${role.name}: nobody has it yet, so nobody loses access`];
}

export function deleteRoleChanges(role) {
  const n = Number(role.users) || 0;
  const out = [`Delete the role ${role.name}. This cannot be undone`];
  if (n) out.push(`${plural(n, "person", "people")} still ${n === 1 ? "has" : "have"} this role, so it cannot be deleted until you move them`);
  return out;
}

export const addPeopleChanges = (role, list) => list.map((u) => `Add ${u.name} to ${role.name}`);
export const movePersonChanges = (role, u, toName) => [`Move ${u.name} from ${role.name} to ${toName}`];
