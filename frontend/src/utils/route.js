// Clean URLs: https://outreach.aivhub.com/scheduler/plan instead of /#/scheduler/plan.
//
// The app's screens still describe their location as "#/plugin/page" strings; these helpers
// map that onto the real path, so the rest of the code did not need to change shape.
// Old "#/..." links (bookmarks, emails) are rewritten to the clean path on load.

export const ROUTE_EVENT = "outreach-route";

function notify() {
  try {
    window.dispatchEvent(new Event(ROUTE_EVENT));
  } catch (_) {}
}

// "#/voice/list" for /voice/list, "" for /.
export function routeHash() {
  const path = (window.location.pathname || "/").replace(/\/+$/, "");
  return path && path !== "/" ? `#${path}` : "";
}

function toPath(hashLike) {
  const h = String(hashLike || "").replace(/^#?\/?/, "");
  return "/" + h;
}

export function navigateHash(hashLike) {
  const path = toPath(hashLike);
  if (window.location.pathname === path) return;
  window.history.pushState(null, "", path);
  notify();
}

export function replaceHash(hashLike) {
  const path = toPath(hashLike);
  if (window.location.pathname === path) return;
  window.history.replaceState(null, "", path);
  notify();
}

// Runs cb on back/forward and on in-app navigation. Returns an unsubscribe function.
export function onRouteChange(cb) {
  window.addEventListener("popstate", cb);
  window.addEventListener(ROUTE_EVENT, cb);
  return () => {
    window.removeEventListener("popstate", cb);
    window.removeEventListener(ROUTE_EVENT, cb);
  };
}

// Old links like /#/voice/list?edition=classic become /voice/list.
export function upgradeLegacyHashUrl() {
  const h = window.location.hash || "";
  if (!h.startsWith("#/")) return;
  const clean = h.slice(1).split("?")[0];
  window.history.replaceState(null, "", clean || "/");
}
