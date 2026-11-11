import React, { useCallback, useEffect, useState } from "react";
import { C } from "../../tokens";
import { api } from "../../api/apiClient";
import { Spinner } from "../../app/Loader";
import { Note, Pill, btn as baseBtn, card } from "../../adminPortal/ui";
import { CompanyAvatar, ProfileBadge } from "./FindLeadsParts";
import { asAccount } from "./FindLeadsView";
import { ContactPoints } from "./ContactPoints";
import { OrgChart } from "./OrgChart";
import { PersonPage } from "./PersonPage";
import { PickOptions, SOCIAL } from "./PickOptions";
import { ArrowLeft, Bot, Check, ExternalLink, Globe, Link2, Mail, Phone, Plus, Search, XCircle } from "lucide-react";
import { SIGNAL_TONES, STATUS_PILL, TABS, activityRows, contactRows, filingRows, niceName, orderSignals, peopleCount, personEmail, personMeta, sameOfficer, personName, shortDate, subLine } from "./companyLogic";
import { LookupCost, announceCreditsChanged } from "./CreditsChip";
import { BottomBar, Collapsible, JourneyControl, ProfileTabs, TabPanel, useProfileTab } from "./ProfileLayout";
import { LatestNote, NotesButton, NotesTab, useNotes } from "./Notes";
import { LeadActivity } from "./LeadActivity";

// The register-led tabs, plus the team's notes. Research and editable details live on the saved company's panel, not here.
const PAGE_TABS = [...TABS.filter(([k]) => k !== "activity"), ["notes", "Notes"], ...TABS.filter(([k]) => k === "activity")];
const TAB_TIPS = { overview: "Why now, in plain words, and who to speak to", people: "Directors, officers and owners on the register", filings: "Filing dates and previous names", notes: "Notes your team wrote on this company. Everyone in your organisation sees them", activity: "Call, email or book a meeting, set the stage, and see everything that has happened" };

