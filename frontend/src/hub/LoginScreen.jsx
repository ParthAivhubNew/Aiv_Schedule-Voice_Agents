import React, { useEffect, useState } from "react";
import { Lock, Eye, EyeOff, AlertTriangle, RefreshCw, CheckCircle2 } from "lucide-react";
import { C, FONT_DISPLAY, FONT_BODY } from "../tokens";
import { api } from "../api/apiClient";
import { BrandMark } from "./BrandMark";

const HUB_PAPER = "#fcfbf8";

const GOOGLE_ERRORS = {
  cancelled: "Google sign-in was cancelled.",
  expired: "The Google sign-in took too long. Try again.",
  failed: "Google sign-in did not work. Try again.",
  no_account: "No OutReach account uses this Google email. Ask your admin to add you.",
  disabled: "This account is disabled. Ask your admin.",
};

// Reads ?google=, ?google_error= and ?verified= once and removes them from the address bar.
function takeReturnParams() {
  const q = new URLSearchParams(window.location.search);
  const out = { google: q.get("google"), googleError: q.get("google_error"), verified: q.get("verified") };
  if (out.google || out.googleError || out.verified) {
    window.history.replaceState(null, "", window.location.pathname);
  }
  return out;
}

const field = {
  width: "100%",
  height: 44,
  borderRadius: 10,
  border: `1px solid ${C.border}`,
  background: "#fff",
  padding: "0 14px",
  fontFamily: FONT_BODY,
  fontSize: 14,
  color: C.textInk,
};
const labelStyle = { display: "block", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 6 };
const primary = (busy) => ({
  width: "100%", height: 46, marginTop: 16, borderRadius: 12, border: "none", background: C.ink, color: "#fff",
  fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 15, cursor: busy ? "wait" : "pointer",
  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
});
const linkBtn = { background: "none", border: "none", padding: 0, color: C.cobalt, fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, cursor: "pointer" };

function GoogleButton() {
  return (
    <button
      type="button"
      onClick={() => window.location.assign("/api/auth/google/start")}
      style={{ width: "100%", height: 44, borderRadius: 12, border: `1px solid ${C.border}`, background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, fontFamily: FONT_BODY, fontWeight: 600, fontSize: 14, color: C.textInk, cursor: "pointer" }}
    >
      <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
        <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
        <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
        <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
        <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
      </svg>
      Continue with Google
    </button>
  );
}

function Notice({ tone, children }) {
  const ok = tone === "ok";
  return (
    <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: ok ? C.teal : C.red, background: ok ? C.tealSoft : C.redSoft, border: `1px solid ${ok ? "#BFE6DF" : "#F0C4B8"}`, borderRadius: 8, padding: "8px 12px", margin: "10px 0 4px", display: "flex", alignItems: "center", gap: 6 }}>
      {ok ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />} {children}
    </div>
  );
}

