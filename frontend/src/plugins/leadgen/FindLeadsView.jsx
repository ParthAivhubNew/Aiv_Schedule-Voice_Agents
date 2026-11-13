import { searchKey, skipRepeat } from "./searchGuard";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { PickOptions, SOCIAL } from "./PickOptions";
import { Spinner } from "../../app/Loader";
import { ArrowLeft, BadgeCheck, ShieldCheck, Building2, Check, ChevronDown, Globe, List, Map as MapIcon, ChevronsLeft, ChevronsRight, Plus, RefreshCw, RotateCcw, Search, Sparkles, Star, Users, X } from "lucide-react";
import { C, FONT_BODY } from "../../tokens";
import { api } from "../../api/apiClient";
import { domainOf, ImportView } from "./AccountsViews";
import { CheckDialog, CheckProgress, useCompanyCheck } from "./CheckCompanies";
import { personEmail } from "./companyLogic";
import { LeadsMap } from "./LeadsMap";
import { amountChoices, PAGE_SIZES, typedAmount } from "./drawShape";
import { SearchStatus, useHold } from "./SearchStatus";
import { TableSkeleton, TopBar } from "../../app/Loader";
import { askConfirm, askList, askText } from "./Dialogs";
import { CallButton, useCallDialog } from "./CallFlow";
import { PaneSwitch } from "../../components/PaneSwitch";
import { useConnection } from "../../hooks/useConnections";
import { CompaniesTable, CountTiles, FilterGroup, Pager, PeopleTable, SelectionBar, ViewMenu } from "./FindLeadsParts";
import { IcpPrompt, useIcp } from "./FitParts";
import { sortOptions } from "./fitLogic";
import { CompanyDrawer } from "./CompanyDrawer";
import { NotesButton, notesChanged } from "./Notes";
import { LookupCost, announceCreditsChanged } from "./CreditsChip";
import { useBulkSelect } from "../../components/bulkSelect";
import { SelectAllNotice } from "../../components/SelectAllNotice";
import { notice } from "../../utils/notice";
// Phase 4: SIC picker, radius, signals, saved searches
import { SicPicker } from "./IcpEditor";
import { SearchField } from "../../components/SearchField";
import { nameAsKeywordTown } from "./companyLogic";
import { SavedSearches } from "./SavedSearches";
import { RADIUS_MILES, SIGNAL_OPTIONS, cleanFilters, coversText, nearFromReply, toggleIn } from "./savedSearchLogic";

// The most rows one "Select all" ticks across pages; the server holds the same cap (lead_accounts.SELECT_ALL_CAP).
export const SELECT_ALL_LIMIT = 2000;

const FAVOURITES = "Favourites";
const CHECK_TIPS = {
  hasWebsite: "Only companies we already hold a website for",
  includeNonBusiness: "Also show schools, nurseries, churches and community places (hidden by default)",
  includeSecondary: "Also show companies that list this trade only as a side activity. By default a trade matches a company's main activity or its name",
  hasPhone: "Only companies we already hold a phone number for",
  hasEmail: "Only companies we already hold an email for",
  includeClosed: "Also show companies that have closed or been dissolved",
  noCharities: "Leave out charities and companies on the charity register",
};
const text = { fontFamily: FONT_BODY };
const muted = { ...text, fontSize: 13, color: C.slate, lineHeight: 1.5 };

const SIZE_OPTIONS = [["micro", "Micro"], ["small", "Small"], ["medium_large", "Medium / large"], ["dormant", "Dormant"]];
const EMPTY_FORM = { name: "", sector: "", sic: "", town: "", postcode: "", sizes: [], minAge: "", maxAge: "", includeClosed: false, includeNonBusiness: false, includeSecondary: false, hasWebsite: false, hasPhone: false, hasEmail: false, category: "", types: [], noCharities: false, notSector: "", notTown: "", notCategory: "", saved: "", title: "", nearPostcode: "", nearMiles: "5", near: null, nearError: "", signals: [] };
const FIRST_KEY = "aivhub_find_first";
const GROUP_KEYS = { name: ["name"], industry: ["sector", "sic", "notSector", "includeSecondary"], location: ["town", "postcode", "notTown", "nearPostcode", "near", "nearError"], signals: ["signals"], size: ["sizes"], company: ["category", "types", "noCharities", "notCategory", "minAge", "maxAge", "includeClosed"], contact: ["hasWebsite", "hasPhone", "hasEmail"], lists: ["saved"], person: ["title"] };
const isOn = (form, k) => (k === "nearPostcode" || k === "nearError" ? false : k === "near" ? Boolean(form.near?.districts?.length) : Array.isArray(form[k]) ? form[k].length > 0 : typeof form[k] === "boolean" ? form[k] : String(form[k] || "").trim() !== "");
const TYPE_OPTIONS = [["ltd", "Ltd"], ["plc", "PLC"], ["llp", "LLP"], ["cic", "CIC"], ["guarantee", "By guarantee"], ["partnership", "Partnership"]];

const when = (at) => new Date(at).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

// Find Leads layout and control styles.
const CHAT_CSS = `
.fl-filters{flex:0 0 296px;max-width:100%;position:sticky;top:8px;max-height:calc(100vh - 24px);overflow-y:auto}
.fl-main{flex:1 1 560px;min-width:0}
@media (max-width:820px){.fl-filters{flex-basis:100%;position:static;max-height:none}}
.fl-bar{position:absolute;top:0;left:0;right:0;height:3px;overflow:hidden;z-index:5;background:var(--ui-accent-soft,#EEF2FE)}
.fl-bar::after{content:"";position:absolute;top:0;bottom:0;width:35%;background:var(--ui-accent,#3457D5);animation:flBar 1s ease-in-out infinite}
@keyframes flBar{0%{left:-35%}100%{left:100%}}
.fl-pin{position:sticky;top:0;z-index:6;background:#fff;padding:10px 0 12px;border-bottom:1px solid var(--ui-line-soft);display:flex;flex-direction:column;gap:8px}
.fl-collapse{all:unset;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:8px;color:var(--ui-muted)}
.fl-collapse:hover,.fl-collapse:focus-visible{background:var(--ui-hover);color:var(--ui-ink)}
.fl-seg{display:inline-flex;height:36px;box-sizing:border-box;background:var(--ui-sunken);border:1px solid var(--ui-line);border-radius:10px;padding:3px;gap:3px}
.fl-seg-btn{border:none;cursor:pointer;border-radius:7px;padding:0 12px;font:600 13px Inter,sans-serif;display:inline-flex;align-items:center;gap:6px;background:transparent;color:var(--ui-muted)}
.fl-seg-btn[data-on="true"]{background:#fff;color:var(--ui-ink);box-shadow:0 1px 3px rgba(0,0,0,.12)}
.fl-seg-btn:focus-visible{outline:2px solid var(--ui-accent);outline-offset:1px}
`;

const splitList = (v) => String(v || "").split(",").map((s) => s.trim()).filter(Boolean);
const num = (v) => (v === "" || v == null || Number.isNaN(Number(v)) ? undefined : Number(v));

// The filter panel and the chat are the same search: the panel's fields become this filter object,
// and a chat reply's filters are written back into the panel -- so neither can drift from the other.
function formToFilters(f) {
  const out = {};
  // One box for industry words and company names: each word is matched against both.
  if (String(f.name || "").trim()) out.name_contains = f.name.trim();
  if (splitList(f.sector).length) out.keyword = splitList(f.sector);
  if (splitList(f.sic).length) out.sic_codes = splitList(f.sic);
  if (splitList(f.town).length) out.towns = splitList(f.town);
  if (splitList(f.postcode).length) out.postcode_prefixes = splitList(f.postcode);
  if (f.sizes.length) out.size_bands = f.sizes;
  if (num(f.minAge) !== undefined) out.min_age_years = num(f.minAge);
  if (num(f.maxAge) !== undefined) out.max_age_years = num(f.maxAge);
  if (f.includeClosed) out.status = "any";
  if (f.category.trim()) out.company_category = f.category.trim();
  if ((f.types || []).length) out.company_types = f.types;
  if (f.noCharities) out.exclude_charities = true;
  if (f.hasWebsite) out.has_website = true;
  if (f.includeNonBusiness) out.include_non_business = true;
  if (f.includeSecondary) out.include_secondary_activity = true;
  if (f.hasPhone) out.has_phone = true;
  if (f.hasEmail) out.has_email = true;
  if (splitList(f.notSector).length) out.not_keyword = splitList(f.notSector);
  if (splitList(f.notTown).length) out.not_towns = splitList(f.notTown);
  if (splitList(f.notCategory).length) out.not_company_category = splitList(f.notCategory);
  if (f.saved === "only" || f.saved === "exclude") out.saved = f.saved;
  if (f.near?.districts?.length) out.near = f.near;
  if ((f.signals || []).length) out.signals = f.signals;
  return out;
}

// What the user asked for, in a few words ("accounting, bookkeeping · Leeds"), for the status card.
function appliedWords(f) {
  return [f.sector, f.town, f.postcode ? `postcode ${f.postcode}` : ""].map((s) => String(s || "").trim()).filter(Boolean).join(" · ");
}

function filtersToForm(fl) {
  return {
    name: fl.name_contains || "", sector: [...(fl.keyword || []), ...(fl.sector || [])].join(", "), sic: (fl.sic_codes || []).join(", "),
    types: fl.company_types || [], noCharities: !!fl.exclude_charities, town: (fl.towns || []).map((t) => t.replace(/\b\w/g, (m) => m.toUpperCase())).join(", "),
    postcode: (fl.postcode_prefixes || []).join(", "), sizes: fl.size_bands || [],
    minAge: fl.min_age_years != null ? String(fl.min_age_years) : "", maxAge: fl.max_age_years != null ? String(fl.max_age_years) : "",
    includeClosed: String(fl.status || "").toLowerCase() === "any", category: fl.company_category || "",
    includeNonBusiness: !!fl.include_non_business, includeSecondary: !!fl.include_secondary_activity, hasWebsite: !!fl.has_website, hasPhone: !!fl.has_phone, hasEmail: !!fl.has_email,
    notSector: (fl.not_keyword || []).join(", "), notTown: (fl.not_towns || []).join(", "), notCategory: (fl.not_company_category || []).join(", "),
    saved: fl.saved || "", title: "",
    near: fl.near || null, nearPostcode: fl.near?.postcode || "", nearMiles: fl.near ? String(fl.near.miles) : "5", nearError: "", signals: fl.signals || [],
  };
}

