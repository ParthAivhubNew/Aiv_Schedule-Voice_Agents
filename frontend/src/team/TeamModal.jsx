import React, { useCallback, useEffect, useMemo, useState } from "react";
import { X, Users, Shield, Plus, KeyRound, UserX, UserCheck, Copy, Trash2, Check, Phone, Coins } from "lucide-react";
import { NumbersTab } from "./NumbersTab";
import { CreditsTab } from "./CreditsTab";
import { C, FONT_DISPLAY, FONT_BODY, FONT_MONO, initialsFromName } from "../tokens";
import { api } from "../api/apiClient";

export const LEVEL_LABELS = { none: "No access", view: "View only", full: "Full access" };
const LEVELS = ["none", "view", "full"];

// Three-way switch for one section: No access / View only / Full access.
export function LevelPicker({ value, onChange, disabled }) {
  return (
    <div role="radiogroup" style={{ display: "inline-flex", border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden", opacity: disabled ? 0.55 : 1 }}>
      {LEVELS.map((lv) => {
        const on = value === lv;
        return (
          <button
            key={lv}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onChange(lv)}
            style={{
              padding: "5px 10px", border: "none", fontFamily: FONT_BODY, fontSize: 11.5, fontWeight: 600,
              background: on ? (lv === "none" ? C.paperSoft : lv === "view" ? C.cobaltSoft : C.cobalt) : "#fff",
              color: on ? (lv === "full" ? "#fff" : lv === "view" ? C.cobaltDeep : C.textInk) : C.slate,
              cursor: disabled ? "default" : "pointer",
            }}
          >
            {LEVEL_LABELS[lv]}
          </button>
        );
      })}
    </div>
  );
}

const btn = (primary) => ({
  display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 9, cursor: "pointer",
  border: primary ? "none" : `1px solid ${C.border}`, background: primary ? C.ink : "#fff", color: primary ? "#fff" : C.textInk,
  fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600,
});
const input = { padding: "8px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13, fontFamily: FONT_BODY, background: "#fff", width: "100%", boxSizing: "border-box" };

function TempPassword({ value, who, emailed, onClose }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ border: `1px solid ${C.amber}`, background: C.amberSoft, borderRadius: 12, padding: 14, marginBottom: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.textInk }}>Temporary password for {who}</div>
      <div style={{ fontSize: 12, color: C.slate, margin: "4px 0 8px" }}>
        {emailed ? "Also emailed to them. " : ""}Shown only now. {emailed ? "" : "Send it to them privately; "}They must pick their own at first sign-in.
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <code style={{ fontFamily: FONT_MONO, fontSize: 14, background: "#fff", padding: "6px 10px", borderRadius: 8, border: `1px solid ${C.border}` }}>{value}</code>
        <button type="button" style={btn(false)} onClick={() => { navigator.clipboard?.writeText(value); setCopied(true); }}>
          {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy"}
        </button>
        <button type="button" style={{ ...btn(false), marginLeft: "auto" }} onClick={onClose}>Done</button>
      </div>
    </div>
  );
}

