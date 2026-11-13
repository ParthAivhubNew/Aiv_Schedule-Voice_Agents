import React from "react";
import { C, FONT_BODY } from "../../tokens";
import { CompanyAvatar, Drawer, Fact, ProfileBadge, SIZE_LABEL, plainSector } from "./FindLeadsParts";
import { BottomBar, Collapsible, JourneyControl, ProfileTabs, TabPanel, useProfileTab } from "./ProfileLayout";
import { LatestNote, NotesTab, useNotes } from "./Notes";
import { LeadActivity } from "./LeadActivity";
import { filledSummary } from "./profileState";
import { legalTag, niceName } from "./companyLogic";
import { FindContactButton, SummaryTab, useCompanyProfile } from "./SummaryParts";

// The Find Leads profile drawer: the same tabs, folding sections and bottom bar as the saved company panel.

const muted = { fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate, lineHeight: 1.5 };

const TABS = [
  { id: "summary", label: "Summary", tip: "The fit, who to contact, the best email and phone, and the next step" },
  { id: "overview", label: "Overview", tip: "Contact details, with buttons to find a missing phone, email or website" },
  { id: "research", label: "Research", tip: "Where to research this company and keep what is found" },
  { id: "details", label: "Details", tip: "The register's facts: number, status, type, size and address" },
  { id: "notes", label: "Notes", tip: "Notes your team wrote on this company. Everyone in your organisation sees them" },
  { id: "activity", label: "Activity", tip: "Call, email or book a meeting, set the stage, and see everything that has happened" },
];

// openCo: the result row. saved: the saved company linked to it, if any. contacts: the contact details panel for it.
export function CompanyDrawer({ openCo, saved, store, onClose, actions, saveAction, contacts, onOpenPage }) {
  const [tab, setTab] = useProfileTab("drawer.v2", TABS.map((t) => t.id), "summary");
  const summary = useCompanyProfile(openCo?.id || "", tab === "summary");
  const notesApi = useNotes({ companyId: openCo?.id || "", accountId: saved?.id || "" });
  const base = `drawer-${openCo?.id || "none"}`;
  const size = openCo && openCo.size_band && openCo.size_band !== "unknown" ? SIZE_LABEL[openCo.size_band] || openCo.size_band : "";
  const facts = openCo ? [openCo.registration_number, openCo.status, legalTag(openCo.company_category, openCo.registration_number), openCo.incorporation_date, size, openCo.address] : [];
  const sub = openCo ? [plainSector(openCo.industry), openCo.region].filter(Boolean).join(" · ") : "";
  return (
    <Drawer open={Boolean(openCo)} onClose={onClose} avatar={openCo ? <CompanyAvatar c={openCo} size={40} /> : null} title={niceName(openCo?.name || "")}
      sub={openCo ? <>{sub ? <div>{sub}</div> : null}<LatestNote note={notesApi.notes[0]} onOpen={() => setTab("notes")} style={{ marginTop: 3, maxWidth: "100%" }} /></> : ""}
      actions={actions}
      footer={openCo ? <BottomBar note={notesApi.notes[0]} onOpenNotes={() => setTab("notes")} journey={<JourneyControl companyId={openCo.id} accountId={saved?.id || ""} companyName={openCo.name} />} actions={saveAction} /> : null}>
      {openCo ? (
        <>
          <ProfileTabs idBase={base} label={`${openCo.name} sections`} value={tab} onChange={setTab} style={{ margin: "0 -16px", padding: "0 8px" }}
            tabs={TABS.map((t) => (t.id === "notes" ? { ...t, count: notesApi.notes.length || 0 } : t))} />
          <TabPanel idBase={base} id="summary" value={tab}>
            <SummaryTab profile={summary.profile} account={saved || null} loading={summary.loading} error={summary.error} onGoTab={setTab} companyId={openCo.id} onPicked={summary.reload} />
          </TabPanel>
          <TabPanel idBase={base} id="overview" value={tab}>
            <Collapsible id="drawer:contacts" defaultOpen title="Contact details" summary={filledSummary([openCo.website || openCo.web_website, openCo.phone || openCo.web_phone, openCo.email || openCo.web_email])}>
              {contacts}
            </Collapsible>
            <Collapsible id="drawer:profile" title="How complete" summary={openCo.profile ? "" : "Basic record"}>
              <ProfileBadge profile={openCo.profile} />
            </Collapsible>
          </TabPanel>
          <TabPanel idBase={base} id="research" value={tab}>
            <Collapsible id="drawer:research" defaultOpen title="Research" summary={saved?.researched_at ? "Researched" : "Not researched yet"}>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}>
                <div style={muted}>{saved ? "The research on this company, and the tools to improve it, are on its full page." : "Save this company to research it and keep what is found."}</div>
                {saved ? <FindContactButton store={store} account={saved} /> : null}
                {onOpenPage ? <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" title="The full page: why now, people, research and contact details" onClick={onOpenPage}>Open page</button> : null}
              </div>
            </Collapsible>
          </TabPanel>
          <TabPanel idBase={base} id="details" value={tab}>
            <Collapsible id="drawer:details" defaultOpen title="Register details" summary={filledSummary(facts)}>
              <Fact label="Registered no.">{openCo.registration_number}</Fact>
              <Fact label="Status">{openCo.status}</Fact>
              <Fact label="Type">{legalTag(openCo.company_category, openCo.registration_number)}</Fact>
              <Fact label="Incorporated">{openCo.incorporation_date}</Fact>
              <Fact label="Size (accounts)">{size}</Fact>
              <Fact label="Address">{openCo.address}</Fact>
            </Collapsible>
          </TabPanel>
          <TabPanel idBase={base} id="notes" value={tab} style={{ paddingTop: 12 }}>
            <NotesTab notesApi={notesApi} />
          </TabPanel>
          <TabPanel idBase={base} id="activity" value={tab}>
            <Collapsible id="drawer:activity" defaultOpen title="Activity" summary={saved ? "" : "Not saved yet"}>
              {saved ? <LeadActivity account={saved} store={store} onGoTab={setTab} find={{ text: "Find one on the Overview tab.", tab: "overview" }} />
                : <div style={muted}>Save this company first. Then you can call, email and book meetings from here, and everything that happens shows on its timeline.</div>}
            </Collapsible>
          </TabPanel>
        </>
      ) : null}
    </Drawer>
  );
}
