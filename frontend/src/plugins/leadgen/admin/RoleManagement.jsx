import React, { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, HelpCircle, Pencil, Plus, Search, Trash2, Users, ShieldCheck } from "lucide-react";
import { CardsSkeleton } from "../../../app/Loader";
import { C } from "../../../tokens";
import { api } from "../../../api/apiClient";
import { AdminCrown } from "../../../components/AdminCrown";
import { askConfirm } from "../Dialogs";
import {
  LEVELS, LEVEL_NAMES, grantedCount, grantedLine, groupSections, groupState, levelOf, peopleIn, peopleLine, peopleNotIn,
  plural, roleIdsAfterAdd, roleIdsAfterMove, roleListLine, sameLevels, searchGroups, setGroupLevel, setLevel, userRoles,
} from "./adminLogic";
import { ADMIN_CSS, Live, PageHead, card, field, muted, text } from "./adminUi";

export const ROLES_TITLE = "Role management";
export const ROLES_SUB = "Who each role is, what it can do, and who is in it.";
export const ADMIN_ROLE_LINE = "Admin roles have full access to everything, so their permissions cannot be changed.";
export const SYSTEM_ROLE_LINE = "This is a starter role. You can change its access and description, but not its name, and it cannot be deleted.";
export const NO_ROLES = "There are no roles yet. Add the first one.";

export function LevelControl({ label, value, onChange, disabled }) {
  return (
    <div className="adm-seg" role="radiogroup" aria-label={label}>
      {LEVELS.map((lv) => (
        <button key={lv} type="button" role="radio" aria-checked={value === lv} disabled={disabled} onClick={() => onChange(lv)}>{LEVEL_NAMES[lv]}</button>
      ))}
    </div>
  );
}

function Help({ text: tip }) {
  return <span title={tip} role="img" aria-label={tip} style={{ display: "inline-flex", color: C.slateLight }}><HelpCircle size={14} aria-hidden="true" /></span>;
}

const rowBox = { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "6px 12px", minHeight: 52, border: `1px solid ${C.borderLight}`, borderRadius: 10, background: C.paper };

