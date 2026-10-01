import React, { useState } from "react";
import { Plus } from "lucide-react";
import { C } from "../tokens";
import { adminApi } from "./adminApi";
import { Note, PageTitle, Pill, Table, btn, cell, input, useAction, useLoad, when } from "./ui";

const EMPTY = { email: "", name: "", role: "staff_support", password: "" };

// Aivhub staff accounts. Support staff can look at everything; staff admins can also change things.
export function Staff({ me, canEdit }) {
  const [rows, err, reload] = useLoad(adminApi.staff);
  const [msg, run] = useAction(reload);
  const [form, setForm] = useState(EMPTY);

  return (
    <>
      <PageTitle title="Staff" sub="Every staff account signs in with a password and a code from an authenticator app." />
      <Note error>{err}</Note>
      <Note error={msg.error}>{msg.text}</Note>
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

      {canEdit && (
        <form style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 14 }}
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
    </>
  );
}
