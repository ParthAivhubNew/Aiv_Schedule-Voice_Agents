import React, { useEffect, useState } from "react";
import { User, X, CheckCircle2, AlertTriangle, Mail } from "lucide-react";
import { C, FONT_DISPLAY, FONT_BODY, FONT_MONO } from "../tokens";
import { api } from "../api/apiClient";

const label = { display: "block", fontFamily: FONT_BODY, fontSize: 11.5, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 };
const input = { width: "100%", boxSizing: "border-box", padding: "9px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13 };

// Your own name, email and which emails OutReach sends you.
export function ProfileSettingsModal({ isOpen, onClose, operator, setOperator }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [notif, setNotif] = useState(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen || !operator) return;
    setName(operator.name || "");
    setEmail(operator.email || "");
    setSaved(false);
    setError("");
    setNotif(null);
    api.getMyNotifications().then(setNotif).catch(() => setNotif({ events: [], mailboxReady: false, failed: true }));
  }, [isOpen, operator]);

  if (!isOpen) return null;

  const toggle = (key) =>
    setNotif((n) => ({ ...n, events: n.events.map((e) => (e.key === key ? { ...e, on: !e.on } : e)) }));

  const handleSave = async (e) => {
    e.preventDefault();
    if (!name.trim()) return setError("Name cannot be empty.");
    setSaving(true);
    setError("");
    try {
      const me = await api.updateMe({ name: name.trim(), email: email.trim() });
      if (notif && !notif.failed) {
        await api.setMyNotifications(Object.fromEntries(notif.events.map((ev) => [ev.key, ev.on])));
      }
      setOperator((prev) => ({ ...prev, ...me }));
      setSaved(true);
      setTimeout(() => {
        setSaved(false);
        onClose();
      }, 800);
    } catch (err) {
      setError(err.message || "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(18,20,28,0.55)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 120, padding: 20 }}>
      <div style={{ background: "#fff", borderRadius: 18, width: "100%", maxWidth: 460, maxHeight: "90vh", overflowY: "auto", padding: 26, boxShadow: "0 24px 70px rgba(0,0,0,0.22)", border: `1px solid ${C.border}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: C.paperSoft, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <User size={18} color={C.slate} />
            </div>
            <div>
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18, color: C.textInk }}>Profile Settings</div>
              <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.slate }}>Your name, email and email notifications.</div>
            </div>
          </div>
          <button aria-label="Close" onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: C.slate }}><X size={18} /></button>
        </div>

        <form onSubmit={handleSave} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={label} htmlFor="profile-name">Display name</label>
            <input id="profile-name" value={name} onChange={(e) => setName(e.target.value)} style={input} />
          </div>
          <div>
            <label style={label}>Username</label>
            <input value={`@${operator?.username || ""}`} disabled style={{ ...input, fontFamily: FONT_MONO, fontSize: 12.5, background: C.paperSoft, color: C.slate }} />
          </div>
          <div>
            <label style={label}>Role</label>
            <input value={operator?.role || ""} disabled style={{ ...input, background: C.paperSoft, color: C.slate }} />
          </div>
          <div>
            <label style={label} htmlFor="profile-email">Email</label>
            <input id="profile-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" style={input} />
          </div>

          <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: FONT_BODY, fontWeight: 700, fontSize: 13, color: C.textInk, marginBottom: 8 }}>
              <Mail size={14} /> Email me when
            </div>
            {!notif && <div style={{ fontSize: 12, color: C.slate }}>Loading…</div>}
            {notif?.failed && <div style={{ fontSize: 12, color: C.slate }}>Could not load your email settings.</div>}
            {notif && !notif.failed && (
              <>
                {!email.trim() && (
                  <div style={{ fontSize: 12, color: C.slate, marginBottom: 6 }}>Add your email above to receive these.</div>
                )}
                {!notif.mailboxReady && (
                  <div style={{ fontSize: 12, color: C.slate, marginBottom: 6 }}>Platform email is not switched on yet; your choices are kept for when it is.</div>
                )}
                {notif.events.map((ev) => (
                  <label key={ev.key} style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: FONT_BODY, fontSize: 13, color: C.textInk, padding: "4px 0", cursor: "pointer" }}>
                    <input type="checkbox" checked={ev.on} onChange={() => toggle(ev.key)} />
                    {ev.label}
                  </label>
                ))}
              </>
            )}
          </div>

          {error && (
            <div style={{ padding: "8px 12px", background: "#fdecea", color: "#b3261e", borderRadius: 8, fontSize: 12, fontFamily: FONT_BODY, display: "flex", alignItems: "center", gap: 6 }}>
              <AlertTriangle size={14} /> {error}
            </div>
          )}
          {saved && (
            <div style={{ padding: "8px 12px", background: C.tealSoft, color: C.teal, borderRadius: 8, fontSize: 12, fontFamily: FONT_BODY, display: "flex", alignItems: "center", gap: 6 }}>
              <CheckCircle2 size={14} /> Profile saved
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>
            <button type="button" onClick={onClose} style={{ padding: "8px 16px", borderRadius: 8, border: `1px solid ${C.border}`, background: "#fff", fontSize: 13, cursor: "pointer" }}>Cancel</button>
            <button type="submit" disabled={saving} style={{ padding: "8px 20px", borderRadius: 8, border: "none", background: C.ink, color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", opacity: saving ? 0.6 : 1 }}>
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
