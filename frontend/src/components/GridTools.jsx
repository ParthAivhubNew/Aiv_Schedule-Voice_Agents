import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Columns3, Copy, RotateCcw, Undo2, X } from "lucide-react";

// Column tools for any table: sort, filter, rename, pin, hide and resize each column, a Default / My layout switch, Undo,
// and a click on a cut-off cell to read all of it.
// Put <GridTools id="a-name-for-this-table" /> directly before the element that holds the table (or before the table itself).
// It finds that table by itself, so the table's own code stays as it is. Columns are told apart by their header text, and the
// layout is kept per table in this browser. Hiding, pinning, widths and names are written as CSS on the table's columns, and
// a filter marks rows with an attribute, so all of it survives the table re-rendering. Sort and filter work on the rows the
// table is showing (one page), and sorting happens inside each group when the table has full-width group rows.
const STORE = "aivhub_grid_v1:";
const EMPTY = { hidden: [], pinned: [], widths: {}, names: {}, mode: "mine" };
const MIN_WIDTH = 60;
let rowSeq = 0;

const load = (id) => {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE + id) || "null");
    return saved ? { ...EMPTY, ...saved } : EMPTY;
  } catch { return EMPTY; }
};
const save = (id, layout) => {
  try { localStorage.setItem(STORE + id, JSON.stringify(layout)); } catch { /* the layout just isn't remembered */ }
};

