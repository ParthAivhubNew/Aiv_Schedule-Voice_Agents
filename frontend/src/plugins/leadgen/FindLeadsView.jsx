import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, ArrowUp, BadgeCheck, Check, ChevronDown, Clock, ExternalLink, FileSpreadsheet, Globe, List, Map as MapIcon, Plus, RefreshCw, RotateCcw, Trash2, Search, SlidersHorizontal, Sparkles, Users, X } from "lucide-react";
import { C, FONT_BODY } from "../../tokens";
import { api } from "../../api/apiClient";
import { domainOf, ImportView } from "./AccountsViews";
import { LeadsMap } from "./LeadsMap";
import { amountChoices, PAGE_SIZES, typedAmount } from "./drawShape";
import { SearchStatus, useHold } from "./SearchStatus";
import { creditWord, useLeadCredits } from "./CreditsChip";
import { askConfirm, askText } from "./Dialogs";
import { CallButton, useCallDialog } from "./CallFlow";
import { PaneSwitch } from "../../components/PaneSwitch";
import { useConnection } from "../../hooks/useConnections";

const FAVOURITES = "Favourites";
const CHAT_INTRO = { id: "m_init", role: "assistant", text: "Tell me who you're after, like \"small accountants in Leeds that have been trading 5+ years\". I use the same filters as the Filters panel, so what I find and what you see always match. Say \"remove X\" to drop a company." };
const CHECK_TIPS = {
  hasWebsite: "Only companies we already hold a website for",
  hasPhone: "Only companies we already hold a phone number for",
  hasEmail: "Only companies we already hold an email for",
  includeClosed: "Also show companies that have closed or been dissolved",
};
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

const when = (at) => new Date(at).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

// The chat styles: the thread opens downward from the box and each message slides up into place.
const CHAT_CSS = `
.fl-thread{max-height:0;padding:0 14px;overflow:hidden;border-top:0 solid transparent;transition:max-height .45s cubic-bezier(.2,.8,.2,1),padding .3s ease}
.fl-thread[data-open="true"]{max-height:min(430px,56vh);padding:12px 14px;overflow-y:auto;border-top:1px solid var(--ui-border,#E3E6EF)}
.fl-msg{animation:flIn .28s ease both}
@keyframes flIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
.fl-hist{position:absolute;right:10px;top:46px;z-index:20;width:min(360px,calc(100% - 20px));background:#fff;border:1px solid var(--ui-border,#E3E6EF);border-radius:12px;box-shadow:0 12px 32px rgba(20,24,40,.16);animation:flIn .18s ease both}
@media (prefers-reduced-motion:reduce){.fl-thread{transition:none}.fl-msg,.fl-hist{animation:none}}
`;

// A reply can use **bold** and "- " bullets; show them as formatting, not as asterisks.
function ChatText({ body }) {
  const inline = (line) => line.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (/^\*\*[^*]+\*\*$/.test(part) ? <strong key={i}>{part.slice(2, -2)}</strong> : part));
  return (
    <div style={{ ...text, fontSize: 13, lineHeight: 1.55, color: C.textInk, overflowWrap: "anywhere", display: "flex", flexDirection: "column", gap: 3 }}>
      {String(body || "").split("\n").map((line, i) => {
        if (/^\s*[-•]\s+/.test(line)) {
          return <div key={i} style={{ display: "flex", gap: 8, paddingLeft: 4 }}><span aria-hidden="true">•</span><span>{inline(line.replace(/^\s*[-•]\s+/, ""))}</span></div>;
        }
        return line.trim() ? <div key={i}>{inline(line)}</div> : <div key={i} style={{ height: 6 }} />;
      })}
    </div>
  );
}

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
function WebRow({ label, children }) {
  return (
    <div style={{ display: "flex", gap: 10, fontSize: 12.5, ...text, color: C.textInk, alignItems: "baseline" }}>
      <span style={{ width: 56, flexShrink: 0, color: C.slate }}>{label}</span>
      <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{children}</span>
    </div>
  );
}