function UsersTab({ me, roles, sections }) {
  const [users, setUsers] = useState([]);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", username: "", email: "", role_ids: [] });
  const [temp, setTemp] = useState(null);
  const [open, setOpen] = useState(null);

  const load = useCallback(async () => {
    try {
      setUsers(await api.getUsers());
    } catch (err) {
      setError(err.message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const act = async (fn) => {
    setError("");
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err.message || "Something went wrong.");
    }
  };

  const create = (e) => {
    e.preventDefault();
    act(async () => {
      const res = await api.createUser({
        name: form.name.trim(), username: form.username.trim().toLowerCase(), email: form.email.trim() || null,
        role_ids: form.role_ids.length ? form.role_ids : [roles.find((r) => r.name === "Operator")?.id].filter(Boolean),
      });
      setTemp({ value: res.temporary_password, who: res.name, emailed: res.emailed });
      setForm({ name: "", username: "", email: "", role_ids: [] });
      setAdding(false);
    });
  };

  const toggleRole = (list, id) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  return (
    <div>
      {temp && <TempPassword value={temp.value} who={temp.who} emailed={temp.emailed} onClose={() => setTemp(null)} />}
      {error && <div style={{ color: C.red, background: C.redSoft, borderRadius: 8, padding: "8px 12px", fontSize: 12.5, marginBottom: 12 }}>{error}</div>}
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
        {users.map((u, i) => {
          const isMe = u.id === me?.id;
          const expanded = open === u.id;
          return (
            <div key={u.id} style={{ borderTop: i ? `1px solid ${C.borderLight}` : "none", background: u.is_active ? "#fff" : C.paper }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px" }}>
                <div style={{ width: 34, height: 34, borderRadius: 999, background: u.is_admin ? C.cobalt : C.slate, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                  {initialsFromName(u.name)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: C.textInk }}>
                    {u.name} {isMe && <span style={{ fontSize: 11, color: C.slateLight }}>(you)</span>}
                    {!u.is_active && <span style={{ fontSize: 11, color: C.red, marginLeft: 6 }}>Disabled</span>}
                    {u.must_change_password && u.is_active && <span style={{ fontSize: 11, color: C.amber, marginLeft: 6 }}>Temporary password</span>}
                  </div>
                  <div style={{ fontFamily: FONT_MONO, fontSize: 11.5, color: C.slateLight, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    @{u.username}{u.email ? ` · ${u.email}` : ""}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  {u.roles.map((r) => (
                    <span key={r.id} style={{ fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 6, background: r.is_admin ? C.cobaltSoft : C.paperSoft, color: r.is_admin ? C.cobaltDeep : C.slate }}>{r.name}</span>
                  ))}
                </div>
                <button type="button" style={btn(false)} onClick={() => setOpen(expanded ? null : u.id)}>{expanded ? "Close" : "Manage"}</button>
              </div>
              {expanded && (
                <div style={{ padding: "4px 14px 16px 60px", display: "grid", gap: 14 }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.slate, marginBottom: 6 }}>Roles</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {roles.map((r) => {
                        const on = u.roles.some((x) => x.id === r.id);
                        return (
                          <label key={r.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, border: `1px solid ${on ? C.cobalt : C.border}`, borderRadius: 8, padding: "5px 10px", cursor: "pointer", background: on ? C.cobaltSoft : "#fff" }}>
                            <input
                              type="checkbox"
                              checked={on}
                              onChange={() => {
                                const next = toggleRole(u.roles.map((x) => x.id), r.id);
                                if (next.length) act(() => api.updateUser(u.id, { role_ids: next }));
                              }}
                            />
                            {r.name}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                  {!u.is_admin && (
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: C.slate, marginBottom: 6 }}>Extra access for this user only (on top of their roles)</div>
                      <div style={{ display: "grid", gap: 6 }}>
                        {sections.map((s) => (
                          <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <div style={{ width: 170, fontSize: 12.5, color: C.textInk }}>{s.label}</div>
                            <LevelPicker
                              value={u.grants[s.key] || "none"}
                              onChange={(lv) => act(() => api.updateUser(u.id, { grants: { ...u.grants, [s.key]: lv } }))}
                            />
                            <span style={{ fontSize: 11.5, color: C.slateLight }}>Now: {LEVEL_LABELS[u.permissions[s.key]]}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 8 }}>
                    <button type="button" style={btn(false)} onClick={() => act(async () => {
                      const r = await api.resetUserPassword(u.id);
                      setTemp({ value: r.temporary_password, who: u.name, emailed: r.emailed });
                    })}>
                      <KeyRound size={14} /> Reset password
                    </button>
                    {!isMe && (
                      <button type="button" style={btn(false)} onClick={() => act(() => api.updateUser(u.id, { is_active: !u.is_active }))}>
                        {u.is_active ? <><UserX size={14} /> Disable</> : <><UserCheck size={14} /> Enable</>}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {adding ? (
        <form onSubmit={create} style={{ border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, marginTop: 14, display: "grid", gap: 10, background: C.paper }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>Add a user</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <input style={input} placeholder="Full name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input style={input} placeholder="Username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          </div>
          <input style={input} placeholder="Email (optional)" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {roles.map((r) => (
              <label key={r.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, cursor: "pointer" }}>
                <input type="checkbox" checked={form.role_ids.includes(r.id)} onChange={() => setForm({ ...form, role_ids: toggleRole(form.role_ids, r.id) })} />
                {r.name}
              </label>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button type="button" style={btn(false)} onClick={() => setAdding(false)}>Cancel</button>
            <button type="submit" style={btn(true)}>Create user</button>
          </div>
        </form>
      ) : (
        <button type="button" onClick={() => setAdding(true)} style={{ ...btn(false), width: "100%", justifyContent: "center", marginTop: 14, borderStyle: "dashed" }}>
          <Plus size={14} /> Add user
        </button>
      )}
    </div>
  );
}

function RolesTab({ roles, sections, reload, isAdmin }) {
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState("");

  const startNew = () => setEditing({ id: null, name: "", description: "", is_admin: false, levels: Object.fromEntries(sections.map((s) => [s.key, "none"])) });

  const save = async () => {
    setError("");
    try {
      const body = { name: editing.name, description: editing.description, is_admin: editing.is_admin, levels: editing.levels };
      if (editing.id) await api.updateRole(editing.id, body);
      else await api.createRole(body);
      setEditing(null);
      await reload();
    } catch (err) {
      setError(err.message);
    }
  };

  const remove = async (r) => {
    setError("");
    try {
      await api.deleteRole(r.id);
      await reload();
    } catch (err) {
      setError(err.message);
    }
  };

  const groups = useMemo(() => {
    const out = [];
    sections.forEach((s) => {
      let g = out.find((x) => x.name === s.group);
      if (!g) out.push((g = { name: s.group, items: [] }));
      g.items.push(s);
    });
    return out;
  }, [sections]);

  if (editing) {
    return (
      <div>
        {error && <div style={{ color: C.red, background: C.redSoft, borderRadius: 8, padding: "8px 12px", fontSize: 12.5, marginBottom: 12 }}>{error}</div>}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 10, marginBottom: 12 }}>
          <input style={input} placeholder="Role name" value={editing.name} disabled={editing.is_system} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
          <input style={input} placeholder="What this role is for" value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
        </div>
        {isAdmin && (
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 12, cursor: "pointer" }}>
            <input type="checkbox" checked={editing.is_admin} onChange={(e) => setEditing({ ...editing, is_admin: e.target.checked })} />
            <span><b>Admin</b>: full access to everything, including users, roles and keys</span>
          </label>
        )}
        {!editing.is_admin && groups.map((g) => (
          <div key={g.name} style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.slateLight, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>{g.name}</div>
            {g.items.map((s) => (
              <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0", borderTop: `1px solid ${C.borderLight}` }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{s.label}</div>
                  <div style={{ fontSize: 11.5, color: C.slate }}>{s.description}</div>
                </div>
                <LevelPicker value={editing.levels[s.key] || "none"} onChange={(lv) => setEditing({ ...editing, levels: { ...editing.levels, [s.key]: lv } })} />
              </div>
            ))}
          </div>
        ))}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
          <button type="button" style={btn(false)} onClick={() => setEditing(null)}>Cancel</button>
          <button type="button" style={btn(true)} onClick={save}>Save role</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {error && <div style={{ color: C.red, background: C.redSoft, borderRadius: 8, padding: "8px 12px", fontSize: 12.5, marginBottom: 12 }}>{error}</div>}
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
        {roles.map((r, i) => (
          <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderTop: i ? `1px solid ${C.borderLight}` : "none" }}>
            <Shield size={16} color={r.is_admin ? C.cobalt : C.slate} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>{r.name} {r.is_system && <span style={{ fontSize: 11, color: C.slateLight }}>starter</span>}</div>
              <div style={{ fontSize: 12, color: C.slate }}>{r.description}</div>
            </div>
            <span style={{ fontSize: 12, color: C.slate }}>{r.users} user{r.users === 1 ? "" : "s"}</span>
            <button type="button" style={btn(false)} onClick={() => setEditing({ ...r })} disabled={r.is_admin && !isAdmin}>Edit</button>
            {!r.is_system && <button type="button" style={btn(false)} onClick={() => remove(r)} title="Delete role"><Trash2 size={14} /></button>}
          </div>
        ))}
      </div>
      <button type="button" onClick={startNew} style={{ ...btn(false), width: "100%", justifyContent: "center", marginTop: 14, borderStyle: "dashed" }}>
        <Plus size={14} /> New role
      </button>
    </div>
  );
}

// Users & roles: add people, give roles, set No access / View / Full per section.
export function TeamModal({ isOpen, onClose, currentUser, initialTab = "users" }) {
  const [tab, setTab] = useState(initialTab);
  const [roles, setRoles] = useState([]);
  const [sections, setSections] = useState([]);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    try {
      const [r, s] = await Promise.all([api.getRoles(), api.getSections()]);
      setRoles(r);
      setSections(s);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    if (isOpen) setTab(initialTab || "users");
  }, [isOpen, initialTab]);

  useEffect(() => {
    if (isOpen) reload();
  }, [isOpen, reload]);

  if (!isOpen) return null;
  const tabBtn = (key, label, Icon) => (
    <button
      type="button"
      onClick={() => setTab(key)}
      style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", border: "none", borderBottom: `2px solid ${tab === key ? C.ink : "transparent"}`, background: "none", fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, color: tab === key ? C.ink : C.slate, cursor: "pointer" }}
    >
      <Icon size={14} /> {label}
    </button>
  );

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(18,20,28,0.55)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 120, padding: 20 }}>
      <div style={{ background: "#fff", borderRadius: 18, width: "100%", maxWidth: 820, maxHeight: "90vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 70px rgba(0,0,0,0.22)", border: `1px solid ${C.border}`, fontFamily: FONT_BODY }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 24px 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: C.cobaltSoft, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Users size={18} color={C.cobalt} />
            </div>
            <div>
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18, color: C.textInk }}>Users, roles, numbers & credits</div>
              <div style={{ fontSize: 12, color: C.slate }}>Who can sign in, and what each person can see or change.</div>
            </div>
          </div>
          <button type="button" onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: C.slate }} aria-label="Close"><X size={18} /></button>
        </div>
        <div style={{ display: "flex", gap: 4, padding: "10px 20px 0", borderBottom: `1px solid ${C.border}` }}>
          {tabBtn("users", "Users", Users)}
          {tabBtn("roles", "Roles", Shield)}
          {tabBtn("numbers", "Phone numbers", Phone)}
          {currentUser?.is_admin && tabBtn("credits", "Plans & credits", Coins)}
        </div>
        <div style={{ padding: 20, overflowY: "auto" }}>
          {error && <div style={{ color: C.red, fontSize: 12.5, marginBottom: 10 }}>{error}</div>}
          {tab === "users" && <UsersTab me={currentUser} roles={roles} sections={sections} />}
          {tab === "roles" && <RolesTab roles={roles} sections={sections} reload={reload} isAdmin={Boolean(currentUser?.is_admin)} />}
          {tab === "numbers" && <NumbersTab />}
          {tab === "credits" && <CreditsTab />}
        </div>
      </div>
    </div>
  );
}