const svg = (paths) => `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const ICONS = {
  sort: svg('<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>'),
  filter: svg('<path d="M10 20a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341L21.74 4.67A1 1 0 0 0 21 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14z"/>'),
  rename: svg('<path d="M21.17 6.81a1 1 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z"/><path d="m15 5 4 4"/>'),
  pin: svg('<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>'),
  hide: svg('<path d="M10.73 5.08A10.8 10.8 0 0 1 22 12a10.7 10.7 0 0 1-1.5 2.5"/><path d="M14.08 14.16a3 3 0 0 1-4.24-4.24"/><path d="M17.48 17.5A10.75 10.75 0 0 1 2 12a10.75 10.75 0 0 1 4.5-5.14"/><path d="m2 2 20 20"/>'),
};
const TOOL_NAMES = { sort: "Sort", filter: "Filter", rename: "Rename", pin: "Pin", hide: "Hide" };

const headCells = (table) => (table && table.tHead && table.tHead.rows[0] ? Array.from(table.tHead.rows[0].cells) : []);
const labelOf = (cell) => (cell.textContent || "").replace(/\s+/g, " ").trim();
const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const isGroupRow = (r) => r.cells.length === 1 && r.cells[0].colSpan > 1;

// Adds the tool buttons and the resize handle to a header cell, once.
function decorate(th) {
  if (th.querySelector(":scope > .gt-tools")) return;
  const cs = getComputedStyle(th);
  if (cs.position === "static") th.style.position = "relative";
  th.style.setProperty("--gt-fs", cs.fontSize);
  th.style.setProperty("--gt-th-bg", /rgba\(.*,\s*0\)|transparent/.test(cs.backgroundColor) ? "var(--ui-surface, #fff)" : cs.backgroundColor);
  const tools = document.createElement("span");
  tools.className = "gt-tools";
  tools.innerHTML = Object.keys(ICONS).map((k) => `<button type="button" data-gt-act="${k}" aria-label="${TOOL_NAMES[k]} this column">${ICONS[k]}</button>`).join("");
  const handle = document.createElement("span");
  handle.className = "gt-handle";
  handle.setAttribute("aria-hidden", "true");
  th.append(tools, handle);
}

const numeric = (s) => {
  const t = s.replace(/[£$€%,\s]/g, "");
  return /^-?\d+(\.\d+)?$/.test(t) ? parseFloat(t) : null;
};
const compare = (a, b) => {
  if (!a || !b) return a === b ? 0 : !a ? 1 : -1; // an empty cell goes last either way (the caller does not flip these)
  const x = numeric(a);
  const y = numeric(b);
  if (x !== null && y !== null) return x - y;
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
};

// Marks the rows a filter hides and puts each run of rows in the sort order. Returns how many rows show.
function applyView(table, labels, sort, filters) {
  const body = table.tBodies[0];
  if (!body) return { shown: 0, total: 0 };
  const rows = Array.from(body.rows);
  const active = Object.entries(filters).filter(([, v]) => v).map(([label, v]) => [labels.indexOf(label), v.toLowerCase()]).filter(([i]) => i >= 0);
  let shown = 0;
  let total = 0;
  rows.forEach((r) => {
    if (isGroupRow(r)) return;
    total += 1;
    if (r.dataset.gtI === undefined) r.dataset.gtI = String(rowSeq++);
    const ok = active.every(([i, v]) => r.cells[i] && (r.cells[i].textContent || "").toLowerCase().includes(v));
    if (ok) { shown += 1; if (r.hasAttribute("data-gt-off")) r.removeAttribute("data-gt-off"); } else if (!r.hasAttribute("data-gt-off")) r.setAttribute("data-gt-off", "1");
  });
  const col = sort ? labels.indexOf(sort.label) : -1;
  if (col < 0 && !table.dataset.gtSorted) return { shown, total };
  const runs = [];
  let cur = [];
  rows.forEach((r) => { if (isGroupRow(r)) { if (cur.length) runs.push(cur); cur = []; } else cur.push(r); });
  if (cur.length) runs.push(cur);
  runs.forEach((run) => {
    const want = col >= 0
      ? [...run].sort((a, b) => {
        const x = (a.cells[col] ? a.cells[col].textContent : "").trim();
        const y = (b.cells[col] ? b.cells[col].textContent : "").trim();
        if (!x || !y) return compare(x, y);
        return sort.dir === "desc" ? -compare(x, y) : compare(x, y);
      })
      : [...run].sort((a, b) => Number(a.dataset.gtI) - Number(b.dataset.gtI)); // sort switched off: back to the order the table gave
    if (want.every((r, i) => r === run[i])) return;
    const anchor = run[run.length - 1].nextSibling;
    want.forEach((r) => body.insertBefore(r, anchor));
  });
  if (col >= 0) table.dataset.gtSorted = "1"; else delete table.dataset.gtSorted;
  return { shown, total };
}

export function GridTools({ id, className = "" }) {
  const bar = useRef(null);
  const btn = useRef(null);
  const [table, setTable] = useState(null);
  const [labels, setLabels] = useState([]); // header text of each column; "" for a column with none (a tick box, say)
  const [layout, setLayout] = useState(() => load(id));
  const [sort, setSort] = useState(null); // { label, dir }
  const [filters, setFilters] = useState({}); // { label: text }
  const [view, setView] = useState({ shown: 0, total: 0 });
  const [lefts, setLefts] = useState({}); // where each pinned column sticks, from the left
  const [tick, setTick] = useState(0); // bumps when the table's size changes, so pinned columns are measured again
  const [menu, setMenu] = useState(null); // { top, right } while the column list is open
  const [peek, setPeek] = useState(null); // { x, y, label, text } while a cut-off cell is open
  const [pop, setPop] = useState(null); // { kind: "filter" | "rename", label, x, y, value } while a header box is open
  const [copied, setCopied] = useState(false);
  const [histLen, setHistLen] = useState(0);
  const labelsRef = useRef(labels);
  labelsRef.current = labels;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const viewRef = useRef({ sort, filters });
  viewRef.current = { sort, filters };
  const history = useRef([]);

  // Every change to the layout goes through here, so Undo can step back through them.
  const change = (fn, record = true) => {
    const prev = layoutRef.current;
    if (record) { history.current = [...history.current.slice(-29), prev]; setHistLen(history.current.length); }
    const next = { ...fn(prev), mode: "mine" };
    layoutRef.current = next;
    setLayout(next);
  };
  const undo = () => {
    const prev = history.current.pop();
    setHistLen(history.current.length);
    if (prev) { layoutRef.current = prev; setLayout(prev); }
  };
  const toggle = (key, label) => change((l) => ({ ...l, [key]: l[key].includes(label) ? l[key].filter((x) => x !== label) : [...l[key], label] }));
  const eff = useMemo(() => (layout.mode === "default" ? EMPTY : layout), [layout]);
  const shownName = (label) => eff.names[label] || label;

  // Find the table that follows this bar, and look again whenever the page around it changes.
  useEffect(() => {
    const el = bar.current;
    if (!el || !el.parentElement) return undefined;
    let raf = 0;
    const find = () => {
      raf = 0;
      const next = el.nextElementSibling;
      const found = next ? (next.tagName === "TABLE" ? next : next.querySelector("table")) : null;
      setTable((prev) => (prev === found ? prev : found));
    };
    const mo = new MutationObserver(() => { if (!raf) raf = requestAnimationFrame(find); });
    mo.observe(el.parentElement, { childList: true, subtree: true });
    find();
    return () => { mo.disconnect(); cancelAnimationFrame(raf); };
  }, []);

  // Read the headers, add the tools to them, and keep doing so when the table redraws.
  useEffect(() => {
    if (!table) { setLabels([]); return undefined; }
    table.dataset.gt = id;
    let raf = 0;
    const read = () => {
      raf = 0;
      const cells = headCells(table);
      cells.forEach((c) => { if (labelOf(c)) decorate(c); });
      const next = cells.map(labelOf);
      setLabels((prev) => (sameList(prev, next) ? prev : next));
      const v = applyView(table, next, viewRef.current.sort, viewRef.current.filters);
      setView((prev) => (prev.shown === v.shown && prev.total === v.total ? prev : v));
    };
    const mo = new MutationObserver(() => { if (!raf) raf = requestAnimationFrame(read); });
    mo.observe(table, { childList: true, subtree: true, characterData: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => setTick((n) => n + 1)) : null;
    if (ro) ro.observe(table);
    read();
    return () => { mo.disconnect(); if (ro) ro.disconnect(); cancelAnimationFrame(raf); delete table.dataset.gt; };
  }, [table, id]);

  // A new sort or filter is applied at once.
  useEffect(() => {
    if (!table) return;
    const v = applyView(table, labels, sort, filters);
    setView((prev) => (prev.shown === v.shown && prev.total === v.total ? prev : v));
  }, [table, labels, sort, filters]);

  useEffect(() => { save(id, layout); }, [id, layout]);

  // Show each header's own state on its buttons: sorted, filtered, pinned, renamed.
  useEffect(() => {
    headCells(table).forEach((cell, i) => {
      const label = labels[i];
      const state = {
        sort: Boolean(sort && sort.label === label),
        filter: Boolean(filters[label]),
        pin: eff.pinned.includes(label),
      };
      cell.dataset.gtPinned = state.pin ? "1" : "";
      cell.dataset.gtDir = state.sort ? sort.dir : "";
      if (eff.names[label]) cell.dataset.gtName = eff.names[label]; else delete cell.dataset.gtName;
      Object.entries(state).forEach(([act, on]) => {
        const b = cell.querySelector(`:scope > .gt-tools [data-gt-act="${act}"]`);
        if (!b) return;
        b.setAttribute("aria-pressed", on ? "true" : "false");
        const verb = act === "sort" ? (on ? (sort.dir === "asc" ? "Sorted A to Z. Sort Z to A" : "Sorted Z to A. Clear the sort") : "Sort this column") : act === "filter" ? "Filter this column" : on ? "Unpin this column" : "Pin this column";
        b.setAttribute("aria-label", verb);
      });
    });
  }, [table, labels, sort, filters, eff.pinned, eff.names]);

  // A pinned column sticks after the columns pinned before it (and any column the table already keeps in view).
  useLayoutEffect(() => {
    if (!table) return;
    let acc = 0;
    const next = {};
    headCells(table).forEach((cell, i) => {
      const label = labels[i];
      if (label && eff.hidden.includes(label)) return;
      const w = cell.getBoundingClientRect().width;
      if (label && eff.pinned.includes(label)) { next[i] = acc; acc += w; return; }
      const cs = getComputedStyle(cell);
      if (cs.position === "sticky" && cs.left !== "auto") acc += w;
    });
    setLefts((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  }, [table, labels, eff, tick]);

  // Clicks and drags on the table: the header buttons, the resize handle, and a cut-off cell.
  useEffect(() => {
    if (!table) return undefined;
    const indexOf = (cell) => Array.from(cell.parentElement.children).indexOf(cell);
    const onClick = (e) => {
      const t = e.target;
      const act = t.closest && t.closest("[data-gt-act]");
      if (act && table.contains(act)) {
        e.preventDefault();
        e.stopPropagation();
        const label = labelsRef.current[indexOf(act.closest("th"))];
        if (!label) return;
        const kind = act.dataset.gtAct;
        if (kind === "pin" || kind === "hide") { toggle(kind === "pin" ? "pinned" : "hidden", label); return; }
        if (kind === "sort") {
          setSort((s) => (!s || s.label !== label ? { label, dir: "asc" } : s.dir === "asc" ? { label, dir: "desc" } : null));
          return;
        }
        const r = act.getBoundingClientRect();
        const value = kind === "filter" ? (viewRef.current.filters[label] || "") : (layoutRef.current.names[label] || "");
        setMenu(null);
        setPeek(null);
        setPop({ kind, label, value, x: Math.max(8, Math.min(r.left - 120, window.innerWidth - 288)), y: r.bottom + 6 });
        return;
      }
      if (t.closest && t.closest(".gt-handle")) { e.stopPropagation(); return; }
      const td = t.closest && t.closest("tbody td");
      if (!td || !table.contains(td) || t.closest("a,button,input,select,textarea,label,[role=button]")) return;
      if (window.getSelection && String(window.getSelection())) return;
      const cut = [td, ...td.querySelectorAll("*")].some((n) => n.scrollWidth > n.clientWidth + 1);
      const text = (td.innerText || "").trim();
      if (!cut || !text) return;
      e.preventDefault();
      e.stopPropagation(); // a row that opens something on click stays shut: the click was for reading the cell
      const r = td.getBoundingClientRect();
      setCopied(false);
      setPop(null);
      setPeek({ x: Math.max(8, Math.min(r.left, window.innerWidth - 448)), y: r.bottom + 4, label: labelsRef.current[indexOf(td)] || "", text });
    };
    const onDown = (e) => {
      const h = e.target.closest && e.target.closest(".gt-handle");
      if (!h) return;
      const th = h.closest("th");
      const label = labelsRef.current[indexOf(th)];
      if (!label) return;
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startW = th.getBoundingClientRect().width;
      history.current = [...history.current.slice(-29), layoutRef.current]; // one Undo step for the whole drag
      setHistLen(history.current.length);
      h.classList.add("on");
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      const move = (ev) => {
        const w = Math.max(MIN_WIDTH, Math.round(startW + ev.clientX - startX));
        change((l) => ({ ...l, widths: { ...l.widths, [label]: w } }), false);
      };
      const up = () => {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
        h.classList.remove("on");
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    };
    const onDouble = (e) => {
      const h = e.target.closest && e.target.closest(".gt-handle");
      if (!h) return;
      const label = labelsRef.current[indexOf(h.closest("th"))];
      if (label) change((l) => { const widths = { ...l.widths }; delete widths[label]; return { ...l, widths }; });
    };
    table.addEventListener("click", onClick, true);
    table.addEventListener("mousedown", onDown, true);
    table.addEventListener("dblclick", onDouble, true);
    return () => {
      table.removeEventListener("click", onClick, true);
      table.removeEventListener("mousedown", onDown, true);
      table.removeEventListener("dblclick", onDouble, true);
    };
  // change() and toggle() only use refs and state setters, so the first ones stay correct
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table]);

  // Close the column list, a header box or the open cell on a click elsewhere, Escape, or a scroll.
  useEffect(() => {
    if (!menu && !peek && !pop) return undefined;
    const close = () => { setMenu(null); setPeek(null); setPop(null); };
    const inside = (e) => e.target.closest && e.target.closest(".gt-menu, .gt-peek, .gt-pop");
    const away = (e) => { if (!inside(e) && !(e.target.closest && e.target.closest(".gt-btn, [data-gt-act]"))) close(); };
    const esc = (e) => { if (e.key === "Escape") close(); };
    const scrolled = (e) => { if (!inside(e)) close(); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    window.addEventListener("scroll", scrolled, true);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); window.removeEventListener("scroll", scrolled, true); };
  }, [menu, peek, pop]);

  const css = useMemo(() => {
    const cell = (i, tag) => `[data-gt="${id}"] ${tag}:not([colspan]):nth-child(${i + 1})`;
    const rules = ['[data-gt="' + id + '"] tbody tr[data-gt-off]{display:none !important}'];
    labels.forEach((label, i) => {
      if (!label) return;
      const both = `${cell(i, "th")},${cell(i, "td")}`;
      if (eff.hidden.includes(label)) { rules.push(`${both}{display:none !important}`); return; }
      const w = eff.widths[label];
      if (w) rules.push(`${both}{width:${w}px !important;min-width:${w}px !important;max-width:${w}px !important;box-sizing:border-box;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}`);
      if (eff.pinned.includes(label) && lefts[i] !== undefined) {
        rules.push(`${both}{position:sticky !important;left:${lefts[i]}px !important;box-shadow:1px 0 0 var(--ui-line,#E3E6EB)}`);
        rules.push(`${cell(i, "td")}{background:var(--gt-bg,#fff);z-index:3}${cell(i, "th")}{z-index:6 !important}`);
      }
    });
    return rules.join("\n");
  }, [id, labels, eff, lefts]);

  const named = labels.map((label, i) => ({ label, i })).filter((c) => c.label);
  const hiddenCount = named.filter((c) => eff.hidden.includes(c.label)).length;
  const filterCount = Object.values(filters).filter(Boolean).length;
  const customised = layout.hidden.length > 0 || layout.pinned.length > 0 || Object.keys(layout.widths).length > 0 || Object.keys(layout.names).length > 0;
  const ready = Boolean(table) && named.length > 0;
  const openMenu = () => {
    if (menu) { setMenu(null); return; }
    const r = btn.current.getBoundingClientRect();
    setPop(null);
    setMenu({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
  };
  const copy = () => {
    if (!peek || !navigator.clipboard) return;
    navigator.clipboard.writeText(peek.text).then(() => setCopied(true), () => {});
  };
  const submitPop = (e) => {
    e.preventDefault();
    const value = pop.value.trim();
    if (pop.kind === "filter") setFilters((f) => ({ ...f, [pop.label]: value }));
    else change((l) => { const names = { ...l.names }; if (value && value !== pop.label) names[pop.label] = value; else delete names[pop.label]; return { ...l, names }; });
    setPop(null);
  };
  const clearPop = () => {
    if (pop.kind === "filter") setFilters((f) => ({ ...f, [pop.label]: "" }));
    else change((l) => { const names = { ...l.names }; delete names[pop.label]; return { ...l, names }; });
    setPop(null);
  };

  return (
    <div ref={bar} className={`gt-bar ${className}`.trim()} data-empty={ready ? undefined : "true"}>
      <style>{css}</style>
      {ready ? (
        <>
          <span className="gt-hint">{filterCount ? `Showing ${view.shown.toLocaleString()} of ${view.total.toLocaleString()} rows on this page` : sort ? "Sorting the rows on this page" : "Hover a column name to sort, filter, rename, pin or hide it"}</span>
          {histLen ? <button type="button" className="gt-btn" onClick={undo}><Undo2 size={14} strokeWidth={1.75} /> Undo</button> : null}
          {filterCount ? <button type="button" className="gt-btn" onClick={() => setFilters({})}><X size={14} strokeWidth={1.75} /> Clear {filterCount === 1 ? "filter" : "filters"}</button> : null}
          {customised ? (
            <div className="gt-seg" role="group" aria-label="Column layout">
              <button type="button" aria-pressed={layout.mode === "default"} onClick={() => setLayout((l) => ({ ...l, mode: "default" }))}>Default</button>
              <button type="button" aria-pressed={layout.mode !== "default"} onClick={() => setLayout((l) => ({ ...l, mode: "mine" }))}>My layout</button>
            </div>
          ) : null}
          <button ref={btn} type="button" className="gt-btn" aria-expanded={Boolean(menu)} onClick={openMenu}>
            <Columns3 size={14} strokeWidth={1.75} /> {hiddenCount ? `Hidden (${hiddenCount})` : "Columns"}
          </button>
        </>
      ) : null}
      {menu ? (
        <div className="gt-menu" role="dialog" aria-label="Choose columns" style={{ top: menu.top, right: menu.right }}>
          <div className="gt-menu-note">Tick a column to show it in the table. Pin one to keep it in view while you scroll sideways. Drag a header's right edge to change its width; double-click the edge to reset it.</div>
          <ul>
            {named.map(({ label, i }) => (
              <li key={i}>
                <label><input type="checkbox" checked={!eff.hidden.includes(label)} onChange={() => toggle("hidden", label)} /> <span>{shownName(label)}</span></label>
                <button type="button" className="gt-pin" aria-pressed={eff.pinned.includes(label)} onClick={() => toggle("pinned", label)}>{eff.pinned.includes(label) ? "Pinned" : "Pin"}</button>
              </li>
            ))}
          </ul>
          <div className="gt-menu-foot">
            <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" disabled={!hiddenCount} onClick={() => change((l) => ({ ...l, hidden: [] }))}>Show all</button>
            <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" disabled={!customised} onClick={() => change(() => EMPTY)}><RotateCcw size={13} /> Reset layout</button>
          </div>
        </div>
      ) : null}
      {pop ? (
        <form className="gt-pop" style={{ left: pop.x, top: Math.min(pop.y, window.innerHeight - 170) }} onSubmit={submitPop} aria-label={pop.kind === "filter" ? "Filter this column" : "Rename this column"}>
          <label htmlFor={`gt-pop-${id}`}>{pop.kind === "filter" ? `Show rows where ${shownName(pop.label)} contains` : `Name for the ${pop.label} column`}</label>
          <input id={`gt-pop-${id}`} className="ui-input" autoFocus maxLength={60} value={pop.value} placeholder={pop.kind === "filter" ? "Type to filter" : pop.label} onChange={(e) => setPop((p) => ({ ...p, value: e.target.value }))} />
          <div className="gt-pop-foot">
            <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={clearPop}>{pop.kind === "filter" ? "Clear" : "Use original name"}</button>
            <button type="submit" className="ui-btn ui-btn--primary ui-btn--sm">{pop.kind === "filter" ? "Filter" : "Rename"}</button>
          </div>
        </form>
      ) : null}
      {peek ? (
        <div className="gt-peek" role="dialog" aria-label={peek.label || "Cell"} style={{ left: peek.x, top: Math.min(peek.y, window.innerHeight - 220) }}>
          <div className="gt-peek-head">
            <span>{peek.label}</span>
            <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={copy}><Copy size={13} /> {copied ? "Copied" : "Copy"}</button>
            <button type="button" className="ui-icon-btn" aria-label="Close" onClick={() => setPeek(null)}><X size={15} /></button>
          </div>
          <div className="gt-peek-text">{peek.text}</div>
        </div>
      ) : null}
    </div>
  );
}