function TierBadge({ tier }) {
  const verified = tier === "verified_registry";
  if (tier === "premises_listing") return <span title="Listed as a premises (for example a food register), not matched to a company number" style={{ ...text, fontSize: 11.5, display: "inline-flex", alignItems: "center", gap: 3, color: C.slate }}><Globe size={12} /> Premises listing</span>;
  return (
    <span title={verified ? "Read from an official registry record" : tier === "scraped" ? "Collected from a website" : "Found by a web search, not read from the official registry"}
      style={{ ...text, fontSize: 11.5, display: "inline-flex", alignItems: "center", gap: 3, color: verified ? C.green : C.slate }}>
      {verified ? <BadgeCheck size={12} /> : <Globe size={12} />} {verified ? "Registry" : tier === "scraped" ? "Website" : "Web"}
    </span>
  );
}

export function asAccount(c) {
  const notes = [c.registration_number && `Reg no. ${c.registration_number}`, c.status, c.sic_text, c.postcode].filter(Boolean).join(" · ");
  return { name: c.name, website: c.website || "", phone: c.phone || "", email: c.email || "", industry: c.industry || "", region: c.region || "", notes, source: "scout", business_record_id: c.id,
    registration_number: c.registration_number || "", postcode: c.postcode || "", address: c.address || "" };
}

// One company's contacts on demand. Registry officers are verified and free; the web lookup is a
// separate, labelled step; an email is found for one named person at a time (only charged when found).
function WebRow({ label, children }) {
  return (
    <div style={{ display: "flex", gap: 10, fontSize: 12.5, ...text, color: C.textInk, alignItems: "baseline" }}>
      <span style={{ width: 56, flexShrink: 0, color: C.slate }}>{label}</span>
      <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{children}</span>
    </div>
  );
}

// The second line under an officer: how long in the role, nationality, trade, where they live, birth year. Only what the register publishes.
function personLine(o) {
  const years = o.years_in_role == null ? "" : o.years_in_role === 0 ? "joined this year" : `${o.years_in_role} ${o.years_in_role === 1 ? "year" : "years"} in the role`;
  return [years, o.nationality, o.occupation, o.country_of_residence ? `lives in ${o.country_of_residence}` : "", o.born_year ? `born ${o.born_year}` : ""].filter(Boolean).join(" · ");
}

