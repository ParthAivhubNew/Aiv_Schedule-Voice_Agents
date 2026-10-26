// Every control gets a hover tooltip. Elements that already have a `title` keep it: this only fills the gaps, so a
// hand-written description always wins. It covers icon-only buttons (named by aria-label), fields (placeholder or
// label), links and dropdowns, and keeps watching because screens change as people click around.

const SELECTOR = "button, a[href], input, select, textarea, [role='tab'], [role='menuitem'], [role='switch'], [role='button']";

function clean(text) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, 120);
}

function describe(el) {
  const aria = clean(el.getAttribute("aria-label"));
  if (aria) return aria;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") {
    const ph = clean(el.getAttribute("placeholder"));
    if (ph) return ph;
    const id = el.getAttribute("id");
    const label = id ? el.ownerDocument.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
    return clean(label ? label.textContent : "");
  }
  if (tag === "SELECT") {
    const id = el.getAttribute("id");
    const label = id ? el.ownerDocument.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
    return clean(label ? label.textContent : "");
  }
  const text = clean(el.textContent);
  return text;
}

export function applyTooltips(root) {
  if (!root || !root.querySelectorAll) return;
  root.querySelectorAll(SELECTOR).forEach((el) => {
    if (el.hasAttribute("title")) return;
    const text = describe(el);
    if (text) el.setAttribute("title", text);
  });
}

// Start watching a part of the page. Returns a function that stops.
export function watchTooltips(root) {
  if (!root || typeof MutationObserver === "undefined") return () => {};
  applyTooltips(root);
  let queued = false;
  const observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    window.requestAnimationFrame(() => {
      queued = false;
      applyTooltips(root);
    });
  });
  observer.observe(root, { childList: true, subtree: true });
  return () => observer.disconnect();
}
