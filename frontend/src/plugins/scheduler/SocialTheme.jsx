import React, { useEffect, useRef, useState } from "react";
import { Check, Globe, RotateCcw, Trash2, Upload } from "lucide-react";
import { Loader } from "../../app/Loader";
import { api } from "../../api/apiClient";
import { C, FONT_BODY, FONT_DISPLAY } from "../../tokens";

// Theme: the company's look and what it does, kept once and used in every post. It can be read from the company's website (name, logos,
// colours, what the business sells) and changed by hand. The colours and logo go on each post picture just before it goes out (see
// services/brand_kit.py); the business facts and colours can also be given to the AI that writes the posts and draws the pictures.

const POSITION_NAMES = {
  top_left: "Top left", top_center: "Top centre", top_right: "Top right",
  middle_left: "Middle left", middle_center: "Centre", middle_right: "Middle right",
  bottom_left: "Bottom left", bottom_center: "Bottom centre", bottom_right: "Bottom right",
};
const ROLES = [
  ["primary", "Primary", "The bar and frame on your pictures"],
  ["accent", "Accent", "A thin line on the bar, highlights"],
  ["accent2", "Accent 2", "A second highlight"],
  ["background", "Background", "Pages and cards in your colours"],
  ["surface", "Surface", "Behind your logo on a picture"],
  ["text", "Text", "Main writing"],
  ["muted", "Muted text", "Smaller, quieter writing"],
  ["border", "Border", "Lines and outlines"],
  ["warning", "Warning", "Anything that needs attention"],
];

