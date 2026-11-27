import React from "react";
import { Spinner, TopBar } from "../../../app/Loader";
import { List, Map as MapIcon, Plus, ShieldCheck, Star, Users, X } from "lucide-react";
import { C } from "../../../tokens";
import { CheckDialog, CheckProgress } from "../CheckCompanies";
import { nameAsKeywordTown } from "../companyLogic";
import { LeadsMap } from "../LeadsMap";
import { PAGE_SIZES, amountChoices, typedAmount } from "../drawShape";
import { SearchStatus } from "../SearchStatus";
import { askList } from "../Dialogs";
import { CallButton } from "../CallFlow";
import { CompaniesTable, CountTiles, Pager, PeopleTable, MoreMenu, SelectionBar, ViewMenu } from "../FindLeadsParts";
import { IcpPrompt } from "../FitParts";
import { sortOptions } from "../fitLogic";
import { SelectAllNotice } from "../../../components/SelectAllNotice";
import { notice } from "../../../utils/notice";
import { EMPTY_FORM, FAVOURITES, appliedWords, draftTitle, formToFilters } from "./findLogic";
import { muted, text } from "./findParts";

// Find Leads' results card: the draft strip, the companies and people tables, the map and the pager. Moved out of FindLeadsSearch unchanged. What it uses comes in five groups (results, searching, mapArea, selection, contacts), unpacked
// here under the same names, so the body reads as it did inside the screen.
export function ResultsCard({
  results: { companies, total, capped, searched, tab, sort, icp, icpSet, page, pageSize, pageRef, ranked, tiers, savedTotal, people, peopleTotal, peopleOf, understood, setUnderstood, broadenedNote, asked, draft, setDraft, busy, form, setForm, custom, setCustom, isSaved, statusOf, dropTerm, missingDetail },
  searching: { search, searchPeople, goPage, changePageSize, changeSort, pickSaved, fillIds, fillPeople, fillRun, filling, setFilling, paused, pausedRef, setPaused },
  mapArea: { area, areaNote, areaPending, areaStep, setAreaStep, clearArea, countArea, countHold, drawArea, inArea, pickAmount, pinCount, points, stopArea, mapRef, mapActions, removeCompany, view, setView },
  selection: { sel, selecting, pickedRows, selectAllMatching, selectReach, selectedWord, bulkSave },
  contacts: { reveal, revealMany, revealRow, findSite, lookups, getContacts, contactCheck, checking, setChecking, preparing, call, callAll, saveOne, openCo, setOpenCo },
  onSetIcp,
  controls,
  more,
}) {
  return (
    <div className="ui-card fl-card" data-map={view === "map" ? "true" : undefined} style={{ overflow: "hidden", position: "relative" }}>
      <TopBar show={busy} />
      {draft && !area && tab === "companies" && searched ? (
        <div role="status" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "9px 14px", borderBottom: `1px solid ${C.border}`, background: C.cobaltSoft }}>
          <span style={{ ...text, fontSize: 13, fontWeight: 600, color: C.ink }}>{draftTitle(draft)}</span>
          <span style={{ ...muted, fontSize: 12.5 }}>
            {draft.asked && draft.asked < total ? `The ${draft.asked.toLocaleString()} you asked for, best matches first. ${total.toLocaleString()}${capped ? "+" : ""} match in all.` : `${total.toLocaleString()}${capped ? "+" : ""} match.`}
          </span>
          <span style={{ marginLeft: "auto", display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
            <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" disabled={!companies.length || busy} onClick={() => sel.selectAll(companies.map((c) => c.id))}>Select all {companies.length.toLocaleString()}</button>
            {draft.asked && draft.asked < total ? (
              <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" disabled={busy} onClick={() => { pageRef.current = pageSize; setDraft({ asked: 0 }); search(null, form, 0, null, undefined, undefined, true); }}>Show all matches</button>
            ) : null}
            <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => { pageRef.current = pageSize; setDraft(null); }}>Done</button>
          </span>
        </div>
      ) : null}
      {/* Plan 13, step 6: two calm rows instead of one that wraps. First what you're looking at and how (Companies / People,
          List / Map) with the view tools on the right; then the count, as tabs. */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderBottom: `1px solid ${C.borderLight}`, flexWrap: "wrap" }}>
        {controls}
        {tab === "companies" && !icp.loading && !icp.isSet && onSetIcp ? <IcpPrompt onSet={onSetIcp} compact /> : null}
        <span style={{ flex: 1 }} />
        {sort === "best" && !ranked && !area ? <span style={{ ...muted, fontSize: 12 }} title="Best match puts the companies with the most details first. It needs the register to be ranked once on the server (scripts/rank_business_records.py). Until then the newest companies come first. The Details we hold filter still works.">Newest first · ranking not run yet</span> : null}
        <span id="fl-grid-tools" style={{ display: "contents" }} />
        {!area ? (
          <ViewMenu busy={busy} sortValue={sort} sortOptions={sortOptions(icp.isSet)}
            sortLabel={(sortOptions(icp.isSet).find(([v]) => v === sort) || sortOptions(icp.isSet)[0])[1]}
            onSort={changeSort} pageSize={pageSize} pageSizes={PAGE_SIZES} onPageSize={changePageSize} />
        ) : null}
        <MoreMenu items={more} label="More: import, start again" />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: tab === "companies" && searched && !area ? "0 14px" : "10px 14px", minHeight: 44, borderBottom: `1px solid ${C.border}` }}>
        <div style={{ ...text, fontSize: 13.5, fontWeight: 600, color: C.ink }}>
          {areaPending ? (areaStep.phase === "counting" ? "Looking at your area…" : "Your area is ready") : tab === "people" ? (
            <>{people.length.toLocaleString()} {people.length === 1 ? "person" : "people"} <span style={{ fontWeight: 400, color: C.slate }}>· at {peopleTotal.toLocaleString()}{capped ? "+" : ""} {peopleTotal === 1 ? "company" : "companies"}</span></>
          ) : searched && !area ? (
            <CountTiles total={total} capped={capped} saved={savedTotal} filter={form.saved} onPick={(v) => pickSaved(form.saved === v ? "" : v)} busy={busy} />
          ) : null}
        </div>
      </div>
      {broadenedNote && !busy ? (
        <div role="status" style={{ ...muted, fontSize: 12.5, padding: "8px 16px", borderBottom: `1px solid ${C.borderLight}` }}>{broadenedNote}.</div>
      ) : null}
      {understood.length ? (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", padding: "8px 16px", borderBottom: `1px solid ${C.borderLight}` }}>
          <span style={{ ...muted, fontSize: 12.5 }}>Also looking for:</span>
          {[...new Set(understood.flatMap((u) => u.terms))].map((t) => (
            <span key={t} className="ui-chip" style={{ cursor: "default", display: "inline-flex", alignItems: "center", gap: 4 }}>
              {t}
              <button type="button" aria-label={`Stop looking for ${t}`} disabled={busy} onClick={() => dropTerm(t)}
                style={{ all: "unset", cursor: "pointer", display: "inline-flex", color: C.slate }}><X size={12} /></button>
            </span>
          ))}
        </div>
      ) : null}
      {view === "map" ? (
        <div ref={mapRef} style={{ padding: 12, scrollMarginTop: 8 }}>
          <LeadsMap onClose={() => setView("list")} companies={companies} points={points} area={area} busy={busy} onArea={drawArea} onClear={clearArea} hint={form.sector} statusOf={statusOf} actions={mapActions} />
          {area && areaNote ? <div role="status" style={{ ...muted, marginTop: 8 }}>{areaNote}</div> : null}
          {area && companies.some((c) => c.phone) ? (
            <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <CallButton label={`Call the ${companies.filter((c) => c.phone).length} with a phone number in this area`} lockedLabel="Call these · add Voice" variant="secondary"
                title="Saves them to your Unsorted list, then shows who can be called"
                onClick={() => callAll(companies)} onLocked={() => call.open({ kind: "selected", ids: [], name: "the companies in your area" }, true)} />
            </div>
          ) : null}
          {areaStep && area ? (
            <div className="ui-card" role="status" style={{ marginTop: 10, padding: "10px 14px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              {areaStep.phase === "counting" ? (
                <div style={{ width: "100%" }}>
                  <SearchStatus title="Counting the companies inside your area"
                    detail={`${[appliedWords(form), "inside the shape you drew"].filter(Boolean).join(" · ")}. This takes a few seconds and costs nothing.`}
                    paused={countHold.paused} holding onPause={countHold.pause} onResume={countHold.resume} onCancel={clearArea} />
                </div>
              ) : null}
              {areaStep.phase === "choose" ? (
                areaStep.candidates ? (
                  <>
                    <span style={{ ...text, fontSize: 13, color: C.textInk, marginRight: "auto" }}>
                      Up to <strong>{areaStep.candidates.toLocaleString()}{areaStep.capped ? "+" : ""}</strong> companies are in this area. How many do you want to see?
                    </span>
                    {amountChoices(areaStep.candidates).map((o) => (
                      <button key={String(o.value)} type="button" className="ui-btn ui-btn--secondary ui-btn--sm" title="Read this many companies from the area" onClick={() => pickAmount(o.value)}>{o.label}</button>
                    ))}
                    <form onSubmit={(e) => { e.preventDefault(); const n = typedAmount(custom, areaStep.candidates); if (n) pickAmount(n); }}
                      style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                      <input className="ui-input" inputMode="numeric" aria-label="Type how many to see" placeholder="Or type a number" value={custom}
                        onChange={(e) => setCustom(e.target.value)} style={{ width: 130, height: 30 }} />
                      <button type="submit" className="ui-btn ui-btn--primary ui-btn--sm" disabled={!typedAmount(custom, areaStep.candidates)} title="Show this many companies from the area">Show</button>
                      <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" disabled={!custom} onClick={() => setCustom("")} title="Clear the number">Reset</button>
                    </form>
                  </>
                ) : areaStep.inArea ? (
                  <>
                    <span style={{ ...muted, marginRight: "auto" }}>{areaStep.inArea.toLocaleString()} {areaStep.inArea === 1 ? "company is" : "companies are"} in this area, but none match your filters.</span>
                    <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" onClick={() => { const next = { ...EMPTY_FORM }; setForm(next); countArea(area, next, []); }}>Show every company in this area</button>
                  </>
                ) : Object.keys(formToFilters(form)).length ? (
                  <>
                    <span style={{ ...muted, marginRight: "auto" }}>No company in this area matches your filters.</span>
                    <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" onClick={() => { const next = { ...EMPTY_FORM }; setForm(next); setUnderstood([]); countArea(area, next, []); }}>Show every company in this area</button>
                  </>
                ) : <span style={muted}>Nothing found inside this area. Our data covers the UK, so draw over a UK town or a few postcodes, or use "Redraw area" for a bigger area.</span>
              ) : null}
              {areaStep.phase === "running" ? (
                <div style={{ width: "100%" }}>
                  <SearchStatus title={`Reading the area: ${(areaStep.found || 0).toLocaleString()} of ${(areaStep.target || 0).toLocaleString()} found`}
                    detail={`Checked ${(areaStep.scanned || 0).toLocaleString()} of up to ${(areaStep.candidates || 0).toLocaleString()} companies in the shape. Pins appear as they are found.`}
                    found={areaStep.found} total={areaStep.target} paused={paused}
                    onPause={() => { pausedRef.current = true; setPaused(true); }} onResume={() => { pausedRef.current = false; setPaused(false); }}
                    onCancel={() => { stopArea.current = true; pausedRef.current = false; setPaused(false); }} cancelLabel="Stop and keep what's found" />
                </div>
              ) : null}
              {areaStep.phase === "done" ? (
                <>
                  <span style={{ ...text, fontSize: 13, color: C.textInk, marginRight: "auto" }}>
                    {areaStep.shown
                      ? `Showing ${areaStep.shown.toLocaleString()}${areaStep.candidates ? ` of up to ${areaStep.candidates.toLocaleString()}` : ""} companies in this area · ${pinCount.toLocaleString()} on the map.`
                      : "No companies from our data are inside this exact shape."}
                  </span>
                  {areaStep.candidates ? amountChoices(areaStep.candidates).filter((o) => o.value > (areaStep.shown || 0)).slice(0, 3).map((o) => (
                    <button title="Read this many companies from the area" key={String(o.value)} type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={() => pickAmount(o.value)}>
                      Show {o.label}
                    </button>
                  )) : null}
                  {areaStep.candidates ? <button title="Pick how many companies to read from the area" type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => setAreaStep({ phase: "choose", candidates: areaStep.candidates })}>Choose a number…</button> : null}
                </>
              ) : null}
            </div>
          ) : null}
          <div style={{ ...muted, fontSize: 12.5, marginTop: 8 }}>
            {companies.some((c) => !points[c.id]) && busy === false && asked.current.size
              ? "Companies without a usable postcode aren't on the map; they're still in the List view." : "Pins are placed at each company's registered postcode."}
          </div>
        </div>
      ) : null}
      {tab === "people" ? (
        <>
          {filling ? (
            <div role="status" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "8px 14px", borderBottom: `1px solid ${C.borderLight}`, ...text, fontSize: 13, color: C.textInk }}>
              <Spinner size={14} /> Reading the registry for the people at {filling.done} of {filling.of} companies. Free.
              <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => { fillRun.current += 1; setFilling(null); searchPeople(null, form, 0); }}>Stop and show what is found</button>
            </div>
          ) : fillIds.length ? (
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "8px 14px", borderBottom: `1px solid ${C.borderLight}`, ...muted, fontSize: 12.5 }}>
              Some of these companies have no people on file yet. Reading them from the registry is free.
              <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" disabled={busy} title="Read the registry for the best-ranked companies that have no people on file yet. Free" onClick={() => fillPeople(fillIds)}>
                <Users size={14} /> Find people at the next {fillIds.length} companies
              </button>
            </div>
          ) : null}
          {people.length && peopleOf != null && peopleOf > peopleTotal ? (
            <div style={{ ...muted, fontSize: 12.5, padding: "6px 14px" }}>People are on file for {peopleTotal.toLocaleString()} of {peopleOf.toLocaleString()} matching companies.</div>
          ) : null}
          {people.length ? (
            <PeopleTable rows={people} onOpen={setOpenCo} isSaved={(c) => isSaved(c) || c.saved} onSave={saveOne} />
          ) : searched && !busy && !filling ? (
            <div style={{ ...muted, padding: 16 }}>
              {fillIds.length
                ? `No people are on file yet for these companies${form.title ? ` with "${form.title}" in their role` : ""}. Use "Find people" above to read them from the registry.`
                : `No current directors or officers are listed for these companies${form.title ? ` with "${form.title}" in their role` : ""}. Try another role word, or widen the search.`}
            </div>
          ) : null}
          {peopleTotal > 0 || people.length ? <Pager page={page} size={pageSize} total={peopleTotal} capped={capped} shown={new Set(people.map((x) => x.company.id)).size} onPage={goPage} busy={busy} unit="Companies" /> : null}
        </>
      ) : (
        <>
          <SelectionBar count={sel.count} label={selectedWord} onClear={sel.clear}>
            <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" title="Save the ticked companies to your Unsorted list" onClick={() => bulkSave("Unsorted")}><Plus size={14} /> Save {sel.count.toLocaleString()}</button>
            <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" title="Put the ticked companies in a list you name" onClick={async () => { const name = await askList({ title: `Add ${pickedRows.length.toLocaleString()} ${pickedRows.length === 1 ? "company" : "companies"} to a list`, confirm: "Add" }); if (name) bulkSave(name); }}><List size={14} /> Add to list</button>
            <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" title="Put the ticked companies in your Favourites list" onClick={() => bulkSave(FAVOURITES)}><Star size={14} /> Favourite</button>
            {pickedRows.some(missingDetail) ? (
              <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" disabled={preparing || contactCheck.job?.status === "running"}
                title="Look for the website, phone and email these companies are missing. You see the most it can cost, and what you get, before anything is charged"
                onClick={() => getContacts(pickedRows.filter(missingDetail))}>
                <ShieldCheck size={14} /> {preparing ? "Getting ready…" : `Get contacts (${pickedRows.filter(missingDetail).length.toLocaleString()})`}
              </button>
            ) : null}
            {pickedRows.some((c) => Object.keys(c.closed || {}).length) ? (
              <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" title="Show the website, phone and email we hold for the ticked companies. Free." onClick={() => revealMany(pickedRows)}>Reveal {pickedRows.filter((c) => Object.keys(c.closed || {}).length).length.toLocaleString()}</button>
            ) : null}
            <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" disabled={!pickedRows.some((c) => c.phone)} title="Save them and have your AI caller phone the ones with a number" onClick={() => callAll(pickedRows)}>Call</button>
            <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" title="Hide the ticked companies from this search" onClick={() => { const n = pickedRows.length; pickedRows.forEach(removeCompany); sel.clear(); notice(`Hid ${n.toLocaleString()} ${n === 1 ? "company" : "companies"} from this search.`); }}><X size={14} /> Remove</button>
          </SelectionBar>
          <CheckProgress check={contactCheck} pendingCount={0} onRecheck={() => {}} onFilter={() => {}} />
          {checking ? <CheckDialog ids={checking.ids} mode="contacts" onStart={(...a) => { sel.clear(); return contactCheck.start(...a); }} onClose={() => setChecking(null)} /> : null}
          {inArea ? (
            <div role="status" style={{ ...muted, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "8px 14px", borderBottom: `1px solid ${C.border}` }}>
              <MapIcon size={14} aria-hidden="true" /> <span>Showing the {companies.length.toLocaleString()} {companies.length === 1 ? "company" : "companies"} the map found.</span>
              <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={clearArea}>Show the whole list</button>
              <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => setView("map")}>Back to the map</button>
            </div>
          ) : null}
          <SelectAllNotice sel={sel} pageIds={companies.map((c) => c.id)} total={inArea ? companies.length : total} capped={!inArea && capped} reach={selectReach} busy={selecting} onSelectAll={selectAllMatching} />
          {companies.length ? (
            <CompaniesTable onGetContacts={getContacts} busy={busy} rows={companies} picked={sel.ids} activeId={openCo?.id} grouped={sort === "best" && ranked && !area} tiers={tiers} capped={capped}
              showFit={icpSet} fitSorted={sort === "fit"} onSortFit={area ? undefined : () => changeSort("fit")}
              onPick={sel.toggle}
              onPickAll={() => sel.togglePage(companies.map((c) => c.id))}
              onOpen={setOpenCo} isSaved={(c) => isSaved(c) || c.saved} onSave={saveOne} onFindSite={findSite} onReveal={reveal} onRevealRow={revealRow} lookups={lookups} />
          ) : searched && !inArea && !busy ? (
            <div style={{ ...muted, padding: 16, display: "grid", gap: 8, justifyItems: "start" }}>
              {nameAsKeywordTown(form.name) ? (
                <>
                  <div>No company is named "{form.name.trim()}".</div>
                  <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={() => { const g = nameAsKeywordTown(form.name); const next = { ...form, name: "", sector: g.keyword, town: g.town }; setForm(next); search(null, next, 0, null, undefined, undefined, true); }}>
                    Search {nameAsKeywordTown(form.name).keyword} in {nameAsKeywordTown(form.name).town} instead
                  </button>
                </>
              ) : <div>No companies match these filters. Try a wider town, a broader industry word, or tick "Include closed".</div>}
            </div>
          ) : null}
          {companies.length && !area && !(draft?.asked && draft.asked < total) ? <Pager page={page} size={pageSize} total={total} capped={capped} shown={companies.length} onPage={goPage} busy={busy} /> : null}
        </>
      )}
    </div>
  );
}
