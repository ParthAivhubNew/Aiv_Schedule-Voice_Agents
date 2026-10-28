import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Spinner, TableSkeleton, TopBar } from "../../app/Loader";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { Building2, Check, ChevronDown, Eye, Lightbulb, Megaphone, Columns3, ExternalLink, FileSpreadsheet, Plus, Search, ShieldCheck, Sparkles, Trash2, Upload, X } from "lucide-react";
import { api } from "../../api/apiClient";
import { announceCreditsChanged, creditWord, useLeadCredits } from "./CreditsChip";
import { SearchStatus } from "./SearchStatus";
import { C, FONT_BODY } from "../../tokens";
import { ImportMapper } from "./ImportMapper";
import { AddToListDialog } from "./Lists";
import { applyMapping, withPeople } from "./importMapping";
import { CheckDetails, CheckDialog, DetailChecks, EndedBanner, CheckProgress, LOCK_TIP, VerdictBadge, VERDICTS, VERDICT_ORDER, useCompanyCheck, useLocked } from "./CheckCompanies";
import { askConfirm, askText } from "./Dialogs";
import { CallButton, useCallDialog } from "./CallFlow";
import { LeadActivity, StageBadge } from "./LeadActivity";

// The Leads screens built on saved accounts (stored on the server, per company): AI Lead Scout,
// Saved Accounts, Decision Makers, Account Dossiers and Import, plus the account panel and the
// add-account form. Nothing here is made up: a field nobody found stays empty.

const SOURCE_LABEL = { scout: "AI Lead Scout", copilot: "AI Lead Copilot", import: "Import", manual: "Added by hand" };
// Where a company came from, in a sentence a person understands.
const SOURCE_WORDS = { scout: "Found by AI Lead Scout", copilot: "Found by AI Lead Copilot", import: "Imported from your file", manual: "Added by hand" };
const sourceWords = (src) => SOURCE_WORDS[src] || SOURCE_WORDS.manual;
const text = { fontFamily: FONT_BODY };
const muted = { ...text, fontSize: 13, color: C.slate, lineHeight: 1.5 };

export function domainOf(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  try {
    const host = new URL(raw.includes("://") ? raw : `https://${raw}`).hostname.toLowerCase();
    return host.startsWith("www.") ? host.slice(4) : host;
  } catch (_) {
    return "";
  }
}

function hasFindings(a) {
  const r = a?.research;
  return Boolean(r && (r.overview || r.people?.length || r.team?.length || r.phones?.length || r.emails?.length || r.other_offices?.length || Object.keys(r.socials || {}).length));
}

