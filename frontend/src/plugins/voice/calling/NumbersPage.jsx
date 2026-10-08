import React, { useCallback, useEffect, useState } from "react";
import { BadgeCheck, Building2, CheckCircle2, Clock, FileUp, Loader2, MapPin, Phone, Search, ShieldAlert, ShoppingCart, User, XCircle } from "lucide-react";
import { C, FONT_BODY, FONT_DISPLAY, FONT_MONO } from "../../../tokens";
import { api } from "../../../api/apiClient";

const card = { background: "#fff", border: `1px solid ${C.border}`, borderRadius: 16, padding: "18px 20px" };
const input = { width: "100%", boxSizing: "border-box", padding: "9px 12px", borderRadius: 10, border: `1px solid ${C.border}`, fontSize: 13.5, fontFamily: FONT_BODY, background: "#fff" };
const label = { display: "block", fontSize: 12, fontWeight: 600, color: C.textInk, marginBottom: 5 };
const btn = (primary, disabled) => ({
  display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 16px", borderRadius: 10, cursor: disabled ? "not-allowed" : "pointer",
  border: primary ? "none" : `1px solid ${C.border}`, background: primary ? C.ink : "#fff", color: primary ? "#fff" : C.textInk,
  fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, opacity: disabled ? 0.55 : 1,
});
const h2 = { fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17, color: C.textInk, margin: "0 0 4px" };
const sub = { fontSize: 13, color: C.slate, margin: "0 0 14px", lineHeight: 1.5 };

const STEPS = [
  { key: "submitted", label: "Submitted" },
  { key: "review", label: "Under review (usually about 72 hours)" },
  { key: "done", label: "Approved" },
];

// Our monthly price for a number, from the rate card (Voice credits; a credit is a minute of calls).
function numberPrice(n) {
  const c = Number(n.monthlyCredits || 0);
  return c > 0 ? `${c.toLocaleString()} Voice credit${c === 1 ? "" : "s"} a month` : "Included";
}

