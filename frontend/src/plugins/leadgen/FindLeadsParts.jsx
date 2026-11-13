import React, { useEffect, useRef, useState } from "react";
import { GridTools } from "../../components/GridTools";
import { openPhone } from "../../utils/humanCall";
import { BadgeCheck, Briefcase, Check, ChevronDown, ChevronLeft, ChevronRight, ExternalLink, Globe, Link2, Mail, Phone, PhoneCall, Plus, Search, SlidersHorizontal, X, XCircle } from "lucide-react";
import { C, FONT_BODY } from "../../tokens";
import { api } from "../../api/apiClient";
import { domainOf } from "./AccountsViews";
import { useLookupPrice, useRatePrice } from "./CreditsChip";
import { NotesButton } from "./Notes";
import { FitBadge, SignalTags } from "./FitParts";
import { displayName, legalTag } from "./companyLogic";

const text = { fontFamily: FONT_BODY };
const muted = { ...text, fontSize: 13, color: C.slate, lineHeight: 1.5 };

export const SIZE_LABEL = { micro: "Micro", small: "Small", medium_large: "Medium / large", dormant: "Dormant" };

// What each group of results means, in the words shown above it.
export const PROFILE = {
  full: { label: "Full profiles", short: "Full", note: "Website, phone, email and more on file", fg: C.green, bg: C.greenSoft },
  partial: { label: "Partial profiles", short: "Partial", note: "Some contact details on file", fg: C.amber, bg: C.amberSoft },
  basic: { label: "Basic records", short: "Basic", note: "Registry facts only: name, address, sector, status", fg: C.slate, bg: C.paperSoft },
};

// "47110 - Retail sale in non-specialised stores" reads better in a table as the words alone.
export const plainSector = (v) => String(v || "").replace(/^\d{4,5}\s*-\s*/, "");

export function ProfileBadge({ profile }) {
  const p = PROFILE[profile] || PROFILE.basic;
  return <span title={p.note} style={{ ...text, fontSize: 11, fontWeight: 600, padding: "2px 7px", borderRadius: 999, background: p.bg, color: p.fg, whiteSpace: "nowrap" }}>{p.short}</span>;
}

// The company's own logo, read from its website by our server (the browser never contacts the company's site), a few at a time.
const logoCache = new Map(); // company id -> object URL, or "" when there is none
const logoQueue = [];
let logoRunning = 0;
function nextLogo() {
  while (logoRunning < 4 && logoQueue.length) {
    const { id, done } = logoQueue.shift();
    logoRunning += 1;
    api.companyLogo(id)
      .then((blob) => { const url = blob && blob.size ? URL.createObjectURL(blob) : ""; logoCache.set(id, url); done(url); })
      .catch(() => { logoCache.set(id, ""); done(""); })
      .finally(() => { logoRunning -= 1; nextLogo(); });
  }
}
function useLogo(id, hasSite) {
  const [src, setSrc] = useState(() => (id && logoCache.get(id)) || "");
  useEffect(() => {
    if (!id || !hasSite) { setSrc(""); return undefined; }
    if (logoCache.has(id)) { setSrc(logoCache.get(id)); return undefined; }
    let live = true;
    logoQueue.push({ id, done: (url) => { if (live) setSrc(url); } });
    nextLogo();
    return () => { live = false; };
  }, [id, hasSite]);
  return src;
}

// The logo when there is one, otherwise a coloured tile with the company's initials.
export function CompanyAvatar({ c, size = 32 }) {
  const logo = useLogo(c && c.id, Boolean(c && (c.website || c.web_website)));
  return <Avatar name={c ? c.name : ""} size={size} logo={logo} />;
}

