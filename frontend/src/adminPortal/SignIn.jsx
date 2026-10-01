import React, { useEffect, useState } from "react";
import QRCode from "qrcode";
import { KeyRound, ShieldCheck } from "lucide-react";
import { C, FONT_BODY, FONT_DISPLAY, FONT_MONO } from "../tokens";
import { adminApi, saveSession } from "./adminApi";
import { btn, input } from "./ui";

// Staff sign-in: email + password, then the 6-digit code from an authenticator app.
// The first sign-in shows a QR code to add OutReach staff to the app (the secret is shown once).
export function SignIn({ onSignedIn }) {
  const [form, setForm] = useState({ email: "", password: "", code: "" });
  const [step, setStep] = useState("password"); // password | code | setup
  const [setup, setSetup] = useState(null);
  const [qr, setQr] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!setup) return;
    QRCode.toDataURL(setup.otpauth, { margin: 1, width: 200 }).then(setQr, () => setQr(""));
  }, [setup]);

  const done = ({ token, staff }) => {
    saveSession(token, staff);
    onSignedIn(staff);
  };

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (step === "setup") {
        done(await adminApi.confirm2fa(setup.ticket, form.code.trim()));
      } else {
        const r = await adminApi.login(form.email.trim(), form.password, step === "code" ? form.code.trim() : null);
        if (r.setup) {
          setSetup(r);
          setStep("setup");
        } else if (r.codeRequired) {
          setStep("code");
        } else {
          done(r);
        }
      }
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  };

  const label = { display: "block", fontSize: 12, fontWeight: 600, color: C.slate, margin: "12px 0 5px" };
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: C.ink, padding: 16, fontFamily: FONT_BODY }}>
      <form onSubmit={submit} style={{ width: "100%", maxWidth: 400, background: "#fff", borderRadius: 18, padding: "28px 26px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <ShieldCheck size={22} color={C.cobalt} />
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 19, color: C.textInk }}>OutReach staff</div>
        </div>
        <div style={{ fontSize: 12.5, color: C.slate, marginBottom: 6 }}>Admin portal for the Aivhub team. Client accounts cannot sign in here.</div>

        {step === "password" && (
          <>
            <label style={label} htmlFor="staff-email">Email</label>
            <input id="staff-email" type="email" autoComplete="username" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} style={{ ...input, width: "100%" }} />
            <label style={label} htmlFor="staff-password">Password</label>
            <input id="staff-password" type="password" autoComplete="current-password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} style={{ ...input, width: "100%" }} />
          </>
        )}

        {step === "setup" && setup && (
          <div style={{ fontSize: 12.5, color: C.textInk, lineHeight: 1.5 }}>
            <p style={{ margin: "10px 0" }}>Two-factor sign-in is required. Scan this with Google Authenticator, Microsoft Authenticator or 1Password, then enter the 6-digit code.</p>
            {qr && <img src={qr} alt="QR code for your authenticator app" width={200} height={200} style={{ display: "block", margin: "0 auto 8px" }} />}
            <div style={{ fontSize: 11.5, color: C.slate }}>Or type this key: <span style={{ fontFamily: FONT_MONO, color: C.textInk, wordBreak: "break-all" }}>{setup.secret}</span></div>
          </div>
        )}

        {step !== "password" && (
          <>
            <label style={label} htmlFor="staff-code">6-digit code</label>
            <input id="staff-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" required autoFocus value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })} style={{ ...input, width: "100%", fontFamily: FONT_MONO, fontSize: 18, letterSpacing: 4 }} />
          </>
        )}

        {error && <div role="alert" style={{ color: C.red, fontSize: 12.5, marginTop: 10 }}>{error}</div>}
        <button type="submit" disabled={busy} style={{ ...btn(true, busy), width: "100%", justifyContent: "center", marginTop: 16, padding: "11px 14px" }}>
          <KeyRound size={14} /> {step === "password" ? "Continue" : step === "setup" ? "Turn on two-factor and sign in" : "Sign in"}
        </button>
        {step !== "password" && (
          <button type="button" onClick={() => { setStep("password"); setSetup(null); setForm({ ...form, code: "" }); setError(""); }}
            style={{ ...btn(false), width: "100%", justifyContent: "center", marginTop: 8, border: "none" }}>
            Back
          </button>
        )}
      </form>
    </div>
  );
}