// ---------------------------------------------------------------- the shared store
export function useLeadAccounts(onToast, onListsChanged) {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [researching, setResearching] = useState({}); // account id -> true while its research runs
  const [improving, setImproving] = useState({}); // account id -> { steps, done, result } for the Improve button

  const reload = useCallback(async () => {
    try {
      const r = await api.listLeadAccounts();
      setAccounts(r.accounts || []);
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

  const replace = (a) => setAccounts((prev) => prev.map((x) => (x.id === a.id ? a : x)));
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
    accounts, loading, error, researching, improving, improve, clearImprove: (id) => setImproving((m) => { const n = { ...m }; delete n[id]; return n; }), reload, toast: onToast,
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
      return hasFindings(a) ? `Researched ${a.name}.` : `Nothing public found for ${a.name}. No credit used.`;
    }, "Research failed. Try again."),
    // Deep web search: one structured lookup (Google Places under the hood -- never named to the
    // user), 2 Leads credits when it finds something.
    deepSearch: (id) => {
      const before = accounts.find((x) => x.id === id);
      return lookup(id, "deep", () => api.deepSearchLeadAccount(id), (a) => {
        announceCreditsChanged();
        const changed = before && (a.phone !== before.phone || a.website !== before.website || a.region !== before.region);
        return changed ? `Deep web search found more on ${a.name}.` : `Nothing new found for ${a.name}. No credit used.`;
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

// What happens next for a company that still isn't complete or verified. Finding data is our job, so every point is something
// we do or something the person already knows, never a pointer to another service. When we have searched everything, we say so.
const SHARED_INBOX = /^(info|hello|contact|enquiries|enquiry|office|admin|sales|support|accounts|mail|team|reception)@/i;
const NAMES = { website: "website", phone: "phone", email: "email", contact_name: "contact" };
// What to do next, chosen from this company's own state. Each tip names what is actually wrong here, and nothing shows when nothing is.
function tipsFor(a) {
  const has = (k) => Boolean(String(a[k] || "").trim());
  const v = a.verification || {};
  const searched = Boolean(a.researched_at);
  const gaps = ["website", "phone", "email", "contact_name"].filter((k) => !has(k));
  const tips = [];
  if (gaps.length) {
    const list = gaps.map((k) => NAMES[k]).join(", ");
    tips.push(searched
      ? ["Still missing: " + list, "Our records and the web were searched and these are not published anywhere we can reach. Improve again re-runs the search. New details appear here as we find them."]
      : ["Missing: " + list, "Press Improve this company. We check our records, then the web, and fill in what we find."]);
  }
  if (!has("website") && gaps.length) tips.push(["Know the website?", "If you have it from your own file or a conversation, type it under Details. We then read that site for the phone, email and contact."]);
  if (has("website") && !has("phone") && searched) tips.push(["No phone on their site", "We read the company's own pages and found no number. A deep web search looks beyond the site and runs as part of Improve."]);
  if (has("website") && !has("contact_name")) tips.push(["No named contact", has("email") && SHARED_INBOX.test(a.email) ? "Only a shared inbox was found. An email to it reaches the firm, not a person. Improve looks for the owner or director on their pages." : "We look for the owner or director on the company's own pages."]);
  if (has("email") && SHARED_INBOX.test(a.email) && has("contact_name")) tips.push(["Shared inbox", "The email is a shared address. It works, but a message to a named person usually gets more replies. Check the email lines for this lead."]);
  if (v.phone?.state === "invalid") tips.push(["This number isn't usable", (v.phone.note ? v.phone.note + " " : "") + "Correct it under Details, or Improve to find another."]);
  else if (has("phone") && v.phone?.verified !== true) tips.push(["Number not confirmed", "Use Check & improve from the list. We check whether the number is real and live (1 credit per 5) and tag it when it matches the company's own website."]);
  if (v.email?.state === "invalid") tips.push(["This email will bounce", "The address failed our test. Correct it under Details, or Improve to find another."]);
  else if (has("email") && !GOOD_EMAIL.has(v.email?.state)) tips.push(["Email not confirmed", "Use Check & improve from the list. We test the address before you send, so it doesn't bounce."]);
  if (gaps.length && searched) tips.push(["If it stays incomplete", "Small firms often publish no contact details. You are charged only when we find something. You can also leave this company out of a campaign."]);
  return tips;
}
function TipsCard({ account }) {
  const tips = tipsFor(account);
  if (!tips.length) return null;
  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 12px", display: "grid", gap: 8, background: "rgba(245, 158, 11, .05)" }}>
      <div style={{ ...text, fontSize: 13.5, fontWeight: 600, color: C.ink, display: "flex", alignItems: "center", gap: 6 }}>
        <Lightbulb size={14} color="#B45309" /> How to get this to 100%
      </div>
      {tips.map(([title, body]) => (
        <div key={title} style={{ ...muted, fontSize: 12.5 }}><strong style={{ color: C.textInk }}>{title}.</strong> {body}</div>
      ))}
    </div>
  );
}

// The one button that finds what is missing about a company, with the steps and the most it can cost shown first.
const FIELD_NAMES = { website: "website", phone: "phone", email: "email", contact_name: "contact" };
function ImproveCard({ store, account }) {
  const credits = useLeadCredits();
  const state = store.improving[account.id];
  const busy = Boolean(store.researching[account.id]);
  const rates = credits?.rates || {};
  const webCost = rates.lead_lookup?.credits, deepCost = rates.google_deep_search?.credits;
  const most = (webCost || 0) + (deepCost || 0);
  const missing = ["website", "phone", "email", "contact_name"].filter((k) => !String(account[k] || "").trim());
  const dot = (st) => st === "done" ? ["#15803D", "✓"] : st === "fail" ? ["#B91C1C", "!"] : st === "skip" ? [C.slateLight, "–"] : st === "run" ? [C.ink, ""] : [C.border, ""];
  const steps = state?.steps || [
    { key: "records", label: "Check our own records", state: "idle", note: "Free" },
    { key: "web", label: "Search the web for details, people and sources", state: "idle", note: webCost == null ? "" : `${creditWord(webCost)}, only if something is found` },
    { key: "deep", label: "Deep web search for a phone or website", state: "idle", note: deepCost == null ? "Only if still missing" : `${creditWord(deepCost)}, only if still missing and found` },
    { key: "verify", label: "Check the phone, email and website", state: "idle", note: rates.lead_phone_check ? `${creditWord(rates.lead_phone_check.credits)} per ${rates.lead_phone_check.unit} checked` : "" },
  ];
  const r = state?.done ? state.result : null;
  const ended = account.verification?.verdict === "problem";
  const finished = steps.filter((st) => st.state === "done" || st.state === "skip" || st.state === "fail").length;
  const live = busy && state && !state.done;
  const running = steps.find((st) => st.state === "run");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {state ? (
        <div>
          <div className={`imp-bar${live ? " imp-bar--live" : ""}`} role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={finished}>
            <span style={{ width: `${Math.max(live ? 8 : 0, Math.round((finished / steps.length) * 100))}%` }} />
          </div>
          <div style={{ ...muted, fontSize: 12, marginTop: 4 }}>
            {live ? <span className="imp-dots">{running ? `${running.label}` : "Starting"}</span> : `Step ${finished} of ${steps.length} finished`}
          </div>
        </div>
      ) : null}
      {ended ? (
        <div role="note" style={{ ...text, fontSize: 12.5, color: C.red, background: C.redSoft, borderRadius: 8, padding: "8px 11px", lineHeight: 1.45 }}>
          This company has ended, so we don't search for its contact details. Anything found online would belong to a different business.
        </div>
      ) : null}
      <div style={{ ...muted, fontSize: 12.5 }}>
        {r ? (r.added.length ? `Added ${r.added.map((k) => FIELD_NAMES[k]).join(", ")}. New details are tagged above. Nothing you already had was changed.`
          : r.problem ? `It stopped: ${r.problem}` : "We searched our records and the web and found nothing more. Nothing was charged.")
          : missing.length ? `${missing.length} detail${missing.length === 1 ? " is" : "s are"} missing (${missing.map((k) => FIELD_NAMES[k]).join(", ")}). One button tries every source, cheapest first.`
            : "Every contact detail is filled in. You can still look for more people, emails and sources."}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {steps.map((st) => {
          const [color, mark] = dot(st.state);
          return (
            <div key={st.key} className={`imp-step imp-step--${st.state}`} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 6px", ...text, fontSize: 13, color: st.state === "skip" ? C.slateLight : C.textInk }}>
              <span aria-hidden className={st.state === "done" || st.state === "fail" ? "imp-pop" : ""} style={{ width: 18, height: 18, borderRadius: 9, border: `2px solid ${color}`, background: st.state === "done" || st.state === "fail" ? color : "transparent", color: "#fff", fontSize: 11, fontWeight: 700, display: "grid", placeItems: "center", flex: "none" }}>
                {st.state === "run" ? <Spinner size={11} /> : mark}
              </span>
              <span style={{ flex: 1 }}>{st.label}</span>
              <span key={st.note} className="imp-note" style={{ fontSize: 12, color: st.state === "fail" ? C.red : st.state === "done" && st.note.startsWith("Added") ? "#15803D" : C.slate }}>{st.note}</span>
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button type="button" className="ui-btn ui-btn--primary" disabled={busy || ended} onClick={() => store.improve(account.id, { again: Boolean(state?.done) })}
          title="Tries our records first (free), then the web, then a deep web search if a phone or website is still missing. You are charged only for what is found.">
          {busy ? <Spinner size={14} /> : <Sparkles size={14} />} {busy ? "Working…" : state?.done || account.researched_at ? "Improve again" : "Improve this company"}
        </button>
        <span style={{ ...muted, fontSize: 12 }}>
          {most ? `Most it can cost: ${creditWord(most)}. ` : ""}Charged only when something new is found.{credits ? ` You have ${credits.balance.toLocaleString()}.` : ""}
        </span>
      </div>
    </div>
  );
}

function EmptyState({ icon: Icon, title, body, children }) {
  return (
    <div className="ui-card" style={{ padding: "40px 24px", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 10 }}>
      <div style={{ width: 44, height: 44, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", background: "#8B5CF614", color: "#8B5CF6" }}>
        <Icon size={20} />
      </div>
      <div style={{ ...text, fontSize: 15, fontWeight: 600, color: C.ink, marginTop: 4 }}>{title}</div>
      <div style={{ ...muted, maxWidth: "46ch" }}>{body}</div>
      {children ? <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center", marginTop: 6 }}>{children}</div> : null}
    </div>
  );
}

function Loading({ store }) {
  if (store.error) return <div role="alert" style={{ ...muted, color: C.red }}>{store.error}</div>;
  return (
    <div className="ui-card" style={{ overflow: "hidden", position: "relative" }}>
      <TopBar />
      <TableSkeleton rows={8} cols={6} label="Loading your saved accounts" />
    </div>
  );
}

function SiteLink({ account }) {
  const d = account.domain || domainOf(account.website);
  if (!d) return null;
  return (
    <a href={account.website || `https://${d}`} target="_blank" rel="noreferrer" style={{ color: C.slate, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 3 }}>
      {d} <ExternalLink size={11} />
    </a>
  );
}

// ---------------------------------------------------------------- Saved Accounts
// Columns a person can hide from their own view of the table (kept in their browser; nothing is deleted).
const BUILT_IN_COLUMNS = [["phone", "Phone"], ["email", "Email"], ["contact", "Contact"], ["stage", "Stage"], ["quality", "Complete"], ["check", "Check"], ["website", "Website"], ["source", "Found by"]];
const ROLE_INBOXES = new Set(["info", "sales", "admin", "contact", "hello", "office", "enquiries", "enquiry", "support", "accounts", "mail", "team", "hr", "jobs", "careers", "marketing", "service", "bookings", "orders", "reception", "help", "general"]);

// What a row can honestly show for "Contact" and "Email": what is saved on the company first, then what its
// research found, so a researched company is never shown as empty while its dossier holds the details.
// A blank cell means two different things: we looked and found nothing, or nobody has looked yet.
export function wasLookedUp(a) {
  return Boolean(a?.researched_at || (a?.verification && a.verification.checked_at));
}

function NewTag() {
  return <span title="We found this: it was empty before" style={{ ...text, marginLeft: 6, fontSize: 10.5, fontWeight: 700, color: "#15803D", background: "#DCFCE7", borderRadius: 4, padding: "1px 5px" }}>NEW</span>;
}

function Empty({ a }) {
  return <span style={{ color: C.slateLight }}>{wasLookedUp(a) ? "Not found" : "Not checked yet"}</span>;
}

// A number saved on the company first, then what research found, so a researched company never looks empty.
export function phoneFor(a) {
  if (a.phone) return { text: a.phone, fromResearch: false };
  const r = a.research || {};
  const found = (r.phones || [])[0] || (r.team || []).map((t) => t.phone).find(Boolean) || (r.other_offices || []).map((o) => o.phone).find(Boolean);
  return found ? { text: found, fromResearch: true } : null;
}
// Was this field empty before we looked, and filled in by us?
export const isNew = (a, field) => Boolean(a.found?.filled?.some((f) => f.field === field));
export const foundCount = (a) => a.found?.new_count || 0;

const HOW_WORD = { web: "web search", check: "contact check" };
const FIELD_WORD = { website: "Website", phone: "Phone", email: "Email", contact_name: "Contact" };
const barColor = (p) => (p >= 75 ? "#16A34A" : p >= 50 ? "#D97706" : "#DC2626");

// How complete a company's contact details are (website, phone, email, contact), and what it was before we looked.
export function QualityBar({ found, wide = false }) {
  if (!found) return null;
  const { before_pct: before, after_pct: after } = found;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
      title={`${after}% of this company's contact details (website, phone, email, contact) are filled in.${before !== after ? ` It was ${before}% before we looked.` : ""}`}>
      <span style={{ width: wide ? 120 : 48, height: 6, borderRadius: 3, background: C.border, overflow: "hidden", display: "inline-block" }}>
        <span style={{ display: "block", height: "100%", width: `${after}%`, background: barColor(after) }} />
      </span>
      <span style={{ ...text, fontSize: 12, color: C.textInk, fontVariantNumeric: "tabular-nums" }}>{after}%</span>
      {before !== after ? <span style={{ ...text, fontSize: 11.5, color: C.slateLight }}>was {before}%</span> : null}
    </span>
  );
}

// A name from the user's own file columns (e.g. "Contact forename" + "Contact surname"), when it was not saved as the contact.
function fileContact(a) {
  const c = a.custom || {};
  const pick = (re) => Object.entries(c).find(([k, v]) => re.test(k) && String(v || "").trim());
  const first = pick(/fore?name|first/i), last = pick(/surname|last/i);
  return [first?.[1], last?.[1]].filter(Boolean).join(" ").trim();
}

// "What we found": every contact detail with where it came from -- yours, found by us, or still missing -- and how complete it is now.
function FoundSummary({ account }) {
  const f = account.found || { filled: [], extra: {}, had: [], before_pct: 0, after_pct: 0 };
  const looked = wasLookedUp(account);
  const extra = [["people", "people"], ["emails", "emails"], ["phones", "phone numbers"], ["socials", "social profiles"], ["offices", "other offices"]]
    .filter(([k]) => f.extra?.[k]).map(([k, label]) => `${f.extra[k]} ${label}`);
  const rows = [["website", "Website"], ["phone", "Phone"], ["email", "Email"], ["contact_name", "Contact"]].map(([k, label]) => {
    const made = (f.filled || []).find((x) => x.field === k);
    const value = (account[k] || "").trim();
    if (made && value) return { k, label, value, tone: "new", badge: `Found by us · ${HOW_WORD[made.how] || made.how}` };
    if (value) return { k, label, value, tone: "yours", badge: account.source === "import" ? "From your file" : account.source === "manual" ? "You added" : "From the search" };
    const hint = k === "contact_name" ? fileContact(account) : "";
    if (hint) return { k, label, value: hint, tone: "hint", badge: "In your file, not saved as the contact yet" };
    return { k, label, value: "", tone: "missing", badge: looked ? "Not found" : "Not checked yet" };
  });
  const tone = { new: ["#15803D", "#DCFCE7"], yours: [C.slate, "#F1F5F9"], hint: ["#92400E", "#FFFBEB"], missing: [C.slateLight, "#F8FAFC"] };
  const tried = [account.verification?.checked_at && `company check ${new Date(account.verification.checked_at).toLocaleDateString()}`,
    account.researched_at && `web look-up ${new Date(account.researched_at).toLocaleDateString()}`, account.registry && "our records"].filter(Boolean);
  const missing = rows.filter((r) => r.tone === "missing");
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ ...text, fontSize: 13.5, fontWeight: 600, color: C.ink, marginRight: "auto" }}>Contact details</div>
        <QualityBar found={f} wide />
      </div>
      <div style={{ ...text, fontSize: 12.5, color: C.slate }}>
        {sourceWords(account.source)}. {f.filled?.length ? `We have added ${f.filled.length} detail${f.filled.length === 1 ? "" : "s"} since.` : "We have not added anything yet."}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "90px minmax(0, 1fr) auto", gap: "6px 12px", alignItems: "center", ...text, fontSize: 13, color: C.textInk }}>
        {rows.map((r) => (
          <React.Fragment key={r.k}>
            <span style={{ color: C.slate }}>{r.label}</span>
            <span style={{ overflowWrap: "anywhere", color: r.value ? C.textInk : C.slateLight }}>{r.value || "—"}</span>
            <span style={{ fontSize: 11.5, fontWeight: 600, color: tone[r.tone][0], background: tone[r.tone][1], borderRadius: 4, padding: "2px 7px", whiteSpace: "nowrap" }}>{r.badge}</span>
          </React.Fragment>
        ))}
      </div>
      {extra.length ? <div style={{ ...text, fontSize: 12.5, color: C.textInk }}>Also found: {extra.join(", ")}. See the research below.</div> : null}
      <div style={{ ...text, fontSize: 12, color: C.slateLight }}>
        {tried.length ? `Checked: ${tried.join(", ")}.` : "Not checked yet."}
        {missing.length ? ` ${missing.length === 1 ? "One detail is" : `${missing.length} details are`} still missing${looked ? "" : ". Use Improve this company below to search for them"}.` : ""}
        {` The ${f.after_pct}% counts four details: website, phone, email and contact, 25% each.`}
      </div>
    </section>
  );
}

export function contactFor(a) {
  if (a.contact_name) return { text: a.contact_name, title: a.contact_title || "", fromResearch: false };
  const r = a.research || {};
  const person = (r.team || []).find((t) => t.name) || (r.people || []).find((t) => t.name);
  if (person) return { text: person.name, title: person.title || person.role || "", fromResearch: true };
  const named = (r.email_contacts || []).find((c) => c.name);
  if (named) return { text: named.name, title: "", fromResearch: true };
  const mailbox = [...(r.team || []).map((t) => t.email), ...(r.emails || [])].find((e) => /^[a-z]{2,}[._-][a-z]{2,}@/i.test(e || "") && !ROLE_INBOXES.has(String(e).split(/[._-]|@/)[0].toLowerCase()));
  if (mailbox) return { text: mailbox, title: "", fromResearch: true };
  return null;
}
export function emailFor(a) {
  if (a.email) return { text: a.email, fromResearch: false };
  const r = a.research || {};
  const found = (r.emails || [])[0] || (r.team || []).map((t) => t.email).find(Boolean);
  return found ? { text: found, fromResearch: true } : null;
}
const HIDDEN_KEY = "aivhub_accounts_hidden_columns";
const readHidden = () => {
  try { const v = JSON.parse(localStorage.getItem(HIDDEN_KEY) || "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; } catch { return []; }
};
// The user's own columns from imported files, in the order they first appear.
export function customColumns(accounts) {
  const seen = [];
  (accounts || []).forEach((a) => Object.keys(a.custom || {}).forEach((k) => { if (!seen.includes(k)) seen.push(k); }));
  return seen;
}

// Where a menu opens: just under its button, in the window, so the table's rounded edge never clips it.
function menuSpot(box, side) {
  const r = box.current ? box.current.getBoundingClientRect() : { bottom: 0, left: 0, right: 0 };
  return side === "right" ? { top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) } : { top: r.bottom + 4, left: Math.max(8, r.left) };
}

// The picker's headings, in the order a person thinks about a company: how to reach it, where it stands, what it is, then their own.
const COLUMN_GROUPS = [
  ["Reach them", (id) => ["phone", "email", "contact"].includes(id)],
  ["Where it stands", (id) => ["stage", "quality", "check"].includes(id)],
  ["The company", (id) => ["website", "source"].includes(id)],
  ["Your own columns", (id) => id.startsWith("c:")],
];

// Saved views: a name for a set of columns and a filter, kept in this browser. "Default view" is always there.
const VIEWS_KEY = "aivhub_accounts_views";
const readViews = () => {
  try { const v = JSON.parse(localStorage.getItem(VIEWS_KEY) || "[]"); return Array.isArray(v) ? v.filter((x) => x && typeof x.name === "string") : []; } catch { return []; }
};
function ViewsMenu({ current, onApply, onToast }) {
  const [open, setOpen] = useState(false);
  const [views, setViews] = useState(readViews);
  const [active, setActive] = useState("");
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    window.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); window.removeEventListener("keydown", esc); };
  }, [open]);
  const keep = (next) => { setViews(next); try { localStorage.setItem(VIEWS_KEY, JSON.stringify(next)); } catch { /* the views just are not remembered */ } };
  const saveCurrent = async () => {
    const name = await askText({ title: "Save this view", label: "A name for these columns and this filter, for example Ready to call", confirm: "Save view", maxLength: 40 });
    if (!name) return;
    const n = name.trim();
    keep([{ name: n, hidden: current.hidden, scope: current.scope }, ...views.filter((v) => v.name.toLowerCase() !== n.toLowerCase())].slice(0, 20));
    setActive(n);
    setOpen(false);
    onToast(`Saved the view ${n}.`);
  };
  return (
    <div ref={box} style={{ position: "relative" }}>
      <button type="button" title="Switch to a saved set of columns and filter, or save this one" className="ui-btn ui-btn--ghost ui-btn--sm" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Eye size={14} /> {active || "Default view"} <ChevronDown size={13} />
      </button>
      {open ? (
        <div role="menu" className="ui-card" style={{ position: "fixed", ...menuSpot(box, "left"), zIndex: 60, minWidth: 230, maxHeight: "min(420px, 60vh)", overflowY: "auto", padding: 6, boxShadow: "0 12px 32px rgba(20,24,40,.16)" }}>
          {[{ name: "Default view", hidden: [], scope: "all" }, ...views].map((v) => (
            <div key={v.name} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <button type="button" role="menuitem" className="ui-btn ui-btn--ghost ui-btn--sm" style={{ flex: 1, justifyContent: "flex-start", fontWeight: (active || "Default view") === v.name ? 700 : 400 }}
                onClick={() => { onApply(v); setActive(v.name === "Default view" ? "" : v.name); setOpen(false); }}>{v.name}</button>
              {v.name !== "Default view" ? (
                <button type="button" className="ui-icon-btn" aria-label={`Delete the view ${v.name}`} title="Delete this view" onClick={() => { keep(views.filter((x) => x.name !== v.name)); if (active === v.name) setActive(""); }}><X size={13} /></button>
              ) : null}
            </div>
          ))}
          <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 4, paddingTop: 4 }}>
            <button type="button" role="menuitem" className="ui-btn ui-btn--ghost ui-btn--sm" style={{ width: "100%", justifyContent: "flex-start" }} onClick={saveCurrent}><Plus size={13} /> Save as new view</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ColumnsMenu({ columns, hidden, onToggle, onShowAll }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    window.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); window.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div ref={box} style={{ position: "relative" }}>
      <button type="button" title="Choose which columns to show" className="ui-btn ui-btn--ghost ui-btn--sm" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Columns3 size={14} /> Add or hide columns{hidden.length ? ` (${hidden.length} hidden)` : ""}
      </button>
      {open ? (
        <div role="menu" className="ui-card" style={{ position: "fixed", ...menuSpot(box, "right"), zIndex: 60, minWidth: 220, maxHeight: "min(420px, 60vh)", overflowY: "auto", padding: 8, boxShadow: "0 8px 24px rgba(0,0,0,.14)" }}>
          <div style={{ ...muted, fontSize: 12, padding: "2px 6px 6px" }}>Tick the columns you want to see. This only changes your view.</div>
          {COLUMN_GROUPS.map(([heading, test]) => {
            const items = columns.filter(([id]) => test(id));
            if (!items.length) return null;
            return (
              <div key={heading}>
                <div style={{ ...text, fontSize: 11, fontWeight: 600, color: C.slate, textTransform: "uppercase", letterSpacing: ".04em", padding: "8px 6px 2px" }}>{heading}</div>
                {items.map(([id, label]) => (
                  <label key={id} style={{ ...text, fontSize: 13, display: "flex", alignItems: "center", gap: 8, padding: "5px 6px", cursor: "pointer" }}>
                    <input type="checkbox" checked={!hidden.includes(id)} onChange={() => onToggle(id)} /> {label}
                  </label>
                ))}
              </div>
            );
          })}
          {hidden.length ? (
            <button title="Bring back every hidden column" type="button" className="ui-btn ui-btn--ghost ui-btn--sm" style={{ marginTop: 4 }} onClick={onShowAll}>Show all</button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export const openFixes = (a) => ((a.verification || {}).fixes || []).filter((f) => f.kind === "fix" && !f.applied);
const GOOD_EMAIL = new Set(["ok", "verified", "found"]);
const hasProblem = (a) => a.verification?.verdict === "problem" || a.verification?.email?.state === "invalid";
// Where a company stands for emailing: the one answer the list shows and filters by.
export function readiness(a) {
  if (openFixes(a).length) return "fixes";
  if (hasProblem(a)) return "attention";
  if (emailFor(a)?.text && GOOD_EMAIL.has(a.verification?.email?.state)) return "ready";
  if (!emailFor(a)?.text && wasLookedUp(a)) return "noemail";
  return "other";
}
const ACCOUNT_CHIPS = [
  ["all", "All", () => true, "Every company in this list"],
  ["new", "New data found", (a) => foundCount(a) > 0, "Companies where we filled in a blank or found extra people, emails or phones"],
  ["ready", "Ready to email", (a) => readiness(a) === "ready", "Has an email that passed the checks"],
  ["fixes", "Fixes to review", (a) => readiness(a) === "fixes", "We found a better value than the one you had. Nothing changes until you accept it"],
  ["attention", "Needs attention", (a) => readiness(a) === "attention", "The company looks closed, or its email can't receive mail"],
  ["noemail", "No email found", (a) => readiness(a) === "noemail", "We looked and found no email"],
];
const VERDICT_TIPS = {
  verified: "Confirmed active by the official register or our records",
  looks_ok: "Nothing wrong found, but no register confirmed it",
  problem: "Closed or dissolved, or its website or email doesn't work",
  not_found: "We found no record of this company",
  unclear: "The check couldn't finish for these",
};

const ACCOUNT_PAGE_SIZES = [10, 25, 50, 100];

export function AccountsView({ store, listsStore, onOpen, onAdd, onGo, onCampaign, scopeIds = null, listId = "" }) {
  const [filter, setFilter] = useState("");
  const [scope, setScope] = useState("all");
  const [pageSize, setPageSize] = useState(() => {
    try { const n = Number(localStorage.getItem("aivhub_accounts_page_size")); return ACCOUNT_PAGE_SIZES.includes(n) ? n : 100; } catch (_) { return 25; }
  });
  const [pageNo, setPageNo] = useState(0);
  useEffect(() => { setPageNo(0); }, [filter, scope, listId]);
  const [picked, setPicked] = useState(() => new Set()); // ids ticked for "Check companies"
  const [checking, setChecking] = useState(null); // { ids, pendingOnly } while the cost box is open
  const [listing, setListing] = useState(false); // the Add to list box is open
  const [hidden, setHidden] = useState(readHidden); // columns this person chose not to see
  const check = useCompanyCheck({ onToast: store.toast, reload: store.reload });
  const locked = useLocked();
  const call = useCallDialog(store.toast);
  const [extra, setExtra] = useState({}); // score, warm and call history per company, from the connections view
  useEffect(() => {
    let live = true;
    api.getConnectionLeads().then((r) => { if (live) setExtra(r.leads || {}); }).catch(() => {});
    return () => { live = false; };
  }, [store.accounts]);
  if (store.loading || (store.error && !store.accounts.length)) return <Loading store={store} />;
  if (!store.accounts.length) {
    return (
      <EmptyState icon={Building2} title="No saved accounts yet" body="Find companies with AI Lead Scout, import a spreadsheet, or add one by hand.">
        <button title="Search the company register for new companies" type="button" className="ui-btn ui-btn--primary" onClick={() => onGo("find_leads")}><Search size={15} /> Find companies</button>
        <button title="Type in one company yourself" type="button" className="ui-btn ui-btn--ghost" onClick={onAdd}><Plus size={15} /> Add by hand</button>
      </EmptyState>
    );
  }
  const base = scopeIds ? store.accounts.filter((a) => scopeIds.has(a.id)) : store.accounts; // the list being looked at, or every company
  const own = customColumns(base);
  const allColumns = [...BUILT_IN_COLUMNS, ...own.map((n) => [`c:${n}`, n])];
  const saveHidden = (next) => {
    setHidden(next);
    try { localStorage.setItem(HIDDEN_KEY, JSON.stringify(next)); } catch { /* the choice just isn't remembered */ }
  };
  const toggleColumn = (id) => saveHidden(hidden.includes(id) ? hidden.filter((x) => x !== id) : [...hidden, id]);
  const showing = (id) => !hidden.includes(id);
  const shownOwn = own.filter((n) => showing(`c:${n}`));
  const columnCount = 2 + ["phone", "email", "contact", "stage", "quality", "check", "website", "source"].filter(showing).length + shownOwn.length + 1;
  const q = filter.trim().toLowerCase();
  // Verdict filters appear once some companies have been checked.
  const verdictChips = VERDICT_ORDER
    .map((k) => [`v_${k}`, VERDICTS[k].label, (a) => a.verification?.verdict === k])
    .filter(([, , pred]) => base.some(pred))
    .map(([id, label, pred]) => [id, `${label} ${base.filter(pred).length}`, pred, VERDICT_TIPS[id.slice(2)]]);
  const historyChips = [
    ["h_never", "Never called", (a) => extra[a.id]?.history === "never", "No call has been made to this company"],
    ["h_no_answer", "Called, no answer", (a) => extra[a.id]?.history === "no_answer", "Called, but nobody picked up or it went to voicemail"],
    ["h_interested", "Interested", (a) => extra[a.id]?.history === "interested", "Spoke with them and they showed interest"],
    ["h_recent", "Contacted recently", (a) => extra[a.id]?.history === "recent", "Called within your re-contact gap"],
    ["h_warm", "Warm", (a) => Boolean(extra[a.id]?.warm), "Opened your emails or engaged with your posts"],
  ].filter(([id, , pred]) => id === "h_never" || base.some(pred))
    .map(([id, label, pred, tip]) => [id, `${label} ${base.filter(pred).length}`, pred, tip]);
  const chips = [...ACCOUNT_CHIPS.map(([id, label, pred, tip]) => [id, `${label} ${base.filter(pred).length}`, pred, tip]), ...historyChips, ...verdictChips];
  const scopePred = (chips.find(([id]) => id === scope) || ACCOUNT_CHIPS[0])[2];
  const shown = base
    .filter(scopePred)
    .filter((a) => !q || [a.name, a.domain, a.contact_name, a.industry, a.region].some((v) => String(v || "").toLowerCase().includes(q)));
  const shownIds = shown.map((a) => a.id);
  const lastPage = Math.max(0, Math.ceil(shown.length / pageSize) - 1);
  const page = Math.min(pageNo, lastPage);
  const paged = shown.slice(page * pageSize, (page + 1) * pageSize);
  const pageIds = paged.map((a) => a.id);
  const allShownPicked = pageIds.length > 0 && pageIds.every((id) => picked.has(id));
  const allMatchingPicked = shownIds.every((id) => picked.has(id));
  const pickedIds = base.filter((a) => picked.has(a.id)).map((a) => a.id); // companies removed since are dropped
  const toggle = (id) => setPicked((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const pendingCount = base.filter((a) => a.verification?.pending_registry).length;
  const fixIds = base.filter((a) => openFixes(a).length).map((a) => a.id);
  const stats = [
    ["Companies", base.length, "How many companies are in this list"],
    ["Ready to email", base.filter((a) => readiness(a) === "ready").length, "Companies with an email that passed the checks"],
    ["Fixes to review", fixIds.length, "Companies where we found a better value than the one you had"],
    ["Needs attention", base.filter((a) => readiness(a) === "attention").length, "Closed companies, or emails that can't receive mail"],
  ];
  // Takes companies out of the list being looked at (one or many). They stay in your account and in any other list.
  const removeFromList = async (ids) => {
    if (!(await askConfirm({ title: `Remove ${ids.length.toLocaleString()} ${ids.length === 1 ? "company" : "companies"} from this list?`, body: `${ids.length === 1 ? "It stays" : "They stay"} in your account and in your other lists.`, confirm: "Remove", danger: true }))) return;
    try {
      await api.updateLeadList(listId, { remove: ids });
      await listsStore.reload();
      setPicked((prev) => { const next = new Set(prev); ids.forEach((i) => next.delete(i)); return next; });
      store.toast(`Removed ${ids.length.toLocaleString()} ${ids.length === 1 ? "company" : "companies"} from the list.`);
    } catch (e) {
      store.toast(e.message || "Couldn't remove them.");
    }
  };
  // The ticked companies become a list of their own, and the campaign is started on it.
  const startCampaign = async () => {
    const withEmail = pickedIds.filter((id) => emailFor(base.find((a) => a.id === id) || {})?.text);
    if (!withEmail.length) { store.toast("None of the ticked companies has an email yet. Use Check & improve first."); return; }
    const name = await askText({ title: `Start a campaign on ${withEmail.length.toLocaleString()} ${withEmail.length === 1 ? "company" : "companies"}`, label: "Name the list they go in", initial: `Campaign ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`, confirm: "Continue", maxLength: 80 });
    if (!name) return;
    try {
      const r = await api.createLeadList(name.trim(), withEmail);
      await listsStore.reload();
      onCampaign(r.list.id);
    } catch (e) {
      store.toast(e.message || "Couldn't start it.");
    }
  };
  const acceptFixes = async (ids, fields) => {
    try {
      const r = await api.acceptCheckFixes(ids, fields);
      await store.reload();
      store.toast(r.applied ? `Applied ${r.applied} ${r.applied === 1 ? "fix" : "fixes"}.` : "Nothing to apply.");
    } catch (e) {
      store.toast(e.message || "Couldn't apply the fixes.");
    }
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="grid-2-narrow" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 }}>
        {stats.map(([label, n, tip]) => (
          <div key={label} className="ui-card" title={tip} style={{ padding: "12px 16px" }}>
            <div style={{ ...muted, fontSize: 12.5 }}>{label}</div>
            <div style={{ ...text, fontSize: 22, fontWeight: 600, color: C.ink, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>{n}</div>
          </div>
        ))}
      </div>
      <CheckProgress check={check} pendingCount={pendingCount} onFilter={(k) => setScope(`v_${k}`)}
        onRecheck={() => setChecking({ ids: base.filter((a) => a.verification?.pending_registry).map((a) => a.id), pendingOnly: true })} />
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {chips.map(([id, label, , tip]) => (
          <button key={id} type="button" onClick={() => setScope(id)} title={tip}
            className={`ui-btn ui-btn--sm ${scope === id ? "ui-btn--primary" : "ui-btn--ghost"}`}>
            {label}
          </button>
        ))}
      </div>
      <div className="ui-card" style={{ overflow: "hidden" }}>
        <div style={{ padding: "10px 12px", borderBottom: `1px solid ${C.border}`, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input className="ui-input" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by name, website, contact or place" aria-label="Filter saved accounts" style={{ width: "100%", maxWidth: 360 }} />
          <span style={{ flex: 1 }} />
          <span style={{ ...muted, fontSize: 12.5 }}>{pickedIds.length ? `${pickedIds.length.toLocaleString()} selected` : "Tick companies to enrich or list them"}</span>
          {fixIds.length ? (
            <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" title="Apply every suggested fix in this list. The value you had is kept in the company's check details"
              onClick={async () => { if (await askConfirm({ title: `Apply ${fixIds.length.toLocaleString()} ${fixIds.length === 1 ? "company's" : "companies'"} suggested fixes?`, body: "The values you had stay noted in each company's check details.", confirm: "Apply fixes" })) acceptFixes(fixIds); }}>
              Accept all fixes ({fixIds.length.toLocaleString()})
            </button>
          ) : null}
          <ViewsMenu current={{ hidden, scope }} onToast={store.toast} onApply={(v) => { saveHidden(v.hidden || []); setScope(chips.some(([id]) => id === v.scope) ? v.scope : "all"); }} />
          <ColumnsMenu columns={allColumns} hidden={hidden} onToggle={toggleColumn} onShowAll={() => saveHidden([])} />
          {listId ? (
            <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" disabled={!pickedIds.length || pickedIds.some((i) => locked.has(i))} onClick={() => removeFromList(pickedIds)}
              title={pickedIds.some((i) => locked.has(i)) ? LOCK_TIP : "Take the ticked companies out of this list"}>
              Remove from list
            </button>
          ) : null}
          <CallButton label={`Call ${pickedIds.length || ""}`.trim()} lockedLabel="Call · add Voice" disabled={!pickedIds.length}
            onClick={() => call.open({ kind: "selected", ids: pickedIds, name: `${pickedIds.length} selected` })}
            onLocked={() => call.open({ kind: "selected", ids: pickedIds, name: `${pickedIds.length} selected` }, true)} />
          {onCampaign ? (
            <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" disabled={!pickedIds.length || !listsStore} title="Put the ticked companies in a list and start an email campaign on it" onClick={startCampaign}>
              <Megaphone size={14} /> Email campaign
            </button>
          ) : null}
          <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" disabled={!pickedIds.length || !listsStore} onClick={() => setListing(true)}
            title="Group these companies in a named list, ready for a campaign">
            Add to list
          </button>
          <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" disabled={!pickedIds.length || check.job?.status === "running"}
            title="Correct and complete these companies: our records, the company registers, the web, and missing emails"
            onClick={() => setChecking({ ids: pickedIds, pendingOnly: false })}>
            <ShieldCheck size={14} /> Check & improve
          </button>
        </div>
        {allShownPicked && !(allMatchingPicked && shownIds.length === base.length) && shownIds.length > pageIds.length ? (
          <div style={{ ...muted, padding: "6px 12px", background: C.paperSoft, borderBottom: `1px solid ${C.border}` }}>
            {pageIds.length.toLocaleString()} on this page are selected.{" "}
            <button title="Tick every company in this list" type="button" onClick={() => setPicked(new Set(shown.map((a) => a.id)))} style={{ ...text, background: "none", border: "none", padding: 0, color: "var(--ui-accent)", cursor: "pointer", fontSize: 13, textDecoration: "underline" }}>
              Select all {shownIds.length.toLocaleString()} companies
            </button>
          </div>
        ) : null}
        <div className="ui-scroll" style={{ overflowX: "auto" }}>
          <table className="ui-table acc-stick" style={{ minWidth: 520 + 120 * (columnCount - 3) }}>
            <thead>
              <tr>
                <th style={{ width: 1 }}>
                  <input type="checkbox" checked={allShownPicked} onChange={() => setPicked(allShownPicked ? new Set() : new Set(pageIds))} aria-label="Select all companies on this page" />
                </th>
                <th>Company</th>
                {showing("phone") ? <th title="The number you saved, or one research found. A tick means the phone network confirmed it">Phone</th> : null}
                {showing("email") ? <th title="The email you saved, or one research found">Email</th> : null}
                {showing("contact") ? <th title="The person to write to">Contact</th> : null}
                {showing("stage") ? <th title="Where this company is in your journey with them, and how likely it is to answer">Stage</th> : null}
                {showing("quality") ? <th title="How much of the website, phone, email and contact is filled in">Complete</th> : null}
                {showing("check") ? <th title="Whether the company, its website and its email look real">Check</th> : null}
                {showing("website") ? <th title="The company's own website">Website</th> : null}
                {showing("source") ? <th title="Where this company came from">Found by</th> : null}
                {shownOwn.map((n) => <th key={n} style={{ whiteSpace: "nowrap" }}>{n}</th>)}
                <th style={{ width: 1 }} aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {paged.map((a) => (
                <tr key={a.id} style={{ background: a.verification?.verdict === "problem" ? C.redSoft : "#fff" }}>
                  <td><input type="checkbox" checked={picked.has(a.id)} onChange={() => toggle(a.id)} aria-label={`Select ${a.name}`} /></td>
                  <td>
                    <button type="button" title="Open this company's details" onClick={() => onOpen(a)} style={{ ...text, all: "unset", cursor: "pointer", fontWeight: 600, color: C.ink, fontSize: 13.5 }}>{a.name}</button>
                  </td>
                  {showing("phone") ? (
                    <td style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                      {phoneFor(a) ? (
                        <>
                          {phoneFor(a).text}
                          {a.verification?.phone?.verified === true ? <span title={a.verification.phone.note} style={{ color: "#16A34A" }}> ✓</span> : null}
                          {a.verification?.phone?.state === "invalid" ? <span title={a.verification.phone.note || "Not a usable number"} style={{ color: C.red }}> ✕</span> : null}
                          {phoneFor(a).fromResearch ? <span style={{ color: C.slateLight, fontSize: 11.5 }}> · from research</span> : null}
                          {isNew(a, "phone") ? <NewTag /> : null}
                        </>
                      ) : <Empty a={a} />}
                    </td>
                  ) : null}
                  {showing("email") ? <td style={{ maxWidth: 240, whiteSpace: "nowrap" }} title={emailFor(a)?.text || ""}>
                    {emailFor(a) ? (
                      <div style={{ display: "flex", alignItems: "center", minWidth: 0 }}>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{emailFor(a).text}</span>
                        {emailFor(a).fromResearch ? <span style={{ color: C.slateLight, fontSize: 11.5, flex: "none" }}>&nbsp;· from research</span> : null}
                        {isNew(a, "email") ? <span style={{ flex: "none" }}><NewTag /></span> : null}
                      </div>
                    ) : <Empty a={a} />}</td> : null}
                  {showing("contact") ? (
                    <td>
                      {contactFor(a)
                        ? <>{contactFor(a).text}{contactFor(a).title ? <span style={{ color: C.slate }}> · {contactFor(a).title}</span> : null}
                          {contactFor(a).fromResearch ? <span style={{ color: C.slateLight, fontSize: 11.5 }}> · from research</span> : null}</>
                        : <Empty a={a} />}
                    </td>
                  ) : null}
                  {showing("stage") ? (
                    <td style={{ whiteSpace: "nowrap" }}>
                      <StageBadge stage={a.connection?.stage || "new"} />
                      {extra[a.id]?.warm ? <span title="Opened your emails or engaged with your posts" style={{ ...text, fontSize: 11.5, color: C.amber, marginLeft: 6 }}>Warm</span> : null}
                      {a.connection?.last_call_outcome ? <div style={{ ...muted, fontSize: 11.5 }}>Last call: {String(a.connection.last_call_outcome).replace(/_/g, " ")}</div> : null}
                    </td>
                  ) : null}
                  {showing("quality") ? <td>{wasLookedUp(a) ? <QualityBar found={a.found} /> : <span style={{ color: C.slateLight }}>—</span>}</td> : null}
                  {showing("check") ? (
                    <td>
                      <VerdictBadge verification={a.verification} withWhy />
                      {openFixes(a).map((f) => (
                        <div key={f.field} style={{ fontSize: 12, marginTop: 3, color: C.textInk }} title={f.why}>
                          <span style={{ color: C.slate }}>{f.field}:</span> {f.from || "—"} → <strong>{f.to}</strong>{" "}
                          <button title="Use the suggested value in place of the one you entered. Your original is kept beside it" type="button" className="ui-link" onClick={() => acceptFixes([a.id], [f.field])}>Accept</button>
                        </div>
                      ))}
                    </td>
                  ) : null}
                  {showing("website") ? <td style={{ whiteSpace: "nowrap", fontSize: 12.5 }}><SiteLink account={a} /></td> : null}
                  {showing("source") ? <td style={{ color: C.slate }}>{SOURCE_LABEL[a.source] || "Added by hand"}</td> : null}
                  {shownOwn.map((n) => (
                    <td key={n} title={a.custom?.[n] || ""} style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {a.custom?.[n] || <span style={{ color: C.slateLight }}>—</span>}
                    </td>
                  ))}
                  <td style={{ textAlign: "right" }}>
                    <span style={{ display: "inline-flex", gap: 6 }}>
                      <CallButton label="Call" lockedLabel="Call" variant="ghost" disabled={!a.connection?.can_call}
                        title={a.connection?.can_call ? "Have your AI caller phone them" : ({ no_phone: "No phone number yet", failed_check: "The number failed the check", do_not_contact: "On your do-not-contact list" }[a.connection?.blocked_reason] || "Can't be called")}
                        onClick={() => call.open({ kind: "one", id: a.id, name: a.name })} onLocked={() => call.open({ kind: "one", id: a.id, name: a.name }, true)} />
                      <button title="Open this company's full details" type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => onOpen(a)}>
                        {store.researching[a.id] ? <><Spinner size={13} /> Working…</> : "Open"}
                      </button>
                      {listId ? <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" disabled={locked.has(a.id)} onClick={() => removeFromList([a.id])} title={locked.has(a.id) ? LOCK_TIP : "Remove from this list"}>Remove</button> : null}
                    </span>
                  </td>
                </tr>
              ))}
              {!shown.length ? <tr><td colSpan={columnCount} style={{ color: C.slate }}>Nothing matches “{filter}”.</td></tr> : null}
              <tr><td colSpan={columnCount} style={{ padding: "6px 8px" }}>
                <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" title="Type in one more company yourself" onClick={onAdd}><Plus size={14} /> Add a row</button>
              </td></tr>
            </tbody>
          </table>
        </div>
        {shown.length > ACCOUNT_PAGE_SIZES[0] ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "10px 14px", borderTop: `1px solid ${C.borderLight}` }}>
            <span style={{ ...text, fontSize: 12.5, color: C.slate, fontVariantNumeric: "tabular-nums" }}>
              {(page * pageSize + 1).toLocaleString()}–{Math.min((page + 1) * pageSize, shown.length).toLocaleString()} of {shown.length.toLocaleString()}
            </span>
            <label style={{ ...text, display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: C.slate }}>
              Rows per page
              <select className="ui-input" aria-label="Rows per page" value={pageSize} style={{ height: 30, padding: "0 6px", width: "auto" }}
                onChange={(e) => { const n = Number(e.target.value); setPageSize(n); setPageNo(0); try { localStorage.setItem("aivhub_accounts_page_size", String(n)); } catch (_) { /* just not remembered */ } }}>
                {ACCOUNT_PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <div style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 8 }}>
              <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" disabled={page === 0} onClick={() => setPageNo(page - 1)} aria-label="Previous page">‹ Previous</button>
              <span style={{ ...text, fontSize: 12.5, color: C.slate, fontVariantNumeric: "tabular-nums" }}>Page {page + 1} of {lastPage + 1}</span>
              <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" disabled={page >= lastPage} onClick={() => setPageNo(page + 1)} aria-label="Next page">Next ›</button>
            </div>
          </div>
        ) : null}
      </div>
      {checking ? (
        <CheckDialog ids={checking.ids} pendingOnly={checking.pendingOnly} onStart={check.start} onClose={() => setChecking(null)} />
      ) : null}
      {listing && listsStore ? <AddToListDialog ids={pickedIds} listsStore={listsStore} onToast={store.toast} onClose={() => setListing(false)} /> : null}
      {call.dialog}
    </div>
  );
}

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
                  {(p.phone || p.email) ? <span style={{ color: C.slate }}> — {[p.phone, p.email].filter(Boolean).join(" · ")}</span> : null}
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
        <span style={{ ...muted, flex: "1 1 220px" }}>Nothing researched yet. Use Improve above and what is found appears here: people, phones, emails and sources.</span>
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
            {r.phones.map((v) => <span key={v} style={{ ...text, fontSize: 13.5, color: C.textInk, fontVariantNumeric: "tabular-nums" }}>{v}</span>)}
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
            {r.other_offices.map((o) => <span key={o.phone || o.email}><span style={{ color: C.slate }}>{o.town}:</span> {o.phone || o.email}</span>)}
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

export function AccountPanel({ account, store, onClose }) {
  const live = store.accounts.find((a) => a.id === account.id) || account;
  const lockedIds = useLocked();
  const inCheck = lockedIds.has(live.id);
  const [form, setForm] = useState(() => Object.fromEntries([...ACCOUNT_FIELDS.map(([k]) => [k, live[k] || ""]), ["notes", live.notes || ""]]));
  const [confirmRemove, setConfirmRemove] = useState(false);
  const changed = [...ACCOUNT_FIELDS.map(([k]) => k), "notes"].some((k) => (form[k] || "") !== (live[k] || ""));
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  // Research can fill empty fields: show what it found in any field not being edited.
  const lastResearch = useRef(live.researched_at);
  useEffect(() => {
    if (live.researched_at === lastResearch.current) return;
    lastResearch.current = live.researched_at;
    setForm((f) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v || live[k] || ""])));
  }, [live]);

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,18,28,0.45)", zIndex: 1000, display: "flex", justifyContent: "flex-end" }}>
      <div role="dialog" aria-label={live.name} onClick={(e) => e.stopPropagation()} className="ui-scroll"
        style={{ width: "min(100%, 520px)", height: "100%", background: "#fff", overflowY: "auto", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "16px 16px 12px 20px", borderBottom: `1px solid ${C.border}`, position: "sticky", top: 0, background: "#fff", zIndex: 1 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ ...text, fontSize: 16, fontWeight: 600, color: C.ink }}>{live.name}</div>
            <div style={{ ...muted, fontSize: 12.5, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <SiteLink account={live} /><span title="How this company got into your account">{sourceWords(live.source)}</span>
            </div>
          </div>
          <button type="button" className="ui-icon-btn" aria-label="Close" onClick={onClose}><X size={18} /></button>
        </div>
        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 20 }}>
          <EndedBanner account={live} />
          {["problem", "not_found"].includes(live.verification?.verdict) ? <CheckDetails account={live} /> : null}
          <FoundSummary account={live} />
          <DetailChecks account={live} />
          {["problem", "not_found"].includes(live.verification?.verdict) ? null : <CheckDetails account={live} />}
          {Object.keys(live.custom || {}).length ? (
            <section style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ ...text, fontSize: 13.5, fontWeight: 600, color: C.ink }}>From your file</div>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 2fr)", gap: "4px 12px", ...text, fontSize: 13 }}>
                {Object.entries(live.custom).map(([k, v]) => (
                  <React.Fragment key={k}>
                    <span style={{ color: C.slate, overflowWrap: "anywhere" }}>{k}</span>
                    <span style={{ color: C.textInk, overflowWrap: "anywhere" }}>{v || "—"}</span>
                  </React.Fragment>
                ))}
              </div>
            </section>
          ) : null}
          <LeadActivity account={live} store={store} />
          <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ ...text, fontSize: 13.5, fontWeight: 600, color: C.ink }}>Improve this company</div>
            <ImproveCard store={store} account={live} />
            <TipsCard account={live} />
            {store.researching[live.id] && store.researching[live.id] !== "improve" ? (
              <SearchStatus title={store.researching[live.id] === "deep" ? `Deep web search on ${live.name}` : store.researching[live.id] === "quick" ? `Checking our records for ${live.name}` : `Looking up ${live.name}`}
                detail={store.researching[live.id] === "quick" ? "Looking only at our own records. This is free." : "Reading public pages for its people, phone numbers and sources. A credit is used only if something is found."}
                cancelLabel="Stop waiting" onCancel={() => store.stopWaiting(live.id)} />
            ) : null}
            <div style={{ ...text, fontSize: 13.5, fontWeight: 600, color: C.ink, marginTop: 6 }}>Research</div>
            <Dossier account={live} store={store} />
          </section>
          <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ ...text, fontSize: 13.5, fontWeight: 600, color: C.ink }}>Details</div>
            <AccountFieldGrid fields={ACCOUNT_FIELDS} form={form} setForm={setForm} minWidth={200} />
            <label style={{ display: "flex", flexDirection: "column", gap: 4, ...text, fontSize: 12.5, color: C.slate }}>
              Notes
              <textarea className="ui-input" rows={3} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} style={{ height: "auto", padding: "8px 10px", resize: "vertical", lineHeight: 1.5 }} />
            </label>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <button title="Save the changes to this company" type="button" className="ui-btn ui-btn--primary" disabled={!changed || !form.name.trim()}
                onClick={async () => { if (await store.update(live.id, form)) onClose(); }}>Save changes</button>
              <button type="button" className="ui-btn ui-btn--ghost" disabled={!changed} title="Put every field back to what is saved"
                onClick={() => setForm(Object.fromEntries([...ACCOUNT_FIELDS.map(([k]) => [k, live[k] || ""]), ["notes", live.notes || ""]]))}>Reset</button>
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
          </section>
        </div>
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

