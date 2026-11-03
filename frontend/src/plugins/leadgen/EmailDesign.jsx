import React, { useCallback, useEffect, useRef, useState } from "react";
import { Monitor, Send, Smartphone, X } from "lucide-react";
import { api } from "../../api/apiClient";
import { C, FONT_BODY } from "../../tokens";

// Designed emails: the brand (logo, colours, font, header, footer), a preview that is the real message, and a test send.
// The text of each email stays what the campaign already holds. The server draws the layout around it, so what is shown here is what goes out.

const text = { fontFamily: FONT_BODY };
const muted = { ...text, fontSize: 13, color: C.slate, lineHeight: 1.5 };
const label = { ...text, fontSize: 12.5, fontWeight: 600, color: C.ink };

export const FONT_LABEL = { arial: "Arial", verdana: "Verdana", tahoma: "Tahoma", trebuchet: "Trebuchet MS", georgia: "Georgia", times: "Times New Roman" };
const EMPTY = { brand_name: "", logo_url: "", logo_width: 140, header_text: "", accent: "#3457D5", button_color: "#3457D5", button_text: "#FFFFFF", text_color: "#1B1D24", background: "#F4F5F7", font: "arial", footer_text: "", address: "" };
export const SAMPLE_BODY = "Hi {{first_name}},\n\nI noticed {{company}} is growing and wanted to introduce what we do.\n\n[Book a 15 minute call](https://example.com/book)\n\nBest wishes";

// The brand and which campaigns use it, loaded once and kept after each save.
export function useEmailDesign() {
  const [design, setDesign] = useState(null);
  const [error, setError] = useState("");
  const reload = useCallback(() => {
    api.getEmailDesign().then((r) => { setDesign(r); setError(""); }).catch((e) => setError(e.message || "Couldn't load your email design."));
  }, []);
  useEffect(() => { reload(); }, [reload]);
  return { design, error, reload, setDesign };
}

// The email as it will arrive, drawn by the server with the same code that sends it. The frame has no permissions at all.
export function DesignPreview({ subject, body, brand, mailboxId, sample, height = 560 }) {
  const [page, setPage] = useState({ html: "", warnings: [], subject: "" });
  const [phone, setPhone] = useState(false);
  const [error, setError] = useState("");
  const run = useRef(0);
  useEffect(() => {
    const mine = ++run.current;
    const t = setTimeout(() => {
      api.previewEmailDesign({ subject: subject || "", body: body || "", brand: brand || null, mailbox_id: mailboxId || "", ...(sample ? { sample } : {}) })
        .then((r) => { if (mine === run.current) { setPage(r); setError(""); } })
        .catch((e) => { if (mine === run.current) setError(e.message || "The preview didn't load."); });
    }, 350);
    return () => clearTimeout(t);
  }, [subject, body, brand, mailboxId, sample]);
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <h3 style={{ ...text, fontSize: 15, fontWeight: 700, color: C.ink, margin: 0 }}>Preview</h3>
        <span style={{ flex: 1 }} />
        <button type="button" className={`ui-btn ui-btn--sm ${phone ? "ui-btn--ghost" : "ui-btn--secondary"}`} aria-pressed={!phone} onClick={() => setPhone(false)}><Monitor size={13} /> Computer</button>
        <button type="button" className={`ui-btn ui-btn--sm ${phone ? "ui-btn--secondary" : "ui-btn--ghost"}`} aria-pressed={phone} onClick={() => setPhone(true)}><Smartphone size={13} /> Phone</button>
      </div>
      {page.subject ? <div style={{ ...muted, fontSize: 12.5 }}>Subject: <strong style={{ color: C.ink }}>{page.subject}</strong></div> : null}
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, background: "#fff", overflow: "auto", maxHeight: height }}>
        <iframe title="Email preview" sandbox="" srcDoc={page.html} style={{ border: 0, display: "block", width: phone ? 360 : "100%", maxWidth: "100%", height, margin: "0 auto" }} />
      </div>
      {error ? <div role="alert" style={{ ...muted, color: C.red }}>{error}</div> : null}
      {(page.warnings || []).map((w) => <div key={w} role="status" style={{ ...muted, fontSize: 12.5, color: C.amber }}>{w}</div>)}
    </div>
  );
}