export function PermissionsPanel({ role, sections, levels, onChange, initialQuery = "", initialOpen = [] }) {
  const [query, setQuery] = useState(initialQuery);
  const [open, setOpen] = useState(initialOpen);
  const locked = !!role.is_admin;
  const effective = locked ? Object.fromEntries(sections.map((s) => [s.key, "full"])) : levels;
  const groups = searchGroups(groupSections(sections), query);
  const allOpen = groups.length > 0 && groups.every((g) => g.items.length < 2 || open.includes(g.name) || query);
  const toggleOpen = (name) => setOpen((l) => (l.includes(name) ? l.filter((x) => x !== name) : [...l, name]));
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {locked ? <div style={muted}>{ADMIN_ROLE_LINE}</div> : null}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: "1 1 220px", minWidth: 0 }}>
          <label htmlFor="adm-perm-search" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Find a permission by name</label>
          <Search size={15} aria-hidden="true" style={{ position: "absolute", left: 10, top: 14, color: C.slateLight }} />
          <input id="adm-perm-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a permission by name…" style={{ ...field, width: "100%", paddingLeft: 32 }} />
        </div>
        <button type="button" className="ui-btn ui-btn--secondary" style={{ minHeight: 44 }} onClick={() => setOpen(allOpen ? [] : groups.map((g) => g.name))}>{allOpen ? "Collapse all" : "Expand all"}</button>
      </div>
      {groups.length === 0 ? <div style={muted}>No permission matches that name.</div> : null}
      {groups.map((g) => {
        const gs = groupState(effective, g.items);
        if (g.items.length === 1) {
          const s = g.items[0];
          return (
            <div key={g.name} style={rowBox}>
              <span style={{ ...text, fontSize: 13.5, fontWeight: 600, color: C.textInk }}>{s.label}</span>
              <Help text={s.description || s.label} />
              <span style={{ flex: 1 }} />
              <LevelControl label={`${s.label} access`} value={levelOf(effective, s.key)} disabled={locked} onChange={(lv) => onChange(setLevel(levels, s.key, lv))} />
            </div>
          );
        }
        const expanded = !!query || open.includes(g.name);
        return (
          <div key={g.name} style={{ display: "grid", gap: 6 }}>
            <div style={rowBox}>
              <button type="button" className="adm-icon" style={{ width: 44, height: 44 }} aria-expanded={expanded} aria-label={`${expanded ? "Collapse" : "Expand"} ${g.name}`} onClick={() => toggleOpen(g.name)}>
                {expanded ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
              </button>
              <span style={{ ...text, fontSize: 13.5, fontWeight: 600, color: C.textInk }}>{g.name}</span>
              <span style={muted}>{gs.on} of {gs.total} on</span>
              <span style={{ ...text, fontSize: 12, fontWeight: 600, color: gs.state === "partial" ? C.amber : gs.state === "on" ? C.green : C.slate }}>{gs.label}</span>
              <span style={{ flex: 1 }} />
              <LevelControl label={`${g.name}, set all`} value={gs.state === "off" ? "none" : g.items.every((s) => levelOf(effective, s.key) === "full") ? "full" : g.items.every((s) => levelOf(effective, s.key) === "view") ? "view" : ""} disabled={locked} onChange={(lv) => onChange(setGroupLevel(levels, g.items, lv))} />
            </div>
            {expanded ? g.items.map((s) => (
              <div key={s.key} style={{ ...rowBox, marginLeft: 20, background: "#fff" }}>
                <span style={{ ...text, fontSize: 13, color: C.textInk }}>{s.label}</span>
                <Help text={s.description || s.label} />
                <span style={{ flex: 1 }} />
                <LevelControl label={`${s.label} access`} value={levelOf(effective, s.key)} disabled={locked} onChange={(lv) => onChange(setLevel(levels, s.key, lv))} />
              </div>
            )) : null}
          </div>
        );
      })}
    </div>
  );
}

