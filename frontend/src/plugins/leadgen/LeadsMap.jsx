import React, { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Eraser, Eye, Pencil, Phone, Globe, X } from "lucide-react";
import { C, FONT_BODY } from "../../tokens";
import { shapeFromPath } from "./drawShape";
import { directionsUrl, legendFor, pinHtml, pinKind } from "./mapPins";

const text = { fontFamily: FONT_BODY };
const BRAND = "#111111"; // pins and the drawn line are black so they stand out on the map
const UK_CENTRE = [54.0, -2.5];
// The UK and the land around it (Ireland, the Channel Islands, the nearby coast of France, Belgium and
// the Netherlands): the map can be moved around this, but our company data is the UK's.
const REGION = [[47.0, -14.0], [62.0, 6.5]];
// Free OpenStreetMap tiles by default; a paid tile service can be swapped in without a code change.
const TILE_URL = import.meta.env.VITE_MAP_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION = import.meta.env.VITE_MAP_TILE_ATTRIBUTION || "&copy; OpenStreetMap contributors";
const PENCIL_CURSOR = `url("data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#111111" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>')}") 2 22, crosshair`;

// Map of the companies in the results, with a pencil to draw an area. Plain Leaflet (no wrapper library).
// `points` is {companyId: [lat, lng]}; `area` is the drawn polygon [[lat, lng], ...] or null.
// Each pin shows the kind of business (see mapPins.js); clicking one opens a card with the company's details
// and what can be done with it. `statusOf(c)` says whether it is saved or a favourite, and `actions` are
// {onSave, onFavourite, onAddToList, onRemove}; `hint` is what the user searched for.
// Drawing: press and drag to draw around the area, let go to finish (the end joins back to the start),
// Esc cancels. Works with a mouse, a finger or a stylus.
export function LeadsMap({ companies, points, area, busy, onArea, onClear, height = 460, statusOf, actions, hint = "" }) {
  const el = useRef(null);
  const map = useRef(null);
  const markers = useRef(null);
  const shape = useRef(null);
  const draft = useRef({ pts: [], line: null });
  const [drawing, setDrawing] = useState(false);
  const cbs = useRef({ onArea });
  cbs.current = { onArea, statusOf, actions, hint };
  // What the user has narrowed the map to: kinds switched off in the legend, and "has a phone / website".
  const [hidden, setHidden] = useState(() => new Set());
  const [needPhone, setNeedPhone] = useState(false);
  const [needSite, setNeedSite] = useState(false);
  const [legendOpen, setLegendOpen] = useState(true);
  const placed = useMemo(() => companies.filter((c) => points[c.id]), [companies, points]);
  const legend = useMemo(() => legendFor(placed, hint), [placed, hint]);
  const visible = useMemo(
    () => placed.filter((c) => !hidden.has(pinKind(c, hint).kind) && (!needPhone || c.phone) && (!needSite || c.website)),
    [placed, hidden, needPhone, needSite, hint],
  );
  const narrowed = hidden.size > 0 || needPhone || needSite;
  const showAll = () => { setHidden(new Set()); setNeedPhone(false); setNeedSite(false); };
  // Click a kind to see only that kind; click it again (when it is the only one) to bring the rest back.
  const soloKind = (kind) => setHidden((cur) => {
    const others = legend.map((k) => k.kind).filter((k) => k !== kind);
    const alreadySolo = others.every((k) => cur.has(k)) && !cur.has(kind);
    return alreadySolo ? new Set() : new Set(others);
  });
  const toggleKind = (kind) => setHidden((cur) => { const n = new Set(cur); if (n.has(kind)) n.delete(kind); else n.add(kind); return n; });
  useEffect(() => { showAll(); }, [area]); // a new area starts from everything
  const statusKey = companies.map((c) => { const s = statusOf?.(c) || {}; return `${c.id}${s.saved ? "s" : ""}${s.favourite ? "f" : ""}`; }).join("|");

  useEffect(() => {
    const m = L.map(el.current, {
      center: UK_CENTRE, zoom: 6, minZoom: 5, zoomControl: true, doubleClickZoom: false,
      maxBounds: REGION, maxBoundsViscosity: 0.9,
    });
    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTRIBUTION }).addTo(m);
    markers.current = L.layerGroup().addTo(m);
    map.current = m;
    setTimeout(() => m.invalidateSize(), 0);
    // The screen can be hidden while the user visits another tab and shown again: the map redraws itself
    // whenever its box changes size, so it never comes back as grey squares.
    const watch = typeof ResizeObserver === "function" ? new ResizeObserver(() => { if (map.current) map.current.invalidateSize(); }) : null;
    if (watch) watch.observe(el.current);
    return () => { if (watch) watch.disconnect(); m.remove(); map.current = null; };
  }, []);

  // The card that opens when a pin is clicked. Built fresh each time so it shows the current saved / favourite state.
  const card = (c, pin) => {
    const { statusOf: status, actions: act, hint: searched } = cbs.current;
    const s = status?.(c) || {};
    const kind = pinKind(c, searched);
    const box = document.createElement("div");
    box.style.cssText = "min-width:230px;max-width:280px;font:13px/1.45 system-ui,sans-serif";
    const line = (html, css = "") => { const d = document.createElement("div"); d.style.cssText = css; d.textContent = html; return d; };
    box.append(line(`${kind.icon} ${c.name}`, "font-weight:700;font-size:14px;margin-bottom:2px"));
    const where = [c.industry, [c.region, c.postcode].filter(Boolean).join(" ")].filter(Boolean).join(" · ");
    if (where) box.append(line(where, "color:#555;font-size:12px"));
    const facts = [c.status, c.company_category, c.registration_number && `No. ${c.registration_number}`].filter(Boolean).join(" · ");
    if (facts) box.append(line(facts, "color:#777;font-size:12px"));
    if (c.phone) box.append(line(c.phone, "margin-top:4px"));
    if (c.website) {
      const a = document.createElement("a");
      a.href = /^https?:/.test(c.website) ? c.website : `https://${c.website}`;
      a.target = "_blank"; a.rel = "noreferrer"; a.textContent = c.website.replace(/^https?:\/\/(www\.)?/, "");
      a.style.cssText = "display:block;margin-top:2px;color:#2563EB;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
      box.append(a);
    }
    const row = document.createElement("div");
    row.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;margin-top:8px";
    const button = (label, fn, opts = {}) => {
      const b = document.createElement("button");
      b.type = "button"; b.textContent = label; b.title = opts.title || ""; b.disabled = Boolean(opts.disabled);
      b.style.cssText = `padding:4px 9px;border-radius:6px;border:1px solid ${opts.primary ? "#111" : "#d4d4d8"};background:${opts.primary ? "#111" : "#fff"};color:${opts.primary ? "#fff" : "#111"};font:600 12px system-ui,sans-serif;cursor:${opts.disabled ? "default" : "pointer"};opacity:${opts.disabled ? 0.6 : 1}`;
      b.onclick = () => { if (!opts.disabled) { fn(); pin.closePopup(); } };
      return b;
    };
    row.append(button(s.favourite ? "★ Favourite" : "☆ Favourite", () => act?.onFavourite?.(c), { primary: !s.favourite, disabled: s.favourite, title: "Keep it in your Favourites list" }));
    row.append(button(s.saved ? "✓ Saved" : "Save", () => act?.onSave?.(c), { disabled: s.saved, title: "Save it to your Unsorted list" }));
    row.append(button("Add to list…", () => act?.onAddToList?.(c), { title: "Save it into a list you name" }));
    row.append(button("Note…", () => act?.onNote?.(c), { title: "Write a note on this company" }));
    if (c.phone && act?.onCall) {
      row.append(button(act.callLocked ? "Call · add Voice" : "Save & call", () => act.onCall(c), { title: act.callLocked ? "Phoning leads comes with the Voice plan" : "Save it, then have your AI caller phone them" }));
    }
    row.append(button("Not interested", () => act?.onRemove?.(c), { title: "Take it out of these results" }));
    box.append(row);
    const links = document.createElement("div");
    links.style.cssText = "display:flex;gap:12px;margin-top:8px;font-size:12px";
    const dir = document.createElement("a");
    dir.href = directionsUrl(c); dir.target = "_blank"; dir.rel = "noreferrer"; dir.textContent = "Directions"; dir.style.color = "#2563EB";
    const copy = document.createElement("a");
    copy.href = "#"; copy.textContent = "Copy details"; copy.style.color = "#2563EB";
    copy.onclick = (e) => {
      e.preventDefault();
      const textual = [c.name, where, c.phone, c.website].filter(Boolean).join("\n");
      try { navigator.clipboard.writeText(textual); copy.textContent = "Copied"; } catch { copy.textContent = "Couldn't copy"; }
    };
    links.append(dir, copy);
    box.append(links);
    return box;
  };

  // Company pins: an icon for the kind of business, a star for a favourite, a tick for one already saved.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    markers.current.clearLayers();
    visible.forEach((c) => {
      const p = points[c.id];
      if (!p) return;
      const s = cbs.current.statusOf?.(c) || {};
      const icon = L.divIcon({ html: pinHtml(pinKind(c, cbs.current.hint), s), className: "lead-pin", iconSize: [30, 30], iconAnchor: [15, 15], popupAnchor: [0, -14] });
      const pin = L.marker(p, { icon, title: c.name, riseOnHover: true });
      pin.bindPopup(() => card(c, pin), { minWidth: 230 });
      markers.current.addLayer(pin);
    });
  }, [visible, points, statusKey]);

  // Move the map to the results only when they change, never because a company was saved.
  useEffect(() => {
    const m = map.current;
    if (!m || area) return;
    const bounds = visible.map((c) => points[c.id]).filter(Boolean);
    if (bounds.length) m.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
  }, [visible, points, area]);

  // The finished area.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (shape.current) { shape.current.remove(); shape.current = null; }
    if (area && area.length >= 3) {
      shape.current = L.polygon(area, { color: BRAND, weight: 2, fillOpacity: 0.08 }).addTo(m);
      m.fitBounds(shape.current.getBounds(), { padding: [30, 30] });
    }
  }, [area]);

  const resetDraft = () => {
    if (draft.current.line) draft.current.line.remove();
    draft.current = { pts: [], line: null };
  };

  // The pencil: press, drag, let go.
  useEffect(() => {
    const m = map.current;
    if (!m || !drawing) return undefined;
    const container = m.getContainer();
    const prev = { cursor: container.style.cursor, touch: container.style.touchAction };
    container.style.cursor = PENCIL_CURSOR;
    container.style.touchAction = "none"; // a finger draws instead of scrolling the page
    m.dragging.disable();
    let down = false;
    const at = (e) => { const ll = m.mouseEventToLatLng(e); return [ll.lat, ll.lng]; };
    const onDown = (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      down = true;
      container.setPointerCapture?.(e.pointerId);
      resetDraft();
      draft.current.pts = [at(e)];
      draft.current.line = L.polyline(draft.current.pts, { color: BRAND, weight: 3 }).addTo(m);
      e.preventDefault();
    };
    const onMove = (e) => {
      if (!down) return;
      const d = draft.current;
      const last = m.latLngToContainerPoint(d.pts[d.pts.length - 1]);
      const here = m.mouseEventToContainerPoint(e);
      if (last.distanceTo(here) < 3) return; // a point every few pixels is plenty
      d.pts.push(at(e));
      d.line.setLatLngs(d.pts);
    };
    const onUp = () => {
      if (!down) return;
      down = false;
      const done = shapeFromPath(draft.current.pts);
      resetDraft();
      setDrawing(false);
      if (done) cbs.current.onArea(done);
    };
    const onKey = (e) => { if (e.key === "Escape") { down = false; resetDraft(); setDrawing(false); } };
    container.addEventListener("pointerdown", onDown);
    container.addEventListener("pointermove", onMove);
    container.addEventListener("pointerup", onUp);
    container.addEventListener("pointercancel", onUp);
    window.addEventListener("keydown", onKey);
    return () => {
      container.style.cursor = prev.cursor;
      container.style.touchAction = prev.touch;
      container.removeEventListener("pointerdown", onDown);
      container.removeEventListener("pointermove", onMove);
      container.removeEventListener("pointerup", onUp);
      container.removeEventListener("pointercancel", onUp);
      window.removeEventListener("keydown", onKey);
      if (map.current) map.current.dragging.enable();
      resetDraft();
    };
  }, [drawing]);

  const btn = { display: "inline-flex", alignItems: "center", gap: 6 };
  return (
    <div style={{ position: "relative" }}>
      <div ref={el} style={{ height, width: "100%", borderRadius: 8, overflow: "hidden", border: `1px solid ${C.border}`, zIndex: 0 }} aria-label="Map of the companies found" />
      <div style={{ position: "absolute", top: 10, right: 10, zIndex: 500, display: "flex", gap: 6 }}>
        {drawing ? (
          <button title="Close without saving" type="button" className="ui-btn ui-btn--secondary ui-btn--sm" style={btn} onClick={() => { resetDraft(); setDrawing(false); }}><X size={14} /> Cancel</button>
        ) : (
          <button type="button" title="Draw a shape on the map and search only inside it" className="ui-btn ui-btn--primary ui-btn--sm" style={btn} disabled={busy} onClick={() => setDrawing(true)}><Pencil size={14} /> {area ? "Redraw area" : "Draw area"}</button>
        )}
        {area && !drawing ? <button title="Remove the drawn shape" type="button" className="ui-btn ui-btn--secondary ui-btn--sm" style={btn} onClick={onClear}><Eraser size={14} /> Clear area</button> : null}
      </div>
      {placed.length ? (
        <div style={{ position: "absolute", left: 10, top: 10, zIndex: 500, background: "rgba(255,255,255,.96)", padding: "6px 8px", borderRadius: 8, ...text, fontSize: 12, color: C.ink, maxHeight: height - 60, maxWidth: 230, overflowY: "auto", boxShadow: "0 1px 4px rgba(0,0,0,.15)" }}>
          <button type="button" onClick={() => setLegendOpen((o) => !o)} aria-expanded={legendOpen}
            style={{ all: "unset", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, width: "100%", fontWeight: 600, padding: "2px 2px 4px" }}>
            <Eye size={13} /> Showing {visible.length.toLocaleString()} of {placed.length.toLocaleString()}
            <span style={{ marginLeft: "auto", color: C.slate, fontWeight: 400 }}>{legendOpen ? "Hide" : "Filter"}</span>
          </button>
          {legendOpen ? (
            <>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", padding: "0 2px 6px" }}>
                <button type="button" aria-pressed={needPhone} onClick={() => setNeedPhone((v) => !v)} title="Only companies with a phone number"
                  className={`ui-btn ui-btn--sm ${needPhone ? "ui-btn--primary" : "ui-btn--secondary"}`} style={{ ...btn, height: 24, fontSize: 11.5, padding: "0 8px" }}><Phone size={11} /> Has phone</button>
                <button type="button" aria-pressed={needSite} onClick={() => setNeedSite((v) => !v)} title="Only companies with a website"
                  className={`ui-btn ui-btn--sm ${needSite ? "ui-btn--primary" : "ui-btn--secondary"}`} style={{ ...btn, height: 24, fontSize: 11.5, padding: "0 8px" }}><Globe size={11} /> Has website</button>
              </div>
              {legend.map((k) => {
                const off = hidden.has(k.kind);
                return (
                  <div key={k.kind} style={{ display: "flex", alignItems: "center", gap: 4, opacity: off ? 0.4 : 1 }}>
                    <button type="button" onClick={() => soloKind(k.kind)} title={`Show only ${k.label.toLowerCase()}`}
                      style={{ all: "unset", cursor: "pointer", flex: 1, display: "flex", alignItems: "center", gap: 6, lineHeight: 1.6, padding: "1px 2px", borderRadius: 4, minWidth: 0 }}>
                      <span style={{ display: "inline-flex", width: 18, height: 18, borderRadius: "50%", background: k.color, alignItems: "center", justifyContent: "center", fontSize: 10, flexShrink: 0 }}>{k.icon}</span>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{k.label}</span>
                      <span style={{ color: C.slate }}>{k.count}</span>
                    </button>
                    <button type="button" onClick={() => toggleKind(k.kind)} aria-pressed={!off} aria-label={off ? `Show ${k.label}` : `Hide ${k.label}`} title={off ? "Show these again" : "Hide these"}
                      style={{ all: "unset", cursor: "pointer", display: "inline-flex", padding: 3, color: C.slate }}><Eye size={13} /></button>
                  </div>
                );
              })}
              {narrowed ? <button type="button" onClick={showAll} style={{ all: "unset", cursor: "pointer", marginTop: 4, padding: "2px", color: C.cobalt, fontWeight: 600 }}>Show everything</button> : null}
            </>
          ) : null}
        </div>
      ) : null}
      {drawing ? (
        <div style={{ position: "absolute", left: 10, bottom: 28, zIndex: 500, background: "rgba(255,255,255,.95)", padding: "6px 10px", borderRadius: 6, ...text, fontSize: 12.5, color: C.ink }}>
          Press and drag to draw around the area. Let go to finish. Esc cancels.
        </div>
      ) : null}
    </div>
  );
}
