import React, { useMemo, useState } from "react";
import { Building2, ListChecks, ShieldCheck, Users } from "lucide-react";
import { CardsSkeleton } from "../../app/Loader";
import { GridTools } from "../../components/GridTools";
import { C, FONT_BODY } from "../../tokens";
import { phoneFor } from "./AccountsViews";
import { FieldMark } from "./SourceMark";
import { StageBadge } from "./LeadActivity";
import { NotesButton } from "./Notes";
import { SearchField } from "../../components/SearchField";
import { SourceSelect, TpsChip, TpsNote, TpsPill } from "./ListFilterBar";
import { personHasSource, personSources, personTps } from "./peopleFilters";
import { sourceOptions } from "./listFilters";
import { TpsCheckDialog } from "./TpsCheckDialog";
import { uniqueNumbers } from "./tpsCheck";
import { EmptyState } from "../../app/ui";

// Saved records > People: every named person across the companies you saved, in one table. A person is the contact you saved or
// imported on a company, plus the team members a research run found there. Nothing is invented: a person with no email shows a dash.
const text = { fontFamily: FONT_BODY };
const muted = { ...text, fontSize: 13, color: C.slate, lineHeight: 1.5 };
const PAGE = 100;

export function peopleOf(accounts) {
  const rows = [];
  for (const a of accounts) {
    const seen = new Set();
    const add = (name, title, email, phone, found, screening = null) => {
      const key = String(name || "").trim().toLowerCase();
      if (!key || seen.has(key)) return;
      seen.add(key);
      rows.push({ id: `${a.id}:${key}`, account: a, name: String(name).trim(), title: title || "", email: email || "", phone: phone || "", found, own: !found, screening });
    };
    if (a.contact_name) add(a.contact_name, a.contact_title, a.email, phoneFor(a)?.text, false);
    const r = a.research || {};
    for (const t of [...(r.team || []), ...(r.people || [])]) if (t && t.name) add(t.name, t.title || t.role, t.email, t.phone, true, t.phone_screening || null);
  }
  return rows;
}

