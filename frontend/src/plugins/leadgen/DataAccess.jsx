import React, { useCallback, useEffect, useState } from "react";
import { Crown } from "lucide-react";
import { CardsSkeleton } from "../../app/Loader";
import { C, FONT_BODY } from "../../tokens";
import { api } from "../../api/apiClient";
import { AdminCrown } from "../../components/AdminCrown";
import { AccessEditor, useAccessDraft } from "./admin/AccessEditor";
import { accessChanges, confirmTwice, roleSetChanges } from "./admin/confirmChange";

export { AREAS_HELP, AREA_ERROR, NEED_AREAS_LINE, NO_LIMIT_LINE, cleanArea, previewLine } from "./admin/AccessEditor";

const text = { fontFamily: FONT_BODY };
const muted = { ...text, fontSize: 13, color: C.slate, lineHeight: 1.5 };
const card = { border: `1px solid ${C.border}`, borderRadius: 12, background: "#fff", padding: 14, display: "grid", gap: 12, minWidth: 0 };
const field = { minHeight: 44, padding: "0 10px", border: `1px solid ${C.border}`, borderRadius: 8, fontFamily: FONT_BODY, fontSize: 14, background: "#fff", maxWidth: "100%" };

export const EMPTY_LINE = "No other users yet. Add people in Users and roles.";
export const HEADING_LINE = "Choose what each person in your organisation can see and do. Admins always see everything.";

// One person's settings. The saved copy comes from the server; the draft is what the screen holds until Save.
export function UserCard({ user, roles, allowed, onSaved, initialPreview = null, initialError = "" }) {
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
    <section style={card} aria-label={`Data access for ${user.name}`}>
      <div style={{ minWidth: 0 }}>
        <div style={{ ...text, fontSize: 15, fontWeight: 700, color: C.textInk, overflowWrap: "anywhere" }}>{user.name}{user.active === false ? <span style={{ ...muted, marginLeft: 8 }}>Disabled</span> : null}</div>
        <div style={{ ...muted, overflowWrap: "anywhere" }}>{user.email || `@${user.username}`}</div>
      </div>

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

// The drawing, apart from the loading, so each state can be shown on its own.
export function DataAccessBody({ data, error, loading, onSaved }) {
  const users = data ? data.users || [] : [];
  const admins = users.filter((u) => u.is_admin);
  const others = users.filter((u) => !u.is_admin);
  return (
    <div style={{ display: "grid", gap: 14, maxWidth: 760 }}>
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
          {others.map((u) => <UserCard key={u.id} user={u} roles={data.roles || []} allowed={data.districts_allowed || []} onSaved={onSaved} />)}
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
