import React, { useCallback, useEffect, useState } from "react";
import { Dotted } from "../app/Loader";
import { Check, Copy, Handshake, ExternalLink } from "lucide-react";
import { C, FONT_BODY, FONT_MONO } from "../tokens";
import { api } from "../api/apiClient";
import { EmbedSnippets, SecretKeyBox, ThemeBox } from "./PartnerEmbed";
import { PeopleUsage } from "../team/PeopleUsage";

const field = { width: "100%", padding: "8px 11px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13, fontFamily: FONT_BODY, boxSizing: "border-box", background: "#fff" };
const label = { display: "block", fontSize: 12, fontWeight: 600, color: C.textInk, margin: "12px 0 4px" };
const hint = { fontSize: 12, color: C.slate, marginTop: 3 };
const box = { border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, background: "#fff", marginBottom: 16 };
const h3 = { fontSize: 14, fontWeight: 700, color: C.textInk, margin: "0 0 4px" };
const button = (primary, disabled) => ({
  padding: "8px 14px", borderRadius: 9, fontSize: 13, fontWeight: 600, fontFamily: FONT_BODY, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.55 : 1,
  border: primary ? "none" : `1px solid ${C.border}`, background: primary ? C.cobalt : "#fff", color: primary ? "#fff" : C.textInk,
});
const pill = (tone) => ({
  display: "inline-block", fontSize: 11.5, fontWeight: 600, padding: "2px 9px", borderRadius: 99,
  color: { green: C.green, amber: C.amber, red: C.red, blue: C.cobalt }[tone] || C.slate,
  background: { green: C.greenSoft, amber: C.amberSoft, red: C.redSoft, blue: C.cobaltSoft }[tone] || C.paperSoft,
});
const TONE = { pending: "amber", approved: "green", rejected: "red", sandbox: "blue", live: "green", suspended: "red", active: "green", revoked: "slate" };
const lines = (v) => (v || "").split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
const when = (iso) => (iso ? new Date(iso + (/[Z+]/.test(iso.slice(19)) ? "" : "Z")).toLocaleDateString([], { dateStyle: "medium" }) : "—");

// One client's credit use through this partner's screens: who used what. The server finds the client from the partner's own link.
function LinkUsage({ linkId }) {
  const load = useCallback((days, userId) => api.getPartnerLinkUsage(linkId, days, userId), [linkId]);
  return (
    <div style={{ marginTop: 10 }}>
      <PeopleUsage load={load} title="Credits used through your screens" showMe={false} />
    </div>
  );
}

function CopyText({ text, onCopy }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      if (onCopy) onCopy();
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch (_) {}
  };
  return (
    <button type="button" onClick={copy} aria-label="Copy" style={{ ...button(false), padding: "6px 10px", display: "inline-flex", alignItems: "center", gap: 5 }}>
      {done ? <Check size={13} /> : <Copy size={13} />} {done ? "Copied" : "Copy snippet"}
    </button>
  );
}

function Code({ children }) {
  return <pre style={{ margin: "8px 0", padding: 12, borderRadius: 10, background: C.ink, color: "#E5E7EB", fontFamily: FONT_MONO, fontSize: 12, overflowX: "auto", lineHeight: 1.55 }}>{children}</pre>;
}

