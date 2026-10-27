import React, { useEffect, useRef } from "react";
import { BadgeCheck, Check, ChevronDown, ChevronLeft, ChevronRight, ExternalLink, Plus, X } from "lucide-react";
import { C, FONT_BODY } from "../../tokens";
import { domainOf } from "./AccountsViews";

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

// A coloured tile with the company's initials. No picture is fetched from anywhere, so searching never tells a third party who you looked up.
export function Avatar({ name, size = 32 }) {
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

// Total / Net new / Saved, like Apollo's: tap one to show only those.
export function CountTiles({ total, capped, saved, filter, onPick, busy }) {
  const plus = capped ? "+" : "";
  const net = Math.max(total - (saved || 0), 0);
  const tiles = [
    ["", "Total", total, plus, "Every match"],
    ["exclude", "Net new", net, plus, "Not in any of your lists yet"],
    ["only", "Saved", saved || 0, "", "Already in one of your lists"],
  ];
  return (
    <div role="group" aria-label="Show" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {tiles.map(([id, label, n, extra, tip]) => {
        const on = (filter || "") === id;
        return (
          <button key={label} type="button" title={tip} aria-pressed={on} disabled={busy} onClick={() => onPick(id)}
            style={{ cursor: "pointer", textAlign: "left", minWidth: 104, padding: "7px 12px", borderRadius: 8, border: `1px solid ${on ? C.cobalt : C.border}`, background: on ? C.cobaltSoft : "#fff", ...text }}>
            <div style={{ fontSize: 12, color: on ? C.cobaltDeep : C.slate, fontWeight: 600 }}>{label}</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.ink, fontVariantNumeric: "tabular-nums" }}>{Number(n).toLocaleString()}{extra}</div>
          </button>
        );
      })}
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

function Cell({ children, style }) {
  return <td style={{ ...td, ...style }}>{children}</td>;
}

function link(url) {
  const d = domainOf(url);
  if (!d) return null;
  return <a href={String(url).startsWith("http") ? url : `https://${url}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: C.cobalt, display: "inline-flex", alignItems: "center", gap: 3 }}>{d} <ExternalLink size={11} /></a>;
}

// Where the contact is on file: shown as-is when we hold it, otherwise a button that opens the profile to look for it.
function Reach({ value, kind, onFind, web, state }) {
  if (!value && web) {
    return <span title="Found on the web, not confirmed by the registry. Check it before you use it" style={{ whiteSpace: "nowrap" }}>{web} <span style={{ ...text, fontSize: 10.5, color: C.slate }}>web</span></span>;
  }
  if (!value && state === "busy") return <span style={{ ...muted, fontSize: 12 }}>Looking…</span>;
  if (!value && state === "none") return <span title="Looked on the web and found nothing. Nothing was charged" style={{ ...muted, fontSize: 12 }}>Not found</span>;
  if (value) return kind === "phone" ? <a href={`tel:${value.replace(/\s+/g, "")}`} onClick={(e) => e.stopPropagation()} style={{ color: C.textInk, fontVariantNumeric: "tabular-nums" }}>{value}</a> : <a href={`mailto:${value}`} onClick={(e) => e.stopPropagation()} style={{ color: C.textInk }}>{value}</a>;
  const tip = kind === "email" ? "Open the profile to look for an email" : "Look on the web for this company's website and phone. 1 credit if found (the deeper search is used only if the first finds no website, and only charged if it does). Nothing is charged for a miss";
  return <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" title={tip} onClick={(e) => { e.stopPropagation(); onFind(); }}>{kind === "phone" ? "Find phone" : kind === "website" ? "Find website" : "Find email"}</button>;
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

export function CompaniesTable({ rows, picked, onPick, onPickAll, onOpen, isSaved, onSave, tiers, capped, grouped, activeId, onFindSite, lookups }) {
  const allOn = rows.length > 0 && rows.every((c) => picked.has(c.id));
  const cols = 9;
  const seen = new Set();
  return (
    <div className="ui-scroll fl-table">
      <table style={{ borderCollapse: "separate", borderSpacing: 0, width: "100%", minWidth: 1020 }}>
        <thead>
          <tr>
            <th style={{ ...th, ...pinned(0, 4), width: 36, background: "#FAFBFC" }}><input type="checkbox" aria-label="Select every company shown" checked={allOn} onChange={(e) => onPickAll(e.target.checked)} /></th>
            <th style={{ ...th, ...pinned(36, 4), background: "#FAFBFC", minWidth: 260 }}>Company</th>
            <th style={th}>Industry</th>
            <th style={th}>Location</th>
            <th style={th}>Website</th>
            <th style={th}>Phone</th>
            <th style={th}>Email</th>
            <th style={th} title="From the company's filed accounts, not headcount">Size (accounts)</th>
            <th style={{ ...th, textAlign: "right" }} aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const head = grouped && !seen.has(c.profile) ? (seen.add(c.profile), c.profile) : null;
            const tier = head && tiers ? { n: tiers[head] || 0, plus: capped && head !== "basic" && (tiers[head] || 0) >= 10000 ? "+" : "" } : null;
            const on = picked.has(c.id);
            const bg = activeId === c.id ? C.cobaltSoft : on ? "#F6F8FE" : "#fff";
            return (
              <React.Fragment key={c.id}>
                {head ? <Divider profile={head} count={tier} cols={cols} /> : null}
                <tr onClick={() => onOpen(c)} style={{ cursor: "pointer", background: bg }} data-company-row={c.id}>
                  <Cell style={{ ...pinned(0), width: 36, background: bg }}><input type="checkbox" aria-label={`Select ${c.name}`} checked={on} onClick={(e) => e.stopPropagation()} onChange={() => onPick(c.id)} /></Cell>
                  <Cell style={{ ...pinned(36), background: bg, minWidth: 260 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <Avatar name={c.name} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600, color: C.ink, display: "flex", gap: 6, alignItems: "center", whiteSpace: "nowrap" }}>
                          {c.name}
                          {c.tier !== "verified_registry" ? <span title="Found on the web, not read from the official registry" style={{ ...text, fontSize: 11, color: C.slate }}>Web, unverified</span> : null}
                          {grouped ? null : <ProfileBadge profile={c.profile} />}
                        </div>
                        <div style={{ ...muted, fontSize: 11.5, whiteSpace: "nowrap" }}>{[c.company_category, c.registration_number && `No. ${c.registration_number}`].filter(Boolean).join(" · ")}</div>
                      </div>
                    </div>
                  </Cell>
                  <Cell style={{ maxWidth: 210, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={c.industry}>{plainSector(c.industry) || "–"}</Cell>
                  <Cell style={{ whiteSpace: "nowrap" }}>{[c.region, c.postcode].filter(Boolean).join(" ") || "–"}</Cell>
                  <Cell style={{ whiteSpace: "nowrap" }}>{link(c.website) || <Reach value="" kind="website" web={c.web_website} state={(lookups || {})[c.id]} onFind={() => onFindSite(c)} />}</Cell>
                  <Cell style={{ whiteSpace: "nowrap" }}><Reach value={c.phone} kind="phone" web={c.web_phone} state={(lookups || {})[c.id]} onFind={() => onFindSite(c)} /></Cell>
                  <Cell style={{ whiteSpace: "nowrap" }}><Reach value={c.email} kind="email" onFind={() => onOpen(c)} /></Cell>
                  <Cell>{c.size_band && c.size_band !== "unknown" ? SIZE_LABEL[c.size_band] || c.size_band : "–"}</Cell>
                  <Cell style={{ textAlign: "right" }}><SaveCell saved={isSaved(c)} onSave={() => onSave(c)} /></Cell>
                </tr>
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function PeopleTable({ rows, onOpen, isSaved, onSave }) {
  return (
    <div className="ui-scroll fl-table">
      <table style={{ borderCollapse: "separate", borderSpacing: 0, width: "100%", minWidth: 960 }}>
        <thead>
          <tr>
            <th style={{ ...th, ...pinned(0, 4), background: "#FAFBFC", minWidth: 230 }}>Name</th>
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
                <Cell style={{ ...pinned(0), minWidth: 230 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <Avatar name={name} />
                    <div style={{ fontWeight: 600, color: C.ink }}>{name}</div>
                  </div>
                </Cell>
                <Cell style={{ whiteSpace: "nowrap" }}>{p.role || "Officer"}</Cell>
                <Cell style={{ whiteSpace: "nowrap" }}><span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>{c.name} <ProfileBadge profile={c.profile} /></span></Cell>
                <Cell style={{ whiteSpace: "nowrap" }}>{[c.region, c.postcode].filter(Boolean).join(" ") || "–"}</Cell>
                <Cell style={{ whiteSpace: "nowrap" }}><Reach value="" kind="email" onFind={() => onOpen(c)} /></Cell>
                <Cell style={{ whiteSpace: "nowrap" }}>{c.phone ? <Reach value={c.phone} kind="phone" onFind={() => onOpen(c)} /> : <span style={{ color: C.slateLight }}>–</span>}</Cell>
                <Cell>{p.appointed_on || "–"}</Cell>
                <Cell style={{ textAlign: "right" }}><SaveCell saved={isSaved(c)} onSave={() => onSave(c)} /></Cell>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
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
      <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" aria-label="Previous page" disabled={busy || page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft size={15} /></button>
      <span style={{ ...text, fontSize: 13, color: C.textInk }}>{page} of {pages.toLocaleString()}</span>
      <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" aria-label="Next page" disabled={busy || page >= pages} onClick={() => onPage(page + 1)}><ChevronRight size={15} /></button>
      <span style={{ ...muted, fontSize: 12.5, marginLeft: "auto" }}>{total > PAGEABLE ? "First 10,000 can be paged. Add filters to narrow. " : ""}{unit ? `${unit} ` : ""}{from.toLocaleString()} to {to.toLocaleString()} of {total.toLocaleString()}{capped ? "+" : ""}</span>
    </div>
  );
}

// What shows when rows are ticked: one bar with the things to do with them.
export function SelectionBar({ count, onClear, children }) {
  if (!count) return null;
  return (
    <div role="toolbar" aria-label="Selected companies" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "8px 14px", background: C.cobaltSoft, borderBottom: `1px solid ${C.border}` }}>
      <span style={{ ...text, fontSize: 13, fontWeight: 600, color: C.cobaltDeep }}>{count} selected</span>
      {children}
      <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" style={{ marginLeft: "auto" }} onClick={onClear}>Clear</button>
    </div>
  );
}

// The profile of one company, sliding in from the right.
export function Drawer({ open, title, sub, onClose, actions, children }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const esc = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    ref.current?.focus();
    return () => window.removeEventListener("keydown", esc);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <div onClick={onClose} aria-hidden="true" style={{ position: "fixed", inset: 0, background: "rgba(16,20,32,.28)", zIndex: 400 }} />
      <aside ref={ref} tabIndex={-1} role="dialog" aria-label={title} className="fl-drawer"
        style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: "min(480px, 100vw)", background: "#fff", zIndex: 401, boxShadow: "-12px 0 32px rgba(20,24,40,.18)", display: "flex", flexDirection: "column", outline: "none" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "14px 16px", borderBottom: `1px solid ${C.border}` }}>
          <Avatar name={title} size={40} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ ...text, fontSize: 16, fontWeight: 700, color: C.ink, overflowWrap: "anywhere" }}>{title}</div>
            {sub ? <div style={{ ...muted, fontSize: 12.5 }}>{sub}</div> : null}
          </div>
          <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" aria-label="Close profile" onClick={onClose}><X size={16} /></button>
        </div>
        {actions ? <div style={{ display: "flex", gap: 8, flexWrap: "wrap", padding: "10px 16px", borderBottom: `1px solid ${C.borderLight}` }}>{actions}</div> : null}
        <div className="ui-scroll" style={{ flex: 1, overflowY: "auto", padding: "4px 16px 20px" }}>{children}</div>
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

