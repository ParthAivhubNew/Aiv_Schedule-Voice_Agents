import { useRef, useState } from "react";
import { api } from "../../../api/apiClient";
import { EMPTY_FORM, formToFilters } from "./findLogic";

const AREA_FIRST = 50; // a drawn area first shows this many straight away; the user can ask for more

// Find Leads' drawn map area. A drawn area is counted first, the user picks how many to see, then the companies are placed in steps.
// Moved out of FindLeadsSearch unchanged; what it needs from the search comes in by name. Clearing the area and going back to the
// normal list stays in the screen (resetArea, then its own search), because the search is declared after this hook.
export function useMapArea({
  applied, companies, countHold, dropTerms, excludedRef, form, pausedRef, runId, setApplied, setBroadenedNote, setBusy, setCapped, setChips,
  setCompanies, setError, setExcluded, setPaused, setPoints, setSearched, setSelKey, setTotal, setUnderstood,
}) {
  const [area, setArea] = useState(null); // a polygon drawn on the map: [[lat, lng], ...]
  const [areaNote, setAreaNote] = useState(""); // said above the map when the area shows every company because none fit the filters
  const [areaStep, setAreaStep] = useState(null); // null | {phase: counting|choose|running|done, ...}
  const stopArea = useRef(false);
  const areaRun = useRef(0); // each area scan gets a number; a scan that is no longer the latest never writes to the screen
  const widenRef = useRef(false); // the drawn area's count found nothing for the typed words, so nearby words are used
  const supersedeArea = () => { stopArea.current = true; areaRun.current += 1; };

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

  // Everything clearArea did before its search: stop any count or scan, and forget the area.
  const resetArea = () => {
    supersedeArea();
    runId.current += 1; // a count still on its way is ignored
    countHold.clear();
    setAreaStep(null);
    setArea(null);
    setAreaNote("");
    setExcluded([]);
    setError("");
    setBusy(false);
  };

  // A drawn area is being counted or waiting for the user to pick an amount: nothing has been searched yet,
  // so the screen must not claim "0 companies" or "no companies match".
  const inArea = Boolean(area && areaStep);
  const areaPending = inArea && (areaStep.phase === "counting" || areaStep.phase === "choose") && !companies.length;
  const pickAmount = (n) => showFromArea(area, n, areaStep.candidates);

  return { area, setArea, areaNote, setAreaNote, areaStep, setAreaStep, stopArea, supersedeArea, countArea, drawArea, resetArea, inArea, areaPending, pickAmount };
}
