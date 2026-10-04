import React, { useEffect, useState } from "react";
import { Eye, EyeOff, AlertTriangle, RefreshCw, CheckCircle2, Mail, ArrowRight, ArrowLeft } from "lucide-react";
import { C, FONT_DISPLAY, FONT_BODY } from "../tokens";
import { api } from "../api/apiClient";
import { BrandLockup } from "./BrandMark";
import { AuthShowcase } from "./AuthShowcase";
import { googleErrorText, googleIdToken } from "./firebaseGoogle";

// Mode from the address: /signup, /reset-password?t=..., anything else signs in.
function initialMode() {
  const path = (window.location.pathname || "/").replace(/\/+$/, "");
  if (path === "/signup") return "signup";
  if (path === "/reset-password" && new URLSearchParams(window.location.search).get("t")) return "reset";
  return "signin";
}

// Reads ?verified= and ?t= once and removes them from the address bar.
function takeReturnParams() {
  const q = new URLSearchParams(window.location.search);
  const out = { verified: q.get("verified"), resetToken: q.get("t") };
  if (out.verified || out.resetToken) {
    window.history.replaceState(null, "", window.location.pathname);
  }
  return out;
}

const PATH_FOR = { signin: "/signin", signup: "/signup", forgot: "/signin", "check-email": "/signup", reset: "/reset-password" };

// `aside` sits at the right of the label (e.g. "Forgot password?"); `right` inside the field.
function Field({ id, label, aside, right, ...props }) {
  return (
    <div className="auth-field">
      <div className="auth-label">
        <label htmlFor={id}>{label}</label>
        {aside}
      </div>
      <div style={{ position: "relative" }}>
        <input id={id} className="auth-input" {...props} style={right ? { paddingRight: 42 } : undefined} />
        {right}
      </div>
    </div>
  );
}

function Notice({ tone, children }) {
  const ok = tone === "ok";
  return (
    <div role={ok ? "status" : "alert"} className="auth-pop" style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: ok ? C.teal : C.red, background: ok ? C.tealSoft : C.redSoft, border: `1px solid ${ok ? "#BFE6DF" : "#F0C4B8"}`, borderRadius: 10, padding: "9px 12px", display: "flex", alignItems: "flex-start", gap: 8, lineHeight: 1.4 }}>
      {ok ? <CheckCircle2 size={15} style={{ flexShrink: 0, marginTop: 1 }} /> : <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />}
      <div>{children}</div>
    </div>
  );
}

function GoogleButton({ label, onClick, disabled }) {
  return (
    <button type="button" className="auth-secondary" onClick={onClick} disabled={disabled}>
      <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
        <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
        <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
        <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
        <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
      </svg>
      {label}
    </button>
  );
}

const TITLES = {
  signin: ["Sign in", ""],  // the logo just above already says where you are
  signup: ["Create your account", "Set up your company in under a minute"],
  forgot: ["Forgot your password?", "We will email you a link to choose a new one"],
  reset: ["Choose a new password", "Use at least 8 characters"],
  "check-email": ["Check your inbox", "One click and you are in"],
};

