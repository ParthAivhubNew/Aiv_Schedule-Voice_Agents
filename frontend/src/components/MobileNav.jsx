import React, { useEffect, useState } from "react";
import { Menu } from "lucide-react";

// Phones and narrow windows: an app's sidebar slides in from the left as a drawer instead of
// sitting beside the page (see "Phones and narrow windows" in global.css). The app adds
// `is-nav-open` to its `.app-shell` while `nav.open`, shows a MobileNavButton in its header and
// renders a MobileNavBackdrop. `page` is the app's current page: the drawer closes when it changes.
export function useMobileNav(page) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setOpen(false);
  }, [page]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return { open, toggle: () => setOpen((v) => !v), close: () => setOpen(false) };
}

// Opens the drawer. Only shown on narrow screens.
export function MobileNavButton({ nav, style }) {
  return (
    <button type="button" className="ui-icon-btn mobile-nav-btn" aria-label="Menu" aria-expanded={nav.open} onClick={nav.toggle} style={style}>
      <Menu size={20} />
    </button>
  );
}

// Dims the page behind the open drawer; a tap closes it.
export function MobileNavBackdrop({ nav }) {
  return nav.open ? <div className="mobile-nav-backdrop" onClick={nav.close} aria-hidden="true" /> : null;
}

// For an app without a header bar of its own: a slim bar with the menu button and the app's
// name, shown on narrow screens only.
export function MobileTopBar({ nav, title }) {
  return (
    <div className="mobile-topbar">
      <MobileNavButton nav={nav} />
      <span style={{ fontWeight: 600, fontSize: 15, color: "#111827" }}>{title}</span>
    </div>
  );
}
