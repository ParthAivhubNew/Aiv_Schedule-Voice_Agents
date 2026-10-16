import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Camera, CheckCircle2, AlertTriangle, Monitor, Trash2 } from "lucide-react";
import { C, FONT_DISPLAY, FONT_BODY, FONT_MONO, TIMEZONES } from "../tokens";
import { api } from "../api/apiClient";
import { Avatar } from "./Avatar";

const TABS = [["profile", "Profile"], ["notifications", "Notifications"], ["security", "Security"], ["account", "Account"]];
const LANGUAGES = [["en", "English"], ["es", "Español"], ["fr", "Français"], ["de", "Deutsch"], ["it", "Italiano"], ["pt", "Português"], ["nl", "Nederlands"], ["pl", "Polski"], ["hi", "हिन्दी"], ["ar", "العربية"]];
const FIELDS = ["first_name", "last_name", "pronouns", "job_title", "department", "company", "bio", "website", "secondary_email", "timezone", "language", "date_format", "time_format", "signature"];

const label = { display: "block", fontFamily: FONT_BODY, fontSize: 11.5, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 };
const input = { width: "100%", boxSizing: "border-box", padding: "9px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13, background: "#fff", color: C.textInk };
const card = { background: "#fff", border: `1px solid ${C.border}`, borderRadius: 14, padding: "clamp(16px, 3vw, 24px)" };
const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))", gap: 16 };
const h2 = { fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, color: C.textInk, margin: "0 0 14px" };
const btn = { padding: "8px 16px", borderRadius: 8, border: `1px solid ${C.border}`, background: "#fff", fontSize: 13, cursor: "pointer", fontFamily: FONT_BODY };
const btnDark = { ...btn, border: "none", background: C.ink, color: "#fff", fontWeight: 600 };

function zoneList() {
  try {
    const all = Intl.supportedValuesOf("timeZone");
    if (all.length) return all.map((id) => ({ id, label: id.replace(/_/g, " ") }));
  } catch (_) {}
  return TIMEZONES;
}

function Field({ id, name, children }) {
  return <div><label style={label} htmlFor={id}>{name}</label>{children}</div>;
}

function seed(operator) {
  const p = operator?.profile || {};
  const [first = "", ...rest] = String(operator?.name || "").trim().split(/\s+/);
  const base = Object.fromEntries(FIELDS.map((k) => [k, p[k] || ""]));
  // A name saved before first and last were separate fills the two boxes from the old one.
  if (!base.first_name && !base.last_name) {
    base.first_name = first;
    base.last_name = rest.join(" ");
  }
  base.timezone = base.timezone || (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (_) { return ""; } })();
  base.date_format = base.date_format || "dmy";
  base.time_format = base.time_format || "24h";
  base.language = base.language || "en";
  return { ...base, phone: operator?.phone || "", email: operator?.email || "" };
}

function when(iso) {
  if (!iso) return "";
  try { return new Date(iso.endsWith("Z") ? iso : `${iso}Z`).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }); } catch (_) { return ""; }
}

function deviceName(ua) {
  const s = String(ua || "");
  const os = /iPhone|iPad/.test(s) ? "iPhone or iPad" : /Android/.test(s) ? "Android" : /Windows/.test(s) ? "Windows" : /Mac OS X/.test(s) ? "Mac" : /Linux/.test(s) ? "Linux" : "Unknown device";
  const br = /Edg\//.test(s) ? "Edge" : /OPR\//.test(s) ? "Opera" : /Chrome\//.test(s) ? "Chrome" : /Firefox\//.test(s) ? "Firefox" : /Safari\//.test(s) ? "Safari" : "";
  return br ? `${br} on ${os}` : os;
}

