import React, { useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";

const touchOnly = () => typeof window !== "undefined" && window.matchMedia && window.matchMedia("(hover: none)").matches;

// One sidebar page. With `children` ([{ id, label, icon, active, title, onClick }]) it shows a chevron and,
// on hover or keyboard focus, a panel beside the sidebar that lists the sub-pages. Clicking the item itself
// opens the first sub-page. On touch screens there is no hover, so the sub-pages sit under the item instead.
export function NavItem({ item, current, children: extra }) {
  const subs = (item.children || []).filter(Boolean);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const row = useRef(null);
  const timer = useRef(0);
  const Icon = item.icon;
  const active = item.active;

  useEffect(() => () => clearTimeout(timer.current), []);

  const show = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const r = row.current && row.current.getBoundingClientRect();
      if (r) setPos({ left: r.right + 6, top: r.top });
      setOpen(true);
    }, 90);
  };
  const hide = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(false), 140);
  };

  const button = (
    <button type="button" className="ui-nav-item" title={item.title || item.label} onClick={item.onClick} aria-current={active ? "page" : undefined}
      aria-haspopup={subs.length ? "menu" : undefined} aria-expanded={subs.length ? open : undefined} data-locked={item.locked ? "true" : undefined}
      onKeyDown={(e) => {
        if (!subs.length) return;
        if (e.key === "ArrowRight") { e.preventDefault(); show(); }
        if (e.key === "Escape") { setOpen(false); }
      }}>
      <Icon size={16} strokeWidth={1.75} />
      <span style={{ flex: 1 }}>{item.label}</span>
      {extra}
      {item.count ? <span className={`ui-nav-count${item.countLive ? " ui-nav-count--live" : ""}`}>{item.count}</span> : null}
      {subs.length ? <ChevronRight size={14} strokeWidth={1.75} className="ui-nav-chevron" /> : null}
    </button>
  );

  if (!subs.length) return button;

  if (touchOnly()) {
    return (
      <>
        {button}
        {active ? subs.map((s) => (
          <button key={s.id} type="button" className="ui-nav-item ui-nav-sub" title={s.title} onClick={s.onClick} aria-current={s.active ? "page" : undefined}>
            <span>{s.label}</span>
          </button>
        )) : null}
      </>
    );
  }

  return (
    <div ref={row} onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) hide(); }}>
      {button}
      {open && pos ? (
        <div className="ui-nav-flyout" role="menu" aria-label={item.label} style={{ left: pos.left, top: pos.top }} onMouseEnter={show} onMouseLeave={hide}>
          <div className="ui-nav-flyout-title">{item.label}</div>
          {subs.map((s) => {
            const SubIcon = s.icon;
            return (
              <button key={s.id} type="button" role="menuitem" className="ui-nav-flyout-item" title={s.title} aria-current={s.active ? "page" : undefined}
                onClick={() => { setOpen(false); s.onClick(); }}>
                {SubIcon ? <SubIcon size={15} strokeWidth={1.75} /> : null}
                <span>{s.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
