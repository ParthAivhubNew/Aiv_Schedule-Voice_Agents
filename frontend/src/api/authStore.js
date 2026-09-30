// Sign-in tokens for this browser tab.
// The access token is short-lived and sent on every request; the refresh token gets a new one
// when it expires. Both live in sessionStorage, so closing the tab signs out.

const ACCESS_KEY = "outreach_access_token";
const REFRESH_KEY = "outreach_refresh_token";
const OPERATOR_KEY = "aivhub_operator";
export const AUTH_LOST_EVENT = "outreach-auth-lost";
export const PASSWORD_CHANGE_EVENT = "outreach-password-change";

function read(key) {
  try {
    return sessionStorage.getItem(key) || "";
  } catch (_) {
    return "";
  }
}

function write(key, value) {
  try {
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch (_) {}
}

export function getAccessToken() {
  return read(ACCESS_KEY);
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
