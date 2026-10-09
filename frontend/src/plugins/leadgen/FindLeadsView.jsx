import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, BadgeCheck, Check, ChevronDown, ExternalLink, FileSpreadsheet, Globe, List, Map as MapIcon, Plus, RefreshCw, Search, Sparkles, Users, X } from "lucide-react";
import { C, FONT_BODY } from "../../tokens";
import { api } from "../../api/apiClient";
import { domainOf, ImportView } from "./AccountsViews";
import { LeadsMap } from "./LeadsMap";
import { amountChoices, PAGE_SIZES, typedAmount } from "./drawShape";

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
  // One box for industry words and company names: each word is matched against both.
  if (splitList(f.sector).length) out.keyword = splitList(f.sector);
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

// What the user asked for, in a few words ("accounting, bookkeeping · Leeds"), for the status card.
function appliedWords(f) {
  return [f.sector, f.town, f.postcode ? `postcode ${f.postcode}` : ""].map((s) => String(s || "").trim()).filter(Boolean).join(" · ");
}

function filtersToForm(fl) {
  return {
    sector: [...(fl.keyword || []), ...(fl.sector || [])].join(", "), town: (fl.towns || []).map((t) => t.replace(/\b\w/g, (m) => m.toUpperCase())).join(", "),
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

  const [view, setView] = useState("list");
  const [area, setArea] = useState(null); // a polygon drawn on the map: [[lat, lng], ...]
  const [points, setPoints] = useState({}); // company id -> [lat, lng]
  const asked = useRef(new Set());
  // A drawn area is counted first, the user picks how many to see, then the companies are placed in steps.
  const [areaStep, setAreaStep] = useState(null); // null | {phase: counting|choose|running|done, ...}
  const stopArea = useRef(false);
  const [custom, setCustom] = useState(""); // a number typed as "how many"
  // How many companies the list loads at a time; remembered in the browser.
  const [pageSize, setPageSize] = useState(() => {
    try { const n = Number(localStorage.getItem("aivhub_find_page_size")); return PAGE_SIZES.includes(n) ? n : 25; } catch { return 25; }
  });
  const pageRef = useRef(pageSize);
  // How the typed words were read ("dentist" also looks for "dental"), and the words the user took out.
  const [understood, setUnderstood] = useState([]);
  const [dropTerms, setDropTerms] = useState([]);
  const dropFor = useRef("");

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

  // Map pins: look up the points for whatever is on screen, once per company.
  useEffect(() => {
    if (view !== "map") return;
    const need = companies.map((c) => c.id).filter((id) => !asked.current.has(id));
    if (!need.length) return;
    need.forEach((id) => asked.current.add(id));
    (async () => {
      for (let i = 0; i < need.length; i += 200) {
        try {
          const r = await api.geocodeCompanies(need.slice(i, i + 200));
          setPoints((p) => ({ ...p, ...(r.points || {}) }));
        } catch { need.slice(i, i + 200).forEach((id) => asked.current.delete(id)); }
      }
    })();
  }, [view, companies]);

  const search = async (e, overrideForm, offset = 0, areaOverride, dropOverride) => {
    if (e) e.preventDefault();
    const f = overrideForm || form;
    const shape = areaOverride !== undefined ? areaOverride : area;
    if (busy) return;
    // New words start with a fresh reading; removing a word from the reading keeps the others as they are.
    let drop = dropOverride;
    if (drop === undefined) {
      drop = f.sector === dropFor.current ? dropTerms : [];
      if (drop !== dropTerms) setDropTerms(drop);
    }
    dropFor.current = f.sector;
    if (shape) { countArea(shape, f, drop); return; }
    setBusy(true);
    setError("");
    try {
      const r = await api.searchCompanies({ filters: formToFilters(f), limit: pageRef.current, offset, exclude_ids: excluded, drop_terms: drop });
      if (r.points) setPoints((p) => ({ ...p, ...r.points }));
      setCompanies((prev) => (offset ? [...prev, ...r.companies] : r.companies));
      setTotal(r.total);
      setCapped(r.total_capped);
      setApplied(r.filters);
      setChips(r.chips || []);
      setUnderstood(r.understood || []);
      setSearched(true);
    } catch (err) {
      setError(err.message || "The search didn't finish. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const changePageSize = (n) => {
    pageRef.current = n;
    setPageSize(n);
    try { localStorage.setItem("aivhub_find_page_size", String(n)); } catch { /* the choice just isn't remembered */ }
    if (searched && !area && !busy) search(null, form, 0, null); // reload the list at the new size
  };

  const dropTerm = (term) => {
    const next = [...dropTerms, term];
    setDropTerms(next);
    search(null, form, 0, undefined, next);
  };

  const runIdea = (patch) => {
    const f = { ...EMPTY_FORM, ...patch };
    setForm(f);
    setExcluded([]);
    setArea(null);
    search(null, f, 0, null);
  };

  // Step 1: how many companies could be in the area. Free and quick.
  const countArea = async (shape, f = form, drop = dropTerms) => {
    stopArea.current = true;
    setError("");
    setAreaStep({ phase: "counting" });
    try {
      const r = await api.areaCount({ filters: formToFilters(f), area: shape, drop_terms: drop });
      setAreaStep({ phase: "choose", candidates: r.candidates, capped: r.capped });
    } catch (err) {
      setAreaStep(null);
      setError(err.message || "The area couldn't be counted. Try again.");
    }
  };

  // Step 2: read the area in steps until there are as many as the user asked for (or none are left).
  const showFromArea = async (shape, target, candidates) => {
    stopArea.current = false;
    const got = [];
    let scan = 0;
    let more = true;
    let lastChips = [];
    let lastFilters = applied;
    setCompanies([]);
    setTotal(0);
    setSearched(true);
    try {
      while (more && !stopArea.current && got.length < target) {
        setAreaStep({ phase: "running", found: got.length, scanned: scan, candidates });
        const r = await api.searchCompanies({ filters: formToFilters(form), area: shape, scan, exclude_ids: excluded, drop_terms: dropTerms });
        if (stopArea.current) break;
        if (r.points) setPoints((p) => ({ ...p, ...r.points }));
        got.push(...r.companies);
        setCompanies(got.slice(0, target));
        setTotal(Math.min(got.length, target));
        lastChips = r.chips || lastChips;
        if (r.understood) setUnderstood(r.understood);
        lastFilters = r.filters || lastFilters;
        more = r.next_scan != null;
        scan = r.next_scan ?? scan;
      }
      const shown = got.slice(0, target);
      setCompanies(shown);
      setTotal(shown.length);
      setCapped(false);
      setApplied(lastFilters);
      setChips(lastChips);
      setAreaStep({ phase: "done", shown: shown.length, more: more || got.length > target, candidates });
    } catch (err) {
      setError(err.message || "The search didn't finish. Try again.");
      setAreaStep({ phase: "done", shown: got.length, more: true, candidates, stopped: true });
    }
  };

  const drawArea = (shape) => {
    setArea(shape);
    setExcluded([]);
    setCompanies([]);
    setTotal(0);
    countArea(shape, form);
  };
  const clearArea = () => {
    stopArea.current = true;
    setAreaStep(null);
    setArea(null);
    setExcluded([]);
    if (Object.keys(formToFilters(form)).some((k) => ["keyword", "towns", "postcode_prefixes"].includes(k))) search(null, form, 0, null);
    else { setCompanies([]); setTotal(0); setChips([]); }
  };

  const removeCompany = (c) => {
    setExcluded((ex) => [...ex, c.id]);
    setCompanies((prev) => prev.filter((x) => x.id !== c.id));
    setTotal((t) => Math.max(0, t - 1));
  };

  // A drawn area is being counted or waiting for the user to pick an amount: nothing has been searched yet,
  // so the screen must not claim "0 companies" or "no companies match".
  const inArea = Boolean(area && areaStep);
  const areaPending = inArea && (areaStep.phase === "counting" || areaStep.phase === "choose") && !companies.length;
  const pickAmount = (n) => showFromArea(area, n, areaStep.candidates);
  const pinCount = companies.filter((c) => points[c.id]).length;
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
        stopArea.current = true;
        setAreaStep(null);
        setUnderstood([]);
        setDropTerms([]);
        setArea(null); // the chat runs its own search, so a drawn area no longer applies
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
          <label style={field}><span style={label}>Industry or company name</span>
            <input className="ui-input" value={form.sector} onChange={(e) => setField("sector", e.target.value)} placeholder="cafe, restaurant, or a company name" /></label>
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
          <button type="button" className="ui-btn ui-btn--secondary" style={{ height: 40, marginLeft: "auto" }} onClick={() => setView("map")}>
            <MapIcon size={15} /> Search on map
          </button>
          <button type="submit" className="ui-btn ui-btn--primary" disabled={busy} style={{ height: 40 }}>
            {busy ? <RefreshCw size={15} className="ui-spin" /> : <Search size={15} />} {busy ? "Searching…" : "Find companies"}
          </button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span style={{ ...muted, fontSize: 12.5 }}>Try</span>
          {IDEAS.map(([name, patch]) => (
            <button key={name} type="button" className="ui-chip" disabled={busy} onClick={() => runIdea(patch)} style={{ padding: "5px 9px" }}>{name}</button>
          ))}
        </div>
        <div style={{ ...muted, fontSize: 12.5 }}>Searches the official company registry we hold. You can also draw an area on the map to see the companies inside it. Free, and only active companies unless you tick "Include closed". Credits are used only when you look up contacts.</div>
      </form>

      {error ? <div role="alert" style={{ ...muted, color: C.red }}>{error}</div> : null}

      {searched || view === "map" ? (
        <div className="ui-card" style={{ overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", borderBottom: `1px solid ${C.border}`, flexWrap: "wrap" }}>
            <div style={{ ...text, fontSize: 13.5, fontWeight: 600, color: C.ink, marginRight: "auto" }}>
              {areaPending ? (areaStep.phase === "counting" ? "Looking at your area…" : "Your area is ready") : (
                <>
                  {total.toLocaleString()}{capped ? "+" : ""} {total === 1 ? "company matches" : "companies match"}
                  <span style={{ fontWeight: 400, color: C.slate }}> · showing {companies.length}</span>
                </>
              )}
            </div>
            {!area ? (
              <label style={{ ...text, fontSize: 12.5, color: C.slate, display: "inline-flex", alignItems: "center", gap: 6 }}>
                Show
                <select className="ui-input" aria-label="Companies to load at a time" value={pageSize} disabled={busy}
                  onChange={(e) => changePageSize(Number(e.target.value))} style={{ height: 30, padding: "0 6px", width: "auto" }}>
                  {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
                at a time
              </label>
            ) : null}
            <div role="group" aria-label="Results view" style={{ display: "inline-flex", gap: 4 }}>
              {[["list", "List", List], ["map", "Map", MapIcon]].map(([id, name, Icon]) => (
                <button key={id} type="button" aria-pressed={view === id} onClick={() => setView(id)}
                  className={`ui-btn ui-btn--sm ${view === id ? "ui-btn--primary" : "ui-btn--ghost"}`}><Icon size={14} /> {name}</button>
              ))}
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
          {understood.length ? (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", padding: "8px 16px", borderBottom: `1px solid ${C.borderLight}` }}>
              <span style={{ ...muted, fontSize: 12.5 }}>Also looking for:</span>
              {understood.flatMap((u) => u.terms).map((t) => (
                <span key={t} className="ui-chip" style={{ cursor: "default", display: "inline-flex", alignItems: "center", gap: 4 }}>
                  {t}
                  <button type="button" aria-label={`Stop looking for ${t}`} disabled={busy} onClick={() => dropTerm(t)}
                    style={{ all: "unset", cursor: "pointer", display: "inline-flex", color: C.slate }}><X size={12} /></button>
                </span>
              ))}
            </div>
          ) : null}
          {view === "map" ? (
            <div style={{ padding: 12 }}>
              <LeadsMap companies={companies} points={points} area={area} busy={busy} onArea={drawArea} onClear={clearArea} />
              {areaStep && area ? (
                <div className="ui-card" role="status" style={{ marginTop: 10, padding: "10px 14px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  {areaStep.phase === "counting" ? (
                    <div style={{ display: "flex", gap: 10, alignItems: "center", width: "100%" }}>
                      <RefreshCw size={18} className="ui-spin" color={C.slate} />
                      <div>
                        <div style={{ ...text, fontSize: 13.5, fontWeight: 600, color: C.ink }}>Counting the companies inside your area…</div>
                        <div style={{ ...muted, fontSize: 12.5 }}>
                          {[appliedWords(form), "inside the shape you drew"].filter(Boolean).join(" · ")}. This takes a few seconds and costs nothing.
                        </div>
                      </div>
                    </div>
                  ) : null}
                  {areaStep.phase === "choose" ? (
                    areaStep.candidates ? (
                      <>
                        <span style={{ ...text, fontSize: 13, color: C.textInk, marginRight: "auto" }}>
                          Up to <strong>{areaStep.candidates.toLocaleString()}{areaStep.capped ? "+" : ""}</strong> companies are in this area. How many do you want to see?
                        </span>
                        {amountChoices(areaStep.candidates).map((o) => (
                          <button key={String(o.value)} type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={() => pickAmount(o.value)}>{o.label}</button>
                        ))}
                        <form onSubmit={(e) => { e.preventDefault(); const n = typedAmount(custom, areaStep.candidates); if (n) pickAmount(n); }}
                          style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                          <input className="ui-input" inputMode="numeric" aria-label="Type how many to see" placeholder="Or type a number" value={custom}
                            onChange={(e) => setCustom(e.target.value)} style={{ width: 130, height: 30 }} />
                          <button type="submit" className="ui-btn ui-btn--primary ui-btn--sm" disabled={!typedAmount(custom, areaStep.candidates)}>Show</button>
                        </form>
                      </>
                    ) : <span style={muted}>Nothing found inside this area. Our data covers the UK, so draw over a UK town or a few postcodes, or use "Redraw area" for a bigger area or fewer filters.</span>
                  ) : null}
                  {areaStep.phase === "running" ? (
                    <>
                      <span style={{ ...muted, marginRight: "auto" }}>Placing companies on the map…{areaStep.found ? ` ${areaStep.found.toLocaleString()} so far.` : ""}</span>
                      <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => { stopArea.current = true; }}>Stop</button>
                    </>
                  ) : null}
                  {areaStep.phase === "done" ? (
                    <>
                      <span style={{ ...text, fontSize: 13, color: C.textInk, marginRight: "auto" }}>
                        {areaStep.shown
                          ? `Showing ${areaStep.shown.toLocaleString()}${areaStep.candidates ? ` of up to ${areaStep.candidates.toLocaleString()}` : ""} companies in this area · ${pinCount.toLocaleString()} on the map.`
                          : "No companies from our data are inside this exact shape."}
                      </span>
                      {areaStep.candidates ? <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={() => setAreaStep({ phase: "choose", candidates: areaStep.candidates })}>Change how many</button> : null}
                    </>
                  ) : null}
                </div>
              ) : null}
              <div style={{ ...muted, fontSize: 12.5, marginTop: 8 }}>
                {companies.some((c) => !points[c.id]) && busy === false && asked.current.size
                  ? "Companies without a usable postcode aren't on the map; they're still in the List view." : "Pins are placed at each company's registered postcode."}
              </div>
            </div>
          ) : null}
          {companies.length ? companies.map((c, i) => (
            <CompanyRow key={c.id} c={c} saved={isSaved(c)} onSave={saveOne} onRemove={removeCompany} last={i === companies.length - 1} />
          )) : searched && !inArea ? (
            <div style={{ ...muted, padding: 16 }}>No companies match these filters. Try a wider town, a broader industry word, or tick "Include closed".</div>
          ) : null}
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
      {sub === "import" && <ImportView store={store} onGo={onGo} onAskAi={() => setSub("search")} />}
    </div>
  );
}