// ---------------------------------------------------------------- Import
// Same logic as the Voice plugin's file import (CallingWorkspace.jsx: parseSpreadsheetFile) --
// every sheet of a workbook is read, not just the first, and .json is accepted alongside
// .xlsx/.xls/.ods/.csv/.tsv/.txt, so people can bring in whatever file they already have.
async function parseImportFile(file) {
  const name = file.name.toLowerCase();
  if (/\.(csv|tsv|txt)$/.test(name)) {
    const parsed = await new Promise((resolve, reject) => Papa.parse(file, { header: true, skipEmptyLines: "greedy", complete: resolve, error: reject }));
    return { sheets: { CSV: parsed.data || [] }, sheetNames: ["CSV"] };
  }
  if (/\.json$/.test(name)) {
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch (_) {
      throw new Error("Could not read that JSON file.");
    }
    const records = Array.isArray(data) ? data
      : Array.isArray(data.rows) ? data.rows
      : Array.isArray(data.contacts) ? data.contacts
      : Array.isArray(data.companies) ? data.companies
      : Array.isArray(data.accounts) ? data.accounts
      : [];
    const objs = records.filter((r) => r && typeof r === "object");
    if (!objs.length) throw new Error("That JSON file has no list of companies.");
    return { sheets: { JSON: objs }, sheetNames: ["JSON"] };
  }
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const sheetNames = wb.SheetNames || [];
  if (!sheetNames.length) throw new Error("That spreadsheet has no sheets.");
  const sheets = {};
  for (const sName of sheetNames) sheets[sName] = XLSX.utils.sheet_to_json(wb.Sheets[sName], { defval: "" });
  return { sheets, sheetNames };
}

