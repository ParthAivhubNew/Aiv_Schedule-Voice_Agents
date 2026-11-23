import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const askConfirm = vi.fn();
vi.mock("../Dialogs", () => ({ askConfirm: (...a) => askConfirm(...a) }));

import {
  accessChanges, addPeopleChanges, confirmTwice, deleteRoleChanges, isAskingTwice, movePersonChanges, newRoleChanges, newUserChanges, postcodeDiff,
  roleLevelChanges, roleMetaChanges, roleSetChanges, summaryLine, switchRoleChanges, switchUserChanges, userChanges,
} from "./confirmChange";

const roles = [{ id: "r1", name: "FSB Operator" }, { id: "r2", name: "Manager" }, { id: "r3", name: "Analyst" }];
const src = (f) => readFileSync(new URL(`./${f}`, import.meta.url), "utf8");

describe("confirmTwice", () => {
  beforeEach(() => askConfirm.mockReset());
  it("asks review then are-you-sure, in order, and resolves true", async () => {
    askConfirm.mockResolvedValue(true);
    const ok = await confirmTwice({ title: "Save Sam?", changes: ["Turn export off", "Add postcode LS1"], subject: "Sam Lee" });
    expect(ok).toBe(true);
    expect(askConfirm).toHaveBeenCalledTimes(2);
    const [one, two] = askConfirm.mock.calls.map((c) => c[0]);
    expect(one.title).toBe("Review your change");
    expect(one.confirm).toBe("Continue");
    expect(one.body).toContain("- Turn export off\n- Add postcode LS1");
    expect(two.title).toBe("Are you sure?");
    expect(two.body).toBe("This takes effect straight away.\n2 changes to Sam Lee");
    expect(two.confirm).toBe("Yes, make the change");
    expect(two.cancel).toBe("Go back");
    expect(two.danger).toBe(false);
  });
  it("passes danger to step 2 only", async () => {
    askConfirm.mockResolvedValue(true);
    await confirmTwice({ title: "Delete?", changes: ["x"], danger: true });
    expect(askConfirm.mock.calls[0][0].danger).toBeUndefined();
    expect(askConfirm.mock.calls[1][0].danger).toBe(true);
  });
  it("cancel at step 1 stops there", async () => {
    askConfirm.mockResolvedValueOnce(false);
    expect(await confirmTwice({ title: "t", changes: ["x"] })).toBe(false);
    expect(askConfirm).toHaveBeenCalledTimes(1);
    expect(isAskingTwice()).toBe(false);
  });
  it("cancel at step 2 returns false", async () => {
    askConfirm.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect(await confirmTwice({ title: "t", changes: ["x"] })).toBe(false);
    expect(askConfirm).toHaveBeenCalledTimes(2);
  });
  it("a caller that gates on it never calls the api when cancelled", async () => {
    const send = vi.fn();
    for (const answers of [[false], [true, false]]) {
      askConfirm.mockReset();
      answers.forEach((a) => askConfirm.mockResolvedValueOnce(a));
      if (await confirmTwice({ title: "t", changes: ["x"] })) send();
    }
    expect(send).not.toHaveBeenCalled();
    askConfirm.mockReset();
    askConfirm.mockResolvedValue(true);
    if (await confirmTwice({ title: "t", changes: ["x"] })) send();
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("marks itself as asking while open", async () => {
    let during = false;
    askConfirm.mockImplementation(async () => { during = isAskingTwice(); return false; });
    await confirmTwice({ title: "t", changes: [] });
    expect(during).toBe(true);
    expect(isAskingTwice()).toBe(false);
  });
  it("counts changes", () => {
    expect(summaryLine(1, "Sam Lee")).toBe("1 change to Sam Lee");
    expect(summaryLine(3, "")).toBe("3 changes");
  });
});

describe("postcode and access diffs", () => {
  it("sorts adds and removes", () => {
    expect(postcodeDiff(["BN5", "LS1"], ["M2", "LS1", "LS1", "B1"])).toEqual({ added: ["B1", "M2"], removed: ["BN5"] });
    expect(postcodeDiff([], [])).toEqual({ added: [], removed: [] });
  });
  const saved = { districts: ["BN5"], allow_export: true, allow_google: true };
  it("lists adds, removes, mode and switches", () => {
    expect(accessChanges(saved, { only: true, districts: ["BN5", "M2", "LS1"], allowExport: true, allowGoogle: true })).toEqual(["Add postcodes LS1, M2"]);
    expect(accessChanges(saved, { only: true, districts: [], allowExport: false, allowGoogle: false })).toEqual(["Remove postcode BN5", "Turn export off", "Turn live Google details off"]);
    expect(accessChanges(saved, { only: false, districts: [], allowExport: true, allowGoogle: true })).toEqual(["Change from Only these postcodes to All postcodes", "Remove postcode BN5"]);
    expect(accessChanges({ districts: [] }, { only: true, districts: ["LS1"], allowExport: true, allowGoogle: true })).toEqual(["Change from All postcodes to Only these postcodes", "Add postcode LS1"]);
    expect(accessChanges({ districts: [], allow_export: false }, { only: false, districts: [], allowExport: true, allowGoogle: true })).toEqual(["Turn export on"]);
  });
  it("is empty when nothing changed", () => {
    expect(accessChanges(saved, { only: true, districts: ["BN5"], allowExport: true, allowGoogle: true })).toEqual([]);
    expect(accessChanges(null, { only: false, districts: [], allowExport: true, allowGoogle: true })).toEqual([]);
  });
});

describe("people diffs", () => {
  const user = { name: "Sam Lee", email: "sam@x.org", is_active: true, roles: [{ id: "r1", name: "FSB Operator" }] };
  it("shows a single role swap", () => {
    expect(roleSetChanges(["r1"], ["r2"], roles)).toEqual(["Change role from FSB Operator to Manager"]);
    expect(roleSetChanges(["r1"], ["r1"], roles)).toEqual([]);
  });
  it("shows added and removed roles when there are several", () => {
    expect(roleSetChanges(["r1"], ["r1", "r2", "r3"], roles)).toEqual(["Add roles Manager, Analyst"]);
    expect(roleSetChanges(["r1", "r2"], ["r2"], roles)).toEqual(["Remove role FSB Operator"]);
    expect(roleSetChanges([], ["r2"], roles)).toEqual(["Add role Manager"]);
  });
  it("lists name, email, role and active changes", () => {
    const next = { name: "Samuel Lee", email: "", roleIds: ["r2"], active: false };
    expect(userChanges(user, next, roles)).toEqual([
      "Change name from Sam Lee to Samuel Lee", "Change email from sam@x.org to none", "Change role from FSB Operator to Manager",
      "Switch off Sam Lee: they are signed out and lose access until you switch them on again",
    ]);
    expect(userChanges(user, { name: "Sam Lee", email: "sam@x.org", roleIds: ["r1"], active: true }, roles)).toEqual([]);
    expect(userChanges(user, { name: "Sam Lee", email: "sam@x.org", roleIds: ["r1"] }, roles)).toEqual([]);
  });
  it("describes a new user and switches", () => {
    const l = newUserChanges({ name: " Ann ", username: " Ann1 ", email: "a@x.org" }, ["r2"], roles);
    expect(l[0]).toBe("Add the user Ann (@ann1)");
    expect(l).toContain("Role: Manager");
    expect(switchUserChanges(user, true)[0]).toContain("Switch on Sam Lee");
    expect(switchUserChanges(user, false)[0]).toContain("Switch off Sam Lee");
  });
});

describe("role diffs", () => {
  const sections = [{ key: "leadgen", label: "Leads" }, { key: "email", label: "Email outreach" }];
  it("lists each section level change", () => {
    expect(roleLevelChanges({ leadgen: "none", email: "view" }, { leadgen: "full", email: "view" }, sections)).toEqual(["Permissions: Leads None → Full"]);
    expect(roleLevelChanges({}, {}, sections)).toEqual([]);
    expect(roleLevelChanges({ leadgen: "full" }, { email: "view" }, sections)).toHaveLength(2);
  });
  it("lists rename, description and admin changes", () => {
    const role = { name: "A", description: "old", is_admin: false };
    expect(roleMetaChanges(role, { name: "B", description: "", is_admin: true })).toEqual(["Rename role from A to B", "Clear the description", "Make this an admin role with full access"]);
    expect(roleMetaChanges(role, { name: "A", description: "old", is_admin: false })).toEqual([]);
    expect(newRoleChanges({ name: "Ops", description: "x", is_admin: false })).toEqual(["Create the role Ops", "Description: x"]);
  });
  it("words switch off, delete, add and move", () => {
    expect(switchRoleChanges({ name: "Senior Management", users: 7 }, false)[0]).toBe("Switch off the role Senior Management: 7 people will lose access unless they have another active role");
    expect(switchRoleChanges({ name: "X", users: 0 }, false)[0]).toContain("nobody loses access");
    expect(switchRoleChanges({ name: "X" }, true)).toEqual(["Switch on the role X"]);
    expect(deleteRoleChanges({ name: "X", users: 1 })[1]).toContain("1 person still has this role");
    expect(deleteRoleChanges({ name: "X", users: 0 })).toHaveLength(1);
    expect(addPeopleChanges({ name: "Ops" }, [{ name: "Ann" }, { name: "Bo" }])).toEqual(["Add Ann to Ops", "Add Bo to Ops"]);
    expect(movePersonChanges({ name: "Ops" }, { name: "Ann" }, "Sales")).toEqual(["Move Ann from Ops to Sales"]);
  });
});

describe("every mutating handler asks twice before its api call", () => {
  const before = (file, call) => {
    const s = src(file);
    const at = s.indexOf(call);
    expect(at, `${file} ${call}`).toBeGreaterThan(-1);
    const head = s.slice(Math.max(0, at - 900), at);
    expect(head, `${file} ${call}`).toContain("confirmTwice(");
    expect(head.slice(head.lastIndexOf("confirmTwice(")), `${file} ${call}`).toMatch(/return false;|if \(!\w+\) return;|if \(ok\) \{/);
  };
  it("users", () => {
    before("UserManagement.jsx", "api.createUser(");
    before("UserManagement.jsx", "api.updateUser(user.id");
    before("UserManagement.jsx", "api.setDataAccess(");
    before("UserManagement.jsx", "api.deleteUser(");
    before("UserManagement.jsx", "api.updateUser(u.id");
  });
  it("roles", () => {
    before("RoleManagement.jsx", "api.createRole(");
    before("RoleManagement.jsx", "api.updateRole(role.id, body(role, { levels }))");
    before("RoleManagement.jsx", "api.updateRole(role.id, body(role, m))");
    before("RoleManagement.jsx", "api.updateRole(role.id, { is_active: !on })");
    before("RoleManagement.jsx", "api.deleteRole(");
    before("RoleManagement.jsx", "api.updateUser(u.id, { role_ids: roleIdsAfterAdd");
    before("RoleManagement.jsx", "api.updateUser(u.id, { role_ids: roleIdsAfterMove");
  });
  it("data access card", () => {
    const s = readFileSync(new URL("../DataAccess.jsx", import.meta.url), "utf8");
    expect(s.indexOf("confirmTwice(")).toBeGreaterThan(-1);
    expect(s.indexOf("confirmTwice(")).toBeLessThan(s.indexOf("api.setDataAccess("));
  });
  it("no older single confirm is left in the admin files", () => {
    ["UserManagement.jsx", "RoleManagement.jsx"].forEach((f) => expect(src(f)).not.toContain("askConfirm"));
  });
  it("keeps a draft when cancelled and keeps Escape for the question", () => {
    expect(src("RoleManagement.jsx")).toContain("if (done === false) return;");
    expect(src("RoleManagement.jsx")).toContain("if (done !== false) onEditing(false);");
    expect(src("UserManagement.jsx")).toContain("!isAskingTwice()");
  });
});
