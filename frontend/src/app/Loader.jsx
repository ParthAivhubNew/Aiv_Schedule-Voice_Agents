import React, { useEffect, useState } from "react";

// "Loading" with dots that grow from one to four and start again, so a wait looks like something is happening and not like plain text.
export function Dots() {
  const [n, setN] = useState(1);
  useEffect(() => {
    let still = false;
    try { still = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (_) { /* no media query: animate */ }
    if (still) { setN(3); return undefined; }
    const t = setInterval(() => setN((x) => (x % 4) + 1), 380);
    return () => clearInterval(t);
  }, []);
  return <span aria-hidden="true" style={{ display: "inline-block", width: "1.5em", textAlign: "left" }}>{".".repeat(n)}</span>;
}

// The text with its own dots or ellipsis taken off, and the moving dots put on.
export function Dotted({ text }) {
  const clean = String(text == null ? "" : text).replace(/[\s.…]+$/, "");
  return <>{clean}<Dots /></>;
}

// The one loading look for the whole app. Three pieces, all drawn from the theme colours:
//   Spinner   a small ring, for buttons and inline "working" moments
//   Loader    a centred ring with a label, for a panel or screen that has nothing to show yet
//   Skeleton  grey shapes that hold the place of rows, so the page keeps its layout while data arrives
// Their styles live in global.css (.ld-*), and switch to a still look when the person asks for less motion.

export function Spinner({ size = 16, label, style }) {
  return (
    <svg className="ld-ring" width={size} height={size} viewBox="0 0 24 24" fill="none" role={label ? "status" : undefined} aria-label={label} aria-hidden={label ? undefined : true} style={style}>
      <circle className="ld-ring-track" cx="12" cy="12" r="9" strokeWidth="3" />
      <circle className="ld-ring-arc" cx="12" cy="12" r="9" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Loader({ label = "Loading", detail, compact = false, style }) {
  return (
    <div className={`ld-block${compact ? " ld-block--compact" : ""}`} role="status" aria-live="polite" style={style}>
      <span className="ld-orb" aria-hidden="true"><Spinner size={compact ? 22 : 34} /></span>
      <div className="ld-label"><Dotted text={label} /></div>
      {detail ? <div className="ld-detail">{detail}</div> : null}
    </div>
  );
}

// A thin bar along the top of a card while it refreshes.
export function TopBar({ show = true }) {
  return show ? <div className="ld-topbar" aria-hidden="true" /> : null;
}

export function Skeleton({ w = "100%", h = 12, r = 6, style }) {
  return <span className="ld-skel" aria-hidden="true" style={{ width: w, height: h, borderRadius: r, ...style }} />;
}

const WIDTHS = [62, 48, 70, 40, 56, 66, 44, 58];

// Rows of a table while its first page arrives. `lead` draws a logo-sized square before the first cell.
export function TableSkeleton({ rows = 10, cols = 6, lead = true, label = "Loading" }) {
  return (
    <div className="ld-table" role="status" aria-label={label}>
      <div className="ld-table-head">
        {Array.from({ length: cols }, (_, c) => <Skeleton key={c} w={c === 0 ? 90 : 60} h={9} />)}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="ld-table-row" style={{ animationDelay: `${r * 60}ms` }}>
          {Array.from({ length: cols }, (_, c) => (
            <div key={c} className="ld-cell" style={c === 0 ? { flex: "1.6 1 0" } : undefined}>
              {c === 0 && lead ? <Skeleton w={30} h={30} r={8} style={{ flex: "none" }} /> : null}
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
                <Skeleton w={`${WIDTHS[(r + c * 3) % WIDTHS.length]}%`} h={11} />
                {c === 0 ? <Skeleton w={`${WIDTHS[(r + 5) % WIDTHS.length] - 12}%`} h={8} /> : null}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// Cards in a stack (lists, campaigns, channels).
export function CardsSkeleton({ count = 3, label = "Loading" }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }} role="status" aria-label={label}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="ui-card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10, animationDelay: `${i * 70}ms` }}>
          <Skeleton w={`${WIDTHS[i % WIDTHS.length]}%`} h={13} />
          <Skeleton w="85%" h={9} />
          <Skeleton w="50%" h={9} />
        </div>
      ))}
    </div>
  );
}
