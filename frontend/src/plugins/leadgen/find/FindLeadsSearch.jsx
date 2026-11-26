import { detailMissing, hiddenNow, isLate, searchKey, skipRepeat } from "../searchGuard";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { PickOptions, SOCIAL } from "../PickOptions";
import { Spinner, TableSkeleton, TopBar } from "../../../app/Loader";
import { Building2, Check, List, Map as MapIcon, ChevronsLeft, ChevronsRight, Plus, RefreshCw, Search, Sparkles, Star, Upload, Users, X, ArrowLeft } from "lucide-react";
import { C } from "../../../tokens";
import { api } from "../../../api/apiClient";
import { domainOf } from "../accounts/accountsLogic";
import { ImportView } from "../accounts/ImportView";
import { useCompanyCheck } from "../CheckCompanies";
import { PAGE_SIZES } from "../drawShape";
import { useHold } from "../SearchStatus";
import { askList, askText } from "../Dialogs";
import { CallButton, useCallDialog } from "../CallFlow";
import { PaneSwitch } from "../../../components/PaneSwitch";
import { useConnection } from "../../../hooks/useConnections";
import { useIcp } from "../FitParts";
import { CompanyDrawer } from "../CompanyDrawer";
import { notesChanged } from "../Notes";
import { announceCreditsChanged } from "../CreditsChip";
import { useBulkSelect } from "../../../components/bulkSelect";
import { notice } from "../../../utils/notice";
import { SearchField } from "../../../components/SearchField";
import { SavedSearches } from "../SavedSearches";
import { cleanFilters, nearFromReply } from "../savedSearchLogic";
import { summaryChips } from "../filterSummary";
import { filterNarrowed } from "../filterNarrowed";
import { StandingChip } from "../../../brand/StandingChip";
import { AccessNotice } from "../AccessNotice";
import { isOutsideAccess, limitedLine } from "../accessLogic";
import { appliedWords, asAccount, EMPTY_FORM, FAVOURITES, filtersToForm, FIRST_KEY, formToFilters, GROUP_KEYS, isOn, SELECT_ALL_LIMIT, splitList } from "./findLogic";
import { CHECK_TIPS, muted, text } from "./findParts";
import { ContactsPanel } from "./ContactsPanel";
import { FilterPanel } from "./FilterPanel";
import { ResultsCard } from "./ResultsCard";
import { useSelectionActions } from "./useSelectionActions";
import { useFavourites } from "./useFavourites";
import { useContactActions } from "./useContactActions";

// Find Leads layout and control styles.
const CHAT_CSS = `
.fl-filters{flex:0 0 296px;max-width:100%;position:sticky;top:8px;max-height:calc(100vh - 24px);overflow-y:auto}
.fl-filters.ui-card{background:${C.surfaceCool};border-color:${C.border}}
.fl-filters .fl-pin{background:${C.surfaceCool};border-bottom-color:${C.lineStrong}}
.fl-main{flex:1 1 560px;min-width:0}
@media (max-width:820px){.fl-filters{flex-basis:100%;position:static;max-height:none}}
.fl-bar{position:absolute;top:0;left:0;right:0;height:3px;overflow:hidden;z-index:5;background:var(--ui-accent-soft,#EEF2FE)}
.fl-bar::after{content:"";position:absolute;top:0;bottom:0;width:35%;background:var(--ui-accent,#3457D5);animation:flBar 1s ease-in-out infinite}
@keyframes flBar{0%{left:-35%}100%{left:100%}}
.fl-pin{position:sticky;top:0;z-index:6;background:#fff;padding:10px 0 12px;border-bottom:1px solid var(--ui-line-soft);display:flex;flex-direction:column;gap:8px}
.fl-collapse{all:unset;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:8px;color:var(--ui-muted)}
.fl-collapse:hover,.fl-collapse:focus-visible{background:var(--ui-hover);color:var(--ui-ink)}
.fl-seg{display:inline-flex;height:36px;box-sizing:border-box;background:var(--ui-sunken);border:1px solid var(--ui-line);border-radius:10px;padding:3px;gap:3px}
.fl-seg-btn{border:none;cursor:pointer;border-radius:7px;padding:0 12px;font:600 13px Inter,sans-serif;display:inline-flex;align-items:center;gap:6px;background:transparent;color:var(--ui-muted)}
.fl-seg-btn[data-on="true"]{background:#fff;color:var(--ui-ink);box-shadow:0 1px 3px rgba(0,0,0,.12)}
.fl-seg-btn:focus-visible{outline:2px solid var(--ui-accent);outline-offset:1px}
@media (max-width:820px){
  .fl-toolbar .fl-seg{height:auto;flex:1 1 calc(50% - 6px)}
  .fl-seg-btn{flex:1;justify-content:center;min-height:40px;padding:0 10px}
}
`;

