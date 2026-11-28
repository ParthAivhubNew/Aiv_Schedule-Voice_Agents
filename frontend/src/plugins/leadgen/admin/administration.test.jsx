import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../api/apiClient", () => ({ api: new Proxy({}, { get: () => () => new Promise(() => {}) }) }));
vi.mock("../../../hub/Avatar", () => ({ Avatar: () => null }));
vi.mock("../../../brand/brandApi", () => ({ getOrgPolicy: () => new Promise(() => {}) }));

import {
  filterUsers, formatDate, formatLastLogin, grantedCount, grantedLine, groupSections, groupState, nextSort, paginate, peopleLine,
  roleChips, roleIdsAfterAdd, roleIdsAfterMove, roleListLine, roleTone, searchGroups, setGroupLevel, setLevel, showingLine, sortUsers, userStatus, sameLevels,
} from "./adminLogic";
import { isActiveItem, roleOffBody, toggleLabel } from "./adminLogic";
import { AccessEditor, ADMIN_SEES_ALL_LINE, useAccessDraft } from "./AccessEditor";
import { ACCESS_OFF_LINE, announceAccessOff, isAccessOff } from "../../../api/authStore";
import { AdministrationBody, NOT_ADMIN_LINE } from "./AdministrationView";
import { EMPTY_USERS, NO_USERS_YET, RoleInfo, UserDrawer, UserManagementBody } from "./UserManagement";
import { roleCapabilities } from "./adminLogic";
import { NO_ROLES, PeoplePanel, PermissionsPanel, RoleManagementBody, ADMIN_NO_DELETE_LINE, ADMIN_ROLE_LINE, SYSTEM_ROLE_LINE } from "./RoleManagement";

const src = (f) => readFileSync(new URL(`./${f}`, import.meta.url), "utf8");
const plugin = readFileSync(new URL("../LeadGenerationPlugin.jsx", import.meta.url), "utf8");
const html = (el) => renderToStaticMarkup(el);
const noop = () => {};

const rAdmin = { id: "r1", name: "Admin", is_admin: true, is_system: true, users: 1, levels: { calling: "full", leadgen: "full" }, description: "" };
const rOp = { id: "r2", name: "Operator", is_admin: false, is_system: true, users: 2, levels: { calling: "full", leadgen: "view", email: "none" }, description: "Makes calls." };
const rCustom = { id: "r3", name: "Analyst", is_admin: false, is_system: false, users: 0, levels: {}, description: "" };
const roles = [rAdmin, rOp, rCustom];
const sections = [
  { key: "calling", label: "Calling", group: "Voice", description: "Dialling and live calls." },
  { key: "analytics", label: "Analytics", group: "Voice", description: "Results." },
  { key: "leadgen", label: "Leads", group: "Growth", description: "Finding companies." },
  { key: "email", label: "Email outreach", group: "Growth", description: "Campaigns." },
  { key: "calcom", label: "Meetings", group: "Meetings", description: "Bookings." },
];
const mk = (id, name, over = {}) => ({ id, name, username: id, email: `${id}@x.org`, is_active: true, is_admin: false, member_since: "2026-11-02T10:00:00", last_login_at: null, roles: [{ id: "r2", name: "Operator", is_admin: false }], ...over });
const users = [
  mk("u1", "Ada Boss", { is_admin: true, roles: [{ id: "r1", name: "Admin", is_admin: true }], last_login_at: "2026-11-18T09:00:00" }),
  mk("u2", "Sam Lee", { member_since: "2026-08-05T10:00:00" }),
  mk("u3", "Zed Off", { is_active: false, member_since: "2026-09-05T10:00:00", last_login_at: "2026-10-01T09:00:00" }),
];

