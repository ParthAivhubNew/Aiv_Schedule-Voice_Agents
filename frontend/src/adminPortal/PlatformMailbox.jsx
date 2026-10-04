import React, { useEffect, useState } from "react";
import { C } from "../tokens";
import { adminApi } from "./adminApi";
import { Note, Pill, btn, card, heading, input, useAction, useLoad } from "./ui";

const blank = { email: "", from_name: "Outreach by Aivhub", preset: "one.com", password: "", smtp_host: "", smtp_port: "", smtp_security: "", imap_host: "", imap_port: "", username: "" };
const label = { fontSize: 12, fontWeight: 600, color: C.slate, display: "grid", gap: 4 };

// Outreach's own mailbox (e.g. one.com): sends system email (invites, resets, alerts) and is the
// warmup partner for every client mailbox. Saving logs in to SMTP and IMAP first.
export function PlatformMailbox({ canEdit }) {
  const [data, err, reload] = useLoad(adminApi.platformMailbox);
  const [msg, run] = useAction(reload);
  const [form, setForm] = useState(blank);
  useEffect(() => {
    if (data?.configured) {
      const custom = data.smtp_host !== "send.one.com";
      setForm({ ...blank, email: data.email, from_name: data.from_name, preset: custom ? "" : "one.com", smtp_host: data.smtp_host, smtp_port: String(data.smtp_port),
        smtp_security: data.smtp_security, imap_host: data.imap_host, imap_port: String(data.imap_port), username: data.username });
    }
  }, [data]);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const save = () => run(() => adminApi.savePlatformMailbox({
    ...form, smtp_port: form.smtp_port ? Number(form.smtp_port) : null, imap_port: form.imap_port ? Number(form.imap_port) : null,
    ...(form.preset ? { smtp_host: "", imap_host: "", smtp_port: null, imap_port: null, smtp_security: "" } : {}),
  }).then((r) => { setForm((f) => ({ ...f, password: "" })); return r; }), "Logged in to sending and reading, and saved.");

  return (
    <>
      <div style={heading}>Platform mailbox</div>
      <div style={{ ...card, display: "grid", gap: 10 }}>
        <div style={{ fontSize: 12.5, color: C.slate }}>
          Sends system email (invites, password resets, alerts) and is the warmup partner for every client mailbox: it takes their
          warmup emails out of spam, marks them read and answers some.
          {data && (data.configured ? <> <Pill tone="green">Set up: {data.email}</Pill></> : <> <Pill>Not set up (system email uses the server's SYSTEM_MAIL settings)</Pill></>)}
        </div>
        <Note error>{err}</Note>
        <Note error={msg.error}>{msg.text}</Note>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
          <label style={label}>Email address<input style={input} value={form.email} onChange={set("email")} disabled={!canEdit} placeholder="hello@yourdomain.com" /></label>
          <label style={label}>Sender name<input style={input} value={form.from_name} onChange={set("from_name")} disabled={!canEdit} /></label>
          <label style={label}>Provider
            <select style={input} value={form.preset} onChange={set("preset")} disabled={!canEdit}>
              <option value="one.com">one.com</option><option value="gmail">Google Workspace</option><option value="outlook">Microsoft 365</option>
              <option value="zoho">Zoho Mail</option><option value="">Other (enter servers)</option>
            </select>
          </label>
          <label style={label}>Password{data?.has_password ? " (empty = keep saved)" : ""}
            <input style={input} type="password" autoComplete="new-password" value={form.password} onChange={set("password")} disabled={!canEdit} />
          </label>
        </div>
        {form.preset === "" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
            <label style={label}>SMTP server<input style={input} value={form.smtp_host} onChange={set("smtp_host")} disabled={!canEdit} /></label>
            <label style={label}>SMTP port<input style={input} value={form.smtp_port} onChange={set("smtp_port")} disabled={!canEdit} placeholder="465" /></label>
            <label style={label}>IMAP server<input style={input} value={form.imap_host} onChange={set("imap_host")} disabled={!canEdit} /></label>
            <label style={label}>IMAP port<input style={input} value={form.imap_port} onChange={set("imap_port")} disabled={!canEdit} placeholder="993" /></label>
            <label style={label}>Username<input style={input} value={form.username} onChange={set("username")} disabled={!canEdit} placeholder="usually the email" /></label>
          </div>
        )}
        {canEdit && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" style={btn(true)} onClick={save}>Test and save</button>
            {data?.configured && <button type="button" style={btn(false)} onClick={() => run(() => adminApi.testPlatformMailbox().then((r) => r), "Test email sent to you.")}>Send me a test email</button>}
            {data?.configured && <button type="button" style={btn(false)} onClick={() => {
              if (window.confirm("Remove the platform mailbox? System email falls back to the server settings and warmup loses its partner.")) {
                run(() => adminApi.clearPlatformMailbox().then(() => setForm(blank)), "Removed.");
              }
            }}>Remove</button>}
          </div>
        )}
      </div>
    </>
  );
}
