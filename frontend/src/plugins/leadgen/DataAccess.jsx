import React, { useCallback, useEffect, useState } from "react";
import { Crown, Eye } from "lucide-react";
import { CardsSkeleton } from "../../app/Loader";
import { C, FONT_BODY } from "../../tokens";
import { api } from "../../api/apiClient";
import { AdminCrown } from "../../components/AdminCrown";

const text = { fontFamily: FONT_BODY };
const muted = { ...text, fontSize: 13, color: C.slate, lineHeight: 1.5 };
const card = { border: `1px solid ${C.border}`, borderRadius: 12, background: "#fff", padding: 14, display: "grid", gap: 12, minWidth: 0 };
const field = { minHeight: 44, padding: "0 10px", border: `1px solid ${C.border}`, borderRadius: 8, fontFamily: FONT_BODY, fontSize: 14, background: "#fff", maxWidth: "100%" };

export const NO_LIMIT_LINE = "All FSB areas. No personal limit.";
export const AREAS_HELP = "Pick areas only if you want to limit this person to them.";
export const EMPTY_LINE = "No other users yet. Add people in Users and roles.";
export const HEADING_LINE = "Choose what each person in your organisation can see and do. Admins always see everything.";

// "1,240 companies in 3 areas", or "in all FSB areas" when the person has no limit.
export function previewLine(p) {
  if (!p) return "";
  const n = Number(p.companies || 0).toLocaleString("en-GB");
  const k = (p.districts || []).length;
  return `${n} ${Number(p.companies) === 1 ? "company" : "companies"} ${k ? `in ${k} ${k === 1 ? "area" : "areas"}` : "in all FSB areas"}`;
}

const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

function Switch({ id, label, hint, checked, onChange }) {
  return (
    <label htmlFor={id} style={{ display: "flex", gap: 10, alignItems: "flex-start", minHeight: 44, cursor: "pointer" }}>
      <input id={id} type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ width: 22, height: 22, marginTop: 10, flexShrink: 0 }} />
      <span style={{ display: "grid", gap: 2, paddingTop: 9 }}>
        <span style={{ ...text, fontSize: 14, fontWeight: 600, color: C.textInk }}>{label} <span style={{ fontWeight: 500, color: C.slate }}>({checked ? "On" : "Off"})</span></span>
        <span style={{ ...muted, fontSize: 12.5 }}>{hint}</span>
      </span>
    </label>
  );
}