export function Avatar({ name, size = 32, logo = "" }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => { setBroken(false); }, [logo]);
  if (logo && !broken) {
    return <img src={logo} alt="" onError={() => setBroken(true)} style={{ width: size, height: size, borderRadius: 6, flexShrink: 0, objectFit: "contain", background: "#fff", border: `1px solid ${C.borderLight}`, boxSizing: "border-box", padding: 2 }} />;
  }
  const words = String(name || "?").replace(/\b(ltd|limited|plc|llp|the)\b/gi, "").trim().split(/\s+/).filter(Boolean);
  const initials = ((words[0] || "?")[0] + (words[1] ? words[1][0] : "")).toUpperCase();
  let h = 0;
  for (const ch of String(name || "")) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return (
    <span aria-hidden="true" style={{ width: size, height: size, borderRadius: 6, flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", background: `hsl(${h} 55% 92%)`, color: `hsl(${h} 45% 30%)`, fontSize: size * 0.38, fontWeight: 700, ...text }}>
      {initials}
    </span>
  );
}

// All / New to you / Saved as underlined tabs: pick one to show only those.
// The first of website, phone and email this row has nothing for (and nothing held back behind Reveal), or "".
const firstMissing = (c) => ["website", "phone", "email"].find((k) => !c[k] && !(c.closed || {})[k] && !c[`web_${k}`] && !c[`confirmed_${k}`] && !(k === "website" && c.listing_page?.url)) || "";

export function CountTiles({ total, capped, saved, filter, onPick, busy }) {
  const plus = capped ? "+" : "";
  const known = saved != null; // the saved count arrives a moment after the page: until then a dash, never a wrong 0
  const net = Math.max(total - (saved || 0), 0);
  const tiles = [
    ["", "All", total, plus, "Every match"],
    ["exclude", "New to you", known ? net : null, plus, "Not in any of your lists yet"],
    ["only", "Saved", known ? saved : null, "", "Already in one of your lists"],
  ];
  return (
    <div role="group" aria-label="Show" style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
      {tiles.map(([id, label, n, extra, tip]) => {
        const on = (filter || "") === id;
        return (
          <button key={label} type="button" title={tip} aria-pressed={on} disabled={busy} onClick={() => onPick(id)}
            style={{ all: "unset", cursor: "pointer", boxSizing: "border-box", height: 46, display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap", borderBottom: `2px solid ${on ? C.cobalt : "transparent"}`, ...text, fontSize: 13.5, opacity: busy ? 0.6 : 1 }}>
            <span style={{ color: on ? C.ink : C.slate, fontWeight: on ? 600 : 500 }}>{label}</span>
            <span style={{ color: on ? C.ink : C.slate, fontVariantNumeric: "tabular-nums" }}>{n == null ? "…" : `${Number(n).toLocaleString()}${extra}`}</span>
          </button>
        );
      })}
    </div>
  );
}

// "View · Best match" button; opens the sort order and results-per-page choices.
export function ViewMenu({ sortLabel, sortValue, sortOptions, onSort, pageSize, pageSizes, onPageSize, busy }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  const row = (on) => ({ all: "unset", cursor: "pointer", boxSizing: "border-box", width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 6, ...text, fontSize: 13, color: C.ink, fontWeight: on ? 600 : 400, background: on ? C.paperSoft : "transparent" });
  return (
    <div ref={box} style={{ position: "relative" }}>
      <button type="button" aria-haspopup="true" aria-expanded={open} disabled={busy} onClick={() => setOpen((v) => !v)}
        style={{ all: "unset", cursor: busy ? "default" : "pointer", boxSizing: "border-box", height: 34, padding: "0 12px", display: "inline-flex", alignItems: "center", gap: 7, border: `1px solid ${C.border}`, borderRadius: 8, background: "#fff", ...text, fontSize: 13, color: C.ink, whiteSpace: "nowrap", opacity: busy ? 0.6 : 1 }}>
        <SlidersHorizontal size={14} aria-hidden="true" />
        View · {sortLabel}
      </button>
      {open ? (
        <div role="menu" style={{ position: "absolute", right: 0, top: 40, zIndex: 20, width: 220, padding: 6, background: "#fff", border: `1px solid ${C.border}`, borderRadius: 10, boxShadow: "0 8px 24px rgba(15,23,42,0.12)" }}>
          <div style={{ ...text, fontSize: 11, fontWeight: 600, color: C.slate, padding: "6px 10px 4px", textTransform: "uppercase", letterSpacing: 0.4 }}>Sort</div>
          {sortOptions.map(([v, l]) => (
            <button key={v} type="button" role="menuitemradio" aria-checked={sortValue === v} style={row(sortValue === v)} onClick={() => { onSort(v); setOpen(false); }}>
              <span style={{ width: 14, display: "inline-flex" }}>{sortValue === v ? <Check size={13} aria-hidden="true" /> : null}</span>{l}
            </button>
          ))}
          <div style={{ ...text, fontSize: 11, fontWeight: 600, color: C.slate, padding: "10px 10px 4px", textTransform: "uppercase", letterSpacing: 0.4 }}>Per page</div>
          {pageSizes.map((n) => (
            <button key={n} type="button" role="menuitemradio" aria-checked={pageSize === n} style={row(pageSize === n)} onClick={() => { onPageSize(n); setOpen(false); }}>
              <span style={{ width: 14, display: "inline-flex" }}>{pageSize === n ? <Check size={13} aria-hidden="true" /> : null}</span>{n}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// One collapsible group in the filters column, with how many of its filters are on and a × to clear them.
export function FilterGroup({ title, active = 0, onClear, open, onToggle, children }) {
  return (
    <section style={{ borderBottom: `1px solid ${C.borderLight}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 4px 10px 2px" }}>
        <button type="button" aria-expanded={open} onClick={onToggle}
          style={{ all: "unset", cursor: "pointer", flex: 1, display: "flex", alignItems: "center", gap: 8, ...text, fontSize: 13.5, fontWeight: 600, color: C.ink }}>
          {active ? <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 3, background: C.cobalt }} /> : null}
          {title}
        </button>
        {active ? (
          <button type="button" title={`Clear ${title}`} aria-label={`Clear ${title}`} onClick={onClear}
            style={{ all: "unset", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 3, ...text, fontSize: 11.5, color: C.slate, background: C.paperSoft, borderRadius: 999, padding: "1px 7px" }}>
            {active} <X size={11} />
          </button>
        ) : null}
        <button type="button" aria-label={open ? `Hide ${title}` : `Show ${title}`} onClick={onToggle} style={{ all: "unset", cursor: "pointer", display: "inline-flex", color: C.slate }}>
          <ChevronDown size={15} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
        </button>
      </div>
      {open ? <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "0 2px 14px" }}>{children}</div> : null}
    </section>
  );
}

const th = { ...text, fontSize: 11.5, fontWeight: 600, color: C.slate, textTransform: "uppercase", letterSpacing: ".04em", textAlign: "left", padding: "9px 12px", background: "#FAFBFC", borderBottom: `1px solid ${C.border}`, position: "sticky", top: 0, zIndex: 3, whiteSpace: "nowrap" };
const td = { ...text, fontSize: 13, color: C.textInk, padding: "9px 12px", borderBottom: `1px solid ${C.borderLight}`, verticalAlign: "middle" };
const pinned = (left, z = 2) => ({ position: "sticky", left, zIndex: z, background: "#fff" });
// Pinned by default through GridTools, so the person can unpin them and the unpin is remembered.
const COMPANY_PIN = ["Company"];
const NAME_PIN = ["Name"];

function Cell({ children, style, title, onClick }) {
  return <td style={{ ...td, ...style }} title={title || undefined} onClick={onClick}>{children}</td>;
}

function link(url) {
  const d = domainOf(url);
  if (!d) return null;
  return <a href={String(url).startsWith("http") ? url : `https://${url}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: C.cobalt, display: "inline-flex", alignItems: "center", gap: 3 }}>{d} <ExternalLink size={11} /></a>;
}

// Where the contact is on file: shown as-is when we hold it, otherwise a button that opens the profile to look for it.
export function Reach({ value, kind, onFind, web, state, missed, closed, onOpen, confirmed, who, listing, quiet, first, onGet }) {
  const price = useLookupPrice();
  // No website of its own, but the company's exact page on a directory or social site: shown as that, with the site's name.
  if (!value && !web && kind === "website" && listing && listing.url) {
    return <span style={{ whiteSpace: "nowrap" }} title={`${listing.why || ""}. This is the company's page on ${listing.site}, not a website of its own.`}>
      <a href={listing.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: C.cobalt, display: "inline-flex", alignItems: "center", gap: 3 }}>Listed on {listing.site} <ExternalLink size={11} /></a>{" "}
      <span style={{ ...text, fontSize: 10.5, color: listing.confirmed ? C.green : C.slate }}>{listing.confirmed ? "page confirmed" : "unconfirmed"}</span></span>;
  }
  if (!value && closed) return <span style={{ color: C.slateLight }} title="We hold this. Use Reveal on the row">Held</span>;
  if (!value && web) {
    return <span title={confirmed ? "Confirmed by the business, through a form we emailed it" : "Found by a web search for this company"} style={{ whiteSpace: "nowrap" }}>{kind === "website" ? link(web) : kind === "phone" ? <a href={`tel:${String(web).replace(/\s+/g, "")}`} onClick={(e) => e.stopPropagation()} style={{ color: C.textInk, fontVariantNumeric: "tabular-nums" }}>{web}</a> : web} <span style={{ ...text, fontSize: 10.5, color: C.slate }}>web</span></span>;
  }
  const busyHere = state === "busy"; // this cell's own lookup; the other cell in the row is never touched by it
  if (!value && busyHere) return <span style={{ ...muted, fontSize: 12 }}>Looking…</span>;
  // The search found close matches and the person has not chosen yet: reopen them, no new search.
  if (!value && state === "options") return <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" title="Check the closest matches and choose the right one" onClick={(e) => { e.stopPropagation(); onFind(); }}><Search size={13} /> Check matches</button>;
  // A lookup that ran and found nothing is shown as that, also after a refresh. It stays a button: not finding it is not proof it is not there.
  if (!value && (state === "none" || missed)) {
    const on = missed ? new Date(missed) : null;
    const date = on && !Number.isNaN(on.getTime()) ? ` on ${on.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })}` : "";
    return (
      <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={(e) => { e.stopPropagation(); onFind(); }}
        title={`We looked${date} and nothing confirmed turned up for the ${kind}. That doesn't mean there isn't one. Search again.`}>
        <XCircle size={13} color={C.red} aria-hidden="true" /> Nothing confirmed · search again
      </button>
    );
  }
  if (value) return kind === "phone" ? <><a href={`tel:${value.replace(/\s+/g, "")}`} onClick={(e) => e.stopPropagation()} style={{ color: C.textInk, fontVariantNumeric: "tabular-nums" }}>{value}</a> <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" title="Call this number from your browser" aria-label={`Call ${who || value} in the browser`} onClick={(e) => { e.stopPropagation(); openPhone({ number: value, name: who || "" }); }}><PhoneCall size={13} /></button></> : <a href={`mailto:${value}`} onClick={(e) => e.stopPropagation()} style={{ color: C.textInk }}>{value}</a>;
  const cost = price || "credits";
  // One quiet "Get contacts" per row, in the first empty cell; the other empty cells stay plain. The most it can cost shows on hover.
  if (quiet && onGet) {
    if (!first) return <span style={{ color: C.slateLight }} aria-hidden="true">–</span>;
    return <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" title={`Look for the website, phone and email this company is missing. ${cost} at most, only charged for what is found. You see the price before anything is charged`} onClick={(e) => { e.stopPropagation(); onGet(); }}><Search size={13} /> Get contacts</button>;
  }
  const tip = kind === "email" ? `Look for this company's email. ${cost} if found. Nothing is charged for a miss` : `Look for this company's ${kind}. ${cost} if found, the same whether the web search or the deep web search finds it. We search the web first, and run the deep web search only if that finds nothing. Nothing is charged for a miss`;
  const Icon = kind === "phone" ? Phone : kind === "website" ? Globe : Mail;
  return <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" title={tip} onClick={(e) => { e.stopPropagation(); onFind(); }}><Icon size={13} /> {kind === "phone" ? "Find phone" : kind === "website" ? "Find website" : "Find email"}<span style={{ ...muted, fontSize: 11, marginLeft: 4 }}>· {price ? `${price} if found` : "charged if found"}</span></button>;
}

const FbIcon = ({ size = 16 }) => <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M13.5 21v-7.5h2.6l.4-3h-3V8.6c0-.9.3-1.5 1.5-1.5h1.6V4.4c-.3 0-1.2-.1-2.3-.1-2.3 0-3.9 1.4-3.9 4v2.2H7.8v3h2.6V21h3.1z" /></svg>;
const XIcon = ({ size = 16 }) => <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M17.8 3h3.1l-6.8 7.7L22 21h-6.3l-4.9-6.4L5.2 21H2.1l7.3-8.3L2 3h6.4l4.4 5.9L17.8 3zm-1.1 16.2h1.7L7.3 4.7H5.5l11.2 14.5z" /></svg>;

const IgIcon = ({ size = 16 }) => <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3.5" y="3.5" width="17" height="17" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.2" cy="6.8" r="0.8" fill="currentColor" /></svg>;

const NETWORKS = [
  { k: "website", label: "Website", Icon: Link2 },
  { k: "linkedin", label: "LinkedIn page", Icon: Briefcase },
  { k: "facebook", label: "Facebook page", Icon: FbIcon },
  { k: "x", label: "X profile", Icon: XIcon },
  { k: "instagram", label: "Instagram profile", Icon: IgIcon },
];

// Every public page we hold for the company, as icons: a link when we have it, a faint button that looks for just that page when we do not.
// Each icon works on its own: the website never searches for LinkedIn, and LinkedIn never searches for Facebook.
function LinksCell({ c, onFind, onReveal, lookups }) {
  const socialPrice = useRatePrice("lead_social");
  const siteLookup = useLookupPrice();
  return (
    <span style={{ display: "inline-flex", gap: 9, alignItems: "center" }}>
      {NETWORKS.map(({ k, label, Icon }) => {
        const url = k === "website" ? c.website || c.web_website : (c.links || {})[k];
        const state = (lookups || {})[`${c.id}:${k}`];
        const href = url && (/^https?:/i.test(url) ? url : `https://${url}`);
        const wrap = { display: "inline-flex", alignItems: "center" };
        const anchor = k === "website" ? {} : { "data-reach": `${c.id}:${k}` };
        if (href) return <span key={k} {...anchor} style={wrap}><a href={href} target="_blank" rel="noreferrer" title={label} aria-label={label} onClick={(e) => e.stopPropagation()} style={{ color: C.ink, display: "inline-flex" }}><Icon size={17} /></a></span>;
        if (k === "website" && (c.closed || {}).website) return <span key={k} style={wrap} title="We hold this. Use Reveal on the row"><span style={{ color: C.slateLight, opacity: 0.5, display: "inline-flex" }}><Icon size={17} /></span></span>;
        const pending = state === "options";
        const tip = state === "busy" ? "Looking…" : pending ? "Check the closest matches and choose the right one" : state === "none" || (c.missed || {})[k] ? `Not found right now. Try again later` : `Find the ${label.toLowerCase()}${(k === "website" ? siteLookup : socialPrice) ? ` · ${k === "website" ? siteLookup : socialPrice} if found` : ""}`;
        return (
          <span key={k} {...anchor} style={wrap}>
            <button type="button" title={tip} aria-label={pending ? `Check matches for the ${label}` : `Find the ${label}`} disabled={state === "busy"} onClick={(e) => { e.stopPropagation(); onFind(c, k); }}
              style={{ all: "unset", cursor: "pointer", display: "inline-flex", color: pending ? C.cobalt : C.slate, opacity: pending ? 1 : state === "busy" ? 0.6 : 0.35, borderBottom: pending ? `2px solid ${C.cobalt}` : "2px solid transparent" }}>
              <Icon size={17} />
            </button>
          </span>
        );
      })}
    </span>
  );
}

function SaveCell({ saved, onSave }) {
  return saved
    ? <span style={{ ...text, fontSize: 12.5, color: C.green, display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}><Check size={14} /> Saved</span>
    : <button type="button" title="Save this company to your Unsorted list" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={(e) => { e.stopPropagation(); onSave(); }}><Plus size={14} /> Save</button>;
}

// Results in "Best match" order come in three groups; a header marks where each begins.
function Divider({ profile, count, cols }) {
  const p = PROFILE[profile] || PROFILE.basic;
  return (
    <tr>
      <td colSpan={cols} style={{ ...text, padding: "10px 12px", background: p.bg, color: p.fg, fontSize: 12.5, fontWeight: 600, borderBottom: `1px solid ${C.border}`, borderTop: `1px solid ${C.border}` }}>
        {p.label}{count != null ? ` · ${Number(count.n).toLocaleString()}${count.plus}` : ""} <span style={{ fontWeight: 400 }}>· {p.note}</span>
      </td>
    </tr>
  );
}

export function CompaniesTable({ onGetContacts, rows, picked, onPick, onPickAll, onOpen, isSaved, onSave, tiers, capped, grouped, activeId, onFindSite, onReveal, onRevealRow, lookups, busy, showFit = false, fitSorted = false, onSortFit }) {
  const allOn = rows.length > 0 && rows.every((c) => picked.has(c.id));
  const cols = showFit ? 11 : 10;
  const seen = new Set();
  let last = null; // a divider is drawn whenever the group changes, so no row ever sits under the wrong heading
  return (
    <>
    <GridTools id="find-companies" pinned={COMPANY_PIN} into="fl-grid-tools" />
    <div className="ui-scroll fl-table" aria-busy={busy || undefined} style={{ opacity: busy ? 0.55 : 1, transition: "opacity .15s" }}>
      <table style={{ borderCollapse: "separate", borderSpacing: 0, width: "100%", minWidth: showFit ? 1200 : 1020 }}>
        <thead>
          <tr>
            <th style={{ ...th, ...pinned(0, 4), width: 48, padding: 0, background: "#FAFBFC" }}><label className="row-tick" title="Select every company shown"><input type="checkbox" aria-label="Select every company shown" checked={allOn} onChange={(e) => onPickAll(e.target.checked)} /></label></th>
            <th style={{ ...th, background: "#FAFBFC", minWidth: 260, maxWidth: 320 }}>Company</th>
            {showFit ? (
              <th style={th} aria-sort={fitSorted ? "descending" : "none"}>
                <button type="button" onClick={onSortFit} disabled={busy || fitSorted || !onSortFit} title={fitSorted ? "Sorted by best fit" : "Sort by best fit"}
                  style={{ all: "unset", cursor: fitSorted ? "default" : "pointer" }}>Fit{fitSorted ? " ↓" : ""}</button>
              </th>
            ) : null}
            <th style={th}>Industry</th>
            <th style={th}>Location</th>
            <th style={th}>Website</th>
            <th style={th}>Phone</th>
            <th style={th}>Email</th>
            <th style={th} title="Website, LinkedIn, Facebook and X. A faint icon means we have not found that page yet: click it to look.">Links</th>
            <th style={th} title="From the company's filed accounts, not headcount">Size (accounts)</th>
            <th style={{ ...th, textAlign: "right" }} aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const head = grouped && c.profile !== last ? c.profile : null;
            last = c.profile;
            const firstOfGroup = head && !seen.has(head);
            if (head) seen.add(head);
            const groupCount = head && tiers ? tiers[head] : null; // null when it can't be known (past the 10,000 counted)
            const tier = firstOfGroup && groupCount != null ? { n: groupCount, plus: tiers.capped && groupCount >= 10000 ? "+" : "" } : null;
            const on = picked.has(c.id);
            const bg = activeId === c.id ? C.cobaltSoft : on ? "#F6F8FE" : "#fff";
            return (
              <React.Fragment key={c.id}>
                {head ? <Divider profile={head} count={tier} cols={cols} /> : null}
                <tr onClick={() => onOpen(c)} style={{ cursor: "pointer", background: bg }} data-company-row={c.id}>
                  <Cell style={{ ...pinned(0), width: 48, padding: 0, background: bg }} onClick={(e) => e.stopPropagation()}>
                    <label className="row-tick" title="Select this company"><input type="checkbox" aria-label={`Select ${c.name}`} checked={on} onChange={() => onPick(c.id)} /></label>
                  </Cell>
                  <Cell style={{ background: bg, minWidth: 260, maxWidth: 320 }} title={c.name}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <CompanyAvatar c={c} />
                      <div style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                        <div style={{ fontWeight: 600, color: C.ink, display: "flex", gap: 6, alignItems: "center", whiteSpace: "nowrap" }}>
                          <span title={c.name} style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{displayName(c.name)}</span>
                          {legalTag(c.company_category, c.registration_number) ? <span style={{ ...text, fontSize: 10.5, fontWeight: 600, color: C.slate, background: C.paperSoft, borderRadius: 4, padding: "1px 5px" }}>{legalTag(c.company_category, c.registration_number)}</span> : null}
                          <NotesButton companyId={c.id} name={c.name} />
                          {c.tier === "premises_listing" ? <span title="Listed as a premises (for example a food register), not matched to a company number" style={{ ...text, fontSize: 11, color: C.slate }}>Premises listing</span> : c.tier !== "verified_registry" ? <span title="Found on the web, not read from the official registry" style={{ ...text, fontSize: 11, color: C.slate }}>Web</span> : null}
                          {grouped ? null : <ProfileBadge profile={c.profile} />}
                        </div>
                        <div style={{ ...muted, fontSize: 11.5, whiteSpace: "nowrap" }}>{c.registration_number ? `No. ${c.registration_number}` : ""}</div>
                        {c.signals?.length ? <div style={{ marginTop: 3 }}><SignalTags signals={c.signals} /></div> : null}
                      </div>
                    </div>
                  </Cell>
                  {showFit ? <Cell style={{ maxWidth: 240 }}><FitBadge fit={c.fit} /></Cell> : null}
                  <Cell style={{ maxWidth: 210, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={plainSector(c.industry)}>{plainSector(c.industry) || "–"}</Cell>
                  <Cell style={{ whiteSpace: "nowrap" }}>{[c.region, c.postcode].filter(Boolean).join(" ") || "–"}</Cell>
                  <Cell style={{ whiteSpace: "nowrap" }}><span data-reach={`${c.id}:website`}>{link(c.website) || <Reach value="" kind="website" quiet first={firstMissing(c) === "website"} onGet={() => onGetContacts?.([c])} listing={c.listing_page} web={c.confirmed_website || c.web_website} confirmed={Boolean(c.confirmed_website)} closed={(c.closed || {}).website} onOpen={() => onReveal(c, "website")} state={(lookups || {})[`${c.id}:website`]} missed={(c.missed || {}).website} onFind={() => onFindSite(c, "website")} />}</span></Cell>
                  <Cell style={{ whiteSpace: "nowrap" }}><span data-reach={`${c.id}:phone`}><Reach value={c.phone} who={c.name} kind="phone" quiet first={firstMissing(c) === "phone"} onGet={() => onGetContacts?.([c])} web={c.confirmed_phone || c.web_phone} confirmed={Boolean(c.confirmed_phone)} closed={(c.closed || {}).phone} onOpen={() => onReveal(c, "phone")} state={(lookups || {})[`${c.id}:phone`]} missed={(c.missed || {}).phone} onFind={() => onFindSite(c, "phone")} /></span></Cell>
                  <Cell style={{ whiteSpace: "nowrap" }}><span data-reach={`${c.id}:email`}><Reach value={c.email} kind="email" quiet first={firstMissing(c) === "email"} onGet={() => onGetContacts?.([c])} web={c.web_email} closed={(c.closed || {}).email} onOpen={() => onReveal(c, "email")} state={(lookups || {})[`${c.id}:email`]} missed={(c.missed || {}).email} onFind={() => onFindSite(c, "email")} /></span></Cell>
                  <Cell style={{ whiteSpace: "nowrap" }}><LinksCell c={c} onFind={onFindSite} onReveal={onReveal} lookups={lookups} /></Cell>
                  <Cell>{c.size_band && c.size_band !== "unknown" ? SIZE_LABEL[c.size_band] || c.size_band : "–"}</Cell>
                  <Cell style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    {Object.keys(c.closed || {}).length && onRevealRow ? (
                      <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" title="Show the website, phone and email we hold for this company. Free."
                        onClick={(e) => { e.stopPropagation(); onRevealRow(c); }}>Reveal</button>
                    ) : null}{" "}
                    <SaveCell saved={isSaved(c)} onSave={() => onSave(c)} />
                  </Cell>
                </tr>
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
    </>
  );
}

export function PeopleTable({ rows, onOpen, isSaved, onSave }) {
  return (
    <>
    <GridTools id="find-people" pinned={NAME_PIN} into="fl-grid-tools" />
    <div className="ui-scroll fl-table">
      <table style={{ borderCollapse: "separate", borderSpacing: 0, width: "100%", minWidth: 960 }}>
        <thead>
          <tr>
            <th style={{ ...th, background: "#FAFBFC", minWidth: 230 }}>Name</th>
            <th style={th}>Role</th>
            <th style={th}>Company</th>
            <th style={th}>Location</th>
            <th style={th}>Email</th>
            <th style={th}>Company phone</th>
            <th style={th}>On the register since</th>
            <th style={{ ...th, textAlign: "right" }} aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const c = p.company;
            const name = p.first_name || p.last_name ? `${p.first_name} ${p.last_name}`.trim() : p.name;
            return (
              <tr key={p.id} onClick={() => onOpen(c)} style={{ cursor: "pointer" }} data-person-row={p.id}>
                <Cell style={{ minWidth: 230 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <Avatar name={name} />
                    <div style={{ fontWeight: 600, color: C.ink }}>{name}</div>
                    <NotesButton companyId={c.id} person={p.name || name} name={name} />
                  </div>
                </Cell>
                <Cell style={{ whiteSpace: "nowrap" }}>{p.role || "Officer"}</Cell>
                <Cell style={{ whiteSpace: "nowrap" }}><span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>{c.name} <ProfileBadge profile={c.profile} /></span></Cell>
                <Cell style={{ whiteSpace: "nowrap" }}>{[c.region, c.postcode].filter(Boolean).join(" ") || "–"}</Cell>
                <Cell style={{ whiteSpace: "nowrap" }}><Reach value="" kind="email" onFind={() => onOpen(c)} /></Cell>
                <Cell style={{ whiteSpace: "nowrap" }}>{c.phone ? <Reach value={c.phone} who={c.name} kind="phone" onFind={() => onOpen(c)} /> : <span style={{ color: C.slateLight }}>–</span>}</Cell>
                <Cell>{p.appointed_on || "–"}</Cell>
                <Cell style={{ textAlign: "right" }}><SaveCell saved={isSaved(c)} onSave={() => onSave(c)} /></Cell>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    </>
  );
}

// Pages of 25 (or the size chosen), like Apollo's footer.
// Only the first 10,000 results can be paged through; filters narrow the rest.
const PAGEABLE = 10000;

export function Pager({ page, size, total, capped, shown, onPage, busy, unit }) {
  const pages = Math.max(1, Math.ceil(Math.min(total, PAGEABLE) / size));
  const from = total ? (page - 1) * size + 1 : 0;
  const to = (page - 1) * size + shown;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderTop: `1px solid ${C.border}`, flexWrap: "wrap" }}>
      <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" aria-label="Previous page" title="Previous page" disabled={busy || page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft size={15} /></button>
      <span style={{ ...text, fontSize: 13, color: C.textInk }}>{page} of {pages.toLocaleString()}</span>
      <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" aria-label="Next page" title="Next page" disabled={busy || page >= pages} onClick={() => onPage(page + 1)}><ChevronRight size={15} /></button>
      <span style={{ ...muted, fontSize: 12.5, marginLeft: "auto" }}>{total > PAGEABLE ? "First 10,000 can be paged. Add filters to narrow. " : ""}{unit ? `${unit} ` : ""}{from.toLocaleString()} to {to.toLocaleString()} of {total.toLocaleString()}{capped ? "+" : ""}</span>
    </div>
  );
}

// What shows when rows are ticked: one bar with the things to do with them.
export function SelectionBar({ count, label, onClear, children }) {
  if (!count) return null;
  return (
    <div role="toolbar" aria-label="Selected companies" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "8px 14px", background: C.cobaltSoft, borderBottom: `1px solid ${C.border}` }}>
      <span style={{ ...text, fontSize: 13, fontWeight: 600, color: C.cobaltDeep }}>{label || `${count.toLocaleString()} selected`}</span>
      {children}
      <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" style={{ marginLeft: "auto" }} onClick={onClear}>Clear</button>
    </div>
  );
}

// The profile of one company, sliding in from the right.
export function Drawer({ open, title, sub, onClose, actions, avatar, children, footer }) {
  const ref = useRef(null);
  // The parent passes a new onClose on every render, and it re-renders on a timer. Depending on it here re-ran this effect and
  // pulled focus back to the drawer in the middle of typing, so the text box stopped taking input. Read it through a ref instead.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return undefined;
    const esc = (e) => { if (e.key === "Escape") closeRef.current(); };
    window.addEventListener("keydown", esc);
    ref.current?.focus();
    return () => window.removeEventListener("keydown", esc);
  }, [open]);
  if (!open) return null;
  return (
    <>
      <div onClick={onClose} aria-hidden="true" style={{ position: "fixed", inset: 0, background: "rgba(16,20,32,.28)", zIndex: 400 }} />
      <aside ref={ref} tabIndex={-1} role="dialog" aria-label={title} className="fl-drawer"
        style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: "min(480px, 100vw)", background: "#fff", zIndex: 401, boxShadow: "-12px 0 32px rgba(20,24,40,.18)", display: "flex", flexDirection: "column", outline: "none" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "14px 16px", borderBottom: `1px solid ${C.border}` }}>
          {avatar || <Avatar name={title} size={40} />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ ...text, fontSize: 16, fontWeight: 700, color: C.ink, overflowWrap: "anywhere" }}>{title}</div>
            {sub ? <div style={{ ...muted, fontSize: 12.5, minWidth: 0 }}>{sub}</div> : null}
          </div>
          <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" aria-label="Close profile" title="Close the profile" onClick={onClose}><X size={16} /></button>
        </div>
        {actions ? <div style={{ display: "flex", gap: 8, flexWrap: "wrap", padding: "10px 16px", borderBottom: `1px solid ${C.borderLight}` }}>{actions}</div> : null}
        <div className="ui-scroll" style={{ flex: 1, overflowY: "auto", padding: footer ? "0 16px 20px" : "4px 16px 20px" }}>{children}</div>
        {footer}
      </aside>
    </>
  );
}

export function Fact({ label, children }) {
  if (children == null || children === "") return null;
  return (
    <div style={{ display: "flex", gap: 10, ...text, fontSize: 13, padding: "5px 0" }}>
      <span style={{ width: 118, flexShrink: 0, color: C.slate }}>{label}</span>
      <span style={{ minWidth: 0, overflowWrap: "anywhere", color: C.textInk }}>{children}</span>
    </div>
  );
}