export function PeoplePanel({ role, roles, users, busy, onAdd, onMove, initialAdding = false }) {
  const members = peopleIn(users, role.id);
  const others = peopleNotIn(users, role.id);
  const [adding, setAdding] = useState(initialAdding);
  const [picked, setPicked] = useState([]);
  const targets = roles.filter((r) => r.id !== role.id);
  const togglePick = (id) => setPicked((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
        <span style={{ ...text, fontSize: 13.5, color: C.textInk }}>{peopleLine(members.length, role.name)}</span>
        <button type="button" className="ui-btn ui-btn--secondary" style={{ minHeight: 44 }} aria-expanded={adding} onClick={() => setAdding(!adding)} disabled={others.length === 0}><Plus size={14} aria-hidden="true" /> Add people</button>
      </div>
      {adding ? (
        <fieldset style={{ ...card, padding: 12, margin: 0, display: "grid", gap: 4 }}>
          <legend style={{ ...text, fontSize: 13, fontWeight: 600, color: C.textInk, padding: "0 4px" }}>Pick people to add to {role.name}</legend>
          {others.map((u) => (
            <label key={u.id} htmlFor={`adm-add-${u.id}`} style={{ ...text, display: "flex", gap: 10, alignItems: "center", minHeight: 44, fontSize: 14, cursor: "pointer" }}>
              <input id={`adm-add-${u.id}`} type="checkbox" checked={picked.includes(u.id)} onChange={() => togglePick(u.id)} style={{ width: 20, height: 20 }} />
              <span>{u.name} <span style={muted}>{u.email || `@${u.username}`}</span></span>
            </label>
          ))}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" className="ui-btn ui-btn--secondary" style={{ minHeight: 44 }} onClick={() => { setAdding(false); setPicked([]); }}>Cancel</button>
            <button type="button" className="ui-btn ui-btn--primary" style={{ minHeight: 44 }} disabled={!picked.length || busy} onClick={async () => { await onAdd(others.filter((u) => picked.includes(u.id))); setPicked([]); setAdding(false); }}>Add {picked.length ? plural(picked.length, "person", "people") : ""}</button>
          </div>
        </fieldset>
      ) : null}
      {members.length === 0 ? <div style={muted}>Nobody has this role yet.</div> : null}
      {members.map((u) => (
        <div key={u.id} style={{ ...rowBox, background: "#fff" }}>
          <div style={{ minWidth: 0, flex: "1 1 180px" }}>
            <div style={{ ...text, fontSize: 13.5, fontWeight: 600, color: C.textInk, overflowWrap: "anywhere" }}>{u.name}<AdminCrown operator={{ is_admin: u.is_admin || userRoles(u).some((r) => r.is_admin) }} /></div>
            <div style={{ ...muted, fontSize: 12, overflowWrap: "anywhere" }}>{u.email || `@${u.username}`}</div>
          </div>
          <label htmlFor={`adm-move-${u.id}`} style={{ ...muted, fontSize: 12.5 }}>Move to</label>
          <select id={`adm-move-${u.id}`} value="" disabled={busy || targets.length === 0} style={{ ...field, minWidth: 140 }} onChange={(e) => e.target.value && onMove(u, e.target.value)}>
            <option value="">role…</option>
            {targets.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
      ))}
    </div>
  );
}

function MetaForm({ role, onSave, onCancel, busy }) {
  const adding = !role;
  const [name, setName] = useState(role ? role.name : "");
  const [description, setDescription] = useState(role ? role.description || "" : "");
  const [isAdmin, setIsAdmin] = useState(role ? !!role.is_admin : false);
  return (
    <form style={{ ...card, padding: 14, display: "grid", gap: 10 }} onSubmit={(e) => { e.preventDefault(); onSave({ name, description, is_admin: isAdmin }); }}>
      <div style={{ display: "grid", gap: 4 }}>
        <label htmlFor="adm-role-name" style={{ ...text, fontSize: 13, fontWeight: 600, color: C.textInk }}>Role name</label>
        <input id="adm-role-name" required style={field} value={name} disabled={!!role && !!role.is_system} onChange={(e) => setName(e.target.value)} />
        {role && role.is_system ? <span style={muted}>{SYSTEM_ROLE_LINE}</span> : null}
      </div>
      <div style={{ display: "grid", gap: 4 }}>
        <label htmlFor="adm-role-desc" style={{ ...text, fontSize: 13, fontWeight: 600, color: C.textInk }}>What this role is for</label>
        <input id="adm-role-desc" style={field} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      {adding || (role && !role.is_system) ? (
        <label htmlFor="adm-role-admin" style={{ ...text, display: "flex", gap: 10, alignItems: "center", minHeight: 44, fontSize: 14, cursor: "pointer" }}>
          <input id="adm-role-admin" type="checkbox" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} style={{ width: 20, height: 20 }} />
          <span>Admin role: full access to everything, including users, roles and keys</span>
        </label>
      ) : null}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button type="button" className="ui-btn ui-btn--secondary" style={{ minHeight: 44 }} onClick={onCancel}>Cancel</button>
        <button type="submit" className="ui-btn ui-btn--primary" style={{ minHeight: 44 }} disabled={busy || !name.trim()}>{adding ? "Create role" : "Save"}</button>
      </div>
    </form>
  );
}

// The right-hand side for one role: its name and count, the Save Changes button, and the two sub-tabs.
export function RolePanel({ role, roles, sections, users, busy, onSaveLevels, onSaveMeta, onDelete, onAddPeople, onMove, initialTab = "permissions" }) {
  const [tab, setTab] = useState(initialTab);
  const [draft, setDraft] = useState(role.levels || {});
  const [editing, setEditing] = useState(false);
  const dirty = !role.is_admin && !sameLevels(draft, role.levels || {}, sections);
  const granted = role.is_admin ? sections.length : grantedCount(draft, sections);
  return (
    <section style={{ ...card, padding: 14, display: "grid", gap: 12 }} aria-label={`Role ${role.name}`}>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "wrap", justifyContent: "space-between" }}>
        <div style={{ minWidth: 0 }}>
          <h3 style={{ ...text, margin: 0, fontSize: 16, color: C.textInk, overflowWrap: "anywhere" }}>{role.name}</h3>
          <div style={muted}>{grantedLine(granted)}{role.description ? ` · ${role.description}` : ""}</div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button type="button" className="adm-icon" aria-label={`Edit ${role.name}`} title="Edit name and description" onClick={() => setEditing(!editing)}><Pencil size={16} aria-hidden="true" /></button>
          <button type="button" className="adm-icon" aria-label={`Delete ${role.name}`} title={role.is_system ? SYSTEM_ROLE_LINE : "Delete role"} disabled={role.is_system} onClick={() => onDelete(role)}><Trash2 size={16} aria-hidden="true" /></button>
          <button type="button" className="ui-btn ui-btn--primary" style={{ minHeight: 44 }} disabled={!dirty || busy} onClick={() => onSaveLevels(role, draft)}>Save Changes</button>
        </div>
      </div>
      {role.is_system ? <div style={muted}>{SYSTEM_ROLE_LINE}</div> : null}
      {editing ? <MetaForm role={role} busy={busy} onCancel={() => setEditing(false)} onSave={async (m) => { await onSaveMeta(role, m); setEditing(false); }} /> : null}
      <div className="adm-tabs" role="tablist" aria-label="Role sections">
        <button type="button" role="tab" id="adm-rt-people" aria-selected={tab === "people"} aria-controls="adm-rp-people" className="adm-tab" onClick={() => setTab("people")}><Users size={14} aria-hidden="true" /> People</button>
        <button type="button" role="tab" id="adm-rt-perm" aria-selected={tab === "permissions"} aria-controls="adm-rp-perm" className="adm-tab" onClick={() => setTab("permissions")}><ShieldCheck size={14} aria-hidden="true" /> Permissions</button>
      </div>
      {tab === "people" ? (
        <div role="tabpanel" id="adm-rp-people" aria-labelledby="adm-rt-people"><PeoplePanel role={role} roles={roles} users={users} busy={busy} onAdd={(list) => onAddPeople(role, list)} onMove={(u, to) => onMove(role, u, to)} /></div>
      ) : (
        <div role="tabpanel" id="adm-rp-perm" aria-labelledby="adm-rt-perm"><PermissionsPanel role={role} sections={sections} levels={draft} onChange={setDraft} /></div>
      )}
    </section>
  );
}

