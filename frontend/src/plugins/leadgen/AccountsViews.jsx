import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { Building2, Check, ExternalLink, FileSpreadsheet, Plus, RefreshCw, Search, Sparkles, Trash2, Upload, X } from "lucide-react";
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
  return Boolean(r && (r.overview || r.people?.length || r.team?.length || r.phones?.length || r.emails?.length || r.other_offices?.length || Object.keys(r.socials || {}).length));
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

// ---------------------------------------------------------------- Saved Accounts
const ACCOUNT_CHIPS = [
  ["all", "All", () => true],
  ["contact", "Has contact", (a) => a.contact_name || a.email],
  ["researched", "Researched", (a) => a.researched_at],
];

export function AccountsView({ store, onOpen, onAdd, onGo }) {
  const [filter, setFilter] = useState("");
  const [scope, setScope] = useState("all");
  if (store.loading || (store.error && !store.accounts.length)) return <Loading store={store} />;
  if (!store.accounts.length) {
    return (
      <EmptyState icon={Building2} title="No saved accounts yet" body="Find companies with AI Lead Scout, import a spreadsheet, or add one by hand.">
        <button type="button" className="ui-btn ui-btn--primary" onClick={() => onGo("find_leads")}><Search size={15} /> Find companies</button>
        <button type="button" className="ui-btn ui-btn--ghost" onClick={onAdd}><Plus size={15} /> Add by hand</button>
      </EmptyState>
    );
  }
  const q = filter.trim().toLowerCase();
  const scopePred = ACCOUNT_CHIPS.find(([id]) => id === scope)[2];
  const shown = store.accounts
    .filter(scopePred)
    .filter((a) => !q || [a.name, a.domain, a.contact_name, a.industry, a.region].some((v) => String(v || "").toLowerCase().includes(q)));
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
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {ACCOUNT_CHIPS.map(([id, label]) => (
          <button key={id} type="button" onClick={() => setScope(id)}
            className={`ui-btn ui-btn--sm ${scope === id ? "ui-btn--primary" : "ui-btn--ghost"}`}>
            {label}
          </button>
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

// ---------------------------------------------------------------- Account Dossiers
function Dossier({ account, store }) {
  const r = account.research;
  const reg = account.registry;
  if (!account.researched_at) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span style={{ ...muted, flex: "1 1 220px" }}>Not researched yet. Research searches the web for its details, people and sources.</span>
        <ResearchButton store={store} account={account} />
      </div>
    );
  }
  if (!hasFindings(account) && !reg) {
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
          <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ ...text, fontSize: 13.5, fontWeight: 600, color: C.ink, marginRight: "auto" }}>Research</div>
              {live.researched_at ? <ResearchButton store={store} account={live} /> : null}
            </div>
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
        <AccountFieldGrid fields={ACCOUNT_FIELDS.slice(0, 6)} form={form} setForm={setForm} autoFocusFirst />
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

export function ImportView({ store, onGo }) {
  const fileRef = useRef(null);
  const [file, setFile] = useState(null);
  const [sheets, setSheets] = useState(null); // { sheetName: rawRecords[] }
  const [sheetNames, setSheetNames] = useState([]); // sheets that actually have rows
  const [activeSheet, setActiveSheet] = useState("");
  const [rows, setRows] = useState([]);
  const [map, setMap] = useState({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const headers = rows.length ? Object.keys(rows[0]) : [];

  const loadSheet = (allSheets, sName) => {
    const data = (allSheets[sName] || []).filter((r) => Object.values(r).some((v) => String(v).trim()));
    setActiveSheet(sName);
    setRows(data);
    setMap(data.length ? guessColumns(Object.keys(data[0])) : {});
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
      setSheets(allSheets);
      setSheetNames(withRows);
      loadSheet(allSheets, withRows[0]);
    } catch (e) {
      setFile(null);
      setSheets(null);
      setSheetNames([]);
      setRows([]);
      setError(e.message || "Couldn't read that file. Use .xlsx, .xls, .ods, .csv, .tsv or .json.");
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
      setSheets(null);
      setSheetNames([]);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <input ref={fileRef} type="file" hidden accept=".xlsx,.xls,.ods,.csv,.tsv,.txt,.json" onChange={(e) => { pick(e.target.files && e.target.files[0]); e.target.value = ""; }} />
      {!rows.length ? (
        <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files && e.dataTransfer.files[0]); }}
          style={{ border: "1.5px dashed #CBD1D9", borderRadius: 8, background: "var(--ui-sunken)", padding: "36px 20px", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 10 }}>
          <div style={{ width: 44, height: 44, borderRadius: 6, background: "#fff", border: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "center", color: "#8B5CF6" }}><FileSpreadsheet size={20} /></div>
          <div style={{ ...text, fontSize: 15, fontWeight: 600, color: C.ink }}>Import companies from a file</div>
          <div style={{ ...muted, maxWidth: "46ch" }}>Drop an Excel, CSV or JSON file here. Every sheet in a workbook is read, not just the first, and you can check which column is which before anything is saved. Companies you already saved are skipped.</div>
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
            <button type="button" className="ui-btn ui-btn--ghost" onClick={() => { setRows([]); setFile(null); setSheets(null); setSheetNames([]); }}>Choose another file</button>
          </div>
          {sheetNames.length > 1 ? (
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <span style={{ ...muted, fontSize: 12.5 }}>Sheet:</span>
              {sheetNames.map((n) => (
                <button key={n} type="button" onClick={() => loadSheet(sheets, n)}
                  className={`ui-btn ui-btn--sm ${activeSheet === n ? "ui-btn--primary" : "ui-btn--ghost"}`}>{n}</button>
              ))}
            </div>
          ) : null}
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