// One person's settings. The saved copy comes from the server; the draft is what the screen holds until Save.
export function UserCard({ user, roles, allowed, onSaved, initialPreview = null, initialError = "" }) {
  const startRole = user.roles && user.roles[0] ? user.roles[0].id : "";
  const [roleId, setRoleId] = useState(startRole);
  const [districts, setDistricts] = useState(user.districts || []);
  const [allowExport, setAllowExport] = useState(user.allow_export !== false);
  const [allowGoogle, setAllowGoogle] = useState(user.allow_google !== false);
  const [preview, setPreview] = useState(initialPreview);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState(initialError);
  const [saved, setSaved] = useState("");

  const dirty = roleId !== startRole || !sameSet(districts, user.districts || []) || allowExport !== (user.allow_export !== false) || allowGoogle !== (user.allow_google !== false);
  const touch = (fn) => (v) => { fn(v); setSaved(""); setError(""); setPreview(null); };
  const toggle = (d) => touch(setDistricts)(districts.includes(d) ? districts.filter((x) => x !== d) : [...districts, d]);
  const base = `da-${user.id}`;

  const save = async () => {
    setBusy("save"); setError(""); setSaved("");
    try {
      const body = { districts, allow_export: allowExport, allow_google: allowGoogle };
      if (roleId) body.role_id = roleId;
      const updated = await api.setDataAccess(user.id, body);
      onSaved(updated);
      setSaved("Saved.");
    } catch (e) {
      setError(e.message || "Couldn't save. Try again.");
    } finally {
      setBusy("");
    }
  };
  const look = async () => {
    setBusy("preview"); setError("");
    try { setPreview(await api.previewDataAccess(user.id)); } catch (e) { setError(e.message || "Couldn't work that out. Try again."); } finally { setBusy(""); }
  };

  return (
    <section style={card} aria-label={`Data access for ${user.name}`}>
      <div style={{ minWidth: 0 }}>
        <div style={{ ...text, fontSize: 15, fontWeight: 700, color: C.textInk, overflowWrap: "anywhere" }}>{user.name}{user.active === false ? <span style={{ ...muted, marginLeft: 8 }}>Disabled</span> : null}</div>
        <div style={{ ...muted, overflowWrap: "anywhere" }}>{user.email || `@${user.username}`}</div>
      </div>

      <div style={{ display: "grid", gap: 4 }}>
        <label htmlFor={`${base}-role`} style={{ ...text, fontSize: 13, fontWeight: 600, color: C.textInk }}>Role</label>
        <select id={`${base}-role`} value={roleId} onChange={(e) => touch(setRoleId)(e.target.value)} style={field}>
          {!startRole ? <option value="">No role</option> : null}
          {roles.filter((r) => !r.is_admin || r.id === startRole).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <span style={{ ...muted, fontSize: 12.5 }}>Controls which apps they can use</span>
      </div>

      <fieldset style={{ border: "none", margin: 0, padding: 0, display: "grid", gap: 8, minWidth: 0 }}>
        <legend style={{ ...text, fontSize: 13, fontWeight: 600, color: C.textInk, padding: 0, marginBottom: 6 }}>Areas</legend>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" style={{ minHeight: 44 }} onClick={() => touch(setDistricts)([...allowed])}>Select all</button>
          <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" style={{ minHeight: 44 }} onClick={() => touch(setDistricts)([])}>Clear</button>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {allowed.map((d) => {
            const on = districts.includes(d);
            return (
              <button key={d} type="button" aria-pressed={on} onClick={() => toggle(d)}
                style={{ minHeight: 44, minWidth: 44, padding: "0 12px", borderRadius: 999, border: `1px solid ${on ? C.cobalt : C.border}`, background: on ? C.cobaltSoft : "#fff", color: on ? C.cobaltDeep : C.textInk, fontFamily: FONT_BODY, fontSize: 13, fontWeight: on ? 700 : 500, cursor: "pointer" }}>
                {on ? "✓ " : ""}{d}
              </button>
            );
          })}
        </div>
        {districts.length ? <div style={muted}>{districts.length} {districts.length === 1 ? "area" : "areas"} chosen: {districts.join(", ")}</div> : <div style={{ ...text, fontSize: 13.5, fontWeight: 600, color: C.textInk }}>{NO_LIMIT_LINE}</div>}
        <div style={{ ...muted, fontSize: 12.5 }}>{AREAS_HELP}</div>
      </fieldset>

      <div style={{ display: "grid", gap: 2 }}>
        <Switch id={`${base}-export`} label="Can export data" hint="On until you switch it off" checked={allowExport} onChange={touch(setAllowExport)} />
        <Switch id={`${base}-google`} label="Can open live Google details" hint="On until you switch it off" checked={allowGoogle} onChange={touch(setAllowGoogle)} />
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" className="ui-btn ui-btn--secondary" style={{ minHeight: 44 }} disabled={busy !== ""} onClick={look}><Eye size={15} aria-hidden="true" /> {busy === "preview" ? "Working it out…" : "What will they see?"}</button>
        <button type="button" className="ui-btn ui-btn--primary" style={{ minHeight: 44 }} disabled={!dirty || busy !== ""} onClick={save}>{busy === "save" ? "Saving…" : "Save"}</button>
      </div>
      <div role="status" aria-live="polite" style={{ display: "grid", gap: 4 }}>
        {preview ? <div style={{ ...text, fontSize: 13.5, color: C.textInk }}>{previewLine(preview)}{dirty ? <span style={muted}> (as last saved)</span> : null}</div> : null}
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
    <div>
      <DataAccessBody data={data} error={error} loading={!data && !error} onSaved={onSaved} />
      {error && !data ? <button type="button" className="ui-btn ui-btn--secondary" style={{ minHeight: 44, marginTop: 10 }} onClick={load}>Try again</button> : null}
    </div>
  );
}