// The page, apart from the loading and saving, so each state can be shown on its own.
export function RoleManagementBody({ roles, sections = [], users = [], error = "", notice = "", busy = false, selectedId, onSelect, onNew, onRetry, onSaveLevels, onSaveMeta, onDelete, onAddPeople, onMove, creating = false, onCreate, onCancelCreate, initialTab }) {
  const loading = roles === null || roles === undefined;
  const list = roles || [];
  const selected = list.find((r) => r.id === selectedId) || list[0];
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <style>{ADMIN_CSS}</style>
      <PageHead title={ROLES_TITLE} sub={ROLES_SUB} action={<button type="button" className="ui-btn ui-btn--primary" style={{ minHeight: 44 }} onClick={onNew}><Plus size={15} aria-hidden="true" /> New role</button>} />
      <Live message={notice} error={error} />
      {error && loading && onRetry ? <div><button type="button" className="ui-btn ui-btn--secondary" style={{ minHeight: 44 }} onClick={onRetry}>Try again</button></div> : null}
      {loading && !error ? <CardsSkeleton count={3} label="Loading roles" /> : null}
      {creating ? <MetaForm role={null} busy={busy} onCancel={onCancelCreate} onSave={onCreate} /> : null}
      {!loading ? (
        list.length === 0 ? <div style={muted}>{NO_ROLES}</div> : (
          <div className="adm-split">
            <nav style={{ ...card, overflow: "hidden" }} aria-label="Roles">
              <div style={{ ...text, padding: "12px 14px", fontSize: 14, fontWeight: 700, color: C.textInk, borderBottom: `1px solid ${C.border}` }}>Roles</div>
              {list.map((r) => (
                <button key={r.id} type="button" className="adm-roleitem" aria-current={selected && selected.id === r.id ? "true" : undefined} onClick={() => onSelect(r.id)}>
                  <span style={{ ...text, display: "block", fontSize: 13.5, fontWeight: 600, color: C.textInk }}>{r.name}{r.is_admin ? <AdminCrown operator={{ is_admin: true }} /> : null}</span>
                  <span style={{ ...muted, fontSize: 12 }}>{roleListLine(r, sections)}</span>
                </button>
              ))}
            </nav>
            {selected ? <RolePanel key={selected.id} role={selected} roles={list} sections={sections} users={users} busy={busy} onSaveLevels={onSaveLevels} onSaveMeta={onSaveMeta} onDelete={onDelete} onAddPeople={onAddPeople} onMove={onMove} initialTab={initialTab} /> : null}
          </div>
        )
      ) : null}
    </div>
  );
}

