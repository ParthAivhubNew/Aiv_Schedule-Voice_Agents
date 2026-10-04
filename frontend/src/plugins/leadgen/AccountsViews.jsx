import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { Building2, Check, Copy, ExternalLink, FileSpreadsheet, Mail, Phone, Plus, RefreshCw, Search, Sparkles, Trash2, Upload, Users, X } from "lucide-react";
import { api } from "../../api/apiClient";
import { C, FONT_BODY } from "../../tokens";

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
  return Boolean(r && (r.overview || r.people?.length || r.phones?.length || r.emails?.length || Object.keys(r.socials || {}).length));
}

function copy(value, onToast) {
  navigator.clipboard?.writeText(value).then(() => onToast(`Copied ${value}`), () => onToast("Couldn't copy. Select the text instead."));
}

// ---------------------------------------------------------------- the shared store
export function useLeadAccounts(onToast) {
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

  return {
    accounts, loading, error, researching, reload,
    // Saves new accounts; ones already saved are skipped by the server.
    save: async (list) => {
      try {
        const r = await api.saveLeadAccounts(list);
        if (r.accounts?.length) setAccounts((prev) => [...r.accounts, ...prev]);
        onToast(r.added
          ? `Saved ${r.added} ${r.added === 1 ? "account" : "accounts"}${r.skipped ? `. ${r.skipped} ${r.skipped === 1 ? "was" : "were"} already saved` : ""}.`
          : "Already in your saved accounts.");
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
    research: async (id) => {
      setResearching((b) => ({ ...b, [id]: true }));
      try {
        const a = await api.researchLeadAccount(id);
        replace(a);
        onToast(hasFindings(a) ? `Researched ${a.name}.` : `Nothing public found for ${a.name}. No credit used.`);
        return a;
      } catch (e) {
        onToast(e.message || "Research failed. Try again.");
        return null;
      } finally {
        setResearching((b) => {
          const next = { ...b };
          delete next[id];
          return next;
        });
      }
    },
  };
}

// ---------------------------------------------------------------- small pieces
function ResearchButton({ store, account, size = "sm" }) {
  const busy = Boolean(store.researching[account.id]);
  return (
    <button type="button" className={`ui-btn ui-btn--secondary${size === "sm" ? " ui-btn--sm" : ""}`} disabled={busy}
      onClick={() => store.research(account.id)} title="Search the web for this company's details. 1 Leads credit if anything is found.">
      {busy ? <RefreshCw size={14} className="ui-spin" /> : <Sparkles size={14} />}
      {busy ? "Researching…" : account.researched_at ? "Research again" : "Research"}
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

// ---------------------------------------------------------------- AI Lead Scout
const SCOUT_IDEAS = ["Dental practices in Leeds", "Logistics companies in Manchester", "Accountants in Birmingham", "Marketing agencies in Bristol"];

export function ScoutView({ store }) {
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState(null); // null until the first search
  const [searched, setSearched] = useState("");

  const savedKeys = useMemo(() => new Set(store.accounts.flatMap((a) => [a.domain, a.name.toLowerCase()]).filter(Boolean)), [store.accounts]);
  const isSaved = (r) => {
    const d = domainOf(r.site);
    return d ? savedKeys.has(d) : savedKeys.has(String(r.name || "").toLowerCase());
  };
  const asAccount = (r) => ({ name: r.name, website: r.site || "", phone: r.phone || "", notes: r.snippet || "", source: "scout", source_url: r.sourceUrl || "" });

  const run = async (e, preset) => {
    if (e) e.preventDefault();
    const q = (preset || query).trim();
    if (!q || busy) return;
    if (preset) setQuery(preset);
    setBusy(true);
    setError("");
    try {
      const r = await api.discoverAccounts({ query: q, ...(role.trim() ? { target_role: role.trim() } : {}) });
      setResults(r.leads || []);
      setSearched(q);
    } catch (err) {
      setResults(null); // never leave the last search's results under a new query
      setError(err.message || "The search didn't finish. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const unsaved = (results || []).filter((r) => !isSaved(r));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <form onSubmit={run} className="ui-card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <div className="ui-field" style={{ flex: "2 1 320px", minWidth: 0, display: "flex", alignItems: "center", gap: 8, border: `1px solid ${C.border}`, borderRadius: 6, padding: "0 10px", background: "#fff", height: 40 }}>
            <Search size={16} color={C.slate} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="A type of business and a place, like dental practices in Leeds" aria-label="What to search for"
              style={{ ...text, flex: 1, minWidth: 0, border: 0, outline: 0, fontSize: 14, background: "transparent", color: C.textInk }} />
          </div>
          <input className="ui-input" value={role} onChange={(e) => setRole(e.target.value)} placeholder="Who to reach (optional), like practice manager" aria-label="Who to reach"
            style={{ flex: "1 1 220px", height: 40 }} />
          <button type="submit" className="ui-btn ui-btn--primary" disabled={busy || !query.trim()} style={{ height: 40 }}>
            {busy ? <RefreshCw size={15} className="ui-spin" /> : <Search size={15} />} {busy ? "Searching the web…" : "Find companies"}
          </button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span style={{ ...muted, fontSize: 12.5 }}>Try</span>
          {SCOUT_IDEAS.map((idea) => (
            <button key={idea} type="button" className="ui-chip" disabled={busy} onClick={() => run(null, idea)} style={{ padding: "5px 9px" }}>{idea}</button>
          ))}
        </div>
        <div style={{ ...muted, fontSize: 12.5 }}>Searches the web live. Each company found uses 1 Leads credit.</div>
      </form>

      {error ? <div role="alert" style={{ ...muted, color: C.red }}>{error}</div> : null}

      {results === null ? null : results.length === 0 ? (
        <EmptyState icon={Search} title="No companies found" body={`The web search returned no companies for “${searched}”. Nothing was charged. Try again in a minute, or name a type of business and a town, like “dental practices in Leeds”.`} />
      ) : (
        <div className="ui-card" style={{ overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", borderBottom: `1px solid ${C.border}`, flexWrap: "wrap" }}>
            <div style={{ ...text, fontSize: 13.5, fontWeight: 600, color: C.ink, marginRight: "auto" }}>
              {results.length} {results.length === 1 ? "company" : "companies"} for “{searched}”
            </div>
            <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" disabled={!unsaved.length} onClick={() => store.save(unsaved.map(asAccount))}>
              <Plus size={14} /> {unsaved.length ? `Save all ${unsaved.length}` : "All saved"}
            </button>
          </div>
          {results.map((r, i) => {
            const saved = isSaved(r);
            const d = domainOf(r.site);
            return (
              <div key={r.id || i} style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "12px 16px", borderBottom: i < results.length - 1 ? `1px solid ${C.borderLight}` : "none" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ ...text, fontSize: 14, fontWeight: 600, color: C.ink }}>{r.name}</div>
                  <div style={{ ...muted, fontSize: 12.5, display: "flex", gap: 10, flexWrap: "wrap", marginTop: 2 }}>
                    {d ? <a href={r.site} target="_blank" rel="noreferrer" style={{ color: C.slate, display: "inline-flex", alignItems: "center", gap: 3 }}>{d} <ExternalLink size={11} /></a> : <span>No website found</span>}
                    {r.phone ? <span style={{ fontVariantNumeric: "tabular-nums" }}>{r.phone}</span> : <span>No phone found</span>}
                  </div>
                  {r.snippet ? <div style={{ ...muted, fontSize: 12.5, marginTop: 6, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{r.snippet}</div> : null}
                </div>
                {saved ? (
                  <span style={{ ...text, fontSize: 12.5, color: C.green, display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap", paddingTop: 4 }}><Check size={14} /> Saved</span>
                ) : (
                  <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={() => store.save([asAccount(r)])}><Plus size={14} /> Save</button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Saved Accounts
export function AccountsView({ store, onOpen, onAdd, onGo }) {
  const [filter, setFilter] = useState("");
  if (store.loading || (store.error && !store.accounts.length)) return <Loading store={store} />;
  if (!store.accounts.length) {
    return (
      <EmptyState icon={Building2} title="No saved accounts yet" body="Find companies with AI Lead Scout, import a spreadsheet, or add one by hand.">
        <button type="button" className="ui-btn ui-btn--primary" onClick={() => onGo("scout")}><Search size={15} /> Find companies</button>
        <button type="button" className="ui-btn ui-btn--secondary" onClick={() => onGo("import_export")}><Upload size={15} /> Import a spreadsheet</button>
        <button type="button" className="ui-btn ui-btn--ghost" onClick={onAdd}><Plus size={15} /> Add by hand</button>
      </EmptyState>
    );
  }
  const q = filter.trim().toLowerCase();
  const shown = q ? store.accounts.filter((a) => [a.name, a.domain, a.contact_name, a.industry, a.region].some((v) => String(v || "").toLowerCase().includes(q))) : store.accounts;
  const stats = [
    ["Saved accounts", store.accounts.length],
    ["With a phone", store.accounts.filter((a) => a.phone).length],
    ["With a contact", store.accounts.filter((a) => a.contact_name || a.email).length],
    ["Researched", store.accounts.filter((a) => a.researched_at).length],
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="grid-2-narrow" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 }}>
        {stats.map(([label, n]) => (
          <div key={label} className="ui-card" style={{ padding: "12px 16px" }}>
            <div style={{ ...muted, fontSize: 12.5 }}>{label}</div>
            <div style={{ ...text, fontSize: 22, fontWeight: 600, color: C.ink, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>{n}</div>
          </div>
        ))}
      </div>
      <div className="ui-card" style={{ overflow: "hidden" }}>
        <div style={{ padding: "10px 12px", borderBottom: `1px solid ${C.border}` }}>
          <input className="ui-input" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by name, website, contact or place" aria-label="Filter saved accounts" style={{ width: "100%", maxWidth: 360 }} />
        </div>
        <div className="ui-scroll" style={{ overflowX: "auto" }}>
          <table className="ui-table" style={{ minWidth: 760 }}>
            <thead>
              <tr><th>Company</th><th>Phone</th><th>Contact</th><th>Found by</th><th style={{ width: 1 }} aria-label="Actions" /></tr>
            </thead>
            <tbody>
              {shown.map((a) => (
                <tr key={a.id}>
                  <td>
                    <button type="button" onClick={() => onOpen(a)} style={{ ...text, all: "unset", cursor: "pointer", fontWeight: 600, color: C.ink, fontSize: 13.5 }}>{a.name}</button>
                    <div style={{ fontSize: 12, marginTop: 1 }}><SiteLink account={a} /></div>
                  </td>
                  <td style={{ fontVariantNumeric: "tabular-nums" }}>{a.phone || <span style={{ color: C.slateLight }}>Not found</span>}</td>
                  <td>{a.contact_name ? <>{a.contact_name}{a.contact_title ? <span style={{ color: C.slate }}> · {a.contact_title}</span> : null}</> : <span style={{ color: C.slateLight }}>Not found</span>}</td>
                  <td style={{ color: C.slate }}>{SOURCE_LABEL[a.source] || "Added by hand"}</td>
                  <td style={{ textAlign: "right" }}>
                    <span style={{ display: "inline-flex", gap: 6 }}>
                      <ResearchButton store={store} account={a} />
                      <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => onOpen(a)}>Open</button>
                    </span>
                  </td>
                </tr>
              ))}
              {!shown.length ? <tr><td colSpan={5} style={{ color: C.slate }}>Nothing matches “{filter}”.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Decision Makers
export function ContactsView({ store, onOpen, onToast, onGo }) {
  if (store.loading || (store.error && !store.accounts.length)) return <Loading store={store} />;
  const people = store.accounts.filter((a) => a.contact_name || a.email);
  if (!people.length) {
    return (
      <EmptyState icon={Users} title="No decision makers yet"
        body={store.accounts.length ? "Research a saved account to look for the people who run it, or add a contact to an account by hand." : "Save some companies first. Research then looks for the people who run them."}>
        <button type="button" className="ui-btn ui-btn--primary" onClick={() => onGo(store.accounts.length ? "accounts" : "scout")}>
          {store.accounts.length ? <><Building2 size={15} /> Open saved accounts</> : <><Search size={15} /> Find companies</>}
        </button>
        <button type="button" className="ui-btn ui-btn--secondary" onClick={() => onGo("find_email")}><Mail size={15} /> Find a work email</button>
      </EmptyState>
    );
  }
  return (
    <div className="stack-narrow" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 320px), 1fr))", gap: 12 }}>
      {people.map((a) => (
        <div key={a.id} className="ui-card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          <div>
            <div style={{ ...text, fontSize: 14, fontWeight: 600, color: C.ink }}>{a.contact_name || "Name not found"}</div>
            <div style={{ ...muted, fontSize: 12.5 }}>
              {a.contact_title ? `${a.contact_title} · ` : ""}
              <button type="button" onClick={() => onOpen(a)} style={{ ...text, all: "unset", cursor: "pointer", color: C.slate, textDecoration: "underline", textUnderlineOffset: 3 }}>{a.name}</button>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {[[Phone, a.phone, "phone"], [Mail, a.email, "email"]].map(([Icon, value, kind]) => (
              <div key={kind} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: value ? C.textInk : C.slateLight, ...text }}>
                <Icon size={14} color={C.slate} />
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", fontVariantNumeric: "tabular-nums" }}>{value || `No ${kind} found`}</span>
                {value ? <button type="button" className="ui-icon-btn ui-icon-btn--sm" title={`Copy ${kind}`} onClick={() => copy(value, onToast)}><Copy size={14} /></button> : null}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- Account Dossiers
function Dossier({ account, store }) {
  const r = account.research;
  if (!account.researched_at) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span style={{ ...muted, flex: "1 1 220px" }}>Not researched yet. Research searches the web for its details, people and sources.</span>
        <ResearchButton store={store} account={account} />
      </div>
    );
  }
  if (!hasFindings(account)) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span style={{ ...muted, flex: "1 1 220px" }}>The last research found nothing public about this company.</span>
        <ResearchButton store={store} account={account} />
      </div>
    );
  }
  const label = { ...text, fontSize: 12, fontWeight: 500, color: C.slate, marginBottom: 4 };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {r.overview ? <div><div style={label}>Overview</div><div style={{ ...text, fontSize: 13.5, color: C.textInk, lineHeight: 1.55 }}>{r.overview}</div></div> : null}
      {r.people?.length ? (
        <div>
          <div style={label}>People found</div>
          {r.people.map((p, i) => (
            <div key={i} style={{ ...text, fontSize: 13.5, color: C.textInk }}>
              {p.name}{p.role ? <span style={{ color: C.slate }}> · {p.role}</span> : null}
            </div>
          ))}
        </div>
      ) : null}
      {(r.phones?.length || r.emails?.length) ? (
        <div>
          <div style={label}>Contact details found</div>
          <div style={{ ...text, fontSize: 13.5, color: C.textInk, display: "flex", gap: 14, flexWrap: "wrap", fontVariantNumeric: "tabular-nums" }}>
            {[...(r.phones || []), ...(r.emails || [])].map((v) => <span key={v}>{v}</span>)}
          </div>
        </div>
      ) : null}
      {r.sources?.length ? (
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
    </div>
  );
}

export function DossiersView({ store, onOpen, onGo }) {
  if (store.loading || (store.error && !store.accounts.length)) return <Loading store={store} />;
  if (!store.accounts.length) {
    return (
      <EmptyState icon={FileSpreadsheet} title="No dossiers yet" body="Save companies first. Each one gets a dossier once you research it.">
        <button type="button" className="ui-btn ui-btn--primary" onClick={() => onGo("scout")}><Search size={15} /> Find companies</button>
      </EmptyState>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {store.accounts.map((a) => (
        <div key={a.id} className="ui-card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <button type="button" onClick={() => onOpen(a)} style={{ ...text, all: "unset", cursor: "pointer", fontSize: 15, fontWeight: 600, color: C.ink }}>{a.name}</button>
            <span style={{ fontSize: 12.5 }}><SiteLink account={a} /></span>
          </div>
          <Dossier account={a} store={store} />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- the account panel
const EDIT_FIELDS = [
  ["name", "Company name"], ["website", "Website"], ["phone", "Phone"], ["email", "Email"],
  ["contact_name", "Contact"], ["contact_title", "Contact's job title"], ["industry", "Industry"], ["region", "Town or region"],
];

export function AccountPanel({ account, store, onClose }) {
  const live = store.accounts.find((a) => a.id === account.id) || account;
  const [form, setForm] = useState(() => Object.fromEntries([...EDIT_FIELDS.map(([k]) => [k, live[k] || ""]), ["notes", live.notes || ""]]));
  const [confirmRemove, setConfirmRemove] = useState(false);
  const changed = [...EDIT_FIELDS.map(([k]) => k), "notes"].some((k) => (form[k] || "") !== (live[k] || ""));
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
          <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ ...text, fontSize: 13.5, fontWeight: 600, color: C.ink, marginRight: "auto" }}>Research</div>
              {live.researched_at ? <ResearchButton store={store} account={live} /> : null}
            </div>
            <Dossier account={live} store={store} />
          </section>
          <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ ...text, fontSize: 13.5, fontWeight: 600, color: C.ink }}>Details</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 200px), 1fr))", gap: 10 }}>
              {EDIT_FIELDS.map(([k, label]) => (
                <label key={k} style={{ display: "flex", flexDirection: "column", gap: 4, ...text, fontSize: 12.5, color: C.slate }}>
                  {label}
                  <input className="ui-input" value={form[k]} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))} />
                </label>
              ))}
            </div>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, ...text, fontSize: 12.5, color: C.slate }}>
              Notes
              <textarea className="ui-input" rows={3} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} style={{ height: "auto", padding: "8px 10px", resize: "vertical", lineHeight: 1.5 }} />
            </label>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <button type="button" className="ui-btn ui-btn--primary" disabled={!changed || !form.name.trim()} onClick={() => store.update(live.id, form)}>Save changes</button>
              <span style={{ flex: 1 }} />
              {confirmRemove ? (
                <>
                  <span style={{ ...muted, fontSize: 12.5 }}>Remove {live.name}?</span>
                  <button type="button" className="ui-btn ui-btn--danger" onClick={async () => { if (await store.remove(live.id)) onClose(); }}>Remove</button>
                  <button type="button" className="ui-btn ui-btn--ghost" onClick={() => setConfirmRemove(false)}>Keep</button>
                </>
              ) : (
                <button type="button" className="ui-btn ui-btn--ghost" onClick={() => setConfirmRemove(true)}><Trash2 size={15} /> Remove</button>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- add by hand
export function AddAccountForm({ store, onClose }) {
  const [form, setForm] = useState({ name: "", website: "", phone: "", email: "", contact_name: "", contact_title: "" });
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
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 190px), 1fr))", gap: 10 }}>
          {[["name", "Company name"], ["website", "Website"], ["phone", "Phone"], ["email", "Email"], ["contact_name", "Contact"], ["contact_title", "Contact's job title"]].map(([k, label]) => (
            <label key={k} style={{ display: "flex", flexDirection: "column", gap: 4, ...text, fontSize: 12.5, color: C.slate }}>
              {label}{k === "name" ? " (required)" : ""}
              <input className="ui-input" value={form[k]} autoFocus={k === "name"} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))} />
            </label>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
          <button type="button" className="ui-btn ui-btn--ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="ui-btn ui-btn--primary" disabled={!form.name.trim() || busy}>{busy ? "Saving…" : "Add account"}</button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------- Import
const IMPORT_FIELDS = [
  ["name", "Company name", ["company", "company name", "business", "business name", "organisation", "organization", "account", "account name", "name"]],
  ["website", "Website", ["website", "web site", "url", "site", "domain", "homepage", "web"]],
  ["phone", "Phone", ["phone", "phone number", "telephone", "tel", "mobile", "contact number", "number"]],
  ["email", "Email", ["email", "e-mail", "email address", "mail"]],
  ["contact_name", "Contact", ["contact", "contact name", "full name", "person", "decision maker", "owner"]],
  ["contact_title", "Contact's job title", ["title", "job title", "role", "position"]],
  ["industry", "Industry", ["industry", "sector", "category", "type"]],
  ["region", "Town or region", ["town", "city", "region", "location", "county", "area", "country", "address"]],
  ["notes", "Notes", ["notes", "note", "description", "comments", "comment"]],
];

function guessColumns(headers) {
  const norm = (h) => String(h || "").trim().toLowerCase().replace(/[_-]+/g, " ");
  const taken = new Set();
  const map = {};
  for (const [key, , names] of IMPORT_FIELDS) {
    const hit = names.map((n) => headers.find((h) => norm(h) === n && !taken.has(h))).find(Boolean)
      || names.map((n) => headers.find((h) => norm(h).includes(n) && !taken.has(h))).find(Boolean);
    if (hit) {
      map[key] = hit;
      taken.add(hit);
    }
  }
  return map;
}

async function readRows(file) {
  const name = file.name.toLowerCase();
  if (/\.(csv|tsv|txt)$/.test(name)) {
    const parsed = await new Promise((resolve, reject) => Papa.parse(file, { header: true, skipEmptyLines: "greedy", complete: resolve, error: reject }));
    return parsed.data;
  }
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
}

export function ImportView({ store, onGo }) {
  const fileRef = useRef(null);
  const [file, setFile] = useState(null);
  const [rows, setRows] = useState([]);
  const [map, setMap] = useState({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const headers = rows.length ? Object.keys(rows[0]) : [];

  const pick = async (f) => {
    if (!f) return;
    setError("");
    setDone(null);
    try {
      const data = (await readRows(f)).filter((r) => Object.values(r).some((v) => String(v).trim()));
      if (!data.length) throw new Error("That file has no rows to import.");
      setFile(f);
      setRows(data);
      setMap(guessColumns(Object.keys(data[0])));
    } catch (e) {
      setFile(null);
      setRows([]);
      setError(e.message || "Couldn't read that file. Use .xlsx, .xls, .ods or .csv.");
    }
  };
  const mapped = rows.map((r) => Object.fromEntries(IMPORT_FIELDS.map(([k]) => [k, map[k] ? String(r[map[k]] ?? "").trim() : ""])));
  const usable = mapped.filter((r) => r.name || r.website);
  const importNow = async () => {
    setBusy(true);
    const r = await store.save(usable.map((x) => ({ ...x, source: "import" })));
    setBusy(false);
    if (r) {
      setDone(r);
      setFile(null);
      setRows([]);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <input ref={fileRef} type="file" hidden accept=".xlsx,.xls,.ods,.csv,.tsv,.txt" onChange={(e) => { pick(e.target.files && e.target.files[0]); e.target.value = ""; }} />
      {!rows.length ? (
        <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files && e.dataTransfer.files[0]); }}
          style={{ border: "1.5px dashed #CBD1D9", borderRadius: 8, background: "var(--ui-sunken)", padding: "36px 20px", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 10 }}>
          <div style={{ width: 44, height: 44, borderRadius: 6, background: "#fff", border: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "center", color: "#8B5CF6" }}><FileSpreadsheet size={20} /></div>
          <div style={{ ...text, fontSize: 15, fontWeight: 600, color: C.ink }}>Import companies from a spreadsheet</div>
          <div style={{ ...muted, maxWidth: "46ch" }}>Drop an Excel or CSV file here. You can check which column is which before anything is saved. Companies you already saved are skipped.</div>
          <button type="button" className="ui-btn ui-btn--primary" onClick={() => fileRef.current && fileRef.current.click()}><Upload size={15} /> Choose a file</button>
          {error ? <div role="alert" style={{ ...muted, color: C.red }}>{error}</div> : null}
          {done ? (
            <div style={{ ...muted, color: C.textInk }}>
              Imported {done.added} {done.added === 1 ? "company" : "companies"}{done.skipped ? `, skipped ${done.skipped} already saved or without a name` : ""}.{" "}
              <button type="button" className="ui-link" onClick={() => onGo("accounts")}>Open saved accounts</button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="ui-card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <div style={{ ...text, fontSize: 14, fontWeight: 600, color: C.ink, marginRight: "auto" }}>{file?.name} · {rows.length} {rows.length === 1 ? "row" : "rows"}</div>
            <button type="button" className="ui-btn ui-btn--ghost" onClick={() => { setRows([]); setFile(null); }}>Choose another file</button>
          </div>
          <div style={{ ...muted }}>Check which column holds each detail. Rows without a company name or website are left out.</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 210px), 1fr))", gap: 10 }}>
            {IMPORT_FIELDS.map(([k, label]) => (
              <label key={k} style={{ display: "flex", flexDirection: "column", gap: 4, ...text, fontSize: 12.5, color: C.slate }}>
                {label}
                <select className="ui-input" value={map[k] || ""} onChange={(e) => setMap((m) => ({ ...m, [k]: e.target.value || undefined }))}>
                  <option value="">Not in this file</option>
                  {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </label>
            ))}
          </div>
          <div className="ui-scroll" style={{ overflowX: "auto", border: `1px solid ${C.border}`, borderRadius: 6 }}>
            <table className="ui-table" style={{ minWidth: 640 }}>
              <thead><tr>{IMPORT_FIELDS.filter(([k]) => map[k]).map(([k, label]) => <th key={k}>{label}</th>)}</tr></thead>
              <tbody>
                {mapped.slice(0, 5).map((r, i) => (
                  <tr key={i}>{IMPORT_FIELDS.filter(([k]) => map[k]).map(([k]) => <td key={k} style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }}>{r[k]}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <button type="button" className="ui-btn ui-btn--primary" disabled={!usable.length || busy} onClick={importNow}>
              {busy ? "Importing…" : `Import ${usable.length} ${usable.length === 1 ? "company" : "companies"}`}
            </button>
            {rows.length > usable.length ? <span style={{ ...muted, fontSize: 12.5 }}>{rows.length - usable.length} without a name or website will be left out.</span> : null}
          </div>
        </div>
      )}
    </div>
  );
}