// Your own profile: photo, details, email notifications and security. Only you can change it.
export function ProfilePage({ isOpen, onClose, operator, setOperator, orgName }) {
  const [tab, setTab] = useState("profile");
  const [form, setForm] = useState(() => seed(operator));
  const [base, setBase] = useState(() => seed(operator));
  const [notif, setNotif] = useState(null);
  const [notifBase, setNotifBase] = useState("");
  const [status, setStatus] = useState({ kind: "", text: "" });
  const [saving, setSaving] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [sessions, setSessions] = useState(null);
  const [pw, setPw] = useState({ current: "", next: "", again: "", busy: false, msg: "", ok: false });
  const fileRef = useRef(null);
  const zones = useMemo(zoneList, []);

  useEffect(() => {
    if (!isOpen || !operator) return;
    const s = seed(operator);
    setForm(s);
    setBase(s);
    setTab("profile");
    setStatus({ kind: "", text: "" });
    setNotif(null);
    api.getMyNotifications().then((n) => { setNotif(n); setNotifBase(JSON.stringify(n.events?.map((e) => e.on) || [])); }).catch(() => setNotif({ events: [], mailboxReady: false, failed: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, operator?.id]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && tab === "security") api.getMySessions().then(setSessions).catch(() => setSessions([]));
  }, [isOpen, tab]);

  if (!isOpen || !operator) return null;

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const dirty = JSON.stringify(form) !== JSON.stringify(base) || (notif && !notif.failed && JSON.stringify(notif.events.map((e) => e.on)) !== notifBase);
  const shownName = `${form.first_name} ${form.last_name}`.trim() || operator.name;

  const save = async (e) => {
    e?.preventDefault();
    if (!form.first_name.trim() && !form.last_name.trim()) return setStatus({ kind: "error", text: "Add your name." });
    setSaving(true);
    setStatus({ kind: "", text: "" });
    try {
      const profile = Object.fromEntries(FIELDS.map((k) => [k, form[k]]));
      const me = await api.updateMe({ email: form.email.trim(), phone: form.phone.trim(), profile });
      if (notif && !notif.failed) await api.setMyNotifications(Object.fromEntries(notif.events.map((ev) => [ev.key, ev.on])));
      setOperator((prev) => ({ ...prev, ...me }));
      setBase(form);
      setNotifBase(JSON.stringify(notif?.events?.map((x) => x.on) || []));
      setStatus({ kind: "ok", text: "Saved" });
    } catch (err) {
      setStatus({ kind: "error", text: err.message || "Could not save." });
    } finally {
      setSaving(false);
    }
  };

  const pickPhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return setStatus({ kind: "error", text: "Use a JPG, PNG or WebP photo." });
    if (file.size > 2 * 1024 * 1024) return setStatus({ kind: "error", text: "That photo is over 2 MB. Pick a smaller one." });
    setPhotoBusy(true);
    setStatus({ kind: "", text: "" });
    try {
      const me = await api.uploadMyAvatar(file);
      setOperator((prev) => ({ ...prev, avatar_url: me.avatar_url }));
    } catch (err) {
      setStatus({ kind: "error", text: err.message || "Could not upload the photo." });
    } finally {
      setPhotoBusy(false);
    }
  };

  const removePhoto = async () => {
    setPhotoBusy(true);
    try {
      await api.deleteMyAvatar();
      setOperator((prev) => ({ ...prev, avatar_url: null }));
    } catch (err) {
      setStatus({ kind: "error", text: err.message || "Could not remove the photo." });
    } finally {
      setPhotoBusy(false);
    }
  };

  const changePassword = async (e) => {
    e.preventDefault();
    if (pw.next !== pw.again) return setPw((p) => ({ ...p, msg: "The two new passwords do not match.", ok: false }));
    setPw((p) => ({ ...p, busy: true, msg: "" }));
    try {
      await api.changePassword(pw.current, pw.next);
      setPw({ current: "", next: "", again: "", busy: false, msg: "Password changed.", ok: true });
    } catch (err) {
      setPw((p) => ({ ...p, busy: false, msg: err.message || "Could not change the password.", ok: false }));
    }
  };

  const endSession = async (id) => {
    try { await api.endMySession(id); setSessions((s) => s.filter((x) => x.id !== id)); } catch (_) {}
  };
  const endOthers = async () => {
    try { await api.signOutOtherSessions(); setSessions((s) => s.filter((x) => x.current)); } catch (_) {}
  };

  const toggle = (key) => setNotif((n) => ({ ...n, events: n.events.map((e) => (e.key === key ? { ...e, on: !e.on } : e)) }));

  return (
    <div role="dialog" aria-label="Your profile" style={{ position: "fixed", inset: 0, zIndex: 120, background: C.paper, overflowY: "auto", overscrollBehavior: "contain" }}>
      <div style={{ maxWidth: 820, margin: "0 auto", padding: "clamp(14px, 3vw, 28px) clamp(16px, 4vw, 32px) 96px", display: "flex", flexDirection: "column", gap: 18 }}>
        <button type="button" onClick={onClose} style={{ all: "unset", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, fontFamily: FONT_BODY, fontSize: 13, color: C.slate, alignSelf: "flex-start" }}>
          <ArrowLeft size={15} /> Back
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <Avatar user={operator} size={72} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <h1 style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: "clamp(20px, 3vw, 24px)", color: C.textInk, margin: 0, overflowWrap: "anywhere" }}>{shownName}</h1>
            <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.slate, marginTop: 3 }}>
              {[form.job_title, form.company || orgName].filter(Boolean).join(" · ") || `@${operator.username}`}
            </div>
          </div>
        </div>

        <div role="tablist" style={{ display: "flex", gap: 4, borderBottom: `1px solid ${C.border}`, overflowX: "auto" }}>
          {TABS.map(([k, name]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => { setTab(k); setStatus({ kind: "", text: "" }); }}
              style={{ all: "unset", cursor: "pointer", padding: "10px 14px", fontFamily: FONT_BODY, fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap", color: tab === k ? C.cobalt : C.slate, borderBottom: `2px solid ${tab === k ? C.cobalt : "transparent"}`, marginBottom: -1 }}>
              {name}
            </button>
          ))}
        </div>

        {status.text ? (
          <div role="status" style={{ padding: "8px 12px", borderRadius: 8, fontSize: 12.5, fontFamily: FONT_BODY, display: "flex", alignItems: "center", gap: 6, background: status.kind === "ok" ? C.tealSoft : "#fdecea", color: status.kind === "ok" ? C.teal : "#b3261e" }}>
            {status.kind === "ok" ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />} {status.text}
          </div>
        ) : null}

        {tab === "profile" && (
          <form onSubmit={save} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <section style={card}>
              <h2 style={h2}>Photo</h2>
              <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
                <Avatar user={operator} size={88} />
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button type="button" style={btn} disabled={photoBusy} onClick={() => fileRef.current?.click()}>
                      <Camera size={14} style={{ verticalAlign: -2, marginRight: 6 }} />{photoBusy ? "Working…" : operator.avatar_url ? "Change photo" : "Upload photo"}
                    </button>
                    {operator.avatar_url ? (
                      <button type="button" style={{ ...btn, color: C.red }} disabled={photoBusy} onClick={removePhoto}>
                        <Trash2 size={14} style={{ verticalAlign: -2, marginRight: 6 }} />Remove
                      </button>
                    ) : null}
                  </div>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.slate }}>JPG, PNG or WebP, up to 2 MB. It is cropped to a square.</div>
                </div>
                <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={pickPhoto} hidden />
              </div>
            </section>

            <section style={card}>
              <h2 style={h2}>About you</h2>
              <div style={grid}>
                <Field id="p-first" name="First name"><input id="p-first" value={form.first_name} onChange={set("first_name")} style={input} autoComplete="given-name" maxLength={60} /></Field>
                <Field id="p-last" name="Last name"><input id="p-last" value={form.last_name} onChange={set("last_name")} style={input} autoComplete="family-name" maxLength={60} /></Field>
                <Field id="p-pro" name="Pronouns (optional)"><input id="p-pro" value={form.pronouns} onChange={set("pronouns")} style={input} placeholder="she/her, he/him, they/them" maxLength={30} /></Field>
                <Field id="p-title" name="Job title"><input id="p-title" value={form.job_title} onChange={set("job_title")} style={input} autoComplete="organization-title" maxLength={80} /></Field>
                <Field id="p-dept" name="Department"><input id="p-dept" value={form.department} onChange={set("department")} style={input} maxLength={80} /></Field>
                <Field id="p-co" name="Company"><input id="p-co" value={form.company} onChange={set("company")} style={input} placeholder={orgName || ""} autoComplete="organization" maxLength={120} /></Field>
              </div>
              <div style={{ marginTop: 16 }}>
                <Field id="p-bio" name="Short bio"><textarea id="p-bio" value={form.bio} onChange={set("bio")} style={{ ...input, minHeight: 72, resize: "vertical" }} maxLength={500} /></Field>
              </div>
            </section>

            <section style={card}>
              <h2 style={h2}>Contact</h2>
              <div style={grid}>
                <Field id="p-email" name="Email"><input id="p-email" type="email" value={form.email} onChange={set("email")} style={input} placeholder="you@company.com" autoComplete="email" /></Field>
                <Field id="p-email2" name="Second email (optional)"><input id="p-email2" type="email" value={form.secondary_email} onChange={set("secondary_email")} style={input} /></Field>
                <Field id="p-phone" name="Phone"><input id="p-phone" type="tel" value={form.phone} onChange={set("phone")} style={input} placeholder="+44 7700 900123" autoComplete="tel" /></Field>
                <Field id="p-web" name="Website or LinkedIn"><input id="p-web" value={form.website} onChange={set("website")} style={input} placeholder="linkedin.com/in/you" autoComplete="url" /></Field>
              </div>
              {operator.email && form.email.trim() !== operator.email ? (
                <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.slate, marginTop: 10 }}>You will need to verify the new address.</div>
              ) : null}
            </section>

            <section style={card}>
              <h2 style={h2}>Language and time</h2>
              <div style={grid}>
                <Field id="p-tz" name="Timezone">
                  <select id="p-tz" value={form.timezone} onChange={set("timezone")} style={input}>
                    <option value="">Not set</option>
                    {form.timezone && !zones.some((z) => z.id === form.timezone) ? <option value={form.timezone}>{form.timezone}</option> : null}
                    {zones.map((z) => <option key={z.id} value={z.id}>{z.label}</option>)}
                  </select>
                </Field>
                <Field id="p-lang" name="Language">
                  <select id="p-lang" value={form.language} onChange={set("language")} style={input}>
                    {LANGUAGES.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                  </select>
                </Field>
                <Field id="p-date" name="Date format">
                  <select id="p-date" value={form.date_format} onChange={set("date_format")} style={input}>
                    <option value="dmy">Day / month / year</option>
                    <option value="mdy">Month / day / year</option>
                  </select>
                </Field>
                <Field id="p-time" name="Clock">
                  <select id="p-time" value={form.time_format} onChange={set("time_format")} style={input}>
                    <option value="24h">24-hour</option>
                    <option value="12h">12-hour</option>
                  </select>
                </Field>
              </div>
            </section>

            <section style={card}>
              <h2 style={h2}>Email signature</h2>
              <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate, marginBottom: 10 }}>Added to emails the app sends as you.</div>
              <textarea id="p-sig" aria-label="Email signature" value={form.signature} onChange={set("signature")} style={{ ...input, minHeight: 90, resize: "vertical" }} maxLength={600} placeholder={`${shownName}\n${form.job_title || "Job title"}\n${form.phone || ""}`} />
            </section>
          </form>
        )}

        {tab === "notifications" && (
          <section style={card}>
            <h2 style={h2}>Email me when</h2>
            {!notif && <div style={{ fontSize: 12.5, color: C.slate }}>Loading…</div>}
            {notif?.failed && <div style={{ fontSize: 12.5, color: C.slate }}>Could not load your email settings.</div>}
            {notif && !notif.failed && (
              <>
                {!form.email.trim() && <div style={{ fontSize: 12.5, color: C.slate, marginBottom: 8 }}>Add your email on the Profile tab to receive these.</div>}
                {!notif.mailboxReady && <div style={{ fontSize: 12.5, color: C.slate, marginBottom: 8 }}>Platform email is not switched on yet; your choices are kept for when it is.</div>}
                {notif.events.map((ev) => (
                  <label key={ev.key} style={{ display: "flex", alignItems: "center", gap: 10, fontFamily: FONT_BODY, fontSize: 13.5, color: C.textInk, padding: "7px 0", cursor: "pointer" }}>
                    <input type="checkbox" checked={ev.on} onChange={() => toggle(ev.key)} />
                    {ev.label}
                  </label>
                ))}
              </>
            )}
          </section>
        )}

        {tab === "security" && (
          <>
            <form onSubmit={changePassword} style={card}>
              <h2 style={h2}>Change password</h2>
              <div style={{ ...grid, maxWidth: 520 }}>
                <Field id="pw-now" name="Current password"><input id="pw-now" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} style={input} /></Field>
                <span />
                <Field id="pw-new" name="New password"><input id="pw-new" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} style={input} /></Field>
                <Field id="pw-again" name="New password again"><input id="pw-again" type="password" autoComplete="new-password" value={pw.again} onChange={(e) => setPw({ ...pw, again: e.target.value })} style={input} /></Field>
              </div>
              {pw.msg ? <div role="status" style={{ marginTop: 12, fontSize: 12.5, fontFamily: FONT_BODY, color: pw.ok ? C.teal : "#b3261e" }}>{pw.msg}</div> : null}
              <div style={{ marginTop: 14 }}>
                <button type="submit" style={btnDark} disabled={pw.busy || !pw.current || !pw.next}>{pw.busy ? "Changing…" : "Change password"}</button>
              </div>
            </form>

            <section style={card}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
                <h2 style={{ ...h2, margin: 0, flex: 1 }}>Where you are signed in</h2>
                {sessions && sessions.length > 1 ? <button type="button" style={btn} onClick={endOthers}>Sign out everywhere else</button> : null}
              </div>
              {!sessions ? <div style={{ fontSize: 12.5, color: C.slate }}>Loading…</div> : sessions.map((s, i) => (
                <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderTop: i ? `1px solid ${C.borderLight}` : "none", flexWrap: "wrap" }}>
                  <Monitor size={18} color={C.slate} />
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <div style={{ fontFamily: FONT_BODY, fontSize: 13.5, fontWeight: 600, color: C.textInk }}>
                      {deviceName(s.device)} {s.current ? <span style={{ fontSize: 11, color: C.teal, marginLeft: 6 }}>This device</span> : null}
                    </div>
                    <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.slate }}>
                      {[s.ip, s.last_used_at ? `Last active ${when(s.last_used_at)}` : ""].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  {!s.current ? <button type="button" style={btn} onClick={() => endSession(s.id)}>Sign out</button> : null}
                </div>
              ))}
            </section>
          </>
        )}

        {tab === "account" && (
          <section style={card}>
            <h2 style={h2}>Account</h2>
            <div style={grid}>
              <Field id="a-user" name="Username"><input id="a-user" value={`@${operator.username || ""}`} disabled style={{ ...input, fontFamily: FONT_MONO, fontSize: 12.5, background: C.paperSoft, color: C.slate }} /></Field>
              <Field id="a-role" name="Role"><input id="a-role" value={operator.role || ""} disabled style={{ ...input, background: C.paperSoft, color: C.slate }} /></Field>
              <Field id="a-org" name="Organisation"><input id="a-org" value={orgName || ""} disabled style={{ ...input, background: C.paperSoft, color: C.slate }} /></Field>
              <Field id="a-since" name="Member since"><input id="a-since" value={when(operator.member_since).split(",").slice(0, 2).join(",")} disabled style={{ ...input, background: C.paperSoft, color: C.slate }} /></Field>
              <Field id="a-last" name="Last sign-in"><input id="a-last" value={when(operator.last_login_at)} disabled style={{ ...input, background: C.paperSoft, color: C.slate }} /></Field>
            </div>
          </section>
        )}
      </div>

      {dirty && (tab === "profile" || tab === "notifications") ? (
        <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, background: "#fff", borderTop: `1px solid ${C.border}`, padding: "12px clamp(16px, 4vw, 32px)", display: "flex", justifyContent: "flex-end", gap: 8, zIndex: 130 }}>
          <button type="button" style={btn} onClick={() => { setForm(base); if (notif && !notif.failed) api.getMyNotifications().then(setNotif).catch(() => {}); }}>Discard</button>
          <button type="button" style={btnDark} disabled={saving} onClick={save}>{saving ? "Saving…" : "Save changes"}</button>
        </div>
      ) : null}
    </div>
  );
}