export function LoginScreen({ onLogin }) {
  const [mode, setModeRaw] = useState(initialMode);
  const [config, setConfig] = useState(null); // null until the server says what is on
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [company, setCompany] = useState("");
  const [name, setName] = useState("");
  const [trap, setTrap] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [error, setError] = useState(null); // { text, action? }
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const setMode = (m, keep = false) => {
    setModeRaw(m);
    if (!keep) {
      setError(null);
      setInfo("");
    }
    try {
      window.history.replaceState(null, "", PATH_FOR[m] || "/signin");
    } catch (_) {}
  };

  useEffect(() => {
    api.getSignupConfig().then(setConfig).catch(() => setConfig({ allowSignup: false, google: false }));
    const back = takeReturnParams();
    if (back.resetToken) setResetToken(back.resetToken);
    if (back.verified === "1") setInfo("Email confirmed. Sign in to get started.");
    if (back.verified === "expired") setError({ text: "That confirmation link has expired or was already used." });
    // Runs once: the return parameters are read and cleared on the first render.
  }, []);

  // /signup without signup switched on falls back to sign in.
  useEffect(() => {
    if (mode === "signup" && config && !config.allowSignup) setMode("signin", true);
     
  }, [config, mode]);

  const finish = (operator) => {
    try {
      window.history.replaceState(null, "", "/");
    } catch (_) {}
    onLogin(operator);
  };

  // Google through Firebase: a Google popup, then our server checks the token and signs in.
  const signInWithGoogle = async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await api.firebaseSignIn(await googleIdToken(config.firebase));
      if (res?.operator) finish(res.operator);
    } catch (err) {
      setError({ text: googleErrorText(err) });
    }
    setLoading(false);
  };

  const run = async (fn) => {
    setLoading(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError({ text: err.message || "Something went wrong. Try again.", code: err.code });
    } finally {
      setLoading(false);
    }
  };

  const signIn = (e) => {
    e.preventDefault();
    if (!username.trim() || !password) return setError({ text: "Enter your email and password." });
    setInfo("");
    run(async () => {
      try {
        const res = await api.login(username.trim(), password);
        if (res?.operator) finish(res.operator);
      } catch (err) {
        if (err.code === "bad_credentials" && config?.allowSignup && username.includes("@")) {
          // Might simply be new here: offer sign-up with what they typed.
          setError({ text: err.message, action: { label: "New here? Create an account", to: "signup" } });
          return;
        }
        throw err;
      }
    });
  };

  const signUp = (e) => {
    e.preventDefault();
    if (!company.trim() || !name.trim() || !username.trim() || !password) return setError({ text: "Fill in every field." });
    if (password.length < 8) return setError({ text: "Use at least 8 characters for the password." });
    run(async () => {
      try {
        const res = await api.signup({ company: company.trim(), name: name.trim(), email: username.trim(), password, website: trap });
        if (res.verifyEmail) {
          setMode("check-email");
        } else {
          const r = await api.login(res.username, password);
          if (r?.operator) finish(r.operator);
        }
      } catch (err) {
        if (err.code === "account_exists") {
          // Already registered: go straight to sign in with the email filled in.
          setMode("signin", true);
          setPassword("");
          setInfo("You already have an account with this email. Sign in below.");
          return;
        }
        throw err;
      }
    });
  };

  const forgot = (e) => {
    e.preventDefault();
    if (!username.includes("@")) return setError({ text: "Enter the email address on your account." });
    run(async () => {
      const res = await api.forgotPassword(username.trim());
      if (res.mailboxReady === false) {
        setError({ text: "Email is not switched on yet. Ask your admin to reset your password from Users & roles." });
      } else {
        setInfo("If an account uses this email, a reset link is on its way. It works for 1 hour.");
      }
    });
  };

  const reset = (e) => {
    e.preventDefault();
    if (password.length < 8) return setError({ text: "Use at least 8 characters." });
    run(async () => {
      const res = await api.resetPassword(resetToken, password);
      setPassword("");
      setUsername(res.username || "");
      setMode("signin", true);
      setInfo("Password changed. Sign in with your new password.");
    });
  };

  const resend = () =>
    run(async () => {
      await api.resendVerification(username.trim());
      setInfo("If that account is waiting for confirmation, we sent the email again.");
    });

  const pwToggle = (
    <button type="button" className="auth-eye" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? "Hide password" : "Show password"}>
      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
    </button>
  );

  const [title, subtitle] = TITLES[mode];
  const onSubmit = { signin: signIn, signup: signUp, forgot, reset }[mode];
  const submitLabel = { signin: "Sign in", signup: "Create account", forgot: "Send reset link", reset: "Save new password" }[mode];
  const busyLabel = { signin: "Signing in…", signup: "Creating your workspace…", forgot: "Sending…", reset: "Saving…" }[mode];

  return (
    <div className="auth-root">
      <style>{AUTH_CSS}</style>
      <AuthShowcase />

      <main className="auth-panel">
        <div className="auth-card">
          <div className="auth-brand">
            <BrandLockup size={36} />
          </div>

          <h1 className="auth-title auth-pop" key={`t-${mode}`} style={subtitle ? undefined : { marginBottom: 20 }}>{title}</h1>
          {subtitle ? <p className="auth-sub auth-pop" key={`s-${mode}`}>{subtitle}</p> : null}

          {mode === "check-email" ? (
            <div className="auth-stack">
              <div className="auth-mail-art" aria-hidden="true"><Mail size={26} color={C.cobalt} /></div>
              <div style={{ fontFamily: FONT_BODY, fontSize: 14, color: C.textInk, lineHeight: 1.55, textAlign: "center" }}>
                We sent a confirmation link to <b>{username.trim()}</b>. Open it, then sign in.
              </div>
              {info && <Notice tone="ok">{info}</Notice>}
              {error && <Notice>{error.text}</Notice>}
              <button type="button" className="auth-secondary" onClick={resend} disabled={loading}>Send it again</button>
              <button type="button" className="auth-link" onClick={() => setMode("signin")}><ArrowLeft size={13} /> Back to sign in</button>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="auth-stack" noValidate>
              {config?.google && config.firebase && (mode === "signin" || mode === "signup") && (
                <>
                  <GoogleButton label={mode === "signup" ? "Sign up with Google" : "Continue with Google"} onClick={signInWithGoogle} disabled={loading} />
                  <div className="auth-or"><span>or with email</span></div>
                </>
              )}

              <div className={`auth-extra ${mode === "signup" ? "open" : ""}`} aria-hidden={mode !== "signup"}>
                <div className="auth-extra-inner">
                  <Field id="signup-company" label="Company name" value={company} tabIndex={mode === "signup" ? 0 : -1}
                    autoComplete="organization" onChange={(e) => { setCompany(e.target.value); setError(null); }} placeholder="Acme Ltd" />
                  <Field id="signup-name" label="Your name" value={name} tabIndex={mode === "signup" ? 0 : -1}
                    autoComplete="name" onChange={(e) => { setName(e.target.value); setError(null); }} placeholder="Alex Morgan" />
                  {/* Left empty by people; bots tend to fill it. */}
                  <input tabIndex={-1} aria-hidden="true" autoComplete="off" value={trap} onChange={(e) => setTrap(e.target.value)} name="website" className="auth-trap" />
                </div>
              </div>

              {mode !== "reset" && (
                <Field id="login-username" label={mode === "signin" ? "Email or username" : "Work email"}
                  type={mode === "signin" ? "text" : "email"} autoComplete={mode === "signup" ? "email" : "username"}
                  value={username} onChange={(e) => { setUsername(e.target.value); setError(null); }}
                  placeholder="you@company.com" autoFocus={mode !== "signup"} />
              )}

              {mode !== "forgot" && (
                <div>
                  <Field id="login-password" label={mode === "reset" ? "New password" : "Password"}
                    aside={mode === "signin" ? <button type="button" className="auth-link" onClick={() => setMode("forgot")}>Forgot password?</button> : null}
                    type={showPassword ? "text" : "password"} value={password} right={pwToggle}
                    autoComplete={mode === "signin" ? "current-password" : "new-password"}
                    onChange={(e) => { setPassword(e.target.value); setError(null); }}
                    placeholder={mode === "signin" ? "Your password" : "At least 8 characters"} autoFocus={mode === "reset"} />
                  {mode !== "signin" && password && <StrengthBar password={password} />}
                </div>
              )}

              {info && <Notice tone="ok">{info}</Notice>}
              {error && (
                <Notice>
                  {error.text}
                  {error.action && (
                    <div style={{ marginTop: 4 }}>
                      <button type="button" className="auth-link" onClick={() => setMode(error.action.to)}>{error.action.label} <ArrowRight size={12} /></button>
                    </div>
                  )}
                  {error.text.startsWith("Confirm your email") && (
                    <div style={{ marginTop: 4 }}>
                      <button type="button" className="auth-link" onClick={resend}>Send the confirmation email again</button>
                    </div>
                  )}
                </Notice>
              )}

              <button type="submit" className="auth-primary" disabled={loading}>
                {loading ? (<><RefreshCw size={15} className="auth-spin" /> {busyLabel}</>) : submitLabel}
              </button>

              {(mode === "forgot" || mode === "reset") && (
                <button type="button" className="auth-link" style={{ justifyContent: "center" }} onClick={() => setMode("signin")}><ArrowLeft size={13} /> Back to sign in</button>
              )}
              {mode === "signin" && (
                <p className="auth-foot">
                  {config && !config.allowSignup ? (
                    "Need an account? Ask your admin to add you."
                  ) : (
                    <>
                      Don&apos;t have an account?{" "}
                      <button type="button" className="auth-link" style={{ display: "inline", padding: 0, fontWeight: 600 }} onClick={() => setMode("signup")}>
                        Create one
                      </button>
                    </>
                  )}
                </p>
              )}
              {mode === "signup" && (
                <p className="auth-foot">
                  Already have an account?{" "}
                  <button type="button" className="auth-link" style={{ display: "inline", padding: 0, fontWeight: 600 }} onClick={() => setMode("signin")}>
                    Sign in
                  </button>
                  <br />
                  By creating an account you agree to our <a href="/terms" target="_blank" rel="noreferrer">Terms</a> and <a href="/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>.
                </p>
              )}
            </form>
          )}
          <nav className="auth-legal" aria-label="Legal">
            <a href="/terms" target="_blank" rel="noreferrer">Terms</a>
            <a href="/privacy" target="_blank" rel="noreferrer">Privacy</a>
            <a href="/data-deletion" target="_blank" rel="noreferrer">Data deletion</a>
          </nav>
        </div>
      </main>
    </div>
  );
}