// On the campaign: use the designed layout or send plain. Plain is the default.
export function DesignBox({ design, designed, setDesigned, onSetup }) {
  const problems = design?.problems || [];
  return (
    <div className="ui-card" style={{ padding: 16, display: "grid", gap: 8 }}>
      <h3 style={{ ...text, fontSize: 15, fontWeight: 700, color: C.ink, margin: 0 }}>Look of the email</h3>
      <label style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: problems.length ? "default" : "pointer" }}>
        <input type="checkbox" checked={designed} disabled={!design || problems.length > 0} onChange={(ev) => setDesigned(ev.target.checked)} style={{ marginTop: 3 }} />
        <span style={{ ...text, fontSize: 13.5, color: C.textInk }}>
          Send with my brand design
          <span style={{ ...muted, display: "block", fontSize: 12.5 }}>
            {problems.length ? problems[0] : designed ? "Logo, colours, buttons and a footer with your address. The text you write stays the same." : "Off: the email goes as a plain message, which often gets more replies in cold outreach."}
          </span>
        </span>
      </label>
      <div><button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={onSetup}>{problems.length ? "Set up my brand" : "Edit my brand"}</button></div>
    </div>
  );
}

const Field = ({ id, name, children, hint }) => (
  <div style={{ display: "grid", gap: 3 }}>
    <label htmlFor={id} style={label}>{name}</label>
    {children}
    {hint ? <span style={{ ...muted, fontSize: 12 }}>{hint}</span> : null}
  </div>
);

const ColourField = ({ id, name, value, onChange }) => (
  <Field id={id} name={name}>
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <input id={id} type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#000000"} onChange={(ev) => onChange(ev.target.value.toUpperCase())} style={{ width: 38, height: 32, padding: 0, border: `1px solid ${C.border}`, borderRadius: 6, background: "none" }} />
      <input className="ui-input" aria-label={`${name} code`} style={{ width: 100 }} value={value} maxLength={7} onChange={(ev) => onChange(ev.target.value)} />
    </div>
  </Field>
);

