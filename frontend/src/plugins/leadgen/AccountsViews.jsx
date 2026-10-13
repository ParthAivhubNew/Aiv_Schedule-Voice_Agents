import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { Building2, Check, Columns3, ExternalLink, FileSpreadsheet, Plus, RefreshCw, Search, ShieldCheck, Sparkles, Trash2, Upload, X } from "lucide-react";
import { api } from "../../api/apiClient";
import { announceCreditsChanged } from "./CreditsChip";
import { SearchStatus } from "./SearchStatus";
import { C, FONT_BODY } from "../../tokens";
import { ImportMapper } from "./ImportMapper";
import { AddToListDialog } from "./Lists";
import { applyMapping } from "./importMapping";
import { CheckDetails, CheckDialog, CheckProgress, VerdictBadge, VERDICTS, VERDICT_ORDER, useCompanyCheck } from "./CheckCompanies";
import { askConfirm, askText } from "./Dialogs";

// The Leads screens built on saved accounts (stored on the server, per company): AI Lead Scout,
// Saved Accounts, Decision Makers, Account Dossiers and Import, plus the account panel and the
// add-account form. Nothing here is made up: a field nobody found stays empty.

const SOURCE_LABEL = { scout: "AI Lead Scout", copilot: "AI Lead Copilot", import: "Import", manual: "Added by hand" };
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

  return {
    accounts, loading, error, researching, reload, toast: onToast,
    // Saves new accounts; ones already saved are skipped by the server.
    // Every save lands in a list (Unsorted unless a name is given); a company already saved is not copied,
    // it is just added to that list too.
    save: async (list, listName = "Unsorted", { quiet = false } = {}) => {
      try {
        const r = await api.saveLeadAccounts(list, listName);
        if (r.accounts?.length) setAccounts((prev) => [...r.accounts, ...prev]);
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
        : a.registry ? `Found ${a.name} in our records.` : `Nothing of ours on ${a.name} yet. No credit used.`,
    "Couldn't check right now."),
    stopWaiting: (id) => {
      stopped.current.add(id);
      setResearching((b) => { const next = { ...b }; delete next[id]; return next; });
      onToast("Stopped waiting. If it finishes in the background, the result is saved on the company.");
    },
  };
}

// ---------------------------------------------------------------- small pieces
function ResearchButton({ store, account, size = "sm" }) {
  const busy = Boolean(store.researching[account.id]);
  return (
    <button type="button" className={`ui-btn ui-btn--secondary${size === "sm" ? " ui-btn--sm" : ""}`} disabled={busy}
      onClick={() => store.research(account.id)} title="Search the web for this company's details, people and sources. 1 Leads credit if anything is found.">
      {busy ? <RefreshCw size={14} className="ui-spin" /> : <Sparkles size={14} />}
      {busy ? "Looking up…" : account.researched_at ? "Look up again" : "Look up"}
    </button>
  );
}

// Free: looks only at our own shared company store, no live web search -- never costs a credit.
function QuickCheckButton({ store, account, size = "sm" }) {
  const busy = Boolean(store.researching[account.id]);
  return (
    <button type="button" className={`ui-btn ui-btn--ghost${size === "sm" ? " ui-btn--sm" : ""}`} disabled={busy}
      onClick={() => store.quickCheck(account.id)} title="Check our own company records for this account. Always free.">
      {busy ? <RefreshCw size={14} className="ui-spin" /> : <Search size={14} />}
      Check our records (free)
    </button>
  );
}

