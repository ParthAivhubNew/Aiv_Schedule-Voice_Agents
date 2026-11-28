import React, { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Copy, Info, Plus, Search, X } from "lucide-react";
import { CardsSkeleton } from "../../../app/Loader";
import { C } from "../../../tokens";
import { api } from "../../../api/apiClient";
import { Avatar } from "../../../hub/Avatar";
import { AdminCrown } from "../../../components/AdminCrown";
import { confirmTwice, deleteUserChanges, isAskingTwice, newUserChanges, switchUserChanges, userChanges, accessChanges } from "./confirmChange";
import { AccessEditor, ADMIN_SEES_ALL_HELP, ADMIN_SEES_ALL_LINE, NEED_AREAS_LINE, useAccessDraft } from "./AccessEditor";
import { PAGE_SIZES, filterUsers, formatDate, formatLastLogin, isActiveItem, isAdminUser, nextSort, paginate, plural, roleCapabilities, roleChips, showingLine, sortUsers, userRoles, userStatus } from "./adminLogic";
import { ADMIN_CSS, DrawerShell, ItemActions, Live, PageHead, RoleChip, Section, StatusChip, card, field, muted, text } from "./adminUi";

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
export function UserManagementBody({ users, roles = [], me, error = "", notice = "", onRetry, onAdd, onEdit, onDelete, onToggle, initial = {} }) {
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
                    <tr key={u.id} className={isActiveItem(u) ? undefined : "adm-row-off"}>
                      <td>
                        <div style={{ display: "flex", gap: 10, alignItems: "center", minWidth: 0 }}>
                          <Avatar user={u} size={32} />
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 600, overflowWrap: "anywhere" }}><button type="button" className="adm-namebtn" title={`Open ${u.name}'s profile`} onClick={() => onEdit(u)}>{u.name}</button><AdminCrown operator={{ is_admin: isAdminUser(u) }} />{isMe ? <span style={{ ...muted, fontSize: 11.5, marginLeft: 6 }}>(you)</span> : null}</div>
                            <div style={{ ...muted, fontSize: 12, overflowWrap: "anywhere" }}>{u.email || `@${u.username}`}</div>
                          </div>
                        </div>
                      </td>
                      <td data-label="Role"><span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>{rs.length ? rs.map((r) => <RoleChip key={r.id} role={r} />) : <span style={muted}>No role</span>}</span></td>
                      <td data-label="Created">{formatDate(u.member_since)}</td>
                      <td data-label="Last login">{formatLastLogin(u.last_login_at)}</td>
                      <td data-label="Status"><StatusChip status={userStatus(u)} /></td>
                      <td data-label="Actions">
                        <ItemActions name={u.name} active={isActiveItem(u)}
                          onView={() => onEdit(u)} onToggle={() => onToggle(u)} onEdit={() => onEdit(u)} onDelete={() => onDelete(u)}
                          toggleOff={isMe ? "You cannot switch off your own account" : ""} deleteOff={isMe ? "You cannot delete your own account" : ""} />
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

