import React, { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { C, FONT_BODY, FONT_MONO } from "../tokens";
import { api } from "../api/apiClient";
import { COLOR_KEYS, FONTS, MAX_NAME, MAX_RADIUS, cleanAppearance, themeVars } from "../embed/theme";

const hint = { fontSize: 12, color: C.slate, marginTop: 3 };
const box = { border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, background: "#fff", marginBottom: 16 };
const h3 = { fontSize: 14, fontWeight: 700, color: C.textInk, margin: "0 0 4px" };
const button = (primary, disabled) => ({
  padding: "8px 14px", borderRadius: 9, fontSize: 13, fontWeight: 600, fontFamily: FONT_BODY, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.55 : 1,
  border: primary ? "none" : `1px solid ${C.border}`, background: primary ? C.cobalt : "#fff", color: primary ? "#fff" : C.textInk,
});

const COLOR_LABELS = { colorPrimary: "Buttons and highlights", colorBackground: "Page background", colorSurface: "Cards", colorText: "Text", colorDanger: "Errors", colorSidebar: "Side menu", colorSidebarText: "Side menu text" };
const FONT_LABELS = { system: "System", inter: "Inter", serif: "Serif", rounded: "Rounded", mono: "Monospace" };
const DEFAULTS = { colorPrimary: "#3457d5", colorBackground: "#f5f6f8", colorSurface: "#ffffff", colorText: "#111827", colorDanger: "#b4390a", colorSidebar: "#111520", colorSidebarText: "#ffffff" };

function CopyButton({ text }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" style={{ ...button(false), padding: "5px 8px", display: "inline-flex", alignItems: "center", gap: 4 }} aria-label="Copy"
      onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch (_) {} }}>
      {done ? <Check size={13} /> : <Copy size={13} />} {done ? "Copied" : "Copy"}
    </button>
  );
}

function Code({ children }) {
  return (
    <div style={{ position: "relative" }}>
      <pre style={{ margin: "8px 0", padding: 12, borderRadius: 10, background: C.ink, color: "#E5E7EB", fontFamily: FONT_MONO, fontSize: 12, overflowX: "auto", lineHeight: 1.55 }}>{children}</pre>
      <div style={{ position: "absolute", top: 14, right: 8 }}><CopyButton text={children} /></div>
    </div>
  );
}

// The secret key: the partner's server uses it to ask Outreach for embed tokens. It is shown once, when it is made.
export function SecretKeyBox({ partner, busy, act }) {
  const [fresh, setFresh] = useState("");
  const make = () => act(async () => {
    const out = await api.rotatePartnerSecret();
    setFresh(out.secretKey);
  }, "New secret key created. Copy it now: it is not shown again.");
  return (
    <div style={box}>
      <h3 style={h3}>Keys</h3>
      <div style={hint}>The publishable key goes in your web page. The secret key stays on your server: it asks Outreach for a short-lived token for each user. Never put it in a web page.</div>
      <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, fontWeight: 600 }}>Publishable</span>
        <code style={{ fontFamily: FONT_MONO, fontSize: 13 }}>{partner.clientId}</code>
        <CopyButton text={partner.clientId} />
      </div>
      <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, fontWeight: 600 }}>Secret</span>
        {fresh ? (
          <>
            <code style={{ fontFamily: FONT_MONO, fontSize: 12, overflowWrap: "anywhere" }}>{fresh}</code>
            <CopyButton text={fresh} />
          </>
        ) : (
          <code style={{ fontFamily: FONT_MONO, fontSize: 13 }}>{partner.secretKeyPrefix ? `${partner.secretKeyPrefix}••••••••` : "none yet"}</code>
        )}
        <button type="button" disabled={busy || partner.status === "suspended"} style={button(!partner.secretKeyPrefix, busy)}
          onClick={() => (!partner.secretKeyPrefix || window.confirm("Make a new secret key? The old one stops working at once. Update your server straight after.")) && make()}>
          {partner.secretKeyPrefix ? "Make a new key" : "Make a secret key"}
        </button>
      </div>
      <div style={hint}>{partner.status === "live" ? "Live" : "Test"} keys match your integration's status. When you go live, make a new key.</div>
    </div>
  );
}

