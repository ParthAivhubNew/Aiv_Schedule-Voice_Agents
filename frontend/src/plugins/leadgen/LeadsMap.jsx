import React, { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Eraser, PenTool, X } from "lucide-react";
import { C, FONT_BODY } from "../../tokens";

const text = { fontFamily: FONT_BODY };
const BRAND = "#2563EB";
const UK_CENTRE = [54.0, -2.5];

// Map of the companies in the results, with a draw-an-area tool. Plain Leaflet (no wrapper library).
// `points` is {companyId: [lat, lng]}; `area` is the drawn polygon [[lat, lng], ...] or null.
// Drawing: click to place corners, click the first corner (or double-click) to finish, Esc to cancel.
export function LeadsMap({ companies, points, area, busy, onArea, onClear, height = 460 }) {
  const el = useRef(null);
  const map = useRef(null);
  const markers = useRef(null);
  const shape = useRef(null);
  const draft = useRef({ pts: [], line: null, dots: [] });
  const [drawing, setDrawing] = useState(false);
  const cbs = useRef({ onArea });
  cbs.current = { onArea };

  useEffect(() => {
    const m = L.map(el.current, { center: UK_CENTRE, zoom: 6, zoomControl: true, doubleClickZoom: false });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap contributors" }).addTo(m);
    markers.current = L.layerGroup().addTo(m);
    map.current = m;
    setTimeout(() => m.invalidateSize(), 0);
    return () => { m.remove(); map.current = null; };
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
    const d = draft.current;
    if (d.line) d.line.remove();
    d.dots.forEach((x) => x.remove());
    draft.current = { pts: [], line: null, dots: [] };
  };

  const finish = () => {
    const pts = draft.current.pts;
    resetDraft();
    setDrawing(false);
    if (pts.length >= 3) cbs.current.onArea(pts.map((p) => [Number(p[0].toFixed(5)), Number(p[1].toFixed(5))]));
  };

  useEffect(() => {
    const m = map.current;
    if (!m || !drawing) return undefined;
    const container = m.getContainer();
    container.style.cursor = "crosshair";
    const onClick = (e) => {
      const d = draft.current;
      if (d.pts.length >= 3 && m.latLngToContainerPoint(e.latlng).distanceTo(m.latLngToContainerPoint(d.pts[0])) < 12) { finish(); return; }
      d.pts.push([e.latlng.lat, e.latlng.lng]);
      if (d.line) d.line.setLatLngs(d.pts); else d.line = L.polyline(d.pts, { color: BRAND, weight: 2, dashArray: "5 5" }).addTo(m);
      d.dots.push(L.circleMarker(e.latlng, { radius: 5, color: BRAND, fillColor: "#fff", fillOpacity: 1, weight: 2 }).addTo(m));
    };
    const onDbl = () => { if (draft.current.pts.length > 3) draft.current.pts.pop(); finish(); }; // dbl-click also fires two clicks at the same spot
    const onKey = (e) => { if (e.key === "Escape") { resetDraft(); setDrawing(false); } };
    m.on("click", onClick);
    m.on("dblclick", onDbl);
    window.addEventListener("keydown", onKey);
    return () => {
      container.style.cursor = "";
      m.off("click", onClick);
      m.off("dblclick", onDbl);
      window.removeEventListener("keydown", onKey);
      resetDraft();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawing]);

  const btn = { display: "inline-flex", alignItems: "center", gap: 6 };
  return (
    <div style={{ position: "relative" }}>
      <div ref={el} style={{ height, width: "100%", borderRadius: 8, overflow: "hidden", border: `1px solid ${C.border}`, zIndex: 0 }} aria-label="Map of the companies found" />
      <div style={{ position: "absolute", top: 10, right: 10, zIndex: 500, display: "flex", gap: 6 }}>
        {drawing ? (
          <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" style={btn} onClick={() => { resetDraft(); setDrawing(false); }}><X size={14} /> Cancel</button>
        ) : (
          <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" style={btn} disabled={busy} onClick={() => setDrawing(true)}><PenTool size={14} /> {area ? "Redraw area" : "Draw area"}</button>
        )}
        {area && !drawing ? <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" style={btn} onClick={onClear}><Eraser size={14} /> Clear area</button> : null}
      </div>
      {drawing ? (
        <div style={{ position: "absolute", left: 10, bottom: 28, zIndex: 500, background: "rgba(255,255,255,.95)", padding: "6px 10px", borderRadius: 6, ...text, fontSize: 12.5, color: C.ink }}>
          Click to place corners. Click the first corner or double-click to finish. Esc cancels.
        </div>
      ) : null}
    </div>
  );
}