// What one role lets a person do, in plain words: the description, then what they can change and what they can only see.
export function RoleInfo({ role, sections, id }) {
  const cap = roleCapabilities(role, sections);
  const list = (label, items) => (items.length ? <div><strong style={{ color: C.textInk }}>{label}</strong> {items.join(", ")}</div> : null);
  return (
    <div id={id} style={{ ...muted, fontSize: 12.5, background: C.neutralBg, border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 12px", display: "grid", gap: 6, margin: "0 0 4px 30px" }}>
      {role.description ? <div>{role.description}</div> : null}
      {cap.all ? <div><strong style={{ color: C.textInk }}>Can do everything</strong>, including managing users, roles and settings. Sees every postcode.</div> : (
        <>
          {list("Can use and change:", cap.full)}
          {list("Can only view:", cap.view)}
          {!cap.full.length && !cap.view.length ? <div>This role opens nothing yet. Add permissions on the Roles screen.</div> : null}
        </>
      )}
    </div>
  );
}

function RoleChecks({ roles, ids, onToggle, idBase, sections = [] }) {
  const [open, setOpen] = useState("");
  return (
    <fieldset style={{ border: "none", margin: 0, padding: 0, display: "grid", gap: 8, minWidth: 0 }}>
      <legend style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Roles</legend>
      {roles.map((r) => {
        const on = open === r.id;
        const picked = ids.includes(r.id);
        return (
          <div key={r.id} className="adm-opt" data-on={picked ? "true" : "false"}>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <label htmlFor={`${idBase}-${r.id}`} style={{ ...text, display: "flex", alignItems: "flex-start", gap: 12, padding: "10px 0 10px 12px", fontSize: 14, cursor: "pointer", flex: 1, minWidth: 0 }}>
                <input id={`${idBase}-${r.id}`} type="checkbox" checked={picked} onChange={() => onToggle(r.id)} style={{ width: 20, height: 20, marginTop: 1, flexShrink: 0 }} />
                <span style={{ display: "grid", gap: 2, minWidth: 0 }}>
                  <span style={{ fontWeight: 600, color: C.textInk }}>{r.name}{r.is_admin && !/^admin$/i.test(r.name) ? " (admin)" : ""}</span>
                  {r.description ? <span style={{ ...muted, fontSize: 12.5 }}>{r.description}</span> : null}
                </span>
              </label>
              <button type="button" className="adm-icon" aria-label={`What the ${r.name} role can do`} aria-expanded={on} aria-controls={`${idBase}-${r.id}-info`}
                title={`What the ${r.name} role can do`} onClick={() => setOpen(on ? "" : r.id)} onKeyDown={(e) => { if (e.key === "Escape" && on) { e.stopPropagation(); setOpen(""); } }}
                style={{ minWidth: 44, minHeight: 44, border: "none", background: "transparent", color: on ? C.cobalt : C.slate }}><Info size={17} aria-hidden="true" /></button>
            </div>
            {on ? <div style={{ padding: "0 12px 12px" }}><RoleInfo role={r} sections={sections} id={`${idBase}-${r.id}-info`} /></div> : null}
          </div>
        );
      })}
    </fieldset>
  );
}

export const PROFILE_ACCESS_ERROR = "Couldn't load this person's data access.";
export const USERNAME_HELP = "3 to 32 letters, numbers, dots, dashes or underscores. No spaces.";
export const USERNAME_ERROR = `Username: ${USERNAME_HELP}`;
export const NEW_ACCESS_FAILED = "The account was created, but its data access was not saved. Open their profile and set it before they sign in.";

export const cleanUsername = (v) => String(v || "").trim().toLowerCase();
export const usernameOk = (v) => /^[a-z0-9][a-z0-9._-]{2,31}$/.test(cleanUsername(v));
// A starting username from the email (before the @), or from the name, so the admin only edits it when they want to.
export const suggestUsername = ({ email = "", name = "" }) => {
  const base = (email.includes("@") ? email.split("@")[0] : name).toLowerCase().replace(/[^a-z0-9._-]+/g, ".").replace(/^[._-]+|[._-]+$/g, "").slice(0, 32);
  return base;
};
// The role a new person starts with, ticked on screen so nothing is chosen for them out of sight.
export const defaultRoleIds = (roles) => { const r = (roles || []).find((x) => x.name === "Operator"); return r ? [r.id] : []; };

// Add a user, or open a profile: details, roles, active or not, and data access, saved together.
export function UserDrawer({ user, roles, sections = [], me, onClose, onSaved, initialTemp = null, initialAccess = null, initialAllowed = [] }) {
  const adding = !user;
  const [form, setForm] = useState({ name: user ? user.name : "", username: "", email: user ? user.email || "" : "" });
  const [ids, setIds] = useState(user ? userRoles(user).map((r) => r.id) : defaultRoleIds(roles));
  const [nameTouched, setNameTouched] = useState(false); // once the admin types a username, we stop suggesting one
  const [newAllowed, setNewAllowed] = useState([]);
  const [newWarning, setNewWarning] = useState("");
  const [active, setActive] = useState(user ? user.is_active !== false : true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [parts, setParts] = useState({ user: "", access: "" });
  const [temp, setTemp] = useState(initialTemp);
  const [copied, setCopied] = useState("");
  const [access, setAccess] = useState(initialAccess); // the saved copy: { districts, allow_export, allow_google }
  const [allowed, setAllowed] = useState(initialAllowed);
  const [accessState, setAccessState] = useState(initialAccess ? "ready" : "loading"); // loading | ready | failed
  const first = useRef(null);
  const isMe = !!user && !!me && user.id === me.id;
  const newIsAdmin = adding && roles.some((r) => r.is_admin && ids.includes(r.id));
  const seesAll = adding ? newIsAdmin : isAdminUser(user);
  const showAccess = !seesAll;
  const clear = () => { setStatus(""); setError(""); setParts({ user: "", access: "" }); };
  const draft = useAccessDraft(access, user ? user.id : "", { onTouch: clear });
  const detailChanges = adding ? [] : userChanges(user, { name: form.name, email: form.email, roleIds: ids, active: isMe ? undefined : active }, roles);
  const accessLines = showAccess && (adding || accessState === "ready") ? accessChanges(access, draft) : [];
  const profileChanges = [...detailChanges, ...accessLines];
  const profileDanger = !isMe && !active && user && user.is_active !== false;
  const toggle = (id) => { clear(); setIds((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id])); };

  const loadAccess = useCallback(async () => {
    setAccessState("loading");
    try {
      const d = await api.getDataAccess();
      const mine = (d.users || []).find((x) => x.id === user.id);
      if (!mine) throw new Error(PROFILE_ACCESS_ERROR);
      setAccess({ districts: mine.districts || [], allow_export: mine.allow_export !== false, allow_google: mine.allow_google !== false });
      setAllowed(d.districts_allowed || []);
      setParts((p) => ({ ...p, access: "" }));
      setAccessState("ready");
    } catch (e) {
      setParts((p) => ({ ...p, access: e.message || PROFILE_ACCESS_ERROR }));
      setAccessState("failed");
    }
  }, [user]);
  useEffect(() => { if (!adding && showAccess && !initialAccess) loadAccess(); }, [adding, showAccess, initialAccess, loadAccess]);
  // A new person has no saved limits yet; only the suggested areas are read, so the admin can pick from them.
  useEffect(() => {
    if (!adding) return;
    let live = true;
    api.getDataAccess().then((d) => { if (live) setNewAllowed(d.districts_allowed || []); }).catch(() => {});
    return () => { live = false; };
  }, [adding]);

  useEffect(() => {
    const prev = typeof document !== "undefined" ? document.activeElement : null;
    if (first.current) first.current.focus();
    const key = (e) => { if (e.key === "Escape" && !isAskingTwice()) onClose(); };
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("keydown", key); if (prev && prev.focus) prev.focus(); };
  }, [onClose]);

  const submit = async (e) => {
    e.preventDefault();
    clear();
    if (adding) {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) { setError("Enter their email address. Their sign-in details are sent there."); return; }
      if (!ids.length) { setError("Pick at least one role."); return; }
      if (!usernameOk(form.username)) { setError(USERNAME_ERROR); return; }
      if (showAccess && draft.needsAreas) { setError(NEED_AREAS_LINE); return; }
      const role_ids = ids;
      const newLines = [...newUserChanges(form, role_ids, roles), ...(showAccess ? accessLines : [])];
      const sure = await confirmTwice({ title: `Add the user ${form.name.trim()}?`, changes: newLines, subject: form.name.trim() });
      if (!sure) return;
      setBusy(true);
      try {
        const res = await api.createUser({ name: form.name.trim(), username: cleanUsername(form.username), email: form.email.trim() || null, role_ids });
        let warn = "";
        if (showAccess && accessLines.length) {
          try { await api.setDataAccess(res.id, draft.body()); } catch { warn = NEW_ACCESS_FAILED; }
        }
        setNewWarning(warn);
        setTemp({ value: res.temporary_password, who: res.name, emailed: !!res.emailed });
        onSaved(`${res.name} added.`);
      } catch (err) {
        setError(err.message || "Couldn't save. Try again.");
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!ids.length) { setError("Everyone needs at least one role."); return; }
    if (showAccess && accessState === "ready" && draft.needsAreas) { setError(NEED_AREAS_LINE); return; }
    const name = form.name.trim() || user.name;
    const sure = await confirmTwice({ title: `Save changes to ${name}?`, changes: profileChanges, subject: name, danger: profileDanger });
    if (!sure) return;
    setBusy(true);
    const errs = { user: "", access: "" };
    if (detailChanges.length) {
      try {
        const body = { name, email: form.email.trim(), role_ids: ids };
        if (!isMe) body.is_active = active;
        await api.updateUser(user.id, body);
      } catch (err) {
        errs.user = err.message || "Couldn't save the details.";
      }
    }
    let accessSaved = false;
    if (showAccess && accessState === "ready" && accessLines.length) {
      try {
        const next = draft.body();
        await api.setDataAccess(user.id, next);
        setAccess({ districts: next.districts, allow_export: next.allow_export, allow_google: next.allow_google });
        accessSaved = true;
      } catch (err) {
        errs.access = err.message || "Couldn't save data access.";
      }
    }
    setBusy(false);
    if (!errs.user && !errs.access) { onSaved(`${name} saved.`); onClose(); return; }
    setParts(errs);
    if (errs.user && errs.access) setStatus("Nothing was saved.");
    else if (errs.user) setStatus(accessSaved ? "Data access was saved. The details were not." : "The details were not saved.");
    else { setStatus("The details were saved. Data access was not."); onSaved(`${name}: details saved.`); }
  };

  const copy = () => {
    Promise.resolve(navigator.clipboard && navigator.clipboard.writeText(temp.value)).then(() => setCopied("Copied."), () => setCopied("Could not copy. Select the password and copy it."));
  };

  return (
    <DrawerShell title={adding ? "Add user" : `${user.name}'s profile`} subtitle={adding ? "They get a temporary password by email and choose their own when they first sign in." : (user.email || `@${user.username}`)} onClose={onClose}
      footer={temp ? null : (
        <>
          <button type="button" className="ui-btn ui-btn--secondary" style={{ minHeight: 44 }} onClick={onClose}>Cancel</button>
          <button type="submit" form="adm-user-form" className="ui-btn ui-btn--primary" style={{ minHeight: 44, minWidth: 120 }} disabled={busy || (!adding && profileChanges.length === 0)}>{busy ? "Saving…" : adding ? "Create user" : "Save"}</button>
        </>
      )}>
        {temp ? (
          <div style={{ border: `1px solid ${C.amber}`, background: C.amberSoft, borderRadius: 12, padding: 14, display: "grid", gap: 8 }}>
            <div style={{ ...text, fontSize: 14, fontWeight: 700, color: C.textInk }}>Temporary password for {temp.who}</div>
            <div style={muted}>{temp.emailed ? "Emailed to them with their username and a sign-in link. " : "The email could not be sent. Send them the username and this password privately. "}Shown only now. They choose their own at first sign-in.</div>
            <code style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 14, background: C.surface, padding: "8px 10px", borderRadius: 8, border: `1px solid ${C.border}`, overflowWrap: "anywhere" }}>{temp.value}</code>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="ui-btn ui-btn--secondary" style={{ minHeight: 44 }} onClick={copy}><Copy size={14} aria-hidden="true" /> Copy</button>
              <button type="button" className="ui-btn ui-btn--primary" style={{ minHeight: 44 }} onClick={onClose}>Done</button>
            </div>
            <div role="status" aria-live="polite" style={muted}>{copied}</div>
            {newWarning ? <div role="alert" style={{ ...text, fontSize: 13.5, color: C.red }}>{newWarning}</div> : null}
          </div>
        ) : (
          <form id="adm-user-form" onSubmit={submit} style={{ display: "grid", gap: 24 }}>
            <Section title="Details" hint={adding ? "Who they are and where their sign-in details go." : ""}>
            <div className="adm-field">
              <label htmlFor="adm-f-name">Full name<span aria-hidden="true" style={{ color: C.red }}> *</span></label>
              <input id="adm-f-name" ref={first} required style={field} value={form.name} onChange={(e) => { clear(); const v = e.target.value; setForm((f) => ({ ...f, name: v, ...(adding && !nameTouched ? { username: suggestUsername({ email: f.email, name: v }) } : {}) })); }} />
            </div>
            {adding ? (
              <div className="adm-field">
                <label htmlFor="adm-f-username">Username<span aria-hidden="true" style={{ color: C.red }}> *</span></label>
                <input id="adm-f-username" required autoCapitalize="none" autoComplete="off" spellCheck={false} aria-describedby="adm-f-username-help" aria-invalid={!!form.username && !usernameOk(form.username)} style={field} value={form.username} onChange={(e) => { clear(); setNameTouched(true); setForm({ ...form, username: e.target.value }); }} />
                <span id="adm-f-username-help" style={{ ...muted, fontSize: 12.5, color: form.username && !usernameOk(form.username) ? C.red : C.slate }}>{USERNAME_HELP}</span>
              </div>
            ) : null}
            <div className="adm-field">
              <label htmlFor="adm-f-email">Email{adding ? <span aria-hidden="true" style={{ color: C.red }}> *</span> : null}</label>
              <input id="adm-f-email" type="email" required={adding} style={field} value={form.email} onChange={(e) => { clear(); const v = e.target.value; setForm((f) => ({ ...f, email: v, ...(adding && !nameTouched ? { username: suggestUsername({ email: v, name: f.name }) } : {}) })); }} />
              {adding ? <span style={{ ...muted, fontSize: 12.5 }}>Their username and a temporary password are emailed here, with a sign-in link. You also see the password once.</span> : null}
            </div>
            </Section>
            <Section title="Role" hint="What they can open and change. A person can have more than one role.">
              <RoleChecks roles={roles} ids={ids} onToggle={toggle} idBase="adm-role" sections={sections} />
            </Section>
            {!adding ? (
              <Section title="Status">
                <label htmlFor="adm-f-active" className="adm-opt" data-on={active ? "true" : "false"} style={{ ...text, display: "flex", alignItems: "center", gap: 12, minHeight: 44, padding: "6px 12px", fontSize: 14, cursor: isMe ? "not-allowed" : "pointer" }}>
                  <input id="adm-f-active" type="checkbox" role="switch" checked={active} disabled={isMe} onChange={(e) => { clear(); setActive(e.target.checked); }} style={{ width: 20, height: 20 }} />
                  <span>Active ({active ? "On" : "Off"}){isMe ? <span style={muted}> You cannot disable your own account.</span> : null}</span>
                </label>
              </Section>
            ) : null}
            {seesAll ? (
              <Section title="Data access">
                <div className="adm-opt" style={{ padding: 12, display: "grid", gap: 4 }}>
                  <div style={{ ...text, fontSize: 13, fontWeight: 600, color: C.textInk }}>{ADMIN_SEES_ALL_LINE}</div>
                  <div style={muted}>{ADMIN_SEES_ALL_HELP}</div>
                </div>
              </Section>
            ) : null}
            {showAccess ? (
              <Section title="Data access" hint="Which postcodes they can search, and what they can do with the data.">
                {adding ? <AccessEditor draft={draft} allowed={newAllowed} idBase="adm-da-new" disabled={busy} /> : null}
                {!adding && accessState === "ready" ? <AccessEditor draft={draft} allowed={allowed} idBase={`adm-da-${user.id}`} disabled={busy} /> : null}
                {!adding && accessState === "loading" ? <div role="status" aria-live="polite" style={muted}>Loading data access…</div> : null}
                {!adding && accessState === "failed" ? (
                  <div style={{ display: "grid", gap: 8, justifyItems: "start" }}>
                    <div role="alert" style={{ ...text, fontSize: 13.5, color: C.red }}>Data access: {parts.access}</div>
                    <button type="button" className="ui-btn ui-btn--secondary" style={{ minHeight: 44 }} onClick={loadAccess}>Try again</button>
                  </div>
                ) : null}
              </Section>
            ) : null}
            <div role="status" aria-live="polite" style={{ display: "grid", gap: 4 }}>
              {status ? <div style={{ ...text, fontSize: 13.5, fontWeight: 600, color: C.textInk }}>{status}</div> : null}
              {busy ? <div style={muted}>Saving…</div> : null}
            </div>
            {error ? <div role="alert" style={{ ...text, fontSize: 13.5, color: C.red }}>{error}</div> : null}
            {parts.user ? <div role="alert" style={{ ...text, fontSize: 13.5, color: C.red }}>Details: {parts.user}</div> : null}
            {!adding && parts.access && accessState !== "failed" ?<div role="alert" style={{ ...text, fontSize: 13.5, color: C.red }}>Data access: {parts.access}</div> : null}
          </form>
        )}
    </DrawerShell>
  );
}

