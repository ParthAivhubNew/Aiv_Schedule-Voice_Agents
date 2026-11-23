// The AIV Support widget (a separate script that adds the support drawer). Our own Support card stays as the fallback:
// openSupport() uses the widget only once it has loaded and been told who is signed in.
const SCRIPT_URL = (import.meta.env && import.meta.env.VITE_SUPPORT_WIDGET_URL) || "/aiv-support-widget.js";

let loading = null; // one load per page
let readyFor = ""; // the email the widget was last started for

const widget = () => (typeof window !== "undefined" ? window.AivSupport : undefined);

// True once the script is there and has been started for a signed-in person.
export const supportWidgetReady = () => Boolean(readyFor && widget() && typeof widget().open === "function");

// Adds the script once. Resolves true when window.AivSupport exists afterwards, false when it could not be loaded
// (a missing file served as the app's own page counts as not loaded).
export function loadSupportWidget(doc = typeof document !== "undefined" ? document : null) {
  if (widget()) return Promise.resolve(true);
  if (!doc) return Promise.resolve(false);
  if (loading) return loading;
  loading = new Promise((resolve) => {
    const tag = doc.createElement("script");
    tag.src = SCRIPT_URL;
    tag.async = true;
    tag.onload = () => resolve(Boolean(widget()));
    tag.onerror = () => resolve(false);
    doc.head.appendChild(tag);
  }).then((ok) => { if (!ok) loading = null; return ok; });
  return loading;
}

// Tells the widget who is signed in. Only the three fields the widget takes; nothing is read from the address bar.
export function initSupportWidget({ email, name, company }) {
  const w = widget();
  if (!w || typeof w.init !== "function" || !email) return false;
  if (readyFor === email) return true;
  try {
    w.init({ email, name: name || "", company: company || "" });
    readyFor = email;
    return true;
  } catch (_) {
    return false;
  }
}

// Opens the drawer. False when the widget is not ready, so the caller can use the Support card instead.
export function openSupportWidget() {
  if (!supportWidgetReady()) return false;
  try { widget().open(); return true; } catch (_) { return false; }
}

// On sign-out: close the drawer and drop the identity so the next person does not inherit the conversation.
export function resetSupportWidget() {
  const w = widget();
  readyFor = "";
  if (!w) return;
  try { if (typeof w.close === "function") w.close(); } catch (_) { /* nothing to close */ }
  for (const fn of ["logout", "reset", "destroy"]) {
    try { if (typeof w[fn] === "function") { w[fn](); break; } } catch (_) { /* try the next one */ }
  }
}
