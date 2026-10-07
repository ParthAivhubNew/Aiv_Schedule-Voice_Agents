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
  dashboard: (includeAivhub = true) => request(`/dashboard?include_aivhub=${includeAivhub}`),
  platform: () => request("/platform"),
  clients: (includeAivhub = true, includeArchived = false) => request(`/clients?include_aivhub=${includeAivhub}&include_archived=${includeArchived}`),
  client: (id) => request(`/clients/${q(id)}`),
  setClientStatus: (id, status) => request(`/clients/${q(id)}/status`, { method: "POST", body: { status } }),
  deleteClient: (id, confirmName) => request(`/clients/${q(id)}?confirm_name=${q(confirmName)}`, { method: "DELETE" }),
  previewAward: (id, body) => request(`/clients/${q(id)}/credit-awards/preview`, { method: "POST", body }),
  approveAward: (pendingId, confirm) => request(`/credit-awards/${q(pendingId)}/approve`, { method: "POST", body: { confirm } }),
  cancelAward: (pendingId) => request(`/credit-awards/${q(pendingId)}/cancel`, { method: "POST" }),
  awards: ({ orgId = "", month = "" } = {}) => request(`/credit-awards?org_id=${q(orgId)}&month=${q(month)}`),
  resetUserPassword: (orgId, userId) => request(`/clients/${q(orgId)}/users/${q(userId)}/reset-password`, { method: "POST" }),
  setEnforce: (id, enforce) => request(`/clients/${q(id)}/enforce`, { method: "PUT", body: { enforce } }),
  attachNumber: (orgId, e164) => request(`/clients/${q(orgId)}/numbers/attach`, { method: "POST", body: { e164 } }),
  telnyxAccountNumbers: () => request("/telnyx-account-numbers"),
  setWhatsapp: (orgId, numberId, enabled) => request(`/clients/${q(orgId)}/numbers/${q(numberId)}/whatsapp`, { method: "POST", body: { enabled } }),
  queue: () => request("/verifications"),
  plans: () => request("/plans"),
  createPlan: (body) => request("/plans", { method: "POST", body }),
  updatePlan: (id, body) => request(`/plans/${q(id)}`, { method: "PUT", body }),
  syncPlan: (id) => request(`/plans/${q(id)}/sync-stripe`, { method: "POST" }),
  stripePrices: () => request("/stripe-prices"),
  sellStripePrice: (priceId, wallet, credits) => request("/plans/from-stripe", { method: "POST", body: { priceId, wallet, credits } }),
  telnyxCosts: (month) => request(`/telnyx-costs?month=${q(month)}`),
  voiceCheck: (month) => request(`/voice-reconciliation?month=${q(month)}`),
  runVoiceCheck: (month) => request(`/voice-reconciliation/run?month=${q(month)}`, { method: "POST" }),
  rates: () => request("/rates"),
  setRates: (rates) => request("/rates", { method: "PUT", body: { rates } }),
  revenue: (month, includeAivhub = false) => request(`/revenue?month=${q(month)}&include_aivhub=${includeAivhub}`),
  unitCosts: () => request("/unit-costs"),
  setUnitCosts: (body) => request("/unit-costs", { method: "PUT", body }),
  platformKeys: () => request("/platform-keys"),
  savePlatformKey: (body) => request("/platform-keys/save", { method: "POST", body }),
  clearPlatformKey: (body) => request("/platform-keys/clear", { method: "POST", body }),
  savePlatformAssistant: (body) => request("/platform-keys/assistant", { method: "POST", body }),
  copyPlatformKey: (fromGroup, toGroup, providerName) => request("/platform-keys/copy", { method: "POST", body: { from_group: fromGroup, to_group: toGroup, provider_name: providerName } }),
  platformMailbox: () => request("/platform-mailbox"),
  savePlatformMailbox: (body) => request("/platform-mailbox", { method: "PUT", body }),
  clearPlatformMailbox: () => request("/platform-mailbox", { method: "DELETE" }),
  testPlatformMailbox: () => request("/platform-mailbox/test", { method: "POST" }),
  alerts: () => request("/alerts"),
  alertSeen: (id) => request(`/alerts/${encodeURIComponent(id)}/seen`, { method: "POST" }),
  platformAi: (scope = "scheduler") => request(`/platform-ai/${q(scope)}`),
  voiceCatalogue: () => request("/voice-catalogue"),
  setVoiceCatalogue: (body) => request("/voice-catalogue", { method: "PUT", body }),
  setPlatformAi: (scopeOrBody, maybeBody) => {
    const scope = typeof scopeOrBody === "string" ? scopeOrBody : "scheduler";
    const body = typeof scopeOrBody === "string" ? maybeBody : scopeOrBody;
    return request(`/platform-ai/${q(scope)}`, { method: "PUT", body });
  },
  logs: (orgId = "") => request(`/logs?limit=300${orgId ? `&org_id=${q(orgId)}` : ""}`),
  staff: () => request("/staff"),
  addStaff: (body) => request("/staff", { method: "POST", body }),
  patchStaff: (id, body) => request(`/staff/${q(id)}`, { method: "PATCH", body }),
  platformBalances: () => request("/platform-balances"),
  saveBalanceChecklist: (checklist) => request("/platform-balances/checklist", { method: "POST", body: { checklist } }),
  vendorCosts: (month) => request(`/vendor-costs?month=${q(month)}`),
  socialOauthApps: () => request("/social-oauth-apps"),
  saveSocialOauthApp: (platform, body) => request(`/social-oauth-apps/${q(platform)}`, { method: "PUT", body }),
  modelPricing: () => request("/model-pricing"),
  saveModelPrice: (id, priceIn, priceOut) => request(`/model-pricing/${q(id)}`, { method: "PUT", body: { priceIn, priceOut } }),
  modelPricingMonthlyCost: (month) => request(`/model-pricing/monthly-cost?month=${q(month)}`),
  dataSources: () => request("/data-sources"),
  createDataSource: (body) => request("/data-sources", { method: "POST", body }),
  updateDataSource: (id, body) => request(`/data-sources/${q(id)}`, { method: "PUT", body }),
  deleteDataSource: (id) => request(`/data-sources/${q(id)}`, { method: "DELETE" }),
  controlDataSource: (id, action) => request(`/data-sources/${q(id)}/${q(action)}`, { method: "POST" }),
  startDataSource: (id, queries) => request(`/data-sources/${q(id)}/start`, { method: "POST", body: { queries } }),
  dataSourceRuns: (id) => request(`/data-sources/${q(id)}/runs`),
  dataSourceFiles: (id) => request(`/data-sources/${q(id)}/files`),
  deleteDataSourceFile: (id, name) => request(`/data-sources/${q(id)}/files/${q(name)}`, { method: "DELETE" }),
  previewDataSource: (id) => request(`/data-sources/${q(id)}/preview`, { method: "POST" }),
  // Streams the file as the raw body (XHR, for upload progress): register files run to gigabytes.
  uploadDataSourceFile: (id, file, onProgress) => new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `/api/admin-api/data-sources/${q(id)}/files?name=${q(file.name)}`);
    const token = read(TOKEN_KEY);
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText || "{}"); } catch (_) { /* not JSON, e.g. a proxy error page */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data.detail || (xhr.status === 413 ? "The server or a proxy in front of it refused a file that large. Put it in the server's imports folder instead." : `Upload failed (${xhr.status})`)));
    };
    xhr.onerror = () => reject(new Error("The upload was interrupted. For very large files, put them in the server's imports folder instead."));
    xhr.send(file);
  }),
  businessRecords: (search = "", limit = 100, offset = 0) => request(`/business-records?q=${q(search)}&limit=${limit}&offset=${offset}`),
};
