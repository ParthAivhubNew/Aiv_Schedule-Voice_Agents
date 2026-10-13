import React, { useEffect, useState } from "react";
import { api } from "../../api/apiClient";

const NOTE = { fontSize: 12, color: "#64748B" };

// Sign in once to Google, Microsoft or Zoom; connected apps become the video platforms offered
// in Calling -> Schedule, and meeting links are created in them automatically.
export function VideoMeetingApps() {
  const [providers, setProviders] = useState(null);
  const [msg, setMsg] = useState("");

  const load = () => api.getMeetingLinks().then((r) => setProviders((r && r.providers) || [])).catch(() => setProviders([]));

  useEffect(() => {
    load();
    const onMsg = (ev) => {
      const d = ev && ev.data;
      if (!d || d.type !== "aivhub-meeting-oauth") return;
      load();
      setMsg(d.ok ? `Connected${d.account ? ` · ${d.account}` : ""}.` : (d.error || "Could not connect."));
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  const connect = async (provider) => {
    try {
      const r = await api.startMeetingLink(provider);
      window.open(r.authUrl, "aivhub-meeting-connect", "width=520,height=700");
    } catch (e) {
      setMsg(e.message || "Could not start the sign-in.");
    }
  };
  const disconnect = async (provider) => {
    try {
      await api.disconnectMeetingLink(provider);
      setMsg("");
      await load();
    } catch (e) {
      setMsg(e.message || "Could not disconnect.");
    }
  };

  const btn = (primary) => ({
    height: 32, padding: "0 14px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer",
    border: primary ? "none" : "1px solid #CBD5E1", background: primary ? "#0F172A" : "#fff", color: primary ? "#fff" : "#334155",
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <div style={{ fontSize: 16, fontWeight: 700, color: "#0F172A" }}>Video meeting apps</div>
        <div style={NOTE}>
          Connect the apps you meet on. Only connected apps are offered when you schedule a video meeting, and the
          meeting link is created in your account automatically.
        </div>
      </div>
      {msg && <div style={{ ...NOTE, color: "#0F172A" }}>{msg}</div>}
      {providers === null && <div style={NOTE}>Loading…</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
        {(providers || []).map((p) => (
          <div key={p.provider} style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 12, padding: 16, display: "grid", gap: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <div style={{ fontWeight: 700, color: "#0F172A" }}>{p.label}</div>
              {p.connected && <span style={{ fontSize: 11, fontWeight: 700, color: "#059669" }}>● Connected</span>}
            </div>
            {p.connected && <div style={NOTE}>{p.account || "Signed in"}</div>}
            {!p.connected && p.error && <div style={{ ...NOTE, color: "#B91C1C" }}>{p.error}</div>}
            {p.connected ? (
              <button type="button" style={{ ...btn(false), justifySelf: "start" }} onClick={() => disconnect(p.provider)}>Disconnect</button>
            ) : p.configured ? (
              <button type="button" style={{ ...btn(true), justifySelf: "start" }} onClick={() => connect(p.provider)}>Connect {p.label}</button>
            ) : (
              <div style={NOTE}>Not available on this platform yet.</div>
            )}
          </div>
        ))}
      </div>
      <div style={NOTE}>
        Teams meetings need a work or school Microsoft account. Outreach Meet (our own room) is always available and needs no sign-in.
      </div>
    </div>
  );
}