function StrengthBar({ password }) {
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  const level = Math.min(4, Math.max(1, score - (password.length < 8 ? 1 : 0)));
  const colours = ["#C2410C", "#F59E0B", C.cobalt, C.teal];
  const words = ["Too short", "Fair", "Good", "Strong"];
  const idx = password.length < 8 ? 0 : level - 1;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }} aria-live="polite">
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4 }}>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} style={{ height: 4, borderRadius: 2, background: i <= idx ? colours[idx] : C.border, transition: "background .25s" }} />
        ))}
      </div>
      <span style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: colours[idx], fontWeight: 600, minWidth: 58, textAlign: "right" }}>{words[idx]}</span>
    </div>
  );
}

const AUTH_CSS = `
.auth-root { min-height: 100vh; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); background: #fff; font-family: ${FONT_BODY}; }
.auth-panel { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 40px 24px; background: #fff; }
.auth-card { width: 100%; max-width: 380px; animation: authIn .35s ease-out both; }
.auth-brand { display: flex; justify-content: center; margin-bottom: 32px; }
.auth-title { font-family: ${FONT_DISPLAY}; font-weight: 600; font-size: 24px; letter-spacing: -0.02em; color: ${C.ink}; margin: 0 0 6px; text-align: center; }
.auth-sub { font-size: 14px; color: ${C.slate}; margin: 0 0 24px; line-height: 1.5; text-align: center; }
.auth-stack { display: flex; flex-direction: column; gap: 16px; }
.auth-label { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
.auth-label label { font-size: 13px; font-weight: 500; color: ${C.textInk}; }
.auth-input { width: 100%; box-sizing: border-box; height: 40px; border-radius: 6px; border: 1px solid ${C.border}; background: #fff; padding: 0 12px; font-family: ${FONT_BODY}; font-size: 14px; color: ${C.textInk}; outline: none; transition: border-color .12s, box-shadow .12s; }
.auth-input::placeholder { color: ${C.slateLight}; }
.auth-input:hover { border-color: #CBD1D9; }
.auth-input:focus { border-color: ${C.cobalt}; box-shadow: 0 0 0 3px rgba(52,87,213,.22); }
.auth-eye { position: absolute; right: 4px; top: 4px; width: 32px; height: 32px; border: none; background: none; color: ${C.slateLight}; cursor: pointer; display: flex; align-items: center; justify-content: center; border-radius: 6px; }
.auth-eye:hover { color: ${C.ink}; background: #F0F2F5; }
.auth-primary { height: 40px; border-radius: 6px; border: none; color: #fff; background: ${C.cobalt}; font-family: ${FONT_BODY}; font-weight: 500; font-size: 14px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; box-shadow: 0 1px 2px rgba(38,64,158,.25); transition: background .12s; }
.auth-primary:hover:not(:disabled) { background: #2A49BD; }
.auth-primary:disabled { opacity: .75; cursor: wait; }
.auth-secondary { height: 40px; border-radius: 6px; border: 1px solid ${C.border}; background: #fff; display: flex; align-items: center; justify-content: center; gap: 10px; font-family: ${FONT_BODY}; font-weight: 500; font-size: 14px; color: ${C.textInk}; cursor: pointer; transition: background .12s, border-color .12s; }
.auth-secondary:hover:not(:disabled) { background: #F8F9FB; border-color: #CBD1D9; }
.auth-link { background: none; border: none; padding: 0; color: ${C.cobalt}; font-family: ${FONT_BODY}; font-size: 13px; font-weight: 500; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; }
.auth-link:hover { text-decoration: underline; text-underline-offset: 3px; }
.auth-primary:focus-visible, .auth-secondary:focus-visible, .auth-link:focus-visible, .auth-eye:focus-visible { outline: 2px solid ${C.cobalt}; outline-offset: 2px; }
.auth-or { display: flex; align-items: center; gap: 12px; color: ${C.slateLight}; font-size: 12px; }
.auth-or::before, .auth-or::after { content: ""; flex: 1; height: 1px; background: ${C.border}; }
.auth-foot { font-size: 13px; color: ${C.slate}; text-align: center; margin: 4px 0 0; line-height: 1.5; }
.auth-foot a { color: ${C.slate}; }
.auth-legal { display: flex; justify-content: center; gap: 16px; margin-top: 40px; font-size: 12px; }
.auth-legal a { color: ${C.slateLight}; text-decoration: none; }
.auth-legal a:hover { color: ${C.ink}; text-decoration: underline; }
.auth-extra { display: grid; grid-template-rows: 0fr; opacity: 0; transition: grid-template-rows .3s ease, opacity .2s; margin-bottom: -16px; }
.auth-extra.open { grid-template-rows: 1fr; opacity: 1; margin-bottom: 0; }
.auth-extra-inner { overflow: hidden; display: flex; flex-direction: column; gap: 16px; }
.auth-extra-inner > :last-of-type { margin-bottom: 0; }
.auth-trap { position: absolute; left: -9999px; width: 1px; height: 1px; opacity: 0; }
.auth-pop { animation: authPop .2s ease both; }
.auth-spin { animation: authSpin 1s linear infinite; }
.auth-mail-art { width: 56px; height: 56px; border-radius: 8px; margin: 0 auto; display: flex; align-items: center; justify-content: center; background: ${C.cobaltSoft || "#E8EDFB"}; }
@keyframes authIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@keyframes authPop { from { opacity: 0; } to { opacity: 1; } }
@keyframes authSpin { to { transform: rotate(360deg); } }
@media (max-width: 960px) { .auth-root { grid-template-columns: 1fr; } .auth-show { display: none !important; } .auth-panel { min-height: 100vh; } }
@media (prefers-reduced-motion: reduce) { .auth-root *, .auth-root *::before, .auth-root *::after { animation: none !important; transition: none !important; } }
`;
