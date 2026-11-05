import React, { useCallback, useEffect, useState } from "react";
import { Dotted } from "../app/Loader";
import { Check, Copy, Handshake } from "lucide-react";
import { C, FONT_BODY, FONT_MONO } from "../tokens";
import { api } from "../api/apiClient";
import { EmbedSnippets, SecretKeyBox, ThemeBox } from "./PartnerEmbed";

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
const lines = (v) => (v || "").split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean); // one per line, but commas and spaces work too
const when = (iso) => (iso ? new Date(iso + (/[Z+]/.test(iso.slice(19)) ? "" : "Z")).toLocaleDateString([], { dateStyle: "medium" }) : "—");

function CopyText({ text }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch (_) {}
  };
  return (
    <button type="button" onClick={copy} aria-label="Copy" style={{ ...button(false), padding: "5px 8px", display: "inline-flex", alignItems: "center", gap: 4 }}>
      {done ? <Check size={13} /> : <Copy size={13} />} {done ? "Copied" : "Copy"}
    </button>
  );
}

function Code({ children }) {
  return <pre style={{ margin: "8px 0", padding: 12, borderRadius: 10, background: C.ink, color: "#E5E7EB", fontFamily: FONT_MONO, fontSize: 12, overflowX: "auto", lineHeight: 1.55 }}>{children}</pre>;
}

// One setup step: a number (a tick once done), its title, and a body that opens when it is the next thing to do.
function Step({ n, title, done, open, onToggle, summary, children }) {
  return (
    <div style={{ ...box, padding: 0, marginBottom: 10 }}>
      <button type="button" aria-expanded={open} onClick={onToggle}
        style={{ display: "flex", width: "100%", alignItems: "center", gap: 12, padding: "12px 16px", background: "none", border: 0, cursor: "pointer", textAlign: "left", fontFamily: FONT_BODY }}>
        <span aria-hidden="true" style={{ width: 24, height: 24, borderRadius: 99, display: "grid", placeItems: "center", fontSize: 12, fontWeight: 700, background: done ? C.green : C.paperSoft, color: done ? "#fff" : C.slate }}>
          {done ? <Check size={14} /> : n}
        </span>
        <span style={{ flex: 1 }}>
          <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: C.textInk }}>{title}</span>
          {!open && done && summary && <span style={{ display: "block", fontSize: 12, color: C.slate }}>{summary}</span>}
        </span>
        <span style={{ fontSize: 12, color: C.slate }}>{open ? "Hide" : done ? "Edit" : "Open"}</span>
      </button>
      {open && <div style={{ padding: "0 16px 16px" }}>{children}</div>}
    </div>
  );
}

// The two partner guides, read in place. Each page is also public, so a developer without an account can be sent the link.
const GUIDES = [["start", "Get started"], ["snippets", "Copy-paste code"], ["embed", "Embedding reference"], ["api", "API reference"]];

function PartnerDocs({ alwaysOpen = false }) {
  const [shown, setShown] = useState(false);
  const open = alwaysOpen || shown;
  const [guide, setGuide] = useState("start");
  const url = `/api/docs/partners/${guide}`;
  return (
    <div style={box}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <h3 style={h3}>Documentation</h3>
        {!alwaysOpen && <button type="button" style={button(false)} aria-expanded={open} onClick={() => setShown(!shown)}>{open ? "Hide" : "Read the docs"}</button>}
      </div>
      <div style={hint}>New here? Start with "Get started". "Copy-paste code" has the page snippets (panel, popup, side panel, full page) and the server file for your language. The two references hold every option.</div>
      {open && (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", margin: "10px 0" }}>
            {GUIDES.map(([id, name]) => <button key={id} type="button" style={button(guide === id)} onClick={() => setGuide(id)}>{name}</button>)}
            <a href={url} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, marginLeft: "auto" }}>Open on its own page</a>
          </div>
          <iframe key={guide} aria-label={`Partner documentation: ${guide}`} src={url} style={{ width: "100%", height: "70vh", minHeight: 420, border: `1px solid ${C.border}`, borderRadius: 10, background: "#fff" }} />
        </>
      )}
    </div>
  );
}

