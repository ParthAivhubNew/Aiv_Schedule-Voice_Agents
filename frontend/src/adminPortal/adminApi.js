// The staff admin portal's own API client. Staff tokens are kept apart from client sign-ins
// (own sessionStorage key) and only ever sent to /api/admin-api.

const TOKEN_KEY = "outreach_staff_token";
const STAFF_KEY = "outreach_staff";
export const STAFF_SIGNED_OUT = "outreach-staff-signed-out";

function read(key) {
  try {
    return sessionStorage.getItem(key) || "";
  } catch (_) {
    return "";
  }
}

export function savedStaff() {
  try {
    return read(TOKEN_KEY) ? JSON.parse(read(STAFF_KEY) || "null") : null;
  } catch (_) {
    return null;
  }
}

export function saveSession(token, staff) {
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
    sessionStorage.setItem(STAFF_KEY, JSON.stringify(staff));
  } catch (_) {}
}

export function signOut() {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(STAFF_KEY);
  } catch (_) {}
  window.dispatchEvent(new Event(STAFF_SIGNED_OUT));
}

async function request(path, { method = "GET", body } = {}) {
  const headers = { "Content-Type": "application/json" };
  const token = read(TOKEN_KEY);
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`/api/admin-api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && token && !/^\/(login|2fa\/confirm)$/.test(path)) {
    signOut();
    throw new Error("Your staff session ended. Please sign in again.");
  }
  if (!res.ok) {
    const detail = Array.isArray(data.detail) ? data.detail.map((d) => d.msg).join("; ") : data.detail;
    throw new Error(detail || `Request failed (${res.status})`);
  }
  return data;
}

const q = encodeURIComponent;

export const adminApi = {
  login: (email, password, code) => request("/login", { method: "POST", body: { email, password, code: code || null } }),
  confirm2fa: (ticket, code) => request("/2fa/confirm", { method: "POST", body: { ticket, code } }),
  me: () => request("/me"),
  dashboard: () => request("/dashboard"),
  platform: () => request("/platform"),
  clients: () => request("/clients"),
  client: (id) => request(`/clients/${q(id)}`),
  setClientStatus: (id, status) => request(`/clients/${q(id)}/status`, { method: "POST", body: { status } }),
  addCredits: (id, body) => request(`/clients/${q(id)}/credits`, { method: "POST", body }),
  setEnforce: (id, enforce) => request(`/clients/${q(id)}/enforce`, { method: "PUT", body: { enforce } }),
  setWhatsapp: (orgId, numberId, enabled) => request(`/clients/${q(orgId)}/numbers/${q(numberId)}/whatsapp`, { method: "POST", body: { enabled } }),
  queue: () => request("/verifications"),
  plans: () => request("/plans"),
  createPlan: (body) => request("/plans", { method: "POST", body }),
  updatePlan: (id, body) => request(`/plans/${q(id)}`, { method: "PUT", body }),
  syncPlan: (id) => request(`/plans/${q(id)}/sync-stripe`, { method: "POST" }),
  stripePrices: () => request("/stripe-prices"),
  sellStripePrice: (priceId, wallet, credits) => request("/plans/from-stripe", { method: "POST", body: { priceId, wallet, credits } }),
  telnyxCosts: (month) => request(`/telnyx-costs?month=${q(month)}`),
  rates: () => request("/rates"),
  setRates: (rates) => request("/rates", { method: "PUT", body: { rates } }),
  revenue: (month) => request(`/revenue?month=${q(month)}`),
  unitCosts: () => request("/unit-costs"),
  setUnitCosts: (body) => request("/unit-costs", { method: "PUT", body }),
  platformAi: () => request("/platform-ai"),
  voiceCatalogue: () => request("/voice-catalogue"),
  setVoiceCatalogue: (body) => request("/voice-catalogue", { method: "PUT", body }),
  setPlatformAi: (body) => request("/platform-ai", { method: "PUT", body }),
  logs: (orgId = "") => request(`/logs?limit=300${orgId ? `&org_id=${q(orgId)}` : ""}`),
  staff: () => request("/staff"),
  addStaff: (body) => request("/staff", { method: "POST", body }),
  patchStaff: (id, body) => request(`/staff/${q(id)}`, { method: "PATCH", body }),
};
