import React, { useEffect, useRef, useState } from "react";
import { BadgeCheck, Globe, ChevronDown } from "lucide-react";
import { FONT_BODY, C } from "../../../tokens";
import { api } from "../../../api/apiClient";
import { splitList } from "./findLogic";

export const CHECK_TIPS = {
  hasWebsite: "Only companies we already hold a website for",
  includeNonBusiness: "Also show schools, nurseries, churches and community places (hidden by default)",
  includeSecondary: "Also show companies that list this trade only as a side activity. By default a trade matches a company's main activity or its name",
  hasPhone: "Only companies we already hold a phone number for",
  hasEmail: "Only companies we already hold an email for",
  includeClosed: "Also show companies that have closed or been dissolved",
  noCharities: "Leave out charities and companies on the charity register",
  excludeItems: "Type what to leave out, separated by commas. SIC codes (56101, or just 56 for every code starting with it), postcode districts (BN9), company numbers (01234567) and words in the name or trade (church, casino) are all understood",
  tpsChecked: "Only companies with a phone number that has a TPS or CTPS result on file. Numbers nobody has checked yet are left out",
  googleData: "Only companies where at least one phone, email or website came from Google. You can use it in Outreach, but it can't be downloaded",
  legalForm: "Registered companies have a Companies House number. Sole traders are not on that register, so this finds the records we hold with no company number: sole traders, partnerships, and businesses we could not match to a company",
};
export const text = { fontFamily: FONT_BODY };
export const muted = { ...text, fontSize: 13, color: C.slate, lineHeight: 1.5 };

export function TierBadge({ tier }) {
  const verified = tier === "verified_registry";
  if (tier === "premises_listing") return <span title="Listed as a premises (for example a food register), not matched to a company number" style={{ ...text, fontSize: 11.5, display: "inline-flex", alignItems: "center", gap: 3, color: C.slate }}><Globe size={12} /> Premises listing</span>;
  return (
    <span title={verified ? "Read from an official registry record" : tier === "scraped" ? "Collected from a website" : "Found by a web search, not read from the official registry"}
      style={{ ...text, fontSize: 11.5, display: "inline-flex", alignItems: "center", gap: 3, color: verified ? C.green : C.slate }}>
      {verified ? <BadgeCheck size={12} /> : <Globe size={12} />} {verified ? "Registry" : tier === "scraped" ? "Website" : "Web"}
    </span>
  );
}

// One company's contacts on demand. Registry officers are verified and free; the web lookup is a
// separate, labelled step; an email is found for one named person at a time (only charged when found).
export function WebRow({ label, children }) {
  return (
    <div style={{ display: "flex", gap: 10, fontSize: 12.5, ...text, color: C.textInk, alignItems: "baseline" }}>
      <span style={{ width: 56, flexShrink: 0, color: C.slate }}>{label}</span>
      <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{children}</span>
    </div>
  );
}

// Under the Town box: once one town is typed, a dropdown of its postcode districts with how many companies
// each has. Ticking one adds it to "Postcode starts with". Only counts are shown here, never companies.
export function DistrictPicker({ town, includeClosed, postcode, onChange }) {
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