// A small stand-in for an embedded screen, drawn with the same variables the real one uses.
function Preview({ appearance }) {
  const t = themeVars(appearance);
  const style = { ...t.root, ...t.accent, fontFamily: t.font || FONTS.inter, background: "var(--ui-bg, #f5f6f8)", color: "var(--ui-ink, #111827)", borderRadius: "var(--ui-r, 8px)",
    border: "1px solid var(--ui-line, #e3e6eb)", overflow: "hidden", display: "flex", minHeight: 220 };
  const card = { background: "var(--ui-surface, #fff)", border: "1px solid var(--ui-line, #e3e6eb)", borderRadius: "var(--ui-r, 8px)", padding: 12 };
  return (
    <div style={style} aria-label="Preview">
      <div style={{ width: 120, background: "var(--ui-side-bg, #111520)", color: "var(--ui-side-ink, #c9cdd6)", padding: 12, fontSize: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        {t.brand.logoUrl ? <img src={t.brand.logoUrl} alt="" referrerPolicy="no-referrer" style={{ height: 22, maxWidth: 96, objectFit: "contain", alignSelf: "flex-start" }} /> : null}
        <b style={{ color: "var(--ui-side-strong, #fff)" }}>{t.brand.name || "Leads"}</b>
        <span style={{ color: "var(--ui-side-active-icon, #8fa6ff)" }}>Find Leads</span>
        <span>My lists</span>
      </div>
      <div style={{ flex: 1, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={card}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>Find Leads</div>
          <div style={{ fontSize: 12, color: "var(--ui-muted, #6b7280)", margin: "4px 0 10px" }}>Search for companies by what they do and where.</div>
          <div style={{ display: "flex", gap: 8 }}>
            <input readOnly value="Cafes in London" style={{ flex: 1, padding: "7px 10px", border: "1px solid var(--ui-line-strong, #cbd1d9)", borderRadius: "var(--ui-r-sm, 6px)", font: "inherit", fontSize: 13 }} />
            <button type="button" style={{ padding: "7px 14px", border: 0, borderRadius: "var(--ui-r-sm, 6px)", background: "var(--ui-accent, #3457d5)", color: "#fff", font: "inherit", fontSize: 13, fontWeight: 600 }}>Search</button>
          </div>
        </div>
        <div style={{ ...card, display: "flex", justifyContent: "space-between", fontSize: 13 }}>
          <span>Acme Cafe Ltd</span>
          <span style={{ background: "var(--ui-accent-soft, #eef2fe)", color: "var(--ui-accent-ink, #26409e)", padding: "1px 8px", borderRadius: 99, fontSize: 11.5, fontWeight: 600 }}>New</span>
        </div>
        <div style={{ ...card, fontSize: 13, color: "var(--ui-bad, #b4390a)", background: "var(--ui-bad-soft, #fbe9e6)" }}>Could not reach this mailbox.</div>
      </div>
    </div>
  );
}

// The default look of the partner's embedded screens. A page can still pass its own when it mounts a screen.
export function ThemeBox({ partner, busy, act }) {
  const saved = cleanAppearance(partner.theme).variables;
  const [vars, setVars] = useState(saved);
  useEffect(() => { setVars(cleanAppearance(partner.theme).variables); }, [partner.theme]);
  const set = (k, v) => setVars((x) => {
    const next = { ...x };
    if (v === "" || v === undefined) delete next[k];
    else next[k] = v;
    return next;
  });
  const appearance = { variables: vars };
  const changed = JSON.stringify(cleanAppearance(appearance).variables) !== JSON.stringify(saved);
  const dropped = ["brandName", "logoUrl"].filter((k) => vars[k] && !cleanAppearance(appearance).variables[k]); // typed, but not usable
  return (
    <div style={box}>
      <h3 style={h3}>Look and feel</h3>
      <div style={hint}>The default colours, font and corners of every screen you embed. A page can pass its own <code>appearance</code> when it mounts a screen, which wins over this. Anything you leave blank keeps Outreach's own look.</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16, marginTop: 12 }}>
        <div>
          {COLOR_KEYS.map((k) => (
            <div key={k} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <input type="color" aria-label={COLOR_LABELS[k]} value={vars[k] || DEFAULTS[k]} onChange={(e) => set(k, e.target.value)} style={{ width: 34, height: 28, padding: 0, border: `1px solid ${C.border}`, borderRadius: 6 }} />
              <span style={{ fontSize: 13, flex: 1 }}>{COLOR_LABELS[k]}</span>
              {vars[k] ? <button type="button" style={{ ...button(false), padding: "3px 8px", fontSize: 12 }} onClick={() => set(k, "")}>Reset</button> : <span style={hint}>default</span>}
            </div>
          ))}
          <div style={{ marginBottom: 8 }}>
            <label htmlFor="pe-brand" style={{ fontSize: 13, display: "block", marginBottom: 3 }}>Name shown above the menu (optional)</label>
            <input id="pe-brand" maxLength={MAX_NAME} value={vars.brandName || ""} onChange={(e) => set("brandName", e.target.value)} placeholder="Leads" style={{ width: "100%", boxSizing: "border-box", padding: "6px 9px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13 }} />
          </div>
          <div style={{ marginBottom: 8 }}>
            <label htmlFor="pe-logo" style={{ fontSize: 13, display: "block", marginBottom: 3 }}>Logo (https address, optional)</label>
            <input id="pe-logo" value={vars.logoUrl || ""} onChange={(e) => set("logoUrl", e.target.value)} placeholder="https://yourproduct.com/logo.svg" style={{ width: "100%", boxSizing: "border-box", padding: "6px 9px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13 }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <label htmlFor="pe-font" style={{ fontSize: 13, flex: 1 }}>Font</label>
            <select id="pe-font" value={vars.fontFamily || ""} onChange={(e) => set("fontFamily", e.target.value)} style={{ padding: "5px 8px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13 }}>
              <option value="">Default</option>
              {Object.keys(FONTS).map((f) => <option key={f} value={f}>{FONT_LABELS[f]}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <label htmlFor="pe-radius" style={{ fontSize: 13, flex: 1 }}>Corner roundness ({vars.borderRadius === undefined ? "default" : `${vars.borderRadius}px`})</label>
            <input id="pe-radius" type="range" min={0} max={MAX_RADIUS} value={vars.borderRadius === undefined ? 8 : vars.borderRadius} onChange={(e) => set("borderRadius", Number(e.target.value))} />
          </div>
        </div>
        <Preview appearance={appearance} />
      </div>
      {dropped.includes("logoUrl") && <div role="alert" style={{ ...hint, color: C.red }}>The logo must be an https address.</div>}
      <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
        <button type="button" disabled={busy || !changed || dropped.length > 0} style={button(true, busy || !changed)} onClick={() => act(() => api.savePartnerTheme({ variables: vars }), "Look saved.")}>Save look</button>
        {Object.keys(vars).length > 0 && <button type="button" style={button(false)} onClick={() => setVars({})}>Clear all</button>}
      </div>
      <div style={hint}>The preview is a sketch. The full app uses the same colours, but some parts keep their own (status colours, charts) so they stay readable.</div>
    </div>
  );
}

// Copy-paste code for the partner's developers.
export function EmbedSnippets({ partner }) {
  const host = window.location.origin;
  const [tab, setTab] = useState("server");
  const tabs = [["server", "1. Your server"], ["inline", "2. Inline"], ["modal", "Popup"], ["drawer", "Side panel"], ["full", "Full page"], ["connect", "Connect a user"], ["auto", "Match my software"]];
  const code = {
    server: `# On YOUR server, never in a web page. Ask Outreach for a token for one of your users.
curl -X POST ${host}/api/embed/sessions \\
  -H "Authorization: Bearer ${partner.secretKeyPrefix || "psk_test_..."}" -H "Content-Type: application/json" \\
  -d '{"external_id":"user-42","component":"leads"}'
# -> {"token":"...","expires_at":1767225600}
# component: leads, campaigns, mail, voice or social. access: "full" (default) or "view".
# Your page asks your server for this token; it lasts 15 minutes and the page asks again when it ends.`,
    inline: `<script src="${host}/embed.js"></script>
<div id="outreach-box"></div>
<script>
  const outreach = Outreach("${partner.clientId}");
  outreach.create("leads", {
    getToken: () => fetch("/my-server/outreach-token?component=leads").then(r => r.json()).then(d => d.token),
    appearance: { variables: { colorPrimary: "#0f766e", borderRadius: 10 } },   // optional
    height: "640px",
    onReady: () => console.log("ready"),
  }).mount("#outreach-box");
</script>`,
    modal: `outreach.create("campaigns", { getToken }).open({ mode: "modal" });
// .close() closes it; Esc and the × button also do.`,
    drawer: `outreach.create("voice", { getToken }).open({ mode: "drawer", side: "right", width: "560px" });`,
    full: `// Replaces your page with the screen (or pass { newTab: true }).
outreach.redirect("mail", { getToken });`,
    auto: `// Let the screen pick up your page's own colours, and keep following them (a theme switch, for example).
outreach.create("leads", { getToken, appearance: "auto" }).mount("#outreach-box");

// Point it at what to copy when the guess is not right. Anything you set yourself wins.
outreach.create("leads", {
  getToken,
  appearance: {
    auto: { primary: "--brand-color",      // a CSS variable on your page, or a selector such as ".btn-primary"
            danger: "--error",             // a CSS variable
            sidebar: "#app-sidebar" },     // the selector of your own side menu
    variables: { borderRadius: 12 },       // your own values win over what was read
  },
});
// It reads the page's button colour, corners, font, background, text, error colour and side menu.
// Dark pages: the screens have no dark theme yet, so a dark page keeps the screen's light background and text.`,
    connect: `# 1. Your server: is this user linked yet?
curl -X POST ${host}/api/embed/connect-sessions \\
  -H "Authorization: Bearer psk_..." -H "Content-Type: application/json" \\
  -d '{"external_id":"user-42","component":"leads"}'
# -> {"linked":true,"link_id":"plink_..."}   already linked: just ask for a token (step 1)
# -> {"linked":false,"connect_token":"..."}  open the connect screen:

// 2. Your page
outreach.connect({
  connectToken,
  onConnected: ({ linkId, externalId, mode }) => console.log("linked", linkId, mode),  // mode: existing | partner_created
}).open({ mode: "modal" });
// The person signs in to Outreach, or creates an account, inside our page. Your software never sees the password.`,
  };
  return (
    <div style={box}>
      <h3 style={h3}>Show Outreach in your software</h3>
      <div style={hint}>Every screen can be placed inline, as a popup, as a side panel, or as a full page. The screens are the same; you choose the layout in your code. Add your page's web address above first: only those addresses may show the screens.</div>
      <div role="tablist" style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "10px 0 2px" }}>
        {tabs.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} style={{ ...button(tab === id), padding: "5px 10px", fontSize: 12 }} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      <Code>{code[tab]}</Code>
    </div>
  );
}
