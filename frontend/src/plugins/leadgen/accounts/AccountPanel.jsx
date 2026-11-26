import React, { useState, useEffect, useRef } from "react";
import { Trash2, X } from "lucide-react";
import { TpsChip } from "../ListFilterBar";
import { PhoneNumbers } from "../NumbersPanel";
import { numberCounts } from "../phoneNumbers";
import { SearchStatus } from "../SearchStatus";
import { C } from "../../../tokens";
import { CheckDetails, DetailChecks, EndedBanner, LOCK_TIP, VERDICTS, useLocked } from "../CheckCompanies";
import { LeadActivity } from "../LeadActivity";
import { BottomBar, Collapsible, JourneyControl, ProfileTabs, TabPanel, useProfileTab } from "../ProfileLayout";
import { LatestNote, NotesTab, useNotes } from "../Notes";
import { filledSummary } from "../profileState";
import { niceName } from "../companyLogic";
import { FindContactButton, SummaryTab, useCompanyProfile } from "../SummaryParts";
import { Completeness, FoundSummary, SiteLink, TipsCard, muted, text } from "./accountParts";
import { contactFor, emailFor, hasFindings, phoneFor, sourceWords, tipsFor } from "./accountsLogic";

// A past research run, shown collapsed to its date -- expand to see what that run found, so
// re-researching never quietly throws away an earlier result the user might still want.
function HistorySnapshot({ entry }) {
  const [open, setOpen] = useState(false);
  const r = entry.research || {};
  const when = new Date(entry.researched_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  return (
    <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
      <button title="Show or hide what the last lookup found" type="button" onClick={() => setOpen((v) => !v)}
        style={{ ...text, fontSize: 12.5, color: C.slate, background: "none", border: "none", padding: 0, cursor: "pointer", textDecoration: "underline" }}>
        {open ? "Hide" : "Show"} research from {when}
      </button>
      {open ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
          {r.overview ? <div style={{ ...text, fontSize: 13, color: C.textInk, lineHeight: 1.5 }}>{r.overview}</div> : null}
          {r.team?.length ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {r.team.map((p, i) => (
                <div key={i} style={{ ...text, fontSize: 13, color: C.textInk }}>
                  <span style={{ fontWeight: 600 }}>{p.name}</span>{p.title ? <span style={{ color: C.slate }}> · {p.title}</span> : null}
                  {(p.phone || p.email) ? <span style={{ color: C.slate }}> — {[p.phone, p.email].filter(Boolean).join(" · ")}</span> : null}{p.phone ? <TpsChip screening={p.phone_screening} /> : null}
                </div>
              ))}
            </div>
          ) : null}
          {r.phones?.length ? <div style={{ ...text, fontSize: 13, color: C.textInk }}>Phones: {r.phones.join(", ")}</div> : null}
          {(r.email_contacts?.length ? r.email_contacts.map((c) => c.email) : r.emails || []).length ? (
            <div style={{ ...text, fontSize: 13, color: C.textInk }}>Emails: {(r.email_contacts?.length ? r.email_contacts.map((c) => c.email) : r.emails).join(", ")}</div>
          ) : null}
          {!r.overview && !r.team?.length && !r.phones?.length && !r.emails?.length && !r.email_contacts?.length ? (
            <div style={{ ...muted }}>Nothing public was found in this run.</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- Account Dossiers
function Dossier({ account, store }) {
  const r = account.research;
  const reg = account.registry;
  if (!account.researched_at) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span style={{ ...muted, flex: "1 1 220px" }}>Nothing researched yet. Use Find contact above and what is found appears here: people, phones, emails and sources.</span>
      </div>
    );
  }
  if (!hasFindings(account) && !reg) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span style={{ ...muted, flex: "1 1 220px" }}>The last research found nothing public about this company.</span>
      </div>
    );
  }
  const label = { ...text, fontSize: 12, fontWeight: 500, color: C.slate, marginBottom: 4 };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {reg ? (
        <div>
          <div style={label}>
            Company registry{reg.confidence_tier === "verified_registry" ? " · verified" : ""}
          </div>
          <div style={{ ...text, fontSize: 13.5, color: C.textInk, display: "flex", gap: 14, flexWrap: "wrap" }}>
            {reg.registration_number ? <span><span style={{ color: C.slate }}>Reg #</span> {reg.registration_number}</span> : null}
            {reg.status ? <span><span style={{ color: C.slate }}>Status</span> {reg.status}</span> : null}
            {reg.company_category ? <span><span style={{ color: C.slate }}>Type</span> {reg.company_category}</span> : null}
            {reg.incorporation_date ? <span><span style={{ color: C.slate }}>Incorporated</span> {reg.incorporation_date}</span> : null}
          </div>
          {reg.officers?.length ? (
            <div style={{ marginTop: 8 }}>
              <div style={{ ...text, fontSize: 12, color: C.slate, marginBottom: 2 }}>Officers</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {reg.officers.map((o, i) => (
                  <div key={i} style={{ ...text, fontSize: 13.5, color: C.textInk }}>
                    {o.name}{o.role ? <span style={{ color: C.slate }}> · {o.role}</span> : null}
                    {o.resigned_on ? <span style={{ color: C.slate }}> (resigned {o.resigned_on})</span> : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {reg.significant_control?.length ? (
            <div style={{ marginTop: 8 }}>
              <div style={{ ...text, fontSize: 12, color: C.slate, marginBottom: 2 }}>Significant control</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {reg.significant_control.map((p, i) => (
                  <div key={i} style={{ ...text, fontSize: 13.5, color: C.textInk }}>
                    {p.name}{p.kind ? <span style={{ color: C.slate }}> · {p.kind}</span> : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      {r?.overview ? <div><div style={label}>Overview</div><div style={{ ...text, fontSize: 13.5, color: C.textInk, lineHeight: 1.55 }}>{r.overview}</div></div> : null}
      {r?.team?.length ? (
        <div>
          <div style={label}>People, with their own details</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {r.team.map((p, i) => (
              <div key={i} style={{ ...text, fontSize: 13.5, color: C.textInk }}>
                <span style={{ fontWeight: 600 }}>{p.name}</span>
                {p.title ? <span style={{ color: C.slate }}> · {p.title}</span> : null}
                {(p.phone || p.email) ? (
                  <span style={{ color: C.slate, fontVariantNumeric: "tabular-nums" }}>
                    {" "}— {[p.phone, p.email].filter(Boolean).join(" · ")}
                    {p.phone ? <TpsChip screening={p.phone_screening} /> : null}
                  </span>
                ) : (
                  <span style={{ color: C.slateLight }}> — No direct number or email found</span>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {r?.people?.length ? (
        <div>
          <div style={label}>People found</div>
          {r.people.map((p, i) => (
            <div key={i} style={{ ...text, fontSize: 13.5, color: C.textInk }}>
              {p.name}{p.role ? <span style={{ color: C.slate }}> · {p.role}</span> : null}
            </div>
          ))}
        </div>
      ) : null}
      {r?.phones?.length ? (
        <div>
          <div style={label}>Phone numbers found</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {r.phones.map((v, i) => <span key={v} style={{ ...text, fontSize: 13.5, color: C.textInk, fontVariantNumeric: "tabular-nums" }}>{v}<TpsChip screening={(r.phones_screening || [])[i]} /></span>)}
          </div>
        </div>
      ) : null}
      {r?.email_contacts?.some((c) => c.name) ? (
        <div>
          <div style={label}>Named contacts found</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {r.email_contacts.filter((c) => c.name).map((c) => (
              <div key={c.email} style={{ ...text, fontSize: 13.5, color: C.textInk }}>
                {c.name}<span style={{ color: C.slate }}> · {c.email}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {(r?.email_contacts?.length ? r.email_contacts.filter((c) => !c.name).map((c) => c.email) : r?.emails || []).length ? (
        <div>
          <div style={label}>General email found</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {(r.email_contacts?.length ? r.email_contacts.filter((c) => !c.name).map((c) => c.email) : r.emails).map((v) => (
              <span key={v} style={{ ...text, fontSize: 13.5, color: C.textInk }}>{v}</span>
            ))}
          </div>
        </div>
      ) : null}
      {r?.other_offices?.length ? (
        <div>
          <div style={label}>Other offices</div>
          <div style={{ ...text, fontSize: 13.5, color: C.textInk, display: "flex", flexDirection: "column", gap: 2, fontVariantNumeric: "tabular-nums" }}>
            {r.other_offices.map((o) => <span key={o.phone || o.email}><span style={{ color: C.slate }}>{o.town}:</span> {o.phone || o.email}{o.phone ? <TpsChip screening={o.phone_screening} /> : null}</span>)}
          </div>
        </div>
      ) : null}
      {r?.sources?.length ? (
        <div>
          <div style={label}>Sources</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {r.sources.slice(0, 5).map((s, i) => {
              const url = typeof s === "string" ? s : s.url;
              if (!url) return null;
              return <a key={i} href={url} target="_blank" rel="noreferrer" style={{ ...text, fontSize: 12.5, color: C.slate, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{(typeof s === "object" && s.title) || url}</a>;
            })}
          </div>
        </div>
      ) : null}
      <div style={{ ...muted, fontSize: 12 }}>Researched {new Date(account.researched_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</div>
      {account.research_history?.length ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={label}>Previous research ({account.research_history.length})</div>
          {account.research_history.map((entry, i) => <HistorySnapshot key={entry.researched_at || i} entry={entry} />)}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- the account panel
// One canonical field list for both the create form (AddAccountForm) and the edit form here, so
// the two can never drift out of sync with each other (they used to be two hand-typed arrays).
const ACCOUNT_FIELDS = [
  ["name", "Company name"], ["website", "Website"], ["phone", "Phone"], ["email", "Email"],
  ["contact_name", "Contact"], ["contact_title", "Contact's job title"], ["industry", "Industry"], ["region", "Town or region"],
];

function AccountFieldGrid({ fields, form, setForm, minWidth = 190, autoFocusFirst = false }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${minWidth}px), 1fr))`, gap: 10 }}>
      {fields.map(([k, label], i) => (
        <label key={k} style={{ display: "flex", flexDirection: "column", gap: 4, ...text, fontSize: 12.5, color: C.slate }}>
          {label}{k === "name" ? " (required)" : ""}
          <input className="ui-input" value={form[k] || ""} autoFocus={autoFocusFirst && i === 0} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))} />
        </label>
      ))}
    </div>
  );
}

const PANEL_TABS = [
  { id: "summary", label: "Summary", tip: "The fit, who to contact, the best email and phone, and the next step" },
  { id: "overview", label: "Overview", tip: "Contact details, whether they passed our checks, and the columns from your file" },
  { id: "research", label: "Research", tip: "Find a missing phone, email or contact, and read what we found about the company" },
  { id: "details", label: "Details", tip: "Change the saved name, phone, email and contact, or remove the company" },
  { id: "notes", label: "Notes", tip: "Notes your team wrote on this company. Everyone in your organisation sees them" },
  { id: "activity", label: "Activity", tip: "Call, email or book a meeting, set the stage, and see everything that has happened" },
];

export function AccountPanel({ account, store, onClose, onOpenPage, onOpenRegister, page = false }) {
  const live = store.accounts.find((a) => a.id === account.id) || account;
  const lockedIds = useLocked();
  const inCheck = lockedIds.has(live.id);
  // The old single notes field is no longer edited here: notes are a list now (Notes tab), and the old text shows there as "Earlier note".
  const [form, setForm] = useState(() => Object.fromEntries(ACCOUNT_FIELDS.map(([k]) => [k, live[k] || ""])));
  const [confirmRemove, setConfirmRemove] = useState(false);
  const changed = ACCOUNT_FIELDS.some(([k]) => (form[k] || "") !== (live[k] || ""));
  const [tab, setTab] = useProfileTab("account.v2", PANEL_TABS.map((t) => t.id), "summary");
  const summary = useCompanyProfile(live.business_record_id || "", tab === "summary");
  const notesApi = useNotes({ companyId: live.business_record_id || "", accountId: live.id });
  const tabBase = `acct-${live.id}`;
  const custom = Object.entries(live.custom || {});
  const openNotes = () => setTab("notes");
  useEffect(() => {
    if (page) return undefined;
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, page]);
  // Research can fill empty fields: show what it found in any field not being edited.
  const lastResearch = useRef(live.researched_at);
  useEffect(() => {
    if (live.researched_at === lastResearch.current) return;
    lastResearch.current = live.researched_at;
    setForm((f) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v || live[k] || ""])));
  }, [live]);

  return (
    <div onClick={page ? undefined : onClose} style={page ? { display: "flex", justifyContent: "center" } : { position: "fixed", inset: 0, background: "rgba(15,18,28,0.45)", zIndex: 1000, display: "flex", justifyContent: "flex-end" }}>
      <div role={page ? undefined : "dialog"} aria-label={niceName(live.name)} onClick={(e) => e.stopPropagation()} className="ui-scroll"
        style={page ? { width: "min(100%, 980px)", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, display: "flex", flexDirection: "column" }
          : { width: "min(100%, 520px)", height: "100%", background: C.surface, overflowY: "auto", display: "flex", flexDirection: "column" }}>
        <div style={{ position: "sticky", top: 0, background: C.surface, zIndex: 4, borderRadius: page ? "14px 14px 0 0" : 0 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "16px 16px 10px 20px", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 220px", minWidth: 0 }}>
            <div style={{ ...text, fontSize: 16, fontWeight: 600, color: C.ink, overflowWrap: "anywhere" }}>{niceName(live.name)}</div>
            <LatestNote note={notesApi.notes[0]} onOpen={openNotes} style={{ marginTop: 2, maxWidth: "100%" }} />
            <div style={{ ...muted, fontSize: 12.5, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <SiteLink account={live} /><span title="How this company got into your account">{sourceWords(live.source)}</span>
            </div>
            {live.completeness ? (
              <div style={{ ...muted, fontSize: 12.5, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 4 }}>
                <span>Record</span><Completeness c={live.completeness} wide />
                {live.completeness.missing?.length ? <span>Missing: {live.completeness.missing.join(", ")}</span> : null}
              </div>
            ) : null}
          </div>
          {!page && onOpenPage ? <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" title="Everything about this company on one page: what you gave us, what we found, checks, research, journeys and activity" onClick={() => onOpenPage(live.id)}>Open full profile</button> : null}
          {page && live.business_record_id && onOpenRegister ? <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" title="The register page for this company" onClick={() => onOpenRegister(live.business_record_id)}>Register page</button> : null}
          {page ? <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" title="Go back to the list" onClick={onClose}>Back</button> : <button type="button" className="ui-icon-btn" aria-label="Close the company panel" title="Close the company panel" onClick={onClose}><X size={18} /></button>}
        </div>
        <ProfileTabs idBase={tabBase} label={`${live.name} sections`} value={tab} onChange={setTab} style={{ padding: "0 12px" }}
          tabs={PANEL_TABS.map((t) => (t.id === "notes" ? { ...t, count: notesApi.notes.length || 0 } : t))} />
        </div>
        <div style={{ padding: "4px 20px 20px", display: "flex", flexDirection: "column", gap: 0, flex: 1 }}>
          <TabPanel idBase={tabBase} id="summary" value={tab}>
            <SummaryTab profile={summary.profile} account={live} loading={summary.loading} error={summary.error} onGoTab={setTab} companyId={live.business_record_id || ""} onPicked={summary.reload} />
          </TabPanel>
          <TabPanel idBase={tabBase} id="overview" value={tab}>
            <EndedBanner account={live} />
            {["problem", "not_found"].includes(live.verification?.verdict) ? <div style={{ paddingTop: 12 }}><CheckDetails account={live} /></div> : null}
            <Collapsible id="account:contact" defaultOpen title="Contact details"
              summary={filledSummary([live.website, phoneFor(live)?.text, emailFor(live)?.text, contactFor(live)?.text, live.industry, live.region, live.address])}>
              <FoundSummary account={live} store={store} />
            </Collapsible>
            <Collapsible id="account:checks" title="Checks" summary={live.verification?.verdict ? (VERDICTS[live.verification.verdict]?.label || "Checked") : "Not checked yet"}>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <DetailChecks account={live} />
                {["problem", "not_found"].includes(live.verification?.verdict) ? null : <CheckDetails account={live} />}
              </div>
            </Collapsible>
            {custom.length ? (
              <Collapsible id="account:file" title="From your file" summary={`${custom.length} ${custom.length === 1 ? "column" : "columns"}`}>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 2fr)", gap: "4px 12px", ...text, fontSize: 13 }}>
                  {custom.map(([k, v]) => (
                    <React.Fragment key={k}>
                      <span style={{ color: C.slate, overflowWrap: "anywhere" }}>{k}</span>
                      <span style={{ color: C.textInk, overflowWrap: "anywhere" }}>{v || "—"}</span>
                    </React.Fragment>
                  ))}
                </div>
              </Collapsible>
            ) : null}
          </TabPanel>
          <TabPanel idBase={tabBase} id="research" value={tab}>
            <Collapsible id="account:improve" defaultOpen title="Find contact" summary={store.researching[live.id] ? "Running now" : tipsFor(live).length ? `${tipsFor(live).length} ${tipsFor(live).length === 1 ? "tip" : "tips"}` : ""}>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <FindContactButton store={store} account={live} />
                <TipsCard account={live} />
                {store.researching[live.id] && store.researching[live.id] !== "improve" ? (
                  <SearchStatus title={store.researching[live.id] === "deep" ? `Deep web search on ${live.name}` : store.researching[live.id] === "quick" ? `Checking our records for ${live.name}` : `Looking up ${live.name}`}
                    detail={store.researching[live.id] === "quick" ? "Looking only at our own records. This is free." : "Reading public pages for its people, phone numbers and sources. A credit is used only if something is found."}
                    cancelLabel="Stop waiting" onCancel={() => store.stopWaiting(live.id)} />
                ) : null}
              </div>
            </Collapsible>
            <Collapsible id="account:numbers" defaultOpen title="Phone numbers" summary={(() => { const c = numberCounts([live]); return c.total ? `${c.checked} of ${c.total} checked for TPS and CTPS` : ""; })()}>
              <PhoneNumbers account={live} onChecked={() => store.reload()} />
            </Collapsible>
            <Collapsible id="account:dossier" title="Research"
              summary={live.researched_at ? `Researched ${new Date(live.researched_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}` : "Not researched yet"}>
              <Dossier account={live} store={store} />
            </Collapsible>
          </TabPanel>
          <TabPanel idBase={tabBase} id="details" value={tab}>
            <Collapsible id="account:details" defaultOpen title="Details" summary={changed ? "Changes not saved" : filledSummary(ACCOUNT_FIELDS.map(([k]) => live[k]))}>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <AccountFieldGrid fields={ACCOUNT_FIELDS} form={form} setForm={setForm} minWidth={200} />
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <button type="button" className="ui-btn ui-btn--ghost" disabled={!changed} title="Put every field back to what is saved"
                    onClick={() => setForm(Object.fromEntries(ACCOUNT_FIELDS.map(([k]) => [k, live[k] || ""])))}>Reset</button>
                  <span style={{ flex: 1 }} />
                  {confirmRemove ? (
                    <>
                      <span style={{ ...muted, fontSize: 12.5 }}>Remove {live.name}?</span>
                      <button title="Remove this company from all your lists for good" type="button" className="ui-btn ui-btn--danger" onClick={async () => { if (await store.remove(live.id)) onClose(); }}>Remove</button>
                      <button title="Don't remove it" type="button" className="ui-btn ui-btn--ghost" onClick={() => setConfirmRemove(false)}>Keep</button>
                    </>
                  ) : (
                    <button title={inCheck ? LOCK_TIP : "Remove this company from your account. You will be asked to confirm"} type="button" className="ui-btn ui-btn--ghost" disabled={inCheck} onClick={() => setConfirmRemove(true)}><Trash2 size={15} /> Remove</button>
                  )}
                </div>
              </div>
            </Collapsible>
          </TabPanel>
          <TabPanel idBase={tabBase} id="notes" value={tab} style={{ paddingTop: 12 }}>
            <NotesTab notesApi={notesApi} />
          </TabPanel>
          <TabPanel idBase={tabBase} id="activity" value={tab}>
            <Collapsible id="account:activity" defaultOpen title="Activity" summary={live.connection?.stage ? `Stage: ${String(live.connection.stage).replace(/_/g, " ")}` : ""}>
              <LeadActivity account={live} store={store} onGoTab={setTab} find={{ text: "Use Find contact on the Research tab.", tab: "research" }} />
            </Collapsible>
          </TabPanel>
        </div>
        <BottomBar note={notesApi.notes[0]} onOpenNotes={openNotes}
          journey={<JourneyControl companyId={live.business_record_id || ""} accountId={live.id} companyName={live.name} />}
          actions={(
            <button title={changed ? "Save the changes to this company" : "Nothing to save. Change a field on the Details tab first"} type="button" className="ui-btn ui-btn--primary ui-btn--sm" disabled={!changed || !form.name.trim()}
              onClick={async () => { if (await store.update(live.id, form)) onClose(); }}>Save changes</button>
          )} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- add by hand
const BLANK_ACCOUNT = { name: "", website: "", phone: "", email: "", contact_name: "", contact_title: "" };
export function AddAccountForm({ store, onClose }) {
  const [form, setForm] = useState(BLANK_ACCOUNT);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim() || busy) return;
    setBusy(true);
    const r = await store.save([{ ...form, source: "manual" }]);
    setBusy(false);
    if (r) onClose();
  };
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,18,28,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <form role="dialog" aria-label="Add an account" onClick={(e) => e.stopPropagation()} onSubmit={submit} className="ui-card"
        style={{ width: "min(100%, 480px)", padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <div style={{ ...text, fontSize: 16, fontWeight: 600, color: C.ink, marginRight: "auto" }}>Add an account</div>
          <button type="button" className="ui-icon-btn" aria-label="Close" onClick={onClose}><X size={18} /></button>
        </div>
        <AccountFieldGrid fields={ACCOUNT_FIELDS.slice(0, 6)} form={form} setForm={setForm} autoFocusFirst />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
          <button type="button" className="ui-btn ui-btn--ghost" onClick={() => setForm(BLANK_ACCOUNT)} title="Clear every field">Reset</button>
          <button title="Close without saving" type="button" className="ui-btn ui-btn--ghost" onClick={onClose}>Cancel</button>
          <button title="Save this company" type="submit" className="ui-btn ui-btn--primary" disabled={!form.name.trim() || busy}>{busy ? "Saving…" : "Add account"}</button>
        </div>
      </form>
    </div>
  );
}
