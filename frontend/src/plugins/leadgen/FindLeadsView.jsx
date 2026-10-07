import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, BadgeCheck, Check, ChevronDown, ExternalLink, FileSpreadsheet, Globe, Plus, RefreshCw, Search, Sparkles, Users } from "lucide-react";
import { C, FONT_BODY } from "../../tokens";
import { api } from "../../api/apiClient";
import { domainOf, ImportView } from "./AccountsViews";

const text = { fontFamily: FONT_BODY };
const muted = { ...text, fontSize: 13, color: C.slate, lineHeight: 1.5 };

const SIZE_OPTIONS = [["micro", "Micro"], ["small", "Small"], ["medium_large", "Medium / large"], ["dormant", "Dormant"]];
const SIZE_LABEL = Object.fromEntries(SIZE_OPTIONS);
const EMPTY_FORM = { sector: "", town: "", postcode: "", sizes: [], minAge: "", maxAge: "", includeClosed: false, hasWebsite: false, hasPhone: false, hasEmail: false, category: "" };
const IDEAS = [
  ["Cafes in London", { sector: "cafe, restaurant", town: "London" }],
  ["Accountants in Leeds", { sector: "accounting, bookkeeping", town: "Leeds" }],
  ["Small construction firms in Manchester", { sector: "construction, building", town: "Manchester", sizes: ["micro", "small"] }],
  ["Established dental practices", { sector: "dental", minAge: "10" }],
];

const splitList = (v) => String(v || "").split(",").map((s) => s.trim()).filter(Boolean);
const num = (v) => (v === "" || v == null || Number.isNaN(Number(v)) ? undefined : Number(v));

// The filter panel and the chat are the same search: the panel's fields become this filter object,
// and a chat reply's filters are written back into the panel -- so neither can drift from the other.
function formToFilters(f) {
  const out = {};
  if (splitList(f.sector).length) out.sector = splitList(f.sector);
  if (splitList(f.town).length) out.towns = splitList(f.town);
  if (splitList(f.postcode).length) out.postcode_prefixes = splitList(f.postcode);
  if (f.sizes.length) out.size_bands = f.sizes;
  if (num(f.minAge) !== undefined) out.min_age_years = num(f.minAge);
  if (num(f.maxAge) !== undefined) out.max_age_years = num(f.maxAge);
  if (f.includeClosed) out.status = "any";
  if (f.category.trim()) out.company_category = f.category.trim();
  if (f.hasWebsite) out.has_website = true;
  if (f.hasPhone) out.has_phone = true;
  if (f.hasEmail) out.has_email = true;
  return out;
}

function filtersToForm(fl) {
  return {
    sector: (fl.sector || []).join(", "), town: (fl.towns || []).map((t) => t.replace(/\b\w/g, (m) => m.toUpperCase())).join(", "),
    postcode: (fl.postcode_prefixes || []).join(", "), sizes: fl.size_bands || [],
    minAge: fl.min_age_years != null ? String(fl.min_age_years) : "", maxAge: fl.max_age_years != null ? String(fl.max_age_years) : "",
    includeClosed: String(fl.status || "").toLowerCase() === "any", category: fl.company_category || "",
    hasWebsite: !!fl.has_website, hasPhone: !!fl.has_phone, hasEmail: !!fl.has_email,
  };
}

function TierBadge({ tier }) {
  const verified = tier === "verified_registry";
  return (
    <span title={verified ? "Read from an official registry record" : tier === "scraped" ? "Collected from a website" : "Found by a web search, not verified"}
      style={{ ...text, fontSize: 11.5, display: "inline-flex", alignItems: "center", gap: 3, color: verified ? C.green : C.slate }}>
      {verified ? <BadgeCheck size={12} /> : <Globe size={12} />} {verified ? "Registry" : tier === "scraped" ? "Website" : "Web (unverified)"}
    </span>
  );
}

function asAccount(c) {
  const notes = [c.registration_number && `Reg no. ${c.registration_number}`, c.status, c.sic_text, c.postcode].filter(Boolean).join(" · ");
  return { name: c.name, website: c.website || "", phone: c.phone || "", email: c.email || "", industry: c.industry || "", region: c.region || "", notes, source: "scout", business_record_id: c.id };
}

