import React from "react";
import { Database, FileUp, Globe, Landmark, MapPin, Phone, Search, ShieldCheck, ShieldQuestion, User } from "lucide-react";
import { C } from "../../tokens";
import { Tooltip } from "../../app/ui";
import { describeSources } from "./sourceBadgeLogic";
import { GoogleG } from "./SourceMark";

const ICONS = { register: Landmark, website: Globe, user: User, import: FileUp, web: Search, check: Phone, google_places: MapPin, apollo: Database };

const head = { fontSize: 11, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: C.slate, margin: "8px 0 3px" };

// A shield and one tiny chip per source under a company name. Hover, focus or a tap opens what each detail came from and what was checked.
// `defaultOpen` is for tests and screenshots only.
export function SourceBadge({ account, defaultOpen = false }) {
  const d = describeSources(account);
  const name = account?.name || "this company";
  const Shield = d.checked || d.fields.length ? ShieldCheck : ShieldQuestion;
  const trigger = (
    <>
      <Shield size={15} aria-hidden="true" />
      {d.sources.map((s) => {
        if (s.key === "google_places") return <span key={s.label} aria-hidden="true" title="Google" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 18, height: 18, borderRadius: 5, background: C.surface, border: `1px solid ${C.border}` }}><GoogleG size={12} /></span>;
        const Icon = ICONS[s.key] || Globe;
        return <span key={s.label} aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 18, height: 18, borderRadius: 5, background: C.paperSoft, color: C.slate }}><Icon size={11} /></span>;
      })}
    </>
  );
  return (
    <Tooltip trigger={trigger} label={`Where ${name}'s details come from and what was checked. ${d.summary}`} defaultOpen={defaultOpen}
      triggerStyle={{ minWidth: 44, minHeight: 44, margin: "-12px 0", padding: "0 6px", color: d.checked ? C.green : C.slate, borderRadius: 8 }}>
      <div style={{ ...head, marginTop: 0 }}>Details from</div>
      {d.fields.length
        ? d.fields.map((f) => <div key={f.field} style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ color: C.slate }}>{f.field}:</span> {f.key === "google_places" ? <GoogleG size={12} /> : null}{f.label}</div>)
        : <div style={{ color: C.slate }}>No source is recorded for this company's details yet.</div>}
      <div style={head}>Checked against</div>
      {d.checked
        ? d.checks.map((c) => <div key={c.name}><b style={{ fontWeight: 600 }}>{c.name}:</b> {c.result}{c.when ? <span style={{ color: C.slate }}>, {c.when}</span> : null}</div>)
        : <div style={{ color: C.slate }}>Not checked yet</div>}
      {d.notes.map((n) => <div key={n} style={{ marginTop: 8, color: C.slate }}>{n}</div>)}
    </Tooltip>
  );
}
