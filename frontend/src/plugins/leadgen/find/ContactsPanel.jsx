import React, { useEffect, useState } from "react";
import { Spinner } from "../../../app/Loader";
import { Globe, Users } from "lucide-react";
import { C } from "../../../tokens";
import { api } from "../../../api/apiClient";
import { FieldMark } from "../SourceMark";
import { domainOf } from "../accounts/accountsLogic";
import { personEmail } from "../companyLogic";
import { NotesButton } from "../Notes";
import { LookupCost, announceCreditsChanged, useLookupPrice } from "../CreditsChip";
import { TierBadge, WebRow, muted, text } from "./findParts";
import { personLine } from "./findLogic";

export function ContactsPanel({ company }) {
  const lookupPrice = useLookupPrice();
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
      if (includeWeb && !findSiteOnly) announceCreditsChanged();  // a web lookup that found something just used a credit: the chip refreshes
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
    <div style={{ marginTop: 10, padding: 12, background: C.paper, borderRadius: 8, display: "flex", flexDirection: "column", gap: 10 }}>
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
                        <button type="button" title={`Look for this person's work email. ${lookupPrice || "Charged"} only if one is found`} className="ui-btn ui-btn--secondary ui-btn--sm" disabled={e.busy} onClick={() => findEmail(o)}>
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
              <div style={{ ...muted, fontSize: 12.5 }}>{[data.stored.website, data.stored.phone, data.stored.email].filter(Boolean).join(" · ")} <TierBadge tier={data.stored.tier} />{["website", "phone", "email"].map((f) => <FieldMark key={f} flags={company.restricted} field={f} />)}</div>
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
              <button type="button" title={`Search the web for this company's website and phone. ${lookupPrice || "Charged"} only if something is found`} className="ui-btn ui-btn--primary ui-btn--sm" disabled={busy} onClick={() => load(true)} style={{ marginTop: 8 }}>
                {busy ? <Spinner size={13} /> : <Globe size={13} />} Look for website &amp; phone on the web · <LookupCost />
              </button>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
