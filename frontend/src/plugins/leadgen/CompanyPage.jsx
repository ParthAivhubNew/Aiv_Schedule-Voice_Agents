import React, { useCallback, useEffect, useState } from "react";
import { C } from "../../tokens";
import { api } from "../../api/apiClient";
import { Spinner } from "../../app/Loader";
import { Note, Pill, btn as baseBtn, card } from "../../adminPortal/ui";
import { domainOf } from "./AccountsViews";
import { CompanyAvatar, ProfileBadge } from "./FindLeadsParts";
import { asAccount } from "./FindLeadsView";
import { ArrowLeft, Bot, Check, ExternalLink, Globe, Mail, Phone, Plus, Route, Search } from "lucide-react";
import { SIGNAL_TONES, STATUS_PILL, TABS, activityRows, contactRows, filingRows, niceName, orderSignals, peopleCount, personMeta, personName, shortDate, subLine } from "./companyLogic";

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

// The people on the register, one row each, with the reason they are worth a look and a way to find their email.
function People({ c, onFindEmail, found }) {
  const { officers, leavers, controllers, read, from_registry: fromRegistry } = c.people;
  const domain = domainOf(c.contact.website.value);
  return (
    <div style={{ display: "grid", gap: 14 }}>
      {officers.length ? (
        <div style={{ ...card, padding: 0 }}>
          <div style={{ padding: "12px 14px", fontWeight: 700, fontSize: 14 }}>Directors and officers <span style={{ ...small, fontWeight: 500 }}>verified from the register</span></div>
          {officers.map((o) => {
            const f = found[o.name] || {};
            return (
              <div key={o.name} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "10px 14px", borderTop: `1px solid ${C.borderLight}` }}>
                <div style={{ minWidth: 0, flex: "1 1 220px" }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{o.first_name} {o.last_name} <span style={{ fontWeight: 400, color: C.slate }}>· {o.role || "Officer"}</span></div>
                  {personMeta(o) ? <div style={small}>{personMeta(o)}</div> : null}
                </div>
                {o.reason ? <Pill tone={o.reason === "New in role" ? "green" : "slate"}>{o.reason}</Pill> : null}
                {f.email ? <span style={{ fontSize: 12.5, color: C.green }}>{f.email} ({f.status})</span>
                  : f.none ? <span style={small}>No email found. Nothing charged.</span>
                  : f.error ? <span style={{ ...small, color: C.red }}>{f.error}</span>
                  : <button type="button" style={btn(false, f.busy)} disabled={f.busy} title={domain ? "Look for this person's work email. 1 Leads credit only if one is found" : "Find the company's website first"}
                      onClick={() => onFindEmail(o)}>{f.busy ? <Spinner size={12} /> : <Mail size={13} />} Find email · 1 credit if found</button>}
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ ...card, ...small }}>{!fromRegistry ? "This kind of organisation has no directors on Companies House." : read ? "The register lists no current officers for this company." : "The people on the register haven't been read yet."}</div>
      )}
      {controllers.length ? (
        <div style={{ ...card, padding: 0 }}>
          <div style={{ padding: "12px 14px", fontWeight: 700, fontSize: 14 }}>Who owns or controls it</div>
          {controllers.map((p) => (
            <div key={p.name} style={{ padding: "10px 14px", borderTop: `1px solid ${C.borderLight}` }}>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>{p.name}{p.since ? <span style={{ fontWeight: 400, color: C.slate }}> · since {p.since.slice(0, 4)}</span> : null}</div>
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
  const [tab, setTab] = useState("overview");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState({ text: "", error: false });
  const [menu, setMenu] = useState(false);
  const [journeys, setJourneys] = useState(null);
  const [found, setFound] = useState({});

  const load = useCallback(async () => {
    try { const r = await api.companyProfile(id); setC(r.company); setErr(""); } catch (e) { setErr(e.message || "Couldn't open this company."); }
  }, [id]);
  useEffect(() => { setC(null); setTab("overview"); setFound({}); setMsg({ text: "", error: false }); load(); }, [id, load]);

  if (!c) {
    return (
      <div style={{ display: "grid", gap: 12 }}>
        <button type="button" style={{ ...btn(false), justifySelf: "start" }} onClick={onBack}><ArrowLeft size={14} /> {backLabel}</button>
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
    setBusy(kind);
    try { const r = await api.findCompanyWebsite(c.id, kind); say(r.found ? `Found the ${kind}.${r.charged ? ` ${r.charged} credit used.` : ""}` : r.note || "Nothing found. Nothing was charged."); await load(); } catch (e) { say(e.message || "The lookup didn't finish. Nothing was charged.", true); }
    setBusy("");
  };
  const save = async () => {
    setBusy("save");
    try {
      const card_ = { id: c.id, name: c.name, website: c.contact.website.value, phone: c.contact.phone.value, email: c.contact.email.value, industry: first ? first.text : "", region: c.region, registration_number: c.registration_number, status: c.status, postcode: c.postcode };
      await store.save([asAccount(card_)]);
      say("Saved to your Unsorted list.");
      await load();
    } catch (e) { say(e.message || "Couldn't save it.", true); }
    setBusy("");
  };
  const openMenu = async () => {
    setMenu((m) => !m);
    if (!journeys) { try { setJourneys((await api.journeys()).journeys || []); } catch (e) { setJourneys([]); } }
  };
  const addTo = async (j) => {
    setMenu(false);
    setBusy("journey");
    try { const r = await api.companyAddToJourney(c.id, j.id); say(`Added to ${r.journey}. Nothing is sent until the journey is running.`); await load(); } catch (e) { say(e.message || "It couldn't be added.", true); }
    setBusy("");
  };
  const findEmail = async (o) => {
    const domain = domainOf(c.contact.website.value);
    if (!domain) { setFound((m) => ({ ...m, [o.name]: { error: "Find the company's website first, then ask again." } })); return; }
    setFound((m) => ({ ...m, [o.name]: { busy: true } }));
    try {
      const r = await api.emailFind({ first_name: o.first_name, last_name: o.last_name, company_name: c.name, domain });
      setFound((m) => ({ ...m, [o.name]: r.found ? { email: r.email, status: r.verification_status } : { none: true } }));
    } catch (e) { setFound((m) => ({ ...m, [o.name]: { error: e.message || "Couldn't look that up." } })); }
  };

  return (
    <div style={{ display: "grid", gap: 14, minWidth: 0 }}>
      <button type="button" style={{ ...btn(false), justifySelf: "start" }} onClick={onBack}><ArrowLeft size={14} /> {backLabel}</button>

      <header style={{ ...card, display: "grid", gap: 12, padding: 16 }}>
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
          </div>
          <div style={{ ...row, justifyContent: "flex-end", flex: "1 1 260px" }}>
            <div style={{ position: "relative" }}>
              <button type="button" aria-expanded={menu} style={btn(true, busy === "journey")} disabled={busy === "journey"} onClick={openMenu}><Route size={14} /> Add to journey</button>
              {menu ? (
                <>
                  <div onClick={() => setMenu(false)} style={{ position: "fixed", inset: 0, zIndex: 79 }} />
                  <div className="ui-menu" role="menu" style={{ zIndex: 80, minWidth: 240, right: 0 }}>
                    {journeys === null ? <div style={{ padding: 10 }}><Spinner size={14} /></div> : journeys.length ? journeys.filter((j) => j.status !== "completed").map((j) => (
                      <button key={j.id} type="button" role="menuitem" className="ui-menu-item" onClick={() => addTo(j)}>{j.name} <span style={small}>· {j.status}</span></button>
                    )) : <div style={{ ...small, padding: 10 }}>No journeys yet. Make one on the Journeys page.</div>}
                    <button type="button" role="menuitem" className="ui-menu-item" onClick={() => { setMenu(false); onGo("outreach"); }}><Plus size={14} /> New journey</button>
                  </div>
                </>
              ) : null}
            </div>
            {c.saved ? <span style={{ ...small, color: C.green, display: "inline-flex", gap: 4, alignItems: "center" }}><Check size={14} /> Saved{c.stage && c.stage !== "new" ? ` · ${c.stage.replace(/_/g, " ")}` : ""}</span>
              : <button type="button" style={btn(false, busy === "save")} disabled={busy === "save"} onClick={save}><Plus size={14} /> Save</button>}
            <button type="button" style={btn(false)} onClick={() => onAskAi?.(`Tell me about ${name}: why contact them now, and who to speak to.`)}><Bot size={14} /> Ask AI</button>
          </div>
        </div>
        <div style={{ ...row, gap: 10 }}>
          {contacts.map((k) => {
            const Icon = ICON[k.kind];
            return (
              <div key={k.kind} style={{ display: "inline-flex", gap: 7, alignItems: "center", padding: "6px 10px", border: `1px solid ${C.borderLight}`, borderRadius: 10, background: "#fff", maxWidth: "100%" }}>
                <Icon size={14} color={C.slate} aria-hidden="true" />
                {k.value ? <a href={k.href} target={k.kind === "website" ? "_blank" : undefined} rel="noreferrer" style={{ color: C.cobalt, fontSize: 13, overflowWrap: "anywhere" }}>{k.shown}</a>
                  : <span style={{ fontSize: 13, color: C.slate }}>{k.kind === "website" ? "Website" : k.kind === "phone" ? "Phone" : "Email"}</span>}
                {k.value || !k.canFind ? <span title={k.label}><Pill tone={SOURCE_TONE[k.source]}>{k.sourceWord}</Pill></span> : null}
                {k.canFind ? <button type="button" style={{ ...btn(false, busy === "phone" || busy === "website"), padding: "3px 9px", minHeight: 28 }} disabled={busy === "phone" || busy === "website"} onClick={() => find(k.kind)}>
                  {busy === k.kind ? <Spinner size={12} /> : <Search size={12} />} Find · 1 credit if found</button> : null}
              </div>
            );
          })}
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
              <>{c.address} <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(c.address)}`} target="_blank" rel="noreferrer" aria-label="Open the address in a map" style={{ color: C.cobalt }}><ExternalLink size={12} /></a></>) : ""}</Fact>
          </Facts>
          <Facts title="In your account">
            {c.saved ? (
              <>
                <Fact label="Stage">{(c.stage || "new").replace(/_/g, " ")}</Fact>
                <Fact label="Lists">{c.lists.join(", ") || "Not in a list"}</Fact>
              </>
            ) : <div style={small}>Not saved yet. Save it to keep notes, lists and a history.</div>}
            {c.journeys.length ? c.journeys.map((j) => (
              <button key={j.id} type="button" style={{ all: "unset", cursor: "pointer", fontSize: 13, color: C.cobalt }} onClick={() => onOpenJourney?.(j.id)}>{j.name} <span style={small}>· {j.person_status === "active" ? `step ${j.step}` : j.person_status}</span></button>
            )) : c.saved ? <div style={small}>Not in any journey.</div> : null}
          </Facts>
        </aside>

        <main style={{ flex: "3 1 440px", minWidth: 0, display: "grid", gap: 12 }}>
          <div role="tablist" aria-label="Company sections" style={{ ...row, gap: 6 }}>
            {TABS.map(([k, w]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} style={btn(tab === k)} onClick={() => setTab(k)}>{w}{k === "people" && peopleCount(c.people) ? <span style={{ opacity: 0.75 }}> {peopleCount(c.people)}</span> : null}</button>
            ))}
          </div>

          {tab === "overview" ? (
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ ...card, display: "grid", gap: 8, padding: 14 }}>
                <strong style={{ fontSize: 14 }}>Why now</strong>
                {signals.length ? signals.map((s) => {
                  const t = TONE[SIGNAL_TONES[s.tone]] || TONE.blue;
                  return <div key={s.key} style={{ background: t.bg, color: t.ink, borderRadius: 8, padding: "8px 11px", fontSize: 13, lineHeight: 1.45 }}><strong>{s.label}.</strong> {s.detail}</div>;
                }) : <div style={small}>Nothing stands out on the register right now.</div>}
              </div>
              <div style={{ ...card, display: "grid", gap: 6, padding: 14 }}>
                <strong style={{ fontSize: 14 }}>In plain words</strong>
                <div style={{ fontSize: 13.5, lineHeight: 1.55 }}>{c.summary}</div>
                {c.description ? <div style={{ fontSize: 13, lineHeight: 1.5, color: C.slate }}>{c.description}</div> : null}
                <div style={small}>Written from what we hold. Nothing here is guessed.</div>
              </div>
              {c.people.officers.length ? (
                <div style={{ ...card, display: "grid", gap: 6, padding: 14 }}>
                  <div style={{ ...row, justifyContent: "space-between" }}><strong style={{ fontSize: 14 }}>Who to speak to</strong><button type="button" style={btn(false)} onClick={() => setTab("people")}>See all</button></div>
                  {c.people.officers.slice(0, 3).map((o) => <div key={o.name} style={{ fontSize: 13.5 }}>{o.first_name} {o.last_name} <span style={{ color: C.slate }}>· {o.role}{o.reason ? ` · ${o.reason}` : ""}</span></div>)}
                </div>
              ) : null}
            </div>
          ) : null}

          {tab === "people" ? <People c={c} onFindEmail={findEmail} found={found} /> : null}

          {tab === "filings" ? (
            <div style={{ display: "grid", gap: 12 }}>
              <Facts title="From the register">
                {filingRows(c).length ? filingRows(c).map((r) => <Fact key={r.label} label={r.label} warn={r.warn}>{r.value}{r.note ? ` (${r.note})` : ""}</Fact>) : <div style={small}>No filing dates are stored for this company.</div>}
              </Facts>
              {c.previous_names.length ? <Facts title="Previous names">{c.previous_names.map((p) => <div key={p.name} style={{ fontSize: 13 }}>{niceName(p.name)}{p.until ? <span style={small}> · until {p.until}</span> : null}</div>)}</Facts> : null}
              <div style={small}>Company figures such as turnover and profit are not shown yet.</div>
            </div>
          ) : null}

          {tab === "activity" ? (
            <div style={{ ...card, padding: 0 }}>
              {activityRows(c.activity).length ? activityRows(c.activity).map((a, i) => (
                <div key={i} style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "10px 14px", borderTop: i ? `1px solid ${C.borderLight}` : "none" }}>
                  <span style={{ ...small, width: 56, flexShrink: 0 }}>{a.when}</span>
                  <span style={{ fontSize: 13.5, minWidth: 0, overflowWrap: "anywhere" }}><strong>{KIND_WORDS[a.kind] || a.kind}</strong> · {a.summary}</span>
                </div>
              )) : <div style={{ ...small, padding: 14 }}>{c.saved ? "Nothing has happened yet. Add it to a journey to start." : "Save it, then every email, call and task shows here."}</div>}
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
}
