import React, { useEffect, useState } from "react";

// In the icon rail (the collapsed side menu, wide screens only) an item has no visible name, so hovering or focusing it shows
// the name in a small label beside the rail. The browser's own tooltip is switched off there: it sits over the next icon and
// is cut off by the narrow menu. Use it like this:
//   const [tip, tipNode] = useRailTip();
//   <button {...tip("Log out", "Sign out of Outreach")}>...</button>{tipNode}
const wide = () => typeof window !== "undefined" && window.matchMedia && window.matchMedia("(min-width: 821px)").matches;

function useRail() {
  const [on, setOn] = useState(() => typeof document !== "undefined" && document.body.classList.contains("sidebar-collapsed"));
  useEffect(() => {
    const mo = new MutationObserver(() => setOn(document.body.classList.contains("sidebar-collapsed")));
    mo.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);
  return on && wide();
}

export function useRailTip() {
  const rail = useRail();
  const [at, setAt] = useState(null); // { left, top, text }
  const show = (text) => (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    setAt({ left: r.right + 10, top: r.top + r.height / 2, text });
  };
  const hide = () => setAt(null);
  // label: the name shown in the rail; hint: the longer tooltip kept when the menu is open
  const bind = (label, hint) => (rail
    ? { onMouseEnter: show(label), onFocus: show(label), onMouseLeave: hide, onBlur: hide, "aria-label": label }
    : { title: hint || label });
  const node = rail && at ? <div className="ui-nav-tip" role="tooltip" style={{ left: at.left, top: at.top }}>{at.text}</div> : null;
  return [bind, node];
}
