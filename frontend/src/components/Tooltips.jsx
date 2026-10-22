import { useEffect } from "react";

// One tooltip for the whole app. Anything with a `title` shows it in a styled bubble on hover or keyboard
// focus (the browser's own one is slow and never shows on a touch screen), and a button with only an icon
// and an aria-label gets that label as its tooltip. Mounted once; no component has to opt in.
const SHOW_DELAY = 250;
const ICON_ONLY = "button[aria-label], [role='button'][aria-label], a[aria-label]";

function adoptLabels(root) {
  root.querySelectorAll?.(ICON_ONLY).forEach((el) => {
    if (el.hasAttribute("title") || el.dataset.tip) return;
    const label = el.getAttribute("aria-label");
    const visible = (el.textContent || "").trim();
    if (label && !visible) el.dataset.tip = label; // icon-only: the label is all there is to read
  });
}

export function Tooltips() {
  useEffect(() => {
    const bubble = document.createElement("div");
    bubble.setAttribute("role", "tooltip");
    bubble.style.cssText = "position:fixed;z-index:2147483000;pointer-events:none;max-width:280px;padding:6px 10px;border-radius:8px;background:#111827;color:#fff;font:500 12px/1.4 system-ui,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.25);opacity:0;transition:opacity .12s;white-space:normal;overflow-wrap:anywhere";
    document.body.appendChild(bubble);
    let timer = 0;
    let current = null;

    const hide = () => { window.clearTimeout(timer); bubble.style.opacity = "0"; current = null; };
    const place = (el) => {
      const r = el.getBoundingClientRect();
      const b = bubble.getBoundingClientRect();
      let left = r.left + r.width / 2 - b.width / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - b.width - 8));
      let top = r.bottom + 8;
      if (top + b.height > window.innerHeight - 8) top = Math.max(8, r.top - b.height - 8);
      bubble.style.left = `${left}px`;
      bubble.style.top = `${top}px`;
    };
    const show = (el) => {
      const text = el.dataset.tip;
      if (!text || !document.contains(el)) return;
      bubble.textContent = text;
      place(el);
      bubble.style.opacity = "1";
      current = el;
    };
    const source = (target) => {
      const el = target instanceof Element ? target.closest("[title], [data-tip]") : null;
      if (!el) return null;
      const title = el.getAttribute("title");
      if (title) { el.dataset.tip = title; el.removeAttribute("title"); } // our bubble replaces the native one
      return el.dataset.tip ? el : null;
    };
    const enter = (e) => {
      const el = source(e.target);
      if (!el || el === current) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => show(el), SHOW_DELAY);
    };
    const leave = (e) => {
      if (current && e.target instanceof Element && current.contains(e.target) && !current.contains(e.relatedTarget)) hide();
      else if (!current) window.clearTimeout(timer);
    };

    adoptLabels(document);
    const mo = new MutationObserver((records) => {
      records.forEach((r) => r.addedNodes.forEach((n) => { if (n.nodeType === 1) { if (n.matches?.(ICON_ONLY)) adoptLabels({ querySelectorAll: () => [n] }); adoptLabels(n); } }));
    });
    mo.observe(document.body, { childList: true, subtree: true });

    document.addEventListener("mouseover", enter);
    document.addEventListener("mouseout", leave);
    document.addEventListener("focusin", enter);
    document.addEventListener("focusout", hide);
    document.addEventListener("mousedown", hide);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });
    window.addEventListener("scroll", hide, true);
    window.addEventListener("blur", hide);
    return () => {
      mo.disconnect();
      document.removeEventListener("mouseover", enter);
      document.removeEventListener("mouseout", leave);
      document.removeEventListener("focusin", enter);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("mousedown", hide);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("blur", hide);
      window.clearTimeout(timer);
      bubble.remove();
    };
  }, []);
  return null;
}