const CSS = `
.bk{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:20px;align-items:start;padding:20px 24px 48px;max-width:1120px;margin:0 auto;font-family:${FONT_BODY};color:${C.ink}}
.bk-side{position:sticky;top:12px;display:grid;gap:10px}
.bk-card{background:#fff;border:1px solid ${C.border};border-radius:12px;padding:16px 18px;display:grid;gap:12px}
.bk-card h2{margin:0;font:700 14px ${FONT_DISPLAY}}
.bk-note{margin:0;font-size:12.5px;line-height:1.45;color:${C.slate}}
.bk-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.bk-field{display:grid;gap:4px;font-size:12px;font-weight:700;color:${C.slate};min-width:0}
.bk-field input[type=text],.bk-field input:not([type]),.bk-field textarea{border:1px solid ${C.border};border-radius:8px;padding:0 10px;font:14px ${FONT_BODY};color:${C.ink};min-width:0;box-sizing:border-box;width:100%}
.bk-field input[type=text],.bk-field input:not([type]){height:38px}
.bk-field textarea{padding:8px 10px;line-height:1.4;resize:vertical;min-height:72px}
.bk-field input:focus,.bk-field textarea:focus{outline:0;border-color:var(--ui-accent,#0C8C7D);box-shadow:0 0 0 3px rgba(12,140,125,.22)}
.bk-strip{display:flex;height:22px;border-radius:6px;overflow:hidden;border:1px solid ${C.border}}
.bk-strip i{flex:1}
.bk-presets{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}
.bk-preset{display:flex;align-items:center;gap:8px;border:1.5px solid ${C.border};background:#fff;border-radius:10px;padding:8px 10px;cursor:pointer;font:600 12.5px ${FONT_BODY};color:${C.ink};min-height:44px;text-align:left}
.bk-preset[aria-pressed="true"]{border-color:${C.teal};background:${C.tealSoft}}
.bk-preset:focus-visible,.bk-pos button:focus-visible,.bk-tpl:focus-visible,.bk-logo:focus-visible,.bk-chip:focus-visible{outline:2px solid ${C.teal};outline-offset:2px}
.bk-sw{display:inline-flex;border-radius:4px;overflow:hidden;border:1px solid rgba(0,0,0,.12);flex:none}
.bk-sw i{width:12px;height:18px}
.bk-colours{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 14px}
.bk-colour{display:grid;gap:4px;min-width:0}
.bk-colour label{font-size:12px;font-weight:700;color:${C.ink};display:grid;gap:1px}
.bk-colour label small{font-weight:400;color:${C.slate};font-size:11.5px;line-height:1.3}
.bk-colour .bk-row{gap:6px;flex-wrap:nowrap}
.bk-colour input[type=color]{width:44px;height:38px;padding:2px;border:1px solid ${C.border};border-radius:8px;background:#fff;flex:none;cursor:pointer}
.bk-colour input[type=text]{height:38px;border:1px solid ${C.border};border-radius:8px;padding:0 10px;font:13px ${FONT_BODY};min-width:0;width:100%;box-sizing:border-box;text-transform:uppercase}
.bk-tpls{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}
.bk-tpl{border:1.5px solid ${C.border};background:#fff;border-radius:10px;padding:10px;cursor:pointer;text-align:left;font-family:${FONT_BODY};display:grid;grid-template-columns:34px minmax(0,1fr);gap:10px;align-items:start;min-height:56px}
.bk-tpl[aria-pressed="true"]{border-color:${C.teal};background:${C.tealSoft}}
.bk-thumb{position:relative;width:34px;height:44px;border-radius:4px;background:#DDE3EE;overflow:hidden}
.bk-thumb i{position:absolute;background:var(--bk,#3457D5)}
.bk-pos{display:grid;grid-template-columns:repeat(3,44px);grid-template-rows:repeat(3,44px);gap:4px;padding:6px;border:1px solid ${C.border};border-radius:10px;background:#F4F6FA;width:fit-content}
.bk-pos button{border:1px solid ${C.border};background:#fff;border-radius:6px;cursor:pointer;padding:0;display:grid;place-items:center}
.bk-pos button[aria-pressed="true"]{background:${C.teal};border-color:${C.teal}}
.bk-pos button[aria-pressed="true"]::after{content:"";width:14px;height:14px;border-radius:3px;background:#fff}
.bk-logos{display:flex;gap:8px;flex-wrap:wrap}
.bk-logo{border:1.5px solid ${C.border};background:#fff;border-radius:10px;padding:6px;cursor:pointer;display:grid;place-items:center;width:84px;height:64px}
.bk-logo[aria-pressed="true"]{border-color:${C.teal};box-shadow:0 0 0 2px ${C.tealSoft}}
.bk-logo img{max-width:100%;max-height:100%;object-fit:contain}
.bk-chips{display:flex;gap:6px;flex-wrap:wrap}
.bk-chip{border:1px solid ${C.border};background:${C.paper};border-radius:999px;padding:3px 10px;font-size:12px;color:${C.ink}}
.bk-found{border:1px dashed ${C.border};border-radius:10px;padding:10px 12px;display:grid;gap:8px;background:#FBFCFD}
.bk-prev{border:1px solid ${C.border};border-radius:12px;background:#fff;padding:10px;display:grid;gap:8px}
.bk-prev img{width:100%;border-radius:8px;display:block;background:#E9EDF5;aspect-ratio:4/5;object-fit:cover}
.bk-switch{display:flex;align-items:flex-start;gap:10px;font-size:14px;font-weight:600;cursor:pointer}
.bk-switch input{width:20px;height:20px;margin:1px 0 0;flex:none;accent-color:${C.teal}}
.bk-switch small{display:block;font-weight:400;font-size:12.5px;color:${C.slate};margin-top:2px}
@media (max-width:900px){
  .bk{grid-template-columns:minmax(0,1fr);padding:12px 12px 88px}
  .bk-side{position:static;order:-1}
  .bk-prev img{max-height:250px;aspect-ratio:auto;object-fit:contain}
  .bk-pos{grid-template-columns:repeat(3,48px);grid-template-rows:repeat(3,48px)}
  .bk-colours{grid-template-columns:minmax(0,1fr)}
  .bk .ui-btn{min-height:44px}
}
`;

