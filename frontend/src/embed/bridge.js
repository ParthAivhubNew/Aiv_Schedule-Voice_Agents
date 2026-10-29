// Talking to the partner's page (the loader script, public/embed.js, is the other end).
//
// Our page sends: ready, token-needed, connected, event, error, closed.
// The loader sends: init { token | connectToken, appearance }, token { token }, appearance { appearance }, close.
// We only listen to the page that frames us, and the browser only lets the partner's own web addresses do that (the
// frame rule set in frontend/nginx.conf), so a token handed to us by that page is the partner's own.

export const inFrame = () => {
  try {
    return window.parent !== window;
  } catch (_) {
    return true;
  }
};

// The web address of the page above us: what the browser says, else the address its first message came from. "" when not known yet.
let learnedOrigin = "";

export function parentOrigin() {
  try {
    const a = window.location.ancestorOrigins;
    if (a && a.length) return a[0];
  } catch (_) {}
  try {
    if (document.referrer) return new URL(document.referrer).origin;
  } catch (_) {}
  return learnedOrigin;
}

// Messages that carry no data, so they may go out before the parent's address is known (they are how it learns we are here).
const OPEN = new Set(["ready", "token-needed", "closed"]);

export function toParent(type, data = {}) {
  if (!inFrame()) return;
  const origin = parentOrigin() || (OPEN.has(type) ? "*" : "");
  if (!origin) return;
  try {
    window.parent.postMessage({ source: "outreach-embed", type, ...data }, origin);
  } catch (_) {}
}

// Calls handler(message) for each message from the page above us.
export function fromParent(handler) {
  const on = (ev) => {
    if (ev.source !== window.parent) return;
    const d = ev.data;
    if (!d || typeof d !== "object" || d.source !== "outreach-loader" || typeof d.type !== "string") return;
    if (!learnedOrigin && ev.origin && ev.origin !== "null") learnedOrigin = ev.origin;
    handler(d);
  };
  window.addEventListener("message", on);
  return () => window.removeEventListener("message", on);
}

// Asks the page above us for a new token and waits for it. Resolves to the token, or "" when none comes.
export function askForToken(timeoutMs = 8000) {
  return new Promise((resolve) => {
    let off = () => {};
    const timer = setTimeout(() => {
      off();
      resolve("");
    }, timeoutMs);
    off = fromParent((m) => {
      if (m.type !== "token" || typeof m.token !== "string") return;
      clearTimeout(timer);
      off();
      resolve(m.token);
    });
    toParent("token-needed");
  });
}

// Top level (a full-page layout): the loader puts what it would have sent in the address fragment, which never reaches a server.
export function initFromFragment() {
  const raw = (window.location.hash || "").replace(/^#/, "");
  if (!raw) return null;
  const p = new URLSearchParams(raw);
  let appearance;
  try {
    appearance = p.get("appearance") ? JSON.parse(p.get("appearance")) : undefined;
  } catch (_) {}
  try {
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  } catch (_) {}
  const token = p.get("token");
  const connectToken = p.get("connect_token");
  return token || connectToken ? { type: "init", token, connectToken, appearance, returnUrl: p.get("return_url") || "" } : null;
}
