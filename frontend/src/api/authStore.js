// Sign-in tokens.
// The access token is short-lived and sent on every request; the refresh token gets a new one
// when it expires. In a browser tab they live in sessionStorage, so closing the tab signs out.
// In the installed phone app (home-screen icon) they live in localStorage, so the user stays
// signed in between launches.

const ACCESS_KEY = "outreach_access_token";
const REFRESH_KEY = "outreach_refresh_token";
const OPERATOR_KEY = "aivhub_operator";
export const AUTH_LOST_EVENT = "outreach-auth-lost";
export const PASSWORD_CHANGE_EVENT = "outreach-password-change";

function isInstalledApp() {
  try {
    return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  } catch (_) {
    return false;
  }
}

// Storage that holds the sign-in for this launch mode.
export function authStorage() {
  return isInstalledApp() ? localStorage : sessionStorage;
}

function read(key) {
  try {
    return authStorage().getItem(key) || "";
  } catch (_) {
    return "";
  }
}

function write(key, value) {
  try {
    if (value) authStorage().setItem(key, value);
    else {
      sessionStorage.removeItem(key);
      localStorage.removeItem(key);
    }
  } catch (_) {}
}

// Inside a partner's page the token comes from the partner's server, lives only in memory, and is renewed by asking
// that page (see src/embed). Nothing is written to storage.
let embedAuth = null;

export function setEmbedAuth(auth) {
  embedAuth = auth;
}

export function getAccessToken() {
  return embedAuth ? embedAuth.token : read(ACCESS_KEY);
}

export function setSession({ access_token, refresh_token, operator } = {}) {
  if (access_token) write(ACCESS_KEY, access_token);
  if (refresh_token) write(REFRESH_KEY, refresh_token);
  if (operator) write(OPERATOR_KEY, JSON.stringify(operator));
}

export function clearSession() {
  write(ACCESS_KEY, "");
  write(REFRESH_KEY, "");
  write(OPERATOR_KEY, "");
}

export function hasSession() {
  return Boolean(read(ACCESS_KEY) && read(REFRESH_KEY));
}

// Adds the access token to a URL for things that cannot send headers
// (<audio src>, download links, WebSockets).
export function withToken(url) {
  const token = getAccessToken();
  if (!token) return url;
  return `${url}${url.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`;
}

let refreshing = null;

// Gets a new access token with the refresh token. Several callers share one request.
export function refreshSession() {
  if (embedAuth) return embedAuth.refresh();
  if (refreshing) return refreshing;
  const refresh_token = read(REFRESH_KEY);
  if (!refresh_token) return Promise.resolve(false);
  refreshing = fetch("/api/auth/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token }),
  })
    .then(async (res) => {
      if (!res.ok) return false;
      const data = await res.json();
      setSession(data);
      return true;
    })
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export function announceAuthLost() {
  clearSession();
  try {
    window.dispatchEvent(new Event(AUTH_LOST_EVENT));
  } catch (_) {}
}

export function announcePasswordChange() {
  try {
    window.dispatchEvent(new Event(PASSWORD_CHANGE_EVENT));
  } catch (_) {}
}