// What getting a number involves, shown until the company has one (also before buying is switched
// on, so documents can be got ready).
function HowToGetANumber({ price }) {
  const setup = Number(price?.setupCredits || 0);
  const monthly = Number(price?.monthlyCredits || 0);
  const credits = (n) => `${n.toLocaleString()} Voice credit${n === 1 ? "" : "s"}`;
  const cost = [setup > 0 && `Setup: ${credits(setup)}`, monthly > 0 && `then ${credits(monthly)} a month`].filter(Boolean).join(", ");
  const steps = [
    [Search, "Choose your number", `Type the town or area code you want and pick a number.${cost ? ` ${cost}.` : ""}`],
    [BadgeCheck, "Tell us about your business", "UK rules say we must know who uses each number. Choose company or sole trader, then upload your documents. We check them, usually within 3 days."],
    [Phone, "Start calling", "Your number switches on and becomes your caller ID. You can also turn on WhatsApp for it."],
  ];
  return (
    <div style={card}>
      <div style={h2}>How to get a phone number</div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", margin: "10px 0 16px" }}>
        {steps.map(([Icon, title, text], i) => (
          <div key={title} style={{ display: "flex", gap: 10, alignItems: "flex-start", flex: "1 1 220px", minWidth: 0 }}>
            <div style={{ width: 30, height: 30, borderRadius: 9, background: C.cobaltSoft, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Icon size={15} color={C.cobalt} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: C.textInk }}>{i + 1}. {title}</div>
              <div style={{ fontSize: 12.5, color: C.slate, lineHeight: 1.5 }}>{text}</div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.textInk, marginBottom: 6 }}>What you need for step 2</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
        {[[Building2, "Registered company", "Certificate of incorporation, plus a utility bill under 3 months old showing the business name and address."],
          [User, "Sole trader", "Passport or photo ID, plus a utility bill under 3 months old showing your name and address."]].map(([Icon, title, text]) => (
          <div key={title} style={{ border: `1px solid ${C.border}`, borderRadius: 12, padding: "10px 12px", background: "#FAFAF8" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700, color: C.textInk }}><Icon size={14} color={C.slate} /> {title}</div>
            <div style={{ fontSize: 12.5, color: C.slate, marginTop: 3, lineHeight: 1.45 }}>{text}</div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 12, color: C.slate, marginTop: 10 }}>
        Files as PDF, JPG or PNG, up to 10 MB each. The next screen lists exactly what is needed.
      </div>
    </div>
  );
}

// Verification status as a small tracker: Submitted → Under review → Approved / Declined.
function Tracker({ v, onRedo }) {
  const declined = v.status === "declined" || v.status === "expired" || v.status === "error";
  const approved = v.status === "approved";
  const at = approved ? 2 : declined ? 1 : 1;
  return (
    <div style={card}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div>
          <div style={h2}>Business verification</div>
          <div style={{ fontSize: 12.5, color: C.slate }}>
            {v.entityType === "sole_trader" ? "Sole trader" : "Company"} · {v.country} {v.numberType} numbers · sent {v.submittedAt ? new Date(v.submittedAt + "Z").toLocaleDateString() : ""}
          </div>
        </div>
        {approved && <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: C.teal, fontWeight: 700, fontSize: 13 }}><BadgeCheck size={16} /> Verified</span>}
      </div>
      <ol style={{ listStyle: "none", padding: 0, margin: "16px 0 0", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
        {STEPS.map((s, i) => {
          const done = i < at || approved;
          const current = i === at && !approved;
          const bad = declined && i === 2;
          const colour = bad ? C.red : done ? C.teal : current ? C.cobalt : C.slateLight;
          return (
            <li key={s.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: colour, fontWeight: current || done ? 600 : 500 }}>
              {bad ? <XCircle size={16} /> : done ? <CheckCircle2 size={16} /> : current ? <Clock size={16} /> : <span style={{ width: 16, height: 16, borderRadius: "50%", border: `2px solid ${C.border}` }} />}
              {bad ? (v.status === "expired" ? "Expired" : "Not approved") : s.label}
            </li>
          );
        })}
      </ol>
      {declined && (
        <div style={{ marginTop: 14, padding: "10px 12px", borderRadius: 10, background: C.redSoft, color: C.red, fontSize: 13, display: "flex", gap: 8, alignItems: "flex-start" }}>
          <ShieldAlert size={16} style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <b>Reason:</b> {v.reason || "No reason was given."}
            <div style={{ marginTop: 8 }}><button type="button" style={btn(true)} onClick={onRedo}><FileUp size={14} /> Upload new documents</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

// Fields come from Telnyx (they differ per country and number type), so the form is built from them.
function VerificationWizard({ onDone, onCancel }) {
  const [step, setStep] = useState(1);
  const [entity, setEntity] = useState("company");
  const [fields, setFields] = useState(null);
  const [texts, setTexts] = useState({});
  const [addresses, setAddresses] = useState({});
  const [files, setFiles] = useState({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getNumberRequirements("GB", "local").then((r) => setFields(r.fields)).catch((err) => setError(err.message));
  }, []);

  const pickFile = (id, file) => {
    if (!file) return;
    if (!["application/pdf", "image/jpeg", "image/png"].includes(file.type)) return setError(`${file.name}: upload a PDF, JPG or PNG.`);
    if (file.size > 10 * 1024 * 1024) return setError(`${file.name}: files must be 10 MB or smaller.`);
    setError("");
    setFiles({ ...files, [id]: file });
  };

  const missing = (fields || []).filter((f) =>
    f.type === "document" ? !files[f.id] : f.type === "address" ? !(addresses[f.id]?.street_address && addresses[f.id]?.locality && addresses[f.id]?.postal_code) : !String(texts[f.id] || "").trim());

  const submit = async () => {
    if (missing.length) return setError(`Still needed: ${missing.map((m) => m.name).join(", ")}.`);
    setBusy(true);
    setError("");
    try {
      const addr = Object.fromEntries(Object.entries(addresses).map(([k, a]) => [k, { ...a, country_code: "GB" }]));
      await api.submitVerification({ entityType: entity, texts, addresses: addr, files });
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const setAddr = (id, key, value) => setAddresses({ ...addresses, [id]: { ...(addresses[id] || {}), [key]: value } });

  return (
    <div style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div style={h2}>Tell us about your business</div>
        <span style={{ fontSize: 12, color: C.slate }}>Step {step} of 2</span>
      </div>
      <p style={sub}>To switch your number on, we check who will use it. This usually takes up to 3 days.</p>

      {step === 1 && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {[["company", "Company", Building2, "Registered company: certificate of incorporation"], ["sole_trader", "Sole trader", User, "Passport or photo ID"]].map(([key, name, Icon, hint]) => (
              <button key={key} type="button" onClick={() => setEntity(key)}
                style={{ textAlign: "left", padding: 14, borderRadius: 12, cursor: "pointer", border: `2px solid ${entity === key ? C.cobalt : C.border}`, background: entity === key ? C.cobaltSoft : "#fff" }}>
                <Icon size={18} color={entity === key ? C.cobalt : C.slate} />
                <div style={{ fontWeight: 700, fontSize: 14, color: C.textInk, marginTop: 6 }}>{name}</div>
                <div style={{ fontSize: 12, color: C.slate, marginTop: 2 }}>{hint}, plus a utility bill under 3 months old</div>
              </button>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
            <button type="button" style={btn(false)} onClick={onCancel}>Cancel</button>
            <button type="button" style={btn(true)} onClick={() => setStep(2)}>Continue</button>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          {!fields && !error && <div style={{ fontSize: 13, color: C.slate, display: "flex", gap: 6, alignItems: "center" }}><Loader2 size={14} className="nx-spin" /> Loading the form…</div>}
          <div style={{ display: "grid", gap: 14 }}>
            {(fields || []).map((f) => (
              <div key={f.id}>
                <label style={label} htmlFor={`req-${f.id}`}>{f.name}</label>
                {f.description && <div style={{ fontSize: 12, color: C.slate, margin: "-2px 0 6px" }}>{f.description}</div>}
                {f.type === "document" ? (
                  <label style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 10, border: `1.5px dashed ${files[f.id] ? C.teal : C.border}`, cursor: "pointer", background: files[f.id] ? C.tealSoft : "#FAFAF8" }}>
                    <FileUp size={16} color={files[f.id] ? C.teal : C.slate} />
                    <span style={{ fontSize: 13, color: C.textInk }}>{files[f.id] ? files[f.id].name : "Choose a PDF, JPG or PNG (max 10 MB)"}</span>
                    <input id={`req-${f.id}`} type="file" accept="application/pdf,image/jpeg,image/png" style={{ display: "none" }} onChange={(e) => pickFile(f.id, e.target.files?.[0])} />
                  </label>
                ) : f.type === "address" ? (
                  <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 8 }}>
                    <input id={`req-${f.id}`} aria-label={`${f.name} street`} placeholder="Street address" style={input} value={addresses[f.id]?.street_address || ""} onChange={(e) => setAddr(f.id, "street_address", e.target.value)} />
                    <input aria-label={`${f.name} town`} placeholder="Town / city" style={input} value={addresses[f.id]?.locality || ""} onChange={(e) => setAddr(f.id, "locality", e.target.value)} />
                    <input aria-label={`${f.name} postcode`} placeholder="Postcode" style={input} value={addresses[f.id]?.postal_code || ""} onChange={(e) => setAddr(f.id, "postal_code", e.target.value.toUpperCase())} />
                    <input aria-label={`${f.name} business name`} placeholder="Business name on the bill" style={{ ...input, gridColumn: "1 / -1" }} value={addresses[f.id]?.business_name || ""} onChange={(e) => setAddr(f.id, "business_name", e.target.value)} />
                  </div>
                ) : (
                  <input id={`req-${f.id}`} type={f.type === "date" ? "date" : "text"} placeholder={f.example || ""} style={input}
                    value={texts[f.id] || ""} onChange={(e) => setTexts({ ...texts, [f.id]: e.target.value })} />
                )}
              </div>
            ))}
          </div>
          {error && <div role="alert" style={{ marginTop: 12, fontSize: 13, color: C.red }}>{error}</div>}
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 18 }}>
            <button type="button" style={btn(false)} onClick={() => setStep(1)}>Back</button>
            <button type="button" style={btn(true, busy || !fields)} disabled={busy || !fields} onClick={submit}>
              {busy ? <><Loader2 size={14} className="nx-spin" /> Sending…</> : "Submit for review"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function BuyNumber({ verified, hasVerification, onOrdered }) {
  const [q, setQ] = useState({ locality: "", area: "" });
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const search = async (e) => {
    e?.preventDefault();
    setBusy("search");
    setError("");
    try {
      setResults(await api.searchNumbers({ locality: q.locality, areaCode: q.area }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  };

  const buy = async (n) => {
    const price = Number(n.monthlyCredits || 0) > 0 ? ` It costs ${numberPrice(n).toLowerCase()} from your Voice credits.` : "";
    if (!window.confirm(`Buy ${n.phoneNumber}?${price}`)) return;
    setBusy(n.phoneNumber);
    setError("");
    try {
      await api.orderNumber(n);
      onOrdered();
      setResults(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  };

  return (
    <div style={card}>
      <div style={h2}>Get a UK number</div>
      <p style={sub}>{verified ? "Search by town or area code." : "Type the town or area code you want. You will tell us about your business next, then your number is set up."}</p>
      <form onSubmit={search} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: "2 1 180px" }}>
          <MapPin size={14} color={C.slateLight} style={{ position: "absolute", left: 11, top: 11 }} />
          <input aria-label="Town or city" placeholder="Town or city, e.g. London" value={q.locality} onChange={(e) => setQ({ ...q, locality: e.target.value })} style={{ ...input, paddingLeft: 30 }} />
        </div>
        <input aria-label="Area code" placeholder="Area code, e.g. 20" value={q.area} onChange={(e) => setQ({ ...q, area: e.target.value.replace(/\D/g, "") })} style={{ ...input, flex: "1 1 100px" }} />
        <button type="submit" style={btn(true, busy === "search")} disabled={busy === "search"}>
          {busy === "search" ? <Loader2 size={14} className="nx-spin" /> : <Search size={14} />} Search
        </button>
      </form>
      {error && <div role="alert" style={{ marginTop: 10, fontSize: 13, color: C.red }}>{error}</div>}
      {results && (
        <div style={{ marginTop: 14, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
          {results.length === 0 && <div style={{ padding: 14, fontSize: 13, color: C.slate }}>No numbers there right now. Try a nearby town or leave the area code empty.</div>}
          {results.map((n) => (
            <div key={n.phoneNumber} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 12, alignItems: "center", padding: "10px 14px", borderTop: `1px solid ${C.border}` }}>
              <div>
                <div style={{ fontFamily: FONT_MONO, fontSize: 14, fontWeight: 600 }}>{n.phoneNumber}</div>
                <div style={{ fontSize: 12, color: C.slate }}>{n.region || "UK"}{n.features?.length ? ` · ${n.features.join(", ")}` : ""}</div>
              </div>
              <div style={{ fontSize: 12.5, color: C.slate, textAlign: "right" }}>{numberPrice(n)}
                {n.telnyxMonthlyCost != null && <><br /><span title="What Telnyx charges us (only Outreach staff see this)">Telnyx: {n.telnyxMonthlyCost} {n.telnyxCurrency}/mo</span></>}
              </div>
              {verified ? (
                <button type="button" style={btn(true, Boolean(busy))} disabled={Boolean(busy)} onClick={() => buy(n)} title="Buy this number">
                  {busy === n.phoneNumber ? <Loader2 size={14} className="nx-spin" /> : <ShoppingCart size={14} />} Buy
                </button>
              ) : (
                <button type="button" style={btn(true, hasVerification)} disabled={hasVerification}
                  title={hasVerification ? "You can buy a number as soon as your business details are approved" : "Next: tell us about your business"}
                  onClick={() => document.getElementById("business-details")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
                  {hasVerification ? "Awaiting approval" : "Continue"}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const AVAILABLE_COUNTRIES = [
  { code: "GB", name: "United Kingdom (+44)" },
  { code: "US", name: "United States (+1)" },
  { code: "CA", name: "Canada (+1)" },
  { code: "AU", name: "Australia (+61)" },
  { code: "IE", name: "Ireland (+353)" },
  { code: "DE", name: "Germany (+49)" },
  { code: "FR", name: "France (+33)" },
  { code: "ES", name: "Spain (+34)" },
  { code: "IT", name: "Italy (+39)" },
  { code: "NL", name: "Netherlands (+31)" },
];

function AllowedCountriesCard({ initialCountries, onSaved }) {
  const [countries, setCountries] = useState(initialCountries || ["GB"]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const toggle = (code) => {
    setCountries((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  };

  const save = async () => {
    setSaving(true);
    setMsg("");
    try {
      await api.setAllowedCountries(countries.length ? countries : ["GB"]);
      setMsg("Allowed destination countries saved.");
      if (onSaved) onSaved();
    } catch (err) {
      setMsg(err.message || "Failed to save countries.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={card}>
      <div style={h2}>Outbound call destinations</div>
      <div style={sub}>Choose which countries your assistants and agents are permitted to call.</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        {AVAILABLE_COUNTRIES.map((c) => {
          const checked = countries.includes(c.code);
          return (
            <button
              key={c.code}
              type="button"
              onClick={() => toggle(c.code)}
              style={{
                ...btn(checked),
                padding: "6px 12px",
                fontSize: 12.5,
                borderRadius: 8,
                background: checked ? C.ink : "#fff",
                color: checked ? "#fff" : C.textInk,
                borderColor: checked ? C.ink : C.border,
              }}
            >
              {checked ? "✓ " : "+ "}{c.name}
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button type="button" style={btn(true)} disabled={saving} onClick={save}>
          {saving ? "Saving…" : "Save allowed destinations"}
        </button>
        {msg && <span style={{ fontSize: 13, color: msg.includes("Failed") ? C.red : C.teal }}>{msg}</span>}
      </div>
    </div>
  );
}

export function NumbersPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [wa, setWa] = useState(null);
  const [wizard, setWizard] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.getNumbersOverview());
      setError("");
      api.getWaStatus().then(setWa).catch(() => {});
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30000); // picks up Telnyx decisions while the page is open
    return () => clearInterval(t);
  }, [load]);

  if (error && !data) return <div style={{ color: C.red, fontSize: 13 }}>{error}</div>;
  if (!data) return <div style={{ color: C.slate, fontSize: 13 }}>Loading…</div>;

  const v = data.verification;
  const verified = v?.status === "approved";
  const pendingOrders = data.orders.filter((o) => o.status === "pending");
  const failedOrders = data.orders.filter((o) => o.status === "failure").slice(0, 3);
  const active = data.numbers.filter((n) => n.status !== "released");
  const signups = Object.fromEntries((wa?.numbers || []).map((x) => [x.id, x.signup]));

  // Opened before the request so the browser does not block it as a pop-up.
  const turnOnWhatsapp = async (n) => {
    const win = wa?.automatic ? window.open("", "_blank") : null;
    try {
      const r = await api.requestWhatsapp(n.id);
      if (r.signup?.url && win) win.location.href = r.signup.url;
      else if (win) win.close();
      setNote(r.live ? `WhatsApp is on for ${n.e164}.`
        : r.signup ? "Finish the WhatsApp signup in the new tab: log in with Facebook, enter your business name and pick this number. WhatsApp switches on here by itself once it is approved."
          : `WhatsApp asked for ${n.e164}. We will contact you to finish the business check, then it switches on.`);
      load();
    } catch (err) {
      if (win) win.close();
      setError(err.message);
    }
  };

  return (
    <div style={{ maxWidth: 900, display: "grid", gap: 16, fontFamily: FONT_BODY }}>
      <style>{"@keyframes nxSpin{to{transform:rotate(360deg)}} .nx-spin{animation:nxSpin 1s linear infinite}"}</style>
      <div>
        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 22, color: C.ink }}>Phone numbers</div>
        <div style={{ fontSize: 13.5, color: C.slate }}>Your own numbers for AI calls and WhatsApp.</div>
      </div>
      {note && !error && <div style={{ ...card, background: C.tealSoft, fontSize: 13, color: C.ink }}>{note}</div>}

      {!data.platformReady && (
        <div style={{ ...card, background: "#FFF8EB", borderColor: "#F3D9A4", fontSize: 13.5, color: "#7A5200" }}>
          Buying numbers is not switched on yet. The Outreach team is setting this up; the form to upload your documents appears here once it is.
          Meanwhile you can get the documents below ready.
        </div>
      )}
      {active.length === 0 && <HowToGetANumber price={data.price} />}
      {data.account.status === "error" && data.account.error && (
        <div style={{ ...card, background: C.redSoft, borderColor: "#F0C4B8", fontSize: 13, color: C.red }}>{data.account.error}</div>
      )}

      {data.platformReady && <BuyNumber verified={verified} hasVerification={Boolean(v)} onOrdered={load} />}

      <div id="business-details">
        {data.platformReady && (wizard || !v) ? (
          <VerificationWizard onCancel={() => setWizard(false)} onDone={() => { setWizard(false); load(); }} />
        ) : v ? (
          <Tracker v={v} onRedo={() => setWizard(true)} />
        ) : null}
      </div>

      {data.platformReady && <AllowedCountriesCard initialCountries={data.allowedCountries} onSaved={load} />}

      {(pendingOrders.length > 0 || failedOrders.length > 0) && (
        <div style={card}>
          <div style={h2}>Orders</div>
          {pendingOrders.map((o) => (
            <div key={o.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, padding: "6px 0" }}>
              <Loader2 size={14} className="nx-spin" color={C.cobalt} /> <span style={{ fontFamily: FONT_MONO }}>{o.phoneNumber}</span> — being set up
            </div>
          ))}
          {failedOrders.map((o) => (
            <div key={o.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, padding: "6px 0", color: C.red }}>
              <XCircle size={14} /> <span style={{ fontFamily: FONT_MONO }}>{o.phoneNumber}</span> — {o.error || "order failed"}
            </div>
          ))}
        </div>
      )}

      <div style={card}>
        <div style={h2}>Your numbers</div>
        {active.length === 0 ? (
          <p style={{ ...sub, margin: 0 }}>No numbers yet.</p>
        ) : (
          active.map((n) => (
            <div key={n.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 0", borderTop: `1px solid ${C.border}`, flexWrap: "wrap" }}>
              <Phone size={15} color={C.cobalt} />
              <span style={{ fontFamily: FONT_MONO, fontWeight: 600, fontSize: 14 }}>{n.e164}</span>
              {n.isDefault && <span style={{ fontSize: 11, fontWeight: 700, color: C.cobalt, background: C.cobaltSoft, padding: "2px 8px", borderRadius: 99 }}>Default caller ID</span>}
              {n.capabilities.includes("whatsapp") && <span style={{ fontSize: 11, fontWeight: 700, color: C.teal, background: C.tealSoft, padding: "2px 8px", borderRadius: 99 }}>WhatsApp</span>}
              {n.capabilities.includes("whatsapp_requested") && <span title={signups[n.id] ? "Waiting for the WhatsApp signup to finish." : "The Outreach team will contact you to finish the WhatsApp business check for this number."} style={{ fontSize: 11, fontWeight: 700, color: "#7A5200", background: "#FFF3D6", padding: "2px 8px", borderRadius: 99 }}>WhatsApp being set up</span>}
              {signups[n.id]?.status === "failed" && <span title={signups[n.id].error} style={{ fontSize: 11, fontWeight: 700, color: C.red, background: C.redSoft, padding: "2px 8px", borderRadius: 99 }}>WhatsApp signup failed</span>}
              <span style={{ flex: 1 }} />
              {!n.capabilities.includes("whatsapp") && !n.capabilities.includes("whatsapp_requested") && (
                <button type="button" style={btn(false)} onClick={() => turnOnWhatsapp(n)}>
                  {signups[n.id]?.status === "failed" ? "Try WhatsApp again" : "Turn on WhatsApp"}
                </button>
              )}
              {(n.capabilities.includes("whatsapp") || n.capabilities.includes("whatsapp_requested")) && (
                <button type="button" style={btn(false)} onClick={async () => {
                  const live = n.capabilities.includes("whatsapp");
                  if (live && !window.confirm(`Turn off WhatsApp on ${n.e164}? Messages to it will not show in Outreach until you turn it on again.`)) return;
                  try { await api.whatsappOff(n.id); setNote(live ? `WhatsApp is off for ${n.e164}.` : "WhatsApp request cancelled."); load(); } catch (err) { setError(err.message); }
                }}>{n.capabilities.includes("whatsapp") ? "Turn off WhatsApp" : "Cancel request"}</button>
              )}
              {n.provider === "telnyx" && (
                <button type="button" style={{ ...btn(false), color: C.red }} onClick={async () => {
                  if (!window.confirm(`Release ${n.e164}? You lose the number and it cannot be undone.`)) return;
                  try { await api.releaseNumber(n.id); load(); } catch (err) { setError(err.message); }
                }}>Release</button>
              )}
              {n.capabilities.includes("whatsapp_requested") && signups[n.id] && (
                <div style={{ flexBasis: "100%", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: 12.5, color: C.slate, paddingLeft: 27 }}>
                  {signups[n.id].url
                    ? <a href={signups[n.id].url} target="_blank" rel="noopener noreferrer" style={{ color: C.cobalt, fontWeight: 600 }}>Continue WhatsApp signup</a>
                    : signups[n.id].expired ? <span>The signup link ran out. Cancel and turn WhatsApp on again for a new one.</span>
                      : <span>Signup sent to WhatsApp. We check every few minutes.</span>}
                  {signups[n.id].code && <span>WhatsApp code sent to this number: <b style={{ fontFamily: FONT_MONO, color: C.ink }}>{signups[n.id].code}</b></span>}
                  <button type="button" style={btn(false)} onClick={async () => {
                    try {
                      const r = await api.checkWhatsapp(n.id);
                      setNote(r.live ? `WhatsApp is on for ${n.e164}.` : "Not live yet. WhatsApp is still checking; this page updates by itself.");
                      load();
                    } catch (err) { setError(err.message); }
                  }}>Check now</button>
                </div>
              )}
              {/* Not the self-service Meta signup flow (no Telnyx Tech Provider app configured
                  on this platform): there is no link, code or "Check now" to show, so without this
                  the row gives no explanation at all once the one-time toast has gone. */}
              {n.capabilities.includes("whatsapp_requested") && !signups[n.id] && (
                <div style={{ flexBasis: "100%", fontSize: 12.5, color: C.slate, paddingLeft: 27 }}>
                  The OutReach team completes the WhatsApp business check for this number by hand — there is nothing more to do here. We will contact you once it is live.
                </div>
              )}
            </div>
          ))
        )}
        {error && data && <div role="alert" style={{ marginTop: 10, fontSize: 13, color: C.red }}>{error}</div>}
      </div>
    </div>
  );
}