function FindLeadsSearch({ access, store, listsStore, incoming, onAskAssistant, onOpenCompany, onSetIcp, onImport, isAdmin = false }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [applied, setApplied] = useState({});
  const [chips, setChips] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [total, setTotal] = useState(0);
  const [capped, setCapped] = useState(false);
  const excludedRef = useRef([]); // declared before the first line that assigns it: a ref used earlier crashes the page
  const selKeyRef = useRef("");
  const [excluded, setExcluded] = useState([]);
  excludedRef.current = excluded;
  const [searched, setSearched] = useState(false);
  const [tab, setTab] = useState("companies"); // companies | people
  const [sort, setSort] = useState("best");
  const icp = useIcp();
  const [icpSet, setIcpSet] = useState(false); // what the server said for the list on screen
  const [page, setPage] = useState(1);
  const [ranked, setRanked] = useState(true); // false until the server has ranked the register: results are then newest first
  const [tiers, setTiers] = useState(null); // {full, partial, basic}: how many results are in each group
  const [savedTotal, setSavedTotal] = useState(null); // null until the count is known: a loading dash, never a wrong 0
  const [selKey, setSelKey] = useState(""); // the search the ticks belong to: a new search (not a new page) clears them
  const sel = useBulkSelect(selKey);
  selKeyRef.current = selKey;
  const cardsById = useRef(new Map()); // every company card seen in this search, so ticks on other pages still have their row
  const lastQuery = useRef(null); // the request behind the results on screen, for "Select all"
  const [selecting, setSelecting] = useState(false);
  const [openCo, setOpenCo] = useState(null); // the company whose profile is open in the side drawer
  const [draft, setDraft] = useState(null); // { asked }: the list the AI assistant opened here, until the person is done with it
  const [filtersShown, setFiltersShown] = useState(() => { try { return localStorage.getItem("aivhub_find_filters") !== "hidden"; } catch { return true; } });
  const [groups, setGroups] = useState({ industry: true });
  const [people, setPeople] = useState([]);
  const [peopleTotal, setPeopleTotal] = useState(0); // companies that have people on file
  const [fillIds, setFillIds] = useState([]);
  const [filling, setFilling] = useState(null); // null, or {done, of} while the registry is being read for people
  const fillRun = useRef(0);
  const fillTried = useRef("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [accessNotice, setAccessNotice] = useState(""); // set by the server when this account's areas narrowed or refused the search
  // Phones: which pane shows. Search holds the Filters drop-down; Results holds the companies.
  const [pane, setPane] = useState("chat");

  const [view, setView] = useState("list");
  const [area, setArea] = useState(null); // a polygon drawn on the map: [[lat, lng], ...]
  const [areaNote, setAreaNote] = useState(""); // said above the map when the area shows every company because none fit the filters
  const [points, setPoints] = useState({}); // company id -> [lat, lng]
  const asked = useRef(new Set());
  // A drawn area is counted first, the user picks how many to see, then the companies are placed in steps.
  const [areaStep, setAreaStep] = useState(null); // null | {phase: counting|choose|running|done, ...}
  const stopArea = useRef(false);
  const areaRun = useRef(0); // each area scan gets a number; a scan that is no longer the latest never writes to the screen
  const [custom, setCustom] = useState(""); // a number typed as "how many"
  // How many companies the list loads at a time; remembered in the browser.
  const [pageSize, setPageSize] = useState(() => {
    try { const n = Number(localStorage.getItem("aivhub_find_page_size")); return PAGE_SIZES.includes(n) ? n : 25; } catch { return 25; }
  });
  const pageRef = useRef(pageSize);
  const AREA_FIRST = 50; // a drawn area first shows this many straight away; the user can ask for more
  const widenRef = useRef(false); // the drawn area's count found nothing for the typed words, so nearby words are used
  // How the typed words were read ("dentist" also looks for "dental"), and the words the user took out.
  const [understood, setUnderstood] = useState([]);
  // Too few companies had the trade as their main activity, so side-activity ones were included: the server's sentence saying so.
  const [broadenedNote, setBroadenedNote] = useState("");
  const [dropTerms, setDropTerms] = useState([]);
  const dropFor = useRef("");
  // Every search can be cancelled: a newer run id makes the older one's answer be ignored when it arrives.
  const runId = useRef(0);
  const runSig = useRef(""); // the search now running
  const supersedeArea = () => { stopArea.current = true; areaRun.current += 1; };
  const [didYouMean, setDidYouMean] = useState({}); // a mistyped town and the town it probably meant
  const pausedRef = useRef(false);
  const [paused, setPaused] = useState(false);


  // Map view: bring the map into view when it is chosen and whenever a search starts or finishes, so nobody scrolls to it each time.
  const mapRef = useRef(null);
  useEffect(() => {
    if (view === "map" && mapRef.current) mapRef.current.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [view, busy, area, areaStep?.phase]);
  const savedKeys = useMemo(() => new Set(store.accounts.flatMap((a) => [a.business_record_id, a.domain, a.name.toLowerCase()]).filter(Boolean)), [store.accounts]);
  const isSaved = (c) => {
    const d = domainOf(c.website);
    // By the register record, or by the company's own website. A name alone is not enough: another company can share it.
    return savedKeys.has(c.id) || Boolean(d && savedKeys.has(d));
  };
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const [words, setWords] = useState("");
  const [wordsBusy, setWordsBusy] = useState(false);
  // A sentence fills the filter boxes below (including the leave-out ones); the person checks them and presses Find companies.
  const fillFromWords = async (e) => {
    e.preventDefault();
    const t = words.trim();
    if (!t || wordsBusy) return;
    setWordsBusy(true);
    try {
      const r = await api.understandFilters(t, formToFilters(form));
      if (!r.understood) { notice(r.message || "I couldn't turn that into filters. Try something like: accountants in Leeds, leave out charities."); return; }
      setForm((f) => ({ ...filtersToForm(r.filters), title: f.title }));
      setGroups((g) => ({ ...g, industry: true, location: true, company: true, status: true, size: true, contact: true }));
      setWords("");
      notice(`Filled in: ${(r.chips || []).join(" · ") || "your filters"}. Check them, then press Find companies.`);
    } catch (err) {
      notice(err.message || "Couldn't read that. Try again.");
    } finally {
      setWordsBusy(false);
    }
  };
  // Phase 4: names for the SIC codes picked here, and the radius lookup (the districts inside N miles of a postcode)
  const [sicLabels, setSicLabels] = useState({});
  const lookRadius = async (postcode, miles) => {
    const pc = String(postcode || "").trim();
    if (!pc) { setForm((f) => ({ ...f, near: null, nearError: "" })); return; }
    try {
      const r = await api.radiusDistricts(pc, miles);
      setForm((f) => ({ ...f, near: nearFromReply(pc, miles, r), nearError: "" }));
    } catch (err) {
      setForm((f) => ({ ...f, near: null, nearError: err.message || "That postcode could not be looked up." }));
    }
  };
  const applySaved = (filters) => {
    const f = { ...EMPTY_FORM, ...filtersToForm(cleanFilters(filters)) };
    supersedeArea(); setArea(null); setAreaStep(null); setAreaNote("");
    setExcluded([]); setForm(f); setTab("companies"); search(null, f, 0, null, undefined, undefined, true);
  };
  const toggleSize = (s) => setForm((f) => ({ ...f, sizes: f.sizes.includes(s) ? f.sizes.filter((x) => x !== s) : [...f.sizes, s] }));

  // Map pins: look up the points for whatever is on screen, once per company.
  useEffect(() => {
    if (view !== "map") return;
    const need = companies.map((c) => c.id).filter((id) => !asked.current.has(id));
    if (!need.length) return;
    need.forEach((id) => asked.current.add(id));
    (async () => {
      for (let i = 0; i < need.length; i += 200) {
        try {
          const r = await api.geocodeCompanies(need.slice(i, i + 200));
          setPoints((p) => ({ ...p, ...(r.points || {}) }));
        } catch { need.slice(i, i + 200).forEach((id) => asked.current.delete(id)); }
      }
    })();
  }, [view, companies]);

  // Opening Find Leads shows the companies that match the ideal customer, best fit first. Without one it shows the whole
  // register, best profiles and biggest names first; filters then narrow it.
  const browsed = useRef(false);
  useEffect(() => {
    if (browsed.current || icp.loading) return;
    browsed.current = true;
    if (icp.isSet && Object.keys(icp.filters || {}).length) {
      const f = { ...EMPTY_FORM, ...filtersToForm(icp.filters) };
      setForm(f);
      setSort("fit");
      if (!seenIncoming.current) search(null, f, 0, null, undefined, "fit", true);
      return;
    }
    // The opening list this browser saw last time shows at once, then the fresh one replaces it quietly.
    try {
      const kept = JSON.parse(localStorage.getItem(FIRST_KEY) || "null");
      if (kept && Array.isArray(kept.companies) && kept.companies.length) {
        setCompanies(kept.companies); setTotal(kept.total || 0); setCapped(Boolean(kept.capped)); setTiers(kept.tiers || null);
        setRanked(kept.ranked !== false); setSearched(true);
      }
    } catch { /* nothing kept: the placeholder rows show instead */ }
    search(null, EMPTY_FORM, 0, null);
  }, [icp.loading]); // eslint-disable-line react-hooks/exhaustive-deps

  // The opening list never stays empty: if it failed (server busy, a restart, a slow first sort) or came back empty, it is tried
  // again by itself, up to three times, until the person starts a search of their own.
  const openingActive = useRef(true);
  const openingTries = useRef(0);
  useEffect(() => {
    const emptyOpening = searched && !busy && companies.length === 0;
    if (!(error || emptyOpening) || busy || !openingActive.current || openingTries.current >= 3) return undefined;
    const n = openingTries.current;
    const timer = setTimeout(() => {
      if (!openingActive.current) return;
      openingTries.current = n + 1;
      search(null, EMPTY_FORM, 0, null, undefined, undefined, true);
    }, [2000, 5000, 10000][n]);
    return () => clearTimeout(timer);
  }, [error, busy, searched, companies.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Taking a filter away refreshes the list by itself, on both the Companies and People tabs: no need to press search again.
  // With none left it is the whole register. Adding or editing a filter still waits for the search button.
  const ranFor = useRef(null); // the filters the screen was last asked for, even if that search failed (so a failure is never retried in a loop)
  useEffect(() => {
    if (!searched || area || busy || !ranFor.current) return undefined;
    const now = { ...formToFilters(form), ...(tab === "people" && String(form.title || "").trim() ? { title: String(form.title).trim() } : {}) };
    if (!filterNarrowed(ranFor.current, now)) return undefined;
    const none = !Object.keys(now).length;
    const timer = setTimeout(() => {
      if (tab === "people") searchPeople(null, none ? EMPTY_FORM : form, 0);
      else search(null, none ? EMPTY_FORM : form, 0, null, undefined, undefined, true);
    }, none ? 400 : 900);
    return () => clearTimeout(timer);
  }, [form, searched, area, busy, tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const searchHold = useHold();
  const countHold = useHold();
  // Phones: a search shows its progress, then its companies or its error, on the Results pane.
  useEffect(() => {
    if (busy) setPane("results");
  }, [busy]);

  // A search the AI assistant sent over: its filters fill the panel and the search runs, as if they had been typed here.
  const seenIncoming = useRef(null);
  useEffect(() => {
    if (!incoming || incoming.id === seenIncoming.current) return;
    seenIncoming.current = incoming.id;
    const f = filtersToForm(incoming.filters || {});
    // "Give me 20": the table shows exactly those 20, best first, instead of a page of 25.
    const asked = Number(incoming.meta?.asked) || 0;
    pageRef.current = asked ? Math.min(asked, 250) : pageSize;
    setDraft({ asked, sample: Boolean(incoming.meta?.sample), own: Boolean(incoming.meta?.own) });
    setExcluded([]); setForm(f); setTab("companies"); search(null, f, 0, null, undefined, undefined, true);
  }, [incoming]); // eslint-disable-line react-hooks/exhaustive-deps

  const search = async (e, overrideForm, offset = 0, areaOverride, dropOverride, sortOverride, force = false) => {
    if (e) e.preventDefault();
    if (e || (overrideForm && overrideForm !== EMPTY_FORM)) openingActive.current = false; // the person's own search: no more automatic retries
    const f = overrideForm || form;
    // An empty search from the search bar is "show everything": a map area left over from before, or companies hidden with Remove, must not narrow it.
    const wipe = Boolean(e) && !Object.keys(formToFilters(f)).length;
    if (wipe) { setArea(null); setAreaStep(null); setExcluded([]); }
    const fresh = Boolean(e); // a search the person just pressed starts without the companies they hid before
    const shape = wipe ? null : areaOverride !== undefined ? areaOverride : area;
    // A different search pressed while one is running replaces it (the old answer is dropped); only an exact repeat is ignored.
    const sig = searchKey(formToFilters(f), offset, shape, { tab: "companies", sort: sortOverride || sort, drop: dropOverride });
    if (skipRepeat(busy, force, sig, runSig.current)) return;
    runSig.current = sig;
    if (!shape) ranFor.current = formToFilters(f);
    // New words start with a fresh reading; removing a word from the reading keeps the others as they are.
    let drop = dropOverride;
    if (drop === undefined) {
      drop = f.sector === dropFor.current ? dropTerms : [];
      if (drop !== dropTerms) setDropTerms(drop);
    }
    dropFor.current = f.sector;
    if (shape) { countArea(shape, f, drop); return; }
    supersedeArea(); // no area now: an area scan still reading must not write over this list
    setBusy(true);
    setError("");
    setAccessNotice("");
    const myRun = ++runId.current;
    // The last results stay (dimmed) while the next page loads, so the screen never goes empty; if the search fails, only the
    // error shows, not results that belong to something else.
    let r;
    const query = { filters: formToFilters(f), exclude_ids: fresh ? [] : excluded, drop_terms: drop, sort: sortOverride || sort };
    try {
      r = await api.searchCompanies({ ...query, limit: pageRef.current, offset });
    } catch (err) {
      if (myRun === runId.current) searchHold.settle(() => { if (myRun !== runId.current) return; setCompanies([]); setTotal(0); setTiers(null); if (isOutsideAccess(err)) { setAccessNotice(err.message); } else { setError(err.message || "The search didn't finish. Try again."); } setBusy(false); });
      return;
    }
    if (myRun !== runId.current) return; // cancelled while it was running
    // If the search was paused, its answer waits here until Resume.
    searchHold.settle(() => {
      if (myRun !== runId.current) return;
      if (r.points) setPoints((p) => ({ ...p, ...r.points }));
      setCompanies(r.companies);
      setIcpSet(Boolean(r.icp_set));
      setPage(Math.floor(offset / pageRef.current) + 1);
      lastQuery.current = query;
      setSelKey(JSON.stringify([query.filters, query.sort, query.drop_terms]));
      setTiers(r.tiers || null);
      setAccessNotice(r.access_notice || "");
      setRanked(r.ranked !== false);
      setSavedTotal(r.saved_total ?? null);
      setTotal(r.total_all ?? r.total);
      setCapped(r.total_all == null && r.total_capped);
      // The slower figures (real total, group counts, saved) arrive a moment after the page is already on screen.
      loadSummary(r.query_filters || formToFilters(f), hiddenNow(query.exclude_ids, excludedRef.current)); // counted on the filters the search really ran, so the figures match the list shown
      setApplied(r.filters);
      setChips(r.chips || []);
      setDidYouMean(r.did_you_mean || {});
      setUnderstood(r.understood || []);
      setBroadenedNote(r.broadened ? r.broadened_note || "" : "");
      setSearched(true);
      setBusy(false);
      if (!offset && !Object.keys(formToFilters(f)).length && !(sortOverride || sort !== "best")) {
        try {
          localStorage.setItem(FIRST_KEY, JSON.stringify({ companies: r.companies.slice(0, 50).map((c) => ({ ...c, saved: false })), total: r.total_all ?? r.total, capped: r.total_all == null && r.total_capped, tiers: r.tiers || null, ranked: r.ranked !== false }));
        } catch { /* too big or blocked: the next visit just shows placeholder rows */ }
      }
    });
  };

  const sumRun = useRef(0);
  const loadSummary = async (filtersObj, excludeIds = []) => {
    const mine = ++sumRun.current;
    try {
      const r = await api.searchSummary({ filters: filtersObj, exclude_ids: excludeIds });
      if (mine !== sumRun.current) return;
      if (r.tiers) setTiers(r.tiers);
      if (r.saved_total != null) setSavedTotal(r.saved_total);
      if (r.total_all != null) { setTotal(r.total_all); setCapped(false); }
    } catch { /* the page is already there; the extra figures just stay as they were */ }
  };

  const cancelSearch = () => {
    runId.current += 1;
    searchHold.clear();
    setBusy(false);
    setSearched(true); // what was already on screen stays; nothing claims "0 companies" for a search that was stopped
  };
  // Back to a clean start: empty filters, no area, no results, nothing running.
  const resetSearch = () => {
    runId.current += 1;
    searchHold.clear();
    supersedeArea();
    pausedRef.current = false;
    setPaused(false);
    fillRun.current += 1;
    setFilling(null);
    setPeople([]);
    setPeopleTotal(0);
    setFillIds([]);
    setTiers(null);
    setSavedTotal(0);
    sel.clear();
    lastQuery.current = null;
    setSelKey("");
    setPage(1);
    setForm(EMPTY_FORM);
    setExcluded([]);
    setArea(null);
    setAreaStep(null);
    setCompanies([]);
    setTotal(0);
    setCapped(false);
    setChips([]);
    setUnderstood([]);
    setBroadenedNote("");
    setDropTerms([]);
    setSearched(false);
    setError("");
    setBusy(false);
  };

  const changePageSize = (n) => {
    pageRef.current = n;
    setPageSize(n);
    try { localStorage.setItem("aivhub_find_page_size", String(n)); } catch { /* the choice just isn't remembered */ }
    if (searched && !area && !busy) search(null, form, 0, null); // reload the list at the new size
  };

  const goPage = (n) => {
    if (tab === "people") searchPeople(null, form, (n - 1) * pageRef.current);
    else search(null, form, (n - 1) * pageRef.current, null);
  };
  const changeSort = (v) => {
    setSort(v);
    if (!searched || area) return;
    if (tab === "people") searchPeople(null, form, 0, v);
    else search(null, form, 0, null, undefined, v);
  };
  const changeTab = (next) => {
    if (next === tab) return;
    setTab(next);
    if (!searched || area) return;
    if (next === "people") searchPeople(null, form, 0, undefined, "people");
    else search(null, form, 0, null);
  };
  // Total / Net new / Saved: tapping one searches again with that filter on (tap again to clear it).
  const pickSaved = (v) => {
    const f = { ...form, saved: v };
    setForm(f);
    if (tab === "people") searchPeople(null, f, 0);
    else search(null, f, 0, null);
  };

  // The People tab: the people the registry lists at the companies that match. Companies whose people have not been
  // read yet are read from the registry (free), the best-ranked first, and the list is searched again.
  const searchPeople = async (e, overrideForm, offset = 0, sortOverride) => {
    if (e) e.preventDefault();
    const f = overrideForm || form;
    ranFor.current = { ...formToFilters(f), ...(String(f.title || "").trim() ? { title: String(f.title).trim() } : {}) };
    runSig.current = searchKey(formToFilters(f), offset, null, { tab: "people", sort: sortOverride || sort, title: f.title || "" });
    setBusy(true);  // a new search replaces one still running (the older answer is dropped by the run id)
    setError("");
    setAccessNotice("");
    const myRun = ++runId.current;
    setPeople([]);
    setCompanies([]);
    setTotal(0);
    let r;
    try {
      r = await api.searchPeople({ filters: formToFilters(f), limit: pageRef.current, offset, title: f.title || "", sort: sortOverride || sort });
    } catch (err) {
      if (myRun === runId.current) {
        if (isOutsideAccess(err)) setAccessNotice(err.message); else setError(err.message || "The search didn't finish. Try again.");
        setBusy(false);
      }
      return;
    }
    if (myRun !== runId.current) return;
    setAccessNotice(r.access_notice || "");
    setPeople(r.people);
    setPeopleTotal(r.companies_total);
    setPeopleOf(r.companies_matching ?? null);
    setTotal(r.companies_total);
    setCapped(r.total_capped);
    setApplied(r.filters);
    setChips(r.chips || []);
    setBroadenedNote(r.broadened ? r.broadened_note || "" : "");
    setFillIds(r.fill_ids || []);
    setPage(Math.floor(offset / pageRef.current) + 1);
    setSearched(true);
    setBusy(false);
    const key = JSON.stringify(formToFilters(f));
    if (r.fill_ids?.length && r.people.length < 10 && fillTried.current !== key) {
      fillTried.current = key;
      fillPeople(r.fill_ids, f);
    }
  };
  const fillPeople = async (ids, f = form) => {
    const mine = ++fillRun.current;
    let done = 0;
    setFilling({ done, of: ids.length });
    const queue = [...ids];
    const worker = async () => {
      while (queue.length && fillRun.current === mine) {
        const id = queue.shift();
        try { await api.companyContacts(id, { include_web: false }); } catch { /* one company the registry would not answer for: the others go on */ }
        done += 1;
        if (fillRun.current === mine) setFilling({ done, of: ids.length });
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    if (fillRun.current !== mine) return;
    setFilling(null);
    searchPeople(null, f, 0);
  };

  const dropTerm = (term) => {
    const next = [...dropTerms, term];
    setDropTerms(next);
    search(null, form, 0, undefined, next);
  };


  // Step 1: how many companies could be in the area. Free and quick.
  const countArea = async (shape, f = form, drop = dropTerms) => {
    supersedeArea();
    setError("");
    setSelKey(JSON.stringify(["area", shape, formToFilters(f), drop]));
    setAreaStep({ phase: "counting" });
    const myRun = ++runId.current;
    countHold.clear();
    try {
      const r = await api.areaCount({ filters: formToFilters(f), area: shape, drop_terms: drop });
      if (myRun !== runId.current) return;
      // If the count was paused, its answer waits here until Resume.
      countHold.settle(() => {
        if (myRun !== runId.current) return;
        widenRef.current = Boolean(r.widened);
        setUnderstood(r.understood || []);
        if (r.candidates) {
          setAreaNote("");
          showFromArea(shape, Math.min(AREA_FIRST, r.candidates), r.candidates, f, drop); // show a few at once, then offer more
        } else if (Object.keys(formToFilters(f)).length) {
          // Nothing here fits the filters: show every company in the area rather than an empty map.
          api.areaCount({ filters: {}, area: shape, drop_terms: [] }).then((all) => {
            if (myRun !== runId.current) return;
            if (all.candidates) {
              setAreaNote("No company in this area matches your filters, so this shows every company in it.");
              setUnderstood([]);
              widenRef.current = false;
              showFromArea(shape, Math.min(AREA_FIRST, all.candidates), all.candidates, EMPTY_FORM, []);
            } else setAreaStep({ phase: "choose", candidates: 0, capped: r.capped, inArea: 0 });
          }).catch(() => { if (myRun === runId.current) setAreaStep({ phase: "choose", candidates: 0, capped: r.capped, inArea: r.in_area || 0 }); });
        } else {
          setAreaStep({ phase: "choose", candidates: 0, capped: r.capped, inArea: r.in_area || 0 });
        }
      });
    } catch (err) {
      if (myRun !== runId.current) return;
      countHold.settle(() => {
        if (myRun !== runId.current) return;
        setAreaStep(null);
        setError(err.message || "The area couldn't be counted. Try again.");
      });
    }
  };

  // Step 2: read the area in steps until there are as many as the user asked for (or none are left).
  const showFromArea = async (shape, target, candidates, f = form, drop = dropTerms) => {
    const mine = ++areaRun.current;
    stopArea.current = false;
    pausedRef.current = false;
    setPaused(false);
    const stale = () => mine !== areaRun.current;
    const got = [];
    let scan = 0;
    let more = true;
    let lastChips = [];
    let lastFilters = applied;
    setCompanies([]);
    setTotal(0);
    setSearched(true);
    try {
      while (more && !stopArea.current && got.length < target) {
        while (pausedRef.current && !stopArea.current) await new Promise((r) => setTimeout(r, 300)); // paused: nothing new is read
        if (stale()) return;
        if (stopArea.current) break;
        setAreaStep({ phase: "running", found: got.length, scanned: scan, candidates, target });
        const r = await api.searchCompanies({ filters: formToFilters(f), area: shape, scan, exclude_ids: excludedRef.current, drop_terms: drop, widen: widenRef.current });
        if (stale()) return;
        if (stopArea.current) break;
        if (r.points) setPoints((p) => ({ ...p, ...r.points }));
        got.push(...r.companies);
        setCompanies(got.slice(0, target));
        setTotal(Math.min(got.length, target));
        lastChips = r.chips || lastChips;
        setBroadenedNote(r.broadened ? r.broadened_note || "" : "");
        if (r.understood) setUnderstood(r.understood);
        lastFilters = r.filters || lastFilters;
        more = r.next_scan != null;
        scan = r.next_scan ?? scan;
      }
      if (stale()) return;
      const shown = got.slice(0, target);
      setCompanies(shown);
      setTotal(shown.length);
      setCapped(false);
      setApplied(lastFilters);
      setChips(lastChips);
      setAreaStep({ phase: "done", shown: shown.length, more: more || got.length > target, candidates });
    } catch (err) {
      if (stale()) return;
      setError(err.message || "The search didn't finish. Try again.");
      setAreaStep({ phase: "done", shown: got.length, more: true, candidates, stopped: true });
    }
  };

  const drawArea = (shape) => {
    setArea(shape);
    setAreaNote("");
    setExcluded([]);
    setCompanies([]);
    setTotal(0);
    countArea(shape, form);
  };
  const clearArea = () => {
    supersedeArea();
    runId.current += 1; // a count still on its way is ignored
    countHold.clear();
    setAreaStep(null);
    setArea(null);
    setAreaNote("");
    setExcluded([]);
    setError("");
    setBusy(false);
    search(null, form, 0, null, undefined, undefined, true); // back to the normal list for the filters (with none, the whole register), never an empty screen
  };

  const removeCompany = (c) => {
    setExcluded((ex) => [...ex, c.id]);
    setCompanies((prev) => prev.filter((x) => x.id !== c.id));
    setTotal((t) => Math.max(0, t - 1));
  };

  // A drawn area is being counted or waiting for the user to pick an amount: nothing has been searched yet,
  // so the screen must not claim "0 companies" or "no companies match".
  const inArea = Boolean(area && areaStep);
  const areaPending = inArea && (areaStep.phase === "counting" || areaStep.phase === "choose") && !companies.length;
  const pickAmount = (n) => showFromArea(area, n, areaStep.candidates);
  const pinCount = companies.filter((c) => points[c.id]).length;
  const { applyCompany, call, callAll, callOne, canCall, checking, contactCheck, findSite, getContacts, lookups, missingDetail, peopleOf, pick, preparing, reveal, revealMany, revealRow, saveOne, setChecking, setLookups, setPeopleOf, setPick, setWaiting } = useContactActions({ setCompanies, setOpenCo, store, tab, view });
  // Favourites are an ordinary list called Favourites, so they can be enriched and emailed like any other.
  const { isFavourite } = useFavourites({ listsStore, store });
  const statusOf = (c) => ({ saved: isSaved(c), favourite: isFavourite(c) });
  const mapActions = {
    onSave: saveOne,
    onFavourite: (c) => store.save([asAccount(c)], FAVOURITES),
    onAddToList: async (c) => { const name = await askList({ title: `Add ${c.name} to a list`, confirm: "Add" }); if (name) store.save([asAccount(c)], name); },
    onRemove: (c) => { removeCompany(c); sel.drop([c.id]); store.toast(`Hid ${c.name} from this search.`); },
    onCall: (c) => (canCall ? callOne(c) : call.open({ kind: "one", id: "", name: c.name }, true)),
    callLocked: !canCall,
    // A note goes in the company's shared notes list, with your name and the time. The company doesn't need saving first.
    onNote: async (c) => {
      const note = await askText({ title: `Note on ${c.name}`, label: "Your note", multiline: true, confirm: "Add note", maxLength: 2000 });
      if (!note || !note.trim()) return;
      try {
        await api.addLeadNoteEntry({ companyId: c.id, text: note.trim() });
        notice("Note added.");
        notesChanged();
      } catch (e) {
        notice(e.message || "The note wasn't added. Try again.");
      }
    },
  };

  const filterCount = Object.keys(formToFilters(form)).length;
  // Like Apollo: opening a group closes the others, so only one is open at a time.
  const setGroup = (k) => setGroups((g) => (g[k] ? { ...g, [k]: false } : { [k]: true }));
  const firstLoad = busy && !companies.length && !people.length && view !== "map";
  const toggleFilters = () => setFiltersShown((v) => { const n = !v; try { localStorage.setItem("aivhub_find_filters", n ? "shown" : "hidden"); } catch { /* the choice just isn't remembered */ } return n; });
  const activeIn = (k) => GROUP_KEYS[k].filter((key) => isOn(form, key)).length;
  const clearGroup = (k) => setForm((f) => ({ ...f, ...Object.fromEntries(GROUP_KEYS[k].map((key) => [key, EMPTY_FORM[key]])) }));
  // What a closed group shows under its name: its values as chips, each removing just that value.
  const chipsFor = (k) => summaryChips(k, form, sicLabels).map((c) => ({ id: c.id, text: c.text, onRemove: () => setForm((f) => ({ ...f, ...c.patch(f) })) }));
  companies.forEach((c) => cardsById.current.set(c.id, c));
  const { bulkSave, pickedRows, selectAllMatching, selectReach, selectedWord } = useSelectionActions({ cardsById, companies, excludedRef, inArea, lastQuery, runId, sel, selKeyRef, setSelecting, store, total });
  const field = { display: "flex", flexDirection: "column", gap: 4, flex: "1 1 0", minWidth: 0 };
  const label = { ...text, fontSize: 12, fontWeight: 600, color: C.slate };
  const check = (k, t) => (
    <label title={CHECK_TIPS[k]} style={{ ...text, fontSize: 13, display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
      <input type="checkbox" checked={form[k]} onChange={(e) => setField(k, e.target.checked)} /> {t}
    </label>
  );

  return (
    <div className="pane-root fl-root" data-active={pane} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {call.dialog}
      {pick ? <PickOptions key={`${pick.company.id}:${pick.kind}`} kind={pick.kind} company={pick.company.name} options={pick.options} anchorKey={`${pick.company.id}:${pick.kind}`} onClose={() => setPick(null)}
        onRetry={async (hint) => {
          const { company: co, kind } = pick;
          const key = `${co.id}:${kind}`;
          const r = SOCIAL.includes(kind) ? await api.findSocial(co.id, kind, hint) : await api.findCompanyWebsite(co.id, kind, hint);
          applyCompany(co.id, r.company);
          if (r.charged) announceCreditsChanged();
          const matches = !r.found && (r.options || []).length ? r.options : [];
          setWaiting((w) => ({ ...w, [key]: matches.length ? matches : null }));
          setLookups((m) => { const n = { ...m }; if (r.found) delete n[key]; else n[key] = matches.length ? "options" : "none"; return n; });
          if (r.found) store.toast(`Found the ${kind} for ${co.name}.`);
          return { done: Boolean(r.found), options: matches };
        }}
        onPick={async (o) => { const r = await api.chooseContact(pick.company.id, { kind: pick.kind, value: o.value }); applyCompany(pick.company.id, r.company);
          setLookups((m) => { const n = { ...m }; delete n[`${pick.company.id}:${pick.kind}`]; return n; }); if (r.charged) announceCreditsChanged(); store.toast(r.charged ? "Saved. Credits used for this find. It will show for this company from now on." : "Saved. It will show for this company from now on."); }} /> : null}
      <PaneSwitch value={pane} onChange={setPane}
        panes={[{ id: "chat", label: "Search" }, { id: "results", label: "Results", badge: searched && total ? total.toLocaleString() : "" }]} />
      <style>{CHAT_CSS}</style>
      <>
      <div className="fl-toolbar" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" className="ui-btn ui-btn--secondary hide-mobile" style={{ height: 40 }} aria-pressed={filtersShown} title={filtersShown ? "Hide the filters" : "Show the filters"} onClick={toggleFilters}>
          {filtersShown ? <ChevronsLeft size={15} /> : <ChevronsRight size={15} />} Filters{filterCount ? ` · ${filterCount}` : ""}
        </button>
        <form onSubmit={(e) => { setExcluded([]); if (tab === "people") searchPeople(e); else search(e); }} style={{ flex: "999 1 320px", minWidth: 0, display: "flex" }}>
          <SearchField label="Company name" title="Find a company by its name. Searches every registered company" value={form.name} onChange={(v) => setField("name", v)} placeholder="Search a company by name, e.g. Tesco, Greggs, Smith & Sons" />
        </form>
        {tab === "companies" ? <SavedSearches filters={formToFilters(form)} hasFilters={Object.keys(formToFilters(form)).some((k) => ["keyword", "sector", "sic_codes", "industry_types", "towns", "postcode_prefixes", "name_contains", "near", "signals"].includes(k))} onApply={applySaved} /> : null}
        <div role="tablist" aria-label="What to look for" className="fl-seg">
          {[["companies", "Companies", Building2], ["people", "People", Users]].map(([id, name, Icon]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} data-on={tab === id} className="fl-seg-btn" onClick={() => changeTab(id)}>
              <Icon size={15} /> {name}
            </button>
          ))}
        </div>
        {tab === "companies" ? (
          <div role="tablist" aria-label="Results view" className="fl-seg">
            {[["list", "List", List], ["map", "Map", MapIcon]].map(([id, name, Icon]) => (
              <button key={id} type="button" role="tab" aria-selected={view === id} data-on={view === id} className="fl-seg-btn"
                title={id === "map" ? "Search on a map: see the companies as pins and draw an area to search inside it" : "See the results as a list"}
                onClick={() => setView(id)}>
                <Icon size={15} /> {name}
              </button>
            ))}
          </div>
        ) : null}
        {onImport ? (
          <button
            type="button"
            className="ui-btn ui-btn--secondary ui-btn--sm"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              height: 36,
              fontWeight: 600,
              background: "#FFFFFF",
              border: "1px solid var(--ui-line, #E2E8F0)",
              boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
            }}
            title="Import a spreadsheet of customer records"
            onClick={onImport}
          >
            <Upload size={14} /> Import
          </button>
        ) : null}
        <StandingChip canSeeRules={isAdmin} />
      </div>
      <div className="pane-root fl-body" data-active={pane} style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
      {filtersShown ? (
      <FilterPanel activeIn={activeIn} busy={busy} check={check} chipsFor={chipsFor} clearGroup={clearGroup} field={field} fillFromWords={fillFromWords} filterCount={filterCount} form={form} groups={groups} label={label} lookRadius={lookRadius} resetSearch={resetSearch} search={search} searchPeople={searchPeople} setExcluded={setExcluded} setField={setField} setForm={setForm} setGroup={setGroup} setSicLabels={setSicLabels} setWords={setWords} sicLabels={sicLabels} tab={tab} toggleSize={toggleSize} words={words} wordsBusy={wordsBusy} />
      ) : null}
      <div data-pane="results" className="fl-main" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {firstLoad ? (
        <div className="ui-card fl-card" style={{ overflow: "hidden", position: "relative" }}>
          <TopBar />
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: `1px solid ${C.border}` }}>
            <Spinner size={16} />
            <div style={{ ...text, fontSize: 13.5, fontWeight: 600, color: C.ink, marginRight: "auto" }}>{tab === "people" ? "Finding the people at matching companies" : searched ? "Searching" : "Opening the register"}{appliedWords(form) ? <span style={{ fontWeight: 400, color: C.slate }}> · {appliedWords(form)}</span> : null}</div>
            {searched ? <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" title="Stop this search" onClick={cancelSearch}><X size={13} /> Cancel</button> : null}
          </div>
          <TableSkeleton rows={12} cols={tab === "people" ? 6 : 7} label={tab === "people" ? "Finding the people at matching companies" : "Searching the company register"} />
        </div>
      ) : null}
      {!busy && Object.keys(didYouMean).length ? (
        <div role="status" style={{ ...muted, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          Did you mean {Object.values(didYouMean).join(", ")}?
          <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={() => {
            const next = { ...form, town: splitList(form.town).map((t) => didYouMean[t] || t).join(", ") };
            setForm(next); setDidYouMean({}); search(null, next, 0, null, undefined, undefined, true);
          }}>Use {Object.values(didYouMean).join(", ")}</button>
        </div>
      ) : null}
      {access && access.limited && access.districts.length ? <div style={{ ...muted, fontSize: 12.5 }}>{limitedLine(access.districts)}</div> : null}
      <AccessNotice message={accessNotice} />
      {error ? (
        <div role="alert" style={{ ...muted, color: C.red, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {error}
          <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" disabled={busy} onClick={() => (tab === "people" ? searchPeople(null, form, 0) : search(null, form, 0, null))}><RefreshCw size={13} /> Try again</button>
        </div>
      ) : null}
      {!busy && !error && !searched && view !== "map" ? (
        <div className="ui-card phone-only" style={{ padding: 20, flexDirection: "column", alignItems: "flex-start", gap: 12 }}>
          <div style={{ ...text, fontSize: 15, fontWeight: 600, color: C.ink }}>No search yet</div>
          <div style={{ ...muted, fontSize: 14 }}>Ask the AI Assistant who you're after, or set the filters. The companies you find show here.</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="ui-btn ui-btn--primary" style={{ minHeight: 44 }} onClick={() => onAskAssistant?.()}><Sparkles size={15} /> Ask AI</button>
            <button type="button" className="ui-btn ui-btn--secondary" style={{ minHeight: 44 }} onClick={() => { setPane("chat"); setFiltersShown(true); }}>Set filters</button>
          </div>
        </div>
      ) : null}

      {(searched || view === "map") && !firstLoad ? (
        <ResultsCard results={{ companies, total, capped, searched, tab, sort, icp, icpSet, page, pageSize, pageRef, ranked, tiers, savedTotal, people, peopleTotal, peopleOf, understood, setUnderstood, broadenedNote, asked, draft, setDraft, busy, form, setForm, custom, setCustom, isSaved, statusOf, dropTerm, missingDetail }} searching={{ search, searchPeople, goPage, changePageSize, changeSort, pickSaved, fillIds, fillPeople, fillRun, filling, setFilling, paused, pausedRef, setPaused }} mapArea={{ area, areaNote, areaPending, areaStep, setAreaStep, clearArea, countArea, countHold, drawArea, inArea, pickAmount, pinCount, points, stopArea, mapRef, mapActions, removeCompany, view, setView }} selection={{ sel, selecting, pickedRows, selectAllMatching, selectReach, selectedWord, bulkSave }} contacts={{ reveal, revealMany, revealRow, findSite, lookups, getContacts, contactCheck, checking, setChecking, preparing, call, callAll, saveOne, openCo, setOpenCo }} onSetIcp={onSetIcp} />
      ) : null}
      </div>
      </div>
      <CompanyDrawer openCo={openCo} store={store} onClose={() => setOpenCo(null)}
        saved={openCo ? store.accounts.find((a) => a.business_record_id && a.business_record_id === openCo.id) || null : null}
        onOpenPage={openCo && onOpenCompany ? () => { const id = openCo.id; setOpenCo(null); onOpenCompany(id); } : null}
        contacts={openCo ? <ContactsPanel key={openCo.id} company={openCo} /> : null}
        saveAction={openCo ? (isSaved(openCo) || openCo.saved ? <span style={{ ...text, fontSize: 13, color: C.green, display: "inline-flex", alignItems: "center", gap: 4 }}><Check size={14} /> Saved</span>
          : <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" title="Save this company to your Unsorted list" onClick={() => saveOne(openCo)}><Plus size={14} /> Save</button>) : null}
        actions={openCo ? (
          <>
            {onOpenCompany ? <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" title="The full page: why now, people and contact details" onClick={() => { const id = openCo.id; setOpenCo(null); onOpenCompany(id); }}>Open page</button> : null}
            <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" title="Save this company to your Favourites list" onClick={() => store.save([asAccount(openCo)], FAVOURITES)}><Star size={14} /> Favourite</button>
            {openCo.phone ? <CallButton label="Save & call" lockedLabel="Call · add Voice" variant="ghost" title="Save it to your Unsorted list and have your AI caller phone them" onClick={() => (canCall ? callOne(openCo) : call.open({ kind: "one", id: "", name: openCo.name }, true))} onLocked={() => call.open({ kind: "one", id: "", name: openCo.name }, true)} /> : null}
          </>
        ) : null} />


      </>
    </div>
  );
}

export function FindLeadsView({ access, store, listsStore, onGo, incoming, onAskAssistant, importAsk, onOpenCompany, isAdmin = false }) {
  const [sub, setSub] = useState("search");
  useEffect(() => { if (importAsk) setSub("import"); }, [importAsk]);
  return (
    <div className="fl-view" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {sub === "import" ? (
        <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" style={{ alignSelf: "flex-start" }} onClick={() => setSub("search")}>
          <ArrowLeft size={14} /> Back to Find Leads
        </button>
      ) : null}
      <div style={sub === "search" ? { display: "contents" } : { display: "none" }}><FindLeadsSearch access={access} isAdmin={isAdmin} store={store} listsStore={listsStore} incoming={incoming} onAskAssistant={onAskAssistant} onOpenCompany={onOpenCompany} onSetIcp={onGo ? () => onGo("business") : undefined} onImport={() => setSub("import")} /></div>
      {sub === "import" && <ImportView store={store} onGo={onGo} onAskAi={() => setSub("search")} />}
    </div>
  );
}