// The brand editor with the live preview beside it, and a test send to the sender's own mailbox.
export function BrandDialog({ design, mailboxes, subject, body, onClose, onSaved, toast }) {
  const [brand, setBrand] = useState({ ...EMPTY, ...(design?.brand || {}) });
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [sentTo, setSentTo] = useState("");
  const usable = (mailboxes || []).filter((m) => m && m.email);
  const [mailboxId, setMailboxId] = useState(usable[0]?.id || "");
  const set = (key) => (value) => setBrand((b) => ({ ...b, [key]: value }));
  const sampleBody = (body || "").trim() ? body : SAMPLE_BODY;
  const sampleSubject = (subject || "").trim() ? subject : "A quick idea for {{company}}";
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const save = async () => {
    setBusy("save"); setError("");
    try { const r = await api.saveEmailBrand(brand); onSaved(r); toast?.("Brand saved."); onClose(); } catch (e) { setError(e.message || "Couldn't save."); setBusy(""); }
  };
  const test = async () => {
    setBusy("test"); setError(""); setSentTo("");
    try { const r = await api.testSendEmailDesign({ mailbox_id: mailboxId, subject: sampleSubject, body: sampleBody, brand }); setSentTo(r.sent_to); } catch (e) { setError(e.message || "The test email didn't send."); }
    setBusy("");
  };
  return (
    <div role="dialog" aria-modal="true" aria-label="Your email brand" style={{ position: "fixed", inset: 0, zIndex: 1500, background: "rgba(15,23,42,.45)", display: "grid", placeItems: "center", padding: 12 }}>
      <div style={{ background: "#fff", borderRadius: 14, width: "min(1100px, 100%)", maxHeight: "94vh", overflow: "auto", padding: 18, display: "grid", gap: 14, boxShadow: "0 12px 40px rgba(0,0,0,.25)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h2 style={{ ...text, fontSize: 17, fontWeight: 700, color: C.ink, margin: 0, flex: 1 }}>Your email brand</h2>
          <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div style={{ flex: "1 1 340px", minWidth: 0, display: "grid", gap: 10 }}>
            <Field id="br-name" name="Business name"><input id="br-name" className="ui-input" value={brand.brand_name} maxLength={60} onChange={(ev) => set("brand_name")(ev.target.value)} /></Field>
            <Field id="br-logo" name="Logo address" hint="A web address ending in .png or .jpg, starting with https://. Shown at the top of every email."><input id="br-logo" className="ui-input" placeholder="https://yourcompany.com/logo.png" value={brand.logo_url} onChange={(ev) => set("logo_url")(ev.target.value)} /></Field>
            <Field id="br-width" name={`Logo width: ${brand.logo_width}px`}><input id="br-width" type="range" min={40} max={240} value={brand.logo_width} onChange={(ev) => set("logo_width")(Number(ev.target.value))} /></Field>
            <Field id="br-head" name="Line under the logo (optional)"><input id="br-head" className="ui-input" value={brand.header_text} maxLength={120} onChange={(ev) => set("header_text")(ev.target.value)} /></Field>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
              <ColourField id="br-accent" name="Top bar and links" value={brand.accent} onChange={set("accent")} />
              <ColourField id="br-btn" name="Button" value={brand.button_color} onChange={set("button_color")} />
              <ColourField id="br-btntxt" name="Button text" value={brand.button_text} onChange={set("button_text")} />
              <ColourField id="br-text" name="Text" value={brand.text_color} onChange={set("text_color")} />
              <ColourField id="br-bg" name="Page behind the email" value={brand.background} onChange={set("background")} />
            </div>
            <Field id="br-font" name="Font" hint="Only fonts every mail app already has, so it looks the same for everyone.">
              <select id="br-font" className="ui-input" value={brand.font} onChange={(ev) => set("font")(ev.target.value)}>
                {Object.entries(FONT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field id="br-foot" name="Footer line (optional)"><textarea id="br-foot" className="ui-input" rows={2} maxLength={300} value={brand.footer_text} onChange={(ev) => set("footer_text")(ev.target.value)} /></Field>
            <Field id="br-addr" name="Business address (required)" hint="Shown in the footer of every designed email, with the unsubscribe link."><input id="br-addr" className="ui-input" maxLength={200} placeholder="1 High Street, Leeds LS1 1AA" value={brand.address} onChange={(ev) => set("address")(ev.target.value)} /></Field>
          </div>
          <div style={{ flex: "1.2 1 380px", minWidth: 0 }}>
            <DesignPreview subject={sampleSubject} body={sampleBody} brand={brand} mailboxId={mailboxId} height={520} />
          </div>
        </div>
        {error ? <div role="alert" style={{ ...muted, color: C.red }}>{error}</div> : null}
        {sentTo ? <div role="status" style={{ ...muted, color: C.green }}>Test email sent to {sentTo}. It can take a minute to arrive.</div> : null}
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
          {usable.length ? (
            <>
              <select className="ui-input" aria-label="Send the test from" style={{ width: "auto", maxWidth: 260 }} value={mailboxId} onChange={(ev) => setMailboxId(ev.target.value)}>
                {usable.map((m) => <option key={m.id} value={m.id}>{m.email}</option>)}
              </select>
              <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" disabled={busy !== "" || !mailboxId || !brand.address.trim()} onClick={test} title={brand.address.trim() ? "Send this design to that same email address. Free, and it does not count toward your sending limit." : "Add your business address first"}>
                <Send size={13} /> {busy === "test" ? "Sending…" : "Send me a test"}
              </button>
            </>
          ) : <span style={muted}>Connect an email account to send yourself a test.</span>}
          <span style={{ flex: 1 }} />
          <button type="button" className="ui-btn ui-btn--ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="ui-btn ui-btn--primary" disabled={busy !== ""} onClick={save}>{busy === "save" ? "Saving…" : "Save brand"}</button>
        </div>
      </div>
    </div>
  );
}
