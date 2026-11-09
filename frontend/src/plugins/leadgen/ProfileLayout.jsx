import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Plus, Route } from "lucide-react";
import { api } from "../../api/apiClient";
import { notice } from "../../utils/notice";
import { C, FONT_BODY } from "../../tokens";
import { Spinner } from "../../app/Loader";
import { nextTabIndex, readOpen, readTab, writeOpen, writeTab } from "./profileLayout";
import { LatestNote } from "./Notes";

// The parts the three company profiles share: tabs instead of one long scroll, sections that fold, and a bar pinned
// to the bottom with the company's journey, its newest note and Save.

const text = { fontFamily: FONT_BODY };
const muted = { ...text, fontSize: 12.5, color: C.slate, lineHeight: 1.5 };

// ---------------------------------------------------------------- tabs
export function useProfileTab(screen, ids, fallback) {
  const [tab, setTab] = useState(() => readTab(screen, ids, fallback));
  const choose = useCallback((t) => { setTab(t); writeTab(screen, t); }, [screen]);
  const shown = ids.includes(tab) ? tab : fallback;
  return [shown, choose];
}

// tabs: [{ id, label, count? }]. Sticky under the header of whatever scrolls; arrow keys move between tabs.
export function ProfileTabs({ tabs, value, onChange, label = "Profile sections", idBase, top = 0, style }) {
  const refs = useRef({});
  const onKey = (e, i) => {
    const next = nextTabIndex(i, e.key, tabs.length);
    if (next < 0) return;
    e.preventDefault();
    const t = tabs[next];
    onChange(t.id);
    refs.current[t.id]?.focus();
  };
  return (
    <div role="tablist" aria-label={label} className="ui-scroll"
      style={{ position: "sticky", top, zIndex: 2, background: "#fff", display: "flex", gap: 2, overflowX: "auto", borderBottom: `1px solid ${C.border}`, scrollbarWidth: "none", ...style }}>
      {tabs.map((t, i) => {
        const on = t.id === value;
        return (
          <button key={t.id} ref={(el) => { refs.current[t.id] = el; }} type="button" role="tab" id={`${idBase}-tab-${t.id}`} aria-controls={`${idBase}-panel-${t.id}`}
            aria-selected={on} tabIndex={on ? 0 : -1} title={t.tip || `Show ${t.label}`} onClick={() => onChange(t.id)} onKeyDown={(e) => onKey(e, i)}
            style={{ all: "unset", cursor: "pointer", flex: "none", padding: "10px 12px 9px", ...text, fontSize: 13.5, fontWeight: on ? 600 : 500, whiteSpace: "nowrap",
              color: on ? C.ink : C.slate, borderBottom: `2px solid ${on ? "var(--ui-accent)" : "transparent"}`, outlineOffset: -3 }}>
            {t.label}{t.count ? <span style={{ marginLeft: 5, fontSize: 11.5, color: C.slate, fontWeight: 500 }}>{t.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({ idBase, id, value, children, style }) {
  if (id !== value) return null;
  return <div role="tabpanel" id={`${idBase}-panel-${id}`} aria-labelledby={`${idBase}-tab-${id}`} tabIndex={0} style={{ outline: "none", ...style }}>{children}</div>;
}

// ---------------------------------------------------------------- a section that folds
// id: unique per screen and section, so the open state is remembered for it. Only the first section of a tab should pass defaultOpen.
export function Collapsible({ id, title, summary, defaultOpen = false, children, right }) {
  const [open, setOpen] = useState(() => readOpen(id, defaultOpen));
  const body = useId();
  const toggle = () => setOpen((o) => { writeOpen(id, !o); return !o; });
  return (
    <section style={{ borderBottom: `1px solid ${C.borderLight}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button type="button" aria-expanded={open} aria-controls={body} onClick={toggle} title={open ? `Fold ${title}` : `Show ${title}`}
          style={{ all: "unset", cursor: "pointer", flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8, padding: "12px 0" }}>
          <ChevronDown size={16} aria-hidden="true" style={{ flex: "none", color: C.slate, transform: open ? "none" : "rotate(-90deg)", transition: "transform .15s" }} />
          <span style={{ ...text, fontSize: 13.5, fontWeight: 600, color: C.ink, flex: "none" }}>{title}</span>
          {summary ? <span style={{ ...muted, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{summary}</span> : null}
        </button>
        {right}
      </div>
      <div id={body} hidden={!open} style={{ paddingBottom: open ? 14 : 0 }}>{open ? children : null}</div>
    </section>
  );
}

// ---------------------------------------------------------------- the journey the company is in
const PERSON_WORD = { active: "running", completed: "finished", replied: "replied", bounced: "email bounced", unsubscribed: "unsubscribed", paused: "paused", stopped: "stopped" };

export function journeyWords(j) {
  if (!j) return "Not in a journey";
  const state = j.person_status === "active" ? (j.step ? `step ${j.step}` : "running") : PERSON_WORD[j.person_status] || j.person_status || j.status;
  return `${j.name} · ${state}`;
}

export function JourneyControl({ companyId = "", accountId = "", onNewJourney, onOpenJourney }) {
  const [state, setState] = useState(null);
  const [menu, setMenu] = useState(false);
  const [journeys, setJourneys] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    if (!companyId && !accountId) return;
    try { setState(await api.companyJourneys({ companyId, accountId })); } catch { setState({ journeys: [] }); }
  }, [companyId, accountId]);
  useEffect(() => { setState(null); load(); }, [load]);
  const current = state?.journeys?.[0] || null;
  const openMenu = async () => {
    setMenu((m) => !m);
    if (!journeys) { try { setJourneys((await api.journeys()).journeys || []); } catch { setJourneys([]); } }
  };
  const add = async (j) => {
    setMenu(false);
    setBusy(true);
    try {
      const r = await api.journeyAdd({ companyId, accountId, journeyId: j.id });
      notice(`Added to ${r.journey}. Nothing is sent until the journey is running.`);
      await load();
    } catch (e) {
      notice(e.message || "It couldn't be added.");
    }
    setBusy(false);
  };
  const open = journeys ? journeys.filter((j) => j.status !== "completed") : [];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flexWrap: "wrap" }}>
      <Route size={14} color={C.slate} aria-hidden="true" style={{ flex: "none" }} />
      {current && onOpenJourney ? (
        <button type="button" onClick={() => onOpenJourney(current.id)} title={`Open the journey ${current.name}`} aria-label={`Open the journey: ${journeyWords(current)}`}
          style={{ all: "unset", cursor: "pointer", ...text, fontSize: 12.5, color: C.cobalt, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 }}>{journeyWords(current)}</button>
      ) : (
        <span style={{ ...text, fontSize: 12.5, color: current ? C.textInk : C.slate, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 }}
          title={state?.journeys?.length > 1 ? `Also in: ${state.journeys.slice(1).map((j) => j.name).join(", ")}` : undefined}>
          {state === null ? "Checking journeys…" : journeyWords(current)}
        </span>
      )}
      <div style={{ position: "relative", flex: "none" }}>
        <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" aria-haspopup="menu" aria-expanded={menu} disabled={busy} onClick={openMenu}
          title="Put this company in a journey of emails, calls and tasks">
          {busy ? <Spinner size={12} /> : <Plus size={13} />} Add to journey
        </button>
        {menu ? (
          <>
            <div onClick={() => setMenu(false)} style={{ position: "fixed", inset: 0, zIndex: 79 }} />
            <div className="ui-menu" role="menu" style={{ zIndex: 80, minWidth: 220, maxWidth: "min(320px, calc(100vw - 32px))", top: "auto", bottom: "calc(100% + 4px)", left: 0, right: "auto", maxHeight: 300, overflowY: "auto" }}>
              {journeys === null ? <div style={{ padding: 10 }}><Spinner size={14} /></div>
                : open.length ? open.map((j) => (
                  <button key={j.id} type="button" role="menuitem" className="ui-menu-item" title={`Add this company to ${j.name}`} onClick={() => add(j)}>{j.name} <span style={muted}>· {j.status}</span></button>
                )) : <div style={{ ...muted, padding: 10 }}>{journeys.length ? "Every journey has finished." : "No journeys yet."} Make one on the Journeys page.</div>}
              {onNewJourney ? <button type="button" role="menuitem" className="ui-menu-item" title="Go to the Journeys page to make a new one" onClick={() => { setMenu(false); onNewJourney(); }}><Plus size={14} /> New journey</button> : null}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- the pinned bottom bar
// Sticky to the bottom of the scrolling panel, drawer or page, so it stays in view the whole time.
export function BottomBar({ journey, note, onOpenNotes, actions }) {
  return (
    <div role="region" aria-label="Journey, latest note and save"
      style={{ position: "sticky", bottom: 0, zIndex: 3, background: "#fff", borderTop: `1px solid ${C.border}`, boxShadow: "0 -6px 16px rgba(16,24,40,.06)",
        padding: "8px 14px calc(8px + env(safe-area-inset-bottom, 0px))", display: "flex", flexDirection: "column", gap: 6 }}>
      <LatestNote note={note} onOpen={onOpenNotes} style={{ width: "100%" }} />
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "space-between" }}>
        <div style={{ minWidth: 0, flex: "1 1 200px" }}>{journey}</div>
        {actions ? <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", flex: "none" }}>{actions}</div> : null}
      </div>
    </div>
  );
}