describe("user helpers", () => {
  it("counts roles for the chips", () => {
    const c = roleChips(users, roles);
    expect(c.map((x) => `${x.name} ${x.count}`)).toEqual(["All 3", "Admin 1", "Operator 2", "Analyst 0"]);
  });
  it("filters by role and by search", () => {
    expect(filterUsers(users, { roleId: "r2" }).map((u) => u.id)).toEqual(["u2", "u3"]);
    expect(filterUsers(users, { query: "ADA" }).map((u) => u.id)).toEqual(["u1"]);
    expect(filterUsers(users, { query: "operator" })).toHaveLength(2);
    expect(filterUsers(users, { roleId: "r1", query: "sam" })).toEqual([]);
  });
  it("sorts by each column and flips direction", () => {
    expect(sortUsers(users, "user", "asc").map((u) => u.id)).toEqual(["u1", "u2", "u3"]);
    expect(sortUsers(users, "user", "desc").map((u) => u.id)).toEqual(["u3", "u2", "u1"]);
    expect(sortUsers(users, "created", "desc").map((u) => u.id)).toEqual(["u1", "u3", "u2"]);
    expect(sortUsers(users, "last_login", "desc").map((u) => u.id)).toEqual(["u1", "u3", "u2"]);
    expect(sortUsers(users, "status", "asc")[0].id).toBe("u1");
    expect(sortUsers(users, "role", "asc")[0].id).toBe("u1");
    expect(nextSort({ key: "user", dir: "asc" }, "user")).toEqual({ key: "user", dir: "desc" });
    expect(nextSort({ key: "user", dir: "asc" }, "created")).toEqual({ key: "created", dir: "desc" });
  });
  it("pages and words the range", () => {
    const many = Array.from({ length: 52 }, (_, i) => i);
    const p = paginate(many, 1, 10);
    expect(p).toMatchObject({ pages: 6, from: 1, to: 10, total: 52 });
    expect(showingLine(p)).toBe("Showing 1-10 of 52");
    expect(paginate(many, 99, 10)).toMatchObject({ page: 6, from: 51, to: 52 });
    expect(paginate(many, 1, 25).pages).toBe(3);
    expect(paginate(many, 1, 7).size).toBe(10);
    expect(paginate([], 1, 10)).toMatchObject({ from: 0, to: 0, pages: 1 });
  });
  it("formats dates and status", () => {
    expect(formatDate("2026-11-02T10:00:00")).toBe("02-11-2026");
    expect(formatLastLogin(null)).toBe("Never");
    expect(userStatus({ is_active: false })).toBe("inactive");
    expect(userStatus({})).toBe("active");
  });
  it("colours the admin role the same way every time", () => {
    expect(roleTone({ is_admin: true, name: "Admin" })).toEqual(roleTone({ is_admin: true, name: "Other" }));
    expect(roleTone({ name: "Staff" })).toEqual(roleTone({ name: "Staff" }));
  });
});

describe("permission helpers", () => {
  it("counts granted sections and words the lines", () => {
    expect(grantedCount(rOp.levels, sections)).toBe(2);
    expect(grantedLine(1)).toBe("1 permission granted");
    expect(grantedLine(13)).toBe("13 permissions granted");
    expect(roleListLine(rOp, sections)).toBe("2 granted · 2 users");
    expect(roleListLine(rAdmin, sections)).toBe("5 granted · 1 user");
  });
  it("groups by the section group, searches and finds Partial/On/Off", () => {
    const g = groupSections(sections);
    expect(g.map((x) => x.name)).toEqual(["Voice", "Growth", "Meetings"]);
    expect(searchGroups(g, "email").map((x) => x.name)).toEqual(["Growth"]);
    expect(searchGroups(g, "email")[0].items).toHaveLength(1);
    expect(searchGroups(g, "voice")[0].items).toHaveLength(2);
    expect(searchGroups(g, "zzz")).toEqual([]);
    expect(groupState(rOp.levels, g[1].items)).toMatchObject({ on: 1, total: 2, state: "partial", label: "Partial" });
    expect(groupState({}, g[0].items).label).toBe("Off");
    expect(groupState({ calling: "view", analytics: "full" }, g[0].items).label).toBe("On");
  });
  it("sets one section or a whole group, and spots changes", () => {
    const g = groupSections(sections);
    const a = setLevel({}, "calling", "view");
    expect(a.calling).toBe("view");
    expect(setLevel(a, "calling", "bogus").calling).toBe("none");
    const b = setGroupLevel(a, g[0].items, "full");
    expect(b).toMatchObject({ calling: "full", analytics: "full" });
    expect(sameLevels({ calling: "none" }, {}, sections)).toBe(true);
    expect(sameLevels(a, {}, sections)).toBe(false);
  });
  it("moves people between roles", () => {
    const u = mk("u9", "Multi", { roles: [{ id: "r2", name: "Operator" }, { id: "r3", name: "Analyst" }] });
    expect(roleIdsAfterAdd(u, "r1")).toEqual(["r2", "r3", "r1"]);
    expect(roleIdsAfterAdd(u, "r2")).toEqual(["r2", "r3"]);
    expect(roleIdsAfterMove(u, "r2", "r1")).toEqual(["r3", "r1"]);
    expect(roleIdsAfterMove(u, "r2", "r3")).toEqual(["r3"]);
    expect(peopleLine(7, "Staff")).toBe("7 people are in Staff.");
    expect(peopleLine(1, "Staff")).toBe("1 person is in Staff.");
  });
});