function ContactsPanel({ company }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [domain, setDomain] = useState("");
  const [emails, setEmails] = useState({});

  const load = async (includeWeb, findSiteOnly = false) => {
    setBusy(true);
    setError("");
    try {
      const r = await api.companyContacts(company.id, { include_web: includeWeb, find_site_only: findSiteOnly });
      setData(r);
      const found = domainOf(r.web?.website || "") || domainOf(r.stored?.website || "");
      setDomain((d) => d || found);
      return found;
    } catch (e) {
      setError(e.message || "Couldn't load contacts.");
      return "";
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
      // The company's website is our job to find, not the user's: look it up first when it isn't known yet.
      let site = domain;
      if (!site) site = await load(true, true);
      if (!site) { setEmails((m) => ({ ...m, [key]: { nosite: true } })); return; }
      const r = await api.emailFind({ first_name: o.first_name, last_name: o.last_name, company_name: company.name, domain: site });
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
                    : e.none ? <span style={{ ...muted, fontSize: 12.5 }}>No email found for this person at that website. Nothing charged.</span>
                    : e.nosite ? <span style={{ ...muted, fontSize: 12.5 }}>We couldn't find this company's website, so there's nowhere to look for an email. Nothing charged.</span>
                    : e.error ? <span style={{ ...muted, fontSize: 12.5, color: C.red }}>{e.error}</span>
                    : <button type="button" title="Look for this person's work email. 1 Leads credit only if one is found" className="ui-btn ui-btn--secondary ui-btn--sm" disabled={e.busy} onClick={() => findEmail(o)}>
                        {e.busy ? <RefreshCw size={13} className="ui-spin" /> : null} Find email · 1 credit if found
                      </button>}
                </div>
              );
            }) : <div style={{ ...muted, fontSize: 12.5 }}>{data.officers_note || "No current officers listed."}</div>}
            {domain ? <div style={{ ...muted, fontSize: 12.5, marginTop: 8 }}>Looking for emails on {domain}.</div> : null}
          </div>
          <div>
            <div style={{ ...text, fontSize: 12.5, fontWeight: 600, color: C.ink }}>Contact details</div>
            {data.stored.website || data.stored.phone || data.stored.email ? (
              <div style={{ ...muted, fontSize: 12.5 }}>{[data.stored.website, data.stored.phone, data.stored.email].filter(Boolean).join(" · ")} <TierBadge tier={data.stored.tier} /></div>
            ) : <div style={{ ...muted, fontSize: 12.5 }}>The registry doesn't publish a website, phone or email for this company.</div>}
            {data.web ? (
              data.web.found === false ? <div style={{ ...muted, fontSize: 12.5, marginTop: 4 }}>The web search found no website, phone or email we could tie to this company, so nothing is shown and nothing was charged.</div> : (
                <div style={{ marginTop: 8, padding: "8px 10px", border: `1px solid ${C.borderLight}`, borderRadius: 8, background: "#fff", display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ ...text, fontSize: 12, fontWeight: 600, color: C.slate, display: "flex", alignItems: "center", gap: 5 }}><Globe size={12} /> Found on the web · check before you use it</div>
                  {data.web.website ? <WebRow label="Website"><a href={/^https?:/.test(data.web.website) ? data.web.website : `https://${data.web.website}`} target="_blank" rel="noreferrer" style={{ color: C.cobalt }}>{domainOf(data.web.website) || data.web.website}</a></WebRow> : null}
                  {(data.web.phones || []).map((ph) => <WebRow key={ph} label="Phone"><a href={`tel:${ph.replace(/\s+/g, "")}`} style={{ color: C.textInk }}>{ph}</a></WebRow>)}
                  {(data.web.emails || []).map((em) => <WebRow key={em} label="Email"><a href={`mailto:${em}`} style={{ color: C.textInk }}>{em}</a></WebRow>)}
                  {(data.web.team || []).map((t) => <WebRow key={t.name} label="Team">{t.name}{t.title ? `, ${t.title}` : ""}{t.email ? <> · <a href={`mailto:${t.email}`} style={{ color: C.textInk }}>{t.email}</a></> : null}</WebRow>)}
                </div>
              )
            ) : (
              <button type="button" title="Search the web for this company's website and phone. 1 Leads credit only if something is found" className="ui-btn ui-btn--primary ui-btn--sm" disabled={busy} onClick={() => load(true)} style={{ marginTop: 8 }}>
                {busy ? <RefreshCw size={13} className="ui-spin" /> : <Globe size={13} />} Look for website &amp; phone on the web · 1 credit if found
              </button>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

function CompanyRow({ c, saved, onSave, onRemove, onCall, onCallLocked, last }) {
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
          <button title="Show the contacts found for this company" type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            <Users size={14} /> Contacts <ChevronDown size={13} style={{ transform: open ? "rotate(180deg)" : "none" }} />
          </button>
          {c.phone && onCall ? (
            <CallButton label="Save & call" lockedLabel="Call · add Voice" variant="ghost" title="Save it to your Unsorted list and have your AI caller phone them" onClick={() => onCall(c)} onLocked={() => onCallLocked?.(c)} />
          ) : null}
          {saved ? (
            <span style={{ ...text, fontSize: 12.5, color: C.green, display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}><Check size={14} /> Saved</span>
          ) : (
            <button title="Save this company to your Unsorted list" type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={() => onSave(c)}><Plus size={14} /> Save</button>
          )}
          <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => onRemove(c)} aria-label={`Remove ${c.name} from this list`} title="Remove from this list">×</button>
        </div>
      </div>
      {open ? <ContactsPanel company={c} /> : null}
    </div>
  );
}

// Under the Town box: once one town is typed, a dropdown of its postcode districts with how many companies
// each has. Ticking one adds it to "Postcode starts with". Only counts are shown here, never companies.
function DistrictPicker({ town, includeClosed, postcode, onChange }) {
  const [state, setState] = useState({ town: "", rows: [], busy: false, error: "" });
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const names = splitList(town);
  const one = names.length === 1 && names[0].length >= 3 ? names[0] : "";

  useEffect(() => {
    if (!one) { setState({ town: "", rows: [], busy: false, error: "" }); setOpen(false); return undefined; }
    let live = true;
    const timer = setTimeout(async () => {
      setState((s) => ({ ...s, busy: true, error: "" }));
      try {
        const r = await api.townDistricts(one, includeClosed);
        if (live) setState({ town: one, rows: r.districts || [], busy: false, error: "" });
      } catch (err) {
        if (live) setState({ town: one, rows: [], busy: false, error: err.message || "Couldn't list this town's areas." });
      }
    }, 600); // wait until the person has stopped typing
    return () => { live = false; clearTimeout(timer); };
  }, [one, includeClosed]);

  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    window.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); window.removeEventListener("keydown", esc); };
  }, [open]);

  if (!one) return null;
  const ticked = splitList(postcode).map((p) => p.toUpperCase());
  const set = (next) => onChange(next.join(", "));
  const toggle = (d) => set(ticked.includes(d) ? ticked.filter((x) => x !== d) : [...ticked, d]);
  if (state.busy || state.town !== one) return <span style={{ ...muted, fontSize: 12 }}>Looking up {one}'s postcode areas…</span>;
  if (state.error) return <span style={{ ...muted, fontSize: 12 }}>{state.error}</span>;
  if (!state.rows.length) return <span style={{ ...muted, fontSize: 12 }}>No postcode areas found for {one}. Check the spelling, or type a postcode.</span>;
  return (
    <div ref={box} style={{ position: "relative" }}>
      <button type="button" title="Show the people we hold for this company" className="ui-btn ui-btn--ghost ui-btn--sm" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <ChevronDown size={13} style={{ transform: open ? "rotate(180deg)" : "none" }} />
        {ticked.length ? `${ticked.length} postcode area${ticked.length === 1 ? "" : "s"} chosen` : `Choose postcode areas in ${one} (${state.rows.length})`}
      </button>
      {open ? (
        <div role="listbox" aria-label={`Postcode areas in ${one}`} className="ui-card"
          style={{ position: "absolute", left: 0, top: "calc(100% + 4px)", zIndex: 30, width: 280, maxHeight: 320, overflowY: "auto", padding: 8, boxShadow: "0 8px 24px rgba(0,0,0,.14)" }}>
          <div style={{ display: "flex", gap: 6, padding: "2px 4px 6px" }}>
            <button title="Tick every company shown" type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => set(state.rows.map((r) => r.district))}>Select all</button>
            <button title="Untick everything" type="button" className="ui-btn ui-btn--ghost ui-btn--sm" disabled={!ticked.length} onClick={() => set([])}>Clear</button>
          </div>
          {state.rows.map((r) => (
            <label key={r.district} style={{ ...text, fontSize: 13, display: "flex", alignItems: "center", gap: 8, padding: "5px 6px", cursor: "pointer" }}>
              <input type="checkbox" checked={ticked.includes(r.district)} onChange={() => toggle(r.district)} />
              <span style={{ fontWeight: 600 }}>{r.district}</span>
              <span style={{ marginLeft: "auto", color: C.slate, fontVariantNumeric: "tabular-nums" }}>{r.count.toLocaleString()} {r.count === 1 ? "company" : "companies"}</span>
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FindLeadsSearch({ store, listsStore }) {
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
  // Phones: which pane shows. Search holds the AI chat and the Filters drop-down; Results holds the companies.
  const [pane, setPane] = useState("chat");

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
  const AREA_FIRST = 50; // a drawn area first shows this many straight away; the user can ask for more
  const widenRef = useRef(false); // the drawn area's count found nothing for the typed words, so nearby words are used
  // How the typed words were read ("dentist" also looks for "dental"), and the words the user took out.
  const [understood, setUnderstood] = useState([]);
  const [dropTerms, setDropTerms] = useState([]);
  const dropFor = useRef("");
  // Every search can be cancelled: a newer run id makes the older one's answer be ignored when it arrives.
  const runId = useRef(0);
  const pausedRef = useRef(false);
  const [paused, setPaused] = useState(false);

  const [source, setSource] = useState("register"); // where this search looks: the company register, or the open web
  const webRate = useLeadCredits()?.rates?.lead_lookup?.credits;
  const [web, setWeb] = useState({ open: false, query: "", busy: false, error: "", results: [] });

  const [filtersOpen, setFiltersOpen] = useState(false);
  // The filters open under the chat; bring them into view so the tap shows something on a phone.
  const filtersRef = useRef(null);
  useEffect(() => {
    if (filtersOpen && filtersRef.current) filtersRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [filtersOpen]);
  // Map view: bring the map into view when it is chosen and whenever a search starts or finishes, so nobody scrolls to it each time.
  const mapRef = useRef(null);
  useEffect(() => {
    if (view === "map" && mapRef.current) mapRef.current.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [view, busy, area, areaStep?.phase]);
  const [chat, setChat] = useState(() => [CHAT_INTRO]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const chatRun = useRef(0);
  const chatCardRef = useRef(null);
  const threadRef = useRef(null);
  const [chatId, setChatId] = useState(() => `c_${Date.now()}`);
  const [history, setHistory] = useState([]);
  // Earlier chats live on the account, so they follow the person to any browser and nobody else can open them.
  useEffect(() => {
    let live = true;
    api.leadsChats().then((r) => { if (live) setHistory(r?.chats || []); }).catch(() => {});
    return () => { live = false; };
  }, []);
  const [historyOpen, setHistoryOpen] = useState(false);
  const chatStarted = chat.some((m) => m.role === "user") || chatBusy;
  // Newest message at the bottom, older ones roll up out of view, like any messenger.
  const rollToEnd = () => {
    const el = threadRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  };
  useEffect(() => { rollToEnd(); }, [chat.length, chatBusy]);
  // Every finished exchange is kept, so an earlier chat can be opened again from History.
  useEffect(() => {
    const first = chat.find((m) => m.role === "user");
    if (chatBusy || !first) return;
    const entry = { id: chatId, title: first.text.slice(0, 70), at: Date.now(), chat, filters: applied };
    setHistory((prev) => [entry, ...prev.filter((h) => h.id !== chatId)].slice(0, 30));
    api.saveLeadsChat(entry).catch(() => {}); // the chat on screen is unaffected if saving fails; it is tried again after the next reply
  }, [chat, chatBusy]); // eslint-disable-line react-hooks/exhaustive-deps
  const focusChat = () => setTimeout(() => chatCardRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }), 90);

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

  const searchHold = useHold();
  const countHold = useHold();
  const chatHold = useHold();
  const webHold = useHold();
  // Phones: a search shows its progress, then its companies or its error, on the Results pane.
  useEffect(() => {
    if (busy) setPane("results");
  }, [busy]);

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
    const myRun = ++runId.current;
    if (!offset) {
      // A new search never leaves the last one's companies, filters and words on screen: if it fails,
      // only the error shows, not results that belong to something else.
      setCompanies([]);
      setTotal(0);
      setCapped(false);
      setChips([]);
      setUnderstood([]);
    }
    let r;
    try {
      r = await api.searchCompanies({ filters: formToFilters(f), limit: pageRef.current, offset, exclude_ids: excluded, drop_terms: drop });
    } catch (err) {
      if (myRun === runId.current) searchHold.settle(() => { if (myRun !== runId.current) return; setError(err.message || "The search didn't finish. Try again."); setBusy(false); });
      return;
    }
    if (myRun !== runId.current) return; // cancelled while it was running
    // If the search was paused, its answer waits here until Resume.
    searchHold.settle(() => {
      if (myRun !== runId.current) return;
      if (r.points) setPoints((p) => ({ ...p, ...r.points }));
      setCompanies((prev) => (offset ? [...prev, ...r.companies] : r.companies));
      setTotal(r.total);
      setCapped(r.total_capped);
      setApplied(r.filters);
      setChips(r.chips || []);
      setUnderstood(r.understood || []);
      setSearched(true);
      setBusy(false);
    });
  };

  const cancelSearch = () => {
    runId.current += 1;
    searchHold.clear();
    setBusy(false);
    setSearched(true); // what was already on screen stays; nothing claims "0 companies" for a search that was stopped
  };
  // Back to a clean start: empty filters, no area, no results, nothing running.
  const resetSearch = () => {
    runId.current += 1;
    searchHold.clear();
    chatHold.clear();
    webHold.clear();
    stopArea.current = true;
    pausedRef.current = false;
    setPaused(false);
    setForm(EMPTY_FORM);
    setExcluded([]);
    setArea(null);
    setAreaStep(null);
    setCompanies([]);
    setTotal(0);
    setCapped(false);
    setChips([]);
    setUnderstood([]);
    setDropTerms([]);
    setSearched(false);
    setError("");
    setBusy(false);
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
    const myRun = ++runId.current;
    countHold.clear();
    try {
      const r = await api.areaCount({ filters: formToFilters(f), area: shape, drop_terms: drop });
      if (myRun !== runId.current) return;
      // If the count was paused, its answer waits here until Resume.
      countHold.settle(() => {
        if (myRun !== runId.current) return;
        widenRef.current = Boolean(r.widened);
        setUnderstood(r.understood || []);
        if (r.candidates) {
          showFromArea(shape, Math.min(AREA_FIRST, r.candidates), r.candidates, f, drop); // show a few at once, then offer more
        } else {
          setAreaStep({ phase: "choose", candidates: 0, capped: r.capped });
        }
      });
    } catch (err) {
      if (myRun !== runId.current) return;
      countHold.settle(() => {
        if (myRun !== runId.current) return;
        setAreaStep(null);
        setError(err.message || "The area couldn't be counted. Try again.");
      });
    }
  };

  // Step 2: read the area in steps until there are as many as the user asked for (or none are left).
  const showFromArea = async (shape, target, candidates, f = form, drop = dropTerms) => {
    stopArea.current = false;
    pausedRef.current = false;
    setPaused(false);
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
        while (pausedRef.current && !stopArea.current) await new Promise((r) => setTimeout(r, 300)); // paused: nothing new is read
        if (stopArea.current) break;
        setAreaStep({ phase: "running", found: got.length, scanned: scan, candidates, target });
        const r = await api.searchCompanies({ filters: formToFilters(f), area: shape, scan, exclude_ids: excluded, drop_terms: drop, widen: widenRef.current });
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
    runId.current += 1; // a count still on its way is ignored
    countHold.clear();
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
  const call = useCallDialog(store.toast);
  const { available: canCall } = useConnection("call_leads");
  // The saved copy of a search result, saving it first when it isn't saved yet. Calling needs a saved company
  // so the call, its result and any meeting stay with it.
  const savedCopy = async (c) => {
    const have = store.accounts.find((a) => (a.business_record_id && a.business_record_id === c.id) || (domainOf(c.website) && a.domain === domainOf(c.website)) || a.name.toLowerCase() === String(c.name || "").toLowerCase());
    if (have) return have;
    const r = await store.save([asAccount(c)], "Unsorted", { quiet: true });
    return r?.accounts?.[0] || null;
  };
  const callOne = async (c) => {
    const row = await savedCopy(c);
    if (!row) return;
    call.open({ kind: "one", id: row.id, name: row.name });
  };
  const callAll = async (list) => {
    const withPhone = list.filter((c) => c.phone);
    if (!withPhone.length) { store.toast("None of these companies has a phone number yet."); return; }
    const rows = [];
    for (const c of withPhone) {
      const row = await savedCopy(c);
      if (row) rows.push(row);
    }
    if (rows.length) call.open({ kind: "selected", ids: rows.map((r) => r.id), name: `${rows.length} companies from your search` });
  };
  // Favourites are an ordinary list called Favourites, so they can be enriched and emailed like any other.
  const favKeys = useMemo(() => {
    const fav = (listsStore?.lists || []).find((l) => l.name.toLowerCase() === FAVOURITES.toLowerCase());
    const ids = new Set(fav?.ids || []);
    return new Set(store.accounts.filter((a) => ids.has(a.id)).flatMap((a) => [a.business_record_id, a.domain, a.name.toLowerCase()]).filter(Boolean));
  }, [listsStore?.lists, store.accounts]);
  const isFavourite = (c) => {
    const d = domainOf(c.website);
    return favKeys.has(c.id) || (d ? favKeys.has(d) : favKeys.has(String(c.name || "").toLowerCase()));
  };
  const statusOf = (c) => ({ saved: isSaved(c), favourite: isFavourite(c) });
  const mapActions = {
    onSave: saveOne,
    onFavourite: (c) => store.save([asAccount(c)], FAVOURITES),
    onAddToList: async (c) => { const name = await askText({ title: `Add ${c.name} to a list`, label: "List name. Type a new name to start a new list.", initial: "Unsorted", confirm: "Add", maxLength: 80 }); if (name) store.save([asAccount(c)], name); },
    onRemove: removeCompany,
    onCall: (c) => (canCall ? callOne(c) : call.open({ kind: "one", id: "", name: c.name }, true)),
    callLocked: !canCall,
    // A note goes on the saved company (it is saved to Unsorted first if it isn't yet).
    onNote: async (c) => {
      const note = await askText({ title: `Note on ${c.name}`, label: "Your note", multiline: true, confirm: "Save note", maxLength: 1000 });
      if (!note) return;
      const have = store.accounts.find((a) => (a.business_record_id && a.business_record_id === c.id) || (domainOf(c.website) && a.domain === domainOf(c.website)) || a.name.toLowerCase() === String(c.name || "").toLowerCase());
      if (have) await store.update(have.id, { notes: [have.notes, note.trim()].filter(Boolean).join("\n") });
      else await store.save([{ ...asAccount(c), notes: [asAccount(c).notes, note.trim()].filter(Boolean).join("\n") }]);
    },
  };
  const unsaved = companies.filter((c) => !isSaved(c));

  const newChat = () => {
    chatRun.current += 1; chatHold.clear(); setChatBusy(false);
    setChat([CHAT_INTRO]); setChatInput(""); setChatId(`c_${Date.now()}`); setHistoryOpen(false);
  };
  const openChat = (h) => {
    chatRun.current += 1; chatHold.clear(); setChatBusy(false);
    setChatId(h.id); setChat(h.chat); setChatInput(""); setHistoryOpen(false);
    // Bring back the search that chat ended on, so the list under the chat matches what it says.
    if (h.filters && Object.keys(h.filters).length) {
      const f = filtersToForm(h.filters);
      setExcluded([]); setForm(f); search(null, f);
    }
    focusChat();
  };
  const forgetChat = (id) => { setHistory((prev) => prev.filter((h) => h.id !== id)); api.deleteLeadsChat(id).catch(() => {}); };

  const sendChat = async (e) => {
    if (e) e.preventDefault();
    const message = chatInput.trim();
    if (!message || chatBusy) return;
    setChatInput("");
    setChat((prev) => [...prev, { id: "m_" + Date.now(), role: "user", text: message }]);
    setChatBusy(true);
    focusChat();
    const mine = ++chatRun.current;
    let res = null;
    let failure = null;
    try {
      res = await api.copilotChat({
        message, history: chat.map((m) => ({ role: m.role, content: m.text })), plugin: "leadgen",
        filters: applied, exclude_ids: excluded,
      });
    } catch (err) { failure = err; }
    if (mine !== chatRun.current) return; // cancelled while the AI was working
    // If the chat was paused, the AI's answer waits until Resume.
    chatHold.settle(() => {
      if (mine !== chatRun.current) return;
      if (failure) {
        setChat((prev) => [...prev, {
          id: "m_" + (Date.now() + 1), role: "assistant",
          text: /credits/i.test(failure.message || "") ? failure.message : `Couldn't reach the AI: ${failure.message || "no answer from the AI service."} Try again in a moment.`,
        }]);
      } else {
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
        setChat((prev) => [...prev, { id: "m_" + (Date.now() + 1), role: "assistant", text: res?.reply || "I processed your request. How else can I help?", found: res?.registry ? res.registry.total : null }]);
      }
      setChatBusy(false);
    });
  };

  const webRun = useRef(0);
  const cancelWeb = () => { webRun.current += 1; webHold.clear(); setWeb((w) => ({ ...w, busy: false })); };
  const runWeb = async (e) => {
    if (e) e.preventDefault();
    const q = web.query.trim();
    if (!q || web.busy) return;
    setWeb((w) => ({ ...w, busy: true, error: "" }));
    const mine = ++webRun.current;
    let r = null;
    let failure = null;
    try { r = await api.discoverAccounts({ query: q }); } catch (err) { failure = err; }
    if (mine !== webRun.current) return;
    webHold.settle(() => {
      if (mine !== webRun.current) return;
      if (failure) setWeb((w) => ({ ...w, busy: false, error: failure.message || "The web search didn't finish." }));
      else setWeb((w) => ({ ...w, busy: false, results: r.leads || [], error: (r.leads || []).length ? "" : `Nothing found on the web for "${q}". Nothing was charged.` }));
    });
  };

  const filterCount = Object.keys(formToFilters(form)).length;
  const field = { display: "flex", flexDirection: "column", gap: 4, flex: "1 1 180px", minWidth: 0 };
  const label = { ...text, fontSize: 12, fontWeight: 600, color: C.slate };
  const check = (k, t) => (
    <label title={CHECK_TIPS[k]} style={{ ...text, fontSize: 13, display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
      <input type="checkbox" checked={form[k]} onChange={(e) => setField(k, e.target.checked)} /> {t}
    </label>
  );

  return (
    <div className="pane-root" data-active={source === "register" ? pane : "chat"} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {call.dialog}
      {source === "register" ? (
        <PaneSwitch value={pane} onChange={setPane}
          panes={[{ id: "chat", label: "Search" }, { id: "results", label: "Results", badge: searched && total ? total.toLocaleString() : "" }]} />
      ) : null}
      <div data-pane="chat" className="ui-card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
        <div role="tablist" aria-label="Where to search" style={{ display: "inline-flex", alignSelf: "flex-start", background: C.bgSoft || "#F4F5F9", border: `1px solid ${C.border}`, borderRadius: 10, padding: 3, gap: 3, flexWrap: "wrap" }}>
          {[["register", "Company register", "Free"], ["web", "Open web", webRate == null ? "" : `${creditWord(webRate)} per company found`]].map(([id, name, price]) => (
            <button key={id} type="button" role="tab" aria-selected={source === id} onClick={() => setSource(id)}
              title={id === "register" ? "Search the official company register. Free" : "Search public web pages and directories for businesses that are not in the register"}
              style={{ border: "none", cursor: "pointer", borderRadius: 7, padding: "7px 14px", fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, background: source === id ? "#fff" : "transparent", color: source === id ? C.ink : C.slate, boxShadow: source === id ? "0 1px 3px rgba(0,0,0,.12)" : "none" }}>
              {name}{price ? <span style={{ fontWeight: 500, color: price === "Free" ? "#15803D" : C.slate }}> · {price}</span> : null}
            </button>
          ))}
        </div>
        <div style={{ ...muted, fontSize: 12.5 }}>
          {source === "register"
            ? "The official register: reliable names, addresses, status and sector. Contact details are often missing, and you can fill them in later from Lists. Searching is free."
            : "Public web pages and directories: slower and unverified, but results usually come with a website and phone number. You only pay for companies that are found."}
        </div>
      </div>
      {source === "register" ? (<>
      <div data-pane="chat" ref={chatCardRef} className="ui-card" style={{ padding: 0, display: "flex", flexDirection: "column", position: "relative", scrollMarginTop: 12 }}>
        <style>{CHAT_CSS}</style>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px" }}>
          <Sparkles size={15} color="#8B5CF6" />
          <span style={{ ...text, fontSize: 13.5, fontWeight: 600, color: C.ink }}>Ask the AI</span>
          <span style={{ ...muted, fontSize: 12 }}>Searching is free</span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            {history.length ? (
              <button type="button" className={`ui-btn ui-btn--sm ${historyOpen ? "ui-btn--secondary" : "ui-btn--ghost"}`} aria-expanded={historyOpen}
                title="Open an earlier chat" onClick={() => setHistoryOpen((o) => !o)}><Clock size={13} /> History</button>
            ) : null}
            {chatStarted ? (
              <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" title="Start a new chat. This one is kept in History and your results stay as they are" onClick={newChat}><RotateCcw size={13} /> New chat</button>
            ) : null}
          </div>
        </div>
        {historyOpen ? (
          <div className="fl-hist" role="dialog" aria-label="Earlier chats">
            <div style={{ display: "flex", alignItems: "center", padding: "10px 12px", borderBottom: `1px solid ${C.borderLight}` }}>
              <span style={{ ...text, fontSize: 13, fontWeight: 600, color: C.ink }}>Earlier chats</span>
              <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" style={{ marginLeft: "auto" }} title="Close" aria-label="Close history" onClick={() => setHistoryOpen(false)}><X size={13} /></button>
            </div>
            <div className="ui-scroll" style={{ maxHeight: 300, overflowY: "auto" }}>
              {history.map((h) => (
                <div key={h.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 6px 4px 4px", background: h.id === chatId ? "var(--ui-accent-soft)" : "transparent" }}>
                  <button type="button" onClick={() => openChat(h)} title="Open this chat and bring back its search"
                    style={{ all: "unset", flex: 1, minWidth: 0, cursor: "pointer", padding: "7px 8px", borderRadius: 8 }}>
                    <div style={{ ...text, fontSize: 13, color: C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{h.title}</div>
                    <div style={{ ...muted, fontSize: 12 }}>{when(h.at)} · {h.chat.filter((m) => m.role === "user").length} message{h.chat.filter((m) => m.role === "user").length === 1 ? "" : "s"}</div>
                  </button>
                  <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" aria-label={`Delete the chat ${h.title}`} title="Delete this chat" onClick={() => forgetChat(h.id)}><Trash2 size={13} /></button>
                </div>
              ))}
            </div>
            <div style={{ ...muted, fontSize: 12, padding: "8px 12px", borderTop: `1px solid ${C.borderLight}` }}>Saved to your account. Only you can see them. Opening a chat searches again so the list matches it.</div>
          </div>
        ) : null}
        <div ref={threadRef} className="fl-thread ui-scroll" data-open={chatStarted ? "true" : "false"} onTransitionEnd={rollToEnd}>
          <div style={{ minHeight: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: 12 }}>
            {chat.filter((m) => m.id !== CHAT_INTRO.id).map((m) => (
              <div key={m.id} className="fl-msg" style={m.role === "user"
                ? { alignSelf: "flex-end", maxWidth: "80%", background: "var(--ui-accent-soft)", color: "var(--ui-accent-ink)", padding: "8px 12px", borderRadius: 8, ...text, fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }
                : { maxWidth: "92%" }}>
                {m.role === "user" ? m.text : <ChatText body={m.text} />}
              </div>
            ))}
            {chatBusy ? <SearchStatus title="The AI is working on it" detail="Reading your request, setting the filters and searching the registry. Nothing is charged for a search." paused={chatHold.paused} holding onPause={chatHold.pause} onResume={chatHold.resume} onCancel={() => { chatRun.current += 1; chatHold.clear(); setChatBusy(false); }} /> : null}
          </div>
        </div>
        <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10, borderTop: chatStarted ? `1px solid ${C.borderLight}` : "none" }}>
          <form onSubmit={sendChat} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ position: "relative", flex: "1 1 320px", minWidth: 0 }}>
              <Sparkles size={15} color="#8B5CF6" style={{ position: "absolute", left: 12, top: 13 }} />
              <input value={chatInput} onChange={(e) => setChatInput(e.target.value)} aria-label="Ask the AI who to find" className="ui-input"
                placeholder={chatStarted ? "Reply, or change the search" : 'Tell the AI who you are after, like "small accountants in Leeds trading 5+ years"'} style={{ width: "100%", height: 40, paddingLeft: 34 }}
                title="Say who you are after, or what to change. It sets the same filters as the Filters panel. Searching is free" />
            </div>
            <button type="submit" className="ui-btn ui-btn--primary" disabled={!chatInput.trim() || chatBusy} style={{ height: 40 }} title="Send to the AI">
              {chatBusy ? <RefreshCw size={15} className="ui-spin" /> : <ArrowUp size={15} />} Search
            </button>
            <button type="button" className={`ui-btn ${filtersOpen ? "ui-btn--secondary" : "ui-btn--ghost"}`} style={{ height: 40 }} aria-expanded={filtersOpen}
              title="Set the filters yourself instead: industry, town, size, age and more" onClick={() => setFiltersOpen((o) => !o)}>
              <SlidersHorizontal size={15} /> Filters{filterCount ? ` · ${filterCount}` : ""} <ChevronDown size={13} style={{ transform: filtersOpen ? "rotate(180deg)" : "none" }} />
            </button>
          </form>
          {!chatStarted ? (
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <span style={{ ...muted, fontSize: 12.5 }}>Try</span>
              {IDEAS.map(([name, patch]) => (
                <button key={name} type="button" title="Run a ready-made search" className="ui-chip" disabled={busy} onClick={() => runIdea(patch)} style={{ padding: "5px 9px" }}>{name}</button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      {filtersOpen ? (
      <form ref={filtersRef} data-pane="chat" onSubmit={(e) => { setExcluded([]); search(e); }} className="ui-card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <label style={field} title="Words are matched against what each company does and its name. Related words are included, like dental for dentist"><span style={label}>Industry or company name</span>
            <input className="ui-input" value={form.sector} onChange={(e) => setField("sector", e.target.value)} placeholder="cafe, restaurant, or a company name" /></label>
          <div style={field}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }} title="One or more towns, separated by commas"><span style={label}>Town / city</span>
              <input className="ui-input" value={form.town} onChange={(e) => setField("town", e.target.value)} placeholder="London, Leeds" /></label>
            <DistrictPicker town={form.town} includeClosed={form.includeClosed} postcode={form.postcode} onChange={(v) => setField("postcode", v)} />
          </div>
          <label style={{ ...field, flex: "0 1 150px" }} title="Only companies whose postcode begins with this, like EC1 or M1"><span style={label}>Postcode starts with</span>
            <input className="ui-input" value={form.postcode} onChange={(e) => setField("postcode", e.target.value)} placeholder="EC1, M1" /></label>
        </div>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ ...field, flex: "1 1 260px" }}>
            <span style={label} title="From each company's filed accounts category. It is not a headcount.">Size (from filed accounts)</span>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {SIZE_OPTIONS.map(([id, name]) => (
                <button key={id} type="button" title="Only companies of this size" className={`ui-chip${form.sizes.includes(id) ? " is-active" : ""}`} aria-pressed={form.sizes.includes(id)} onClick={() => toggleSize(id)}
                  style={form.sizes.includes(id) ? { background: "var(--ui-accent-soft)", color: "var(--ui-accent-ink)" } : undefined}>{name}</button>
              ))}
            </div>
          </div>
          <label style={{ ...field, flex: "0 1 110px" }} title="Only companies that have existed at least this many years"><span style={label}>Trading ≥ years</span>
            <input className="ui-input" inputMode="numeric" value={form.minAge} onChange={(e) => setField("minAge", e.target.value)} placeholder="5" /></label>
          <label style={{ ...field, flex: "0 1 110px" }} title="Only companies that are no older than this many years"><span style={label}>Trading ≤ years</span>
            <input className="ui-input" inputMode="numeric" value={form.maxAge} onChange={(e) => setField("maxAge", e.target.value)} placeholder="2" /></label>
          <label style={{ ...field, flex: "0 1 190px" }} title="The legal form: Limited, LLP, PLC and so on"><span style={label}>Company type</span>
            <input className="ui-input" value={form.category} onChange={(e) => setField("category", e.target.value)} placeholder="Limited, LLP, PLC" /></label>
        </div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
          {check("hasWebsite", "Has a website")}{check("hasPhone", "Has a phone")}{check("hasEmail", "Has an email")}{check("includeClosed", "Include closed / dissolved")}
          <button type="button" className="ui-btn ui-btn--secondary" style={{ height: 40, marginLeft: "auto" }} title="See results as pins and draw an area to search inside it" onClick={() => setView("map")}>
            <MapIcon size={15} /> Search on map
          </button>
          <button type="button" className="ui-btn ui-btn--ghost" style={{ height: 40 }} onClick={resetSearch} title="Clear every filter, the drawn area and the results, and start again">
            <RotateCcw size={15} /> Reset
          </button>
          <button type="submit" className="ui-btn ui-btn--primary" disabled={busy} style={{ height: 40 }} title="Search the company register. It costs no credits">
            {busy ? <RefreshCw size={15} className="ui-spin" /> : <Search size={15} />} {busy ? "Searching…" : "Find companies"}
          </button>
        </div>
        <div style={{ ...muted, fontSize: 12.5 }}>Searches the official company registry we hold. Free, and only active companies unless you tick "Include closed". Credits are used only when you look up contacts.</div>
      </form>
      ) : null}

      {busy ? (
        <div data-pane="results"><SearchStatus title={`Searching the company register${form.sector.trim() ? ` for ${form.sector.trim()}` : ""}${form.town.trim() ? ` in ${form.town.trim()}` : ""}`}
          detail="Reading your words, matching them against every registered company, then ranking the best matches. This costs no credits." paused={searchHold.paused} holding onPause={searchHold.pause} onResume={searchHold.resume} onCancel={cancelSearch} /></div>
      ) : null}
      {error ? <div data-pane="results" role="alert" style={{ ...muted, color: C.red }}>{error}</div> : null}
      {!busy && !error && !searched && view !== "map" ? (
        <div data-pane="results" className="ui-card phone-only" style={{ padding: 20, flexDirection: "column", alignItems: "flex-start", gap: 12 }}>
          <div style={{ ...text, fontSize: 15, fontWeight: 600, color: C.ink }}>No search yet</div>
          <div style={{ ...muted, fontSize: 14 }}>Ask the AI who you're after, or set the filters. The companies you find show here.</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="ui-btn ui-btn--primary" style={{ minHeight: 44 }} onClick={() => setPane("chat")}><Sparkles size={15} /> Ask AI</button>
            <button type="button" className="ui-btn ui-btn--secondary" style={{ minHeight: 44 }} onClick={() => { setPane("chat"); setFiltersOpen(true); }}>Set filters</button>
          </div>
        </div>
      ) : null}

      {searched || view === "map" ? (
        <div data-pane="results" className="ui-card" style={{ overflow: "hidden" }}>
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
                <button key={id} type="button" title={id === "map" ? "See the results as pins on a map" : "See the results as a list"} aria-pressed={view === id} onClick={() => setView(id)}
                  className={`ui-btn ui-btn--sm ${view === id ? "ui-btn--primary" : "ui-btn--ghost"}`}><Icon size={14} /> {name}</button>
              ))}
            </div>
            <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" disabled={!companies.length} title="Put every company shown into your Favourites list"
              onClick={() => store.save(companies.map(asAccount), FAVOURITES)}>★ Favourite all</button>
            <button title="Save every company shown into your Unsorted list" type="button" className="ui-btn ui-btn--secondary ui-btn--sm" disabled={!unsaved.length} onClick={async () => { const name = await askText({ title: `Save these ${unsaved.length.toLocaleString()} companies into a list`, label: "Name the list", initial: "Unsorted", confirm: "Save", maxLength: 80 }); if (name) store.save(unsaved.map(asAccount), name); }}>
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
            <div ref={mapRef} style={{ padding: 12, scrollMarginTop: 8 }}>
              <LeadsMap companies={companies} points={points} area={area} busy={busy} onArea={drawArea} onClear={clearArea} hint={form.sector} statusOf={statusOf} actions={mapActions} />
              {area && companies.some((c) => c.phone) ? (
                <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <CallButton label={`Call the ${companies.filter((c) => c.phone).length} with a phone number in this area`} lockedLabel="Call these · add Voice" variant="secondary"
                    title="Saves them to your Unsorted list, then shows who can be called"
                    onClick={() => callAll(companies)} onLocked={() => call.open({ kind: "selected", ids: [], name: "the companies in your area" }, true)} />
                </div>
              ) : null}
              {areaStep && area ? (
                <div className="ui-card" role="status" style={{ marginTop: 10, padding: "10px 14px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  {areaStep.phase === "counting" ? (
                    <div style={{ width: "100%" }}>
                      <SearchStatus title="Counting the companies inside your area"
                        detail={`${[appliedWords(form), "inside the shape you drew"].filter(Boolean).join(" · ")}. This takes a few seconds and costs nothing.`}
                        paused={countHold.paused} holding onPause={countHold.pause} onResume={countHold.resume} onCancel={clearArea} />
                    </div>
                  ) : null}
                  {areaStep.phase === "choose" ? (
                    areaStep.candidates ? (
                      <>
                        <span style={{ ...text, fontSize: 13, color: C.textInk, marginRight: "auto" }}>
                          Up to <strong>{areaStep.candidates.toLocaleString()}{areaStep.capped ? "+" : ""}</strong> companies are in this area. How many do you want to see?
                        </span>
                        {amountChoices(areaStep.candidates).map((o) => (
                          <button key={String(o.value)} type="button" className="ui-btn ui-btn--secondary ui-btn--sm" title="Read this many companies from the area" onClick={() => pickAmount(o.value)}>{o.label}</button>
                        ))}
                        <form onSubmit={(e) => { e.preventDefault(); const n = typedAmount(custom, areaStep.candidates); if (n) pickAmount(n); }}
                          style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                          <input className="ui-input" inputMode="numeric" aria-label="Type how many to see" placeholder="Or type a number" value={custom}
                            onChange={(e) => setCustom(e.target.value)} style={{ width: 130, height: 30 }} />
                          <button type="submit" className="ui-btn ui-btn--primary ui-btn--sm" disabled={!typedAmount(custom, areaStep.candidates)} title="Show this many companies from the area">Show</button>
                          <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" disabled={!custom} onClick={() => setCustom("")} title="Clear the number">Reset</button>
                        </form>
                      </>
                    ) : <span style={muted}>Nothing found inside this area. Our data covers the UK, so draw over a UK town or a few postcodes, or use "Redraw area" for a bigger area or fewer filters.</span>
                  ) : null}
                  {areaStep.phase === "running" ? (
                    <div style={{ width: "100%" }}>
                      <SearchStatus title={`Reading the area: ${(areaStep.found || 0).toLocaleString()} of ${(areaStep.target || 0).toLocaleString()} found`}
                        detail={`Checked ${(areaStep.scanned || 0).toLocaleString()} of up to ${(areaStep.candidates || 0).toLocaleString()} companies in the shape. Pins appear as they are found.`}
                        found={areaStep.found} total={areaStep.target} paused={paused}
                        onPause={() => { pausedRef.current = true; setPaused(true); }} onResume={() => { pausedRef.current = false; setPaused(false); }}
                        onCancel={() => { stopArea.current = true; pausedRef.current = false; setPaused(false); }} cancelLabel="Stop and keep what's found" />
                    </div>
                  ) : null}
                  {areaStep.phase === "done" ? (
                    <>
                      <span style={{ ...text, fontSize: 13, color: C.textInk, marginRight: "auto" }}>
                        {areaStep.shown
                          ? `Showing ${areaStep.shown.toLocaleString()}${areaStep.candidates ? ` of up to ${areaStep.candidates.toLocaleString()}` : ""} companies in this area · ${pinCount.toLocaleString()} on the map.`
                          : "No companies from our data are inside this exact shape."}
                      </span>
                      {areaStep.candidates ? amountChoices(areaStep.candidates).filter((o) => o.value > (areaStep.shown || 0)).slice(0, 3).map((o) => (
                        <button title="Read this many companies from the area" key={String(o.value)} type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={() => pickAmount(o.value)}>
                          Show {o.label}
                        </button>
                      )) : null}
                      {areaStep.candidates ? <button title="Pick how many companies to read from the area" type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => setAreaStep({ phase: "choose", candidates: areaStep.candidates })}>Choose a number…</button> : null}
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
            <CompanyRow key={c.id} c={c} saved={isSaved(c)} onSave={saveOne} onRemove={removeCompany} onCall={callOne}
              onCallLocked={(co) => call.open({ kind: "one", id: "", name: co.name }, true)} last={i === companies.length - 1} />
          )) : searched && !inArea ? (
            <div style={{ ...muted, padding: 16 }}>No companies match these filters. Try a wider town, a broader industry word, or tick "Include closed".</div>
          ) : null}
          {companies.length < total ? (
            <div style={{ padding: 12, textAlign: "center" }}>
              <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" disabled={busy} title="Load the next page of results" onClick={() => search(null, form, companies.length)}>Show more</button>
            </div>
          ) : null}
        </div>
      ) : null}


      </>) : (
      <div data-pane="chat" className="ui-card" style={{ padding: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <form onSubmit={runWeb} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input title="Describe the kind of business and the place" className="ui-input" value={web.query} onChange={(e) => setWeb((w) => ({ ...w, query: e.target.value }))} placeholder="A type of business and a place, like dental practices in Leeds" style={{ flex: "1 1 280px" }} aria-label="Web search" />
            <button type="submit" className="ui-btn ui-btn--primary" disabled={web.busy || !web.query.trim()} title="Search public web pages and directories for businesses that are not in the register">
              {web.busy ? <RefreshCw size={15} className="ui-spin" /> : <Search size={15} />} {web.busy ? "Searching the web…" : "Search the web"}
            </button>
            <button type="button" className="ui-btn ui-btn--ghost" onClick={() => { cancelWeb(); setWeb((w) => ({ ...w, query: "", results: [], error: "" })); }} title="Clear the search and its results">
              <RotateCcw size={15} /> Reset
            </button>
          </form>
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap", background: "var(--ui-accent-soft)", borderRadius: 10, padding: "9px 13px", ...text, fontSize: 12.5, color: C.textInk }}>
            <span>You get: <strong>name, usually a website and phone, sometimes more</strong></span>
            <span>Cost: <strong>{webRate == null ? "1 credit" : creditWord(webRate)} per company found</strong>, nothing if none</span>
          </div>
          {web.busy ? <SearchStatus title="Searching the open web" detail="Looking at business pages and directories. Nothing is charged unless something is found." paused={webHold.paused} holding onPause={webHold.pause} onResume={webHold.resume} onCancel={cancelWeb} /> : null}
          <div style={{ ...muted, fontSize: 12.5 }}>Web results are unverified. Registry results are the reliable ones.</div>
          {web.error ? <div role="alert" style={{ ...muted, color: C.red }}>{web.error}</div> : null}
          {web.results.length ? (() => {
            const n = web.results.length;
            const withSite = web.results.filter((r) => r.site || r.website || r.domain).length;
            const withPhone = web.results.filter((r) => r.phone).length;
            return (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8 }}>
                {[["Companies found", n], ["With a website", withSite], ["With a phone", withPhone], ["Credits (at most)", webRate == null ? n : webRate * n]].map(([l, v]) => (
                  <div key={l} style={{ background: "#F4F5F9", borderRadius: 10, padding: "9px 12px" }}>
                    <div style={{ ...text, fontSize: 19, fontWeight: 700, color: C.ink }}>{v}</div>
                    <div style={{ ...muted, fontSize: 12 }}>{l}</div>
                  </div>
                ))}
              </div>
            );
          })() : null}
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
                    : <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" title="Save this company to your Unsorted list" onClick={() => store.save([acct])}><Plus size={14} /> Save</button>}
                </div>
              );
            })}
        </div>
      </div>
      )}
    </div>
  );
}

const SUB_TABS = [
  ["search", "Find Leads", Sparkles],
  ["import", "Import", FileSpreadsheet],
];

export function FindLeadsView({ store, listsStore, onGo }) {
  const [sub, setSub] = useState("search");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {SUB_TABS.map(([id, label, Icon]) => (
          <button key={id} type="button" title={`Go to ${label}`} onClick={() => setSub(id)}
            className={`ui-btn ui-btn--sm ${sub === id ? "ui-btn--primary" : "ui-btn--ghost"}`}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>
      {sub === "search" && <FindLeadsSearch store={store} listsStore={listsStore} />}
      {sub === "import" && <ImportView store={store} onGo={onGo} onAskAi={() => setSub("search")} />}
    </div>
  );
}
