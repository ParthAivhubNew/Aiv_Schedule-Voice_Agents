import { useCallback, useEffect, useRef, useState } from "react";
import { screeningNote } from "../tpsCheck";
import { api } from "../../../api/apiClient";
import { announceCreditsChanged } from "../CreditsChip";
import { ICP_EVENT } from "../FitParts";
import { hasFindings } from "./accountsLogic";

// ---------------------------------------------------------------- the shared store
export function useLeadAccounts(onToast, onListsChanged) {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [accessNotice, setAccessNotice] = useState(""); // the server's note when the list was narrowed to this account's areas
  const [researching, setResearching] = useState({}); // account id -> true while its research runs
  const [improving, setImproving] = useState({}); // account id -> { steps, done, result } for the Improve button

  const reload = useCallback(async () => {
    try {
      const r = await api.listLeadAccounts();
      setAccounts(r.accounts || []);
      setAccessNotice(r.access_notice || "");
      setError("");
    } catch (e) {
      setError(e.message || "Couldn't load your saved accounts.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    reload();
  }, [reload]);
  useEffect(() => { // the fit scores come with the list: a saved ideal customer reads it again
    window.addEventListener(ICP_EVENT, reload);
    return () => window.removeEventListener(ICP_EVENT, reload);
  }, [reload]);

  // Single-company answers don't carry the fit score or signals (only the list does), so the ones already shown are kept.
  const replace = (a) => setAccounts((prev) => prev.map((x) => (x.id === a.id ? { fit: x.fit, signals: x.signals, ...a } : x)));
  const stopped = useRef(new Set()); // account ids whose person stopped waiting for the lookup in flight
  const lookup = async (id, kind, call, message, failure) => {
    stopped.current.delete(id);
    setResearching((b) => ({ ...b, [id]: kind }));
    try {
      const a = await call();
      replace(a);
      const note = message(a);
      if (!stopped.current.has(id)) onToast(note);
      return a;
    } catch (e) {
      if (!stopped.current.has(id)) onToast(e.message || failure);
      return null;
    } finally {
      if (!stopped.current.has(id)) {
        setResearching((b) => { const next = { ...b }; delete next[id]; return next; });
      }
      stopped.current.delete(id);
    }
  };

  // One button, every source, cheapest first: our own records (free), then the web, then a deep web search only if a phone or
  // website is still missing. Each step reports for itself so the person watches it work, and a step that can't run
  // (such as no credits left) stops the rest instead of failing quietly.
  const dissolved = (a) => a.verification?.verdict === "problem";
  // What the last step learned, in a few words: "Phone confirmed, email looks right".
  const verifiedNote = (a) => {
    const v = a.verification || {};
    const bits = [];
    if (a.phone) bits.push(v.phone?.verified === true ? "phone confirmed" : v.phone?.state === "invalid" ? "phone not usable" : v.phone?.state === "unconfirmed" ? "phone not a normal line" : "phone format ok");
    if (a.email) bits.push(["ok", "verified", "found"].includes(v.email?.state) ? "email looks right" : v.email?.state === "invalid" ? "email will bounce" : "email couldn't be checked");
    const text = bits.join(", ");
    return text ? text[0].toUpperCase() + text.slice(1) : "Checked";
  };
  const improve = async (id, { again = false } = {}) => {
    const before = accounts.find((x) => x.id === id);
    if (!before) return null;
    const MISSING = ["website", "phone", "email", "contact_name"];
    const missing = (a) => MISSING.filter((k) => !String(a[k] || "").trim());
    const plan = [
      { key: "records", label: "Check our own records", run: () => api.quickCheckLeadAccount(id), skip: () => "" },
      { key: "web", label: "Search the web for details, people and sources", run: () => api.researchLeadAccount(id),
        skip: (a) => (dissolved(a) ? "Skipped: this company has ended" : a.researched_at && !again ? "Already looked up before" : "") },
      { key: "deep", label: "Deep web search for a phone or website", run: () => api.deepSearchLeadAccount(id),
        skip: (a) => (dissolved(a) ? "Skipped: this company has ended" : a.phone && a.website ? "Not needed, both are filled in" : "") },
      // Last, so it checks what the steps above just found: the company register, the website, every email and every phone number.
      { key: "verify", label: "Check the phone, email and website", run: () => api.checkLeadAccount(id),
        skip: (a) => (!a.phone && !a.email && !a.website ? "Nothing to check yet" : "") },
    ];
    stopped.current.delete(id);
    setResearching((b) => ({ ...b, [id]: "improve" }));
    const mark = (key, patch) => setImproving((m) => ({ ...m, [id]: { ...m[id], steps: m[id].steps.map((st) => (st.key === key ? { ...st, ...patch } : st)) } }));
    setImproving((m) => ({ ...m, [id]: { done: false, steps: plan.map(({ key, label }) => ({ key, label, state: "wait", note: "" })) } }));
    let cur = before;
    let stoppedEarly = "";
    for (const st of plan) {
      if (stopped.current.has(id)) break;
      const why = st.skip(cur);
      if (why) { mark(st.key, { state: "skip", note: why }); continue; }
      mark(st.key, { state: "run", note: "Checking…" });
      try {
        const a = await st.run();
        replace(a);
        const gained = missing(cur).filter((k) => !missing(a).includes(k)).length;
        mark(st.key, { state: "done", note: st.key === "verify" ? verifiedNote(a) : gained ? `Added ${gained} detail${gained === 1 ? "" : "s"}` : "Nothing new" });
        cur = a;
      } catch (e) {
        const msg = e.message || "Couldn't finish this step.";
        mark(st.key, { state: "fail", note: msg });
        stoppedEarly = msg;
        if (/credit|top up|plan/i.test(msg)) break;
      }
    }
    announceCreditsChanged();
    const added = missing(before).filter((k) => !missing(cur).includes(k));
    setImproving((m) => ({ ...m, [id]: { ...m[id], done: true, result: { added, after: cur.found?.after_pct ?? 0, extra: cur.found?.extra || {}, problem: stoppedEarly } } }));
    if (!stopped.current.has(id)) {
      setResearching((b) => { const next = { ...b }; delete next[id]; return next; });
      onToast(added.length ? `Added ${added.length} detail${added.length === 1 ? "" : "s"} to ${cur.name}.` : stoppedEarly ? `Stopped: ${stoppedEarly}` : `Nothing more found for ${cur.name}.`);
    }
    stopped.current.delete(id);
    return cur;
  };

  return {
    accounts, loading, error, accessNotice, researching, improving, improve, clearImprove: (id) => setImproving((m) => { const n = { ...m }; delete n[id]; return n; }), reload, toast: onToast,
    // Saves new accounts; ones already saved are skipped by the server.
    // Every save lands in a list (Unsorted unless a name is given); a company already saved is not copied,
    // it is just added to that list too.
    save: async (list, listName = "Unsorted", { quiet = false, onExisting } = {}) => {
      try {
        const r = await api.saveLeadAccounts(list, listName, onExisting);
        if (r.accounts?.length) setAccounts((prev) => [...r.accounts, ...prev]);
        (r.updated || []).forEach(replace); // companies already saved that the file filled in
        if (onListsChanged) onListsChanged();
        if (quiet) return r; // the caller reports once, after the last batch
        const where = r.list ? ` in the list ${r.list.name}` : "";
        onToast(r.added || r.matched
          ? `Saved ${r.added} new ${r.added === 1 ? "company" : "companies"}${where}${r.matched ? `. ${r.matched} ${r.matched === 1 ? "was" : "were"} already saved and ${r.matched === 1 ? "was" : "were"} added to the list` : ""}.`
          : "Nothing new to save.");
        return r;
      } catch (e) {
        onToast(e.message || "Couldn't save. Try again.");
        return null;
      }
    },
    update: async (id, changes) => {
      try {
        const a = await api.updateLeadAccount(id, changes);
        replace(a);
        onToast("Saved changes.");
        return a;
      } catch (e) {
        onToast(e.message || "Couldn't save changes.");
        return null;
      }
    },
    remove: async (id) => {
      try {
        await api.deleteLeadAccount(id);
        setAccounts((prev) => prev.filter((x) => x.id !== id));
        onToast("Removed from saved accounts.");
        return true;
      } catch (e) {
        onToast(e.message || "Couldn't remove it.");
        return false;
      }
    },
    // The three lookups share one shape. "Stop waiting" lets the person move on: the server still finishes and
    // saves what it found on the company, so the answer is applied quietly when it lands, never lost.
    research: (id) => lookup(id, "research", () => api.researchLeadAccount(id), (a) => {
      announceCreditsChanged();
      return (hasFindings(a) ? `Researched ${a.name}.` : `Nothing public found for ${a.name}. No credit used.`) + screeningNote(a.tps_check);
    }, "Research failed. Try again."),
    // Deep web search: one structured lookup (Google Places under the hood -- never named to the
    // user), 2 Leads credits when it finds something.
    deepSearch: (id) => {
      const before = accounts.find((x) => x.id === id);
      return lookup(id, "deep", () => api.deepSearchLeadAccount(id), (a) => {
        announceCreditsChanged();
        const changed = before && (a.phone !== before.phone || a.website !== before.website || a.region !== before.region);
        return (changed ? `Deep web search found more on ${a.name}.` : `Nothing new found for ${a.name}. No credit used.`) + screeningNote(a.tps_check);
      }, "Deep web search failed. Try again.");
    },
    // Free: only checks our own shared company store, no live web search, no credit.
    quickCheck: (id) => lookup(id, "quick", () => api.quickCheckLeadAccount(id), (a) =>
      a.researched_at ? `Found a full research dossier for ${a.name} in our records -- already paid for by an earlier search.`
        : a.registry ? `Found ${a.name} in our records.` : `Our records have no match for ${a.name} yet, so nothing was added. Use Look up to search the web. No credit used for this check.`,
    "Couldn't check right now."),
    stopWaiting: (id) => {
      stopped.current.add(id);
      setResearching((b) => { const next = { ...b }; delete next[id]; return next; });
      onToast("Stopped waiting. If it finishes in the background, the result is saved on the company.");
    },
  };
}
