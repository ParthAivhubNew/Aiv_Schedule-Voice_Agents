import React, { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Eraser, Pencil, X } from "lucide-react";
import { C, FONT_BODY } from "../../tokens";
import { shapeFromPath } from "./drawShape";

const text = { fontFamily: FONT_BODY };
const BRAND = "#2563EB";
const UK_CENTRE = [54.0, -2.5];
// The UK and the land around it (Ireland, the Channel Islands, the nearby coast of France, Belgium and
// the Netherlands): the map can be moved around this, but our company data is the UK's.
const REGION = [[47.0, -14.0], [62.0, 6.5]];
// Free OpenStreetMap tiles by default; a paid tile service can be swapped in without a code change.
const TILE_URL = import.meta.env.VITE_MAP_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION = import.meta.env.VITE_MAP_TILE_ATTRIBUTION || "&copy; OpenStreetMap contributors";
const PENCIL_CURSOR = `url("data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#2563EB" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>')}") 2 22, crosshair`;

// Map of the companies in the results, with a pencil to draw an area. Plain Leaflet (no wrapper library).
// `points` is {companyId: [lat, lng]}; `area` is the drawn polygon [[lat, lng], ...] or null.
// Drawing: press and drag to draw around the area, let go to finish (the end joins back to the start),
// Esc cancels. Works with a mouse, a finger or a stylus.
export function LeadsMap({ companies, points, area, busy, onArea, onClear, height = 460 }) {
  const el = useRef(null);
  const map = useRef(null);
  const markers = useRef(null);
  const shape = useRef(null);
  const draft = useRef({ pts: [], line: null });
  const [drawing, setDrawing] = useState(false);
  const cbs = useRef({ onArea });
  cbs.current = { onArea };

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

  // Company pins.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    markers.current.clearLayers();
    const bounds = [];
    companies.forEach((c) => {
      const p = points[c.id];
      if (!p) return;
      bounds.push(p);
      const pin = L.circleMarker(p, { radius: 7, color: "#fff", weight: 2, fillColor: BRAND, fillOpacity: 0.95 });
      const box = document.createElement("div");
      const name = document.createElement("strong");
      name.textContent = c.name;
      const sub = document.createElement("div");
      sub.textContent = [c.industry, c.postcode].filter(Boolean).join(" · ");
      sub.style.fontSize = "12px";
      box.append(name, sub);
      pin.bindPopup(box);
      markers.current.addLayer(pin);
    });
    if (bounds.length && !area) m.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
  }, [companies, points, area]);

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
          <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" style={btn} onClick={() => { resetDraft(); setDrawing(false); }}><X size={14} /> Cancel</button>
        ) : (
          <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" style={btn} disabled={busy} onClick={() => setDrawing(true)}><Pencil size={14} /> {area ? "Redraw area" : "Draw area"}</button>
        )}
        {area && !drawing ? <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" style={btn} onClick={onClear}><Eraser size={14} /> Clear area</button> : null}
      </div>
      {drawing ? (
        <div style={{ position: "absolute", left: 10, bottom: 28, zIndex: 500, background: "rgba(255,255,255,.95)", padding: "6px 10px", borderRadius: 6, ...text, fontSize: 12.5, color: C.ink }}>
          Press and drag to draw around the area. Let go to finish. Esc cancels.
        </div>
      ) : null}
    </div>
  );
}
