import React, { useEffect, useState } from "react";
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
    } finally {
      setBusy(false);
    }
  };

  if (!info && !error) return <div role="status" style={{ padding: 32, color: "var(--ui-muted)" }}>Loading…</div>;
  const partner = info ? info.partner.name : "this app";
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, fontFamily: FONT_BODY, background: "var(--ui-bg)" }}>
      <form onSubmit={submit} style={{ width: "100%", maxWidth: 400, background: "var(--ui-surface)", border: "1px solid var(--ui-line)", borderRadius: "var(--ui-r)", padding: 24, display: "flex", flexDirection: "column", gap: 12 }}>
        {info && info.partner.logoUrl ? <img src={info.partner.logoUrl} alt="" style={{ height: 32, alignSelf: "flex-start" }} /> : null}
        <h1 style={{ margin: 0, fontSize: 18, color: "var(--ui-ink)" }}>Connect Outreach to {partner}</h1>
        {info && info.test ? <div style={{ fontSize: 12, color: "var(--ui-muted)" }}>Test mode: nothing real is sent or charged.</div> : null}
        {sent ? (
          <p style={{ margin: 0, color: "var(--ui-ink-2)", fontSize: 14 }}>We sent you an email. Open the link in it, then come back and connect again.</p>
        ) : (
          <>
            <div role="tablist" style={{ display: "flex", gap: 8 }}>
              {[["login", "I have an Outreach account"], ["signup", "Create an account"]].map(([id, label]) => (
                <button key={id} type="button" role="tab" aria-selected={mode === id} onClick={() => { setMode(id); setError(""); }}
                  className={mode === id ? "ui-btn ui-btn--primary ui-btn--sm" : "ui-btn ui-btn--secondary ui-btn--sm"}>{label}</button>
              ))}
            </div>
            {mode === "signup" && (
              <>
                <label className="ui-field">Company<input className="ui-input" value={f.company} onChange={set("company")} autoComplete="organization" required /></label>
                <label className="ui-field">Your name<input className="ui-input" value={f.name} onChange={set("name")} autoComplete="name" required /></label>
                <input tabIndex={-1} aria-hidden="true" autoComplete="off" value={f.website} onChange={set("website")} style={{ position: "absolute", left: -9999, opacity: 0 }} />
              </>
            )}
            <label className="ui-field">{mode === "login" ? "Email or username" : "Email"}<input className="ui-input" value={f.email} onChange={set("email")} autoComplete="username" required /></label>
            <label className="ui-field">Password<input className="ui-input" type="password" value={f.password} onChange={set("password")} autoComplete={mode === "login" ? "current-password" : "new-password"} required /></label>
            <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, color: "var(--ui-ink-2)" }}>
              <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} style={{ marginTop: 3 }} />
              <span>{partner} may {info ? ACCESS_TEXT[info.component] : ""} in my Outreach account. I can disconnect at any time. My password stays with Outreach.</span>
            </label>
          </>
        )}
        {error ? <div role="alert" style={{ color: "var(--ui-bad)", fontSize: 13 }}>{error}</div> : null}
        {!sent && <button className="ui-btn ui-btn--primary" type="submit" disabled={busy || !agree || !info}>{busy ? "Connecting…" : mode === "login" ? "Connect" : "Create account and connect"}</button>}
      </form>
    </div>
  );
}