function ContactsPanel({ company }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(true);  // the registry is read as soon as the panel opens, so it starts in the loading state
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
      // Searched with the company's name, plus its website when we know one. It never searches for the website itself.
      const r = await api.findPersonEmail(company.id, { name: o.name, first_name: o.first_name, last_name: o.last_name });
      if (r.charged) announceCreditsChanged();
      setEmails((m) => ({ ...m, [key]: r.found ? { email: r.email, status: r.verification_status } : { none: true } }));
    } catch (e) {
      setEmails((m) => ({ ...m, [key]: { error: e.message || "Couldn't look that up." } }));
    }
  };

  return (
    <div style={{ marginTop: 10, padding: 12, background: C.bgSoft || "#F7F8FA", borderRadius: 8, display: "flex", flexDirection: "column", gap: 10 }}>
      {error ? <div role="alert" style={{ ...muted, color: C.red }}>{error}</div> : null}
      {!data && busy ? (
        <div role="status" aria-live="polite" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ ...text, fontSize: 12.5, fontWeight: 600, color: C.ink, display: "flex", alignItems: "center", gap: 6 }}><Spinner size={13} /> Reading the registry for the people at this company…</div>
          {[0, 1, 2].map((i) => <div key={i} aria-hidden="true" style={{ height: 30, borderRadius: 6, background: C.borderLight, opacity: 1 - i * 0.25 }} />)}
          <div style={{ ...muted, fontSize: 12 }}>This usually takes a few seconds. It's free.</div>
        </div>
      ) : null}
      {data ? (
        <>
          <div>
            <div style={{ ...text, fontSize: 12.5, fontWeight: 600, color: C.ink, display: "flex", alignItems: "center", gap: 6 }}>
              <Users size={13} /> People on the public register {data.officers.length ? <span style={{ fontWeight: 400, color: C.green }}>(verified)</span> : null}
            </div>
            {data.officers.length ? data.officers.map((o) => {
              const e = personEmail(emails, o);
              return (
                <div key={o.name} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "6px 0", borderBottom: `1px solid ${C.borderLight}` }}>
                  <span style={{ ...text, fontSize: 13, flex: "1 1 200px", minWidth: 0 }}>
                    {o.first_name} {o.last_name} <NotesButton companyId={company.id} person={o.name} name={`${o.first_name} ${o.last_name}`.trim() || o.name} /> <span style={{ color: C.slate }}>· {o.role || "Officer"}</span>
                    {personLine(o) ? <span style={{ ...muted, fontSize: 12, display: "block", marginTop: 1 }}>{personLine(o)}</span> : null}
                  </span>
                  {e.email ? <span style={{ ...text, fontSize: 12.5, color: C.green }}>{e.email} ({e.status})</span>
                    : e.none ? <span style={{ ...muted, fontSize: 12.5 }}>No email found for this person. Nothing charged.</span>
                    : <>
                        {e.error ? <span style={{ ...muted, fontSize: 12.5, color: C.red }}>{e.error}</span> : null}
                        <button type="button" title="Look for this person's work email. 1 Leads credit only if one is found" className="ui-btn ui-btn--secondary ui-btn--sm" disabled={e.busy} onClick={() => findEmail(o)}>
                          {e.busy ? <Spinner size={13} /> : null} Find email · <LookupCost />
                        </button>
                      </>}
                </div>
              );
            }) : <div style={{ ...muted, fontSize: 12.5 }}>{data.officers_note || "No current officers listed."}</div>}
            {(data.recent_leavers || []).length ? (
              <div style={{ ...muted, fontSize: 12.5, marginTop: 8 }}>
                Left in the last year: {data.recent_leavers.map((l) => `${l.name.includes(",") ? l.name.split(",").reverse().map((x) => x.trim()).join(" ") : l.name} (${l.role}, ${l.resigned_on})`).join("; ")}
              </div>
            ) : null}
            {domain ? <div style={{ ...muted, fontSize: 12.5, marginTop: 8 }}>Work emails are looked up on {domain}.</div> : null}
          </div>
          {(data.controllers || []).length ? (
            <div>
              <div style={{ ...text, fontSize: 12.5, fontWeight: 600, color: C.ink, display: "flex", alignItems: "center", gap: 6 }}>
                <Users size={13} /> Who owns or controls it <span style={{ fontWeight: 400, color: C.green }}>(verified)</span>
              </div>
              {data.controllers.map((c) => (
                <div key={c.name} style={{ padding: "6px 0", borderBottom: `1px solid ${C.borderLight}` }}>
                  <div style={{ ...text, fontSize: 13 }}>{c.name}{c.since ? <span style={{ color: C.slate }}> · since {c.since.slice(0, 4)}</span> : null}</div>
                  <div style={{ ...muted, fontSize: 12 }}>{[...c.controls, c.nationality, c.country_of_residence ? `lives in ${c.country_of_residence}` : "", c.born_year ? `born ${c.born_year}` : ""].filter(Boolean).join(" · ")}</div>
                </div>
              ))}
            </div>
          ) : null}
          <div>
            <div style={{ ...text, fontSize: 12.5, fontWeight: 600, color: C.ink }}>Contact details</div>
            {data.stored.website || data.stored.phone || data.stored.email ? (
              <div style={{ ...muted, fontSize: 12.5 }}>{[data.stored.website, data.stored.phone, data.stored.email].filter(Boolean).join(" · ")} <TierBadge tier={data.stored.tier} /></div>
            ) : <div style={{ ...muted, fontSize: 12.5 }}>{data.web && data.web.found !== false ? "Not held on the public register. What the web found is below." : "The public register holds no website, phone or email for this company."}</div>}
            {data.web ? (
              data.web.found === false ? <div style={{ ...muted, fontSize: 12.5, marginTop: 4 }}>The web search found no website, phone or email we could tie to this company, so nothing is shown and nothing was charged.</div> : (
                <div style={{ marginTop: 8, padding: "8px 10px", border: `1px solid ${C.borderLight}`, borderRadius: 8, background: "#fff", display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ ...text, fontSize: 12, fontWeight: 600, color: C.slate, display: "flex", alignItems: "center", gap: 5 }}><Globe size={12} /> Found on the web</div>
                  {data.web.website ? <WebRow label="Website"><a href={/^https?:/.test(data.web.website) ? data.web.website : `https://${data.web.website}`} target="_blank" rel="noreferrer" style={{ color: C.cobalt }}>{domainOf(data.web.website) || data.web.website}</a></WebRow> : null}
                  {(data.web.phones || []).map((ph) => <WebRow key={ph} label="Phone"><a href={`tel:${ph.replace(/\s+/g, "")}`} style={{ color: C.textInk }}>{ph}</a></WebRow>)}
                  {(data.web.emails || []).map((em) => <WebRow key={em} label="Email"><a href={`mailto:${em}`} style={{ color: C.textInk }}>{em}</a></WebRow>)}
                  {(data.web.team || []).map((t) => <WebRow key={t.name} label="Team">{t.name}{t.title ? `, ${t.title}` : ""}{t.email ? <> · <a href={`mailto:${t.email}`} style={{ color: C.textInk }}>{t.email}</a></> : null}</WebRow>)}
                </div>
              )
            ) : (
              <button type="button" title="Search the web for this company's website and phone. 1 Leads credit only if something is found" className="ui-btn ui-btn--primary ui-btn--sm" disabled={busy} onClick={() => load(true)} style={{ marginTop: 8 }}>
                {busy ? <Spinner size={13} /> : <Globe size={13} />} Look for website &amp; phone on the web · <LookupCost />
              </button>
            )}
          </div>
        </>
      ) : null}
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
      <button type="button" title={`Pick postcode areas in ${one}`} className="ui-btn ui-btn--ghost ui-btn--sm" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <ChevronDown size={13} style={{ transform: open ? "rotate(180deg)" : "none" }} />
        {ticked.length ? `${ticked.length} postcode area${ticked.length === 1 ? "" : "s"} chosen` : `Choose postcode areas in ${one} (${state.rows.length})`}
      </button>
      {open ? (
        <div role="listbox" aria-label={`Postcode areas in ${one}`} className="ui-card"
          style={{ position: "absolute", left: 0, top: "calc(100% + 4px)", zIndex: 30, width: 280, maxHeight: 320, overflowY: "auto", padding: 8, boxShadow: "0 8px 24px rgba(0,0,0,.14)" }}>
          <div style={{ display: "flex", gap: 6, padding: "2px 4px 6px" }}>
            <button title="Tick every postcode area" type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => set(state.rows.map((r) => r.district))}>Select all</button>
            <button title="Untick every postcode area" type="button" className="ui-btn ui-btn--ghost ui-btn--sm" disabled={!ticked.length} onClick={() => set([])}>Clear</button>
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

function FindLeadsSearch({ store, listsStore, incoming, onAskAssistant, onOpenCompany, onSetIcp }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [applied, setApplied] = useState({});
  const [chips, setChips] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [total, setTotal] = useState(0);
  const [capped, setCapped] = useState(false);
  const [excluded, setExcluded] = useState([]);
  const [searched, setSearched] = useState(false);
  const [tab, setTab] = useState("companies"); // companies | people
  const [sort, setSort] = useState("best");
  const icp = useIcp();
  const [icpSet, setIcpSet] = useState(false); // what the server said for the list on screen
  const [page, setPage] = useState(1);
  const [ranked, setRanked] = useState(true); // false until the server has ranked the register: results are then newest first
  const [tiers, setTiers] = useState(null); // {full, partial, basic}: how many results are in each group
  const [savedTotal, setSavedTotal] = useState(null); // null until the count is known: a loading dash, never a wrong 0
  const [selKey, setSelKey] = useState(""); // the search the ticks belong to: a new search (not a new page) clears them
  const sel = useBulkSelect(selKey);
  const cardsById = useRef(new Map()); // every company card seen in this search, so ticks on other pages still have their row
  const lastQuery = useRef(null); // the request behind the results on screen, for "Select all"
  const [selecting, setSelecting] = useState(false);
  const [openCo, setOpenCo] = useState(null); // the company whose profile is open in the side drawer
  const [draft, setDraft] = useState(null); // { asked }: the list the AI assistant opened here, until the person is done with it
  const [filtersShown, setFiltersShown] = useState(() => { try { return localStorage.getItem("aivhub_find_filters") !== "hidden"; } catch { return true; } });
  const [groups, setGroups] = useState({ industry: true, location: true, size: true, company: false, contact: false, lists: false, person: true });
  const [people, setPeople] = useState([]);
  const [peopleTotal, setPeopleTotal] = useState(0); // companies that have people on file
  const [fillIds, setFillIds] = useState([]);
  const [filling, setFilling] = useState(null); // null, or {done, of} while the registry is being read for people
  const fillRun = useRef(0);
  const fillTried = useRef("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Phones: which pane shows. Search holds the Filters drop-down; Results holds the companies.
  const [pane, setPane] = useState("chat");

  const [view, setView] = useState("list");
  const [area, setArea] = useState(null); // a polygon drawn on the map: [[lat, lng], ...]
  const [areaNote, setAreaNote] = useState(""); // said above the map when the area shows every company because none fit the filters
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
  // Too few companies had the trade as their main activity, so side-activity ones were included: the server's sentence saying so.
  const [broadenedNote, setBroadenedNote] = useState("");
  const [dropTerms, setDropTerms] = useState([]);
  const dropFor = useRef("");
  // Every search can be cancelled: a newer run id makes the older one's answer be ignored when it arrives.
  const runId = useRef(0);
  const runSig = useRef(""); // the search now running
  const [didYouMean, setDidYouMean] = useState({}); // a mistyped town and the town it probably meant
  const pausedRef = useRef(false);
  const [paused, setPaused] = useState(false);


  // Map view: bring the map into view when it is chosen and whenever a search starts or finishes, so nobody scrolls to it each time.
  const mapRef = useRef(null);
  useEffect(() => {
    if (view === "map" && mapRef.current) mapRef.current.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [view, busy, area, areaStep?.phase]);
  const savedKeys = useMemo(() => new Set(store.accounts.flatMap((a) => [a.business_record_id, a.domain, a.name.toLowerCase()]).filter(Boolean)), [store.accounts]);
  const isSaved = (c) => {
    const d = domainOf(c.website);
    // By the register record, or by the company's own website. A name alone is not enough: another company can share it.
    return savedKeys.has(c.id) || Boolean(d && savedKeys.has(d));
  };
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  // Phase 4: names for the SIC codes picked here, and the radius lookup (the districts inside N miles of a postcode)
  const [sicLabels, setSicLabels] = useState({});
  const lookRadius = async (postcode, miles) => {
    const pc = String(postcode || "").trim();
    if (!pc) { setForm((f) => ({ ...f, near: null, nearError: "" })); return; }
    try {
      const r = await api.radiusDistricts(pc, miles);
      setForm((f) => ({ ...f, near: nearFromReply(pc, miles, r), nearError: "" }));
    } catch (err) {
      setForm((f) => ({ ...f, near: null, nearError: err.message || "That postcode could not be looked up." }));
    }
  };
  const applySaved = (filters) => {
    const f = { ...EMPTY_FORM, ...filtersToForm(cleanFilters(filters)) };
    setExcluded([]); setForm(f); setTab("companies"); search(null, f, 0, null, undefined, undefined, true);
  };
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

  // Opening Find Leads shows the companies that match the ideal customer, best fit first. Without one it shows the whole
  // register, best profiles and biggest names first; filters then narrow it.
  const browsed = useRef(false);
  useEffect(() => {
    if (browsed.current || icp.loading) return;
    browsed.current = true;
    if (icp.isSet && Object.keys(icp.filters || {}).length) {
      const f = { ...EMPTY_FORM, ...filtersToForm(icp.filters) };
      setForm(f);
      setSort("fit");
      if (!seenIncoming.current) search(null, f, 0, null, undefined, "fit", true);
      return;
    }
    // The opening list this browser saw last time shows at once, then the fresh one replaces it quietly.
    try {
      const kept = JSON.parse(localStorage.getItem(FIRST_KEY) || "null");
      if (kept && Array.isArray(kept.companies) && kept.companies.length) {
        setCompanies(kept.companies); setTotal(kept.total || 0); setCapped(Boolean(kept.capped)); setTiers(kept.tiers || null);
        setRanked(kept.ranked !== false); setSearched(true);
      }
    } catch { /* nothing kept: the placeholder rows show instead */ }
    search(null, EMPTY_FORM, 0, null);
  }, [icp.loading]); // eslint-disable-line react-hooks/exhaustive-deps

  // The opening list never stays empty: if it failed (server busy, a restart, a slow first sort) or came back empty, it is tried
  // again by itself, up to three times, until the person starts a search of their own.
  const openingActive = useRef(true);
  const openingTries = useRef(0);
  useEffect(() => {
    const emptyOpening = searched && !busy && companies.length === 0;
    if (!(error || emptyOpening) || busy || !openingActive.current || openingTries.current >= 3) return undefined;
    const n = openingTries.current;
    const timer = setTimeout(() => {
      if (!openingActive.current) return;
      openingTries.current = n + 1;
      search(null, EMPTY_FORM, 0, null, undefined, undefined, true);
    }, [2000, 5000, 10000][n]);
    return () => clearTimeout(timer);
  }, [error, busy, searched, companies.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Once the last filter is removed, the list goes back to the whole register by itself: no need to press search on an empty form.
  useEffect(() => {
    if (!searched || area || busy || tab !== "companies") return undefined;
    if (Object.keys(formToFilters(form)).length) return undefined;
    const shownFilters = lastQuery.current?.filters;
    if (!shownFilters || !Object.keys(shownFilters).length) return undefined;
    const timer = setTimeout(() => search(null, EMPTY_FORM, 0, null, undefined, undefined, true), 400);
    return () => clearTimeout(timer);
  }, [form, searched, area, busy, tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const searchHold = useHold();
  const countHold = useHold();
  // Phones: a search shows its progress, then its companies or its error, on the Results pane.
  useEffect(() => {
    if (busy) setPane("results");
  }, [busy]);

  // A search the AI assistant sent over: its filters fill the panel and the search runs, as if they had been typed here.
  const seenIncoming = useRef(null);
  useEffect(() => {
    if (!incoming || incoming.id === seenIncoming.current) return;
    seenIncoming.current = incoming.id;
    const f = filtersToForm(incoming.filters || {});
    // "Give me 20": the table shows exactly those 20, best first, instead of a page of 25.
    const asked = Number(incoming.meta?.asked) || 0;
    pageRef.current = asked ? Math.min(asked, 250) : pageSize;
    setDraft({ asked });
    setExcluded([]); setForm(f); setTab("companies"); search(null, f, 0, null, undefined, undefined, true);
  }, [incoming]); // eslint-disable-line react-hooks/exhaustive-deps

  const search = async (e, overrideForm, offset = 0, areaOverride, dropOverride, sortOverride, force = false) => {
    if (e) e.preventDefault();
    if (e || (overrideForm && overrideForm !== EMPTY_FORM)) openingActive.current = false; // the person's own search: no more automatic retries
    const f = overrideForm || form;
    // An empty search from the search bar is "show everything": a map area left over from before, or companies hidden with Remove, must not narrow it.
    const wipe = Boolean(e) && !Object.keys(formToFilters(f)).length;
    if (wipe) { setArea(null); setAreaStep(null); setExcluded([]); }
    const fresh = Boolean(e); // a search the person just pressed starts without the companies they hid before
    const shape = wipe ? null : areaOverride !== undefined ? areaOverride : area;
    // A different search pressed while one is running replaces it (the old answer is dropped); only an exact repeat is ignored.
    const sig = searchKey(formToFilters(f), offset, shape);
    if (skipRepeat(busy, force, sig, runSig.current)) return;
    runSig.current = sig;
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
    // The last results stay (dimmed) while the next page loads, so the screen never goes empty; if the search fails, only the
    // error shows, not results that belong to something else.
    let r;
    const query = { filters: formToFilters(f), exclude_ids: fresh ? [] : excluded, drop_terms: drop, sort: sortOverride || sort };
    try {
      r = await api.searchCompanies({ ...query, limit: pageRef.current, offset });
    } catch (err) {
      if (myRun === runId.current) searchHold.settle(() => { if (myRun !== runId.current) return; setCompanies([]); setTotal(0); setTiers(null); setError(err.message || "The search didn't finish. Try again."); setBusy(false); });
      return;
    }
    if (myRun !== runId.current) return; // cancelled while it was running
    // If the search was paused, its answer waits here until Resume.
    searchHold.settle(() => {
      if (myRun !== runId.current) return;
      if (r.points) setPoints((p) => ({ ...p, ...r.points }));
      setCompanies(r.companies);
      setIcpSet(Boolean(r.icp_set));
      setPage(Math.floor(offset / pageRef.current) + 1);
      lastQuery.current = query;
      setSelKey(JSON.stringify([query.filters, query.sort, query.drop_terms]));
      setTiers(r.tiers || null);
      setRanked(r.ranked !== false);
      setSavedTotal(r.saved_total ?? null);
      setTotal(r.total_all ?? r.total);
      setCapped(r.total_all == null && r.total_capped);
      // The slower figures (real total, group counts, saved) arrive a moment after the page is already on screen.
      loadSummary(r.query_filters || formToFilters(f), excluded); // counted on the filters the search really ran, so the figures match the list shown
      setApplied(r.filters);
      setChips(r.chips || []);
      setDidYouMean(r.did_you_mean || {});
      setUnderstood(r.understood || []);
      setBroadenedNote(r.broadened ? r.broadened_note || "" : "");
      setSearched(true);
      setBusy(false);
      if (!offset && !Object.keys(formToFilters(f)).length && !(sortOverride || sort !== "best")) {
        try {
          localStorage.setItem(FIRST_KEY, JSON.stringify({ companies: r.companies.slice(0, 50).map((c) => ({ ...c, saved: false })), total: r.total_all ?? r.total, capped: r.total_all == null && r.total_capped, tiers: r.tiers || null, ranked: r.ranked !== false }));
        } catch { /* too big or blocked: the next visit just shows placeholder rows */ }
      }
    });
  };

  const sumRun = useRef(0);
  const loadSummary = async (filtersObj, excludeIds = []) => {
    const mine = ++sumRun.current;
    try {
      const r = await api.searchSummary({ filters: filtersObj, exclude_ids: excludeIds });
      if (mine !== sumRun.current) return;
      if (r.tiers) setTiers(r.tiers);
      if (r.saved_total != null) setSavedTotal(r.saved_total);
      if (r.total_all != null) { setTotal(r.total_all); setCapped(false); }
    } catch { /* the page is already there; the extra figures just stay as they were */ }
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
    stopArea.current = true;
    pausedRef.current = false;
    setPaused(false);
    fillRun.current += 1;
    setFilling(null);
    setPeople([]);
    setPeopleTotal(0);
    setFillIds([]);
    setTiers(null);
    setSavedTotal(0);
    sel.clear();
    lastQuery.current = null;
    setSelKey("");
    setPage(1);
    setForm(EMPTY_FORM);
    setExcluded([]);
    setArea(null);
    setAreaStep(null);
    setCompanies([]);
    setTotal(0);
    setCapped(false);
    setChips([]);
    setUnderstood([]);
    setBroadenedNote("");
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

  const goPage = (n) => {
    if (tab === "people") searchPeople(null, form, (n - 1) * pageRef.current);
    else search(null, form, (n - 1) * pageRef.current, null);
  };
  const changeSort = (v) => {
    setSort(v);
    if (!searched || area) return;
    if (tab === "people") searchPeople(null, form, 0, v);
    else search(null, form, 0, null, undefined, v);
  };
  const changeTab = (next) => {
    if (next === tab) return;
    setTab(next);
    if (!searched || area) return;
    if (next === "people") searchPeople(null, form, 0, undefined, "people");
    else search(null, form, 0, null);
  };
  // Total / Net new / Saved: tapping one searches again with that filter on (tap again to clear it).
  const pickSaved = (v) => {
    const f = { ...form, saved: v };
    setForm(f);
    if (tab === "people") searchPeople(null, f, 0);
    else search(null, f, 0, null);
  };

  // The People tab: the people the registry lists at the companies that match. Companies whose people have not been
  // read yet are read from the registry (free), the best-ranked first, and the list is searched again.
  const searchPeople = async (e, overrideForm, offset = 0, sortOverride) => {
    if (e) e.preventDefault();
    const f = overrideForm || form;
    setBusy(true);  // a new search replaces one still running (the older answer is dropped by the run id)
    setError("");
    const myRun = ++runId.current;
    setPeople([]);
    setCompanies([]);
    setTotal(0);
    let r;
    try {
      r = await api.searchPeople({ filters: formToFilters(f), limit: pageRef.current, offset, title: f.title || "", sort: sortOverride || sort });
    } catch (err) {
      if (myRun === runId.current) { setError(err.message || "The search didn't finish. Try again."); setBusy(false); }
      return;
    }
    if (myRun !== runId.current) return;
    setPeople(r.people);
    setPeopleTotal(r.companies_total);
    setPeopleOf(r.companies_matching ?? null);
    setTotal(r.companies_total);
    setCapped(r.total_capped);
    setApplied(r.filters);
    setChips(r.chips || []);
    setBroadenedNote(r.broadened ? r.broadened_note || "" : "");
    setFillIds(r.fill_ids || []);
    setPage(Math.floor(offset / pageRef.current) + 1);
    setSearched(true);
    setBusy(false);
    const key = JSON.stringify(formToFilters(f));
    if (r.fill_ids?.length && r.people.length < 10 && fillTried.current !== key) {
      fillTried.current = key;
      fillPeople(r.fill_ids, f);
    }
  };
  const fillPeople = async (ids, f = form) => {
    const mine = ++fillRun.current;
    let done = 0;
    setFilling({ done, of: ids.length });
    const queue = [...ids];
    const worker = async () => {
      while (queue.length && fillRun.current === mine) {
        const id = queue.shift();
        try { await api.companyContacts(id, { include_web: false }); } catch { /* one company the registry would not answer for: the others go on */ }
        done += 1;
        if (fillRun.current === mine) setFilling({ done, of: ids.length });
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    if (fillRun.current !== mine) return;
    setFilling(null);
    searchPeople(null, f, 0);
  };

  const dropTerm = (term) => {
    const next = [...dropTerms, term];
    setDropTerms(next);
    search(null, form, 0, undefined, next);
  };


  // Step 1: how many companies could be in the area. Free and quick.
  const countArea = async (shape, f = form, drop = dropTerms) => {
    stopArea.current = true;
    setError("");
    setSelKey(JSON.stringify(["area", shape, formToFilters(f), drop]));
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
          setAreaNote("");
          showFromArea(shape, Math.min(AREA_FIRST, r.candidates), r.candidates, f, drop); // show a few at once, then offer more
        } else if (Object.keys(formToFilters(f)).length) {
          // Nothing here fits the filters: show every company in the area rather than an empty map.
          api.areaCount({ filters: {}, area: shape, drop_terms: [] }).then((all) => {
            if (myRun !== runId.current) return;
            if (all.candidates) {
              setAreaNote("No company in this area matches your filters, so this shows every company in it.");
              setUnderstood([]);
              widenRef.current = false;
              showFromArea(shape, Math.min(AREA_FIRST, all.candidates), all.candidates, EMPTY_FORM, []);
            } else setAreaStep({ phase: "choose", candidates: 0, capped: r.capped, inArea: 0 });
          }).catch(() => { if (myRun === runId.current) setAreaStep({ phase: "choose", candidates: 0, capped: r.capped, inArea: r.in_area || 0 }); });
        } else {
          setAreaStep({ phase: "choose", candidates: 0, capped: r.capped, inArea: r.in_area || 0 });
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
        setBroadenedNote(r.broadened ? r.broadened_note || "" : "");
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
    setAreaNote("");
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
    setAreaNote("");
    setExcluded([]);
    setError("");
    setBusy(false);
    search(null, form, 0, null, undefined, undefined, true); // back to the normal list for the filters (with none, the whole register), never an empty screen
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
  // One click on an empty website or phone: look on the web (and, if that finds no website, the deeper search), fill the row.
  const [lookups, setLookups] = useState({}); // `${company id}:${website|phone}` -> "busy" | "none": each button has its own lookup
  const [peopleOf, setPeopleOf] = useState(null); // how many companies match, of which peopleTotal have people on file
  const [pick, setPick] = useState(null); // {company, kind, options}: a lookup that was not sure, waiting for the person to choose
  useEffect(() => { setPick(null); }, [tab, view]); // a pop-up for a company never follows the person to another view
  const [waiting, setWaiting] = useState({}); // `${company id}:${kind}` -> the matches the person has not chosen from yet
  const applyCompany = (id, company) => {
    if (!company) return;
    setCompanies((rows) => rows.map((x) => (x.id === id ? { ...x, ...company, saved: x.saved } : x)));
    setOpenCo((o) => (o && o.id === id ? { ...o, ...company, saved: o.saved } : o));
  };
  // Opens one contact our registry holds. Free, once; it stays visible after that. It never searches for anything.
  const reveal = async (c, kind) => {
    const key = `${c.id}:${kind}`;
    if (lookups[key] === "busy") return;
    setLookups((m) => ({ ...m, [key]: "busy" }));
    try { const r = await api.revealContact(c.id, kind); applyCompany(c.id, r.company); store.toast(`${kind[0].toUpperCase()}${kind.slice(1)} opened for ${c.name}.`); } catch (err) { store.toast(err.message || "Couldn't open that."); }
    setLookups((m) => { const n = { ...m }; delete n[key]; return n; });
  };
  // Opens everything our registry holds for these companies. Free: no credits are used.
  const revealMany = async (rows) => {
    const ids = rows.filter((c) => Object.keys(c.closed || {}).length).map((c) => c.id);
    if (!ids.length) return;
    try {
      const r = await api.revealMany(ids);
      (r.companies || []).forEach((co) => applyCompany(co.id, co));
      store.toast(`Opened ${(r.companies || []).length.toLocaleString()} ${(r.companies || []).length === 1 ? "company" : "companies"}. Free.`);
    } catch (err) { store.toast(err.message || "Couldn't open them."); }
  };
  const revealRow = (c) => revealMany([c]);
  const findSite = async (c, kind = "website") => {
    const key = `${c.id}:${kind}`;
    if (lookups[key] === "busy") return;
    if (lookups[key] === "options" && waiting[key]) { setPick({ company: c, kind, options: waiting[key] }); return; }
    setLookups((m) => ({ ...m, [key]: "busy" }));
    try {
      const r = SOCIAL.includes(kind) ? await api.findSocial(c.id, kind) : await api.findCompanyWebsite(c.id, kind);
      if (r.charged) announceCreditsChanged();
      if (r.company) setCompanies((rows) => rows.map((x) => (x.id === c.id ? { ...x, ...r.company, saved: x.saved } : x)));
      setOpenCo((o) => (o && o.id === c.id && r.company ? { ...o, ...r.company, saved: o.saved } : o));
      const matches = !r.found && (r.options || []).length ? r.options : null;
      setLookups((m) => { const n = { ...m }; if (r.found) delete n[key]; else n[key] = matches ? "options" : "none"; return n; });
      const listed = !r.found && r.listing && r.listing.url; // no site of its own, but the company's exact directory page: shown in the cell, no box
      if (!r.found && !listed) setPick({ company: c, kind, options: matches || [] }); // a miss opens the box too, so the person can add details and search again
      if (matches) setWaiting((w) => ({ ...w, [key]: matches }));
      if (r.found || !matches || listed) store.toast(r.found ? `Found the ${kind} for ${c.name}${r.source === "deep" ? " with the deep web search" : r.source === "web" ? " with the web search" : ""}${r.charged ? ". Credits used for this find" : ""}.` : r.note || "Nothing found.");
    } catch (err) {
      setLookups((m) => { const n = { ...m }; delete n[key]; return n; });
      store.toast(err.message || "The lookup didn't finish. Nothing was charged.");
    }
  };
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
  // Get contacts for many ticked companies at once: the ones not saved yet are saved to Unsorted, then the same cost box as in
  // Lists opens, showing the most it can cost and what comes back. Nothing is charged until the person confirms there.
  const contactCheck = useCompanyCheck({ onToast: store.toast, reload: store.reload });
  const [checking, setChecking] = useState(null);
  const [preparing, setPreparing] = useState(false);
  // A detail the register holds but we haven't shown yet (c.closed) is not missing: Reveal shows it, free. Get contacts is only for what we have nowhere.
  const missingDetail = (c) => ["website", "phone", "email"].some((k) => !c[k] && !(c.closed || {})[k]);
  const getContacts = async (list) => {
    const savedOf = (c, pool) => pool.find((a) => (a.business_record_id && a.business_record_id === c.id) || (domainOf(c.website) && a.domain === domainOf(c.website)) || a.name.toLowerCase() === String(c.name || "").toLowerCase());
    setPreparing(true);
    try {
      const missing = list.filter((c) => !savedOf(c, store.accounts));
      let fresh = [];
      if (missing.length) {
        const r = await store.save(missing.map(asAccount), "Unsorted", { quiet: true });
        if (!r) return;
        fresh = r.accounts || [];
      }
      const pool = [...fresh, ...store.accounts];
      const ids = [...new Set(list.map((c) => savedOf(c, pool)).filter(Boolean).map((a) => a.id))];
      if (ids.length) setChecking({ ids });
      else store.toast("Couldn't get these companies ready. Try again.");
    } finally {
      setPreparing(false);
    }
  };
  const callAll = async (list) => {
    const withPhone = list.filter((c) => c.phone);
    if (!withPhone.length) { store.toast("None of these companies has a phone number yet."); return; }
    // The ones not saved yet are saved in one go; the call box then shows how many will be called and what it costs.
    const savedOf = (c, pool) => pool.find((a) => (a.business_record_id && a.business_record_id === c.id) || (domainOf(c.website) && a.domain === domainOf(c.website)) || a.name.toLowerCase() === String(c.name || "").toLowerCase());
    const missing = withPhone.filter((c) => !savedOf(c, store.accounts));
    let fresh = [];
    if (missing.length) {
      const r = await store.save(missing.map(asAccount), "Unsorted", { quiet: true });
      if (!r) return;
      fresh = r.accounts || [];
    }
    const pool = [...fresh, ...store.accounts];
    const rows = withPhone.map((c) => savedOf(c, pool)).filter(Boolean);
    if (rows.length) call.open({ kind: "selected", ids: [...new Set(rows.map((r) => r.id))], name: `${rows.length.toLocaleString()} ${rows.length === 1 ? "company" : "companies"} from your search` });
    else store.toast("Couldn't save these companies for calling. Try again.");
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
    onAddToList: async (c) => { const name = await askList({ title: `Add ${c.name} to a list`, confirm: "Add" }); if (name) store.save([asAccount(c)], name); },
    onRemove: (c) => { removeCompany(c); sel.drop([c.id]); store.toast(`Hid ${c.name} from this search.`); },
    onCall: (c) => (canCall ? callOne(c) : call.open({ kind: "one", id: "", name: c.name }, true)),
    callLocked: !canCall,
    // A note goes in the company's shared notes list, with your name and the time. The company doesn't need saving first.
    onNote: async (c) => {
      const note = await askText({ title: `Note on ${c.name}`, label: "Your note", multiline: true, confirm: "Add note", maxLength: 2000 });
      if (!note || !note.trim()) return;
      try {
        await api.addLeadNoteEntry({ companyId: c.id, text: note.trim() });
        notice("Note added.");
        notesChanged();
      } catch (e) {
        notice(e.message || "The note wasn't added. Try again.");
      }
    },
  };

  const filterCount = Object.keys(formToFilters(form)).length;
  const setGroup = (k) => setGroups((g) => ({ ...g, [k]: !g[k] }));
  const firstLoad = busy && !companies.length && !people.length && view !== "map";
  const toggleFilters = () => setFiltersShown((v) => { const n = !v; try { localStorage.setItem("aivhub_find_filters", n ? "shown" : "hidden"); } catch { /* the choice just isn't remembered */ } return n; });
  const activeIn = (k) => GROUP_KEYS[k].filter((key) => isOn(form, key)).length;
  const clearGroup = (k) => setForm((f) => ({ ...f, ...Object.fromEntries(GROUP_KEYS[k].map((key) => [key, EMPTY_FORM[key]])) }));
  companies.forEach((c) => cardsById.current.set(c.id, c));
  const pickedRows = [...sel.ids].map((id) => cardsById.current.get(id)).filter(Boolean);
  // A drawn area holds every company it found on screen; a normal search is resolved on the server, up to the limit.
  const selectReach = inArea ? companies.length : Math.min(total, SELECT_ALL_LIMIT);
  const selectAllMatching = async () => {
    if (inArea || !lastQuery.current) { sel.selectAll(companies.map((c) => c.id)); return; }
    setSelecting(true);
    try {
      const r = await api.searchSelectAll({ ...lastQuery.current, limit: SELECT_ALL_LIMIT });
      (r.companies || []).forEach((c) => cardsById.current.set(c.id, { ...(cardsById.current.get(c.id) || {}), ...c }));
      sel.selectAll((r.companies || []).map((c) => c.id));
    } catch (err) {
      notice(err.message || "Couldn't select them all. Try again.");
    } finally {
      setSelecting(false);
    }
  };
  const selectedWord = sel.everything ? `All ${sel.count.toLocaleString()} selected` : `${sel.count.toLocaleString()} selected`;
  const bulkSave = async (listName) => {
    const rows = pickedRows;
    if (!rows.length) return;
    const r = await store.save(rows.map(asAccount), listName);
    if (r) sel.clear();
  };
  const field = { display: "flex", flexDirection: "column", gap: 4, flex: "1 1 0", minWidth: 0 };
  const label = { ...text, fontSize: 12, fontWeight: 600, color: C.slate };
  const check = (k, t) => (
    <label title={CHECK_TIPS[k]} style={{ ...text, fontSize: 13, display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
      <input type="checkbox" checked={form[k]} onChange={(e) => setField(k, e.target.checked)} /> {t}
    </label>
  );

  return (
    <div className="pane-root fl-root" data-active={pane} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {call.dialog}
      {pick ? <PickOptions key={`${pick.company.id}:${pick.kind}`} kind={pick.kind} company={pick.company.name} options={pick.options} anchorKey={`${pick.company.id}:${pick.kind}`} onClose={() => setPick(null)}
        onRetry={async (hint) => {
          const { company: co, kind } = pick;
          const key = `${co.id}:${kind}`;
          const r = SOCIAL.includes(kind) ? await api.findSocial(co.id, kind, hint) : await api.findCompanyWebsite(co.id, kind, hint);
          applyCompany(co.id, r.company);
          if (r.charged) announceCreditsChanged();
          const matches = !r.found && (r.options || []).length ? r.options : [];
          setWaiting((w) => ({ ...w, [key]: matches.length ? matches : null }));
          setLookups((m) => { const n = { ...m }; if (r.found) delete n[key]; else n[key] = matches.length ? "options" : "none"; return n; });
          if (r.found) store.toast(`Found the ${kind} for ${co.name}.`);
          return { done: Boolean(r.found), options: matches };
        }}
        onPick={async (o) => { const r = await api.chooseContact(pick.company.id, { kind: pick.kind, value: o.value }); applyCompany(pick.company.id, r.company);
          setLookups((m) => { const n = { ...m }; delete n[`${pick.company.id}:${pick.kind}`]; return n; }); if (r.charged) announceCreditsChanged(); store.toast(r.charged ? "Saved. Credits used for this find. It will show for this company from now on." : "Saved. It will show for this company from now on."); }} /> : null}
      <PaneSwitch value={pane} onChange={setPane}
        panes={[{ id: "chat", label: "Search" }, { id: "results", label: "Results", badge: searched && total ? total.toLocaleString() : "" }]} />
      <style>{CHAT_CSS}</style>
      <>
      <div className="fl-toolbar" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" className="ui-btn ui-btn--secondary hide-mobile" style={{ height: 40 }} aria-pressed={filtersShown} title={filtersShown ? "Hide the filters" : "Show the filters"} onClick={toggleFilters}>
          {filtersShown ? <ChevronsLeft size={15} /> : <ChevronsRight size={15} />} Filters{filterCount ? ` · ${filterCount}` : ""}
        </button>
        <form onSubmit={(e) => { setExcluded([]); if (tab === "people") searchPeople(e); else search(e); }} style={{ flex: "999 1 320px", minWidth: 0, display: "flex" }}>
          <SearchField label="Company name" title="Find a company by its name. Searches every registered company" value={form.name} onChange={(v) => setField("name", v)} placeholder="Search a company by name, e.g. Tesco, Greggs, Smith & Sons" />
        </form>
        {tab === "companies" ? <SavedSearches filters={formToFilters(form)} hasFilters={Object.keys(formToFilters(form)).some((k) => ["keyword", "sector", "sic_codes", "towns", "postcode_prefixes", "name_contains", "near", "signals"].includes(k))} onApply={applySaved} /> : null}
        <div role="tablist" aria-label="What to look for" className="fl-seg">
          {[["companies", "Companies", Building2], ["people", "People", Users]].map(([id, name, Icon]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} data-on={tab === id} className="fl-seg-btn" onClick={() => changeTab(id)}>
              <Icon size={15} /> {name}
            </button>
          ))}
        </div>
        {tab === "companies" ? (
          <div role="tablist" aria-label="Results view" className="fl-seg">
            {[["list", "List", List], ["map", "Map", MapIcon]].map(([id, name, Icon]) => (
              <button key={id} type="button" role="tab" aria-selected={view === id} data-on={view === id} className="fl-seg-btn"
                title={id === "map" ? "Search on a map: see the companies as pins and draw an area to search inside it" : "See the results as a list"}
                onClick={() => setView(id)}>
                <Icon size={15} /> {name}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="pane-root fl-body" data-active={pane} style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
      {filtersShown ? (
      <aside data-pane="chat" aria-label="Filters" className="ui-card fl-filters" style={{ padding: "4px 14px 0", display: "flex", flexDirection: "column" }}>
        <form onSubmit={(e) => { setExcluded([]); if (tab === "people") searchPeople(e); else search(e); }}>
          <div className="fl-pin">
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ ...text, fontSize: 12, fontWeight: 600, color: C.slate, textTransform: "uppercase", letterSpacing: ".04em", marginRight: "auto" }}>Filters</span>
              <button type="button" className="fl-collapse" aria-label="Hide the filters" title="Hide the filters to give the results more room" onClick={toggleFilters}><ChevronsLeft size={16} /></button>
            </div>
          </div>
          {tab === "people" ? (
            <FilterGroup title="Job title" active={activeIn("person")} open={groups.person} onToggle={() => setGroup("person")} onClear={() => clearGroup("person")}>
              <label style={field} title="A word from their role, like director or secretary"><span style={label}>Role includes</span>
                <input className="ui-input" value={form.title} onChange={(e) => setField("title", e.target.value)} placeholder="director, secretary" /></label>
            </FilterGroup>
          ) : null}
          <FilterGroup title="Industry & keywords" active={activeIn("industry")} open={groups.industry} onToggle={() => setGroup("industry")} onClear={() => clearGroup("industry")}>
            <label style={field} title="Words are matched against what each company does and its name. Related words are included, like dental for dentist"><span style={label}>Include</span>
              <input className="ui-input" value={form.sector} onChange={(e) => setField("sector", e.target.value)} placeholder="accountancy, software, a company name, or a company number" /></label>
            <label style={field} title="Leave out companies whose name or sector has any of these words"><span style={label}>Leave out</span>
              <input className="ui-input" value={form.notSector} onChange={(e) => setField("notSector", e.target.value)} placeholder="franchise, holdings" /></label>
            <div style={field} title="The register's industry codes. A short code takes every code that starts with it"><span style={label}>Industry (SIC codes)</span>
              <SicPicker value={splitList(form.sic)} labels={sicLabels} onChange={(codes, labels) => { setField("sic", codes.join(", ")); setSicLabels(labels); }} /></div>
            {check("includeSecondary", "Include side activities")}
          </FilterGroup>
          <FilterGroup title="Location" active={activeIn("location")} open={groups.location} onToggle={() => setGroup("location")} onClear={() => clearGroup("location")}>
            <div style={field}>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }} title="One or more towns, separated by commas"><span style={label}>Town / city</span>
                <input className="ui-input" value={form.town} onChange={(e) => setField("town", e.target.value)} placeholder="London, Leeds" /></label>
              <DistrictPicker town={form.town} includeClosed={form.includeClosed} postcode={form.postcode} onChange={(v) => setField("postcode", v)} />
            </div>
            <label style={field} title="Only companies whose postcode begins with this, like EC1 or M1"><span style={label}>Postcode starts with</span>
              <input className="ui-input" value={form.postcode} onChange={(e) => setField("postcode", e.target.value)} placeholder="EC1, M1" /></label>
            <label style={field} title="Leave out companies in these towns"><span style={label}>Leave out towns</span>
              <input className="ui-input" value={form.notTown} onChange={(e) => setField("notTown", e.target.value)} placeholder="Bradford" /></label>
            <div style={field} title="Companies whose registered office is in the postcode districts inside this distance">
              <span style={label}>Within</span>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <select className="ui-input" aria-label="Miles" style={{ width: 96, flex: "0 0 auto" }} value={form.nearMiles}
                  onChange={(e) => { setField("nearMiles", e.target.value); if (form.nearPostcode.trim()) lookRadius(form.nearPostcode, e.target.value); }}>
                  {RADIUS_MILES.map((m) => <option key={m} value={m}>{m} {m === 1 ? "mile" : "miles"}</option>)}
                </select>
                <input className="ui-input" aria-label="of this postcode" style={{ flex: "1 1 120px", minWidth: 0 }} value={form.nearPostcode} placeholder="of LS1 4AP"
                  onChange={(e) => setField("nearPostcode", e.target.value)} onBlur={() => lookRadius(form.nearPostcode, form.nearMiles)} />
              </div>
              {form.near?.districts?.length ? <span style={muted}>{coversText(form.near)}</span> : null}
              {form.nearError ? <span role="alert" style={{ ...muted, color: C.red || "#B42318" }}>{form.nearError}</span> : null}
            </div>
          </FilterGroup>
          <FilterGroup title="Reasons to get in touch now" active={activeIn("signals")} open={groups.signals} onToggle={() => setGroup("signals")} onClear={() => clearGroup("signals")}>
            {SIGNAL_OPTIONS.map(([key, name, tip]) => (
              <label key={key} title={tip} style={{ ...text, fontSize: 13, display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer", minHeight: 40 }}>
                <input type="checkbox" checked={form.signals.includes(key)} onChange={() => setField("signals", toggleIn(form.signals, key))} /> {name}
              </label>
            ))}
          </FilterGroup>
          <FilterGroup title="Size (filed accounts)" active={activeIn("size")} open={groups.size} onToggle={() => setGroup("size")} onClear={() => clearGroup("size")}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }} title="From each company's filed accounts category. It is not a headcount.">
              {SIZE_OPTIONS.map(([id, name]) => (
                <button key={id} type="button" title={`Only ${name} companies`} aria-label={`Size: ${name}`} className={`ui-chip${form.sizes.includes(id) ? " is-active" : ""}`} aria-pressed={form.sizes.includes(id)} onClick={() => toggleSize(id)}
                  style={form.sizes.includes(id) ? { background: "var(--ui-accent-soft)", color: "var(--ui-accent-ink)" } : undefined}>{name}</button>
              ))}
            </div>
          </FilterGroup>
          <FilterGroup title="Company" active={activeIn("company")} open={groups.company} onToggle={() => setGroup("company")} onClear={() => clearGroup("company")}>
            <label style={field} title="The legal form: Limited, LLP, PLC and so on"><span style={label}>Company type</span>
              <input className="ui-input" value={form.category} onChange={(e) => setField("category", e.target.value)} placeholder="Limited, LLP, PLC" /></label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }} title="Any of the legal forms ticked">
              {TYPE_OPTIONS.map(([id, name]) => {
                const on = (form.types || []).includes(id);
                return <button key={id} type="button" className="ui-chip" aria-pressed={on} aria-label={`Type: ${name}`} onClick={() => setField("types", on ? form.types.filter((x) => x !== id) : [...(form.types || []), id])}
                  style={on ? { background: "var(--ui-accent-soft)", color: "var(--ui-accent-ink)" } : undefined}>{name}</button>;
              })}
            </div>
            {check("noCharities", "Leave out charities")}
            <label style={field} title="Leave out these legal forms"><span style={label}>Leave out types</span>
              <input className="ui-input" value={form.notCategory} onChange={(e) => setField("notCategory", e.target.value)} placeholder="LLP" /></label>
            <div style={{ display: "flex", gap: 8 }}>
              <label style={field} title="Only companies that have existed at least this many years"><span style={label}>Trading ≥ years</span>
                <input className="ui-input" inputMode="numeric" value={form.minAge} onChange={(e) => setField("minAge", e.target.value)} placeholder="e.g. 5" /></label>
              <label style={field} title="Only companies that are no older than this many years"><span style={label}>Trading ≤ years</span>
                <input className="ui-input" inputMode="numeric" value={form.maxAge} onChange={(e) => setField("maxAge", e.target.value)} placeholder="e.g. 2" /></label>
            </div>
            {check("includeClosed", "Include closed / dissolved")}
          </FilterGroup>
          <FilterGroup title="Details we hold" active={activeIn("contact")} open={groups.contact} onToggle={() => setGroup("contact")} onClear={() => clearGroup("contact")}>
            {check("includeNonBusiness", "Include schools & community places")}{check("hasWebsite", "Has a website")}{check("hasPhone", "Has a phone")}{check("hasEmail", "Has an email")}
          </FilterGroup>
          <FilterGroup title="Your lists" active={activeIn("lists")} open={groups.lists} onToggle={() => setGroup("lists")} onClear={() => clearGroup("lists")}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {[["", "Any"], ["exclude", "Not in my lists"], ["only", "In my lists"]].map(([v, name]) => (
                <button key={name} type="button" className="ui-chip" aria-pressed={form.saved === v} onClick={() => setField("saved", v)}
                  style={form.saved === v ? { background: "var(--ui-accent-soft)", color: "var(--ui-accent-ink)" } : undefined}>{name}</button>
              ))}
            </div>
          </FilterGroup>
          <div style={{ position: "sticky", bottom: 0, background: "#fff", display: "flex", alignItems: "center", gap: 8, padding: "10px 0 12px", marginTop: "auto" }}>
            <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={resetSearch} title="Clear every filter, the drawn area and the results, and start again">
              <RotateCcw size={14} /> Clear all{filterCount ? ` · ${filterCount}` : ""}
            </button>
            <button type="submit" aria-busy={busy} className="ui-btn ui-btn--primary" style={{ marginLeft: "auto", height: 36 }} title="Search the company register. It costs no credits">
              {busy ? <Spinner size={15} /> : <Search size={15} />} {busy ? "Searching…" : tab === "people" ? "Find people" : "Find companies"}
            </button>
          </div>
        </form>
      </aside>
      ) : null}
      <div data-pane="results" className="fl-main" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {firstLoad ? (
        <div className="ui-card fl-card" style={{ overflow: "hidden", position: "relative" }}>
          <TopBar />
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: `1px solid ${C.border}` }}>
            <Spinner size={16} />
            <div style={{ ...text, fontSize: 13.5, fontWeight: 600, color: C.ink, marginRight: "auto" }}>{tab === "people" ? "Finding the people at matching companies" : searched ? "Searching" : "Opening the register"}{appliedWords(form) ? <span style={{ fontWeight: 400, color: C.slate }}> · {appliedWords(form)}</span> : null}</div>
            {searched ? <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" title="Stop this search" onClick={cancelSearch}><X size={13} /> Cancel</button> : null}
          </div>
          <TableSkeleton rows={12} cols={tab === "people" ? 6 : 7} label={tab === "people" ? "Finding the people at matching companies" : "Searching the company register"} />
        </div>
      ) : null}
      {!busy && Object.keys(didYouMean).length ? (
        <div role="status" style={{ ...muted, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          Did you mean {Object.values(didYouMean).join(", ")}?
          <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={() => {
            const next = { ...form, town: splitList(form.town).map((t) => didYouMean[t] || t).join(", ") };
            setForm(next); setDidYouMean({}); search(null, next, 0, null, undefined, undefined, true);
          }}>Use {Object.values(didYouMean).join(", ")}</button>
        </div>
      ) : null}
      {error ? (
        <div role="alert" style={{ ...muted, color: C.red, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {error}
          <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" disabled={busy} onClick={() => (tab === "people" ? searchPeople(null, form, 0) : search(null, form, 0, null))}><RefreshCw size={13} /> Try again</button>
        </div>
      ) : null}
      {!busy && !error && !searched && view !== "map" ? (
        <div className="ui-card phone-only" style={{ padding: 20, flexDirection: "column", alignItems: "flex-start", gap: 12 }}>
          <div style={{ ...text, fontSize: 15, fontWeight: 600, color: C.ink }}>No search yet</div>
          <div style={{ ...muted, fontSize: 14 }}>Ask the AI Assistant who you're after, or set the filters. The companies you find show here.</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="ui-btn ui-btn--primary" style={{ minHeight: 44 }} onClick={() => onAskAssistant?.()}><Sparkles size={15} /> Ask AI</button>
            <button type="button" className="ui-btn ui-btn--secondary" style={{ minHeight: 44 }} onClick={() => { setPane("chat"); setFiltersShown(true); }}>Set filters</button>
          </div>
        </div>
      ) : null}

      {(searched || view === "map") && !firstLoad ? (
        <div className="ui-card fl-card" data-map={view === "map" ? "true" : undefined} style={{ overflow: "hidden", position: "relative" }}>
          <TopBar show={busy} />
          {draft && !area && tab === "companies" && searched ? (
            <div role="status" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "9px 14px", borderBottom: `1px solid ${C.border}`, background: "#F3F6FF" }}>
              <span style={{ ...text, fontSize: 13, fontWeight: 600, color: C.ink }}>Draft from the AI assistant</span>
              <span style={{ ...muted, fontSize: 12.5 }}>
                {draft.asked && draft.asked < total ? `The ${draft.asked.toLocaleString()} you asked for, best matches first. ${total.toLocaleString()}${capped ? "+" : ""} match in all.` : `${total.toLocaleString()}${capped ? "+" : ""} match.`}
              </span>
              <span style={{ marginLeft: "auto", display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
                <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" disabled={!companies.length || busy} onClick={() => sel.selectAll(companies.map((c) => c.id))}>Select all {companies.length.toLocaleString()}</button>
                {draft.asked && draft.asked < total ? (
                  <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" disabled={busy} onClick={() => { pageRef.current = pageSize; setDraft({ asked: 0 }); search(null, form, 0, null, undefined, undefined, true); }}>Show all matches</button>
                ) : null}
                <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => { pageRef.current = pageSize; setDraft(null); }}>Done</button>
              </span>
            </div>
          ) : null}
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: tab === "companies" && searched && !area ? "0 14px" : "10px 14px", minHeight: 46, borderBottom: `1px solid ${C.border}`, flexWrap: "wrap" }}>
            <div style={{ ...text, fontSize: 13.5, fontWeight: 600, color: C.ink, marginRight: "auto" }}>
              {areaPending ? (areaStep.phase === "counting" ? "Looking at your area…" : "Your area is ready") : tab === "people" ? (
                <>{people.length.toLocaleString()} {people.length === 1 ? "person" : "people"} <span style={{ fontWeight: 400, color: C.slate }}>· at {peopleTotal.toLocaleString()}{capped ? "+" : ""} {peopleTotal === 1 ? "company" : "companies"}</span></>
              ) : searched && !area ? (
                <CountTiles total={total} capped={capped} saved={savedTotal} filter={form.saved} onPick={(v) => pickSaved(form.saved === v ? "" : v)} busy={busy} />
              ) : null}
            </div>
            {sort === "best" && !ranked && !area ? <span style={{ ...muted, fontSize: 12 }} title="Best match puts the companies with the most details first. It needs the register to be ranked once on the server (scripts/rank_business_records.py). Until then the newest companies come first. The Details we hold filter still works.">Newest first · ranking not run yet</span> : null}
            <span id="fl-grid-tools" style={{ display: "contents" }} />
            {!area ? (
              <ViewMenu busy={busy} sortValue={sort} sortOptions={sortOptions(icp.isSet)}
                sortLabel={(sortOptions(icp.isSet).find(([v]) => v === sort) || sortOptions(icp.isSet)[0])[1]}
                onSort={changeSort} pageSize={pageSize} pageSizes={PAGE_SIZES} onPageSize={changePageSize} />
            ) : null}
          </div>
          {tab === "companies" && !icp.loading && !icp.isSet && onSetIcp ? <IcpPrompt onSet={onSetIcp} inset /> : null}
          {broadenedNote && !busy ? (
            <div role="status" style={{ ...muted, fontSize: 12.5, padding: "8px 16px", borderBottom: `1px solid ${C.borderLight}` }}>{broadenedNote}.</div>
          ) : null}
          {understood.length ? (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", padding: "8px 16px", borderBottom: `1px solid ${C.borderLight}` }}>
              <span style={{ ...muted, fontSize: 12.5 }}>Also looking for:</span>
              {[...new Set(understood.flatMap((u) => u.terms))].map((t) => (
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
              <LeadsMap onClose={() => setView("list")} companies={companies} points={points} area={area} busy={busy} onArea={drawArea} onClear={clearArea} hint={form.sector} statusOf={statusOf} actions={mapActions} />
              {area && areaNote ? <div role="status" style={{ ...muted, marginTop: 8 }}>{areaNote}</div> : null}
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
                    ) : areaStep.inArea ? (
                      <>
                        <span style={{ ...muted, marginRight: "auto" }}>{areaStep.inArea.toLocaleString()} {areaStep.inArea === 1 ? "company is" : "companies are"} in this area, but none match your filters.</span>
                        <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" onClick={() => { const next = { ...EMPTY_FORM }; setForm(next); countArea(area, next, []); }}>Show every company in this area</button>
                      </>
                    ) : Object.keys(formToFilters(form)).length ? (
                      <>
                        <span style={{ ...muted, marginRight: "auto" }}>No company in this area matches your filters.</span>
                        <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" onClick={() => { const next = { ...EMPTY_FORM }; setForm(next); setUnderstood([]); countArea(area, next, []); }}>Show every company in this area</button>
                      </>
                    ) : <span style={muted}>Nothing found inside this area. Our data covers the UK, so draw over a UK town or a few postcodes, or use "Redraw area" for a bigger area.</span>
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
          {tab === "people" ? (
            <>
              {filling ? (
                <div role="status" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "8px 14px", borderBottom: `1px solid ${C.borderLight}`, ...text, fontSize: 13, color: C.textInk }}>
                  <Spinner size={14} /> Reading the registry for the people at {filling.done} of {filling.of} companies. Free.
                  <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => { fillRun.current += 1; setFilling(null); searchPeople(null, form, 0); }}>Stop and show what is found</button>
                </div>
              ) : fillIds.length ? (
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "8px 14px", borderBottom: `1px solid ${C.borderLight}`, ...muted, fontSize: 12.5 }}>
                  Some of these companies have no people on file yet. Reading them from the registry is free.
                  <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" disabled={busy} title="Read the registry for the best-ranked companies that have no people on file yet. Free" onClick={() => fillPeople(fillIds)}>
                    <Users size={14} /> Find people at the next {fillIds.length} companies
                  </button>
                </div>
              ) : null}
              {people.length && peopleOf != null && peopleOf > peopleTotal ? (
                <div style={{ ...muted, fontSize: 12.5, padding: "6px 14px" }}>People are on file for {peopleTotal.toLocaleString()} of {peopleOf.toLocaleString()} matching companies.</div>
              ) : null}
              {people.length ? (
                <PeopleTable rows={people} onOpen={setOpenCo} isSaved={(c) => isSaved(c) || c.saved} onSave={saveOne} />
              ) : searched && !busy && !filling ? (
                <div style={{ ...muted, padding: 16 }}>
                  {fillIds.length
                    ? `No people are on file yet for these companies${form.title ? ` with "${form.title}" in their role` : ""}. Use "Find people" above to read them from the registry.`
                    : `No current directors or officers are listed for these companies${form.title ? ` with "${form.title}" in their role` : ""}. Try another role word, or widen the search.`}
                </div>
              ) : null}
              {peopleTotal > 0 || people.length ? <Pager page={page} size={pageSize} total={peopleTotal} capped={capped} shown={new Set(people.map((x) => x.company.id)).size} onPage={goPage} busy={busy} unit="Companies" /> : null}
            </>
          ) : (
            <>
              <SelectionBar count={sel.count} label={selectedWord} onClear={sel.clear}>
                <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" title="Save the ticked companies to your Unsorted list" onClick={() => bulkSave("Unsorted")}><Plus size={14} /> Save {sel.count.toLocaleString()}</button>
                <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" title="Put the ticked companies in a list you name" onClick={async () => { const name = await askList({ title: `Add ${pickedRows.length.toLocaleString()} ${pickedRows.length === 1 ? "company" : "companies"} to a list`, confirm: "Add" }); if (name) bulkSave(name); }}><List size={14} /> Add to list</button>
                <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" title="Put the ticked companies in your Favourites list" onClick={() => bulkSave(FAVOURITES)}><Star size={14} /> Favourite</button>
                {pickedRows.some(missingDetail) ? (
                  <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" disabled={preparing || contactCheck.job?.status === "running"}
                    title="Look for the website, phone and email these companies are missing. You see the most it can cost, and what you get, before anything is charged"
                    onClick={() => getContacts(pickedRows.filter(missingDetail))}>
                    <ShieldCheck size={14} /> {preparing ? "Getting ready…" : `Get contacts (${pickedRows.filter(missingDetail).length.toLocaleString()})`}
                  </button>
                ) : null}
                {pickedRows.some((c) => Object.keys(c.closed || {}).length) ? (
                  <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" title="Show the website, phone and email we hold for the ticked companies. Free." onClick={() => revealMany(pickedRows)}>Reveal {pickedRows.filter((c) => Object.keys(c.closed || {}).length).length.toLocaleString()}</button>
                ) : null}
                <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" disabled={!pickedRows.some((c) => c.phone)} title="Save them and have your AI caller phone the ones with a number" onClick={() => callAll(pickedRows)}>Call</button>
                <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" title="Hide the ticked companies from this search" onClick={() => { const n = pickedRows.length; pickedRows.forEach(removeCompany); sel.clear(); notice(`Hid ${n.toLocaleString()} ${n === 1 ? "company" : "companies"} from this search.`); }}><X size={14} /> Remove</button>
              </SelectionBar>
              <CheckProgress check={contactCheck} pendingCount={0} onRecheck={() => {}} onFilter={() => {}} />
              {checking ? <CheckDialog ids={checking.ids} mode="contacts" onStart={(...a) => { sel.clear(); return contactCheck.start(...a); }} onClose={() => setChecking(null)} /> : null}
              {inArea ? (
                <div role="status" style={{ ...muted, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "8px 14px", borderBottom: `1px solid ${C.border}` }}>
                  <MapIcon size={14} aria-hidden="true" /> <span>Showing the {companies.length.toLocaleString()} {companies.length === 1 ? "company" : "companies"} the map found.</span>
                  <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={clearArea}>Show the whole list</button>
                  <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => setView("map")}>Back to the map</button>
                </div>
              ) : null}
              <SelectAllNotice sel={sel} pageIds={companies.map((c) => c.id)} total={inArea ? companies.length : total} capped={!inArea && capped} reach={selectReach} busy={selecting} onSelectAll={selectAllMatching} />
              {companies.length ? (
                <CompaniesTable onGetContacts={getContacts} busy={busy} rows={companies} picked={sel.ids} activeId={openCo?.id} grouped={sort === "best" && ranked && !area} tiers={tiers} capped={capped}
                  showFit={icpSet} fitSorted={sort === "fit"} onSortFit={area ? undefined : () => changeSort("fit")}
                  onPick={sel.toggle}
                  onPickAll={() => sel.togglePage(companies.map((c) => c.id))}
                  onOpen={setOpenCo} isSaved={(c) => isSaved(c) || c.saved} onSave={saveOne} onFindSite={findSite} onReveal={reveal} onRevealRow={revealRow} lookups={lookups} />
              ) : searched && !inArea && !busy ? (
                <div style={{ ...muted, padding: 16, display: "grid", gap: 8, justifyItems: "start" }}>
                  {nameAsKeywordTown(form.name) ? (
                    <>
                      <div>No company is named "{form.name.trim()}".</div>
                      <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={() => { const g = nameAsKeywordTown(form.name); const next = { ...form, name: "", sector: g.keyword, town: g.town }; setForm(next); search(null, next, 0, null, undefined, undefined, true); }}>
                        Search {nameAsKeywordTown(form.name).keyword} in {nameAsKeywordTown(form.name).town} instead
                      </button>
                    </>
                  ) : <div>No companies match these filters. Try a wider town, a broader industry word, or tick "Include closed".</div>}
                </div>
              ) : null}
              {companies.length && !area && !(draft?.asked && draft.asked < total) ? <Pager page={page} size={pageSize} total={total} capped={capped} shown={companies.length} onPage={goPage} busy={busy} /> : null}
            </>
          )}
        </div>
      ) : null}
      </div>
      </div>
      <CompanyDrawer openCo={openCo} store={store} onClose={() => setOpenCo(null)}
        saved={openCo ? store.accounts.find((a) => a.business_record_id && a.business_record_id === openCo.id) || null : null}
        onOpenPage={openCo && onOpenCompany ? () => { const id = openCo.id; setOpenCo(null); onOpenCompany(id); } : null}
        contacts={openCo ? <ContactsPanel key={openCo.id} company={openCo} /> : null}
        saveAction={openCo ? (isSaved(openCo) || openCo.saved ? <span style={{ ...text, fontSize: 13, color: C.green, display: "inline-flex", alignItems: "center", gap: 4 }}><Check size={14} /> Saved</span>
          : <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" title="Save this company to your Unsorted list" onClick={() => saveOne(openCo)}><Plus size={14} /> Save</button>) : null}
        actions={openCo ? (
          <>
            {onOpenCompany ? <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" title="The full page: why now, people and contact details" onClick={() => { const id = openCo.id; setOpenCo(null); onOpenCompany(id); }}>Open page</button> : null}
            <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" title="Save this company to your Favourites list" onClick={() => store.save([asAccount(openCo)], FAVOURITES)}><Star size={14} /> Favourite</button>
            {openCo.phone ? <CallButton label="Save & call" lockedLabel="Call · add Voice" variant="ghost" title="Save it to your Unsorted list and have your AI caller phone them" onClick={() => (canCall ? callOne(openCo) : call.open({ kind: "one", id: "", name: openCo.name }, true))} onLocked={() => call.open({ kind: "one", id: "", name: openCo.name }, true)} /> : null}
          </>
        ) : null} />


      </>
    </div>
  );
}

export function FindLeadsView({ store, listsStore, onGo, incoming, onAskAssistant, importAsk, onOpenCompany }) {
  const [sub, setSub] = useState("search");
  useEffect(() => { if (importAsk) setSub("import"); }, [importAsk]);
  return (
    <div className="fl-view" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {sub === "import" ? (
        <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" style={{ alignSelf: "flex-start" }} onClick={() => setSub("search")}>
          <ArrowLeft size={14} /> Back to Find Leads
        </button>
      ) : null}
      <div style={sub === "search" ? { display: "contents" } : { display: "none" }}><FindLeadsSearch store={store} listsStore={listsStore} incoming={incoming} onAskAssistant={onAskAssistant} onOpenCompany={onOpenCompany} onSetIcp={onGo ? () => onGo("business") : undefined} /></div>
      {sub === "import" && <ImportView store={store} onGo={onGo} onAskAi={() => setSub("search")} />}
    </div>
  );
}
