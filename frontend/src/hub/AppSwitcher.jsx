import React, { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { APPS } from "./apps";

// Under the Outreach name in every app's sidebar: the app you are in (its icon and name), which opens a list of the
// other apps of the suite. Going home is the Outreach name above it.
export function AppSwitcher({ current }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const here = APPS.find((a) => a.id === current) || APPS[0];
  const HereIcon = here.icon;
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const esc = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div ref={box} role="navigation" aria-label="Outreach apps" className="ui-switcher ui-switcher--menu">
      <button type="button" className="ui-switcher-current" aria-haspopup="listbox" aria-expanded={open} title="Switch app" onClick={() => setOpen((v) => !v)}>
        <span className="ui-switcher-tile" style={{ background: here.accent }}><HereIcon size={15} /></span>
        <span className="ui-switcher-name">{here.name}</span>
        <ChevronDown size={14} className="ui-switcher-chev" style={{ transform: open ? "rotate(180deg)" : "none" }} />
      </button>
      {open ? (
        <div role="listbox" aria-label="Apps" className="ui-switcher-list">
          {APPS.map((app) => {
            const on = app.id === current;
            const Icon = app.icon;
            return (
              <button key={app.id} type="button" role="option" aria-selected={on} aria-current={on ? "page" : undefined} title={on ? `${app.name} (you are here)` : `Go to ${app.name}`}
                className="ui-switcher-opt" onClick={() => { setOpen(false); if (!on) window.__aivhub_switch_plugin?.(app.id); }}>
                <span className="ui-switcher-tile" style={{ background: app.accent }}><Icon size={14} /></span>
                <span className="ui-switcher-name">{app.name}<small>{app.role}</small></span>
                {on ? <Check size={14} /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
