import React, { useCallback, useEffect, useState } from "react";
import { ChevronDown, Crown } from "lucide-react";
import { CardsSkeleton } from "../../app/Loader";
import { C, FONT_BODY } from "../../tokens";
import { api } from "../../api/apiClient";
import { AdminCrown } from "../../components/AdminCrown";
import { AccessEditor, useAccessDraft } from "./admin/AccessEditor";
import { accessChanges, confirmTwice, roleSetChanges } from "./admin/confirmChange";

export { AREAS_HELP, AREA_ERROR, NEED_AREAS_LINE, NO_LIMIT_LINE, cleanArea, previewLine } from "./admin/AccessEditor";

const text = { fontFamily: FONT_BODY };
const muted = { ...text, fontSize: 13, color: C.slate, lineHeight: 1.5 };
const card = { border: `1px solid ${C.border}`, borderRadius: 12, background: C.surface, padding: 14, display: "grid", gap: 12, minWidth: 0 };
const field = { minHeight: 44, padding: "0 10px", border: `1px solid ${C.border}`, borderRadius: 8, fontFamily: FONT_BODY, fontSize: 14, background: C.surface, maxWidth: "100%" };

export const EMPTY_LINE = "No other users yet. Add people in Users and roles.";
export const HEADING_LINE = "Choose what each person in your organisation can see and do. Admins always see everything.";

