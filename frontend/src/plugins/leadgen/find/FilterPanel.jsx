import React from "react";
import { Spinner } from "../../../app/Loader";
import { RotateCcw, Search, Sparkles } from "lucide-react";
import { C } from "../../../tokens";
import { FilterGroup, LabelTip } from "../FindLeadsParts";
import ExclusionBox from "../ExclusionBox";
import IndustryPicker from "../IndustryPicker";
import { RADIUS_MILES, SIGNAL_OPTIONS, coversText, toggleIn } from "../savedSearchLogic";
import { DATA_FROM_OPTIONS, TPS_OPTIONS } from "../filterSummary";
import { FORM_OPTIONS, SIZE_OPTIONS, SOURCE_OPTIONS, TYPE_OPTIONS, splitList } from "./findLogic";
import { CHECK_TIPS, DistrictPicker, muted, text } from "./findParts";
import { StandingChip } from "../../../brand/StandingChip";

// Find Leads' filter panel (the left column): name, trade, place, size, signals and the rest, with Search and Clear. Moved out of FindLeadsSearch unchanged; every value it uses comes in as a prop of the same name.
export function FilterPanel({ isAdmin = false, activeIn, busy, check, chipsFor, clearGroup, field, fillFromWords, filterCount, form, groups, label, lookRadius, resetSearch, search, searchPeople, setExcluded, setField, setForm, setGroup, setSicLabels, setWords, sicLabels, tab, toggleSize, words, wordsBusy }) {
  return (
    <aside data-pane="chat" aria-label="Filters" className="ui-card fl-filters" style={{ padding: "4px 14px 0", display: "flex", flexDirection: "column" }}>
      <form onSubmit={(e) => { setExcluded([]); if (tab === "people") searchPeople(e); else search(e); }}>
        <div className="fl-pin">
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ ...text, fontSize: 12, fontWeight: 600, color: C.slate, textTransform: "uppercase", letterSpacing: ".04em", marginRight: "auto" }}>Filters</span>
            <StandingChip canSeeRules={isAdmin} short />
          </div>
          {/* One row: describe it in words; Fill appears once there is something to read (plan 13, step 6). */}
          <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
            <Sparkles size={14} aria-hidden="true" color={C.cobalt} style={{ position: "absolute", left: 10, pointerEvents: "none" }} />
            <input className="ui-input" aria-label="Describe what you want in words" style={{ flex: 1, minWidth: 0, paddingLeft: 30, paddingRight: words.trim() ? 64 : undefined }} value={words} disabled={wordsBusy}
              title="Type it as a sentence and press Enter. The filters below are filled in for you, including what to leave out"
              onChange={(e) => setWords(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") fillFromWords(e); }}
              placeholder="Describe who you're after" />
            {words.trim() || wordsBusy ? (
              <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" style={{ position: "absolute", right: 4, height: 28 }} disabled={wordsBusy} aria-busy={wordsBusy} title="Fill the filters from your sentence. It does not run the search" onClick={fillFromWords}>
                {wordsBusy ? "Reading…" : "Fill"}
              </button>
            ) : null}
          </div>
        </div>
        {tab === "people" ? (
          <FilterGroup title="Job title" active={activeIn("person")} open={groups.person} onToggle={() => setGroup("person")} onClear={() => clearGroup("person")} chips={chipsFor("person")}>
            <label style={field} title="A word from their role, like director or secretary"><span style={label}>Role includes</span>
              <input className="ui-input" value={form.title} onChange={(e) => setField("title", e.target.value)} placeholder="director, secretary" /></label>
          </FilterGroup>
        ) : null}
        <FilterGroup title="Industry & keywords" active={activeIn("industry")} open={groups.industry} onToggle={() => setGroup("industry")} onClear={() => clearGroup("industry")} chips={chipsFor("industry")}>
          <label style={field}><LabelTip style={label} tip="Words are matched against what each company does and its name. Related words are included, like dental for dentist. A common word on its own can be slow across the whole register: add a town to speed it up.">Include</LabelTip>
            <input className="ui-input" value={form.sector} onChange={(e) => setField("sector", e.target.value)} placeholder="accountancy, software, a company name, or a company number" /></label>
          <div style={field}><LabelTip style={label} tip="Leave out companies whose name or sector has any of these words, or that are in one of these categories">Leave out</LabelTip>
            <ExclusionBox label="Leave out" value={form.notSector} onChange={(v) => setField("notSector", v)} placeholder="franchise, holdings, Hospitals" /></div>
          <div style={field}><LabelTip style={label} tip="Pick from the industries on the register, with how many companies each has. A short SIC code takes every code that starts with it">Industry</LabelTip>
            <IndustryPicker codes={splitList(form.sic)} labels={sicLabels} types={form.industryTypes || []}
              onChange={({ codes, labels, types }) => { setForm((f) => ({ ...f, sic: codes.join(", "), industryTypes: types })); setSicLabels(labels); }} /></div>
          {check("includeSecondary", "Include side activities")}
          {check("includeNonBusiness", "Include schools & community places")}
        </FilterGroup>
        <FilterGroup title="Location" active={activeIn("location")} open={groups.location} onToggle={() => setGroup("location")} onClear={() => clearGroup("location")} chips={chipsFor("location")}>
          <div style={field}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }} title="One or more towns, separated by commas"><span style={label}>Town / city</span>
              <input className="ui-input" value={form.town} onChange={(e) => setField("town", e.target.value)} placeholder="London, Leeds" /></label>
            <DistrictPicker town={form.town} includeClosed={form.includeClosed} postcode={form.postcode} onChange={(v) => setField("postcode", v)} />
          </div>
          <label style={field} title="Only companies whose postcode begins with this, like EC1 or M1"><span style={label}>Postcode starts with</span>
            <input className="ui-input" value={form.postcode} onChange={(e) => setField("postcode", e.target.value)} placeholder="EC1, M1" /></label>
          <label style={field} title="Leave out companies in these towns"><span style={label}>Leave out towns</span>
            <input className="ui-input" value={form.notTown} onChange={(e) => setField("notTown", e.target.value)} placeholder="Bradford" /></label>
          <div style={field}>
            <LabelTip style={label} tip="Companies whose registered office is in the postcode districts inside this distance">Within</LabelTip>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <select className="ui-input" aria-label="Miles" style={{ width: 96, flex: "0 0 auto" }} value={form.nearMiles}
                onChange={(e) => { setField("nearMiles", e.target.value); if (form.nearPostcode.trim()) lookRadius(form.nearPostcode, e.target.value); }}>
                {RADIUS_MILES.map((m) => <option key={m} value={m}>{m} {m === 1 ? "mile" : "miles"}</option>)}
              </select>
              <input className="ui-input" aria-label="of this postcode" style={{ flex: "1 1 120px", minWidth: 0 }} value={form.nearPostcode} placeholder="of LS1 4AP"
                onChange={(e) => setField("nearPostcode", e.target.value)} onBlur={() => lookRadius(form.nearPostcode, form.nearMiles)} />
            </div>
            {form.near?.districts?.length ? <span style={muted}>{coversText(form.near)}</span> : null}
            {form.nearError ? <span role="alert" style={{ ...muted, color: C.red }}>{form.nearError}</span> : null}
          </div>
        </FilterGroup>
        <FilterGroup title="Reasons to get in touch now" active={activeIn("signals")} open={groups.signals} onToggle={() => setGroup("signals")} onClear={() => clearGroup("signals")} chips={chipsFor("signals")}>
          {SIGNAL_OPTIONS.map(([key, name, tip]) => (
            <label key={key} title={tip} style={{ ...text, fontSize: 13, display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer", minHeight: 40 }}>
              <input type="checkbox" checked={form.signals.includes(key)} onChange={() => setField("signals", toggleIn(form.signals, key))} /> {name}
            </label>
          ))}
        </FilterGroup>
        <FilterGroup title="Size / accounts type" active={activeIn("size")} open={groups.size} onToggle={() => setGroup("size")} onClear={() => clearGroup("size")} chips={chipsFor("size")}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }} title="From each company's filed accounts category. It is not a headcount.">
            {SIZE_OPTIONS.map(([id, name]) => (
              <button key={id} type="button" title={`Only ${name} companies`} aria-label={`Size: ${name}`} className={`ui-chip${form.sizes.includes(id) ? " is-active" : ""}`} aria-pressed={form.sizes.includes(id)} onClick={() => toggleSize(id)}
                style={form.sizes.includes(id) ? { background: "var(--ui-accent-soft)", color: "var(--ui-accent-ink)" } : undefined}>{name}</button>
            ))}
          </div>
        </FilterGroup>
        <FilterGroup title="Company" active={activeIn("company")} open={groups.company} onToggle={() => setGroup("company")} onClear={() => clearGroup("company")} chips={chipsFor("company")}>
          {form.legalForm !== "sole" ? (<>
            <label style={field} title="The legal form: Limited, LLP, PLC and so on"><span style={label}>Company type</span>
              <input className="ui-input" value={form.category} onChange={(e) => setField("category", e.target.value)} placeholder="Limited, LLP, PLC" /></label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }} title="Any of the legal forms ticked">
              {TYPE_OPTIONS.map(([id, name]) => {
                const on = (form.types || []).includes(id);
                return <button key={id} type="button" className="ui-chip" aria-pressed={on} aria-label={`Type: ${name}`} onClick={() => setField("types", on ? form.types.filter((x) => x !== id) : [...(form.types || []), id])}
                  style={on ? { background: "var(--ui-accent-soft)", color: "var(--ui-accent-ink)" } : undefined}>{name}</button>;
              })}
            </div>
          </>) : null}
          <label style={field} title={CHECK_TIPS.legalForm}><span style={label}>Registered or sole trader</span>
            <select className="ui-input" value={form.legalForm} onChange={(e) => { const v = e.target.value; setForm((f) => ({ ...f, legalForm: v, ...(v === "sole" ? { category: "", types: [], noCharities: false } : {}) })); }}>
              {FORM_OPTIONS.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select></label>
          {form.legalForm === "sole" ? (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }} title="Only records that came from these registers (none ticked: all of them)">
              {SOURCE_OPTIONS.map(([id, name]) => {
                const on = (form.recordSources || []).includes(id);
                return <button key={id} type="button" className="ui-chip" aria-pressed={on} aria-label={`Record from: ${name}`} onClick={() => setField("recordSources", on ? form.recordSources.filter((x) => x !== id) : [...(form.recordSources || []), id])}
                  style={on ? { background: "var(--ui-accent-soft)", color: "var(--ui-accent-ink)" } : undefined}>{name}</button>;
              })}
            </div>
          ) : null}
          {form.legalForm !== "sole" ? check("noCharities", "Leave out charities") : null}
          {check("googleData", "Includes Google data")}
          <div style={field}>
            <LabelTip style={label} tip="Only companies with a phone, email or website that came from any of the sources ticked">Data from</LabelTip>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {DATA_FROM_OPTIONS.map(([id, name]) => {
                const on = (form.dataFrom || []).includes(id);
                return <button key={id} type="button" className="ui-chip" aria-pressed={on} aria-label={`Data from: ${name}`} onClick={() => setField("dataFrom", on ? form.dataFrom.filter((x) => x !== id) : [...(form.dataFrom || []), id])}
                  style={on ? { background: "var(--ui-accent-soft)", color: "var(--ui-accent-ink)" } : undefined}>{name}</button>;
              })}
            </div>
          </div>
          <label style={field} title="Leave out these legal forms, for example Registered Society or Royal Charter Company"><span style={label}>Leave out types</span>
            <input className="ui-input" value={form.notCategory} onChange={(e) => setField("notCategory", e.target.value)} placeholder="LLP, Registered Society" /></label>
          <div style={field}><LabelTip style={label} tip={CHECK_TIPS.excludeItems}>Exclusion list</LabelTip>
            <ExclusionBox label="Exclusion list" value={form.excludeItems} onChange={(v) => setField("excludeItems", v)} placeholder="56101, BN9, 01234567, church, Places of Worship" /></div>
        </FilterGroup>
        <FilterGroup title="Status & age" active={activeIn("status")} open={groups.status} onToggle={() => setGroup("status")} onClear={() => clearGroup("status")} chips={chipsFor("status")}>
          <div style={{ display: "flex", gap: 8 }}>
            <label style={field} title="Only companies that have existed at least this many years"><span style={label}>Trading ≥ years</span>
              <input className="ui-input" inputMode="numeric" value={form.minAge} onChange={(e) => setField("minAge", e.target.value)} placeholder="e.g. 5" /></label>
            <label style={field} title="Only companies that are no older than this many years"><span style={label}>Trading ≤ years</span>
              <input className="ui-input" inputMode="numeric" value={form.maxAge} onChange={(e) => setField("maxAge", e.target.value)} placeholder="e.g. 2" /></label>
          </div>
          {check("includeClosed", "Include closed / dissolved")}
        </FilterGroup>
        <FilterGroup title="Details we hold" active={activeIn("contact")} open={groups.contact} onToggle={() => setGroup("contact")} onClear={() => clearGroup("contact")} chips={chipsFor("contact")}>
          {check("hasWebsite", "Has a website")}{check("hasPhone", "Has a phone")}{check("hasEmail", "Has an email")}
          <label title={CHECK_TIPS.tpsChecked} style={{ ...text, fontSize: 13, display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
            <input type="checkbox" checked={form.tpsChecked} onChange={(e) => setForm((f) => ({ ...f, tpsChecked: e.target.checked, tpsStatus: e.target.checked ? f.tpsStatus : "" }))} /> Phone checked against TPS/CTPS
          </label>
          {form.tpsChecked ? (
            <div role="group" aria-label="TPS result" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {TPS_OPTIONS.map(([id, name]) => (
                <button key={name} type="button" className="ui-chip" aria-pressed={form.tpsStatus === id} onClick={() => setField("tpsStatus", id)}
                  style={form.tpsStatus === id ? { background: "var(--ui-accent-soft)", color: "var(--ui-accent-ink)" } : undefined}>{name}</button>
              ))}
            </div>
          ) : null}
        </FilterGroup>
        <FilterGroup title="Your lists" active={activeIn("lists")} open={groups.lists} onToggle={() => setGroup("lists")} onClear={() => clearGroup("lists")} chips={chipsFor("lists")}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {[["", "Any"], ["exclude", "Not in my lists"], ["only", "In my lists"]].map(([v, name]) => (
              <button key={name} type="button" className="ui-chip" aria-pressed={form.saved === v} onClick={() => setField("saved", v)}
                style={form.saved === v ? { background: "var(--ui-accent-soft)", color: "var(--ui-accent-ink)" } : undefined}>{name}</button>
            ))}
          </div>
        </FilterGroup>
        <div style={{ position: "sticky", bottom: 0, background: C.surfaceCool, borderTop: `1px solid ${C.lineStrong}`, display: "flex", alignItems: "center", gap: 8, padding: "10px 0 12px", marginTop: "auto" }}>
          <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={resetSearch} title="Clear every filter, the drawn area and the results, and start again">
            <RotateCcw size={14} /> Clear all{filterCount ? ` · ${filterCount}` : ""}
          </button>
          <button type="submit" aria-busy={busy} className="ui-btn ui-btn--primary" style={{ marginLeft: "auto", height: 36 }} title="Search the company register. It costs no credits">
            {busy ? <Spinner size={15} /> : <Search size={15} />} {busy ? "Searching…" : tab === "people" ? "Find people" : "Find companies"}
          </button>
        </div>
      </form>
    </aside>
  );
}