export function LoginScreen({ onLogin }) {
  const [mode, setMode] = useState("signin"); // signin | signup | check-email
  const [config, setConfig] = useState({ allowSignup: false, google: false });
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [company, setCompany] = useState("");
  const [name, setName] = useState("");
  const [trap, setTrap] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    api.getSignupConfig().then(setConfig).catch(() => {});
    const back = takeReturnParams();
    if (back.verified === "1") setInfo("Email confirmed. You can sign in now.");
    if (back.verified === "expired") setError("That confirmation link has expired or was already used.");
    if (back.googleError) setError(GOOGLE_ERRORS[back.googleError] || GOOGLE_ERRORS.failed);
    if (back.google) {
      setLoading(true);
      api.googleExchange(back.google)
        .then((res) => res?.operator && onLogin(res.operator))
        .catch((err) => setError(err.message || GOOGLE_ERRORS.failed))
        .finally(() => setLoading(false));
    }
    // Runs once: the return parameters are read and cleared on the first render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signIn = async (e) => {
    e.preventDefault();
    if (!username.trim() || !password) return setError("Enter your username or email and password.");
    setLoading(true);
    setError("");
    setInfo("");
    try {
      const res = await api.login(username.trim(), password);
      if (res && res.operator) onLogin(res.operator);
      else setError("Invalid response from the server.");
    } catch (err) {
      setError(err.message || "Wrong username or password.");
    } finally {
      setLoading(false);
    }
  };

  const signUp = async (e) => {
    e.preventDefault();
    if (!company.trim() || !name.trim() || !username.trim() || !password) return setError("Fill in every field.");
    if (password.length < 8) return setError("Use at least 8 characters for the password.");
    setLoading(true);
    setError("");
    try {
      const res = await api.signup({ company: company.trim(), name: name.trim(), email: username.trim(), password, website: trap });
      if (res.verifyEmail) {
        setMode("check-email");
      } else {
        const r = await api.login(res.username, password);
        if (r?.operator) onLogin(r.operator);
      }
    } catch (err) {
      setError(err.message || "Could not create the account.");
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    try {
      await api.resendVerification(username.trim());
      setInfo("If that account is waiting for confirmation, we sent the email again.");
    } catch (err) {
      setError(err.message || "Could not send the email.");
    }
  };

  const switchTo = (m) => {
    setMode(m);
    setError("");
    setInfo("");
  };

  const passwordField = (
    <div style={{ position: "relative", marginBottom: 8 }}>
      <Lock size={14} color={C.slateLight} style={{ position: "absolute", left: 14, top: 15 }} />
      <input
        id="login-password"
        type={showPassword ? "text" : "password"}
        value={password}
        autoComplete={mode === "signup" ? "new-password" : "current-password"}
        onChange={(e) => { setPassword(e.target.value); setError(""); }}
        placeholder="••••••••"
        style={{ ...field, paddingLeft: 36, paddingRight: 40 }}
      />
      <button
        type="button"
        onClick={() => setShowPassword(!showPassword)}
        style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", padding: 4, display: "flex", alignItems: "center", color: C.slateLight }}
        title={showPassword ? "Hide password" : "Show password"}
      >
        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );

  const card = { background: "#fff", border: `1px solid ${C.border}`, borderRadius: 20, padding: "28px 28px 24px", boxShadow: "0 18px 50px rgba(18,20,28,0.06)" };
  const subtitle = mode === "signup" ? "Create your company's account" : mode === "check-email" ? "Check your inbox" : "Sign in to open your plugins";

  return (
    <div style={{ minHeight: "100vh", background: HUB_PAPER, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: FONT_BODY }}>
      <div style={{ width: "100%", maxWidth: 420 }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 28 }}>
          <BrandMark size={44} />
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 28, color: C.ink, letterSpacing: "-0.03em", marginTop: 14 }}>OutReach by Aivhub</div>
          <div style={{ fontFamily: FONT_BODY, fontSize: 14, color: C.slate, marginTop: 6, textAlign: "center" }}>{subtitle}</div>
        </div>

        {mode === "check-email" ? (
          <div style={card}>
            <div style={{ fontFamily: FONT_BODY, fontSize: 14, color: C.textInk, lineHeight: 1.5 }}>
              We sent a confirmation link to <b>{username.trim()}</b>. Open it to finish, then sign in.
            </div>
            {info && <Notice tone="ok">{info}</Notice>}
            {error && <Notice>{error}</Notice>}
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 18 }}>
              <button type="button" style={linkBtn} onClick={resend}>Send it again</button>
              <button type="button" style={linkBtn} onClick={() => switchTo("signin")}>Back to sign in</button>
            </div>
          </div>
        ) : (
          <form onSubmit={mode === "signup" ? signUp : signIn} style={card}>
            {config.google && (
              <>
                <GoogleButton />
                <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "18px 0", color: C.slateLight, fontSize: 12 }}>
                  <div style={{ flex: 1, height: 1, background: C.border }} /> or <div style={{ flex: 1, height: 1, background: C.border }} />
                </div>
              </>
            )}
            {mode === "signup" && (
              <>
                <label style={labelStyle} htmlFor="signup-company">Company name</label>
                <input id="signup-company" autoFocus value={company} onChange={(e) => { setCompany(e.target.value); setError(""); }} style={{ ...field, marginBottom: 16 }} />
                <label style={labelStyle} htmlFor="signup-name">Your name</label>
                <input id="signup-name" value={name} autoComplete="name" onChange={(e) => { setName(e.target.value); setError(""); }} style={{ ...field, marginBottom: 16 }} />
                {/* Left empty by people; bots tend to fill it. */}
                <input tabIndex={-1} aria-hidden="true" autoComplete="off" value={trap} onChange={(e) => setTrap(e.target.value)} name="website" style={{ position: "absolute", left: -9999, width: 1, height: 1, opacity: 0 }} />
              </>
            )}
            <label style={labelStyle} htmlFor="login-username">{mode === "signup" ? "Work email" : "Username"}</label>
            <input
              id="login-username"
              autoFocus={mode === "signin"}
              type={mode === "signup" ? "email" : "text"}
              autoComplete={mode === "signup" ? "email" : "username"}
              value={username}
              onChange={(e) => { setUsername(e.target.value); setError(""); }}
              placeholder={mode === "signup" ? "you@company.com" : "Username or email"}
              style={{ ...field, marginBottom: 16 }}
            />
            <label style={labelStyle} htmlFor="login-password">Password</label>
            {passwordField}
            {info && <Notice tone="ok">{info}</Notice>}
            {error && <Notice>{error}</Notice>}
            {error.startsWith("Confirm your email") && (
              <button type="button" style={{ ...linkBtn, marginTop: 6 }} onClick={resend}>Send the confirmation email again</button>
            )}
            <button type="submit" disabled={loading} style={primary(loading)}>
              {loading ? (
                <>
                  <RefreshCw size={15} className="animate-spin" />
                  <span>{mode === "signup" ? "Creating account..." : "Signing in..."}</span>
                </>
              ) : (
                <span>{mode === "signup" ? "Create account" : "Sign in"}</span>
              )}
            </button>
            <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate, marginTop: 14, lineHeight: 1.45, textAlign: "center" }}>
              {mode === "signup" ? (
                <>Already have an account? <button type="button" style={linkBtn} onClick={() => switchTo("signin")}>Sign in</button></>
              ) : config.allowSignup ? (
                <>New to OutReach? <button type="button" style={linkBtn} onClick={() => switchTo("signup")}>Create an account</button></>
              ) : (
                <span style={{ fontSize: 11.5, color: C.slateLight }}>Forgot your password? Ask your admin to reset it.</span>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