export function RoleManagement() {
  const [roles, setRoles] = useState(null);
  const [sections, setSections] = useState([]);
  const [users, setUsers] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const [r, s, u] = await Promise.all([api.getRoles(), api.getSections(), api.getUsers()]);
      setRoles(r); setSections(s); setUsers(u); setError("");
    } catch (e) {
      setError(e.message || "Couldn't load roles. Try again.");
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const run = async (fn, done) => {
    setBusy(true); setError(""); setNotice("");
    try { await fn(); await load(); if (done) setNotice(done); } catch (e) { setError(e.message || "Something went wrong."); } finally { setBusy(false); }
  };
  const body = (role, patch) => ({ name: role.name, description: role.description || "", is_admin: !!role.is_admin, levels: role.levels || {}, ...patch });

  return (
    <RoleManagementBody
      roles={roles} sections={sections} users={users} error={error} notice={notice} busy={busy}
      selectedId={selectedId} onSelect={setSelectedId} onRetry={load}
      onNew={() => setCreating(true)} creating={creating} onCancelCreate={() => setCreating(false)}
      onCreate={(m) => run(async () => {
        const res = await api.createRole({ ...m, levels: Object.fromEntries(sections.map((s) => [s.key, "none"])) });
        setCreating(false); if (res && res.id) setSelectedId(res.id);
      }, `Role ${m.name.trim()} created.`)}
      onSaveLevels={(role, levels) => run(() => api.updateRole(role.id, body(role, { levels })), `${role.name} saved.`)}
      onSaveMeta={(role, m) => run(() => api.updateRole(role.id, body(role, m)), `${role.name} saved.`)}
      onDelete={async (role) => {
        const ok = await askConfirm({ title: `Delete the role ${role.name}?`, body: role.users ? `${plural(role.users, "person", "people")} still ${role.users === 1 ? "has" : "have"} it. Move them first.` : "This cannot be undone.", confirm: "Delete", danger: true });
        if (ok) { setSelectedId(""); await run(() => api.deleteRole(role.id), `Role ${role.name} deleted.`); }
      }}
      onAddPeople={(role, list) => run(async () => { for (const u of list) await api.updateUser(u.id, { role_ids: roleIdsAfterAdd(u, role.id) }); }, `${plural(list.length, "person", "people")} added to ${role.name}.`)}
      onMove={(role, u, toId) => run(() => api.updateUser(u.id, { role_ids: roleIdsAfterMove(u, role.id, toId) }), `${u.name} moved.`)}
    />
  );
}
