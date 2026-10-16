import React, { useEffect, useMemo, useRef, useState } from "react";
import { Camera, CheckCircle2, AlertTriangle, Monitor, Trash2, X } from "lucide-react";
import { C, FONT_DISPLAY, FONT_BODY, FONT_MONO, TIMEZONES } from "../tokens";
import { api } from "../api/apiClient";
import { Avatar } from "./Avatar";

const TABS = [["profile", "Profile"], ["contact", "Contact"], ["prefs", "Preferences"], ["notifications", "Notifications"], ["security", "Security"], ["account", "Account"]];
const GENDERS = ["Female", "Male", "Non-binary"];
const isCustom = (g) => Boolean(g) && !GENDERS.includes(g);
const LANGUAGES = [["en", "English"], ["es", "Español"], ["fr", "Français"], ["de", "Deutsch"], ["it", "Italiano"], ["pt", "Português"], ["nl", "Nederlands"], ["pl", "Polski"], ["hi", "हिन्दी"], ["ar", "العربية"]];
const FIELDS = ["first_name", "last_name", "gender", "job_title", "department", "company", "bio", "website", "secondary_email", "timezone", "language", "date_format", "time_format", "signature"];

const label = { display: "block", fontFamily: FONT_BODY, fontSize: 11.5, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 };
const input = { width: "100%", boxSizing: "border-box", padding: "9px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13, background: "#fff", color: C.textInk };
const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap: 14 };
const note = { fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate };
const btn = { padding: "8px 16px", borderRadius: 8, border: `1px solid ${C.border}`, background: "#fff", fontSize: 13, cursor: "pointer", fontFamily: FONT_BODY };
const btnDark = { ...btn, border: "none", background: C.ink, color: "#fff", fontWeight: 600 };


