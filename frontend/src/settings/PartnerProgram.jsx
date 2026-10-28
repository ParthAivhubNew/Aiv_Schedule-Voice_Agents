import React, { useCallback, useEffect, useState } from "react";
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
const GUIDES = [["start", "Get started"], ["embed", "Embedding reference"], ["api", "API reference"]];

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
      <div style={hint}>New here? Start with "Get started": seven steps with code to copy. The two references hold every option.</div>
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
  const [kitStack, setKitStack] = useState("vite");
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

  if (!info) return <div style={{ color: C.slate, fontSize: 13 }}>{msg.text || "Loading…"}</div>;
  const partner = info.partner;
  const lastApp = (info.applications || [])[0];
  const ready = partner && info.termsAccepted && settings && lines(settings.origins).length > 0 && lines(settings.returns).length > 0;
  const hasAddresses = !!partner && (partner.allowedOrigins || []).length > 0 && (partner.returnUrls || []).length > 0;
  const steps = partner ? [
    { id: "terms", title: "Accept the partner terms", done: !!info.termsAccepted },
    { id: "addresses", title: "Add your web addresses", done: hasAddresses },
    { id: "key", title: "Make your secret key", done: !!partner.secretKeyPrefix },
    { id: "kit", title: "Download your starter kit", done: kitDone },
    { id: "live", title: "Go live", done: partner.status === "live" },
  ] : [];
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
      a.download = `outreach-starter-kit-${kitStack}.zip`;
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
          <h3 style={h3}><Handshake size={15} style={{ verticalAlign: "-2px", marginRight: 6 }} />Offer Outreach inside your own software</h3>
          <div style={hint}>Show Outreach's screens (Leads, Campaigns, Mail, Voice and Social) inside your own software, in your colours: inline, as a popup, as a side panel or as a full page. Your users sign in to Outreach, or create an account, without leaving your product. Free while the programme is new.</div>
          {lastApp && lastApp.status === "pending" && <p style={{ fontSize: 13 }}>Your application for <b>{lastApp.company}</b> is waiting for review. <span style={pill("amber")}>pending</span></p>}
          {lastApp && lastApp.status === "rejected" && <p style={{ fontSize: 13 }}>Your last application was not approved.{lastApp.reviewNote ? ` ${lastApp.reviewNote}` : ""} You can apply again.</p>}
          {!(lastApp && lastApp.status === "pending") && (
            <form onSubmit={(e) => { e.preventDefault(); act(() => api.applyPartner(form), "Application sent. We will email you."); }}>
              <label style={label} htmlFor="pp-company">Company</label>
              <input id="pp-company" required minLength={2} style={field} value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
              <label style={label} htmlFor="pp-product">Your product</label>
              <input id="pp-product" style={field} value={form.product} onChange={(e) => setForm({ ...form, product: e.target.value })} />
              <label style={label} htmlFor="pp-use">What will your users do with Outreach?</label>
              <textarea id="pp-use" rows={3} style={field} value={form.use_case} onChange={(e) => setForm({ ...form, use_case: e.target.value })} />
              <label style={label} htmlFor="pp-users">Expected number of users</label>
              <input id="pp-users" style={field} placeholder="For example 500 in the first year" value={form.expected_users} onChange={(e) => setForm({ ...form, expected_users: e.target.value })} />
              <label style={label} htmlFor="pp-web">Website</label>
              <input id="pp-web" style={field} value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
              <label style={label} htmlFor="pp-cname">Contact person</label>
              <input id="pp-cname" style={field} value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} />
              <label style={label} htmlFor="pp-cmail">Contact email</label>
              <input id="pp-cmail" type="email" style={field} value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} />
              <div style={{ marginTop: 14 }}><button type="submit" disabled={busy} style={button(true, busy)}>Send application</button></div>
            </form>
          )}
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
              <Step n={1} title="Accept the partner terms" done={info.termsAccepted} open={isOpen("terms")} onToggle={() => toggle("terms")}
                summary={`Accepted, version ${partner.termsVersion}`}>
                <div style={hint}>Your users' accounts are normal Outreach accounts, and you only get the access they agreed to. Outreach may keep and reuse data from accounts created through your sign-up page. Your pages must show your users what you can access before they continue, and never keep their Outreach password.</div>
                <div style={{ marginTop: 10 }}><button type="button" disabled={busy} style={button(true, busy)} onClick={() => act(() => api.acceptPartnerTerms(), "Terms accepted.")}>Accept the partner terms</button></div>
              </Step>

              <Step n={2} title="Add your web addresses" done={hasAddresses} open={isOpen("addresses")} onToggle={() => toggle("addresses")}
                summary={`${(partner.allowedOrigins || []).length} web ${(partner.allowedOrigins || []).length === 1 ? "address" : "addresses"}, ${(partner.returnUrls || []).length} return ${(partner.returnUrls || []).length === 1 ? "page" : "pages"}`}>
                <form onSubmit={(e) => { e.preventDefault(); saveSettings(); }}>
                  <label style={{ ...label, marginTop: 0 }} htmlFor="pp-name">Name your users see</label>
                  <input id="pp-name" style={field} value={settings.name} onChange={(e) => setSettings({ ...settings, name: e.target.value })} />
                  <label style={label} htmlFor="pp-origins">Pages that will show Outreach</label>
                  <textarea id="pp-origins" rows={2} style={field} placeholder="https://app.yourproduct.com" value={settings.origins} onChange={(e) => setSettings({ ...settings, origins: e.target.value })} />
                  <div style={hint}>One full address per line. www.yourproduct.com and yourproduct.com count as two.</div>
                  <label style={label} htmlFor="pp-returns">Where people come back to</label>
                  <textarea id="pp-returns" rows={2} style={field} placeholder="https://app.yourproduct.com/outreach/connected" value={settings.returns} onChange={(e) => setSettings({ ...settings, returns: e.target.value })} />
                  <div style={hint}>One per line. After someone confirms their email or connects an account, we send them to one of these pages. It must be on a web address above.</div>
                  <div style={{ marginTop: 14 }}><button type="submit" disabled={busy} style={button(true, busy)}>Save</button></div>
                </form>
              </Step>

              <Step n={3} title="Make your secret key" done={!!partner.secretKeyPrefix} open={isOpen("key")} onToggle={() => toggle("key")}
                summary={`Secret key ${partner.secretKeyPrefix}••••`}>
                <SecretKeyBox partner={partner} busy={busy} act={act} bare />
              </Step>

              <Step n={4} title="Download your starter kit" done={kitDone} open={isOpen("kit")} onToggle={() => toggle("kit")}
                summary="Downloaded. Unzip it into your project and run the check.">
                <div style={hint}>The files your developer needs, with your keys and addresses already filled in. Unzip them into your project folder, keeping the folders, then follow START-HERE.txt. It ends with one command that checks everything and says what is still missing.</div>
                <label htmlFor="pp-kit" style={label}>What is your product built with?</label>
                <select id="pp-kit" value={kitStack} onChange={(e) => setKitStack(e.target.value)} style={field}>
                  <option value="vite">A Vite or React app (no server of its own)</option>
                  <option value="node">Your own Node / Express server</option>
                  <option value="next">Next.js</option>
                </select>
                <div style={{ marginTop: 12 }}><button type="button" disabled={busy} style={button(true, busy)} onClick={downloadKit}>Download starter kit</button></div>
                <div style={hint}>Your secret key is not in the kit. You paste it into a file called .env, as START-HERE.txt shows. Using something else? The Docs tab has the code for any language.</div>
              </Step>

              <Step n={5} title="Go live" done={partner.status === "live"} open={isOpen("live")} onToggle={() => toggle("live")}
                summary="You are live. New accounts get live keys.">
                {partner.status === "live" ? (
                  <div style={hint}>You are live. New accounts get live keys.</div>
                ) : partner.liveRequestedAt ? (
                  <div style={hint}>Asked on {when(partner.liveRequestedAt)}. The Outreach team will check your integration and switch it on.</div>
                ) : (
                  <>
                    <div style={hint}>Test first: in the sandbox nothing real is sent or charged. Then ask us to switch you on. This needs the terms accepted, a web address and a return page.</div>
                    <div style={{ marginTop: 10 }}><button type="button" disabled={busy || !ready || partner.status === "suspended"} style={button(true, busy || !ready || partner.status === "suspended")} onClick={() => act(() => api.requestPartnerLive(), "Request sent.")}>Ask to go live</button></div>
                    {!ready && <div style={hint}>Finish steps 1 and 2 first.</div>}
                  </>
                )}
              </Step>
              <div style={{ fontSize: 13, color: C.slate, margin: "4px 0 0" }}>Need the code? Open <button type="button" onClick={() => setTab("docs")} style={{ background: "none", border: 0, padding: 0, color: C.cobalt, cursor: "pointer", fontSize: 13, fontFamily: FONT_BODY }}>Docs</button> and start with "Get started".</div>
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
              <h3 style={h3}>Accounts connected to you</h3>
              {links.length === 0 && <div style={hint}>None yet. A user shows up here after they connect their Outreach account in your product.</div>}
              {links.map((l) => (
                <div key={l.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "9px 0", borderTop: `1px solid ${C.borderLight}`, marginTop: 6 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{l.company || l.orgId} <span style={pill(TONE[l.status])}>{l.status}</span></div>
                    <div style={hint}>{l.externalId ? `Your user ${l.externalId} · ` : ""}{l.creditsUsed30d ? `${l.creditsUsed30d} credits used in 30 days · ` : ""}Connected {when(l.connectedAt)}{l.createdAccount ? " · created through you" : " · existing account"}{l.revokedBy ? ` · disconnected by ${l.revokedBy}` : ""}</div>
                  </div>
                  {l.status === "active" && (
                    <button type="button" disabled={busy} style={button(false, busy)} onClick={() => window.confirm("Stop acting for this account?") && act(() => api.disconnectPartnerLink(l.id), "Disconnected.")}>Disconnect</button>
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