function Thumb({ id, colour }) {
  return (
    <span className="bk-thumb" style={{ "--bk": colour }} aria-hidden="true">
      {id === "logo" ? <i style={{ right: 4, bottom: 4, width: 10, height: 6, borderRadius: 2 }} /> : null}
      {id === "footer" ? <i style={{ left: 0, right: 0, bottom: 0, height: 9 }} /> : null}
      {id === "banner" ? <i style={{ left: 0, right: 0, top: 0, height: 9 }} /> : null}
      {id === "frame" ? (<>
        <i style={{ left: 0, right: 0, top: 0, height: 3 }} /><i style={{ left: 0, right: 0, bottom: 0, height: 9 }} />
        <i style={{ left: 0, top: 0, bottom: 0, width: 3 }} /><i style={{ right: 0, top: 0, bottom: 0, width: 3 }} />
      </>) : null}
    </span>
  );
}

const Swatches = ({ colours }) => <span className="bk-sw" aria-hidden="true">{colours.map((c, i) => <i key={i} style={{ background: c }} />)}</span>;

export function ThemePage({ showToast, onOpenVoice }) {
  const [meta, setMeta] = useState(null);
  const [kit, setKit] = useState(null);
  const [saved, setSaved] = useState(null);
  const [site, setSite] = useState("");
  const [reading, setReading] = useState(false);
  const [found, setFound] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState("");
  const [previewError, setPreviewError] = useState("");
  const fileRef = useRef(null);

  useEffect(() => {
    api.getBrandKit().then((d) => { setMeta(d); setKit(d.kit); setSaved(d.kit); setSite(d.kit.website || ""); }).catch((e) => setError(e.message || "Could not load your theme."));
  }, []);

  useEffect(() => {
    if (!kit) return undefined;
    const t = window.setTimeout(() => {
      api.previewBrandKit({ kit }).then((r) => { setPreview(r.image); setPreviewError(""); }).catch((e) => setPreviewError(e.message || "The preview could not be drawn."));
    }, 350);
    return () => window.clearTimeout(t);
  }, [kit]);

  if (error && !kit) return <div role="alert" style={{ padding: 24, color: C.red }}>{error}</div>;
  if (!kit || !meta) return <Loader compact label="Loading your theme" />;
  const set = (k, v) => setKit((o) => ({ ...o, [k]: v }));
  const setBusiness = (k, v) => setKit((o) => ({ ...o, business: { ...o.business, [k]: v } }));
  const setColour = (role, value) => setKit((o) => ({ ...o, preset: "custom", colours: { ...o.colours, [role]: value }, primary: role === "primary" ? value : o.primary }));
  const changed = JSON.stringify(kit) !== JSON.stringify(saved);
  const lines = (v) => (Array.isArray(v) ? v.join("\n") : "");
  const presetColours = (id) => (meta.presets.find((p) => p.id === id) || meta.presets[0]).colours;

  const pickPreset = (id) => setKit((o) => ({ ...o, preset: id, colours: { ...presetColours(id) }, primary: presetColours(id).primary }));
  const reset = () => pickPreset(kit.preset !== "custom" ? kit.preset : "default");

  const readSite = async (e) => {
    e.preventDefault();
    if (!site.trim()) return;
    setReading(true); setError(""); setFound(null);
    try {
      const r = await api.brandKitFromWebsite(site.trim());
      setKit((o) => ({
        ...o,
        name: r.name || o.name, website: r.website || o.website, footerText: r.footerText || o.footerText,
        preset: "custom", colours: { ...o.colours, ...(r.palette || {}) }, primary: (r.palette && r.palette.primary) || o.primary,
        logoUrl: r.logoUrl || o.logoUrl, logoOptions: r.logos && r.logos.length ? r.logos : o.logoOptions,
        template: o.template === "logo" && !(r.logoUrl || o.logoUrl) ? "footer" : o.template,
        business: { ...o.business, ...Object.fromEntries(Object.entries(r.business || {}).filter(([, v]) => (Array.isArray(v) ? v.length : v))) },
        useInPosts: Boolean(r.found && r.found.about) || o.useInPosts,
      }));
      setFound(r);
    } catch (err) { setError(err.message || "We could not read that website."); }
    setReading(false);
  };

  const pickLogo = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try { const r = await api.uploadBrandLogo(file); setKit((o) => ({ ...o, logoUrl: r.logoUrl, logoOptions: [r.logoUrl, ...o.logoOptions.filter((u) => u !== r.logoUrl)].slice(0, 6) })); setError(""); }
    catch (err) { setError(err.message || "That logo could not be uploaded."); }
  };

  const save = async () => {
    setBusy(true); setError("");
    try {
      const r = await api.saveBrandKit(kit);
      setKit(r.kit); setSaved(r.kit);
      window.dispatchEvent(new Event("aivhub:brand-kit"));
      showToast && showToast(r.kit.enabled ? "Theme saved. Every post picture now carries it." : "Theme saved. It is not on posts until you switch it on.");
    } catch (err) { setError(err.message || "Could not save."); }
    setBusy(false);
  };

  const strip = ROLES.map(([r]) => kit.colours[r]);

  return (
    <div className="bk">
      <style>{CSS}</style>
      <div style={{ display: "grid", gap: 14, minWidth: 0 }}>
        <section className="bk-card" aria-label="Start from your website">
          <h2>Start from your website or product</h2>
          <p className="bk-note">Give us the address of your company, brand or software. We read it for your name, logos, colours, what you sell and how it works. You check everything below and change what you like. Nothing is saved until you press Save.</p>
          <form className="bk-row" onSubmit={readSite}>
            <label className="bk-field" style={{ flex: "1 1 220px" }}>
              <span>Website address</span>
              <input type="text" inputMode="url" autoComplete="url" placeholder="yourcompany.com" value={site} onChange={(e) => setSite(e.target.value)} />
            </label>
            <button type="submit" className="ui-btn ui-btn--primary" disabled={reading || !site.trim()} style={{ alignSelf: "flex-end" }}><Globe size={15} aria-hidden="true" /> {reading ? "Reading…" : "Read my website"}</button>
          </form>
          {found ? (
            <div className="bk-found" role="status">
              <div className="bk-note" style={{ color: C.ink }}>
                Found on {found.website}: {[["name", "name"], ["logo", "logo"], ["colour", "colours"], ["about", "what you do"], ["products", "products or services"]].map(([k, w]) => `${w} ${found.found[k] ? "yes" : "no"}`).join(", ")}.
                {found.found.logo && found.found.colour && found.found.about ? " It is filled in below. Check it." : " Fill in what is missing below. Websites built entirely with scripts show us little."}
              </div>
              {found.business && found.business.pages && found.business.pages.length ? (
                <div><div className="bk-note" style={{ marginBottom: 4 }}>How the site is laid out (its menu):</div>
                  <div className="bk-chips">{found.business.pages.map((p) => <span key={p} className="bk-chip">{p}</span>)}</div></div>
              ) : null}
            </div>
          ) : null}
        </section>

        <section className="bk-card" aria-label="Colours">
          <h2>Colours</h2>
          <div>
            <div className="bk-note" style={{ marginBottom: 4 }}>Your theme at a glance</div>
            <div className="bk-strip" role="img" aria-label={"Your nine colours: " + strip.join(", ")}>{strip.map((c, i) => <i key={i} style={{ background: c }} />)}</div>
          </div>
          <div className="bk-row" style={{ justifyContent: "space-between" }}>
            <strong style={{ fontSize: 12.5, color: C.slate }}>Theme presets</strong>
            <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={reset}><RotateCcw size={13} aria-hidden="true" /> Reset</button>
          </div>
          <div className="bk-presets" role="group" aria-label="Theme presets">
            {meta.presets.map((p) => (
              <button key={p.id} type="button" className="bk-preset" aria-pressed={kit.preset === p.id} onClick={() => pickPreset(p.id)}>
                <Swatches colours={[p.colours.primary, p.colours.accent, p.colours.accent2]} />
                <span>{p.name}</span>{kit.preset === p.id ? <Check size={13} color={C.teal} aria-hidden="true" style={{ marginLeft: "auto" }} /> : null}
              </button>
            ))}
          </div>
          <strong style={{ fontSize: 12.5, color: C.slate }}>Custom colours{kit.preset === "custom" ? "" : " (change one to make your own)"}</strong>
          <div className="bk-colours">
            {ROLES.map(([role, name, hint]) => (
              <div key={role} className="bk-colour">
                <label htmlFor={"bk-c-" + role}>{name}<small>{hint}</small></label>
                <div className="bk-row">
                  <input type="color" aria-label={`Pick ${name}`} value={kit.colours[role]} onChange={(e) => setColour(role, e.target.value.toUpperCase())} />
                  <input id={"bk-c-" + role} type="text" value={kit.colours[role]} maxLength={7} onChange={(e) => setColour(role, e.target.value)} />
                </div>
              </div>
            ))}
          </div>
          <label className="bk-switch" style={{ fontWeight: 500, fontSize: 13 }}>
            <input type="checkbox" checked={kit.useInPictures} onChange={(e) => set("useInPictures", e.target.checked)} />
            <span>Tell the picture AI to use my colours<small>New AI pictures are drawn around your primary and accent colours.</small></span>
          </label>
        </section>

        <section className="bk-card" aria-label="Template">
          <h2>Template on your pictures</h2>
          <div className="bk-tpls" role="group" aria-label="Template">
            {meta.templates.map((t) => (
              <button key={t.id} type="button" className="bk-tpl" aria-pressed={kit.template === t.id} onClick={() => set("template", t.id)}>
                <Thumb id={t.id} colour={kit.colours.primary} />
                <span>
                  <span style={{ fontWeight: 700, fontSize: 13, display: "flex", gap: 4, alignItems: "center" }}>{kit.template === t.id ? <Check size={13} color={C.teal} aria-hidden="true" /> : null}{t.name}</span>
                  <span style={{ display: "block", fontSize: 11.5, color: C.slate, marginTop: 2 }}>{t.note}</span>
                </span>
              </button>
            ))}
          </div>
          <label className="bk-field">
            <span>Footer line (shown on the bar)</span>
            <input type="text" value={kit.footerText} maxLength={120} placeholder="Your name · yourcompany.com · 0113 000 0000" onChange={(e) => set("footerText", e.target.value)} />
          </label>
          {kit.template === "logo" ? <p className="bk-note">The Logo only template shows no footer line. Choose a bar or frame to show it.</p> : null}
        </section>

        <section className="bk-card" aria-label="Logo">
          <h2>Logo</h2>
          {kit.logoOptions.length > 1 ? (
            <div>
              <div className="bk-note" style={{ marginBottom: 6 }}>Logos we found. Pick the one to use.</div>
              <div className="bk-logos" role="group" aria-label="Logos">
                {kit.logoOptions.map((u, i) => <button key={u} type="button" className="bk-logo" aria-pressed={kit.logoUrl === u} aria-label={`Logo ${i + 1}`} onClick={() => set("logoUrl", u)}><img src={u} alt="" /></button>)}
              </div>
            </div>
          ) : null}
          <div className="bk-row">
            {kit.logoUrl ? <img src={kit.logoUrl} alt="Your logo" style={{ height: 44, maxWidth: 140, objectFit: "contain", border: `1px solid ${C.border}`, borderRadius: 8, background: "#fff", padding: 4 }} /> : <span className="bk-note">No logo yet.</span>}
            <button type="button" className="ui-btn ui-btn--secondary" onClick={() => fileRef.current && fileRef.current.click()}><Upload size={15} aria-hidden="true" /> {kit.logoUrl ? "Upload a different logo" : "Upload logo"}</button>
            {kit.logoUrl ? <button type="button" className="ui-btn ui-btn--ghost" onClick={() => set("logoUrl", "")}><Trash2 size={15} aria-hidden="true" /> Remove</button> : null}
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={pickLogo} style={{ display: "none" }} aria-label="Logo file" />
          </div>
          <p className="bk-note">A PNG with a clear background works best.</p>
          {kit.logoUrl ? (
            <>
              <div className="bk-field">
                <span id="bk-pos-l">Where the logo goes: {POSITION_NAMES[kit.logoPosition]}</span>
                <div className="bk-pos" role="group" aria-labelledby="bk-pos-l">
                  {meta.positions.map((p) => <button key={p} type="button" aria-pressed={kit.logoPosition === p} aria-label={POSITION_NAMES[p]} title={POSITION_NAMES[p]} onClick={() => set("logoPosition", p)} />)}
                </div>
              </div>
              <label className="bk-field">
                <span>Size: {kit.logoSize}% of the picture's width</span>
                <input type="range" min={8} max={40} value={kit.logoSize} onChange={(e) => set("logoSize", Number(e.target.value))} style={{ width: "100%", maxWidth: 320, accentColor: C.teal }} />
              </label>
              <label className="bk-switch" style={{ fontWeight: 500, fontSize: 13 }}>
                <input type="checkbox" checked={kit.logoBackdrop} onChange={(e) => set("logoBackdrop", e.target.checked)} />
                <span>Backing in your surface colour behind the logo, for logos that are hard to see on a coloured bar or a busy picture</span>
              </label>
            </>
          ) : null}
        </section>

        <section className="bk-card" aria-label="About your business">
          <h2>About your business</h2>
          <p className="bk-note">What we read from your website, in your own words to edit. The AI uses it when it writes your posts, so it knows what you sell and never has to guess.</p>
          <label className="bk-field"><span>Business name</span><input type="text" value={kit.name} maxLength={80} onChange={(e) => set("name", e.target.value)} /></label>
          <label className="bk-field"><span>What you do</span><textarea value={kit.business.summary} maxLength={600} rows={3} onChange={(e) => setBusiness("summary", e.target.value)} /></label>
          <label className="bk-field"><span>Your line</span><input type="text" value={kit.business.tagline} maxLength={140} onChange={(e) => setBusiness("tagline", e.target.value)} /></label>
          <label className="bk-field"><span>Products or services, one on each line</span><textarea value={lines(kit.business.products)} rows={4} onChange={(e) => setBusiness("products", e.target.value.split("\n"))} /></label>
          <label className="bk-field"><span>How it works, one step on each line</span><textarea value={lines(kit.business.howItWorks)} rows={3} onChange={(e) => setBusiness("howItWorks", e.target.value.split("\n"))} /></label>
          <label className="bk-switch" style={{ fontWeight: 500, fontSize: 13 }}>
            <input type="checkbox" checked={kit.useInPosts} onChange={(e) => set("useInPosts", e.target.checked)} />
            <span>Use this when the AI writes my posts<small>Only these facts are given to it. It is told not to invent products, prices or claims.</small></span>
          </label>
        </section>

        {onOpenVoice ? (
          <section className="bk-card" aria-label="How your posts sound">
            <h2>How your posts sound</h2>
            <p className="bk-note">Tone, who you write for, what to always and never say, and sample posts. It sits beside your theme: the theme is how posts look and what you sell, Brand voice is how they sound.</p>
            <div><button type="button" className="ui-btn ui-btn--secondary" onClick={onOpenVoice}>Open Brand voice</button></div>
          </section>
        ) : null}
      </div>

      <aside className="bk-side" aria-label="Preview and save">
        <div className="bk-prev">
          <strong style={{ fontSize: 12.5, color: C.slate }}>How a picture will look</strong>
          {preview ? <img src={preview} alt="A sample post picture with your theme on it" /> : <div style={{ aspectRatio: "4/5", borderRadius: 8, background: "#E9EDF5" }} />}
          {previewError ? <div role="alert" className="bk-note" style={{ color: C.red }}>{previewError}</div> : <p className="bk-note">A plain backdrop stands in for your picture. Your real pictures keep their own look.</p>}
        </div>
        <div className="bk-card">
          <label className="bk-switch">
            <input type="checkbox" checked={kit.enabled} onChange={(e) => set("enabled", e.target.checked)} />
            <span>Put my theme on every post picture<small>Added just before a post goes out. You can turn it off for a single post in the post editor.</small></span>
          </label>
          {error ? <div role="alert" className="bk-note" style={{ color: C.red }}>{error}</div> : null}
          <div className="bk-row">
            <button type="button" className="ui-btn ui-btn--primary" disabled={busy || !changed} onClick={save}>{busy ? "Saving…" : "Save theme"}</button>
            <span className="bk-note" role="status">{changed ? "You have changes to save." : "Saved."}</span>
          </div>
        </div>
      </aside>
    </div>
  );
}