// One setup step: numbered badge, title, status summary, and collapsible body.
function Step({ n, title, done, open, onToggle, summary, children }) {
  return (
    <div style={{ ...box, padding: 0, marginBottom: 12, overflow: "hidden" }}>
      <button type="button" aria-expanded={open} onClick={onToggle}
        style={{ display: "flex", width: "100%", alignItems: "center", gap: 12, padding: "14px 18px", background: open ? C.paperSoft : "#fff", border: 0, cursor: "pointer", textAlign: "left", fontFamily: FONT_BODY, transition: "background 0.15s ease" }}>
        <span aria-hidden="true" style={{ width: 26, height: 26, borderRadius: 99, display: "grid", placeItems: "center", fontSize: 12, fontWeight: 700, background: done ? C.green : C.paperSoft, color: done ? "#fff" : C.slate, border: done ? "none" : `1px solid ${C.border}` }}>
          {done ? <Check size={14} /> : n}
        </span>
        <span style={{ flex: 1 }}>
          <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: C.textInk }}>{title}</span>
          {!open && summary && <span style={{ display: "block", fontSize: 12, color: C.slate, marginTop: 2 }}>{summary}</span>}
        </span>
        <span style={{ fontSize: 12, fontWeight: 600, color: C.cobalt }}>{open ? "Collapse" : done ? "Edit" : "Configure"}</span>
      </button>
      {open && <div style={{ padding: "16px 18px", borderTop: `1px solid ${C.borderLight}` }}>{children}</div>}
    </div>
  );
}

// Partner documentation guides. The embedded view suppresses duplicate headers.
const GUIDES = [
  ["start", "Get Started"],
  ["snippets", "Code Snippets"],
  ["embed", "Embedding Reference"],
  ["api", "API Reference"],
];

function PartnerDocs({ alwaysOpen = false }) {
  const [shown, setShown] = useState(false);
  const open = alwaysOpen || shown;
  const [guide, setGuide] = useState("start");
  const url = `/api/docs/partners/${guide}?embedded=1`;
  const standaloneUrl = `/api/docs/partners/${guide}`;

  useEffect(() => {
    const onMsg = (e) => {
      if (e.data?.type === "partner_doc_nav" && e.data?.guide) {
        setGuide(e.data.guide);
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  return (
    <div style={box}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 6 }}>
        <div>
          <h3 style={h3}>Partner Documentation & Guides</h3>
          <div style={hint}>Explore step-by-step guides, embed code snippets, and API references to integrate Outreach into your product.</div>
        </div>
        {!alwaysOpen && (
          <button type="button" style={button(false)} aria-expanded={open} onClick={() => setShown(!shown)}>
            {open ? "Hide Documentation" : "View Documentation"}
          </button>
        )}
      </div>
      {open && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12, borderBottom: `1px solid ${C.borderLight}`, paddingBottom: 10 }}>
            {GUIDES.map(([id, name]) => (
              <button
                key={id}
                type="button"
                style={{
                  ...button(guide === id),
                  padding: "7px 14px",
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  transition: "all 0.15s ease",
                }}
                onClick={() => setGuide(id)}
              >
                {name}
              </button>
            ))}
            <a
              href={standaloneUrl}
              target="_blank"
              rel="noreferrer"
              style={{
                fontSize: 12.5,
                marginLeft: "auto",
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                color: C.cobalt,
                textDecoration: "none",
                fontWeight: 600,
              }}
            >
              Open in new tab <ExternalLink size={13} />
            </a>
          </div>
          <iframe
            key={guide}
            aria-label={`Partner documentation: ${guide}`}
            src={url}
            style={{
              width: "100%",
              height: "72vh",
              minHeight: 460,
              border: `1px solid ${C.border}`,
              borderRadius: 10,
              background: "#fff",
            }}
          />
        </div>
      )}
    </div>
  );
}

