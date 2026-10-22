import React, { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { C } from "../tokens";
import { adminApi } from "./adminApi";
import { Note, PageTitle, Pill, Table, btn, card, cell, heading, input, useAction, useLoad, when } from "./ui";

const EMPTY = { email: "", name: "", role: "staff_support", password: "" };

// How long a client can sit idle, and how long one sign-in can last, before they are signed out.
function SessionLimits({ canEdit }) {
  const [policy, err, reload] = useLoad(adminApi.sessionPolicy);
  const [msg, run] = useAction(reload);
  const [idle, setIdle] = useState("");
  const [max, setMax] = useState("");
  useEffect(() => { if (policy) { setIdle(String(policy.idle_minutes)); setMax(String(policy.max_hours)); } }, [policy]);
  const field = { ...input, width: 90 };
  return (
    <div style={{ ...card, marginBottom: 16 }}>
      <div style={{ ...heading, margin: "0 0 4px" }}>Client sign-in limits</div>
      <div style={{ fontSize: 12.5, color: C.slate, marginBottom: 12 }}>
        Clients get a warning and are then signed out after this long without activity, and again after this long since they signed in, however active they are. A live call counts as activity. A client's own admin can make these stricter for their team, never longer. Open screens pick up a change within 10 minutes.
      </div>
      <Note error>{err}</Note>
      <Note error={msg.error}>{msg.text}</Note>
      <form style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center" }}
        onSubmit={(e) => { e.preventDefault(); run(() => adminApi.setSessionPolicy(Number(idle), Number(max)), "Saved."); }}>
        <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
          Sign out after
          <input type="number" min={5} max={480} required value={idle} onChange={(e) => setIdle(e.target.value)} disabled={!canEdit || !policy} style={field} aria-label="Idle minutes" /> minutes idle
        </label>
        <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
          and after
          <input type="number" min={1} max={168} required value={max} onChange={(e) => setMax(e.target.value)} disabled={!canEdit || !policy} style={field} aria-label="Maximum hours" /> hours in total
        </label>
        {canEdit ? <button type="submit" style={btn(true)}>Save</button> : null}
      </form>
      <div style={{ fontSize: 12, color: C.slate, marginTop: 8 }}>Idle: 5 to 480 minutes. Total: 1 to 168 hours.</div>
    </div>
  );
}

// Aivhub staff accounts. Support staff can look at everything; staff admins can also change things.
export function Staff({ me, canEdit }) {
  const [rows, err, reload] = useLoad(adminApi.staff);
  const [msg, run] = useAction(reload);
  const [form, setForm] = useState(EMPTY);

  return (
    <>
      <PageTitle title="Staff" sub="Every staff account signs in with a password and a code from an authenticator app." />
      <SessionLimits canEdit={canEdit} />
      <Note error>{err}</Note>
      <Note error={msg.error}>{msg.text}</Note>
      {canEdit && (
        <form style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 16 }}
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => { await adminApi.addStaff(form); setForm(EMPTY); }, "Staff added. Give them the password; they set up two-factor at first sign-in.");
          }}>
          <input aria-label="Staff email" type="email" required placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} style={{ ...input, width: 220 }} />
          <input aria-label="Staff name" placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={{ ...input, width: 160 }} />
          <select aria-label="Staff role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} style={input}>
            <option value="staff_support">Support (view only)</option>
            <option value="staff_admin">Admin</option>
          </select>
          <input aria-label="Starting password" type="password" required autoComplete="new-password" placeholder="Starting password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} style={{ ...input, width: 180 }} />
          <button type="submit" style={btn(true)}><Plus size={13} /> Add staff</button>
        </form>
      )}

      <Table head={["Name", "Email", "Role", "Two-factor", "Active", "Last sign-in", ""]} minWidth={860}>
        {(rows || []).map((s) => {
          const self = s.id === me.staff_id;
          return (
            <tr key={s.id} style={{ opacity: s.active ? 1 : 0.55 }}>
              <td style={cell}>{s.name || "—"}{self && <span style={{ color: C.slate }}> (you)</span>}</td>
              <td style={cell}>{s.email}</td>
              <td style={cell}>
                {canEdit && !self ? (
                  <select aria-label={`Role of ${s.email}`} value={s.role} onChange={(e) => run(() => adminApi.patchStaff(s.id, { role: e.target.value }), "Role changed.")} style={input}>
                    <option value="staff_support">Support (view only)</option>
                    <option value="staff_admin">Admin</option>
                  </select>
                ) : s.role === "staff_admin" ? "Admin" : "Support (view only)"}
              </td>
              <td style={cell}><Pill tone={s.twoFactor ? "green" : "amber"}>{s.twoFactor ? "On" : "Set up at next sign-in"}</Pill></td>
              <td style={cell}>{s.active ? "Yes" : "No"}</td>
              <td style={cell}>{when(s.lastLoginAt)}</td>
              <td style={{ ...cell, textAlign: "right", whiteSpace: "nowrap" }}>
                {canEdit && !self && (
                  <>
                    <button type="button" style={btn(false)} onClick={() => {
                      if (window.confirm(`Reset two-factor for ${s.email}? They set it up again at their next sign-in.`)) run(() => adminApi.patchStaff(s.id, { reset2fa: true }), "Two-factor reset.");
                    }}>Reset two-factor</button>{" "}
                    <button type="button" style={btn(false)} onClick={() => run(() => adminApi.patchStaff(s.id, { active: !s.active }), s.active ? "Switched off." : "Switched on.")}>
                      {s.active ? "Switch off" : "Switch on"}
                    </button>
                  </>
                )}
              </td>
            </tr>
          );
        })}
      </Table>
    </>
  );
}