describe("User management", () => {
  const base = { users, roles, me: users[0], onAdd: noop, onEdit: noop, onDelete: noop };
  it("shows a loading state", () => {
    const h = html(<UserManagementBody {...base} users={null} />);
    expect(h).toContain("Loading users");
    expect(h).toContain("Add user");
  });
  it("shows an error with a retry button", () => {
    const h = html(<UserManagementBody {...base} users={null} error="Couldn't load users." onRetry={noop} />);
    expect(h).toContain('role="alert"');
    expect(h).toContain("Try again");
  });
  it("says so when there are no users, and when the filter hides them all", () => {
    expect(html(<UserManagementBody {...base} users={[]} />)).toContain(NO_USERS_YET);
    expect(html(<UserManagementBody {...base} initial={{ query: "nobody" }} />)).toContain(EMPTY_USERS);
  });
  it("shows rows, role chips with counts, status, crown, sortable headers and paging", () => {
    const h = html(<UserManagementBody {...base} />);
    expect(h).toContain("User management");
    expect(h).toContain("Filter users");
    expect(h).toContain("All 3");
    expect(h).toContain("Operator 2");
    expect(h).toContain("Ada Boss");
    expect(h).toContain('title="Administrator"');
    expect(h).toContain(">active<");
    expect(h).toContain(">inactive<");
    expect(h).toContain("02-11-2026");
    expect(h).toContain("Never");
    expect(h).toContain('aria-sort="descending"');
    expect(h).toContain("Sort by Last login");
    expect(h).toContain("Showing 1-3 of 3");
    expect(h).toContain("Page 1 of 1");
    expect(h).toContain('aria-label="Edit Sam Lee"');
    expect(h).toContain("Page size");
  });
  it("keeps you from deleting yourself and filters by the chosen role", () => {
    const h = html(<UserManagementBody {...base} initial={{ roleId: "r1" }} />);
    expect(h).toMatch(/aria-label="Delete Ada Boss"[^>]*disabled/);
    expect(h).not.toContain("Sam Lee");
    expect(h).toContain('aria-pressed="true"');
  });
  it("sets the drawer fields and labels", () => {
    const h = html(<UserDrawer user={users[1]} roles={roles} me={users[0]} onClose={noop} onSaved={noop} />);
    expect(h).toContain('role="dialog"');
    expect(h).toContain("Sam Lee&#x27;s profile");
    expect(h).toContain('for="adm-f-name"');
    expect(h).toContain('for="adm-f-email"');
    expect(h).toContain("Roles");
    expect(h).toContain("Active (");
    expect(h).not.toContain("Open Data access");
    expect(h).toContain("Loading data access"); // the saved access arrives from the server
    const add = html(<UserDrawer user={null} roles={roles} me={users[0]} onClose={noop} onSaved={noop} />);
    expect(add).toContain("Add user");
    expect(add).toContain("Username");
    expect(add).toContain("Create user");
    expect(add).toContain("Only these postcodes"); // data access is set when the person is added
    expect(add).toMatch(/id="adm-role-r\d+"[^>]*checked/); // the starting role is ticked on screen, not chosen out of sight
    const own = html(<UserDrawer user={users[0]} roles={roles} me={users[0]} onClose={noop} onSaved={noop} />);
    expect(own).toContain("You cannot disable your own account.");
    expect(own).toContain(ADMIN_SEES_ALL_LINE);
    expect(own).not.toContain("Only these postcodes");
    expect(own).toContain('for="adm-f-name"');
    expect(html(<UserDrawer user={null} roles={roles} me={users[0]} onClose={noop} onSaved={noop} initialTemp={{ value: "Temp-123", who: "Neo", emailed: false }} />)).toContain("Temp-123");
  });
});