// Partner program management: setup, docs, look, accounts, and advanced configurations.
export function PartnerProgram() {
  const [info, setInfo] = useState(null);
  const [conns, setConns] = useState([]);
  const [links, setLinks] = useState([]);
  const [msg, setMsg] = useState({ text: "", error: false });
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState(null);
  const [showSecret, setShowSecret] = useState(false);
  const [tab, setTab] = useState("setup");
  const [openStep, setOpenStep] = useState(null);
  const [kitStack, setKitStack] = useState("snippet");
  const [start, setStart] = useState({ name: "", agree: false });
  const [wallet, setWallet] = useState(null);
  const [giving, setGiving] = useState(null);
  const [usageOpen, setUsageOpen] = useState("");
  const [welcome, setWelcome] = useState({ credits: "0", wallet: "leadgen" });
  const [kitDone, setKitDone] = useState(() => { try { return localStorage.getItem("aivhub_partner_kit") === "1"; } catch { return false; } });

  const load = useCallback(async () => {
    try {
      const [p, c] = await Promise.all([api.getPartner(), api.getPartnerConnections()]);
      setInfo(p);
      setConns(c.connections || []);
      if (p.partner) {
        setSettings({
          name: p.partner.name, origins: (p.partner.allowedOrigins || []).join("\n"), returns: (p.partner.returnUrls || []).join("\n"),
          logo: p.partner.logoUrl || "", color: p.partner.accentColor || "", webhook: p.partner.webhookUrl || "",
        });
        setLinks((await api.getPartnerLinks()).links || []);
        const w = await api.getPartnerWallet().catch(() => null);
        setWallet(w);
        if (w) setWelcome({ credits: String(w.welcomeCredits || 0), wallet: w.welcomeWallet || "leadgen" });
      }
    } catch (err) {
      setMsg({ text: err.message, error: true });
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const act = async (fn, ok) => {
    setBusy(true);
    setMsg({ text: "", error: false });
    try {
      await fn();
      setMsg({ text: ok || "", error: false });
      await load();
    } catch (err) {
      setMsg({ text: err.message, error: true });
    }
    setBusy(false);
  };

  if (!info) return <div style={{ color: C.slate, fontSize: 13 }}><Dotted text="Loading" /></div>;
  const partner = info.partner;
  const ready = partner && info.termsAccepted && settings && lines(settings.origins).length > 0;
  const hasAddresses = !!partner && (partner.allowedOrigins || []).length > 0;
  const steps = partner ? [
    { id: "kit", title: "Copy the embed snippet into your page", done: kitDone },
    { id: "addresses", title: "Authorize your site domains", done: hasAddresses },
    { id: "live", title: "Go live in production", done: partner.status === "live" },
  ] : [];
  const snippet = partner ? `<script src="${window.location.origin}/embed.js" data-key="${partner.clientId}"></script>\n<div data-outreach="workspace"></div>` : "";
  const nextStep = steps.find((s) => !s.done);
  const doneCount = steps.filter((s) => s.done).length;
  const activeLinks = links.filter((l) => l.status === "active").length;
  const isOpen = (id) => (openStep === null ? nextStep?.id === id : openStep === id);
  const toggle = (id) => setOpenStep(isOpen(id) ? "none" : id);

  const downloadKit = async () => {
    setBusy(true);
    setMsg({ text: "", error: false });
    try {
      const blob = await api.downloadPartnerKit(kitStack);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = kitStack === "snippet" ? "outreach-for-your-product.zip" : `outreach-starter-kit-${kitStack}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setKitDone(true);
      try { localStorage.setItem("aivhub_partner_kit", "1"); } catch {}
    } catch (err) {
      setMsg({ text: err.message, error: true });
    }
    setBusy(false);
  };

  const saveSettings = () => act(() => api.savePartnerSettings({
    name: settings.name, allowed_origins: lines(settings.origins), return_urls: lines(settings.returns),
    logo_url: settings.logo, accent_color: settings.color, webhook_url: settings.webhook,
  }), "Settings saved.");

  const TABS = [
    ["setup", "Set up"],
    ["docs", "Docs"],
    ["look", "Look"],
    ["accounts", "Accounts"],
    ["advanced", "Advanced"],
  ];

  return (
    <div style={{ fontFamily: FONT_BODY }}>
      {msg.text && (
        <div role={msg.error ? "alert" : "status"} style={{ fontSize: 13, padding: "8px 12px", borderRadius: 9, marginBottom: 12, color: msg.error ? C.red : C.teal, background: msg.error ? C.redSoft : C.tealSoft }}>{msg.text}</div>
      )}

      {!partner && (
        <div style={box}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <Handshake size={18} color={C.cobalt} />
            <h3 style={{ ...h3, fontSize: 16, margin: 0 }}>Join the Partner Program</h3>
          </div>
          <div style={hint}>
            Embed Outreach capabilities (Leads, Campaigns, Mail, Voice, and Social) directly into your product with custom branding.
            Your users authenticate seamlessly without your server handling their credentials. Start immediately in test mode.
          </div>
          <form onSubmit={(e) => { e.preventDefault(); act(() => api.startPartner({ name: start.name, accept_terms: start.agree }), "Partner sandbox initialized. Complete the setup steps below."); }} style={{ marginTop: 14 }}>
            <label style={label} htmlFor="pp-company">Company or Product Name</label>
            <input id="pp-company" required minLength={2} placeholder="e.g. Acme Corp" style={field} value={start.name} onChange={(e) => setStart({ ...start, name: e.target.value })} />
            <label style={{ display: "flex", gap: 8, alignItems: "flex-start", margin: "14px 0 0", fontSize: 12.5, color: C.textInk, lineHeight: 1.5, cursor: "pointer" }}>
              <input type="checkbox" checked={start.agree} onChange={(e) => setStart({ ...start, agree: e.target.checked })} style={{ marginTop: 3 }} />
              <span>I agree to the partner terms. User accounts are isolated Outreach accounts with user-granted permissions, and your servers never store credentials.</span>
            </label>
            <div style={{ marginTop: 16 }}>
              <button type="submit" disabled={busy || !start.agree || !start.name.trim()} style={button(true, busy || !start.agree || !start.name.trim())}>
                Start in test mode
              </button>
            </div>
          </form>
        </div>
      )}

      {!partner && <PartnerDocs />}

      {partner && settings && (
        <>
          <div style={{ ...box, marginBottom: 0, borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderBottom: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
              <h3 style={{ ...h3, fontSize: 16 }}><Handshake size={16} style={{ verticalAlign: "-2px", marginRight: 6 }} />{partner.name}</h3>
              <span style={pill(TONE[partner.status])}>{partner.status}</span>
            </div>
            {partner.status === "suspended"
              ? <p style={{ fontSize: 13, color: C.red, margin: "6px 0 0" }}>Your integration is paused. Contact the Outreach team.</p>
              : <div style={{ fontSize: 13, color: C.slate, marginTop: 4 }}>{nextStep ? `${doneCount} of ${steps.length} steps completed. Next: ${nextStep.title.toLowerCase()}.` : "Everything is set up. Your integration is live in production."}</div>}
          </div>
          <div role="tablist" style={{ display: "flex", gap: 4, flexWrap: "wrap", border: `1px solid ${C.border}`, borderTop: 0, background: "#fff", padding: "0 12px", marginBottom: 16, borderBottomLeftRadius: 12, borderBottomRightRadius: 12 }}>
            {TABS.map(([id, name]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
                style={{ padding: "10px 14px", fontSize: 13, fontWeight: 600, fontFamily: FONT_BODY, cursor: "pointer", background: "none", border: 0, borderBottom: `2px solid ${tab === id ? C.cobalt : "transparent"}`, color: tab === id ? C.cobalt : C.slate }}>
                {name}{id === "accounts" && activeLinks ? ` (${activeLinks})` : ""}
              </button>
            ))}
          </div>

          {tab === "setup" && (
            <>
              {!info.termsAccepted && (
                <div style={box}>
                  <h3 style={h3}>Accept the Partner Terms</h3>
                  <div style={hint}>End-user accounts are standard Outreach accounts with user-consented access. Passwords are never exposed to your servers.</div>
                  <div style={{ marginTop: 10 }}>
                    <button type="button" disabled={busy} style={button(true, busy)} onClick={() => act(() => api.acceptPartnerTerms(), "Terms accepted.")}>
                      Accept Partner Terms
                    </button>
                  </div>
                </div>
              )}

              <Step n={1} title="Copy the embed snippet into your page" done={kitDone} open={isOpen("kit")} onToggle={() => toggle("kit")}
                summary="Publishable key is configured. Add snippet to your HTML.">
                <div style={hint}>Your publishable key is pre-filled below. Insert these two lines into your web page where Outreach should display:</div>
                <Code>{snippet}</Code>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", margin: "10px 0 14px" }}>
                  <CopyText text={snippet} onCopy={() => { setKitDone(true); try { localStorage.setItem("aivhub_partner_kit", "1"); } catch {} }} />
                  <button type="button" disabled={busy} style={button(false, busy)} onClick={downloadKit}>Download Starter Kit (ZIP)</button>
                </div>
                <div style={{ background: C.paperSoft, borderRadius: 10, padding: "12px 14px", border: `1px solid ${C.borderLight}`, fontSize: 12.5, lineHeight: 1.6 }}>
                  <div style={{ fontWeight: 700, color: C.textInk, marginBottom: 6 }}>Quick Reference:</div>
                  <ul style={{ margin: 0, paddingLeft: 18, color: C.slate }}>
                    <li><strong style={{ color: C.textInk }}>Screens (<code>data-outreach</code>):</strong> <code>workspace</code> (all apps), <code>leadgen</code> (Leads &amp; CRM), <code>voice</code> (Voice AI), <code>social</code> (Social Media).</li>
                    <li><strong style={{ color: C.textInk }}>Branding:</strong> Customize on the tag (<code>data-accent</code>, <code>data-font</code>, <code>data-radius</code>, <code>data-logo</code>) or use the <strong>Look</strong> tab for visual defaults.</li>
                    <li><strong style={{ color: C.textInk }}>Authentication (<code>data-login</code>):</strong> <code>popup</code> (modal window, default), <code>inline</code> (within container), or <code>page</code> (full page redirect).</li>
                    <li><strong style={{ color: C.textInk }}>JavaScript SDK:</strong> Interact programmatically with <code>Outreach.import()</code>, <code>Outreach.run()</code>, or <code>Outreach.find()</code>.</li>
                  </ul>
                </div>
              </Step>

              <Step n={2} title="Authorize your site domains" done={hasAddresses} open={isOpen("addresses")} onToggle={() => toggle("addresses")}
                summary={hasAddresses ? `${(partner.allowedOrigins || []).length} authorized ${(partner.allowedOrigins || []).length === 1 ? "domain" : "domains"}` : "No domains added yet"}>
                <form onSubmit={(e) => { e.preventDefault(); saveSettings(); }}>
                  <label style={{ ...label, marginTop: 0 }} htmlFor="pp-origins">Allowed Origins (one URL per line)</label>
                  <textarea id="pp-origins" rows={2} style={field} placeholder="https://app.yourproduct.com" value={settings.origins} onChange={(e) => setSettings({ ...settings, origins: e.target.value })} />
                  <div style={hint}>Only these domains can load Outreach using your key in production. During local testing, <code>http://localhost</code> is permitted automatically.</div>
                  <div style={{ marginTop: 12 }}><button type="submit" disabled={busy} style={button(true, busy)}>Save Domains</button></div>
                </form>
              </Step>

              <Step n={3} title="Go live in production" done={partner.status === "live"} open={isOpen("live")} onToggle={() => toggle("live")}
                summary={partner.status === "live" ? "Integration is live in production." : "Pending activation"}>
                {partner.status === "live" ? (
                  <div style={{ color: C.green, fontWeight: 600, fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
                    <Check size={16} /> Your partner integration is live and active.
                  </div>
                ) : partner.liveRequestedAt ? (
                  <div style={hint}>Production review requested on <b>{when(partner.liveRequestedAt)}</b>. Our team is verifying your domain and integration. You will be activated shortly.</div>
                ) : (
                  <>
                    <div style={hint}>Test your embedding on localhost or your staging domain. Once verified, request production access to enable your integration for live end users.</div>
                    <div style={{ marginTop: 12 }}>
                      <button type="button" disabled={busy || !ready || partner.status === "suspended"} style={button(true, busy || !ready || partner.status === "suspended")} onClick={() => act(() => api.requestPartnerLive(), "Production request submitted successfully.")}>
                        Request Production Access
                      </button>
                    </div>
                    {!ready && <div style={{ ...hint, color: C.amber, marginTop: 6 }}>Please add at least one authorized domain above before requesting production access.</div>}
                  </>
                )}
              </Step>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", background: C.paperSoft, borderRadius: 10, marginTop: 12, fontSize: 13 }}>
                <span style={{ color: C.slate }}>Need more guides or server-to-server integration code?</span>
                <div style={{ display: "flex", gap: 14 }}>
                  <button type="button" onClick={() => setTab("docs")} style={{ background: "none", border: 0, padding: 0, color: C.cobalt, cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: FONT_BODY }}>
                    Open Docs →
                  </button>
                  <button type="button" onClick={() => setTab("advanced")} style={{ background: "none", border: 0, padding: 0, color: C.cobalt, cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: FONT_BODY }}>
                    Advanced Settings →
                  </button>
                </div>
              </div>
            </>
          )}

          {tab === "docs" && <PartnerDocs alwaysOpen />}

          {tab === "look" && (
            <div style={box}>
              <h3 style={h3}>Look and feel</h3>
              <ThemeBox partner={partner} busy={busy} act={act} bare />
            </div>
          )}

          {tab === "accounts" && (
            <div style={box}>
              <h3 style={h3}>Credit Allocation & Welcome Gift</h3>
              <div style={hint}>Users consume their own account credits. You can also fund connected accounts from your organization balance or provide automatic welcome credits to newly registered accounts.</div>
              {wallet && (
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", margin: "12px 0" }}>
                  {wallet.wallets.map((w) => (
                    <div key={w.key} style={{ padding: "6px 12px", borderRadius: 8, background: C.paperSoft, border: `1px solid ${C.borderLight}`, fontSize: 13 }}>
                      <span style={{ color: C.slate }}>{w.label}: </span>
                      <b>{w.balance}</b>
                    </div>
                  ))}
                </div>
              )}
              <form style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 20, paddingBottom: 16, borderBottom: `1px solid ${C.borderLight}` }}
                onSubmit={(e) => { e.preventDefault(); act(() => api.savePartnerSettings({ welcome_credits: Number(welcome.credits) || 0, welcome_wallet: welcome.wallet }), "Welcome credit settings saved."); }}>
                <label htmlFor="pp-wc" style={{ fontSize: 13, fontWeight: 600 }}>Welcome credit per new account:</label>
                <input id="pp-wc" type="number" min="0" max="1000" style={{ ...field, width: 85 }} value={welcome.credits} onChange={(e) => setWelcome({ ...welcome, credits: e.target.value })} />
                <select aria-label="Welcome gift wallet" style={{ ...field, width: 140 }} value={welcome.wallet} onChange={(e) => setWelcome({ ...welcome, wallet: e.target.value })}>
                  {(wallet ? wallet.wallets : []).map((w) => <option key={w.key} value={w.key}>{w.label}</option>)}
                </select>
                <button type="submit" disabled={busy} style={button(false, busy)}>Save</button>
              </form>

              <h3 style={h3}>Connected User Accounts</h3>
              {links.length === 0 ? (
                <div style={{ ...hint, padding: "16px 0", textAlign: "center" }}>No accounts connected yet. Connected users will appear here when they link their Outreach account.</div>
              ) : (
                links.map((l) => (
                  <div key={l.id} style={{ padding: "12px 0", borderTop: `1px solid ${C.borderLight}` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{l.company || l.orgId} <span style={pill(TONE[l.status])}>{l.status}</span></div>
                      <div style={hint}>
                        {l.externalId ? `User ID: ${l.externalId} · ` : ""}
                        {l.creditsUsed30d ? `${l.creditsUsed30d} credits used (30d) · ` : ""}
                        Connected {when(l.connectedAt)}
                        {l.createdAccount ? " · Created via embed" : " · Existing account"}
                        {l.revokedBy ? ` · Disconnected by ${l.revokedBy}` : ""}
                      </div>
                    </div>
                    {l.status === "active" && (
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                        <button type="button" style={button(false)} aria-expanded={usageOpen === l.id} onClick={() => setUsageOpen(usageOpen === l.id ? "" : l.id)}>{usageOpen === l.id ? "Hide usage" : "See usage"}</button>
                        {giving && giving.id === l.id ? (
                          <form style={{ display: "flex", gap: 6, alignItems: "center" }} onSubmit={(e) => { e.preventDefault(); act(() => api.givePartnerCredits(l.id, { wallet: giving.wallet, amount: Number(giving.amount) }).then(() => setGiving(null)), "Credits allocated."); }}>
                            <select aria-label="Wallet" style={{ ...field, width: 110 }} value={giving.wallet} onChange={(e) => setGiving({ ...giving, wallet: e.target.value })}>
                              {(wallet ? wallet.wallets : []).map((w) => <option key={w.key} value={w.key}>{w.label}</option>)}
                            </select>
                            <input aria-label="Credits" type="number" min="1" placeholder="Amount" style={{ ...field, width: 80 }} value={giving.amount} onChange={(e) => setGiving({ ...giving, amount: e.target.value })} />
                            <button type="submit" disabled={busy || !Number(giving.amount)} style={button(true, busy)}>Allocate</button>
                            <button type="button" style={button(false)} onClick={() => setGiving(null)}>Cancel</button>
                          </form>
                        ) : (
                          <button type="button" disabled={busy} style={button(false, busy)} onClick={() => setGiving({ id: l.id, wallet: "leadgen", amount: "" })}>Allocate credits</button>
                        )}
                        <button type="button" disabled={busy} style={button(false, busy)} onClick={() => window.confirm("Disconnect this account?") && act(() => api.disconnectPartnerLink(l.id), "Account disconnected.")}>Disconnect</button>
                      </div>
                    )}
                  </div>
                  {usageOpen === l.id && l.status === "active" && <LinkUsage linkId={l.id} />}
                  </div>
                ))
              )}
            </div>
          )}

          {tab === "advanced" && (
            <>
              <form style={box} onSubmit={(e) => { e.preventDefault(); saveSettings(); }}>
                <h3 style={h3}>Webhook Configuration</h3>
                <div style={hint}>Receive real-time event notifications for your users' accounts (completed calls, numbers active, reconnects, messages), cryptographically signed with HMAC-SHA256.</div>
                <label style={label} htmlFor="pp-hook">Webhook Endpoint URL</label>
                <input id="pp-hook" style={field} placeholder="https://api.yourproduct.com/outreach/events" value={settings.webhook} onChange={(e) => setSettings({ ...settings, webhook: e.target.value })} />
                {partner.webhookSecret && (
                  <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>Signing Secret:</span>
                    <code style={{ fontFamily: FONT_MONO, fontSize: 12, background: C.paperSoft, padding: "4px 8px", borderRadius: 6 }}>{showSecret ? partner.webhookSecret : "whsec_••••••••••••••••"}</code>
                    <button type="button" style={button(false)} onClick={() => setShowSecret(!showSecret)}>{showSecret ? "Hide" : "Show"}</button>
                    <CopyText text={partner.webhookSecret} />
                    <button type="button" disabled={busy} style={button(false, busy)} onClick={() => window.confirm("Rotate the webhook signing secret? Update your server immediately.") && act(() => api.rotatePartnerWebhookSecret(), "New webhook secret created.")}>Rotate</button>
                  </div>
                )}
                <div style={{ marginTop: 14 }}><button type="submit" disabled={busy} style={button(true, busy)}>Save Webhook</button></div>
              </form>

              <details style={box}>
                <summary style={{ ...h3, cursor: "pointer" }}>Server-Side Integration (Optional)</summary>
                <div style={hint}>If your backend identifies users directly and needs session tokens without a client login window, generate a secret key and integrate a backend server kit.</div>
                <h3 style={{ ...h3, marginTop: 14 }}>API Secret Key</h3>
                <SecretKeyBox partner={partner} busy={busy} act={act} bare />
                <h3 style={{ ...h3, marginTop: 16 }}>Server Template</h3>
                <label htmlFor="pp-kit" style={label}>Select your server stack:</label>
                <select id="pp-kit" value={kitStack} onChange={(e) => setKitStack(e.target.value)} style={field}>
                  <option value="snippet">Standard snippet (no server required)</option>
                  <option value="vite">React / Vite SPA</option>
                  <option value="node">Node.js / Express</option>
                  <option value="next">Next.js</option>
                  <option value="python">Python (Flask)</option>
                  <option value="php">PHP</option>
                </select>
                <div style={{ marginTop: 12 }}><button type="button" disabled={busy} style={button(false, busy)} onClick={downloadKit}>Download Stack Template</button></div>
              </details>

              <details style={box}>
                <summary style={{ ...h3, cursor: "pointer" }}>Code Samples & Layout Options</summary>
                <EmbedSnippets partner={partner} bare />
              </details>

              <details style={box}>
                <summary style={{ ...h3, cursor: "pointer" }}>Direct REST API (Legacy &amp; Server-to-Server)</summary>
                <div style={hint}>Call Outreach backend endpoints directly using your API keys.</div>
                <h3 style={{ ...h3, marginTop: 12 }}>Sandbox Execution</h3>
                <div style={hint}>Accounts created in the sandbox receive <code>sk_test_</code> keys. All supplier actions are simulated.</div>
                <Code>{`# Create an account (call from your backend registration flow)
curl -X POST ${window.location.origin}/api/v1/run \\
  -H "Content-Type: application/json" \\
  -d '{"plugin":"auth","action":"signup","data":{
    "client_id":"${partner.clientId}",
    "company":"Acme Ltd","name":"Sam Lee","email":"sam@acme.com","password":"••••••••",
    "consent":true,"consent_version":"${info.consentVersion}",
    "return_url":"https://app.yourproduct.com/outreach/connected"}}'

# Authenticate an existing account
curl -X POST ${window.location.origin}/api/v1/run \\
  -H "Content-Type: application/json" \\
  -d '{"plugin":"auth","action":"login","data":{"email":"sam@acme.com","password":"••••••••"}}'

# Execute plugin actions with account Bearer token
curl -X POST ${window.location.origin}/api/v1/run \\
  -H "Authorization: Bearer sk_test_..." -H "Content-Type: application/json" \\
  -d '{"plugin":"account","action":"wallet"}'`}</Code>
                <div style={hint}>
                  Supported plugins: <code>voice</code>, <code>leads</code>, <code>social</code>, <code>whatsapp</code>, <code>mail</code>, <code>account</code>, and <code>numbers</code>.
                  Webhooks are delivered with an <code>X-Outreach-Signature</code> HMAC header.
                </div>
              </details>
            </>
          )}
        </>
      )}

      {conns.length > 0 && (
        <div style={box}>
          <h3 style={h3}>Authorized Connected Applications</h3>
          <div style={hint}>These applications currently have authorized access to your Outreach account. Access can be revoked at any time.</div>
          {conns.map((c) => (
            <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "10px 0", borderTop: `1px solid ${C.borderLight}`, marginTop: 8 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{c.partner}</div>
                <div style={hint}>Connected {when(c.connectedAt)}{c.createdAccount ? " · Created via integration" : ""}</div>
              </div>
              <button type="button" disabled={busy} style={button(false, busy)} onClick={() => window.confirm(`Disconnect ${c.partner}?`) && act(() => api.disconnectPartnerConnection(c.id), `${c.partner} disconnected.`)}>Disconnect</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
