import React, { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Copy, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { CardsSkeleton } from "../../../app/Loader";
import { C } from "../../../tokens";
import { api } from "../../../api/apiClient";
import { Avatar } from "../../../hub/Avatar";
import { AdminCrown } from "../../../components/AdminCrown";
import { askConfirm } from "../Dialogs";
import { PAGE_SIZES, filterUsers, formatDate, formatLastLogin, isAdminUser, nextSort, paginate, plural, roleChips, showingLine, sortUsers, userRoles, userStatus } from "./adminLogic";
import { ADMIN_CSS, Live, PageHead, RoleChip, StatusChip, card, field, muted, text } from "./adminUi";

export const USERS_TITLE = "User management";
export const USERS_SUB = "Manage users, roles and areas across your organisation.";
export const EMPTY_USERS = "No users match. Clear the search or pick All.";
export const NO_USERS_YET = "There are no users yet. Add the first one.";

const COLUMNS = [
  { key: "user", label: "User" },
  { key: "role", label: "Role" },
  { key: "created", label: "Created" },
  { key: "last_login", label: "Last login" },
  { key: "status", label: "Status" },
];

function SortHead({ col, sort, onSort }) {
  const on = sort.key === col.key;
  const Icon = on ? (sort.dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <th scope="col" aria-sort={on ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" onClick={() => onSort(col.key)} aria-label={`Sort by ${col.label}`}>{col.label} <Icon size={12} aria-hidden="true" /></button>
    </th>
  );
}

// The list, apart from the loading, so each state can be shown on its own.
export function UserManagementBody({ users, roles = [], me, error = "", notice = "", onRetry, onAdd, onEdit, onDelete, initial = {} }) {
  const [query, setQuery] = useState(initial.query || "");
  const [roleId, setRoleId] = useState(initial.roleId || "all");
  const [sort, setSort] = useState(initial.sort || { key: "created", dir: "desc" });
  const [size, setSize] = useState(initial.size || PAGE_SIZES[0]);
  const [page, setPage] = useState(initial.page || 1);

  const loading = users === null || users === undefined;
  const all = users || [];
  const chips = roleChips(all, roles);
  const shown = sortUsers(filterUsers(all, { query, roleId }), sort.key, sort.dir);
  const pg = paginate(shown, page, size);
  const reset = (fn) => (v) => { fn(v); setPage(1); };

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <style>{ADMIN_CSS}</style>
      <PageHead
        title={USERS_TITLE}
        sub={USERS_SUB}
        action={<button type="button" className="ui-btn ui-btn--primary" style={{ minHeight: 44 }} onClick={onAdd}><Plus size={15} aria-hidden="true" /> Add user</button>}
      />
      <div style={{ ...card, padding: 10, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <label htmlFor="adm-user-search" style={{ ...text, fontSize: 12, fontWeight: 600, color: C.slate, textTransform: "uppercase", letterSpacing: "0.05em" }}>Filter users</label>
        <div style={{ position: "relative", flex: "1 1 220px", minWidth: 0 }}>
          <Search size={15} aria-hidden="true" style={{ position: "absolute", left: 10, top: 14, color: C.slateLight }} />
          <input id="adm-user-search" type="search" value={query} onChange={(e) => reset(setQuery)(e.target.value)} placeholder="Search name, email or role…" style={{ ...field, width: "100%", paddingLeft: 32 }} />
        </div>
      </div>
      <div className="adm-chips" role="group" aria-label="Filter by role">
        {chips.map((c) => (
          <button key={c.id} type="button" className="adm-chip" aria-pressed={roleId === c.id} onClick={() => reset(setRoleId)(c.id)}>{c.name} {c.count}</button>
        ))}
      </div>
      <Live message={notice} error={error} />
      {error && loading && onRetry ? <div><button type="button" className="ui-btn ui-btn--secondary" style={{ minHeight: 44 }} onClick={onRetry}>Try again</button></div> : null}
      {loading && !error ? <CardsSkeleton count={3} label="Loading users" /> : null}
      {!loading ? (
        <section style={{ ...card, overflow: "hidden" }} aria-label="Users">
          <div style={{ padding: "12px 14px", display: "flex", gap: 8, alignItems: "baseline" }}>
            <h3 style={{ ...text, margin: 0, fontSize: 14, color: C.textInk }}>Users</h3>
            <span style={muted}>{plural(shown.length, "user")} · page {pg.page} of {pg.pages}</span>
          </div>
          {pg.rows.length === 0 ? (
            <div style={{ ...muted, padding: "8px 14px 18px" }}>{all.length === 0 ? NO_USERS_YET : EMPTY_USERS}</div>
          ) : (
            <table className="adm-table">
              <thead>
                <tr>
                  {COLUMNS.map((c) => <SortHead key={c.key} col={c} sort={sort} onSort={(k) => { setSort(nextSort(sort, k)); setPage(1); }} />)}
                  <th scope="col"><span>Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {pg.rows.map((u) => {
                  const isMe = !!me && u.id === me.id;
                  const rs = userRoles(u);
                  return (
                    <tr key={u.id}>
                      <td>
                        <div style={{ display: "flex", gap: 10, alignItems: "center", minWidth: 0 }}>
                          <Avatar user={u} size={32} />
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{u.name}<AdminCrown operator={{ is_admin: isAdminUser(u) }} />{isMe ? <span style={{ ...muted, fontSize: 11.5, marginLeft: 6 }}>(you)</span> : null}</div>
                            <div style={{ ...muted, fontSize: 12, overflowWrap: "anywhere" }}>{u.email || `@${u.username}`}</div>
                          </div>
                        </div>
                      </td>
                      <td data-label="Role"><span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>{rs.length ? rs.map((r) => <RoleChip key={r.id} role={r} />) : <span style={muted}>No role</span>}</span></td>
                      <td data-label="Created">{formatDate(u.member_since)}</td>
                      <td data-label="Last login">{formatLastLogin(u.last_login_at)}</td>
                      <td data-label="Status"><StatusChip status={userStatus(u)} /></td>
                      <td data-label="Actions">
                        <span className="adm-actions">
                          <button type="button" className="adm-icon" aria-label={`Edit ${u.name}`} title="Edit" onClick={() => onEdit(u)}><Pencil size={16} aria-hidden="true" /></button>
                          <button type="button" className="adm-icon" aria-label={`Delete ${u.name}`} title={isMe ? "You cannot delete your own account" : "Delete"} disabled={isMe} onClick={() => onDelete(u)}><Trash2 size={16} aria-hidden="true" /></button>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <div style={{ padding: "10px 14px", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", justifyContent: "space-between", borderTop: `1px solid ${C.border}` }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <label htmlFor="adm-page-size" style={{ ...muted, fontSize: 12.5 }}>Page size</label>
              <select id="adm-page-size" value={pg.size} onChange={(e) => reset(setSize)(Number(e.target.value))} style={{ ...field, minWidth: 72 }}>
                {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              <span style={muted} aria-live="polite">{showingLine(pg)}</span>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button type="button" className="ui-btn ui-btn--secondary" style={{ minHeight: 44 }} disabled={pg.page <= 1} onClick={() => setPage(pg.page - 1)}>Previous</button>
              <span style={muted}>Page {pg.page} of {pg.pages}</span>
              <button type="button" className="ui-btn ui-btn--secondary" style={{ minHeight: 44 }} disabled={pg.page >= pg.pages} onClick={() => setPage(pg.page + 1)}>Next</button>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function RoleChecks({ roles, ids, onToggle, idBase }) {
  return (
    <fieldset style={{ border: "none", margin: 0, padding: 0, display: "grid", gap: 6, minWidth: 0 }}>
      <legend style={{ ...text, fontSize: 13, fontWeight: 600, color: C.textInk, padding: 0, marginBottom: 6 }}>Roles</legend>
      {roles.map((r) => (
        <label key={r.id} htmlFor={`${idBase}-${r.id}`} style={{ ...text, display: "flex", alignItems: "center", gap: 10, minHeight: 44, fontSize: 14, cursor: "pointer" }}>
          <input id={`${idBase}-${r.id}`} type="checkbox" checked={ids.includes(r.id)} onChange={() => onToggle(r.id)} style={{ width: 20, height: 20 }} />
          <span>{r.name}{r.is_admin ? " (admin)" : ""}</span>
        </label>
      ))}
    </fieldset>
  );
}

// Add a user, or edit one: roles, active or not, and a way to the areas they may see.
export function UserDrawer({ user, roles, me, onClose, onSaved, onOpenDataAccess, initialTemp = null }) {
  const adding = !user;
  const [form, setForm] = useState({ name: user ? user.name : "", username: "", email: user ? user.email || "" : "" });
  const [ids, setIds] = useState(user ? userRoles(user).map((r) => r.id) : []);
  const [active, setActive] = useState(user ? user.is_active !== false : true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [temp, setTemp] = useState(initialTemp);
  const [copied, setCopied] = useState("");
  const first = useRef(null);
  const isMe = !!user && !!me && user.id === me.id;
  const toggle = (id) => setIds((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));

  useEffect(() => {
    const prev = typeof document !== "undefined" ? document.activeElement : null;
    if (first.current) first.current.focus();
    const key = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("keydown", key); if (prev && prev.focus) prev.focus(); };
  }, [onClose]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      if (adding) {
        const operator = roles.find((r) => r.name === "Operator");
        const role_ids = ids.length ? ids : [operator && operator.id].filter(Boolean);
        const res = await api.createUser({ name: form.name.trim(), username: form.username.trim().toLowerCase(), email: form.email.trim() || null, role_ids });
        setTemp({ value: res.temporary_password, who: res.name, emailed: !!res.emailed });
        onSaved(`${res.name} added.`);
      } else {
        if (!ids.length) { setError("Everyone needs at least one role."); setBusy(false); return; }
        const body = { name: form.name.trim() || user.name, email: form.email.trim(), role_ids: ids };
        if (!isMe) body.is_active = active;
        await api.updateUser(user.id, body);
        onSaved(`${form.name.trim() || user.name} saved.`);
        onClose();
      }
    } catch (err) {
      setError(err.message || "Couldn't save. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const copy = () => {
    Promise.resolve(navigator.clipboard && navigator.clipboard.writeText(temp.value)).then(() => setCopied("Copied."), () => setCopied("Could not copy. Select the password and copy it."));
  };

  return (
    <div className="adm-drawer-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="adm-drawer" role="dialog" aria-modal="true" aria-labelledby="adm-drawer-title">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 id="adm-drawer-title" style={{ ...text, margin: 0, fontSize: 17, color: C.textInk }}>{adding ? "Add user" : `Edit ${user.name}`}</h3>
          <button type="button" className="adm-icon" aria-label="Close" onClick={onClose}><X size={18} aria-hidden="true" /></button>
        </div>
        {temp ? (
          <div style={{ border: `1px solid ${C.amber}`, background: C.amberSoft, borderRadius: 12, padding: 14, display: "grid", gap: 8 }}>
            <div style={{ ...text, fontSize: 14, fontWeight: 700, color: C.textInk }}>Temporary password for {temp.who}</div>
            <div style={muted}>{temp.emailed ? "Also emailed to them. " : "Send it to them privately. "}Shown only now. They choose their own at first sign-in.</div>
            <code style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 14, background: "#fff", padding: "8px 10px", borderRadius: 8, border: `1px solid ${C.border}`, overflowWrap: "anywhere" }}>{temp.value}</code>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="ui-btn ui-btn--secondary" style={{ minHeight: 44 }} onClick={copy}><Copy size={14} aria-hidden="true" /> Copy</button>
              <button type="button" className="ui-btn ui-btn--primary" style={{ minHeight: 44 }} onClick={onClose}>Done</button>
            </div>
            <div role="status" aria-live="polite" style={muted}>{copied}</div>
          </div>
        ) : (
          <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "grid", gap: 4 }}>
              <label htmlFor="adm-f-name" style={{ ...text, fontSize: 13, fontWeight: 600, color: C.textInk }}>Full name</label>
              <input id="adm-f-name" ref={first} required style={field} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            {adding ? (
              <div style={{ display: "grid", gap: 4 }}>
                <label htmlFor="adm-f-username" style={{ ...text, fontSize: 13, fontWeight: 600, color: C.textInk }}>Username</label>
                <input id="adm-f-username" required autoCapitalize="none" style={field} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
              </div>
            ) : null}
            <div style={{ display: "grid", gap: 4 }}>
              <label htmlFor="adm-f-email" style={{ ...text, fontSize: 13, fontWeight: 600, color: C.textInk }}>Email{adding ? " (optional)" : ""}</label>
              <input id="adm-f-email" type="email" style={field} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <RoleChecks roles={roles} ids={ids} onToggle={toggle} idBase="adm-role" />
            {!adding ? (
              <label htmlFor="adm-f-active" style={{ ...text, display: "flex", alignItems: "center", gap: 10, minHeight: 44, fontSize: 14, cursor: isMe ? "not-allowed" : "pointer" }}>
                <input id="adm-f-active" type="checkbox" role="switch" checked={active} disabled={isMe} onChange={(e) => setActive(e.target.checked)} style={{ width: 20, height: 20 }} />
                <span>Active ({active ? "On" : "Off"}){isMe ? <span style={muted}> You cannot disable your own account.</span> : null}</span>
              </label>
            ) : null}
            {!adding && !isAdminUser(user) ? (
              <div style={{ ...card, padding: 12, display: "grid", gap: 6 }}>
                <div style={{ ...text, fontSize: 13, fontWeight: 600, color: C.textInk }}>Areas this person can see</div>
                <div style={muted}>Postcode areas, export and live Google details are set in Data access.</div>
                <div><button type="button" className="ui-btn ui-btn--secondary" style={{ minHeight: 44 }} onClick={() => { onClose(); onOpenDataAccess && onOpenDataAccess(); }}>Open Data access</button></div>
              </div>
            ) : null}
            {error ? <div role="alert" style={{ ...text, fontSize: 13.5, color: C.red }}>{error}</div> : null}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button type="button" className="ui-btn ui-btn--secondary" style={{ minHeight: 44 }} onClick={onClose}>Cancel</button>
              <button type="submit" className="ui-btn ui-btn--primary" style={{ minHeight: 44 }} disabled={busy}>{busy ? "Saving…" : adding ? "Create user" : "Save"}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export function UserManagement({ operator, onOpenDataAccess }) {
  const [users, setUsers] = useState(null);
  const [roles, setRoles] = useState([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [drawer, setDrawer] = useState(null); // null | "add" | user

  const load = useCallback(async () => {
    try {
      const [u, r] = await Promise.all([api.getUsers(), api.getRoles()]);
      setUsers(u); setRoles(r); setError("");
    } catch (e) {
      setError(e.message || "Couldn't load users. Try again.");
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const remove = async (u) => {
    const ok = await askConfirm({ title: `Delete ${u.name}?`, body: "They are signed out and lose access. This cannot be undone.", confirm: "Delete", danger: true });
    if (!ok) return;
    setNotice(""); setError("");
    try {
      await api.deleteUser(u.id);
      setNotice(`${u.name} deleted.`);
      await load();
    } catch (e) {
      setError(e.message || "Couldn't delete that user.");
    }
  };
  const closeDrawer = useCallback(() => setDrawer(null), []);

  return (
    <>
      <UserManagementBody users={users} roles={roles} me={operator} error={error} notice={notice} onRetry={load} onAdd={() => setDrawer("add")} onEdit={setDrawer} onDelete={remove} />
      {drawer ? <UserDrawer user={drawer === "add" ? null : drawer} roles={roles} me={operator} onClose={closeDrawer} onSaved={(m) => { setNotice(m); load(); }} onOpenDataAccess={onOpenDataAccess} /> : null}
    </>
  );
}