const access = { districts: ["BN1"], allow_export: true, allow_google: false };
const trio = (h, name, on) => {
  expect(h).toContain(`aria-label="${on ? "Switch off" : "Switch on"} ${name}"`);
  expect(h).toContain(`title="${on ? "Switch off" : "Switch on"} ${name}"`);
  expect(h).toContain(`aria-label="Edit ${name}"`);
  expect(h).toContain(`title="Edit ${name}"`);
  expect(h).toContain(`aria-label="Delete ${name}"`);
};

describe("switching off and on", () => {
  it("words the labels and the confirm", () => {
    expect(toggleLabel("Senior Management", true)).toBe("Switch off Senior Management");
    expect(toggleLabel("Senior Management", false)).toBe("Switch on Senior Management");
    expect(isActiveItem({})).toBe(true);
    expect(isActiveItem({ is_active: false })).toBe(false);
    expect(roleOffBody(7)).toBe("7 people will be switched off unless they have another active role.");
    expect(roleOffBody(1)).toContain("1 person will be switched off");
  });
  it("gives every user row the same three buttons, in the right colours", () => {
    const h = html(<UserManagementBody users={users} roles={roles} me={users[0]} onAdd={noop} onEdit={noop} onDelete={noop} onToggle={noop} />);
    trio(h, "Sam Lee", true);
    trio(h, "Zed Off", false);
    expect(h).toContain("adm-icon--off");
    expect(h).toContain("adm-icon--on");
    expect(h).toContain("adm-icon--del");
    expect(h).toMatch(/aria-label="Switch off Ada Boss"[^>]*disabled/); // not your own account
    expect(h.match(/class="adm-row-off"/g)).toHaveLength(1); // only the inactive person is dimmed
    expect(h).toContain(">inactive<");
  });
  it("opens the profile from the name", () => {
    const h = html(<UserManagementBody users={users} roles={roles} me={users[0]} onAdd={noop} onEdit={noop} onDelete={noop} onToggle={noop} />);
    expect(h).toMatch(/class="adm-namebtn" title="Open Sam Lee&#x27;s profile"[^>]*>Sam Lee</);
  });
  it("gives every role card the same three buttons, a count line and an Inactive chip", () => {
    const list = [rAdmin, { ...rOp, users: 7 }, { ...rCustom, is_active: false }];
    const h = html(<RoleManagementBody roles={list} sections={sections} users={users} selectedId="r2" onSelect={noop} onNew={noop} onSaveLevels={noop} onSaveMeta={noop} onDelete={noop} onToggle={noop} onAddPeople={noop} onMove={noop} />);
    trio(h, "Operator", true);
    trio(h, "Analyst", false);
    expect(h).toContain("2 granted · 7 users");
    expect(h).toContain(">Inactive<");
    expect(h).toContain("adm-roleitem-off");
    expect(h.match(/class="adm-rolecard adm-roleitem-off"/g)).toHaveLength(1);
    expect(h.match(/aria-label="Delete Operator"/g)).toHaveLength(1); // one set of buttons, not two
  });
  it("lets every role be deleted except the Admin role", () => {
    const list = [rAdmin, rOp, rCustom, { ...rOp, id: "r9", name: "Viewer", is_system: true }];
    const h = html(<RoleManagementBody roles={list} sections={sections} users={users} selectedId="r2" onSelect={noop} onNew={noop} onSaveLevels={noop} onSaveMeta={noop} onDelete={noop} onToggle={noop} onAddPeople={noop} onMovePerson={noop} />);
    expect(h).toMatch(/aria-label="Delete Admin"[^>]*disabled/);
    expect(h).toContain(ADMIN_NO_DELETE_LINE);
    for (const name of ["Operator", "Analyst", "Viewer"]) expect(h).not.toMatch(new RegExp(`aria-label="Delete ${name}"[^>]*disabled`));
    expect(SYSTEM_ROLE_LINE).not.toMatch(/cannot be deleted/);
  });
  it("lets an inactive role still be edited", () => {
    const h = html(<RoleManagementBody roles={[{ ...rCustom, is_active: false }]} sections={sections} users={users} selectedId="r3" onSelect={noop} onNew={noop} onSaveLevels={noop} onSaveMeta={noop} onDelete={noop} onToggle={noop} onAddPeople={noop} onMove={noop} />);
    expect(h).toContain("Role Analyst");
    expect(h).not.toMatch(/aria-label="Edit Analyst"[^>]*disabled/);
  });
  it("calls the real endpoints with only is_active", () => {
    expect(src("RoleManagement.jsx")).toContain("api.updateRole(role.id, { is_active: !on })");
    expect(src("UserManagement.jsx")).toContain("api.updateUser(u.id, { is_active: !on })");
  });
});