// One company's contacts on demand. Registry officers are verified and free; the web lookup is a
// separate, labelled step; an email is found for one named person at a time (1 credit, only when found).
function ContactsPanel({ company }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [domain, setDomain] = useState("");
  const [emails, setEmails] = useState({});

  const load = async (includeWeb) => {
    setBusy(true);
    setError("");
    try {
      const r = await api.companyContacts(company.id, { include_web: includeWeb });
      setData(r);
      setDomain((d) => d || domainOf(r.web?.website || "") || domainOf(r.stored?.website || ""));
    } catch (e) {
      setError(e.message || "Couldn't load contacts.");
    } finally {
      setBusy(false);
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(false); }, [company.id]);

  const findEmail = async (o) => {
    const key = o.name;
    setEmails((m) => ({ ...m, [key]: { busy: true } }));
    try {
      const r = await api.emailFind({ first_name: o.first_name, last_name: o.last_name, company_name: company.name, domain });
      setEmails((m) => ({ ...m, [key]: r.found ? { email: r.email, status: r.verification_status } : { none: true } }));
    } catch (e) {
      setEmails((m) => ({ ...m, [key]: { error: e.message || "Couldn't look that up." } }));
    }
  };

  return (
    <div style={{ marginTop: 10, padding: 12, background: C.bgSoft || "#F7F8FA", borderRadius: 8, display: "flex", flexDirection: "column", gap: 10 }}>
      {error ? <div role="alert" style={{ ...muted, color: C.red }}>{error}</div> : null}
      {!data && busy ? <div style={muted}>Reading the registry…</div> : null}
      {data ? (
        <>
          <div>
            <div style={{ ...text, fontSize: 12.5, fontWeight: 600, color: C.ink, display: "flex", alignItems: "center", gap: 6 }}>
              <Users size={13} /> People on the registry <span style={{ fontWeight: 400, color: C.green }}>(verified)</span>
            </div>
            {data.officers.length ? data.officers.map((o) => {
              const e = emails[o.name] || {};
              return (
                <div key={o.name} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "6px 0", borderBottom: `1px solid ${C.borderLight}` }}>
                  <span style={{ ...text, fontSize: 13, flex: "1 1 200px" }}>{o.first_name} {o.last_name} <span style={{ color: C.slate }}>· {o.role || "Officer"}</span></span>
                  {e.email ? <span style={{ ...text, fontSize: 12.5, color: C.green }}>{e.email} ({e.status})</span>
                    : e.none ? <span style={{ ...muted, fontSize: 12.5 }}>No verified email found. Nothing charged.</span>
                    : e.error ? <span style={{ ...muted, fontSize: 12.5, color: C.red }}>{e.error}</span>
                    : <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" disabled={!domain || e.busy} onClick={() => findEmail(o)}>
                        {e.busy ? <RefreshCw size={13} className="ui-spin" /> : null} Find email · 1 credit if found
                      </button>}
                </div>
              );
            }) : <div style={{ ...muted, fontSize: 12.5 }}>{data.officers_note || "No current officers listed."}</div>}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              <span style={{ ...muted, fontSize: 12.5 }}>Company website (needed to find an email):</span>
              <input className="ui-input" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="example.co.uk" style={{ height: 30, width: 200 }} aria-label="Company website domain" />
            </div>
          </div>
          <div>
            <div style={{ ...text, fontSize: 12.5, fontWeight: 600, color: C.ink }}>Contact details</div>
            {data.stored.website || data.stored.phone || data.stored.email ? (
              <div style={{ ...muted, fontSize: 12.5 }}>{[data.stored.website, data.stored.phone, data.stored.email].filter(Boolean).join(" · ")} <TierBadge tier={data.stored.tier} /></div>
            ) : <div style={{ ...muted, fontSize: 12.5 }}>The registry doesn't publish a website, phone or email for this company.</div>}
            {data.web ? (
              data.web.found === false ? <div style={{ ...muted, fontSize: 12.5, marginTop: 4 }}>The web lookup found nothing public. Nothing charged.</div> : (
                <div style={{ ...muted, fontSize: 12.5, marginTop: 4 }}>
                  <span style={{ color: C.slate }}>From a web search (not verified, check before use): </span>
                  {[data.web.website, ...(data.web.phones || []), ...(data.web.emails || [])].filter(Boolean).join(" · ") || "no details"}
                  {(data.web.team || []).map((t) => <div key={t.name}>{t.name}{t.title ? `, ${t.title}` : ""}{t.email ? ` · ${t.email}` : ""}</div>)}
                </div>
              )
            ) : (
              <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" disabled={busy} onClick={() => load(true)} style={{ marginTop: 4 }}>
                {busy ? <RefreshCw size={13} className="ui-spin" /> : <Globe size={13} />} Look for website &amp; phone on the web · 1 credit if found
              </button>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

function CompanyRow({ c, saved, onSave, onRemove, last }) {
  const [open, setOpen] = useState(false);
  const d = domainOf(c.website);
  return (
    <div style={{ padding: "12px 16px", borderBottom: last ? "none" : `1px solid ${C.borderLight}` }}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ ...text, fontSize: 14, fontWeight: 600, color: C.ink, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {c.name} <TierBadge tier={c.tier} />
          </div>
          <div style={{ ...muted, fontSize: 12.5, marginTop: 2 }}>
            {[c.industry, c.region && `${c.region}${c.postcode ? ` ${c.postcode}` : ""}`, c.status, c.company_category].filter(Boolean).join(" · ")}
          </div>
          <div style={{ ...muted, fontSize: 12, display: "flex", gap: 10, flexWrap: "wrap", marginTop: 2 }}>
            {c.registration_number ? <span>No. {c.registration_number}</span> : null}
            {c.incorporation_date ? <span>Incorporated {c.incorporation_date}</span> : null}
            {c.size_band && c.size_band !== "unknown" ? <span title="From the company's filed accounts category, not headcount">Size (accounts): {SIZE_LABEL[c.size_band] || c.size_band}</span> : null}
            {d ? <a href={c.website.startsWith("http") ? c.website : `https://${c.website}`} target="_blank" rel="noreferrer" style={{ color: C.slate, display: "inline-flex", alignItems: "center", gap: 3 }}>{d} <ExternalLink size={11} /></a> : null}
            {c.phone ? <span style={{ fontVariantNumeric: "tabular-nums" }}>{c.phone}</span> : null}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            <Users size={14} /> Contacts <ChevronDown size={13} style={{ transform: open ? "rotate(180deg)" : "none" }} />
          </button>
          {saved ? (
            <span style={{ ...text, fontSize: 12.5, color: C.green, display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}><Check size={14} /> Saved</span>
          ) : (
            <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={() => onSave(c)}><Plus size={14} /> Save</button>
          )}
          <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => onRemove(c)} aria-label={`Remove ${c.name} from this list`} title="Remove from this list">×</button>
        </div>
      </div>
      {open ? <ContactsPanel company={c} /> : null}
    </div>
  );
}

function FindLeadsSearch({ store }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [applied, setApplied] = useState({});
  const [chips, setChips] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [total, setTotal] = useState(0);
  const [capped, setCapped] = useState(false);
  const [excluded, setExcluded] = useState([]);
  const [searched, setSearched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [web, setWeb] = useState({ open: false, query: "", busy: false, error: "", results: [] });

  const [chat, setChat] = useState([
    { id: "m_init", role: "assistant", text: "Set filters above, or just tell me who you're after, like \"small accountants in Leeds that have been trading 5+ years\". I use the same filters, so what I find and what you see always match. Say \"remove X\" to drop a company." },
  ]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const scrollRef = useRef(null);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollIntoView({ block: "nearest" });
  }, [chat.length, chatBusy]);

  const savedKeys = useMemo(() => new Set(store.accounts.flatMap((a) => [a.business_record_id, a.domain, a.name.toLowerCase()]).filter(Boolean)), [store.accounts]);
  const isSaved = (c) => {
    const d = domainOf(c.website);
    return savedKeys.has(c.id) || (d ? savedKeys.has(d) : savedKeys.has(String(c.name || "").toLowerCase()));
  };
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const toggleSize = (s) => setForm((f) => ({ ...f, sizes: f.sizes.includes(s) ? f.sizes.filter((x) => x !== s) : [...f.sizes, s] }));

  const search = async (e, overrideForm, offset = 0) => {
    if (e) e.preventDefault();
    const f = overrideForm || form;
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await api.searchCompanies({ filters: formToFilters(f), limit: 25, offset, exclude_ids: excluded });
      setCompanies((prev) => (offset ? [...prev, ...r.companies] : r.companies));
      setTotal(r.total);
      setCapped(r.total_capped);
      setApplied(r.filters);
      setChips(r.chips || []);
      setSearched(true);
    } catch (err) {
      setError(err.message || "The search didn't finish. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const runIdea = (patch) => {
    const f = { ...EMPTY_FORM, ...patch };
    setForm(f);
    setExcluded([]);
    search(null, f);
  };

  const removeCompany = (c) => {
    setExcluded((ex) => [...ex, c.id]);
    setCompanies((prev) => prev.filter((x) => x.id !== c.id));
    setTotal((t) => Math.max(0, t - 1));
  };

  const saveOne = (c) => store.save([asAccount(c)]);
  const unsaved = companies.filter((c) => !isSaved(c));

  const sendChat = async (e) => {
    if (e) e.preventDefault();
    const message = chatInput.trim();
    if (!message || chatBusy) return;
    setChatInput("");
    setChat((prev) => [...prev, { id: "m_" + Date.now(), role: "user", text: message }]);
    setChatBusy(true);
    try {
      const res = await api.copilotChat({
        message, history: chat.map((m) => ({ role: m.role, content: m.text })), plugin: "leadgen",
        filters: applied, exclude_ids: excluded,
      });
      if (res?.registry) {
        setCompanies(res.registry.companies);
        setTotal(res.registry.total);
        setCapped(res.registry.total_capped);
        setApplied(res.registry.filters);
        setChips(res.registry.chips || []);
        setForm(filtersToForm(res.registry.filters));
        setSearched(true);
      }
      if (res?.removed_names?.length) {
        const gone = res.removed_names.map((n) => n.toLowerCase());
        const hit = companies.filter((c) => gone.some((n) => c.name.toLowerCase().includes(n)));
        setExcluded((ex) => [...ex, ...hit.map((c) => c.id)]);
        setCompanies((prev) => prev.filter((c) => !hit.includes(c)));
        setTotal((t) => Math.max(0, t - hit.length));
      }
      setChat((prev) => [...prev, { id: "m_" + (Date.now() + 1), role: "assistant", text: res?.reply || "I processed your request. How else can I help?" }]);
    } catch (err) {
      setChat((prev) => [...prev, {
        id: "m_" + (Date.now() + 1), role: "assistant",
        text: /credits/i.test(err.message || "") ? err.message : `Couldn't reach the AI: ${err.message || "no answer from the AI service."} Try again in a moment.`,
      }]);
    } finally {
      setChatBusy(false);
      setTimeout(() => scrollRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    }
  };

  const runWeb = async (e) => {
    if (e) e.preventDefault();
    const q = web.query.trim();
    if (!q || web.busy) return;
    setWeb((w) => ({ ...w, busy: true, error: "" }));
    try {
      const r = await api.discoverAccounts({ query: q });
      setWeb((w) => ({ ...w, busy: false, results: r.leads || [], error: (r.leads || []).length ? "" : `Nothing found on the web for "${q}". Nothing was charged.` }));
    } catch (err) {
      setWeb((w) => ({ ...w, busy: false, error: err.message || "The web search didn't finish." }));
    }
  };

  const field = { display: "flex", flexDirection: "column", gap: 4, flex: "1 1 180px", minWidth: 0 };
  const label = { ...text, fontSize: 12, fontWeight: 600, color: C.slate };
  const check = (k, t) => (
    <label style={{ ...text, fontSize: 13, display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
      <input type="checkbox" checked={form[k]} onChange={(e) => setField(k, e.target.checked)} /> {t}
    </label>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <form onSubmit={(e) => { setExcluded([]); search(e); }} className="ui-card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <label style={field}><span style={label}>Industry (words from the official sector)</span>
            <input className="ui-input" value={form.sector} onChange={(e) => setField("sector", e.target.value)} placeholder="cafe, restaurant" /></label>
          <label style={field}><span style={label}>Town / city</span>
            <input className="ui-input" value={form.town} onChange={(e) => setField("town", e.target.value)} placeholder="London, Leeds" /></label>
          <label style={{ ...field, flex: "0 1 150px" }}><span style={label}>Postcode starts with</span>
            <input className="ui-input" value={form.postcode} onChange={(e) => setField("postcode", e.target.value)} placeholder="EC1, M1" /></label>
        </div>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ ...field, flex: "1 1 260px" }}>
            <span style={label} title="From each company's filed accounts category. It is not a headcount.">Size (from filed accounts)</span>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {SIZE_OPTIONS.map(([id, name]) => (
                <button key={id} type="button" className={`ui-chip${form.sizes.includes(id) ? " is-active" : ""}`} aria-pressed={form.sizes.includes(id)} onClick={() => toggleSize(id)}
                  style={form.sizes.includes(id) ? { background: "var(--ui-accent-soft)", color: "var(--ui-accent-ink)" } : undefined}>{name}</button>
              ))}
            </div>
          </div>
          <label style={{ ...field, flex: "0 1 110px" }}><span style={label}>Trading ≥ years</span>
            <input className="ui-input" inputMode="numeric" value={form.minAge} onChange={(e) => setField("minAge", e.target.value)} placeholder="5" /></label>
          <label style={{ ...field, flex: "0 1 110px" }}><span style={label}>Trading ≤ years</span>
            <input className="ui-input" inputMode="numeric" value={form.maxAge} onChange={(e) => setField("maxAge", e.target.value)} placeholder="2" /></label>
          <label style={{ ...field, flex: "0 1 190px" }}><span style={label}>Company type</span>
            <input className="ui-input" value={form.category} onChange={(e) => setField("category", e.target.value)} placeholder="Limited, LLP, PLC" /></label>
        </div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
          {check("hasWebsite", "Has a website")}{check("hasPhone", "Has a phone")}{check("hasEmail", "Has an email")}{check("includeClosed", "Include closed / dissolved")}
          <button type="submit" className="ui-btn ui-btn--primary" disabled={busy} style={{ height: 40, marginLeft: "auto" }}>
            {busy ? <RefreshCw size={15} className="ui-spin" /> : <Search size={15} />} {busy ? "Searching…" : "Find companies"}
          </button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span style={{ ...muted, fontSize: 12.5 }}>Try</span>
          {IDEAS.map(([name, patch]) => (
            <button key={name} type="button" className="ui-chip" disabled={busy} onClick={() => runIdea(patch)} style={{ padding: "5px 9px" }}>{name}</button>
          ))}
        </div>
        <div style={{ ...muted, fontSize: 12.5 }}>Searches the official company registry we hold. Free, and only active companies unless you tick "Include closed". Credits are used only when you look up contacts.</div>
      </form>

      {error ? <div role="alert" style={{ ...muted, color: C.red }}>{error}</div> : null}

      {searched ? (
        <div className="ui-card" style={{ overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", borderBottom: `1px solid ${C.border}`, flexWrap: "wrap" }}>
            <div style={{ ...text, fontSize: 13.5, fontWeight: 600, color: C.ink, marginRight: "auto" }}>
              {total.toLocaleString()}{capped ? "+" : ""} {total === 1 ? "company matches" : "companies match"}
              <span style={{ fontWeight: 400, color: C.slate }}> · showing {companies.length}</span>
            </div>
            <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" disabled={!unsaved.length} onClick={() => store.save(unsaved.map(asAccount))}>
              <Plus size={14} /> {unsaved.length ? `Save all ${unsaved.length}` : "All saved"}
            </button>
          </div>
          {chips.length ? (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", padding: "8px 16px", borderBottom: `1px solid ${C.borderLight}` }}>
              {chips.map((c) => <span key={c} className="ui-chip" style={{ cursor: "default" }}>{c}</span>)}
            </div>
          ) : null}
          {companies.length ? companies.map((c, i) => (
            <CompanyRow key={c.id} c={c} saved={isSaved(c)} onSave={saveOne} onRemove={removeCompany} last={i === companies.length - 1} />
          )) : (
            <div style={{ ...muted, padding: 16 }}>No companies match these filters. Try a wider town, a broader industry word, or tick "Include closed".</div>
          )}
          {companies.length < total ? (
            <div style={{ padding: 12, textAlign: "center" }}>
              <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" disabled={busy} onClick={() => search(null, form, companies.length)}>Show more</button>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="ui-card" style={{ display: "flex", flexDirection: "column", height: 360, overflow: "hidden" }}>
        <div style={{ padding: "10px 14px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 8 }}>
          <Sparkles size={14} color="#8B5CF6" />
          <span style={{ ...text, fontSize: 12.5, fontWeight: 600, color: C.ink }}>Ask the AI: it uses the same filters as the panel</span>
        </div>
        <div className="ui-scroll" style={{ flex: 1, overflowY: "auto", padding: "14px 14px 6px", display: "flex", flexDirection: "column", gap: 12 }}>
          {chat.map((m) => (
            <div key={m.id} style={m.role === "user"
              ? { alignSelf: "flex-end", maxWidth: "80%", background: "var(--ui-accent-soft)", color: "var(--ui-accent-ink)", padding: "8px 12px", borderRadius: 8, ...text, fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }
              : { maxWidth: "90%" }}>
              {m.role === "user" ? m.text : (
                <div style={{ ...text, fontSize: 13, lineHeight: 1.55, color: C.textInk, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{m.text}</div>
              )}
            </div>
          ))}
          {chatBusy ? <div style={{ ...muted, fontSize: 12.5 }}>Thinking…</div> : null}
          <div ref={scrollRef} />
        </div>
        <form onSubmit={sendChat} style={{ padding: 10, borderTop: `1px solid ${C.border}`, display: "flex", gap: 8 }}>
          <input value={chatInput} onChange={(e) => setChatInput(e.target.value)} placeholder="e.g. only ones in Leeds, or remove Corner Cafe, or include closed ones"
            aria-label="Message the AI" className="ui-input" style={{ flex: 1 }} />
          <button type="submit" className="ui-btn ui-btn--primary" disabled={!chatInput.trim() || chatBusy} style={{ width: 36, padding: 0 }} aria-label="Send">
            <ArrowUp size={15} />
          </button>
        </form>
      </div>

      <div className="ui-card" style={{ padding: 16 }}>
        <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => setWeb((w) => ({ ...w, open: !w.open }))} aria-expanded={web.open}>
          <Globe size={14} /> Not in the registry? Search the open web instead <ChevronDown size={13} style={{ transform: web.open ? "rotate(180deg)" : "none" }} />
        </button>
        {web.open ? (
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
            <form onSubmit={runWeb} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input className="ui-input" value={web.query} onChange={(e) => setWeb((w) => ({ ...w, query: e.target.value }))} placeholder="A type of business and a place, like dental practices in Leeds" style={{ flex: "1 1 280px" }} aria-label="Web search" />
              <button type="submit" className="ui-btn ui-btn--secondary" disabled={web.busy || !web.query.trim()}>
                {web.busy ? <RefreshCw size={15} className="ui-spin" /> : <Search size={15} />} {web.busy ? "Searching the web…" : "Search the web"}
              </button>
            </form>
            <div style={{ ...muted, fontSize: 12.5 }}>Web results are unverified and each one found uses 1 Leads credit. Registry results above are the reliable ones.</div>
            {web.error ? <div role="alert" style={{ ...muted, color: C.red }}>{web.error}</div> : null}
            {web.results.map((r, i) => {
              const d = domainOf(r.site || r.website || r.domain || "");
              const acct = { name: r.name, website: r.site || r.website || "", phone: r.phone || "", notes: r.snippet || "", source: "scout", source_url: r.sourceUrl || r.source_url || "" };
              const done = savedKeys.has(d) || savedKeys.has(String(r.name || "").toLowerCase());
              return (
                <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "8px 0", borderTop: `1px solid ${C.borderLight}` }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ ...text, fontSize: 14, fontWeight: 600, color: C.ink }}>{r.name} <TierBadge tier="llm_fallback" /></div>
                    <div style={{ ...muted, fontSize: 12.5 }}>{d || "No website found"}{r.phone ? ` · ${r.phone}` : ""}</div>
                  </div>
                  {done ? <span style={{ ...text, fontSize: 12.5, color: C.green }}><Check size={14} /> Saved</span>
                    : <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={() => store.save([acct])}><Plus size={14} /> Save</button>}
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}

const SUB_TABS = [
  ["search", "Find Leads", Sparkles],
  ["import", "Import", FileSpreadsheet],
];

export function FindLeadsView({ store, onGo }) {
  const [sub, setSub] = useState("search");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {SUB_TABS.map(([id, label, Icon]) => (
          <button key={id} type="button" onClick={() => setSub(id)}
            className={`ui-btn ui-btn--sm ${sub === id ? "ui-btn--primary" : "ui-btn--ghost"}`}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>
      {sub === "search" && <FindLeadsSearch store={store} />}
      {sub === "import" && <ImportView store={store} onGo={onGo} />}
    </div>
  );
}
