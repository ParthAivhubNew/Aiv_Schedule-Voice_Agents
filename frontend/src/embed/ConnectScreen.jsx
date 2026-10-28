import React, { useEffect, useState } from "react";
import { Loader } from "../app/Loader";
import { FONT_BODY } from "../tokens";

// What each screen lets the partner do, in words a person can check before they agree.
const ACCESS_TEXT = {
  leads: "find and save companies and contacts, and see your lists",
  campaigns: "create and run your email campaigns and see their results",
  mail: "read and send your campaign mail and replies",
  voice: "set up and run phone calls and see their results",
  social: "plan, publish and review your social posts",
};

async function call(path, token, body) {
  const res = await fetch(`/api/embed/connect/${path}`, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const d = data.detail;
    const err = new Error(typeof d === "string" ? d : (d && d.message) || "Something went wrong. Try again.");
    err.status = res.status;
    throw err;
  }
  return data;
}

// Links a person's Outreach account to the partner, inside our own page: the partner never sees the password.
export function ConnectScreen({ connectToken, onConnected }) {
  const [info, setInfo] = useState(null);
  const [mode, setMode] = useState("login");
  const [f, setF] = useState({ email: "", password: "", company: "", name: "", website: "" });
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  useEffect(() => {
    call("info", connectToken).then(setInfo).catch((e) => setError(e.message));
  }, [connectToken]);

  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const out = await call(mode, connectToken, { ...f, consent: agree, consent_version: info.consentVersion });
      if (out.verify_email) setSent(true);
      else onConnected(out);
    } catch (err) {
      setError(err.message);
      setF((x) => (x.website ? { ...x, website: "" } : x)); // an autofilled trap field would fail every retry
    } finally {
      setBusy(false);
    }
  };

  if (!info && !error) return <Loader compact label="Loading" />;
  const partner = info ? info.partner.name : "this app";
  const label = { display: "flex", flexDirection: "column", gap: 5, fontSize: 12.5, fontWeight: 600, color: "var(--ui-ink-2)" };
  const input = { width: "100%", height: 38, boxSizing: "border-box", fontSize: 14, fontWeight: 400 };
  return (
    <div style={{ minHeight: "100vh", boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, fontFamily: FONT_BODY, background: "var(--ui-bg)" }}>
      <form onSubmit={submit} style={{ width: "100%", maxWidth: 420, boxSizing: "border-box", background: "var(--ui-surface)", border: "1px solid var(--ui-line)", borderRadius: "var(--ui-r)", boxShadow: "0 8px 28px rgba(16,24,40,.08)", padding: 28, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {info && info.partner.logoUrl ? <img src={info.partner.logoUrl} alt="" style={{ height: 32, alignSelf: "flex-start", marginBottom: 4 }} /> : null}
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 650, letterSpacing: "-0.01em", color: "var(--ui-ink)" }}>Connect Outreach to {partner}</h1>
          <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: "var(--ui-muted)" }}>
            {sent ? "" : mode === "login" ? "Sign in with your Outreach account. We check it here, and the password never reaches " + partner + "." : "New to Outreach? Make an account here and it is linked to " + partner + " straight away."}
          </p>
          {info && info.test ? <div style={{ alignSelf: "flex-start", fontSize: 11.5, fontWeight: 600, color: "var(--ui-accent-ink)", background: "var(--ui-accent-soft)", borderRadius: 999, padding: "2px 9px" }}>Test mode: nothing real is sent or charged</div> : null}
        </div>
        {sent ? (
          <p style={{ margin: 0, color: "var(--ui-ink-2)", fontSize: 14, lineHeight: 1.5 }}>We sent you an email. Open the link in it, then come back and connect again.</p>
        ) : (
          <>
            <div role="tablist" style={{ display: "flex", gap: 4, padding: 3, background: "var(--ui-bg)", border: "1px solid var(--ui-line)", borderRadius: 10 }}>
              {[["login", "I have an account"], ["signup", "Create an account"]].map(([id, text]) => (
                <button key={id} type="button" role="tab" aria-selected={mode === id} onClick={() => { setMode(id); setError(""); }}
                  style={{ flex: 1, border: "none", cursor: "pointer", borderRadius: 7, padding: "7px 10px", fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, background: mode === id ? "var(--ui-surface)" : "transparent", color: mode === id ? "var(--ui-ink)" : "var(--ui-muted)", boxShadow: mode === id ? "0 1px 3px rgba(0,0,0,.12)" : "none" }}>{text}</button>
              ))}
            </div>
            {mode === "signup" && (
              <>
                <label style={label}>Company<input className="ui-input" style={input} value={f.company} onChange={set("company")} autoComplete="organization" required /></label>
                <label style={label}>Your name<input className="ui-input" style={input} value={f.name} onChange={set("name")} autoComplete="name" required /></label>
                <input tabIndex={-1} aria-hidden="true" autoComplete="off" name="hp_field" readOnly onFocus={(e) => e.target.removeAttribute("readonly")} value={f.website} onChange={set("website")} style={{ position: "absolute", left: -9999, opacity: 0 }} />
              </>
            )}
            <label style={label}>{mode === "login" ? "Email or username" : "Email"}<input className="ui-input" style={input} value={f.email} onChange={set("email")} autoComplete="username" required /></label>
            <label style={label}>Password<input className="ui-input" style={input} type="password" value={f.password} onChange={set("password")} autoComplete={mode === "login" ? "current-password" : "new-password"} required /></label>
            <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13, lineHeight: 1.5, color: "var(--ui-ink-2)", background: "var(--ui-bg)", border: "1px solid var(--ui-line)", borderRadius: 8, padding: "10px 12px", cursor: "pointer" }}>
              <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} style={{ marginTop: 3, flexShrink: 0 }} />
              <span>{partner} may {info ? ACCESS_TEXT[info.component] : ""} in my Outreach account. I can disconnect at any time. My password stays with Outreach.</span>
            </label>
          </>
        )}
        {error ? <div role="alert" style={{ color: "var(--ui-bad)", fontSize: 13 }}>{error}</div> : null}
        {!sent && <button className="ui-btn ui-btn--primary" type="submit" disabled={busy || !agree || !info} style={{ height: 40, fontSize: 14 }}>{busy ? "Connecting…" : mode === "login" ? "Connect" : "Create account and connect"}</button>}
      </form>
    </div>
  );
}