const btn = (primary, disabled) => ({ ...baseBtn(primary, disabled), ...(primary ? { background: "var(--ui-accent)" } : {}), minHeight: 36 });
const small = { fontSize: 12, color: C.slate };
const row = { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" };
const TONE = { green: { bg: "#f0fdf4", ink: "#166534" }, amber: { bg: "#fffbeb", ink: "#92400e" }, blue: { bg: "#eff6ff", ink: "#1e40af" }, red: { bg: "#fef2f2", ink: "#b91c1c" } };
const SOURCE_TONE = { register: "green", web: "amber", missing: "slate" };
const ICON = { website: Globe, phone: Phone, email: Mail };
const KIND_WORDS = { email: "Email", call: "Call", meeting: "Meeting", post: "Post", note: "Note", status: "Update" };

// A labelled block of facts in the left column.
function Facts({ title, children }) {
  return (
    <div style={{ ...card, display: "grid", gap: 8, padding: 14 }}>
      <strong style={{ fontSize: 13.5 }}>{title}</strong>
      {children}
    </div>
  );
}

function Fact({ label, children, warn }) {
  if (children == null || children === "") return null;
  return (
    <div style={{ display: "flex", gap: 10, fontSize: 13, lineHeight: 1.45 }}>
      <span style={{ width: 96, flexShrink: 0, color: C.slate }}>{label}</span>
      <span style={{ minWidth: 0, overflowWrap: "anywhere", color: warn ? "#b91c1c" : C.textInk }}>{children}</span>
    </div>
  );
}

const personCard = (o) => ({ key: `officer:${o.name}`, kind: "officer", name: `${o.first_name} ${o.last_name}`.trim(), raw: o, role: o.role || "Officer", meta: personMeta(o), reason: o.reason || "", alsoOwner: false, ownership: "" });

const SOURCE_WORDS = { import: "Imported from your file", manual: "You added it", scout: "From a search", copilot: "From the assistant" };

// What the person gave us about this company (their file's own columns, notes, the contact they named) and what the check said, apart from the register's facts.
function FromYou({ mine }) {
  const custom = Object.entries(mine.custom || {}).filter(([, v]) => String(v || "").trim());
  const flags = mine.import_flags || [];
  return (
    <Facts title="From you">
      <div style={small}>{SOURCE_WORDS[mine.source] || "Saved by you"}{mine.added ? ` · ${shortDate(mine.added)}` : ""}</div>
      <Fact label="Contact">{[mine.contact_name, mine.contact_title].filter(Boolean).join(" · ")}</Fact>
      <Fact label="Website">{mine.website}</Fact>
      <Fact label="Phone">{mine.phone}</Fact>
      <Fact label="Email">{mine.email}</Fact>
      <Fact label="Your number">{mine.registration_number}</Fact>
      {custom.map(([k, v]) => <Fact key={k} label={k}>{v}</Fact>)}
      {mine.check?.verdict ? <Fact label="Check">{mine.check.verdict.replace(/_/g, " ")}{mine.check.reasons?.[0] ? ` · ${mine.check.reasons[0]}` : ""}</Fact> : null}
      {flags.map((f) => <Fact key={f.code} label="Warning" warn>{f.text}</Fact>)}
    </Facts>
  );
}

// The people on the register, one row each, with the reason they are worth a look and a way to find their email.
function People({ c, onFindEmail, onOpenPerson, found, onOverview }) {
  const [view, setView] = useState("chart");
  const { officers, leavers, read, from_registry: fromRegistry } = c.people;
  const controllers = c.people.controllers;
  const alsoDirector = (p) => sameOfficer(p, officers);
  const hasPeople = officers.length > 0 || controllers.length > 0;
  const showChart = hasPeople && view === "chart";
  return (
    <div style={{ display: "grid", gap: 14 }}>
      {hasPeople ? (
        <div role="group" aria-label="How to show people" style={{ display: "flex", gap: 6 }}>
          {[["chart", "Org chart"], ["list", "List"]].map(([k, w]) => <button key={k} type="button" aria-pressed={view === k} title={k === "chart" ? "Show the people as an org chart" : "Show the people as a list"} style={btn(view === k)} onClick={() => setView(k)}>{w}</button>)}
        </div>
      ) : null}
      {showChart ? <OrgChart c={c} onOpenPerson={onOpenPerson} onOverview={onOverview} /> : null}
      {showChart ? null : officers.length ? (
        <div style={{ ...card, padding: 0 }}>
          <div style={{ padding: "12px 14px", fontWeight: 700, fontSize: 14 }}>Directors and officers <span style={{ ...small, fontWeight: 500 }}>verified from the register</span></div>
          {officers.map((o) => {
            const f = personEmail(found, o);
            return (
              <div key={o.name} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "10px 14px", borderTop: `1px solid ${C.borderLight}` }}>
                <div style={{ minWidth: 0, flex: "1 1 220px" }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{o.first_name} {o.last_name} <span style={{ fontWeight: 400, color: C.slate }}>· {o.role || "Officer"}</span></div>
                  {personMeta(o) ? <div style={small}>{personMeta(o)}</div> : null}
                </div>
                {o.reason ? <Pill tone={o.reason === "New in role" ? "green" : "slate"}>{o.reason}</Pill> : null}
                <NotesButton companyId={c.id} person={o.name} name={`${o.first_name} ${o.last_name}`.trim() || o.name} />
                <button type="button" title={`Open ${o.first_name} ${o.last_name}'s own page`} style={btn(false)} onClick={() => onOpenPerson(personCard(o))}>Open profile</button>
                {f.email ? <span style={{ fontSize: 12.5, color: C.green }}>{f.email} ({f.status})</span>
                  : f.none ? <span style={small}>No email found. Nothing charged.</span>
                  : <>
                      {f.error ? <span style={{ ...small, color: C.red }}>{f.error}</span> : null}
                      <button type="button" style={btn(false, f.busy)} disabled={f.busy} title="Look for this person's work email. 1 Leads credit only if one is found"
                        onClick={() => onFindEmail(o)}>{f.busy ? <Spinner size={12} /> : <Mail size={13} />} Find email · <LookupCost /></button>
                    </>}
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ ...card, ...small }}>{!fromRegistry ? "This kind of organisation has no directors on the public register." : read ? "The register lists no current officers for this company." : "The people on the register haven't been read yet."}</div>
      )}
      {!showChart && controllers.length ? (
        <div style={{ ...card, padding: 0 }}>
          <div style={{ padding: "12px 14px", fontWeight: 700, fontSize: 14 }}>Who owns or controls it</div>
          {controllers.map((p) => (
            <div key={p.name} style={{ padding: "10px 14px", borderTop: `1px solid ${C.borderLight}` }}>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>{p.name}{p.since ? <span style={{ fontWeight: 400, color: C.slate }}> · since {p.since.slice(0, 4)}</span> : null}{alsoDirector(p) ? <span style={{ fontWeight: 400, color: C.slate }}> · also a director</span> : null}</div>
              <div style={small}>{[...p.controls, p.nationality, p.country_of_residence ? `lives in ${p.country_of_residence}` : ""].filter(Boolean).join(" · ")}</div>
            </div>
          ))}
        </div>
      ) : null}
      {leavers.length ? <div style={small}>Left in the last year: {leavers.map((l) => `${personName(l.name)} (${l.role}, ${shortDate(l.resigned_on)})`).join("; ")}</div> : null}
    </div>
  );
}

export function CompanyPage({ id, store, onBack, onGo, onAskAi, onOpenJourney, backLabel = "Back to results" }) {
  const [c, setC] = useState(null);
  const [err, setErr] = useState("");
  const [tab, setTab] = useProfileTab("company", PAGE_TABS.map(([k]) => k), "overview");
  const notesApi = useNotes({ companyId: id });
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState({ text: "", error: false });
  const [found, setFound] = useState({});
  const [pick, setPick] = useState(null); // {kind, person, options}: a lookup that was not sure, waiting for the person to choose
  const [waiting, setWaiting] = useState({}); // kind -> the matches the person has not chosen from yet
  const [person, setPerson] = useState(null); // the person whose own page is open
  const [li, setLi] = useState(""); // "busy" while the company's LinkedIn lookup runs

  const load = useCallback(async () => {
    try { const r = await api.companyProfile(id); setC(r.company); setErr(""); } catch (e) { setErr(e.message || "Couldn't open this company."); }
  }, [id]);
  useEffect(() => { setC(null); setFound({}); setMsg({ text: "", error: false }); load(); }, [id, load]);

  if (!c) {
    return (
      <div style={{ display: "grid", gap: 12 }}>
        <button type="button" title={backLabel} style={{ ...btn(false), justifySelf: "start" }} onClick={onBack}><ArrowLeft size={14} /> {backLabel}</button>
        {err ? <Note error>{err}</Note> : <div role="status" style={{ ...card, display: "flex", gap: 10, alignItems: "center" }}><Spinner size={16} /> Reading what we hold, and the register's people. This takes a few seconds the first time.</div>}
      </div>
    );
  }

  const name = niceName(c.name);
  const contacts = contactRows(c.contact);
  const signals = orderSignals(c.signals);
  const first = c.sic[0];
  const say = (text, error = false) => setMsg({ text, error });
  const find = async (kind) => {
    if (waiting[kind]) { setPick({ kind, person: "", anchor: kind, options: waiting[kind] }); return; }
    setBusy(kind);
    try { const r = await api.findCompanyWebsite(c.id, kind); if (r.charged) announceCreditsChanged(); if (!r.found) { setPick({ kind, person: "", anchor: kind, options: r.options || [] }); if ((r.options || []).length) setWaiting((w) => ({ ...w, [kind]: r.options })); } say(r.found ? `Found the ${kind}${r.source === "deep" ? " with the deep web search" : r.source === "web" ? " with the web search" : ""}.${r.charged ? " Credits used for this find." : ""}` : r.note || "Nothing found. Nothing was charged."); await load(); } catch (e) { say(e.message || "The lookup didn't finish. Nothing was charged.", true); }
    setBusy("");
  };
  // Opens everything our registry holds for this company. Free, once. It never searches for anything.
  const open = async () => {
    setBusy("open");
    try { await api.revealMany([c.id]); say("Opened what we hold. It stays visible from now on."); await load(); } catch (e) { say(e.message || "Couldn't open that.", true); }
    setBusy("");
  };
  const NETS = { linkedin: "LinkedIn page", facebook: "Facebook page", x: "X profile", instagram: "Instagram profile" };
  const findNetwork = async (network) => {
    if (waiting[network]) { setPick({ kind: network, person: "", anchor: network, options: waiting[network] }); return; }
    setLi(network);
    try {
      const r = await api.findSocial(c.id, network);
      if (r.charged) announceCreditsChanged();
      if (!r.found) { setPick({ kind: network, person: "", anchor: network, options: r.options || [] }); if ((r.options || []).length) setWaiting((w) => ({ ...w, [network]: r.options })); }
      say(r.found ? `Found the ${NETS[network]}.` : (r.options || []).length ? "Pick the right one from the closest matches." : r.note || "Nothing confirmed yet. Add details and search again.");
      await load();
    } catch (e) { say(e.message || "The lookup didn't finish. Try again later.", true); }
    setLi("");
  };
  const findPersonLinkedin = async (o) => {
    const key = `li:${o.name}`;
    if ((found[key]?.options || []).length) { setPick({ kind: "linkedin", person: `${o.first_name} ${o.last_name}`.trim(), names: { first_name: o.first_name, last_name: o.last_name }, anchor: key, options: found[key].options }); return; }
    setFound((m) => ({ ...m, [key]: { busy: true } }));
    try {
      const r = await api.findLinkedin(c.id, { first_name: o.first_name, last_name: o.last_name });
      if (r.charged) announceCreditsChanged();
      if (!r.found) setPick({ kind: "linkedin", person: `${o.first_name} ${o.last_name}`.trim(), names: { first_name: o.first_name, last_name: o.last_name }, anchor: key, options: r.options || [] });
      setFound((m) => ({ ...m, [key]: r.found ? { url: r.url } : (r.options || []).length ? { options: r.options } : { none: true, note: r.note || "" } }));
      if (r.found) await load();
    } catch (e) { setFound((m) => ({ ...m, [key]: { error: e.message || "Couldn't look that up." } })); }
  };
  const save = async () => {
    setBusy("save");
    try {
      const card_ = { id: c.id, name: c.name, website: c.contact.website.value, phone: c.contact.phone.value, email: c.contact.email.value, industry: first ? first.text : "", region: c.region, registration_number: c.registration_number, status: c.status, postcode: c.postcode };
      if (await store.save([asAccount(card_)], "Unsorted", { quiet: true })) {
        say("Saved to your Unsorted list.");
        await load();
      }
    } catch (e) { say(e.message || "Couldn't save it.", true); }
    setBusy("");
  };
  const findEmail = async (o) => {
    setFound((m) => ({ ...m, [o.name]: { busy: true } }));
    try {
      const r = await api.findPersonEmail(c.id, { name: o.name, first_name: o.first_name, last_name: o.last_name });
      if (r.charged) announceCreditsChanged();
      setFound((m) => ({ ...m, [o.name]: r.found ? { email: r.email, status: r.verification_status } : { none: true } }));
    } catch (e) { setFound((m) => ({ ...m, [o.name]: { error: e.message || "Couldn't look that up." } })); }
  };

  const pickEl = pick ? <PickOptions key={pick.anchor} kind={pick.kind} company={name} options={pick.options} anchorKey={pick.anchor} onClose={() => setPick(null)}
    onRetry={async (hint) => {
      const k = pick.kind;
      const r = pick.names ? await api.findLinkedin(c.id, { ...pick.names, hint })
        : SOCIAL.includes(k) ? await api.findSocial(c.id, k, hint) : await api.findCompanyWebsite(c.id, k, hint);
      const matches = !r.found && (r.options || []).length ? r.options : [];
      setWaiting((w) => ({ ...w, [k]: matches.length ? matches : null }));
      if (pick.anchor?.startsWith("li:")) setFound((m) => ({ ...m, [pick.anchor]: r.found ? { url: r.url } : matches.length ? { options: matches } : { none: true } }));
      if (r.found) { say(`Found the ${k === "website" ? "website" : (NETS[k] || k)}.`); await load(); }
      return { done: Boolean(r.found), options: matches };
    }}
    onPick={async (o) => {
      const picked = await api.chooseContact(c.id, { kind: pick.kind, value: o.value, person: pick.person });
      if (picked?.charged) announceCreditsChanged();
      setWaiting((w) => ({ ...w, [pick.kind]: null }));
      if (pick.anchor?.startsWith("li:")) setFound((m) => ({ ...m, [pick.anchor]: {} }));
      say(picked?.charged ? "Saved. Credits used for this find. It will show for this company from now on." : "Saved. It will show for this company from now on.");
      await load();
    }} /> : null;
  if (person) {
    // the person's own page keeps the register facts fresh: the officer record is read again from the loaded company
    const live = (c.people.officers || []).find((x) => x.name === person.raw.name);
    const shown = live ? { ...person, raw: live } : person;
    return (
      <>
        {pickEl}
        <PersonPage person={shown} company={c} found={found} onBack={() => setPerson(null)} onOpenCompany={() => { setPerson(null); setTab("overview"); }}
          onFindEmail={findEmail} onFindLinkedin={findPersonLinkedin} onAskAi={onAskAi} />
      </>
    );
  }

  return (
    <div style={{ display: "grid", gap: 14, minWidth: 0 }}>
      {pickEl}
      <button type="button" title={backLabel} style={{ ...btn(false), justifySelf: "start" }} onClick={onBack}><ArrowLeft size={14} /> {backLabel}</button>

      <header style={{ ...card, display: "grid", gap: 12, padding: 16, minWidth: 0 }}>
        <div style={{ display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
          <CompanyAvatar c={{ id: c.id, name: c.name, website: c.contact.website.value }} size={52} />
          <div style={{ minWidth: 0, flex: "1 1 260px", display: "grid", gap: 4 }}>
            <div style={row}>
              <h2 style={{ margin: 0, fontSize: 21, lineHeight: 1.25, overflowWrap: "anywhere" }}>{name}</h2>
              {c.status ? <Pill tone={STATUS_PILL[c.status_tone]}>{c.status}</Pill> : null}
              <ProfileBadge profile={c.profile} />
            </div>
            <div style={small}>{subLine(c)}</div>
            {first ? <div style={small}>{first.text}</div> : null}
            <LatestNote note={notesApi.notes[0]} onOpen={() => setTab("notes")} style={{ maxWidth: "100%" }} />
          </div>
          <div style={{ ...row, justifyContent: "flex-end", flex: "1 1 200px" }}>
            {c.saved ? <span style={{ ...small, color: C.green, display: "inline-flex", gap: 4, alignItems: "center" }}><Check size={14} /> Saved{c.stage && c.stage !== "new" ? ` · ${c.stage.replace(/_/g, " ")}` : ""}</span> : null}
            <button type="button" title="Ask the assistant why to contact this company now, and who to speak to" style={btn(false)} onClick={() => onAskAi?.(`Tell me about ${name}: why contact them now, and who to speak to.`)}><Bot size={14} /> Ask AI</button>
          </div>
        </div>
        <div style={{ ...row, gap: 10 }}>
          {contacts.map((k) => {
            const Icon = ICON[k.kind];
            return (
              <div key={k.kind} data-reach={k.kind} style={{ display: "inline-flex", gap: 7, alignItems: "center", padding: "6px 10px", border: `1px solid ${C.borderLight}`, borderRadius: 10, background: "#fff", maxWidth: "100%" }}>
                <Icon size={14} color={C.slate} aria-hidden="true" />
                {k.value ? <a href={k.href} target={k.kind === "website" ? "_blank" : undefined} rel="noreferrer" style={{ color: C.cobalt, fontSize: 13, overflowWrap: "anywhere" }}>{k.shown}</a>
                  : k.kind === "website" && c.listing_page && c.listing_page.url
                    ? <span title={`${c.listing_page.why || ""}. The company's page on ${c.listing_page.site}, not a website of its own.`} style={{ fontSize: 13 }}>
                        <a href={c.listing_page.url} target="_blank" rel="noreferrer" style={{ color: C.cobalt, overflowWrap: "anywhere" }}>Listed on {c.listing_page.site}</a>{" "}
                        <span style={{ fontSize: 10.5, color: c.listing_page.confirmed ? C.green : C.slate }}>{c.listing_page.confirmed ? "page confirmed" : "unconfirmed"}</span>
                        {[...((c.listing_page.also_seen || {}).phones || []), ...((c.listing_page.also_seen || {}).emails || [])].length
                          ? <span style={{ display: "block", fontSize: 11.5, color: C.slate }}>Also on that page: {[...((c.listing_page.also_seen || {}).phones || []), ...((c.listing_page.also_seen || {}).emails || [])].join(", ")}. Not added to the company. Use Find phone or Find email to pick it.</span> : null}</span>
                    : <span style={{ fontSize: 13, color: C.slate }}>{k.kind === "website" ? "Website" : k.kind === "phone" ? "Phone" : "Email"}</span>}
                {k.closed ? <span title="We hold this. Use Reveal" style={{ fontSize: 13, color: C.slateLight }}>Held</span> : null}
                {k.value || (!k.canFind && !k.closed) ? <span title={k.label}><Pill tone={SOURCE_TONE[k.source]}>{k.sourceWord}</Pill></span> : null}
                {k.canFind ? <button type="button" title={waiting[k.kind] ? "Check the closest matches and choose the right one" : `Look for this company's ${k.kind}. Charged only if one is found`} style={{ ...btn(false, busy === k.kind), padding: "3px 9px", minHeight: 28 }} disabled={busy === k.kind} onClick={() => find(k.kind)}>
                  {busy === k.kind ? <Spinner size={12} /> : waiting[k.kind] ? <Search size={12} /> : k.missed ? <XCircle size={12} color={C.red} /> : <Search size={12} />} {waiting[k.kind] ? "Check matches" : k.missed ? "Nothing confirmed · search again" : <>Find · <LookupCost /></>}</button> : null}
              </div>
            );
          })}
          {contacts.some((k) => k.closed) ? (
            <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" disabled={busy === "open"} title="Show the website, phone and email we hold. Free." onClick={open}>
              {busy === "open" ? <Spinner size={12} /> : null} Reveal</button>
          ) : null}
        </div>
        <div style={{ ...row, gap: 10 }}>
          {Object.entries(NETS).map(([network, label]) => (
            <div key={network} data-reach={network} style={{ display: "inline-flex", gap: 7, alignItems: "center", padding: "6px 10px", border: `1px solid ${C.borderLight}`, borderRadius: 10, background: "#fff" }}>
              <Link2 size={14} color={C.slate} aria-hidden="true" />
              {(c.links || {})[network] ? <a href={c.links[network]} target="_blank" rel="noreferrer" style={{ color: C.cobalt, fontSize: 13 }}>{label}</a>
                : <button type="button" title={waiting[network] ? "Check the closest matches and choose the right one" : `Look for this company's ${label}`} style={{ ...btn(false, li === network), padding: "3px 9px", minHeight: 28 }} disabled={li === network} onClick={() => findNetwork(network)}>
                  {li === network ? <Spinner size={12} /> : <Search size={12} />} {waiting[network] ? "Check matches" : `Find ${label}`}</button>}
            </div>
          ))}
        </div>
        <Note error={msg.error}>{msg.text}</Note>
      </header>

      <div style={{ display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
        <aside aria-label="At a glance" style={{ flex: "1 1 270px", maxWidth: 340, minWidth: 0, display: "grid", gap: 12 }}>
          <Facts title="At a glance">
            <Fact label="Reg. number">{c.registration_number}</Fact>
            <Fact label="Status">{c.status}</Fact>
            <Fact label="Type">{c.type}</Fact>
            <Fact label="Incorporated">{c.incorporated}</Fact>
            <Fact label="Size">{c.size}</Fact>
            <Fact label="Industry">{c.sic.length ? c.sic.map((s) => `${s.text} (${s.code})`).join("; ") : ""}</Fact>
            <Fact label="Address">{c.address ? (
              <>{c.address} <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(c.address)}`} target="_blank" rel="noreferrer" aria-label="Open the address in a map" title="Open the address in a map" style={{ color: C.cobalt }}><ExternalLink size={12} /></a></>) : ""}</Fact>
          </Facts>
          {c.mine ? <FromYou mine={c.mine} /> : null}
          <ContactPoints id={c.id} stamp={`${c.phone || ""}|${c.email || ""}|${c.website || ""}|${JSON.stringify(c.links || {})}`} />
          <Facts title="In your account">
            {c.saved ? (
              <>
                <Fact label="Stage">{(c.stage || "new").replace(/_/g, " ")}</Fact>
                <Fact label="Lists">{c.lists.join(", ") || "Not in a list"}</Fact>
              </>
            ) : <div style={small}>Not saved yet. Save it to keep notes, lists and a history.</div>}
            {c.journeys.length ? c.journeys.map((j) => (
              <button key={j.id} type="button" title={`Open the journey ${j.name}`} style={{ all: "unset", cursor: "pointer", fontSize: 13, color: C.cobalt }} onClick={() => onOpenJourney?.(j.id)}>{j.name} <span style={small}>· {j.person_status === "active" ? `step ${j.step}` : j.person_status}</span></button>
            )) : c.saved ? <div style={small}>Not in any journey.</div> : null}
          </Facts>
        </aside>

        <main style={{ flex: "3 1 440px", minWidth: 0, display: "grid", gap: 12 }}>
          <ProfileTabs idBase={`company-${c.id}`} label="Company sections" value={tab} onChange={setTab}
            tabs={PAGE_TABS.map(([k, w]) => ({ id: k, label: w, tip: TAB_TIPS[k], count: k === "people" ? peopleCount(c.people) : k === "notes" ? notesApi.notes.length : 0 }))} />

          <TabPanel idBase={`company-${c.id}`} id="overview" value={tab} style={{ ...card, padding: "0 14px" }}>
            <Collapsible id="company:whynow" defaultOpen title="Why now" summary={signals.length ? `${signals.length} ${signals.length === 1 ? "sign" : "signs"}` : "Nothing stands out"}>
              <div style={{ display: "grid", gap: 8 }}>
                {signals.length ? signals.map((s) => {
                  const t = TONE[SIGNAL_TONES[s.tone]] || TONE.blue;
                  return <div key={s.key} style={{ background: t.bg, color: t.ink, borderRadius: 8, padding: "8px 11px", fontSize: 13, lineHeight: 1.45 }}><strong>{s.label}.</strong> {s.detail}</div>;
                }) : <div style={small}>Nothing stands out on the register right now.</div>}
              </div>
            </Collapsible>
            <Collapsible id="company:plain" title="In plain words" summary={c.summary ? c.summary.slice(0, 80) : ""}>
              <div style={{ display: "grid", gap: 6 }}>
                <div style={{ fontSize: 13.5, lineHeight: 1.55 }}>{c.summary}</div>
                {c.description ? <div style={{ fontSize: 13, lineHeight: 1.5, color: C.slate }}>{c.description}</div> : null}
                <div style={small}>Written from what we hold. Nothing here is guessed.</div>
              </div>
            </Collapsible>
            {c.people.officers.length ? (
              <Collapsible id="company:speak" title="Who to speak to" summary={`${c.people.officers.length} ${c.people.officers.length === 1 ? "person" : "people"} on the register`}
                right={<button type="button" title="Show everyone on the register" style={btn(false)} onClick={() => setTab("people")}>See all</button>}>
                <div style={{ display: "grid", gap: 6 }}>
                  {c.people.officers.slice(0, 3).map((o) => <div key={o.name} style={{ fontSize: 13.5 }}>{o.first_name} {o.last_name} <NotesButton companyId={c.id} person={o.name} name={`${o.first_name} ${o.last_name}`.trim()} /> <span style={{ color: C.slate }}>· {o.role}{o.reason ? ` · ${o.reason}` : ""}</span></div>)}
                </div>
              </Collapsible>
            ) : null}
          </TabPanel>

          <TabPanel idBase={`company-${c.id}`} id="people" value={tab}>
            <People c={c} onFindEmail={findEmail} onOpenPerson={setPerson} found={found} onOverview={() => setTab("overview")} />
          </TabPanel>

          <TabPanel idBase={`company-${c.id}`} id="filings" value={tab} style={{ ...card, padding: "0 14px" }}>
            <Collapsible id="company:register" defaultOpen title="From the register" summary={filingRows(c).length ? `${filingRows(c).length} dates` : "No filing dates"}>
              <div style={{ display: "grid", gap: 8 }}>
                {filingRows(c).length ? filingRows(c).map((r) => <Fact key={r.label} label={r.label} warn={r.warn}>{r.value}{r.note ? ` (${r.note})` : ""}</Fact>) : <div style={small}>No filing dates are stored for this company.</div>}
              </div>
            </Collapsible>
            {c.previous_names.length ? (
              <Collapsible id="company:names" title="Previous names" summary={`${c.previous_names.length}`}>
                {c.previous_names.map((p) => <div key={p.name} style={{ fontSize: 13 }}>{niceName(p.name)}{p.until ? <span style={small}> · until {p.until}</span> : null}</div>)}
              </Collapsible>
            ) : null}
            <div style={{ ...small, padding: "10px 0" }}>Company figures such as turnover and profit are not shown yet.</div>
          </TabPanel>

          <TabPanel idBase={`company-${c.id}`} id="notes" value={tab} style={{ ...card, padding: 14 }}>
            <NotesTab notesApi={notesApi} />
          </TabPanel>

          <TabPanel idBase={`company-${c.id}`} id="activity" value={tab} style={{ ...card, padding: "0 14px" }}>
            <Collapsible id="company:activity" defaultOpen title="Activity" summary={activityRows(c.activity).length ? `${activityRows(c.activity).length} events` : "Nothing yet"}>
              {c.saved && c.lead_id ? (
                <LeadActivity store={store} onGoTab={setTab} find={{ text: "Use Find next to it at the top of this page.", tab: "" }}
                  account={{ id: c.lead_id, name, business_record_id: c.id, email: c.contact.email.value || "", phone: c.contact.phone.value || "", connection: { stage: c.stage || "new" } }} />
              ) : activityRows(c.activity).length ? activityRows(c.activity).map((a, i) => (
                <div key={i} style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "10px 0", borderTop: i ? `1px solid ${C.borderLight}` : "none" }}>
                  <span style={{ ...small, width: 56, flexShrink: 0 }}>{a.when}</span>
                  <span style={{ fontSize: 13.5, minWidth: 0, overflowWrap: "anywhere" }}><strong>{KIND_WORDS[a.kind] || a.kind}</strong> · {a.summary}</span>
                </div>
              )) : <div style={small}>{c.saved ? "Nothing has happened yet. Add it to an email journey with the button at the bottom." : "Save this company first with Save at the bottom. Then you can call, email and book meetings from here, and everything that happens shows on its timeline."}</div>}
            </Collapsible>
          </TabPanel>
        </main>
      </div>
      <BottomBar note={notesApi.notes[0]} onOpenNotes={() => setTab("notes")}
        journey={<JourneyControl companyId={c.id} accountId={c.lead_id || ""} companyName={name} onOpenJourney={onOpenJourney} onNewJourney={onGo ? () => onGo("outreach") : undefined} onAdded={load} />}
        actions={c.saved ? <span style={{ ...small, color: C.green, display: "inline-flex", gap: 4, alignItems: "center" }}><Check size={14} /> Saved</span>
          : <button type="button" title="Save this company to your Unsorted list" style={btn(true, busy === "save")} disabled={busy === "save"} onClick={save}><Plus size={14} /> Save</button>} />
    </div>
  );
}
