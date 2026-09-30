import React, { useState } from "react";
import { Lock, AlertTriangle, RefreshCw } from "lucide-react";
import { C, FONT_DISPLAY, FONT_BODY } from "../tokens";
import { api } from "../api/apiClient";

// Shown after sign-in when the password is temporary (new user, reset by an admin, or the
// old default). Nothing else opens until a new password is chosen.
export function ChangePasswordScreen({ operator, onDone, onLogout }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (next.length < 8) return setError("Use at least 8 characters.");
    if (next !== repeat) return setError("The two new passwords do not match.");
    setSaving(true);
    setError("");
    try {
      const me = await api.changePassword(current, next);
      onDone(me);
    } catch (err) {
      setError(err.message || "Could not change the password.");
    } finally {
      setSaving(false);
    }
  };

  const field = {
    width: "100%", height: 44, borderRadius: 10, border: `1px solid ${C.border}`, background: "#fff",
    padding: "0 14px", fontFamily: FONT_BODY, fontSize: 14, color: C.textInk, marginBottom: 14, boxSizing: "border-box",
  };
  const label = { display: "block", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 6 };

  return (
    <div style={{ minHeight: "100vh", background: "#F8F7F4", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: FONT_BODY }}>
      <form onSubmit={submit} style={{ width: "100%", maxWidth: 420 }}>
        <div style={{ textAlign: "center", marginBottom: 22 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: C.ink, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
            <Lock size={20} color="#fff" />
          </div>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 24, color: C.ink, marginTop: 12 }}>Choose a new password</div>
          <div style={{ fontSize: 14, color: C.slate, marginTop: 6 }}>
            {operator && operator.name ? `${operator.name}, your` : "Your"} password is temporary. Pick your own to continue.
          </div>
        </div>
        <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 20, padding: "26px 26px 22px", boxShadow: "0 18px 50px rgba(18,20,28,0.06)" }}>
          <label style={label}>Current password</label>
          <input type="password" autoFocus value={current} onChange={(e) => { setCurrent(e.target.value); setError(""); }} style={field} autoComplete="current-password" />
          <label style={label}>New password (at least 8 characters)</label>
          <input type="password" value={next} onChange={(e) => { setNext(e.target.value); setError(""); }} style={field} autoComplete="new-password" />
          <label style={label}>New password again</label>
          <input type="password" value={repeat} onChange={(e) => { setRepeat(e.target.value); setError(""); }} style={field} autoComplete="new-password" />
          {error && (
            <div style={{ fontSize: 12.5, color: C.red, background: C.redSoft, border: "1px solid #F0C4B8", borderRadius: 8, padding: "8px 12px", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
              <AlertTriangle size={14} /> {error}
            </div>
          )}
          <button type="submit" disabled={saving} style={{ width: "100%", height: 46, marginTop: 6, borderRadius: 12, border: "none", background: C.ink, color: "#fff", fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 15, cursor: saving ? "wait" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            {saving ? <><RefreshCw size={15} className="animate-spin" /> Saving…</> : "Save and continue"}
          </button>
          <button type="button" onClick={onLogout} style={{ width: "100%", marginTop: 10, background: "none", border: "none", color: C.slate, fontSize: 13, cursor: "pointer" }}>
            Sign out
          </button>
        </div>
      </form>
    </div>
  );
}
