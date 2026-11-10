import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Plus, Route } from "lucide-react";
import { api } from "../../api/apiClient";
import { notice } from "../../utils/notice";
import { C, FONT_BODY } from "../../tokens";
import { Spinner } from "../../app/Loader";
import { nextTabIndex, readOpen, readTab, writeOpen, writeTab } from "./profileState";
import { LatestNote } from "./Notes";
import { openJourney } from "../../utils/openJourney";
import { JOURNEY_AFTER, JOURNEY_NONE, JOURNEY_WHY, addedMessage, journeyLine, journeyOption } from "./activityLogic";

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
        <button type="button" aria-expanded={open} aria-controls={body} onClick={toggle} title={open ? "Fold this section away" : "Open this section"}
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
// companyName: for the message after adding. onOpenJourney / onNewJourney: how this screen opens Journeys; without them the Leads app is asked to.
export function JourneyControl({ companyId = "", accountId = "", companyName = "", onNewJourney, onOpenJourney, onAdded }) {
  const [state, setState] = useState(null);
  const [menu, setMenu] = useState(false);
  const [journeys, setJourneys] = useState(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const menuRef = useRef(null);
  const btnRef = useRef(null);
  const helpId = useId();
  const load = useCallback(async () => {
    if (!companyId && !accountId) return;
    try { setState(await api.companyJourneys({ companyId, accountId })); } catch { setState({ journeys: [] }); }
  }, [companyId, accountId]);
  useEffect(() => { setState(null); setProblem(""); load(); }, [load]);
  const close = useCallback(() => { setMenu(false); btnRef.current?.focus(); }, []);
  useEffect(() => {
    if (!menu) return undefined;
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    window.addEventListener("keydown", onKey, true);
    menuRef.current?.querySelector("button")?.focus();
    return () => window.removeEventListener("keydown", onKey, true);
  }, [menu, journeys, close]);
  const current = state?.journeys?.[0] || null;
  const showJourney = (id) => (onOpenJourney && id ? onOpenJourney(id) : openJourney(id));
  const newJourney = () => { setMenu(false); if (onNewJourney) onNewJourney(); else openJourney(""); };
  const openMenu = async () => {
    setProblem("");
    setMenu((m) => !m);
    if (!journeys) { try { setJourneys((await api.journeys()).journeys || []); } catch { setJourneys([]); } }
  };
  const add = async (j) => {
    setMenu(false);
    setBusy(true);
    try {
      const r = await api.journeyAdd({ companyId, accountId, journeyId: j.id });
      notice(addedMessage(companyName, { ...r, status: r.status || j.status }));
      await load();
      onAdded?.();
    } catch (e) {
      const why = e.message || "It couldn't be added.";
      setProblem(why);
      notice(`Not added to ${j.name}. ${why}`);
    }
    setBusy(false);
  };
  const open = journeys ? journeys.filter((j) => j.status !== "completed") : [];
  const others = (state?.journeys || []).slice(1).map((j) => j.name);
  const line = state === null ? "Checking journeys…" : journeyLine(current);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flexWrap: "wrap" }}>
        <Route size={14} color={C.slate} aria-hidden="true" style={{ flex: "none" }} />
        {current ? (
          <button type="button" onClick={() => showJourney(current.id)} title={`Open ${current.name} on the Journeys page: its steps, who is in it and what was sent.${others.length ? ` Also in: ${others.join(", ")}.` : ""}`}
            aria-label={`${line}. Open this journey`}
            style={{ all: "unset", cursor: "pointer", ...text, fontSize: 12.5, color: C.cobalt, textDecoration: "underline", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 260, minWidth: 0 }}>{line}</button>
        ) : (
          <span title={state === null ? undefined : JOURNEY_WHY} aria-describedby={state === null ? undefined : helpId}
            style={{ ...text, fontSize: 12.5, color: C.slate, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220, cursor: state === null ? "default" : "help" }}>
            {line}
          </span>
        )}
        <span id={helpId} hidden>{JOURNEY_WHY}</span>
        <div style={{ position: "relative", flex: "none" }}>
          <button ref={btnRef} type="button" className="ui-btn ui-btn--secondary ui-btn--sm" aria-haspopup="menu" aria-expanded={menu} disabled={busy} onClick={openMenu}
            title={`${JOURNEY_WHY} Needs an email address for the company.`} aria-describedby={helpId}>
            {busy ? <Spinner size={12} /> : <Plus size={13} />} Add to an email journey
          </button>
          {menu ? (
            <>
              <div onClick={() => setMenu(false)} style={{ position: "fixed", inset: 0, zIndex: 79 }} />
              <div ref={menuRef} className="ui-menu" role="menu" aria-label="Email journeys"
                style={{ zIndex: 80, width: "min(320px, calc(100vw - 32px))", top: "auto", bottom: "calc(100% + 4px)", left: 0, right: "auto", maxHeight: 360, overflowY: "auto" }}>
                <div style={{ ...muted, fontSize: 12, padding: "8px 10px 6px" }}>{JOURNEY_WHY}</div>
                {journeys === null ? <div role="status" style={{ padding: 10, display: "flex", gap: 6, alignItems: "center", ...muted }}><Spinner size={14} /> Loading your journeys</div>
                  : open.length ? (
                    <>
                      {open.map((j) => (
                        <button key={j.id} type="button" role="menuitem" className="ui-menu-item" title={`Add ${companyName || "this company"} to ${j.name}. ${JOURNEY_AFTER}`}
                          onClick={() => add(j)} style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 1, height: "auto", minHeight: 40, padding: "6px 10px", whiteSpace: "normal", textAlign: "left", width: "100%", boxSizing: "border-box" }}>
                          <span style={{ overflowWrap: "anywhere" }}>{j.name}</span>
                          <span style={{ ...muted, fontSize: 11.5 }}>{journeyOption(j)}</span>
                        </button>
                      ))}
                      <div style={{ ...muted, fontSize: 12, padding: "6px 10px", borderTop: `1px solid ${C.borderLight}` }}>{JOURNEY_AFTER}</div>
                    </>
                  ) : <div style={{ ...muted, padding: "4px 10px 8px" }}>{journeys.length ? "Every journey you have has finished. Create a new one in Journeys." : JOURNEY_NONE}</div>}
                <button type="button" role="menuitem" className="ui-menu-item" title="Open Journeys to create a new one" onClick={newJourney}><Plus size={14} /> Create a journey in Journeys</button>
              </div>
            </>
          ) : null}
        </div>
      </div>
      {problem ? <div role="alert" style={{ ...muted, fontSize: 12, color: C.red }}>Not added: {problem}</div> : null}
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