export function UserManagement({ operator }) {
  const [users, setUsers] = useState(null);
  const [roles, setRoles] = useState([]);
  const [sections, setSections] = useState([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [drawer, setDrawer] = useState(null); // null | "add" | user

  const load = useCallback(async () => {
    try {
      const [u, r] = await Promise.all([api.getUsers(), api.getRoles()]);
      setUsers(u); setRoles(r); setError("");
      api.getSections().then(setSections).catch(() => {}); // only used to describe roles, so a failure just leaves the lists empty
    } catch (e) {
      setError(e.message || "Couldn't load users. Try again.");
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const remove = async (u) => {
    const ok = await confirmTwice({ title: `Delete ${u.name}?`, changes: deleteUserChanges(u), danger: true, confirmLabel: "Yes, delete", summary: `Delete ${u.name}` });
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
  const toggle = async (u) => {
    const on = isActiveItem(u);
    const ok = await confirmTwice({ title: `${on ? "Switch off" : "Switch on"} ${u.name}?`, changes: switchUserChanges(u, !on), danger: on, summary: `${on ? "Switch off" : "Switch on"} ${u.name}` });
    if (!ok) return;
    setNotice(""); setError("");
    try {
      await api.updateUser(u.id, { is_active: !on });
      setNotice(`${u.name} switched ${on ? "off" : "on"}.`);
      await load();
    } catch (e) {
      setError(e.message || "Couldn't change that.");
    }
  };
  const closeDrawer = useCallback(() => setDrawer(null), []);

  return (
    <>
      <UserManagementBody users={users} roles={roles} me={operator} error={error} notice={notice} onRetry={load} onAdd={() => setDrawer("add")} onEdit={setDrawer} onDelete={remove} onToggle={toggle} />
      {drawer ? <UserDrawer user={drawer === "add" ? null : drawer} roles={roles} sections={sections} me={operator} onClose={closeDrawer} onSaved={(m) => { setNotice(m); load(); }} /> : null}
    </>
  );
}