// One person's settings. The saved copy comes from the server; the draft is what the screen holds until Save.
export function UserCard({ user, roles, allowed, onSaved, initialPreview = null, initialError = "", bare = false }) {
  const startRole = user.roles && user.roles[0] ? user.roles[0].id : "";
  const [roleId, setRoleId] = useState(startRole);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);
  const [saved, setSaved] = useState("");
  const draft = useAccessDraft(user, user.id, { initialPreview, onTouch: () => { setSaved(""); setError(""); } });

  const dirty = roleId !== startRole || draft.dirty;
  const roleLines = roleId !== startRole ? roleSetChanges(startRole ? [startRole] : [], roleId ? [roleId] : [], roles) : [];
  const base = `da-${user.id}`;

  const save = async () => {
    const changes = [...roleLines, ...accessChanges(user, draft)];
    const sure = await confirmTwice({ title: `Save changes to ${user.name}?`, changes, subject: user.name });
    if (!sure) return;
    setBusy(true); setError(""); setSaved("");
    try {
      const body = draft.body();
      if (roleId) body.role_id = roleId;
      const updated = await api.setDataAccess(user.id, body);
      onSaved(updated);
      setSaved("Saved.");
    } catch (e) {
      setError(e.message || "Couldn't save. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section style={bare ? { display: "grid", gap: 12, minWidth: 0 } : card} aria-label={`Data access for ${user.name}`}>
      {bare ? null : (
        <div style={{ minWidth: 0 }}>
          <div style={{ ...text, fontSize: 15, fontWeight: 700, color: C.textInk, overflowWrap: "anywhere" }}>{user.name}{user.active === false ? <span style={{ ...muted, marginLeft: 8 }}>Disabled</span> : null}</div>
          <div style={{ ...muted, overflowWrap: "anywhere" }}>{user.email || `@${user.username}`}</div>
        </div>
      )}

      <div style={{ display: "grid", gap: 4 }}>
        <label htmlFor={`${base}-role`} style={{ ...text, fontSize: 13, fontWeight: 600, color: C.textInk }}>Role</label>
        <select id={`${base}-role`} value={roleId} onChange={(e) => { setRoleId(e.target.value); setSaved(""); setError(""); }} style={field}>
          {!startRole ? <option value="">No role</option> : null}
          {roles.filter((r) => !r.is_admin || r.id === startRole).map((r) => <option key={r.id} value={r.id}>{r.name}{r.is_active === false ? " (inactive)" : ""}</option>)}
        </select>
        <span style={{ ...muted, fontSize: 12.5 }}>Controls which apps they can use</span>
      </div>

      <AccessEditor draft={draft} allowed={allowed} idBase={base} disabled={busy} />

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" className="ui-btn ui-btn--primary" style={{ minHeight: 44 }} disabled={!dirty || draft.needsAreas || busy} onClick={save}>{busy ? "Saving…" : "Save"}</button>
      </div>
      <div role="status" aria-live="polite" style={{ display: "grid", gap: 4 }}>
        {saved ? <div style={{ ...text, fontSize: 13.5, color: C.textInk }}>{saved}</div> : null}
      </div>
      {error ? <div role="alert" style={{ ...text, fontSize: 13.5, color: C.red }}>{error}</div> : null}
    </section>
  );
}


export const areasSummary = (user) => {
  const d = user.districts || [];
  return d.length ? (d.length <= 3 ? d.join(", ") : `${d.slice(0, 3).join(", ")} +${d.length - 3}`) : "All postcodes";
};
const pill = { ...text, fontSize: 12, padding: "2px 8px", borderRadius: 999, background: C.neutralSoft, color: C.slate, whiteSpace: "nowrap" };

// One person as a single line. Clicking it opens their settings below the line.
function UserRow({ user, roles, allowed, onSaved, open, onToggle }) {
  const role = (user.roles && user.roles[0] && user.roles[0].name) || "No role";
  const panel = `da-panel-${user.id}`;
  const limited = (user.districts || []).length > 0;
  return (
    <div style={{ borderTop: `1px solid ${C.borderLight}` }}>
      <button type="button" aria-expanded={open} aria-controls={panel} onClick={onToggle}
        style={{ ...text, width: "100%", minHeight: 56, display: "flex", alignItems: "center", gap: 12, padding: "8px 14px", border: 0, background: open ? C.neutralBg : C.surface, cursor: "pointer", textAlign: "left" }}>
        <span style={{ flex: "1 1 180px", minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 14.5, fontWeight: 700, color: C.textInk, overflowWrap: "anywhere" }}>{user.name}{user.active === false ? <span style={{ ...muted, marginLeft: 8, fontWeight: 400 }}>Disabled</span> : null}</span>
          <span style={{ display: "block", ...muted, fontSize: 12.5, overflowWrap: "anywhere" }}>{user.email || `@${user.username}`}</span>
        </span>
        <span style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end", alignItems: "center" }}>
          <span style={pill}>{role}</span>
          <span style={{ ...pill, background: limited ? C.tealSoft : C.neutralSoft, color: limited ? C.teal : C.slate }}>{areasSummary(user)}</span>
          {user.allow_export === false ? <span style={pill}>No export</span> : null}
          {user.allow_google === false ? <span style={pill}>No Google details</span> : null}
        </span>
        <ChevronDown size={16} aria-hidden="true" style={{ flexShrink: 0, color: C.slate, transform: open ? "rotate(180deg)" : "none", transition: "transform .12s" }} />
      </button>
      {open ? (
        <div id={panel} style={{ padding: "4px 14px 16px", background: C.neutralBg }}>
          <UserCard bare user={user} roles={roles} allowed={allowed} onSaved={onSaved} />
        </div>
      ) : null}
    </div>
  );
}

// The drawing, apart from the loading, so each state can be shown on its own.
export function DataAccessBody({ data, error, loading, onSaved, initialOpen = "" }) {
  const [openId, setOpenId] = useState(initialOpen);
  const [find, setFind] = useState("");
  const users = data ? data.users || [] : [];
  const admins = users.filter((u) => u.is_admin);
  const others = users.filter((u) => !u.is_admin);
  const q = find.trim().toLowerCase();
  const shown = q ? others.filter((u) => `${u.name} ${u.email || ""} ${u.username || ""}`.toLowerCase().includes(q)) : others;
  return (
    <div style={{ display: "grid", gap: 14, width: "100%", minWidth: 0 }}>
      <div>
        <h2 style={{ ...text, margin: 0, fontSize: 20, color: C.textInk }}>Data access</h2>
        <p style={{ ...muted, margin: "4px 0 0" }}>{HEADING_LINE}</p>
      </div>
      {error ? <div role="alert" style={{ ...text, fontSize: 13.5, color: C.red }}>{error}</div> : null}
      {loading ? <CardsSkeleton count={2} label="Loading data access" /> : null}
      {data ? (
        <>
          {admins.length ? (
            <div style={{ ...muted, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <strong style={{ color: C.textInk }}><Crown size={14} aria-hidden="true" style={{ verticalAlign: "middle" }} /> Admins</strong>
              {admins.map((u) => <span key={u.id} style={{ color: C.textInk }}>{u.name}<AdminCrown operator={u} /></span>)}
              <span>See everything. Not editable here.</span>
            </div>
          ) : null}
          {others.length === 0 ? <div style={muted}>{EMPTY_LINE}</div> : null}
          {others.length > 6 ? (
            <input type="search" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find a person" aria-label="Find a person" style={{ ...field, maxWidth: 320 }} />
          ) : null}
          {others.length ? (
            <section aria-label="People" style={{ ...card, padding: 0, gap: 0, overflow: "hidden" }}>
              <div style={{ ...muted, fontSize: 12, padding: "8px 14px" }}>
                {others.length} {others.length === 1 ? "person" : "people"}. Click a person to change what they can see.
              </div>
              {shown.length === 0 ? <div style={{ ...muted, padding: "10px 14px", borderTop: `1px solid ${C.borderLight}` }}>Nobody matches that.</div> : null}
              {shown.map((u) => (
                <UserRow key={u.id} user={u} roles={data.roles || []} allowed={data.districts_allowed || []} onSaved={onSaved} open={openId === u.id} onToggle={() => setOpenId(openId === u.id ? "" : u.id)} />
              ))}
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export function DataAccess() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try { setData(await api.getDataAccess()); setError(""); } catch (e) { setError(e.message || "Couldn't load data access. Try again."); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const onSaved = (u) => setData((d) => (d ? { ...d, users: d.users.map((x) => (x.id === u.id ? { ...x, ...u } : x)) } : d));
  return (
    <div style={{ display: "grid", gap: 20 }}>
      <DataAccessBody data={data} error={error} loading={!data && !error} onSaved={onSaved} />
      {error && !data ? <button type="button" className="ui-btn ui-btn--secondary" style={{ minHeight: 44, marginTop: 10 }} onClick={load}>Try again</button> : null}
    </div>
  );
}
