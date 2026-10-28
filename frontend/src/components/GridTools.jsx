import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Columns3, Copy, RotateCcw, X } from "lucide-react";

// Pin, hide and resize the columns of any table, and open a cell that is cut off to read all of it.
// Put <GridTools id="a-name-for-this-table" /> directly before the element that holds the table (or before the table itself).
// It finds that table by itself, so the table's own code stays as it is. Columns are told apart by their header text, and the
// choices are kept per table in this browser. Hiding, pinning and widths are written as CSS on the table's columns, so they
// survive the table re-rendering with new rows. A row that spans the whole table (colspan) is never touched.
const STORE = "aivhub_grid_v1:";
const EMPTY = { hidden: [], pinned: [], widths: {} };
const MIN_WIDTH = 60;

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
const PIN = svg('<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>');
const HIDE = svg('<path d="M10.73 5.08A10.8 10.8 0 0 1 22 12a10.7 10.7 0 0 1-1.5 2.5"/><path d="M14.08 14.16a3 3 0 0 1-4.24-4.24"/><path d="M17.48 17.5A10.75 10.75 0 0 1 2 12a10.75 10.75 0 0 1 4.5-5.14"/><path d="m2 2 20 20"/>');

const headCells = (table) => (table && table.tHead && table.tHead.rows[0] ? Array.from(table.tHead.rows[0].cells) : []);
const labelOf = (cell) => (cell.textContent || "").replace(/\s+/g, " ").trim();
const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// Adds the pin and hide buttons and the resize handle to a header cell, once.
function decorate(th) {
  if (th.querySelector(":scope > .gt-tools")) return;
  if (getComputedStyle(th).position === "static") th.style.position = "relative";
  const tools = document.createElement("span");
  tools.className = "gt-tools";
  tools.innerHTML = `<button type="button" data-gt-act="pin" aria-label="Pin this column">${PIN}</button><button type="button" data-gt-act="hide" aria-label="Hide this column">${HIDE}</button>`;
  const handle = document.createElement("span");
  handle.className = "gt-handle";
  handle.setAttribute("aria-hidden", "true");
  th.append(tools, handle);
}