export function SavedPeople({ store, onOpen, onGo }) {
  const [filter, setFilter] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [tpsOnly, setTpsOnly] = useState(false);
  const [fromSource, setFromSource] = useState("");
  const [tpsNumbers, setTpsNumbers] = useState(null); // the numbers of the people shown, while the check dialog is open
  const people = useMemo(() => peopleOf(store.accounts), [store.accounts]);
  if (store.loading) return <CardsSkeleton count={4} label="Loading your people" />;
  if (!people.length) {
    return (
      <EmptyState icon={Users} title="No people yet"
        body="A person appears here when a saved company has a contact name, from your import or from a company check that found the team. Open Companies to check and improve them.">
        <button type="button" className="ui-btn ui-btn--primary" title="Open your saved companies" onClick={() => onGo("saved_companies")}>Go to Companies</button>
      </EmptyState>
    );
  }
  const q = filter.trim().toLowerCase();
  const sourceChoices = sourceOptions(people, personSources);
  const activeSource = sourceChoices.some((o) => o.key === fromSource) ? fromSource : "";
  const tpsCount = people.filter((p) => personTps(p)).length;
  const rows = people
    .filter((p) => !tpsOnly || personTps(p))
    .filter((p) => !activeSource || personHasSource(p, activeSource))
    .filter((p) => !q || [p.name, p.title, p.account.name, p.email].some((v) => String(v || "").toLowerCase().includes(q)));
  const narrowed = Boolean(q || tpsOnly || activeSource);
  const companies = new Set(people.map((p) => p.account.id)).size;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <SearchField value={filter} onChange={(v) => { setFilter(v); setShown(PAGE); }} placeholder="Search people by name, title, company or email" label="Search people" height={42} style={{ flex: "1 1 320px" }} />
        <span style={muted} role="status">{narrowed ? `${rows.length.toLocaleString()} of ` : ""}{people.length.toLocaleString()} {people.length === 1 ? "person" : "people"}{narrowed ? " match" : ""} · at {companies.toLocaleString()} {companies === 1 ? "company" : "companies"}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <TpsPill count={tpsCount} on={tpsOnly} onClick={() => { setTpsOnly((v) => !v); setShown(PAGE); }} />
        <SourceSelect options={sourceChoices} value={activeSource} onChange={(v) => { setFromSource(v); setShown(PAGE); }} />
        <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" style={{ minHeight: 36 }} disabled={!rows.some((p) => p.phone)}
          title="Check the phone number of every person shown against the TPS and CTPS registers. You see the cost before anything is spent."
          onClick={() => setTpsNumbers(uniqueNumbers(rows.map((p) => p.phone)))}>
          <ShieldCheck size={14} aria-hidden="true" /> Check TPS/CTPS for these {rows.length.toLocaleString()}
        </button>
      </div>
      {tpsOnly ? <TpsNote /> : null}
      <div className="ui-card" style={{ overflow: "hidden" }}>
        <GridTools id="saved-people" />
        <div className="ui-scroll" style={{ overflowX: "auto" }}>
          <table className="ui-table" style={{ minWidth: 860 }}>
            <thead>
              <tr><th>Name</th><th>Job title</th><th>Company</th><th>Email</th><th>Phone</th><th>Stage</th><th>Where from</th></tr>
            </thead>
            <tbody>
              {rows.slice(0, shown).map((p) => (
                <tr key={p.id} style={{ cursor: "pointer" }} title={`Open ${p.account.name}`} onClick={() => onOpen(p.account)}>
                  <td style={{ fontWeight: 600, color: C.ink }}>{p.name} <NotesButton companyId={p.account.id} person={p.name} name={p.name} /></td>
                  <td style={{ color: C.slate }}>{p.title || "-"}</td>
                  <td>{p.account.name}</td>
                  <td style={{ color: p.email ? C.ink : C.slate }}>{p.email || "-"}{p.own && p.email ? <FieldMark flags={p.account.restricted} notes={p.account.restricted_note} sources={p.account.field_sources} field="email" /> : null}</td>
                  <td style={{ color: p.phone ? C.ink : C.slate, whiteSpace: "nowrap" }}>{p.phone || "-"}{p.own && p.phone ? <FieldMark flags={p.account.restricted} notes={p.account.restricted_note} sources={p.account.field_sources} field="phone" /> : null}{p.phone ? <TpsChip screening={personTps(p)} /> : null}</td>
                  <td><StageBadge stage={p.account.connection?.stage || "new"} /></td>
                  <td style={{ color: C.slate, whiteSpace: "nowrap" }}>{p.found ? "Found by a company check" : "Saved or imported"}</td>
                </tr>
              ))}
              {!rows.length ? <tr><td colSpan={7} style={{ ...muted, textAlign: "center", padding: 24 }}>{q ? `No one matches “${filter}”.` : "No one matches these filters."}</td></tr> : null}
            </tbody>
          </table>
        </div>
        {rows.length > shown ? (
          <div style={{ padding: 10, textAlign: "center", borderTop: "1px solid var(--ui-line, #E3E6EF)" }}>
            <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => setShown((n) => n + PAGE)}>Show {Math.min(PAGE, rows.length - shown)} more of {(rows.length - shown).toLocaleString()}</button>
          </div>
        ) : null}
      </div>
      {tpsNumbers ? <TpsCheckDialog numbers={tpsNumbers} wallet="leadgen" title="Check these people's numbers" onClose={() => setTpsNumbers(null)} onDone={() => store.reload?.()} /> : null}
    </div>
  );
}

const tabsCss = `
.sv-tabs{display:inline-flex;height:36px;box-sizing:border-box;background:var(--ui-sunken);border:1px solid var(--ui-line);border-radius:10px;padding:3px;gap:3px;max-width:100%;overflow-x:auto}
.sv-tab{border:none;cursor:pointer;border-radius:7px;padding:0 12px;font:600 13px Inter,sans-serif;display:inline-flex;align-items:center;gap:6px;background:transparent;color:var(--ui-muted);white-space:nowrap}
.sv-tab[data-on="true"]{background:#fff;color:var(--ui-ink);box-shadow:0 1px 3px rgba(0,0,0,.12)}
.sv-tab:focus-visible{outline:2px solid var(--ui-accent);outline-offset:1px}
.sv-count{font-weight:500;color:var(--ui-muted);font-variant-numeric:tabular-nums}
`;

// Lists, Companies and People are one place: every saved company sits in a list, so the lists and everything saved are tabs of one page.
export function SavedTabs({ view, counts, onChange }) {
  const tabs = [["lists", "Lists", ListChecks], ["saved_companies", "Companies", Building2], ["saved_people", "People", Users]];
  return (
    <div role="tablist" aria-label="Saved records" className="sv-tabs">
      <style>{tabsCss}</style>
      {tabs.map(([id, name, Icon]) => (
        <button key={id} type="button" role="tab" aria-selected={view === id} data-on={view === id} className="sv-tab" onClick={() => onChange(id)}>
          <Icon size={15} aria-hidden="true" /> {name}{counts[id] != null ? <span className="sv-count">{counts[id].toLocaleString()}</span> : null}
        </button>
      ))}
    </div>
  );
}