// A dialog with the sections down the left; on a phone the sections run along the top and the dialog fills the screen.
const MODAL_CSS = `
.pf-modal{display:flex;width:100%;max-width:860px;height:min(640px,calc(100dvh - 32px));background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 24px 70px rgba(0,0,0,.22);border:1px solid ${C.border}}
.pf-side{width:210px;flex-shrink:0;background:${C.paperSoft};border-right:1px solid ${C.border};display:flex;flex-direction:column;gap:14px;padding:18px 12px;overflow-y:auto}
.pf-who{display:flex;align-items:center;gap:10px;padding:0 6px}
.pf-tabs{display:flex;flex-direction:column;gap:2px}
.pf-tab{all:unset;cursor:pointer;box-sizing:border-box;padding:9px 12px;border-radius:8px;font:600 13.5px ${FONT_BODY};color:${C.slate};white-space:nowrap}
.pf-tab:hover{background:#fff}
.pf-tab.on{background:#fff;color:${C.cobalt};box-shadow:0 1px 3px rgba(18,20,28,.08)}
.pf-main{flex:1;min-width:0;display:flex;flex-direction:column}
.pf-head{display:flex;align-items:center;gap:8px;padding:16px 22px;border-bottom:1px solid ${C.border}}
.pf-body{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:20px 22px;display:flex;flex-direction:column;gap:18px}
.pf-foot{display:flex;align-items:center;gap:8px;padding:12px 22px;border-top:1px solid ${C.border}}
@media (max-width:700px){
  .pf-modal{flex-direction:column;height:calc(100dvh - 32px)}
  .pf-side{width:auto;flex-direction:column;gap:8px;padding:12px 12px 0;border-right:none;border-bottom:1px solid ${C.border};overflow:visible}
  .pf-tabs{flex-direction:row;overflow-x:auto;gap:2px}
  .pf-tab{border-radius:8px 8px 0 0}
  .pf-head,.pf-body,.pf-foot{padding-left:16px;padding-right:16px}
}
`;

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
  const [customGender, setCustomGender] = useState(() => isCustom(seed(operator).gender));
  const [sessions, setSessions] = useState(null);
  const [pw, setPw] = useState({ current: "", next: "", again: "", busy: false, msg: "", ok: false });
  const fileRef = useRef(null);
  const zones = useMemo(zoneList, []);

  useEffect(() => {
    if (!isOpen || !operator) return;
    const s = seed(operator);
    setForm(s);
    setBase(s);
    setCustomGender(isCustom(s.gender));
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

  const pickGender = (e) => {
    const v = e.target.value;
    setCustomGender(v === "custom");
    setForm((f) => ({ ...f, gender: v === "custom" ? "" : v }));
  };
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

  const field = (id, name, el) => <Field key={id} id={id} name={name}>{el}</Field>;
  const showSave = dirty && ["profile", "contact", "prefs", "notifications"].includes(tab);
  const discard = () => { setForm(base); setCustomGender(isCustom(base.gender)); if (notif && !notif.failed) api.getMyNotifications().then(setNotif).catch(() => {}); };

  return (
    <div role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(18,20,28,0.55)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 120, padding: 16 }}>
      <style>{MODAL_CSS}</style>
      <div role="dialog" aria-label="Your profile" className="pf-modal">
        <aside className="pf-side">
          <div className="pf-who">
            <Avatar user={operator} size={44} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: FONT_BODY, fontSize: 14, fontWeight: 700, color: C.textInk, overflowWrap: "anywhere" }}>{shownName}</div>
              <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.slate, overflowWrap: "anywhere" }}>{form.job_title || `@${operator.username}`}</div>
            </div>
          </div>
          <div role="tablist" className="pf-tabs">
            {TABS.map(([k, name]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} className={`pf-tab${tab === k ? " on" : ""}`} onClick={() => { setTab(k); setStatus({ kind: "", text: "" }); }}>{name}</button>
            ))}
          </div>
        </aside>

        <div className="pf-main">
          <div className="pf-head">
            <h1 style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18, color: C.textInk, margin: 0, flex: 1 }}>{TABS.find(([k]) => k === tab)[1]}</h1>
            <button type="button" aria-label="Close" onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: C.slate, display: "flex" }}><X size={20} /></button>
          </div>

          <div className="pf-body">
            {tab === "profile" && (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
                  <Avatar user={operator} size={72} />
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
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
                    <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.slate }}>JPG, PNG or WebP, up to 2 MB.</div>
                  </div>
                  <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={pickPhoto} hidden />
                </div>
                <div style={grid}>
                  {field("p-first", "First name", <input id="p-first" value={form.first_name} onChange={set("first_name")} style={input} autoComplete="given-name" maxLength={60} />)}
                  {field("p-last", "Last name", <input id="p-last" value={form.last_name} onChange={set("last_name")} style={input} autoComplete="family-name" maxLength={60} />)}
                  {field("p-gender", "Gender", (
                    <select id="p-gender" value={customGender ? "custom" : form.gender} onChange={pickGender} style={input}>
                      <option value="">Prefer not to say</option>
                      {GENDERS.map((g) => <option key={g} value={g}>{g}</option>)}
                      <option value="custom">Custom…</option>
                    </select>
                  ))}
                  {customGender ? field("p-gender-text", "Your gender", <input id="p-gender-text" value={form.gender} onChange={set("gender")} style={input} maxLength={40} placeholder="How you describe yourself" autoFocus />) : <span />}
                  {field("p-title", "Job title", <input id="p-title" value={form.job_title} onChange={set("job_title")} style={input} autoComplete="organization-title" maxLength={80} />)}
                  {field("p-dept", "Department", <input id="p-dept" value={form.department} onChange={set("department")} style={input} maxLength={80} />)}
                  {field("p-co", "Company", <input id="p-co" value={form.company} onChange={set("company")} style={input} placeholder={orgName || ""} autoComplete="organization" maxLength={120} />)}
                </div>
                {field("p-bio", "Short bio", <textarea id="p-bio" value={form.bio} onChange={set("bio")} style={{ ...input, minHeight: 64, resize: "vertical" }} maxLength={500} />)}
              </>
            )}

            {tab === "contact" && (
              <>
                <div style={grid}>
                  {field("p-email", "Email", <input id="p-email" type="email" value={form.email} onChange={set("email")} style={input} placeholder="you@company.com" autoComplete="email" />)}
                  {field("p-email2", "Second email (optional)", <input id="p-email2" type="email" value={form.secondary_email} onChange={set("secondary_email")} style={input} />)}
                  {field("p-phone", "Phone", <input id="p-phone" type="tel" value={form.phone} onChange={set("phone")} style={input} placeholder="+44 7700 900123" autoComplete="tel" />)}
                  {field("p-web", "Website or LinkedIn", <input id="p-web" value={form.website} onChange={set("website")} style={input} placeholder="linkedin.com/in/you" autoComplete="url" />)}
                </div>
                {operator.email && form.email.trim() !== operator.email ? <div style={note}>You will need to verify the new address.</div> : null}
              </>
            )}

            {tab === "prefs" && (
              <>
                <div style={grid}>
                  {field("p-tz", "Timezone", (
                    <select id="p-tz" value={form.timezone} onChange={set("timezone")} style={input}>
                      <option value="">Not set</option>
                      {form.timezone && !zones.some((z) => z.id === form.timezone) ? <option value={form.timezone}>{form.timezone}</option> : null}
                      {zones.map((z) => <option key={z.id} value={z.id}>{z.label}</option>)}
                    </select>
                  ))}
                  {field("p-lang", "Language", (
                    <select id="p-lang" value={form.language} onChange={set("language")} style={input}>
                      {LANGUAGES.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                    </select>
                  ))}
                  {field("p-date", "Date format", (
                    <select id="p-date" value={form.date_format} onChange={set("date_format")} style={input}>
                      <option value="dmy">Day / month / year</option>
                      <option value="mdy">Month / day / year</option>
                    </select>
                  ))}
                  {field("p-time", "Clock", (
                    <select id="p-time" value={form.time_format} onChange={set("time_format")} style={input}>
                      <option value="24h">24-hour</option>
                      <option value="12h">12-hour</option>
                    </select>
                  ))}
                </div>
                {field("p-sig", "Email signature", <textarea id="p-sig" value={form.signature} onChange={set("signature")} style={{ ...input, minHeight: 84, resize: "vertical" }} maxLength={600} placeholder={`${shownName}\n${form.job_title || "Job title"}`} />)}
              </>
            )}

            {tab === "notifications" && (
              <>
                <div style={note}>Choose which emails we send you.</div>
                {!notif && <div style={note}>Loading…</div>}
                {notif?.failed && <div style={note}>Could not load your email settings.</div>}
                {notif && !notif.failed && (
                  <>
                    {!form.email.trim() && <div style={note}>Add your email on the Contact tab to receive these.</div>}
                    {!notif.mailboxReady && <div style={note}>Platform email is not switched on yet; your choices are kept for when it is.</div>}
                    <div>
                      {notif.events.map((ev) => (
                        <label key={ev.key} style={{ display: "flex", alignItems: "center", gap: 10, fontFamily: FONT_BODY, fontSize: 13.5, color: C.textInk, padding: "7px 0", cursor: "pointer" }}>
                          <input type="checkbox" checked={ev.on} onChange={() => toggle(ev.key)} />
                          {ev.label}
                        </label>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}

            {tab === "security" && (
              <>
                <form onSubmit={changePassword} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 14, color: C.textInk }}>Change password</div>
                  <div style={grid}>
                    {field("pw-now", "Current password", <input id="pw-now" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} style={input} />)}
                    <span />
                    {field("pw-new", "New password", <input id="pw-new" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} style={input} />)}
                    {field("pw-again", "New password again", <input id="pw-again" type="password" autoComplete="new-password" value={pw.again} onChange={(e) => setPw({ ...pw, again: e.target.value })} style={input} />)}
                  </div>
                  {pw.msg ? <div role="status" style={{ fontSize: 12.5, fontFamily: FONT_BODY, color: pw.ok ? C.teal : "#b3261e" }}>{pw.msg}</div> : null}
                  <div><button type="submit" style={btnDark} disabled={pw.busy || !pw.current || !pw.next}>{pw.busy ? "Changing…" : "Change password"}</button></div>
                </form>
                <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 16 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
                    <div style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 14, color: C.textInk, flex: 1 }}>Where you are signed in</div>
                    {sessions && sessions.length > 1 ? <button type="button" style={btn} onClick={endOthers}>Sign out everywhere else</button> : null}
                  </div>
                  {!sessions ? <div style={note}>Loading…</div> : sessions.map((s, i) => (
                    <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 0", borderTop: i ? `1px solid ${C.borderLight}` : "none", flexWrap: "wrap" }}>
                      <Monitor size={18} color={C.slate} />
                      <div style={{ flex: 1, minWidth: 160 }}>
                        <div style={{ fontFamily: FONT_BODY, fontSize: 13.5, fontWeight: 600, color: C.textInk }}>
                          {deviceName(s.device)} {s.current ? <span style={{ fontSize: 11, color: C.teal, marginLeft: 6 }}>This device</span> : null}
                        </div>
                        <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.slate }}>{[s.ip, s.last_used_at ? `Last active ${when(s.last_used_at)}` : ""].filter(Boolean).join(" · ")}</div>
                      </div>
                      {!s.current ? <button type="button" style={btn} onClick={() => endSession(s.id)}>Sign out</button> : null}
                    </div>
                  ))}
                </div>
              </>
            )}

            {tab === "account" && (
              <div style={grid}>
                {[["a-user", "Username", `@${operator.username || ""}`], ["a-role", "Role", operator.role || ""], ["a-org", "Organisation", orgName || ""], ["a-since", "Member since", when(operator.member_since).split(",").slice(0, 2).join(",")], ["a-last", "Last sign-in", when(operator.last_login_at)]].map(([id, name, val]) => (
                  field(id, name, <input id={id} value={val} disabled style={{ ...input, background: C.paperSoft, color: C.slate }} />)
                ))}
              </div>
            )}
          </div>

          <div className="pf-foot">
            <div role="status" style={{ flex: 1, minWidth: 0, fontFamily: FONT_BODY, fontSize: 12.5, display: "flex", alignItems: "center", gap: 6, color: status.kind === "ok" ? C.teal : "#b3261e" }}>
              {status.text ? <>{status.kind === "ok" ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />} {status.text}</> : null}
            </div>
            {showSave ? (
              <>
                <button type="button" style={btn} onClick={discard}>Discard</button>
                <button type="button" style={btnDark} disabled={saving} onClick={save}>{saving ? "Saving…" : "Save changes"}</button>
              </>
            ) : <button type="button" style={btn} onClick={onClose}>Close</button>}
          </div>
        </div>
      </div>
    </div>
  );
}