describe("User profile", () => {
  const view = (u, extra = {}) => html(<UserDrawer user={u} roles={roles} me={users[0]} onClose={noop} onSaved={noop} initialAccess={access} initialAllowed={["BN1", "BN3"]} {...extra} />);
  it("holds details, roles, active and the full data access editor", () => {
    const h = view(users[1]);
    expect(h).toContain('for="adm-f-name"');
    expect(h).toContain('for="adm-f-email"');
    expect(h).toContain("Roles");
    expect(h).toContain("Active (");
    expect(h).toContain("Data access");
    expect(h).toContain("All postcodes");
    expect(h).toContain("Only these postcodes");
    expect(h).toContain('aria-label="Remove BN1"');
    expect(h).toContain("Add a district, e.g. LS1, M1 or EC2A");
    expect(h).toContain("Can export data");
    expect(h).toContain("Can open live Google details");
    expect(h).toContain("What will they see?");
    expect(h).toContain(">Save<");
  });
  it("shows an admin as seeing everything, with the details still editable", () => {
    const h = view(users[0]);
    expect(h).toContain("Admins see everything");
    expect(h).not.toContain("Only these postcodes");
    expect(h).not.toContain("Can export data");
    expect(h).toContain('for="adm-f-name"');
    expect(h).toContain("Roles");
  });
  it("is saved in one go, with a status for each part", () => {
    const s = src("UserManagement.jsx");
    expect(s).toContain("api.updateUser(user.id, body)");
    expect(s).toContain("api.setDataAccess(user.id, next)");
    expect(s).toContain("Data access was not.");
    expect(s).toContain("Details: ");
    expect(s).toMatch(/role="status" aria-live="polite"/);
  });
});

describe("shared AccessEditor", () => {
  it("renders from a draft and is the editor behind both screens", () => {
    function Probe() {
      const draft = useAccessDraft(access, "u2");
      return <AccessEditor draft={draft} allowed={[]} idBase="probe" />;
    }
    const h = html(<Probe />);
    expect(h).toContain("Only these postcodes");
    expect(h).toContain("Can export data");
    expect(h).toContain('id="probe-export"');
    expect(src("UserManagement.jsx")).toContain("<AccessEditor");
    expect(readFileSync(new URL("../DataAccess.jsx", import.meta.url), "utf8")).toContain("<AccessEditor");
    expect(readFileSync(new URL("../DataAccess.jsx", import.meta.url), "utf8")).not.toContain("setDistricts");
  });
});

