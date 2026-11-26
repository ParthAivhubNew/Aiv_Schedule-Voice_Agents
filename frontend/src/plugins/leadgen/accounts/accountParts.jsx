import React, { useEffect, useRef, useState } from "react";
import { TableSkeleton, TopBar } from "../../../app/Loader";
import { Lightbulb, ExternalLink, MoreHorizontal, ChevronDown, Eye, Plus, X } from "lucide-react";
import { FONT_BODY, C } from "../../../tokens";
import { askText } from "../Dialogs";
import { HOW_WORD, VIEWS_KEY, barColor, completenessTip, domainOf, emailFor, fileContact, menuSpot, phoneFor, readViews, sourceWords, tipsFor, wasLookedUp } from "./accountsLogic";

export const text = { fontFamily: FONT_BODY };
export const muted = { ...text, fontSize: 13, color: C.slate, lineHeight: 1.5 };
export function TipsCard({ account }) {
  const tips = tipsFor(account);
  if (!tips.length) return null;
  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 12px", display: "grid", gap: 8, background: "rgba(245, 158, 11, .05)" }}>
      <div style={{ ...text, fontSize: 13.5, fontWeight: 600, color: C.ink, display: "flex", alignItems: "center", gap: 6 }}>
        <Lightbulb size={14} color={C.warning} /> How to get this to 100%
      </div>
      {tips.map(([title, body]) => (
        <div key={title} style={{ ...muted, fontSize: 12.5 }}><strong style={{ color: C.textInk }}>{title}.</strong> {body}</div>
      ))}
    </div>
  );
}


export function Loading({ store }) {
  if (store.error) return <div role="alert" style={{ ...muted, color: C.red }}>{store.error}</div>;
  return (
    <div className="ui-card" style={{ overflow: "hidden", position: "relative" }}>
      <TopBar />
      <TableSkeleton rows={8} cols={6} label="Loading your saved accounts" />
    </div>
  );
}

export function SiteLink({ account }) {
  const d = account.domain || domainOf(account.website);
  if (!d) return null;
  return (
    <a href={account.website || `https://${d}`} target="_blank" rel="noreferrer" style={{ color: C.slate, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 3 }}>
      {d} <ExternalLink size={11} />
    </a>
  );
}

export function NewTag() {
  return <span title="We found this: it was empty before" style={{ ...text, marginLeft: 6, fontSize: 10.5, fontWeight: 700, color: C.green, background: C.successSoft, borderRadius: 4, padding: "1px 5px" }}>NEW</span>;
}

// A cell with nothing to show leaves the value empty: whether we have looked is told by a hover note and the Check column, never in place of the data.
export function Empty({ a, field }) {
  if (field && (a.on_file || []).includes(field)) {
    return <span title="Our records hold this. Open the company to see it." style={{ ...text, fontSize: 11.5, fontWeight: 600, color: C.infoInk, background: C.infoSoft, borderRadius: 4, padding: "1px 6px" }}>On file</span>;
  }
  return <span title={wasLookedUp(a) ? "We looked and found nothing." : "Nothing here yet. Use Get contacts to look for it."} style={{ color: C.slateLight }}>—</span>;
}

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
export function Completeness({ c, wide = false }) {
  if (!c) return null;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }} title={completenessTip(c)} aria-label={completenessTip(c)}>
      <span style={{ width: wide ? 120 : 48, height: 6, borderRadius: 3, background: C.border, overflow: "hidden", display: "inline-block" }}>
        <span style={{ display: "block", height: "100%", width: `${c.pct}%`, background: barColor(c.pct) }} />
      </span>
      <span style={{ ...text, fontSize: 12, color: C.textInk, fontVariantNumeric: "tabular-nums" }}>{c.pct}%</span>
    </span>
  );
}

