import React from "react";
import { C } from "../../tokens";
import { Spinner } from "../../app/Loader";
import { Note, Pill, btn as baseBtn, card } from "../../adminPortal/ui";
import { ArrowLeft, Bot, Link2, Mail, Search } from "lucide-react";
import { niceName, personEmail, shortDate } from "./companyLogic";

const btn = (primary, disabled) => ({ ...baseBtn(primary, disabled), ...(primary ? { background: "var(--ui-accent)" } : {}), minHeight: 36 });
const small = { fontSize: 12, color: C.slate };

function Block({ title, source, children }) {
  return (
    <div style={{ ...card, display: "grid", gap: 8, padding: 14 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
        <strong style={{ fontSize: 14 }}>{title}</strong>
        {source ? <span style={small}>{source}</span> : null}
      </div>
      {children}
    </div>
  );
}

function Row({ label, children }) {
  if (children == null || children === "" || children === false) return null;
  return (
    <div style={{ display: "flex", gap: 10, fontSize: 13, lineHeight: 1.45 }}>
      <span style={{ width: 120, flexShrink: 0, color: C.slate }}>{label}</span>
      <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{children}</span>
    </div>
  );
}

const initials = (n) => String(n || "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");

// One person's own page: what the register says about them, what LinkedIn shows, and how to reach them.
export function PersonPage({ person, company, found, onBack, onFindEmail, onFindLinkedin, onAskAi, onOpenCompany }) {
  const o = person.raw || {};
  const officer = person.kind === "officer";
  const email = officer ? personEmail(found, o) : {};
  const li = found[`li:${o.name}`] || {};
  const liUrl = o.linkedin || li.url || "";
  const company_ = niceName(company.name);
  const years = o.years_in_role == null ? "" : o.years_in_role === 0 ? "Joined this year" : `${o.years_in_role} ${o.years_in_role === 1 ? "year" : "years"}`;
  return (
    <div style={{ display: "grid", gap: 14, minWidth: 0 }}>
      <button type="button" style={{ ...btn(false), justifySelf: "start" }} onClick={onBack}><ArrowLeft size={14} /> Back to {company_}</button>

      <header style={{ ...card, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", padding: 16 }}>
        <div aria-hidden="true" style={{ width: 56, height: 56, borderRadius: 14, background: "#e9f6cf", color: "#2f4a0c", display: "grid", placeItems: "center", fontWeight: 700, fontSize: 20 }}>{initials(person.name)}</div>
        <div style={{ flex: "1 1 260px", minWidth: 0, display: "grid", gap: 4 }}>
          <h2 style={{ margin: 0, fontSize: 21, overflowWrap: "anywhere" }}>{person.name}</h2>
          <div style={{ fontSize: 13.5, color: C.slate }}>{person.role} at <button type="button" onClick={onOpenCompany} style={{ all: "unset", cursor: "pointer", color: C.cobalt }}>{company_}</button></div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {person.alsoOwner ? <Pill tone="amber">Also an owner</Pill> : null}
            {person.reason ? <Pill tone={person.reason === "New in role" ? "green" : "slate"}>{person.reason}</Pill> : null}
          </div>
        </div>
        {onAskAi ? <button type="button" style={btn(false)} onClick={() => onAskAi(`Who is ${person.name} at ${company_} (${person.role}), and how should I approach them?`)}><Bot size={14} /> Ask AI</button> : null}
      </header>

      <div style={{ display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 320px", minWidth: 0, display: "grid", gap: 12 }}>
          <Block title="On the register" source="Official company records">
            <Row label="Role">{person.role}</Row>
            <Row label="Appointed">{o.appointed_on ? shortDate(o.appointed_on) : ""}</Row>
            <Row label="Time in the role">{years}</Row>
            <Row label="Ownership">{person.ownership}</Row>
            <Row label="Nationality">{o.nationality || (!officer ? person.raw.nationality : "")}</Row>
            <Row label="Occupation">{o.occupation}</Row>
            <Row label="Lives in">{o.country_of_residence}</Row>
            <Row label="Born">{o.born_year}</Row>
            {!o.appointed_on && !o.nationality && !o.occupation && !person.ownership ? <div style={small}>{person.meta || "The register publishes little about this person."}</div> : null}
          </Block>
        </div>

        <div style={{ flex: "1 1 320px", minWidth: 0, display: "grid", gap: 12 }}>
          <Block title="LinkedIn" source={liUrl ? "Public LinkedIn page" : ""}>
            {liUrl ? (
              <>
                {o.linkedin_title ? <div style={{ fontSize: 13.5, fontWeight: 600, overflowWrap: "anywhere" }}>{o.linkedin_title}</div> : null}
                {o.linkedin_note ? <div style={{ fontSize: 13, lineHeight: 1.5 }}>{o.linkedin_note}</div> : null}
                <div><a href={liUrl} target="_blank" rel="noreferrer" style={{ ...btn(false), textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }}><Link2 size={14} /> Open the LinkedIn page</a></div>
              </>
            ) : !officer ? <div style={small}>LinkedIn can be searched for directors and officers.</div>
              : (
                <>
                  {li.none ? <Note>{li.note || "Nothing confirmed for LinkedIn yet. Add details and search again."}</Note> : li.error ? <Note error>{li.error}</Note> : null}
                  <div data-reach={`li:${o.name}`} style={{ justifySelf: "start" }}>
                    <button type="button" style={btn(true, li.busy)} disabled={li.busy} onClick={() => onFindLinkedin(o)}>
                      {li.busy ? <Spinner size={13} /> : <Search size={13} />} {(li.options || []).length ? "Check matches" : li.none || li.error ? "Search again" : "Find LinkedIn"}
                    </button>
                  </div>
                </>
              )}
          </Block>

          {officer ? (
            <Block title="Contact" source="Work email">
              {email.email ? <a href={`mailto:${email.email}`} style={{ color: C.cobalt, fontSize: 14 }}>{email.email} <span style={small}>({email.status})</span></a>
                : email.none ? <Note>No email found for this person. Nothing charged.</Note>
                : <>
                    {email.error ? <Note error>{email.error}</Note> : null}
                    <div style={{ justifySelf: "start" }}><button type="button" style={btn(false, email.busy)} disabled={email.busy} onClick={() => onFindEmail(o)}>{email.busy ? <Spinner size={13} /> : <Mail size={13} />} {email.error ? "Search again" : "Find email"}</button></div>
                  </>}
            </Block>
          ) : null}
        </div>
      </div>
    </div>
  );
}