const IMPORT_BATCH = 500;

// What an import did, in plain terms, and what to do next.
function ImportReport({ done, onGo, onClose, onToast }) {
  const call = useCallDialog(onToast);
  const row = (n, label, tip) => (n ? <div title={tip} style={{ display: "flex", gap: 8 }}><strong style={{ minWidth: 44, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{n.toLocaleString()}</strong><span>{label}</span></div> : null);
  const gaps = [["phone number", done.blanks.phone], ["email", done.blanks.email], ["website", done.blanks.website]].filter(([, n]) => n);
  return (
    <div className="ui-card" role="status" style={{ padding: 16, textAlign: "left", display: "flex", flexDirection: "column", gap: 8, maxWidth: 560, width: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Check size={16} color={C.green} />
        <div style={{ ...text, fontSize: 14, fontWeight: 600, color: C.ink, marginRight: "auto" }}>
          Imported {done.file ? `${done.file} ` : ""}into the list {done.list?.name || "Unsorted"}
        </div>
        <button type="button" className="ui-icon-btn" aria-label="Dismiss" onClick={onClose}><X size={16} /></button>
      </div>
      <div style={{ ...text, fontSize: 13, color: C.textInk, lineHeight: 1.6 }}>
        {row(done.added, "new companies saved", "Companies that were not in your account before")}
        {row(done.matched, "already saved, so just added to this list (not copied, nothing to pay again)", "Matched by website, or by name and town")}
        {done.matching ? <div style={{ display: "flex", gap: 8, alignItems: "center", color: C.slate }}><Spinner size={13} /> Filling in from our company records: {done.matching.done.toLocaleString()} of {done.matching.total.toLocaleString()}. Free. You can keep working.</div> : null}
        {row(done.filled, "matched to our company records, with what we know filled in (free)", "The registry record was found, so its website, size and sector were added where yours were blank")}
        {row(done.repeats, "repeated in your file, kept once", "The same company on more than one row")}
        {row(done.unnamed, "left out: no company name or website", "Rows with nothing to identify the company")}
        {!done.added && !done.matched ? <div style={{ color: C.slate }}>Nothing was added.</div> : null}
      </div>
      {gaps.length ? (
        <div style={{ ...muted, fontSize: 12.5 }}>
          Still missing in your file: {gaps.map(([label, n]) => `${n.toLocaleString()} ${label}${n === 1 ? "" : "s"}`).join(", ")}. "Check & improve" can fill these and fix what looks wrong.
        </div>
      ) : null}
      {done.custom?.length ? <div style={{ ...muted, fontSize: 12.5 }}>Your own columns were kept: {done.custom.join(", ")}.</div> : null}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button title="Go to this list" type="button" className="ui-btn ui-btn--primary ui-btn--sm" onClick={() => onGo("lists")}>Open the list</button>
        {done.list?.id && (done.blanks?.phone ?? 0) < (done.list.count ?? Infinity) ? (
          <CallButton label="Call this list" lockedLabel="Call this list · add Voice" title="Skips anyone without a number, on your do-not-contact list or contacted lately, and shows you who before it dials"
            onClick={() => call.open({ kind: "list", id: done.list.id, name: done.list.name })} onLocked={() => call.open({ kind: "list", id: done.list.id, name: done.list.name }, true)} />
        ) : null}
      </div>
      {call.dialog}
    </div>
  );
}

export function ImportView({ store, onGo, onAskAi }) {
  const fileRef = useRef(null);
  const [file, setFile] = useState(null);
  const [sheets, setSheets] = useState(null); // { sheetName: rawRecords[] }
  const [sheetNames, setSheetNames] = useState([]); // sheets that actually have rows
  const [showMapper, setShowMapper] = useState(false); // "Match your columns" popup, same as Voice's file import
  const [activeSheet, setActiveSheet] = useState("");
  const [fields, setFields] = useState([]); // account-shaped rows, after column matching
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [listName, setListName] = useState(""); // the list this file is saved into
  const [progress, setProgress] = useState(null); // { done, total } while a big file is going in
  const [onExisting, setOnExisting] = useState("fill"); // a company already saved: fill its blanks, leave it, or overwrite it from the file
  const [fillFree, setFillFree] = useState(true); // after saving, fill what our own records already know (free)

  const resetFile = () => {
    setFile(null);
    setSheets(null);
    setSheetNames([]);
    setFields([]);
    setShowMapper(false);
  };

  const pick = async (f) => {
    if (!f) return;
    setError("");
    setDone(null);
    try {
      const { sheets: allSheets, sheetNames: names } = await parseImportFile(f);
      const withRows = names.filter((n) => (allSheets[n] || []).some((r) => Object.values(r).some((v) => String(v).trim())));
      if (!withRows.length) throw new Error("That file has no rows to import.");
      setFile(f);
      setListName(f.name.replace(/\.[^.]+$/, "").slice(0, 80));
      setSheets(allSheets);
      setSheetNames(withRows);
      setShowMapper(true);
    } catch (e) {
      resetFile();
      setError(e.message || "Couldn't read that file. Use .xlsx, .xls, .ods, .csv, .tsv or .json.");
    }
  };

  const onMapped = ({ sheet, map }) => {
    const data = (sheets[sheet] || []).filter((r) => Object.values(r).some((v) => String(v).trim()));
    const headers = data.length ? Object.keys(data[0]) : [];
    setActiveSheet(sheet);
    setFields(withPeople(applyMapping(headers, data, map)));
    setShowMapper(false);
  };

  const usable = fields.filter((r) => r.name || r.website);
  // The blanks in what is about to be imported, so the report can say what "Check & improve" will have to fill.
  const blanks = (rows) => ({ phone: rows.filter((r) => !r.phone).length, email: rows.filter((r) => !r.email).length, website: rows.filter((r) => !r.website).length });
  // Free: it only reads our own company records. It runs after the import is already shown, a few at a time, so nobody waits on it;
  // the report line counts up, and the list is refreshed once it ends. A huge file is capped.
  const fillFromRecords = async (ids) => {
    let next = 0;
    let finished = 0;
    let filled = 0;
    setDone((d) => (d ? { ...d, matching: { done: 0, total: ids.length } } : d));
    const worker = async () => {
      while (next < ids.length) {
        const id = ids[next++];
        try {
          const r = await api.quickCheckLeadAccount(id);
          if (r && r.registry) filled += 1;
        } catch { /* one that can't be read is simply left as it was */ }
        finished += 1;
        setDone((d) => (d ? { ...d, filled, matching: { done: finished, total: ids.length } } : d));
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    setDone((d) => (d ? { ...d, filled, matching: null } : d));
    store.reload();
  };
  const importNow = async () => {
    setBusy(true);
    const name = listName.trim() || "Unsorted";
    const rows = usable.map((x) => ({ ...x, source: "import" }));
    const total = { added: 0, matched: 0, repeats: 0, unnamed: fields.length - usable.length, list: null, rows: rows.length, file: file?.name || "", blanks: blanks(rows), custom: customColumns(fields) };
    try {
      // In batches, so a big file shows how far it has got and never hits the size limit of one request.
      for (let i = 0; i < rows.length; i += IMPORT_BATCH) {
        setProgress({ done: i, total: rows.length });
        const r = await store.save(rows.slice(i, i + IMPORT_BATCH), name, { quiet: true, onExisting });
        if (r && r.accounts) total.newIds = [...(total.newIds || []), ...r.accounts.map((a) => a.id)];
        if (!r) throw new Error(`Stopped after ${i.toLocaleString()} of ${rows.length.toLocaleString()} rows. What was imported so far is in the list ${name}.`);
        total.added += r.added; total.matched += r.matched || 0; total.repeats += r.repeats || 0; total.unnamed += r.unnamed || 0; total.list = r.list || total.list;
      }
      setDone(total);
      if (fillFree && total.newIds?.length) fillFromRecords(total.newIds.slice(0, 300));
      store.toast(`Imported ${total.added.toLocaleString()} new ${total.added === 1 ? "company" : "companies"} into ${total.list?.name || name}.`);
      resetFile();
    } catch (e) {
      setError(e.message || "The import stopped. Try again.");
      store.toast(e.message || "The import stopped. Try again.");
    } finally {
      setProgress(null);
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <input ref={fileRef} type="file" hidden accept=".xlsx,.xls,.ods,.csv,.tsv,.txt,.json" onChange={(e) => { pick(e.target.files && e.target.files[0]); e.target.value = ""; }} />
      {showMapper ? (
        <ImportMapper
          fileName={file?.name}
          sheets={sheets}
          sheetNames={sheetNames}
          initialSheet={activeSheet}
          onCancel={resetFile}
          onImport={onMapped}
        />
      ) : null}
      {!fields.length ? (
        <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files && e.dataTransfer.files[0]); }}
          style={{ border: "1.5px dashed #CBD1D9", borderRadius: 8, background: "var(--ui-sunken)", padding: "36px 20px", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 10 }}>
          <div style={{ width: 44, height: 44, borderRadius: 6, background: "#fff", border: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "center", color: "#8B5CF6" }}><FileSpreadsheet size={20} /></div>
          <div style={{ ...text, fontSize: 15, fontWeight: 600, color: C.ink }}>Import companies from a file</div>
          <div style={{ ...muted, maxWidth: "46ch" }}>Drop an Excel, CSV or JSON file here. Every sheet in a workbook is read, not just the first, and you can check which column is which before anything is saved. Every file becomes a list. A company you already saved is not copied: it is just added to the list.</div>
          <button title="Pick a CSV or Excel file of companies to import" type="button" className="ui-btn ui-btn--primary" onClick={() => fileRef.current && fileRef.current.click()}><Upload size={15} /> Upload CSV / Excel</button>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
            {[".xlsx", ".xls", ".csv", ".tsv", ".ods", ".json"].map((ext) => (
              <span key={ext} style={{ fontFamily: "monospace", fontSize: 11, fontWeight: 500, color: C.slate, padding: "2px 6px", border: `1px solid ${C.border}`, background: "#fff", borderRadius: 4 }}>{ext}</span>
            ))}
          </div>
          {error ? <div role="alert" style={{ ...muted, color: C.red }}>{error}</div> : null}
          {done ? <ImportReport done={done} onGo={onGo} onClose={() => setDone(null)} onToast={store.toast} /> : null}
          {onAskAi ? (
            <div style={{ fontSize: 12.5, color: C.slate, display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap", justifyContent: "center" }}>
              Or
              <button title="Use the AI search to find companies instead of importing a file" type="button" className="ui-link" onClick={onAskAi}>ask the AI to find companies instead</button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="ui-card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <div style={{ ...text, fontSize: 14, fontWeight: 600, color: C.ink, marginRight: "auto" }}>{file?.name} · {fields.length} {fields.length === 1 ? "row" : "rows"}{fields.some((r) => r.name && r.name === r.contact_name && !r.website) ? " · saved as people" : ""}</div>
            <button title="Change which of your columns goes into which field" type="button" className="ui-btn ui-btn--ghost" onClick={() => setShowMapper(true)}>Edit column matches</button>
            <button title="Pick a different file" type="button" className="ui-btn ui-btn--ghost" onClick={resetFile}>Choose another file</button>
          </div>
          <div className="ui-scroll" style={{ overflowX: "auto", border: `1px solid ${C.border}`, borderRadius: 6 }}>
            <table className="ui-table" style={{ minWidth: 640 }}>
              <thead><tr><th>Company</th><th>Website</th><th>Phone</th><th>Contact</th></tr></thead>
              <tbody>
                {fields.slice(0, 5).map((r, i) => (
                  <tr key={i}>
                    <td style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</td>
                    <td style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }}>{r.website}</td>
                    <td style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }}>{r.phone}</td>
                    <td style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }}>{r.contact_name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <label style={{ ...muted, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>Save into the list
            <input className="ui-input" style={{ maxWidth: 280 }} value={listName} maxLength={80} onChange={(e) => setListName(e.target.value)} aria-label="List name" />
            <button type="button" className="ui-link" onClick={() => setListName((file?.name || "").replace(/\.[^.]+$/, "").slice(0, 80))} title="Use the file name again">Reset</button>
            <span style={{ fontSize: 12 }}>A list with this name is reused if you already have one.</span>
          </label>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <label style={{ ...muted, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>If a company is already saved
              <select className="ui-input" style={{ width: "auto", maxWidth: 360 }} value={onExisting} onChange={(e) => setOnExisting(e.target.value)} aria-label="If a company is already saved">
                <option value="fill">Fill its blanks from my file, keep what is saved</option>
                <option value="skip">Leave it exactly as it is</option>
                <option value="update">Update it with my file's values</option>
              </select>
            </label>
            <label style={{ ...muted, display: "flex", gap: 8, alignItems: "center" }} title="Reads our own company records only. Nothing is charged.">
              <input type="checkbox" checked={fillFree} onChange={(e) => setFillFree(e.target.checked)} /> After saving, fill in what our company records already know: website, size, sector. Free.
            </label>
          </div>
          {customColumns(fields).length ? (
            <div style={{ ...muted, fontSize: 12.5 }}>Kept as your own columns: {customColumns(fields).join(", ")}</div>
          ) : null}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <button title="Add these companies to the list" type="button" className="ui-btn ui-btn--primary" disabled={!usable.length || busy} onClick={importNow}>
              {busy ? (progress ? `Importing ${progress.done.toLocaleString()} of ${progress.total.toLocaleString()}…` : "Importing…") : `Import ${usable.length} ${usable.length === 1 ? "company" : "companies"}`}
            </button>
            {busy && progress ? (
              <div role="progressbar" aria-valuenow={Math.round((progress.done / progress.total) * 100)} style={{ flex: "1 1 160px", height: 6, borderRadius: 3, background: C.paperSoft, overflow: "hidden" }}>
                <div style={{ width: `${Math.round((progress.done / progress.total) * 100)}%`, height: "100%", background: "var(--ui-accent)", transition: "width .3s" }} />
              </div>
            ) : null}
            {fields.length > usable.length ? <span style={{ ...muted, fontSize: 12.5 }}>{fields.length - usable.length} without a name or website will be left out.</span> : null}
          </div>
          {error ? <div role="alert" style={{ ...muted, color: C.red }}>{error}</div> : null}
        </div>
      )}
    </div>
  );
}