export function GridTools({ id, className = "" }) {
  const bar = useRef(null);
  const btn = useRef(null);
  const [table, setTable] = useState(null);
  const [labels, setLabels] = useState([]); // header text of each column; "" for a column with none (a tick box, say)
  const [layout, setLayout] = useState(() => load(id));
  const [lefts, setLefts] = useState({}); // where each pinned column sticks, from the left
  const [tick, setTick] = useState(0); // bumps when the table's size changes, so pinned columns are measured again
  const [menu, setMenu] = useState(null); // { top, right } while the column list is open
  const [peek, setPeek] = useState(null); // { x, y, label, text } while a cut-off cell is open
  const [copied, setCopied] = useState(false);
  const labelsRef = useRef(labels);
  labelsRef.current = labels;

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
    };
    const mo = new MutationObserver(() => { if (!raf) raf = requestAnimationFrame(read); });
    mo.observe(table, { childList: true, subtree: true, characterData: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => setTick((n) => n + 1)) : null;
    if (ro) ro.observe(table);
    read();
    return () => { mo.disconnect(); if (ro) ro.disconnect(); cancelAnimationFrame(raf); delete table.dataset.gt; };
  }, [table, id]);

  useEffect(() => { save(id, layout); }, [id, layout]);

  // Show which columns are pinned on their own header buttons.
  useEffect(() => {
    headCells(table).forEach((cell, i) => {
      const on = layout.pinned.includes(labels[i]);
      cell.dataset.gtPinned = on ? "1" : "";
      const b = cell.querySelector(':scope > .gt-tools [data-gt-act="pin"]');
      if (b) { b.setAttribute("aria-pressed", on ? "true" : "false"); b.setAttribute("aria-label", on ? "Unpin this column" : "Pin this column"); }
    });
  }, [table, labels, layout.pinned]);

  // A pinned column sticks after the columns pinned before it (and any column the table already keeps in view).
  useLayoutEffect(() => {
    if (!table) return;
    let acc = 0;
    const next = {};
    headCells(table).forEach((cell, i) => {
      const label = labels[i];
      if (label && layout.hidden.includes(label)) return;
      const w = cell.getBoundingClientRect().width;
      if (label && layout.pinned.includes(label)) { next[i] = acc; acc += w; return; }
      const cs = getComputedStyle(cell);
      if (cs.position === "sticky" && cs.left !== "auto") acc += w;
    });
    setLefts((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  }, [table, labels, layout, tick]);

  const toggle = (key, label) => setLayout((l) => ({ ...l, [key]: l[key].includes(label) ? l[key].filter((x) => x !== label) : [...l[key], label] }));

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
        if (label) toggle(act.dataset.gtAct === "pin" ? "pinned" : "hidden", label);
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
      h.classList.add("on");
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      const move = (ev) => {
        const w = Math.max(MIN_WIDTH, Math.round(startW + ev.clientX - startX));
        setLayout((l) => ({ ...l, widths: { ...l.widths, [label]: w } }));
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
      if (label) setLayout((l) => { const widths = { ...l.widths }; delete widths[label]; return { ...l, widths }; });
    };
    table.addEventListener("click", onClick, true);
    table.addEventListener("mousedown", onDown, true);
    table.addEventListener("dblclick", onDouble, true);
    return () => {
      table.removeEventListener("click", onClick, true);
      table.removeEventListener("mousedown", onDown, true);
      table.removeEventListener("dblclick", onDouble, true);
    };
  }, [table]);

  // Close the column list or the open cell on a click elsewhere, Escape, or a scroll.
  useEffect(() => {
    if (!menu && !peek) return undefined;
    const away = (e) => { if (!(e.target.closest && e.target.closest(".gt-menu, .gt-peek, .gt-btn"))) { setMenu(null); setPeek(null); } };
    const esc = (e) => { if (e.key === "Escape") { setMenu(null); setPeek(null); } };
    const scrolled = (e) => { if (!(e.target.closest && e.target.closest(".gt-menu, .gt-peek"))) { setMenu(null); setPeek(null); } };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    window.addEventListener("scroll", scrolled, true);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); window.removeEventListener("scroll", scrolled, true); };
  }, [menu, peek]);

  const css = useMemo(() => {
    const cell = (i, tag) => `[data-gt="${id}"] ${tag}:not([colspan]):nth-child(${i + 1})`;
    const rules = [];
    labels.forEach((label, i) => {
      if (!label) return;
      const both = `${cell(i, "th")},${cell(i, "td")}`;
      if (layout.hidden.includes(label)) { rules.push(`${both}{display:none !important}`); return; }
      const w = layout.widths[label];
      if (w) rules.push(`${both}{width:${w}px !important;min-width:${w}px !important;max-width:${w}px !important;box-sizing:border-box;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}`);
      if (layout.pinned.includes(label) && lefts[i] !== undefined) {
        rules.push(`${both}{position:sticky !important;left:${lefts[i]}px !important;box-shadow:1px 0 0 var(--ui-line,#E3E6EB)}`);
        rules.push(`${cell(i, "td")}{background:var(--gt-bg,#fff);z-index:3}${cell(i, "th")}{z-index:6 !important}`);
      }
    });
    return rules.join("\n");
  }, [id, labels, layout, lefts]);

  const named = labels.map((label, i) => ({ label, i })).filter((c) => c.label);
  const hiddenCount = named.filter((c) => layout.hidden.includes(c.label)).length;
  const ready = Boolean(table) && named.length > 0;
  const openMenu = () => {
    if (menu) { setMenu(null); return; }
    const r = btn.current.getBoundingClientRect();
    setMenu({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
  };
  const copy = () => {
    if (!peek || !navigator.clipboard) return;
    navigator.clipboard.writeText(peek.text).then(() => setCopied(true), () => {});
  };

  return (
    <div ref={bar} className={`gt-bar ${className}`.trim()} data-empty={ready ? undefined : "true"}>
      <style>{css}</style>
      {ready ? (
        <button ref={btn} type="button" className="gt-btn" aria-expanded={Boolean(menu)} onClick={openMenu}>
          <Columns3 size={14} strokeWidth={1.75} /> {hiddenCount ? `Columns · ${hiddenCount} hidden` : "Columns"}
        </button>
      ) : null}
      {menu ? (
        <div className="gt-menu" role="dialog" aria-label="Choose columns" style={{ top: menu.top, right: menu.right }}>
          <div className="gt-menu-note">Tick the columns to show. Pin one to keep it in view while you scroll sideways. Drag a header's edge to change its width; double-click the edge to reset it.</div>
          <ul>
            {named.map(({ label, i }) => (
              <li key={i}>
                <label><input type="checkbox" checked={!layout.hidden.includes(label)} onChange={() => toggle("hidden", label)} /> <span>{label}</span></label>
                <button type="button" className="gt-pin" aria-pressed={layout.pinned.includes(label)} onClick={() => toggle("pinned", label)}>{layout.pinned.includes(label) ? "Pinned" : "Pin"}</button>
              </li>
            ))}
          </ul>
          <div className="gt-menu-foot">
            <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" disabled={!hiddenCount} onClick={() => setLayout((l) => ({ ...l, hidden: [] }))}>Show all</button>
            <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => setLayout(EMPTY)}><RotateCcw size={13} /> Reset layout</button>
          </div>
        </div>
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