// "What we found": every contact detail with where it came from -- yours, found by us, or still missing -- and how complete it is now.
export function FoundSummary({ account, store }) {
  const f = account.found || { filled: [], extra: {}, had: [], before_pct: 0, after_pct: 0 };
  const looked = wasLookedUp(account);
  const extra = [["people", "people"], ["emails", "emails"], ["phones", "phone numbers"], ["socials", "social profiles"], ["offices", "other offices"]]
    .filter(([k]) => f.extra?.[k]).map(([k, label]) => `${f.extra[k]} ${label}`);
  const rows = [["website", "Website"], ["phone", "Phone"], ["email", "Email"], ["contact_name", "Contact"]].map(([k, label]) => {
    const made = (f.filled || []).find((x) => x.field === k);
    const value = (account[k] || "").trim();
    if (made && value) return { k, label, value, tone: "new", badge: `Found by us · ${HOW_WORD[made.how] || made.how}` };
    if (value && (account.from_record || []).includes(k)) return { k, label, value, tone: "yours", badge: "From our records" };
    if (value) return { k, label, value, tone: "yours", badge: account.source === "import" ? "From your file" : account.source === "manual" ? "You added" : "From the search" };
    const researched = k === "email" ? emailFor(account) : k === "phone" ? phoneFor(account) : null;
    if (researched?.fromResearch) return { k, label, value: researched.text, tone: "research", badge: "Found by research · not saved yet", use: true };
    const hint = k === "contact_name" ? fileContact(account) : "";
    if (hint) return { k, label, value: hint, tone: "hint", badge: "In your file, not saved as the contact yet" };
    return { k, label, value: "", tone: "missing", badge: looked ? "Not found" : "Not checked yet" };
  });
  const tone = { research: ["#1D4ED8", "#DBEAFE"], new: ["#15803D", "#DCFCE7"], yours: [C.slate, "#F1F5F9"], hint: ["#92400E", "#FFFBEB"], missing: [C.slateLight, "#F8FAFC"] };
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
            <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
              <span style={{ fontSize: 11.5, fontWeight: 600, color: tone[r.tone][0], background: tone[r.tone][1], borderRadius: 4, padding: "2px 7px", whiteSpace: "nowrap" }}>{r.badge}</span>
              {r.use && store ? <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" title={`Save this ${r.label.toLowerCase()} on the company`} onClick={() => store.update(account.id, { [r.k]: r.value })}>Use this</button> : null}
            </span>
          </React.Fragment>
        ))}
      </div>
      {extra.length ? <div style={{ ...text, fontSize: 12.5, color: C.textInk }}>Also found: {extra.join(", ")}. See the research below.</div> : null}
      <div style={{ ...text, fontSize: 12, color: C.slateLight }}>
        {tried.length ? `Checked: ${tried.join(", ")}.` : "Not checked yet."}
        {missing.length ? ` ${missing.length === 1 ? "One detail is" : `${missing.length} details are`} still missing${looked ? "" : ". Use Find contact on the Research tab to search for them"}.` : ""}
        {` The ${f.after_pct}% counts four details: website, phone, email and contact, 25% each.`}
      </div>
    </section>
  );
}
// A small "More" button with a menu of rarer actions, opened just under it in the window so the table never clips it.
export function MoreMenu({ items }) {
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
  const list = items.filter(Boolean);
  if (!list.length) return null;
  return (
    <div ref={box} style={{ position: "relative" }}>
      <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((o) => !o)}><MoreHorizontal size={14} /> More</button>
      {open ? (
        <div role="menu" className="ui-card" style={{ position: "fixed", ...menuSpot(box, "right"), zIndex: 60, minWidth: 220, padding: 6, boxShadow: "0 12px 32px rgba(20,24,40,.16)" }}>
          {list.map((it) => (
            <button key={it.label} type="button" role="menuitem" className="ui-btn ui-btn--ghost ui-btn--sm" disabled={it.disabled} title={it.title}
              style={{ width: "100%", justifyContent: "flex-start", minHeight: 36, color: it.danger ? C.red : undefined }} onClick={() => { setOpen(false); it.onClick(); }}>{it.label}</button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ViewsMenu({ current, onApply, onToast }) {
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
    const name = await askText({ title: "Save this view", label: "A name for these columns, this tab and this filter, for example Ready to call", confirm: "Save view", maxLength: 40 });
    if (!name) return;
    const n = name.trim();
    keep([{ name: n, hidden: current.hidden, tab: current.tab, filter: current.filter }, ...views.filter((v) => v.name.toLowerCase() !== n.toLowerCase())].slice(0, 20));
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
          {[{ name: "Default view", hidden: [], tab: "", filter: "" }, ...views].map((v) => (
            <div key={v.name} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <button type="button" role="menuitem" className="ui-btn ui-btn--ghost ui-btn--sm" style={{ flex: 1, justifyContent: "flex-start", fontWeight: (active || "Default view") === v.name ? 700 : 400 }}
                onClick={() => { onApply(v); setActive(v.name === "Default view" ? "" : v.name); setOpen(false); }}>{v.name}</button>
              {v.name !== "Default view" ? (
                <button type="button" className="ui-icon-btn" aria-label={`Delete the view ${v.name}`} title="Delete this view" onClick={() => { keep(views.filter((x) => x.name !== v.name)); if (active === v.name) setActive(""); onToast(`Deleted the view ${v.name}.`); }}><X size={13} /></button>
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