// Which partners are connected to this account (any account admin), then the partner programme itself.
export function PartnerProgram() {
  const [info, setInfo] = useState(null);
  const [conns, setConns] = useState([]);
  const [links, setLinks] = useState([]);
  const [msg, setMsg] = useState({ text: "", error: false });
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ company: "", product: "", use_case: "", expected_users: "", contact_name: "", contact_email: "", website: "" });
  const [settings, setSettings] = useState(null);
  const [showSecret, setShowSecret] = useState(false);
  const [tab, setTab] = useState("setup");
  const [openStep, setOpenStep] = useState(null); // null: the first unfinished step is open; "none": all closed
  const [kitStack, setKitStack] = useState("snippet");
  const [start, setStart] = useState({ name: "", agree: false });
  const [wallet, setWallet] = useState(null);
  const [giving, setGiving] = useState(null); // { id, wallet, amount } while a gift form is open
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

  if (!info) return <div style={{ color: C.slate, fontSize: 13 }}>{msg.text || <Dotted text="Loading" />}</div>;
  const partner = info.partner;
  const lastApp = (info.applications || [])[0];
  const ready = partner && info.termsAccepted && settings && lines(settings.origins).length > 0;
  const hasAddresses = !!partner && (partner.allowedOrigins || []).length > 0;
  const steps = partner ? [
    { id: "kit", title: "Get your zip and paste the snippet", done: kitDone },
    { id: "addresses", title: "Add the address of your site", done: hasAddresses },
    { id: "live", title: "Go live", done: partner.status === "live" },
  ] : [];
  const snippet = partner ? `<script src="${window.location.origin}/embed.js" data-key="${partner.clientId}" data-accent="#2f5be0"></script>\n<div data-outreach="leadgen"></div>` : "";
  const nextStep = steps.find((s) => !s.done);
  const doneCount = steps.filter((s) => s.done).length;
  const activeLinks = links.filter((l) => l.status === "active").length;
  const isOpen = (id) => (openStep === null ? nextStep?.id === id : openStep === id);
  const toggle = (id) => setOpenStep(isOpen(id) ? "none" : id);
  // The kit is a zip made for this partner: its key and addresses are filled in. The secret key is never in it.
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
      try { localStorage.setItem("aivhub_partner_kit", "1"); } catch { /* the tick just is not remembered */ }
    } catch (err) {
      setMsg({ text: err.message, error: true });
    }
    setBusy(false);
  };
  const saveSettings = () => act(() => api.savePartnerSettings({
    name: settings.name, allowed_origins: lines(settings.origins), return_urls: lines(settings.returns),
    logo_url: settings.logo, accent_color: settings.color, webhook_url: settings.webhook,
  }), "Saved.");
  const TABS = [["setup", "Set up"], ["docs", "Docs"], ["look", "Look"], ["accounts", "Accounts"], ["advanced", "Advanced"]];

  return (
    <div style={{ fontFamily: FONT_BODY }}>
      {msg.text && (
        <div role={msg.error ? "alert" : "status"} style={{ fontSize: 13, padding: "8px 12px", borderRadius: 9, marginBottom: 12, color: msg.error ? C.red : C.teal, background: msg.error ? C.redSoft : C.tealSoft }}>{msg.text}</div>
      )}

      {!partner && (
        <div style={box}>
          <h3 style={h3}><Handshake size={15} style={{ verticalAlign: "-2px", marginRight: 6 }} />Add Outreach to your own software</h3>
          <div style={hint}>Show Outreach's screens (Leads, Campaigns, Mail, Voice and Social) inside your product, in your colours, with one snippet of code. Your users sign in to Outreach in a small window, so you never handle a password. Start in test mode now: only your own computer and the addresses you add can use it until you go live.</div>
          <form onSubmit={(e) => { e.preventDefault(); act(() => api.startPartner({ name: start.name, accept_terms: start.agree }), "You are in test mode. Download your zip below."); }}>
            <label style={label} htmlFor="pp-company">Your company name</label>
            <input id="pp-company" required minLength={2} style={field} value={start.name} onChange={(e) => setStart({ ...start, name: e.target.value })} />
            <label style={{ display: "flex", gap: 8, alignItems: "flex-start", margin: "12px 0 0", fontSize: 12.5, color: C.textInk, lineHeight: 1.5 }}>
              <input type="checkbox" checked={start.agree} onChange={(e) => setStart({ ...start, agree: e.target.checked })} style={{ marginTop: 3 }} />
              <span>I agree to the partner terms. Your users' accounts are normal Outreach accounts, and you only get the access they agree to. You never keep their Outreach password.</span>
            </label>
            <div style={{ marginTop: 14 }}><button type="submit" disabled={busy || !start.agree} style={button(true, busy || !start.agree)}>Start in test mode</button></div>
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
              : <div style={{ fontSize: 13, color: C.slate, marginTop: 4 }}>{nextStep ? `${doneCount} of ${steps.length} steps done. Next: ${nextStep.title.toLowerCase()}.` : "Everything is set up. You are live."}</div>}
          </div>
          <div role="tablist" style={{ display: "flex", gap: 4, flexWrap: "wrap", border: `1px solid ${C.border}`, borderTop: 0, background: "#fff", padding: "0 12px", marginBottom: 16, borderBottomLeftRadius: 12, borderBottomRightRadius: 12 }}>
            {TABS.map(([id, name]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
                style={{ padding: "10px 12px", fontSize: 13, fontWeight: 600, fontFamily: FONT_BODY, cursor: "pointer", background: "none", border: 0, borderBottom: `2px solid ${tab === id ? C.cobalt : "transparent"}`, color: tab === id ? C.cobalt : C.slate }}>
                {name}{id === "accounts" && activeLinks ? ` (${activeLinks})` : ""}
              </button>
            ))}
          </div>

          {tab === "setup" && (
            <>
              {!info.termsAccepted && (
                <div style={box}>
                  <h3 style={h3}>Accept the partner terms</h3>
                  <div style={hint}>Your users' accounts are normal Outreach accounts, and you only get the access they agreed to. Your pages never keep their Outreach password.</div>
                  <div style={{ marginTop: 10 }}><button type="button" disabled={busy} style={button(true, busy)} onClick={() => act(() => api.acceptPartnerTerms(), "Terms accepted.")}>Accept the partner terms</button></div>
                </div>
              )}

              <Step n={1} title="Get your zip and paste the snippet" done={kitDone} open={isOpen("kit")} onToggle={() => toggle("kit")}
                summary="Downloaded. Paste the two lines of snippet.html into your page.">
                <div style={hint}>Your zip has your snippet with your key already in it, a test page, and the Outreach browser extension for your team. There is nothing to add to your server and no secret key to find. Paste these two lines where Outreach should show:</div>
                <Code>{snippet}</Code>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <button type="button" disabled={busy} style={button(true, busy)} onClick={downloadKit}>Download your zip</button>
                  <CopyText text={snippet} />
                </div>
                <div style={hint}>Change the look on the same line: <code>data-accent</code>, <code>data-bg</code>, <code>data-text</code>, <code>data-radius</code>, <code>data-font</code>, <code>data-logo</code>, <code>data-name</code>. Screens: <code>leadgen</code> (the whole Leads app), <code>voice</code>, <code>social</code>; smaller Leads slices: <code>leads</code>, <code>campaigns</code>, <code>mail</code>. For your account admins: <code>account</code> (users, phone numbers, plans and API keys), which the Outreach team switches on for you; the admin signs in with their password each time. The first time, a person clicks "Connect Outreach" and signs in. To use your own data from code, call <code>Outreach.import(records, {'{'} list {'}'})</code>, <code>Outreach.run(plugin, action, data)</code> or <code>Outreach.find(company)</code>; they are simulated in test mode. Choose where the sign-in shows with <code>data-login</code>: <code>popup</code> (a small window, the default), <code>inline</code> (inside your page) or <code>page</code> (the whole window, then back).</div>
              </Step>

              <Step n={2} title="Add the address of your site" done={hasAddresses} open={isOpen("addresses")} onToggle={() => toggle("addresses")}
                summary={`${(partner.allowedOrigins || []).length} web ${(partner.allowedOrigins || []).length === 1 ? "address" : "addresses"}`}>
                <form onSubmit={(e) => { e.preventDefault(); saveSettings(); }}>
                  <label style={{ ...label, marginTop: 0 }} htmlFor="pp-origins">Pages that will show Outreach</label>
                  <textarea id="pp-origins" rows={2} style={field} placeholder="https://app.yourproduct.com" value={settings.origins} onChange={(e) => setSettings({ ...settings, origins: e.target.value })} />
                  <div style={hint}>One full address per line. While you test, pages on your own computer (localhost) work without adding anything. Only these addresses can use your key once you are live.</div>
                  <div style={{ marginTop: 14 }}><button type="submit" disabled={busy} style={button(true, busy)}>Save</button></div>
                </form>
              </Step>

              <Step n={3} title="Go live" done={partner.status === "live"} open={isOpen("live")} onToggle={() => toggle("live")}
                summary="You are live.">
                {partner.status === "live" ? (
                  <div style={hint}>You are live.</div>
                ) : partner.liveRequestedAt ? (
                  <div style={hint}>Asked on {when(partner.liveRequestedAt)}. The Outreach team will check your integration and switch it on.</div>
                ) : (
                  <>
                    <div style={hint}>Test first on your own computer or a test address. People who connect during the test use their own Outreach accounts, so anything they do is real. When it works on your site, ask us to switch you on. This needs the terms accepted and one web address.</div>
                    <div style={{ marginTop: 10 }}><button type="button" disabled={busy || !ready || partner.status === "suspended"} style={button(true, busy || !ready || partner.status === "suspended")} onClick={() => act(() => api.requestPartnerLive(), "Request sent.")}>Ask to go live</button></div>
                    {!ready && <div style={hint}>Add the address of your site first.</div>}
                  </>
                )}
              </Step>
              <div style={{ fontSize: 13, color: C.slate, margin: "4px 0 0" }}>Need more detail? Open <button type="button" onClick={() => setTab("docs")} style={{ background: "none", border: 0, padding: 0, color: C.cobalt, cursor: "pointer", fontSize: 13, fontFamily: FONT_BODY }}>Docs</button>. Already sign your users in on your own server? See "Connect with your own server" under Advanced.</div>
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
              <h3 style={h3}>Credits you can share</h3>
              <div style={hint}>Your people spend their own Outreach credits. You can fund them from your own wallets: top yours up on the normal Outreach billing page, then give credits to a connected account below, or give every new account a welcome gift.</div>
              {wallet && (
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap", margin: "8px 0" }}>
                  {wallet.wallets.map((w) => <span key={w.key} style={{ fontSize: 13 }}><b>{w.balance}</b> {w.label}</span>)}
                </div>
              )}
              <form style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}
                onSubmit={(e) => { e.preventDefault(); act(() => api.savePartnerSettings({ welcome_credits: Number(welcome.credits) || 0, welcome_wallet: welcome.wallet }), "Welcome gift saved."); }}>
                <label htmlFor="pp-wc" style={{ fontSize: 13 }}>Welcome gift for each new account:</label>
                <input id="pp-wc" type="number" min="0" max="1000" style={{ ...field, width: 90 }} value={welcome.credits} onChange={(e) => setWelcome({ ...welcome, credits: e.target.value })} />
                <select aria-label="Welcome gift wallet" style={{ ...field, width: 120 }} value={welcome.wallet} onChange={(e) => setWelcome({ ...welcome, wallet: e.target.value })}>
                  {(wallet ? wallet.wallets : []).map((w) => <option key={w.key} value={w.key}>{w.label}</option>)}
                </select>
                <button type="submit" disabled={busy} style={button(false, busy)}>Save</button>
              </form>
              <h3 style={h3}>Accounts connected to you</h3>
              {links.length === 0 && <div style={hint}>None yet. A user shows up here after they connect their Outreach account in your product.</div>}
              {links.map((l) => (
                <div key={l.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "9px 0", borderTop: `1px solid ${C.borderLight}`, marginTop: 6 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{l.company || l.orgId} <span style={pill(TONE[l.status])}>{l.status}</span></div>
                    <div style={hint}>{l.externalId ? `Your user ${l.externalId} · ` : ""}{l.creditsUsed30d ? `${l.creditsUsed30d} credits used in 30 days · ` : ""}Connected {when(l.connectedAt)}{l.createdAccount ? " · created through you" : " · existing account"}{l.revokedBy ? ` · disconnected by ${l.revokedBy}` : ""}</div>
                  </div>
                  {l.status === "active" && (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                      {giving && giving.id === l.id ? (
                        <form style={{ display: "flex", gap: 6, alignItems: "center" }} onSubmit={(e) => { e.preventDefault(); act(() => api.givePartnerCredits(l.id, { wallet: giving.wallet, amount: Number(giving.amount) }).then(() => setGiving(null)), "Credits given."); }}>
                          <select aria-label="Wallet" style={{ ...field, width: 100 }} value={giving.wallet} onChange={(e) => setGiving({ ...giving, wallet: e.target.value })}>
                            {(wallet ? wallet.wallets : []).map((w) => <option key={w.key} value={w.key}>{w.label}</option>)}
                          </select>
                          <input aria-label="Credits" type="number" min="1" style={{ ...field, width: 80 }} value={giving.amount} onChange={(e) => setGiving({ ...giving, amount: e.target.value })} />
                          <button type="submit" disabled={busy || !Number(giving.amount)} style={button(true, busy)}>Give</button>
                          <button type="button" style={button(false)} onClick={() => setGiving(null)}>Cancel</button>
                        </form>
                      ) : (
                        <button type="button" disabled={busy} style={button(false, busy)} onClick={() => setGiving({ id: l.id, wallet: "leadgen", amount: "" })}>Give credits</button>
                      )}
                      <button type="button" disabled={busy} style={button(false, busy)} onClick={() => window.confirm("Stop acting for this account?") && act(() => api.disconnectPartnerLink(l.id), "Disconnected.")}>Disconnect</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {tab === "advanced" && (
            <>
              <form style={box} onSubmit={(e) => { e.preventDefault(); saveSettings(); }}>
                <h3 style={h3}>Webhook, logo and accent colour</h3>
                <label style={label} htmlFor="pp-hook">Webhook address (optional)</label>
                <input id="pp-hook" style={field} placeholder="https://api.yourproduct.com/outreach/events" value={settings.webhook} onChange={(e) => setSettings({ ...settings, webhook: e.target.value })} />
                <div style={hint}>We send events about your users' accounts here (a call finished, a number is active, a social network needs reconnecting, a WhatsApp message arrived), signed with the secret below.</div>
                {partner.webhookSecret && (
                  <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <code style={{ fontFamily: FONT_MONO, fontSize: 12, overflowWrap: "anywhere" }}>{showSecret ? partner.webhookSecret : "whsec_••••••••••••••••"}</code>
                    <button type="button" style={button(false)} onClick={() => setShowSecret(!showSecret)}>{showSecret ? "Hide" : "Show"}</button>
                    <CopyText text={partner.webhookSecret} />
                    <button type="button" disabled={busy} style={button(false, busy)} onClick={() => window.confirm("Rotate the signing secret? Update your server straight after.") && act(() => api.rotatePartnerWebhookSecret(), "New secret created.")}>Rotate</button>
                  </div>
                )}
                <label style={label} htmlFor="pp-logo">Logo address (optional)</label>
                <input id="pp-logo" style={field} value={settings.logo} onChange={(e) => setSettings({ ...settings, logo: e.target.value })} />
                <label style={label} htmlFor="pp-color">Accent colour (optional)</label>
                <input id="pp-color" style={{ ...field, maxWidth: 160 }} placeholder="#3457D5" value={settings.color} onChange={(e) => setSettings({ ...settings, color: e.target.value })} />
                <div style={{ marginTop: 14 }}><button type="submit" disabled={busy} style={button(true, busy)}>Save</button></div>
              </form>

              <details style={box}>
                <summary style={{ ...h3, cursor: "pointer" }}>Connect with your own server (optional)</summary>
                <div style={hint}>Only if your server already knows who each user is and you want them connected without the sign-in window. It needs a secret key and one small file on your server.</div>
                <h3 style={{ ...h3, marginTop: 12 }}>Secret key</h3>
                <SecretKeyBox partner={partner} busy={busy} act={act} bare />
                <h3 style={{ ...h3, marginTop: 12 }}>Server file for your language</h3>
                <label htmlFor="pp-kit" style={label}>What is your product built with?</label>
                <select id="pp-kit" value={kitStack} onChange={(e) => setKitStack(e.target.value)} style={field}>
                  <option value="snippet">One snippet, nothing on your server</option>
                  <option value="vite">A Vite or React app (no server of its own)</option>
                  <option value="node">Your own Node / Express server</option>
                  <option value="next">Next.js</option>
                  <option value="python">Python (Flask)</option>
                  <option value="php">PHP</option>
                </select>
                <div style={{ marginTop: 12 }}><button type="button" disabled={busy} style={button(false, busy)} onClick={downloadKit}>Download this kit</button></div>
              </details>

              <details style={box}>
                <summary style={{ ...h3, cursor: "pointer" }}>Code samples for showing screens</summary>
                <EmbedSnippets partner={partner} bare />
              </details>

          <details style={box}>
            <summary style={{ ...h3, cursor: "pointer" }}>Direct API (for integrations built before embeds)</summary>
            <div style={hint}>Existing integrations keep working. New integrations should use the screens above.</div>
            <h3 style={{ ...h3, marginTop: 12 }}>Build and test in the sandbox</h3>
            <div style={hint}>Accounts created in the sandbox get <code>sk_test_</code> keys. Everything is simulated and nothing is bought or charged.</div>
            <Code>{`# Create an account (call it from your sign-up page)
curl -X POST ${window.location.origin}/api/v1/run \\
  -H "Content-Type: application/json" \\
  -d '{"plugin":"auth","action":"signup","data":{
    "client_id":"${partner.clientId}",
    "company":"Acme Ltd","name":"Sam Lee","email":"sam@acme.com","password":"••••••••",
    "consent":true,"consent_version":"${info.consentVersion}",
    "return_url":"https://app.yourproduct.com/outreach/connected"}}'

# Log in to an existing account: same call with "action":"login" and email + password
# The answer includes "api_key" (shown once). Keep it on your server, never in the browser.

# Then use any feature with that key
curl -X POST ${window.location.origin}/api/v1/run \\
  -H "Authorization: Bearer sk_test_..." -H "Content-Type: application/json" \\
  -d '{"plugin":"account","action":"wallet"}'`}</Code>
            <div style={hint}>
              <b>auth actions</b> (no key needed): <code>signup</code>, <code>login</code>, <code>resend_verification</code>, <code>forgot_password</code>. With the account's key: <code>me</code>, <code>disconnect</code>.
              Other plugins: <code>voice</code>, <code>leads</code>, <code>social</code>, <code>whatsapp</code>, <code>mail</code>, <code>account</code> and <code>numbers</code> (search, order and release phone numbers, verify your business, check lists of numbers). Your users connect their accounts from your pages with <code>social channel.connect</code>, <code>leads mailbox.connect</code> and <code>voice meeting_provider.connect</code>: each returns a link to open in a popup, so you never see a password or token. The full list of calls and webhook events is in the API reference under Documentation at the top of this page.
            </div>
            <div style={hint}>
              If email confirmation is on, <code>signup</code> answers <code>verify_email: true</code> with no key. After the user confirms (we send them to your return URL), call <code>login</code> to get the key.
              Errors have a stable <code>error.code</code>: <code>consent_required</code>, <code>origin_not_allowed</code>, <code>return_url_not_allowed</code>, <code>account_exists</code>, <code>bad_credentials</code>, <code>email_not_verified</code>, <code>admin_required</code>, <code>partner_suspended</code>.
            </div>
            <div style={hint}>
              Webhooks carry <code>X-Outreach-Signature: t=&lt;time&gt;,v1=&lt;hmac&gt;</code>: HMAC-SHA256 of <code>t=&lt;time&gt;.&lt;raw body&gt;</code> with your secret. The body names the user's account in <code>org_id</code>.
            </div>
          </details>
            </>
          )}
        </>
      )}

      {conns.length > 0 && (
        <div style={box}>
          <h3 style={h3}>Software connected to your account</h3>
          <div style={hint}>These companies can use your Outreach account through their own software. Disconnect one and its access stops at once.</div>
          {conns.map((c) => (
            <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "10px 0", borderTop: `1px solid ${C.borderLight}`, marginTop: 8 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{c.partner}</div>
                <div style={hint}>Connected {when(c.connectedAt)}{c.createdAccount ? " · account created there" : ""}</div>
              </div>
              <button type="button" disabled={busy} style={button(false, busy)} onClick={() => window.confirm(`Disconnect ${c.partner}?`) && act(() => api.disconnectPartnerConnection(c.id), `${c.partner} disconnected.`)}>Disconnect</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