describe("access switched off", () => {
  it("recognises the refusal in both body shapes", () => {
    expect(isAccessOff({ code: "access_off", detail: ACCESS_OFF_LINE })).toBe(true);
    expect(isAccessOff({ detail: { code: "access_off", message: "x" } })).toBe(true);
    expect(isAccessOff({ code: "outside_access" })).toBe(false);
    expect(isAccessOff(null)).toBe(false);
  });
  it("keeps the server sentence for the sign-in screen and ends the session", () => {
    const store = {};
    const events = [];
    const mem = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
    vi.stubGlobal("sessionStorage", mem);
    vi.stubGlobal("localStorage", mem);
    vi.stubGlobal("window", { dispatchEvent: (e) => events.push(e.type), matchMedia: () => ({ matches: false }), navigator: {} });
    try {
      announceAccessOff({ code: "access_off", detail: "Your access has been switched off. Ask your administrator." });
      expect(store.aivhub_signout_reason).toBe("access_off");
      expect(store.aivhub_signout_message).toBe(ACCESS_OFF_LINE);
      expect(events).toContain("outreach-auth-lost");
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("is wired into the request layer and the sign-in screen", () => {
    const api = readFileSync(new URL("../../../api/apiClient.js", import.meta.url), "utf8");
    expect(api).toContain("isAccessOff(peek)");
    expect(api).toContain("announceAccessOff(peek)");
    const login = readFileSync(new URL("../../../hub/LoginScreen.jsx", import.meta.url), "utf8");
    expect(login).toContain('"access_off"');
    expect(login).toContain("aivhub_signout_message");
    expect(login).toContain("err.message"); // a refused sign-in shows the server's sentence
  });
});

describe("Role management", () => {
  const base = { roles, sections, users, selectedId: "r2", onSelect: noop, onNew: noop, onSaveLevels: noop, onSaveMeta: noop, onDelete: noop, onAddPeople: noop, onMove: noop };
  it("shows loading, error and empty states", () => {
    expect(html(<RoleManagementBody {...base} roles={null} />)).toContain("Loading roles");
    expect(html(<RoleManagementBody {...base} roles={null} error="Nope" onRetry={noop} />)).toContain("Try again");
    expect(html(<RoleManagementBody {...base} roles={[]} />)).toContain(NO_ROLES);
  });
  it("lists roles with granted and user counts and a disabled Save Changes", () => {
    const h = html(<RoleManagementBody {...base} />);
    expect(h).toContain("Who each role is, what it can do, and who is in it.");
    expect(h).toContain("New role");
    expect(h).toContain("2 granted · 2 users");
    expect(h).toContain("0 granted · 0 users");
    expect(h).toContain("2 permissions granted");
    expect(h).toMatch(/disabled=""[^>]*>Save Changes/);
    expect(h).toContain("Find a permission by name");
    expect(h).toContain("Expand all");
    expect(h).toContain("People");
    expect(h).toContain("Permissions");
    expect(h).toContain(SYSTEM_ROLE_LINE);
  });
  it("shows the groups with N of M on and Partial, plus the three levels", () => {
    const h = html(<PermissionsPanel role={rOp} sections={sections} levels={rOp.levels} onChange={noop} />);
    expect(h).toContain("Voice");
    expect(h).toContain("1 of 2 on");
    expect(h).toContain("Partial");
    expect(h).toContain("Meetings");
    expect(h).toContain(">None<");
    expect(h).toContain(">View<");
    expect(h).toContain(">Full<");
    expect(h).toContain('title="Bookings."');
    const open = html(<PermissionsPanel role={rOp} sections={sections} levels={rOp.levels} onChange={noop} initialOpen={["Growth"]} />);
    expect(open).toContain("Email outreach");
    expect(open).toContain('aria-checked="true"');
  });
  it("searches permissions by name and makes admin roles read-only", () => {
    const f = html(<PermissionsPanel role={rOp} sections={sections} levels={rOp.levels} onChange={noop} initialQuery="email" />);
    expect(f).toContain("Email outreach");
    expect(f).not.toContain("Calling");
    expect(html(<PermissionsPanel role={rOp} sections={sections} levels={{}} onChange={noop} initialQuery="zzz" />)).toContain("No permission matches");
    const a = html(<PermissionsPanel role={rAdmin} sections={sections} levels={rAdmin.levels} onChange={noop} />);
    expect(a).toContain(ADMIN_ROLE_LINE);
    expect(a).toContain("disabled");
  });
  it("shows the People tab with a count, Add people and Move to role", () => {
    const h = html(<PeoplePanel role={rOp} roles={roles} users={users} onAdd={noop} onMove={noop} />);
    expect(h).toContain("2 people are in Operator.");
    expect(h).toContain("Add people");
    expect(h).toContain("Move to");
    expect(h).toContain("role…");
    expect(h).toContain("Sam Lee");
    expect(h).not.toContain("Ada Boss");
    const adding = html(<PeoplePanel role={rOp} roles={roles} users={users} onAdd={noop} onMove={noop} initialAdding />);
    expect(adding).toContain("Pick people to add to Operator");
    expect(adding).toContain("Ada Boss");
    expect(html(<PeoplePanel role={rCustom} roles={roles} users={users} onAdd={noop} onMove={noop} />)).toContain("Nobody has this role yet.");
  });
  it("opens on the People tab when asked", () => {
    expect(html(<RoleManagementBody {...base} initialTab="people" />)).toContain("2 people are in Operator.");
  });
});

describe("Administration page and wiring", () => {
  it("is for admins only", () => {
    expect(html(<AdministrationBody operator={{ is_admin: false, role: "Operator" }} tab="users" onTab={noop}>x</AdministrationBody>)).toContain(NOT_ADMIN_LINE);
    expect(html(<AdministrationBody operator={null} tab="users" onTab={noop}>x</AdministrationBody>)).toContain(NOT_ADMIN_LINE);
  });
  it("shows the three tabs", () => {
    const h = html(<AdministrationBody operator={{ is_admin: true }} tab="roles" onTab={noop}>panel</AdministrationBody>);
    expect(h).toContain("User management");
    expect(h).toContain("Role management");
    expect(h).toContain("Data access");
    expect(h).toContain('aria-selected="true"');
    expect(h).toContain("panel");
  });
  it("replaces Data access and Member list in the Leads menu, for admins only", () => {
    expect(plugin).toMatch(/showDataAccess \? \[\{ id: "administration", label: "Administration"/);
    expect(plugin).not.toContain('id: "data_access", label:');
    expect(plugin).not.toContain('id: "member_list", label:');
    expect(plugin).toMatch(/view === "administration" && showDataAccess && <AdministrationView/);
    expect(plugin).toMatch(/view === "data_access" && showDataAccess && <DataAccess/);
    expect(plugin).toContain('"administration"');
  });
  it("embeds Data access and uses the real APIs", () => {
    const v = src("AdministrationView.jsx");
    expect(v).toContain("<DataAccess />");
    expect(src("UserManagement.jsx")).toContain("api.deleteUser");
    expect(src("RoleManagement.jsx")).toContain("api.updateRole");
    expect(src("RoleManagement.jsx")).toContain("api.getSections");
  });
});

describe("role info in the add-user form", () => {
  const sec = [{ key: "calling", label: "Calling", group: "Voice" }, { key: "leadgen", label: "Lead generation", group: "Leads" }, { key: "email", label: "Email", group: "Leads" }];
  it("gives every role an info button", () => {
    const h = html(<UserDrawer user={null} roles={roles} sections={sec} me={users[0]} onClose={noop} onSaved={noop} />);
    roles.forEach((r) => expect(h).toContain(`aria-label="What the ${r.name} role can do"`));
    expect(h).toContain('aria-expanded="false"');
  });
  it("lists what a role can change, what it can only view, and that an admin can do everything", () => {
    expect(roleCapabilities(rOp, sec)).toEqual({ all: false, full: ["Calling"], view: ["Lead generation"] });
    expect(roleCapabilities(rAdmin, sec).all).toBe(true);
    const h = html(<RoleInfo role={rOp} sections={sec} id="x" />);
    expect(h).toContain("Can use and change:");
    expect(h).toContain("Calling");
    expect(h).toContain("Can only view:");
    expect(h).not.toContain("Email");
  });
});