// One structured lookup beyond our own records -- shown to the user only as "Deep web search",
// never by the vendor behind it.
function DeepSearchButton({ store, account, size = "sm" }) {
  const busy = Boolean(store.researching[account.id]);
  return (
    <button type="button" className={`ui-btn ui-btn--secondary${size === "sm" ? " ui-btn--sm" : ""}`} disabled={busy}
      onClick={() => store.deepSearch(account.id)} title="A deeper structured lookup for this company's phone, address and website. 2 Leads credits if anything new is found.">
      {busy ? <RefreshCw size={14} className="ui-spin" /> : <Search size={14} />}
      Deep web search
    </button>
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
  return <div style={muted}>Loading your saved accounts…</div>;
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
const BUILT_IN_COLUMNS = [["phone", "Phone"], ["email", "Email"], ["contact", "Contact"], ["quality", "Complete"], ["check", "Check"], ["source", "Found by"]];
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

// "What we found": what was already there, what is new, and the extras research turned up, with how complete it is now.
function FoundSummary({ account }) {
  const f = account.found;
  if (!f || !wasLookedUp(account)) return null;
  const extra = [["people", "people"], ["emails", "emails"], ["phones", "phone numbers"], ["socials", "social profiles"], ["offices", "other offices"]]
    .filter(([k]) => f.extra?.[k]).map(([k, label]) => `${f.extra[k]} ${label}`);
  const sec = { ...text, fontSize: 13, color: C.textInk, lineHeight: 1.6 };
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ ...text, fontSize: 13.5, fontWeight: 600, color: C.ink, marginRight: "auto" }}>What we found</div>
        <QualityBar found={f} wide />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", ...sec }}>
        <span style={{ color: C.slate }}>Already had</span>
        <span>{f.had?.length ? f.had.map((k) => FIELD_WORD[k] || k).join(", ") : "None of the contact details"}</span>
        <span style={{ color: C.slate }}>New</span>
        <span>
          {f.filled?.length
            ? f.filled.map((x) => <div key={x.field}><strong>{FIELD_WORD[x.field] || x.field}:</strong> {x.value} <span style={{ color: C.slateLight }}>· from {HOW_WORD[x.how] || x.how}</span></div>)
            : "Nothing was missing that we could fill in"}
        </span>
        {extra.length ? <><span style={{ color: C.slate }}>Also found</span><span>{extra.join(", ")}. See the research below.</span></> : null}
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
        <Columns3 size={14} /> Columns{hidden.length ? ` (${hidden.length} hidden)` : ""}
      </button>
      {open ? (
        <div role="menu" className="ui-card" style={{ position: "absolute", right: 0, top: "calc(100% + 4px)", zIndex: 20, minWidth: 220, maxHeight: 320, overflowY: "auto", padding: 8, boxShadow: "0 8px 24px rgba(0,0,0,.14)" }}>
          <div style={{ ...muted, fontSize: 12, padding: "2px 6px 6px" }}>Tick the columns you want to see. This only changes your view.</div>
          {columns.map(([id, label]) => (
            <label key={id} style={{ ...text, fontSize: 13, display: "flex", alignItems: "center", gap: 8, padding: "5px 6px", cursor: "pointer" }}>
              <input type="checkbox" checked={!hidden.includes(id)} onChange={() => onToggle(id)} /> {label}
            </label>
          ))}
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

export function AccountsView({ store, listsStore, onOpen, onAdd, onGo, scopeIds = null, listId = "" }) {
  const [filter, setFilter] = useState("");
  const [scope, setScope] = useState("all");
  const [picked, setPicked] = useState(() => new Set()); // ids ticked for "Check companies"
  const [checking, setChecking] = useState(null); // { ids, pendingOnly } while the cost box is open
  const [listing, setListing] = useState(false); // the Add to list box is open
  const [hidden, setHidden] = useState(readHidden); // columns this person chose not to see
  const check = useCompanyCheck({ onToast: store.toast, reload: store.reload });
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
  const columnCount = 2 + ["phone", "email", "contact", "quality", "check", "source"].filter(showing).length + shownOwn.length + 1;
  const q = filter.trim().toLowerCase();
  // Verdict filters appear once some companies have been checked.
  const verdictChips = VERDICT_ORDER
    .map((k) => [`v_${k}`, VERDICTS[k].label, (a) => a.verification?.verdict === k])
    .filter(([, , pred]) => base.some(pred))
    .map(([id, label, pred]) => [id, `${label} ${base.filter(pred).length}`, pred, VERDICT_TIPS[id.slice(2)]]);
  const chips = [...ACCOUNT_CHIPS, ...verdictChips];
  const scopePred = (chips.find(([id]) => id === scope) || ACCOUNT_CHIPS[0])[2];
  const shown = base
    .filter(scopePred)
    .filter((a) => !q || [a.name, a.domain, a.contact_name, a.industry, a.region].some((v) => String(v || "").toLowerCase().includes(q)));
  const shownIds = shown.map((a) => a.id);
  const allShownPicked = shownIds.length > 0 && shownIds.every((id) => picked.has(id));
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
          <ColumnsMenu columns={allColumns} hidden={hidden} onToggle={toggleColumn} onShowAll={() => saveHidden([])} />
          {listId ? (
            <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" disabled={!pickedIds.length} onClick={() => removeFromList(pickedIds)}
              title="Take the ticked companies out of this list">
              Remove from list
            </button>
          ) : null}
          <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" disabled={!pickedIds.length || !listsStore} onClick={() => setListing(true)}
            title="Group these companies in a named list, ready for a campaign">
            Add to list
          </button>
          <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" disabled={!pickedIds.length || check.job?.status === "running"}
            title="Correct and complete these companies: our records, the company registers, the web, and missing emails"
            onClick={() => setChecking({ ids: pickedIds, pendingOnly: false })}>
            <ShieldCheck size={14} /> Get contact details
          </button>
        </div>
        {allShownPicked && shownIds.length < base.length ? (
          <div style={{ ...muted, padding: "6px 12px", background: C.paperSoft, borderBottom: `1px solid ${C.border}` }}>
            {shownIds.length.toLocaleString()} shown are selected.{" "}
            <button title="Tick every company in this list" type="button" onClick={() => setPicked(new Set(base.map((a) => a.id)))} style={{ ...text, background: "none", border: "none", padding: 0, color: C.cobalt, cursor: "pointer", fontSize: 13, textDecoration: "underline" }}>
              Select all {base.length.toLocaleString()} companies
            </button>
          </div>
        ) : null}
        <div className="ui-scroll" style={{ overflowX: "auto" }}>
          <table className="ui-table" style={{ minWidth: 520 + 120 * (columnCount - 3) }}>
            <thead>
              <tr>
                <th style={{ width: 1 }}>
                  <input type="checkbox" checked={allShownPicked} onChange={() => setPicked(allShownPicked ? new Set() : new Set(shownIds))} aria-label="Select all companies shown" />
                </th>
                <th>Company</th>
                {showing("phone") ? <th title="The number you saved, or one research found. A tick means the phone network confirmed it">Phone</th> : null}
                {showing("email") ? <th title="The email you saved, or one research found">Email</th> : null}
                {showing("contact") ? <th title="The person to write to">Contact</th> : null}
                {showing("quality") ? <th title="How much of the website, phone, email and contact is filled in">Complete</th> : null}
                {showing("check") ? <th title="Whether the company, its website and its email look real">Check</th> : null}
                {showing("source") ? <th title="Where this company came from">Found by</th> : null}
                {shownOwn.map((n) => <th key={n} style={{ whiteSpace: "nowrap" }}>{n}</th>)}
                <th style={{ width: 1 }} aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {shown.map((a) => (
                <tr key={a.id}>
                  <td><input type="checkbox" checked={picked.has(a.id)} onChange={() => toggle(a.id)} aria-label={`Select ${a.name}`} /></td>
                  <td>
                    <button type="button" title="Open this company's details" onClick={() => onOpen(a)} style={{ ...text, all: "unset", cursor: "pointer", fontWeight: 600, color: C.ink, fontSize: 13.5 }}>{a.name}</button>
                    <div style={{ fontSize: 12, marginTop: 1 }}><SiteLink account={a} /></div>
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
                  {showing("email") ? <td style={{ maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={emailFor(a)?.text || ""}>
                    {emailFor(a) ? <>{emailFor(a).text}{emailFor(a).fromResearch ? <span style={{ color: C.slateLight, fontSize: 11.5 }}> · from research</span> : null}{isNew(a, "email") ? <NewTag /> : null}</> : <Empty a={a} />}</td> : null}
                  {showing("contact") ? (
                    <td>
                      {contactFor(a)
                        ? <>{contactFor(a).text}{contactFor(a).title ? <span style={{ color: C.slate }}> · {contactFor(a).title}</span> : null}
                          {contactFor(a).fromResearch ? <span style={{ color: C.slateLight, fontSize: 11.5 }}> · from research</span> : null}</>
                        : <Empty a={a} />}
                    </td>
                  ) : null}
                  {showing("quality") ? <td>{wasLookedUp(a) ? <QualityBar found={a.found} /> : <span style={{ color: C.slateLight }}>—</span>}</td> : null}
                  {showing("check") ? (
                    <td>
                      <VerdictBadge verification={a.verification} />
                      {openFixes(a).map((f) => (
                        <div key={f.field} style={{ fontSize: 12, marginTop: 3, color: C.textInk }} title={f.why}>
                          <span style={{ color: C.slate }}>{f.field}:</span> {f.from || "—"} → <strong>{f.to}</strong>{" "}
                          <button title="Use the suggested value in place of the one you entered. Your original is kept beside it" type="button" className="ui-link" onClick={() => acceptFixes([a.id], [f.field])}>Accept</button>
                        </div>
                      ))}
                    </td>
                  ) : null}
                  {showing("source") ? <td style={{ color: C.slate }}>{SOURCE_LABEL[a.source] || "Added by hand"}</td> : null}
                  {shownOwn.map((n) => (
                    <td key={n} title={a.custom?.[n] || ""} style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {a.custom?.[n] || <span style={{ color: C.slateLight }}>—</span>}
                    </td>
                  ))}
                  <td style={{ textAlign: "right" }}>
                    <span style={{ display: "inline-flex", gap: 6 }}>
                      <ResearchButton store={store} account={a} />
                      <button title="Open this company's full details" type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => onOpen(a)}>Open</button>
                      {listId ? <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => removeFromList([a.id])} title="Remove from this list">Remove</button> : null}
                    </span>
                  </td>
                </tr>
              ))}
              {!shown.length ? <tr><td colSpan={columnCount} style={{ color: C.slate }}>Nothing matches “{filter}”.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>
      {checking ? (
        <CheckDialog ids={checking.ids} pendingOnly={checking.pendingOnly} onStart={check.start} onClose={() => setChecking(null)} />
      ) : null}
      {listing && listsStore ? <AddToListDialog ids={pickedIds} listsStore={listsStore} onToast={store.toast} onClose={() => setListing(false)} /> : null}
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
        <span style={{ ...muted, flex: "1 1 220px" }}>Not looked up yet. Looking up searches the web for its details, people and sources.</span>
        <QuickCheckButton store={store} account={account} />
        <DeepSearchButton store={store} account={account} />
        <ResearchButton store={store} account={account} />
      </div>
    );
  }
  if (!hasFindings(account) && !reg) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span style={{ ...muted, flex: "1 1 220px" }}>The last research found nothing public about this company.</span>
        <QuickCheckButton store={store} account={account} />
        <DeepSearchButton store={store} account={account} />
        <ResearchButton store={store} account={account} />
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
              <SiteLink account={live} /><span>{SOURCE_LABEL[live.source] || "Added by hand"}</span>
            </div>
          </div>
          <button type="button" className="ui-icon-btn" aria-label="Close" onClick={onClose}><X size={18} /></button>
        </div>
        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 20 }}>
          <FoundSummary account={live} />
          <CheckDetails account={live} />
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
          <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ ...text, fontSize: 13.5, fontWeight: 600, color: C.ink, marginRight: "auto" }}>Research</div>
              {live.researched_at ? <DeepSearchButton store={store} account={live} /> : null}
              {live.researched_at ? <ResearchButton store={store} account={live} /> : null}
            </div>
            {store.researching[live.id] ? (
              <SearchStatus title={store.researching[live.id] === "deep" ? `Deep web search on ${live.name}` : store.researching[live.id] === "quick" ? `Checking our records for ${live.name}` : `Looking up ${live.name}`}
                detail={store.researching[live.id] === "quick" ? "Looking only at our own records. This is free." : "Reading public pages for its people, phone numbers and sources. A credit is used only if something is found."}
                cancelLabel="Stop waiting" onCancel={() => store.stopWaiting(live.id)} />
            ) : null}
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
                <button title="Remove this company from your account. You will be asked to confirm" type="button" className="ui-btn ui-btn--ghost" onClick={() => setConfirmRemove(true)}><Trash2 size={15} /> Remove</button>
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
function ImportReport({ done, onGo, onClose }) {
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
        {row(done.repeats, "repeated in your file, kept once", "The same company on more than one row")}
        {row(done.unnamed, "left out: no company name or website", "Rows with nothing to identify the company")}
        {!done.added && !done.matched ? <div style={{ color: C.slate }}>Nothing was added.</div> : null}
      </div>
      {gaps.length ? (
        <div style={{ ...muted, fontSize: 12.5 }}>
          Still missing in your file: {gaps.map(([label, n]) => `${n.toLocaleString()} ${label}${n === 1 ? "" : "s"}`).join(", ")}. "Get contact details" can fill these and fix what looks wrong.
        </div>
      ) : null}
      {done.custom?.length ? <div style={{ ...muted, fontSize: 12.5 }}>Your own columns were kept: {done.custom.join(", ")}.</div> : null}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button title="Go to this list" type="button" className="ui-btn ui-btn--primary ui-btn--sm" onClick={() => onGo("lists")}>Open the list</button>
      </div>
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
    setFields(applyMapping(headers, data, map));
    setShowMapper(false);
  };

  const usable = fields.filter((r) => r.name || r.website);
  // The blanks in what is about to be imported, so the report can say what "Get contact details" will have to fill.
  const blanks = (rows) => ({ phone: rows.filter((r) => !r.phone).length, email: rows.filter((r) => !r.email).length, website: rows.filter((r) => !r.website).length });
  const importNow = async () => {
    setBusy(true);
    const name = listName.trim() || "Unsorted";
    const rows = usable.map((x) => ({ ...x, source: "import" }));
    const total = { added: 0, matched: 0, repeats: 0, unnamed: fields.length - usable.length, list: null, rows: rows.length, file: file?.name || "", blanks: blanks(rows), custom: customColumns(fields) };
    try {
      // In batches, so a big file shows how far it has got and never hits the size limit of one request.
      for (let i = 0; i < rows.length; i += IMPORT_BATCH) {
        setProgress({ done: i, total: rows.length });
        const r = await store.save(rows.slice(i, i + IMPORT_BATCH), name, { quiet: true });
        if (!r) throw new Error(`Stopped after ${i.toLocaleString()} of ${rows.length.toLocaleString()} rows. What was imported so far is in the list ${name}.`);
        total.added += r.added; total.matched += r.matched || 0; total.repeats += r.repeats || 0; total.unnamed += r.unnamed || 0; total.list = r.list || total.list;
      }
      setDone(total);
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
          {done ? <ImportReport done={done} onGo={onGo} onClose={() => setDone(null)} /> : null}
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
            <div style={{ ...text, fontSize: 14, fontWeight: 600, color: C.ink, marginRight: "auto" }}>{file?.name} · {fields.length} {fields.length === 1 ? "row" : "rows"}</div>
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
          {customColumns(fields).length ? (
            <div style={{ ...muted, fontSize: 12.5 }}>Kept as your own columns: {customColumns(fields).join(", ")}</div>
          ) : null}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <button title="Add these companies to the list" type="button" className="ui-btn ui-btn--primary" disabled={!usable.length || busy} onClick={importNow}>
              {busy ? (progress ? `Importing ${progress.done.toLocaleString()} of ${progress.total.toLocaleString()}…` : "Importing…") : `Import ${usable.length} ${usable.length === 1 ? "company" : "companies"}`}
            </button>
            {busy && progress ? (
              <div role="progressbar" aria-valuenow={Math.round((progress.done / progress.total) * 100)} style={{ flex: "1 1 160px", height: 6, borderRadius: 3, background: C.paperSoft, overflow: "hidden" }}>
                <div style={{ width: `${Math.round((progress.done / progress.total) * 100)}%`, height: "100%", background: C.cobalt, transition: "width .3s" }} />
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
