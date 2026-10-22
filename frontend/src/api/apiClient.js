import {
  announceAuthLost,
  announcePasswordChange,
  getAccessToken,
  refreshSession,
  setSession,
  clearSession,
} from "./authStore";

const API_BASE = "/api";

// In-flight GET request deduplication map to prevent redundant concurrent fetches
const inFlightGetRequests = new Map();

export async function apiRequest(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
  const { timeoutMs, signal: outerSignal, asBlob, ...fetchOptions } = options;
  const isGet = (!fetchOptions.method || fetchOptions.method.toUpperCase() === 'GET');

  // Deduplicate identical concurrent GET requests
  if (isGet && !outerSignal && !timeoutMs) {
    const existingPromise = inFlightGetRequests.get(url);
    if (existingPromise) {
      return existingPromise;
    }
  }

  const headers = {
    'Content-Type': 'application/json',
    ...(fetchOptions.headers || {}),
  };

  const isAuthCall = /^\/auth\/(login|refresh)$/.test(endpoint.startsWith('/') ? endpoint : `/${endpoint}`);

  if (fetchOptions.body && typeof fetchOptions.body === 'object' && !(fetchOptions.body instanceof FormData)) {
    fetchOptions.body = JSON.stringify(fetchOptions.body);
  }

  if (fetchOptions.body instanceof FormData) {
    delete headers['Content-Type'];
  }

  const executeFetch = async () => {
    const controller = new AbortController();
    let timedOut = false;
    let timer = null;
    if (timeoutMs && timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
    }
    if (outerSignal) {
      if (outerSignal.aborted) controller.abort();
      else outerSignal.addEventListener("abort", () => controller.abort(), { once: true });
    }

    try {
      const send = () => {
        const token = getAccessToken();
        const h = { ...headers };
        if (token && !isAuthCall) h.Authorization = `Bearer ${token}`;
        return fetch(url, { ...fetchOptions, headers: h, signal: controller.signal });
      };
      let response = await send();

      // Expired access token: get a new one once and retry. No valid session: back to sign-in.
      if (response.status === 401 && !isAuthCall) {
        if (await refreshSession()) {
          response = await send();
        }
        if (response.status === 401) {
          announceAuthLost();
          throw new Error("Your session ended. Please sign in again.");
        }
      }
      if (response.status === 403 && !isAuthCall) {
        const peek = await response.clone().json().catch(() => ({}));
        if (peek && peek.code === "password_change_required") announcePasswordChange();
      }

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        let msg = `Request failed with status ${response.status}`;
        if (response.status === 413) {
          msg = "Upload too large (413). Record 30–60 seconds; the app compresses audio before send.";
        }
        if (typeof errData.detail === 'string') {
          msg = errData.detail;
        } else if (Array.isArray(errData.detail)) {
          msg = errData.detail.map(d => (d.msg ? `${d.loc ? d.loc.slice(-1)[0] + ': ' : ''}${d.msg}` : JSON.stringify(d))).join('; ');
        } else if (errData.detail && typeof errData.detail === 'object') {
          msg = errData.detail.message || JSON.stringify(errData.detail);
        } else if (errData.error) {
          msg = typeof errData.error === 'string' ? errData.error : JSON.stringify(errData.error);
        }
        const apiErr = new Error(msg);
        apiErr.status = response.status;
        apiErr.code = (errData.detail && errData.detail.code) || errData.code || "";
        throw apiErr;
      }

      return asBlob ? await response.blob() : await response.json();
    } catch (error) {
      if (timedOut) {
        throw new Error("Request timed out — backend may be restarting or unreachable. Try again.");
      }
      if (error && (error.name === "AbortError" || error.message === "The user aborted a request.")) {
        throw error;
      }
      console.error(`API Error on ${url}:`, error);
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  if (isGet && !outerSignal && !timeoutMs) {
    const p = executeFetch().finally(() => {
      // Clear from in-flight cache shortly after resolution
      setTimeout(() => {
        if (inFlightGetRequests.get(url) === p) {
          inFlightGetRequests.delete(url);
        }
      }, 1000);
    });
    inFlightGetRequests.set(url, p);
    return p;
  }

  return executeFetch();
}

// Low call minutes: the server warns before a call (or list) that may be cut short. The user
// can call anyway; the call then ends when the minutes run out, with a wrap-up a minute before.
const confirmShortCall = (send) => async (payload) => {
  try {
    return await send(payload);
  } catch (e) {
    if (e.code !== 'LOW_MINUTES' || typeof window === 'undefined') throw e;
    if (!window.confirm(e.message)) {
      const stop = new Error('Call not placed. Top up Voice credits in Plans & credits for longer calls.');
      stop.code = 'CANCELLED';
      throw stop;
    }
    return send({ ...payload, accept_capped: true });
  }
};

export const api = {
  // Auth & Team
  login: async (username, password) => {
    const res = await apiRequest('/auth/login', { method: 'POST', body: { username, password } });
    setSession(res);
    return res;
  },
  logout: async () => {
    try { await apiRequest('/auth/logout', { method: 'POST' }); } catch (_) {}
    clearSession();
  },
  getMe: () => apiRequest('/auth/me'),
  getSessionPolicy: () => apiRequest('/auth/session-policy'),
  saveSessionPolicy: (idle_minutes, max_hours) => apiRequest('/auth/session-policy', { method: 'PUT', body: { idle_minutes, max_hours } }),
  getSignupConfig: () => apiRequest('/auth/signup-config'),
  signup: (data) => apiRequest('/auth/signup', { method: 'POST', body: data }),
  forgotPassword: (email) => apiRequest('/auth/forgot-password', { method: 'POST', body: { email } }),
  resetPassword: (token, password) => apiRequest('/auth/reset-password', { method: 'POST', body: { token, password } }),
  resendVerification: (email) => apiRequest('/auth/resend-verification', { method: 'POST', body: { email } }),
  firebaseSignIn: async (idToken) => {
    const res = await apiRequest('/auth/firebase', { method: 'POST', body: { idToken } });
    setSession(res);
    return res;
  },
  getOnboarding: () => apiRequest('/auth/onboarding'),
  getCredits: () => apiRequest('/credits'),
  getLeadCredits: () => apiRequest('/credits/leads'),
  getWalletGlance: (wallet) => apiRequest(`/credits/wallet/${encodeURIComponent(wallet)}`),
  getNumbersOverview: () => apiRequest('/telnyx/overview'),
  getNumberRequirements: (country, numberType) => apiRequest(`/telnyx/requirements?country=${encodeURIComponent(country)}&number_type=${encodeURIComponent(numberType)}`),
  submitVerification: ({ entityType, texts, addresses, files }) => {
    const form = new FormData();
    form.append('entity_type', entityType);
    form.append('texts', JSON.stringify(texts || {}));
    form.append('addresses', JSON.stringify(addresses || {}));
    Object.entries(files || {}).forEach(([id, file]) => form.append(`doc_${id}`, file, file.name));
    return apiRequest('/telnyx/verification', { method: 'POST', body: form, timeoutMs: 120000 });
  },
  searchNumbers: ({ locality = '', areaCode = '', country = 'GB', numberType = 'local' }) =>
    apiRequest(`/telnyx/numbers/search?country=${country}&number_type=${numberType}&locality=${encodeURIComponent(locality)}&area_code=${encodeURIComponent(areaCode)}`),
  setAllowedCountries: (countries) => apiRequest('/telnyx/allowed-countries', { method: 'PUT', body: { countries } }),
  orderNumber: (n) => apiRequest('/telnyx/numbers/order', { method: 'POST', body: { phoneNumber: n.phoneNumber } }),
  releaseNumber: (id) => apiRequest(`/telnyx/numbers/${encodeURIComponent(id)}/release`, { method: 'POST' }),
  requestWhatsapp: (id) => apiRequest(`/wa/numbers/${encodeURIComponent(id)}/request`, { method: 'POST' }),
  checkWhatsapp: (id) => apiRequest(`/wa/numbers/${encodeURIComponent(id)}/check`, { method: 'POST' }),
  whatsappOff: (id) => apiRequest(`/wa/numbers/${encodeURIComponent(id)}/off`, { method: 'POST' }),
  getWaStatus: () => apiRequest('/wa/status'),
  getWaThreads: () => apiRequest('/wa/threads'),
  getWaThread: (id) => apiRequest(`/wa/threads/${encodeURIComponent(id)}`),
  sendWa: (id, payload) => apiRequest(`/wa/threads/${encodeURIComponent(id)}/send`, { method: 'POST', body: payload }),
  patchWaThread: (id, data) => apiRequest(`/wa/threads/${encodeURIComponent(id)}`, { method: 'PATCH', body: data }),
  startWaThread: (data) => apiRequest('/wa/threads', { method: 'POST', body: data }),
  getBillingOverview: () => apiRequest('/billing/overview'),
  getBillingAccess: () => apiRequest('/billing/access'),
  getCreditUsage: (month, wallet = '') => apiRequest(`/credits/usage?month=${encodeURIComponent(month)}&wallet=${encodeURIComponent(wallet)}`),
  startCheckout: (plans, topups, back = '/', quantities = {}) => apiRequest('/billing/checkout', { method: 'POST', body: { plans, topups, back, quantities } }),
  openBillingPortal: (back = '/') => apiRequest('/billing/portal', { method: 'POST', body: { back } }),
  getLivePlans: () => apiRequest('/billing/subscriptions'),
  changePlan: (plan) => apiRequest('/billing/plan', { method: 'POST', body: { plan } }),
  cancelPlan: (wallet, cancel = true, reason = '', note = '') => apiRequest('/billing/cancel', { method: 'POST', body: { wallet, cancel, reason, note } }),
  getBillingEvents: (orgId = '') => apiRequest(`/admin-api/billing-events${orgId ? `?org_id=${encodeURIComponent(orgId)}` : ''}`),
  updateMe: (data) => apiRequest('/auth/me', { method: 'PATCH', body: data }),
  uploadMyAvatar: (file) => {
    const form = new FormData();
    form.append('file', file, file.name);
    return apiRequest('/auth/me/avatar', { method: 'POST', body: form, timeoutMs: 60000 });
  },
  deleteMyAvatar: () => apiRequest('/auth/me/avatar', { method: 'DELETE' }),
  getMySessions: () => apiRequest('/auth/me/sessions'),
  endMySession: (id) => apiRequest(`/auth/me/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  signOutOtherSessions: () => apiRequest('/auth/me/sessions/sign-out-others', { method: 'POST' }),
  getMyNotifications: () => apiRequest('/auth/me/notifications'),
  setMyNotifications: (events) => apiRequest('/auth/me/notifications', { method: 'PUT', body: { events } }),
  changePassword: (current_password, new_password) =>
    apiRequest('/auth/change-password', { method: 'POST', body: { current_password, new_password } }),
  getSections: () => apiRequest('/auth/sections'),
  getUsers: () => apiRequest('/auth/users'),
  createUser: (data) => apiRequest('/auth/users', { method: 'POST', body: data }),
  updateUser: (id, data) => apiRequest(`/auth/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: data }),
  resetUserPassword: (id) => apiRequest(`/auth/users/${encodeURIComponent(id)}/reset-password`, { method: 'POST' }),
  getRoles: () => apiRequest('/auth/roles'),
  createRole: (data) => apiRequest('/auth/roles', { method: 'POST', body: data }),
  updateRole: (id, data) => apiRequest(`/auth/roles/${encodeURIComponent(id)}`, { method: 'PUT', body: data }),
  deleteRole: (id) => apiRequest(`/auth/roles/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  getNumbers: () => apiRequest('/numbers'),
  estimateNumberCheck: (items) => apiRequest('/number-check/estimate', { method: 'POST', body: { items }, timeoutMs: 60000 }),
  runNumberCheck: (items) => apiRequest('/number-check/run', { method: 'POST', body: { items }, timeoutMs: 180000 }),
  addNumber: (data) => apiRequest('/numbers', { method: 'POST', body: data }),
  updateNumber: (id, data) => apiRequest(`/numbers/${encodeURIComponent(id)}`, { method: 'PATCH', body: data }),
  assignNumber: (id, operator_ids) => apiRequest(`/numbers/${encodeURIComponent(id)}/assignments`, { method: 'PUT', body: { operator_ids } }),
  deleteNumber: (id) => apiRequest(`/numbers/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  getShare: (section) => apiRequest(`/auth/share/${encodeURIComponent(section)}`),
  setShare: (section, user_levels) => apiRequest('/auth/share', { method: 'PUT', body: { section, user_levels } }),

  // Missions
  getMissions: () => apiRequest('/missions'),
  createMission: (payload) => apiRequest('/missions', { method: 'POST', body: payload }),
  parseSpreadsheet: (formData) => apiRequest('/missions/upload-parse', { method: 'POST', body: formData }),

  // Prospects & Registry
  getProspects: () => apiRequest('/prospects'),
  getRegistry: () => apiRequest('/prospects/registry'),

  // Calls
  getLiveCalls: (opts = {}) => apiRequest(opts.includeEnded ? '/calls/live?include_ended=true' : '/calls/live'),
  endLiveCall: (callId) => apiRequest(`/calls/live/${callId}/end`, { method: 'POST' }),
  deleteLiveCall: (callId) => apiRequest(`/calls/live/${callId}`, { method: 'DELETE' }),
  clearLiveCalls: () => apiRequest('/calls/live', { method: 'DELETE' }),
  toggleListen: (callId) => apiRequest(`/calls/live/${callId}/listen`, { method: 'POST' }),
  toggleTakeover: (callId) => apiRequest(`/calls/live/${callId}/takeover`, { method: 'POST' }),
  handBackCall: (callId, note = '') => apiRequest(`/calls/live/${callId}/handback`, { method: 'POST', body: { note } }),
  summarizeLiveCall: (callId) => apiRequest(`/calls/live/${callId}/summary`, { method: 'POST' }),
  emailLiveCallSummary: (callId) => apiRequest(`/calls/live/${callId}/email-summary`, { method: 'POST' }),
  summarizeLoggedCall: (logId) => apiRequest(`/calls/logs/${logId}/summary`, { method: 'POST' }),
  emailLoggedCallSummary: (logId) => apiRequest(`/calls/logs/${logId}/email-summary`, { method: 'POST' }),
  confirmBooking: (callId) => apiRequest(`/calls/live/${callId}/confirm-booking`, { method: 'POST' }),
  getCallLogs: () => apiRequest('/calls/logs'),
  dialOutbound: confirmShortCall((payload) => apiRequest('/calls/outbound/dial', { method: 'POST', body: payload })),
  dialOutboundBatch: confirmShortCall((payload) => apiRequest('/calls/outbound/batch', { method: 'POST', body: payload })),
  getCarrierPlugins: () => apiRequest('/calls/outbound/carriers'),

  // LiveKit WebRTC Voice Engine
  getLiveKitStatus: () => apiRequest('/livekit/status'),
  getLiveKitConfig: () => apiRequest('/livekit/config'),
  createLiveKitToken: (payload) => apiRequest('/livekit/token', { method: 'POST', body: payload }),

  // Meetings
  getMeetings: () => apiRequest('/meetings'),
  logOutcome: (meetingId, payload) => apiRequest(`/meetings/${meetingId}/outcome`, { method: 'POST', body: payload }),
  saveMeetingTranscript: (meetingId, transcript) => apiRequest(`/meetings/${meetingId}/transcript`, { method: 'POST', body: { transcript } }),

  // Schedule
  getSchedule: () => apiRequest('/schedule'),
  createScheduleItem: (payload) => apiRequest('/schedule', { method: 'POST', body: payload }),
  getScheduleItem: (id) => apiRequest(`/schedule/${id}`),
  updateScheduleItem: (id, payload) => apiRequest(`/schedule/${id}`, { method: 'PATCH', body: payload }),
  deleteScheduleItem: (id) => apiRequest(`/schedule/${id}`, { method: 'DELETE' }),
  getWhatsappStatus: () => apiRequest('/schedule/whatsapp-status'),
  getMeetingLinks: () => apiRequest('/meeting-links/status'),
  startMeetingLink: (provider) => apiRequest(`/meeting-links/${provider}/start`),
  disconnectMeetingLink: (provider) => apiRequest(`/meeting-links/${provider}`, { method: 'DELETE' }),
  sendScheduleWhatsapp: (id, payload) => apiRequest(`/schedule/${id}/whatsapp`, { method: 'POST', body: payload || {} }),

  // Profile & Knowledge (RAG & Crawler)
  getProfile: () => apiRequest('/profile'),
  updateProfile: (profile) => apiRequest('/profile', { method: 'PUT', body: profile }),
  getOrgSettings: () => apiRequest('/profile/org'),
  saveOrgSettings: (payload) => apiRequest('/profile/org', { method: 'PUT', body: payload }),
  getAgentStudio: () => apiRequest('/voice-studio'),
  saveAgentStudioMe: (data) => apiRequest('/voice-studio/me', { method: 'PUT', body: data }),
  saveAgentStudioCompany: (data) => apiRequest('/voice-studio/company', { method: 'PUT', body: data }),
  setCampaignScript: (missionId, templateId) => apiRequest(`/voice-studio/campaigns/${encodeURIComponent(missionId)}`, { method: 'PUT', body: { templateId } }),
  addVoiceClone: ({ file, name, language, gender, consent, refText = '' }) => {
    const form = new FormData();
    form.append('audio', file);
    Object.entries({ name, language, gender, consent: consent ? 'true' : 'false', refText }).forEach(([k, v]) => form.append(k, v));
    return apiRequest('/voice-studio/clones', { method: 'POST', body: form, timeoutMs: 120000 });
  },
  deleteVoiceClone: (id) => apiRequest(`/voice-studio/clones/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  agentStudioVoicePreview: (voice) => apiRequest(`/voice-studio/preview?voice=${encodeURIComponent(voice)}`, { asBlob: true, timeoutMs: 30000 }),
  agentStudioTestCall: (templateId = '') => apiRequest('/voice-studio/test-call', { method: 'POST', body: { templateId }, timeoutMs: 30000 }),
  getSources: () => apiRequest('/profile/sources'),
  addSource: (source) => apiRequest('/profile/sources', { method: 'POST', body: source }),
  uploadSource: (file, name = '') => {
    const form = new FormData();
    form.append('file', file, file.name);
    form.append('name', name);
    return apiRequest('/profile/sources/upload', { method: 'POST', body: form, timeoutMs: 120000 });
  },
  resyncSource: (sourceId) => apiRequest(`/profile/sources/${sourceId}/resync`, { method: 'POST' }),
  deleteSource: (sourceId) => apiRequest(`/profile/sources/${sourceId}`, { method: 'DELETE' }),
  getSourceChunks: (sourceId) => apiRequest(`/profile/sources/${sourceId}/chunks`),
  testKnowledgeQuery: (query, topK = 3) => apiRequest('/profile/sources/test-query', { method: 'POST', body: { query, top_k: topK } }),
  getServices: () => apiRequest('/profile/services'),
  saveServices: (services) => apiRequest('/profile/services', { method: 'PUT', body: { services } }),
  getFaqs: () => apiRequest('/profile/faqs'),
  saveFaqs: (faqs) => apiRequest('/profile/faqs', { method: 'PUT', body: { faqs } }),
  getNotifications: () => apiRequest('/profile/notifications'),

  // Connections & Key Testing
  getConnections: () => apiRequest('/connections'),
  addConnection: (conn) => apiRequest('/connections', { method: 'POST', body: conn }),
  testConnection: (payload) => apiRequest('/connections/test', { method: 'POST', body: payload, timeoutMs: 15000 }),
  testAndSaveConnection: (payload) => apiRequest('/connections/test-and-save', { method: 'POST', body: payload, timeoutMs: 20000 }),
  clearConnectionKey: (payload) => apiRequest('/connections/clear-key', { method: 'POST', body: payload, timeoutMs: 12000 }),
  connectionUsage: ({ id, layer, provider }) => apiRequest(`/connections/usage?${new URLSearchParams(Object.entries({ id, layer, provider }).filter(([, v]) => v)).toString()}`),
  updateConnectionConfig: (payload) => apiRequest('/connections/update-config', { method: 'POST', body: payload }),
  getTelnyxAssistantSettings: () => apiRequest('/connections/telnyx-assistant-settings'),
  saveTelnyxAssistantSettings: (payload) => apiRequest('/connections/telnyx-assistant-settings', { method: 'POST', body: payload }),
  dialViaTelnyxAssistant: confirmShortCall((payload) => apiRequest('/telnyx-assistant/dial', { method: 'POST', body: payload, timeoutMs: 15000 })),
  resetDemoData: () => apiRequest('/connections/reset-demo-data', { method: 'POST' }),
  getTelephonyHub: () => apiRequest('/connections/telephony-hub'),
  provisionTelephonyHub: (payload) => apiRequest('/connections/telephony-hub/provision', { method: 'POST', body: payload }),
  getActiveStack: () => apiRequest('/connections/telephony-hub/select-stack'),
  selectActiveStack: (payload) => apiRequest('/connections/telephony-hub/select-stack', { method: 'POST', body: payload }),
  testTelephonyPing: () => apiRequest('/connections/telephony-hub/test-ping', { method: 'POST' }),
  getVoiceLibrary: () => apiRequest('/voices/library'),
  addLibraryVoice: (payload) => apiRequest('/voices', { method: 'POST', body: payload }),
  removeLibraryVoice: (id) => apiRequest(`/voices/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  setCallVoice: (kind, ref) => apiRequest('/voices/active', { method: 'POST', body: { kind, ref } }),
  getVoiceCatalog: (provider) => apiRequest(`/voices/catalog/${encodeURIComponent(provider)}`, { timeoutMs: 20000 }),

  // AI Lead Radar & Enrichment
  enrichProspect: (payload) => apiRequest('/enrichment/enrich-prospect', { method: 'POST', body: payload }),
  discoverAccounts: (payload) => apiRequest('/enrichment/discover-accounts', { method: 'POST', body: payload, timeoutMs: 90000 }),
  // Leads saved accounts (stored per company on the server)
  listLeadAccounts: () => apiRequest('/leads/accounts'),
  saveLeadAccounts: (accounts, listName) => apiRequest('/leads/accounts', { method: 'POST', body: { accounts, list_name: listName || '' } }),
  updateLeadAccount: (id, changes) => apiRequest(`/leads/accounts/${encodeURIComponent(id)}`, { method: 'PATCH', body: changes }),
  deleteLeadAccount: (id) => apiRequest(`/leads/accounts/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  searchCompanies: (body) => apiRequest('/leads/search', { method: 'POST', body, timeoutMs: 40000 }),
  townDistricts: (town, includeClosed = false) => apiRequest(`/leads/districts?town=${encodeURIComponent(town)}&include_closed=${includeClosed}`),
  areaCount: (body) => apiRequest('/leads/search/area-count', { method: 'POST', body, timeoutMs: 60000 }),
  geocodeCompanies: (ids) => apiRequest('/leads/geocode', { method: 'POST', body: { ids }, timeoutMs: 40000 }),
  companyContacts: (id, body) => apiRequest(`/leads/companies/${encodeURIComponent(id)}/contacts`, { method: 'POST', body, timeoutMs: 120000 }),
  researchLeadAccount: (id) => apiRequest(`/leads/accounts/${encodeURIComponent(id)}/research`, { method: 'POST', timeoutMs: 120000 }),
  quickCheckLeadAccount: (id) => apiRequest(`/leads/accounts/${encodeURIComponent(id)}/quick-check`, { method: 'POST' }),
  // Check companies (Saved Accounts): validate a list against our records, the registers and the web
  estimateCompanyCheck: (body) => apiRequest('/leads/checks/estimate', { method: 'POST', body, timeoutMs: 30000 }),
  checkLeadAccount: (id) => apiRequest(`/leads/checks/account/${encodeURIComponent(id)}`, { method: 'POST', timeoutMs: 120000 }),
  startCompanyCheck: (body) => apiRequest('/leads/checks', { method: 'POST', body, timeoutMs: 30000 }),
  latestCompanyCheck: () => apiRequest('/leads/checks/latest'),
  getCompanyCheck: (id) => apiRequest(`/leads/checks/${encodeURIComponent(id)}`),
  pauseCompanyCheck: (id) => apiRequest(`/leads/checks/${encodeURIComponent(id)}/pause`, { method: 'POST' }),
  resumeCompanyCheck: (id) => apiRequest(`/leads/checks/${encodeURIComponent(id)}/resume`, { method: 'POST' }),
  listLeadLists: () => apiRequest('/leads/lists'),
  createLeadList: (name, ids) => apiRequest('/leads/lists', { method: 'POST', body: { name, ids } }),
  updateLeadList: (id, changes) => apiRequest(`/leads/lists/${encodeURIComponent(id)}`, { method: 'PATCH', body: changes }),
  // Working together: Lead Gen + Voice + Social
  getPluginLinks: () => apiRequest('/together/availability'),
  getConnectionRules: () => apiRequest('/together/rules'),
  saveConnectionRules: (rules) => apiRequest('/together/rules', { method: 'PUT', body: { rules } }),
  getConnectionLeads: () => apiRequest('/together/leads'),
  getPipeline: () => apiRequest('/together/pipeline'),
  getNextActions: (limit = 5) => apiRequest(`/together/next-actions?limit=${limit}`),
  searchEverything: (q) => apiRequest(`/together/search?q=${encodeURIComponent(q)}`),
  getInbox: () => apiRequest('/together/inbox'),
  getConnectionChecklist: () => apiRequest('/together/checklist'),
  getWeeklySummary: () => apiRequest('/together/weekly-summary'),
  sendWeeklySummary: () => apiRequest('/together/weekly-summary/send', { method: 'POST' }),
  backfillConnections: (dryRun = true) => apiRequest(`/together/backfill?dry_run=${dryRun}`, { method: 'POST', timeoutMs: 120000 }),
  getWorkflows: () => apiRequest('/together/workflows'),
  saveWorkflows: (workflows) => apiRequest('/together/workflows', { method: 'PUT', body: { workflows } }),
  getDoNotContact: () => apiRequest('/compliance/do-not-contact'),
  addDoNotContact: (body) => apiRequest('/compliance/do-not-contact', { method: 'POST', body }),
  removeDoNotContact: (id) => apiRequest(`/compliance/do-not-contact/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  getTimeline: (id, kinds = '') => apiRequest(`/contacts/${encodeURIComponent(id)}/timeline${kinds ? `?kinds=${encodeURIComponent(kinds)}` : ''}`),
  getDuplicates: () => apiRequest('/contacts/duplicates'),
  mergeContacts: (keepId, mergeIds) => apiRequest('/contacts/merge', { method: 'POST', body: { keep_id: keepId, merge_ids: mergeIds } }),
  resolveSuggestion: (leadId, suggestionId, accept) => apiRequest(`/leads/accounts/${encodeURIComponent(leadId)}/suggestions/${encodeURIComponent(suggestionId)}`, { method: 'POST', body: { accept } }),
  setLeadStage: (leadId, stage, note = '') => apiRequest(`/leads/accounts/${encodeURIComponent(leadId)}/stage`, { method: 'POST', body: { stage, note } }),
  addLeadNote: (leadId, text) => apiRequest(`/leads/accounts/${encodeURIComponent(leadId)}/notes`, { method: 'POST', body: { text } }),
  previewListCalls: (id, body = {}) => apiRequest(`/leads/lists/${encodeURIComponent(id)}/call-preview`, { method: 'POST', body }),
  callList: (id, body = {}) => apiRequest(`/leads/lists/${encodeURIComponent(id)}/call`, { method: 'POST', body, timeoutMs: 60000 }),
  previewCalls: (body) => apiRequest('/leads/accounts/call-preview', { method: 'POST', body }),
  callCompanies: (body) => apiRequest('/leads/accounts/call', { method: 'POST', body, timeoutMs: 60000 }),
  previewCallOne: (id, body = {}) => apiRequest(`/leads/accounts/${encodeURIComponent(id)}/call-preview`, { method: 'POST', body }),
  callNow: (id, body = {}) => apiRequest(`/leads/accounts/${encodeURIComponent(id)}/call-now`, { method: 'POST', body, timeoutMs: 60000 }),
  getSlotsByEmail: (email) => apiRequest(`/leads/slots-by-email?email=${encodeURIComponent(email)}`),
  getFailedEvents: () => apiRequest('/together/failed-events'),
  retryFailedEvent: (id) => apiRequest(`/together/failed-events/${encodeURIComponent(id)}/retry`, { method: 'POST' }),
  getBookingLink: (leadId = '') => apiRequest(`/leads/booking-link?lead_id=${encodeURIComponent(leadId)}`),
  getLeadSlots: (id) => apiRequest(`/leads/accounts/${encodeURIComponent(id)}/slots`),
  bookFromLead: (body) => apiRequest('/meetings/from-lead', { method: 'POST', body }),
  markNoShow: (meetingId) => apiRequest(`/meetings/${encodeURIComponent(meetingId)}/no-show`, { method: 'POST' }),
  getProofBlocks: () => apiRequest('/leads/proof-blocks'),
  getPostEngagers: (postId) => apiRequest(`/social/posts/${encodeURIComponent(postId)}/engagers`),
  refreshPostEngagers: (postId) => apiRequest(`/social/posts/${encodeURIComponent(postId)}/engagers/refresh`, { method: 'POST', timeoutMs: 60000 }),
  addPostEngagers: (postId, people) => apiRequest(`/social/posts/${encodeURIComponent(postId)}/engagers`, { method: 'POST', body: { people } }),
  engagersToList: (ids, listName) => apiRequest('/social/engagers/to-list', { method: 'POST', body: { ids, list_name: listName } }),
  getAudience: () => apiRequest('/social/audience'),
  getPostBookingLink: (postId, slug) => apiRequest(`/social/posts/${encodeURIComponent(postId)}/booking-link`, { method: 'POST', body: slug ? { slug } : {} }),
  getPostBookings: (postId) => apiRequest(`/social/posts/${encodeURIComponent(postId)}/bookings`),
  getBookingCredit: () => apiRequest('/social/booking-credit'),
  makeEventPost: (body) => apiRequest('/social/event-post', { method: 'POST', body, timeoutMs: 30000 }),
  getObjections: () => apiRequest('/social/objections'),
  makeObjectionPost: (key) => apiRequest('/social/objection-post', { method: 'POST', body: { key }, timeoutMs: 30000 }),
  makeRecapPost: (meetingId, permission) => apiRequest('/social/recap-post', { method: 'POST', body: { meeting_id: meetingId, permission }, timeoutMs: 30000 }),
  makeTopicPost: (title, why, postId = '') => apiRequest('/social/topic-post', { method: 'POST', body: { title, why, post_id: postId }, timeoutMs: 30000 }),
  getTopicIdeas: () => apiRequest('/social/topic-ideas'),
  getBestTimes: () => apiRequest('/social/best-times'),
  getSharePreview: (listId) => apiRequest(`/social/share-preview?list_id=${encodeURIComponent(listId)}`),
  sharePostToList: (postId, listId, note = '', leadIds = []) => apiRequest(`/social/posts/${encodeURIComponent(postId)}/share-to-list`, { method: 'POST', body: { list_id: listId, note, lead_ids: leadIds }, timeoutMs: 60000 }),
  deleteLeadList: (id) => apiRequest(`/leads/lists/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  acceptCheckFixes: (ids, fields) => apiRequest('/leads/checks/fixes/accept', { method: 'POST', body: { ids, fields: fields || [] }, timeoutMs: 60000 }),
  cancelCompanyCheck:(id) => apiRequest(`/leads/checks/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
  deepSearchLeadAccount: (id) => apiRequest(`/leads/accounts/${encodeURIComponent(id)}/deep-search`, { method: 'POST', timeoutMs: 30000 }),
  fillContactGaps: (payload, extra = {}) => apiRequest('/enrichment/fill-gaps', { method: 'POST', body: payload, signal: extra.signal }),
  copilotChat: (payload) => apiRequest('/enrichment/copilot-chat', { method: 'POST', body: payload }),
  openChat: (payload) => apiRequest('/enrichment/copilot-chat', { method: 'POST', body: payload }),

  // Analytics
  getAnalytics: () => apiRequest('/analytics'),
  getUsageQuotas: () => apiRequest('/analytics/usage'),

  // Post Scheduler & Visual Generator
  getPosts: () => apiRequest('/scheduler/posts'),
  createPost: (payload) => apiRequest('/scheduler/posts/create', { method: 'POST', body: payload }),
  deletePost: (postId) => apiRequest(`/scheduler/posts/${postId}`, { method: 'DELETE' }),
  editPost: (postId, changes) => apiRequest(`/scheduler/posts/${encodeURIComponent(postId)}`, { method: 'PATCH', body: changes }),
  listPostVersions: (postId) => apiRequest(`/scheduler/posts/${encodeURIComponent(postId)}/versions`),
  restorePostVersion: (postId, versionId) => apiRequest(`/scheduler/posts/${encodeURIComponent(postId)}/versions/${encodeURIComponent(versionId)}/restore`, { method: 'POST' }),
  getBrandVoice: () => apiRequest('/scheduler/brand-voice'),
  saveBrandVoice: (data) => apiRequest('/scheduler/brand-voice', { method: 'PUT', body: data }),
  getChatThreads: () => apiRequest('/scheduler/chat-threads'),
  saveChatThread: (id, data) => apiRequest(`/scheduler/chat-threads/${encodeURIComponent(id)}`, { method: 'PUT', body: data }),
  deleteChatThread: (id) => apiRequest(`/scheduler/chat-threads/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  chatPlan: (payload, options = {}) => apiRequest('/scheduler/chat-plan', { 
    method: 'POST', 
    body: typeof payload === 'string' ? { text: payload } : payload,
    ...options
  }),
  generateImage: (payload) => apiRequest('/scheduler/generate-image', { 
    method: 'POST', 
    body: typeof payload === 'string' ? { prompt: payload } : payload 
  }),
  queueGeneration: (payload) => apiRequest('/scheduler/generate', { method: 'POST', body: payload }),
  retryGeneration: (payload) => apiRequest('/scheduler/generate/retry', { method: 'POST', body: payload }),
  generationProgress: () => apiRequest('/scheduler/generate/progress', { timeoutMs: 10000 }),
  resumeGeneration: (action) => apiRequest('/scheduler/generate/resume', { method: 'POST', body: { action } }),
  getApprovalStatus: () => apiRequest('/scheduler/approval/status'),
  resendApprovalEmails: () => apiRequest('/scheduler/approval/resend', { method: 'POST' }),
  listSchedules: () => apiRequest('/scheduler/schedules'),
  previewSchedule: (payload) => apiRequest('/scheduler/schedules/preview', { method: 'POST', body: payload }),
  createSchedule: (payload) => apiRequest('/scheduler/schedules', { method: 'POST', body: payload }),
  saveSchedule: (id, payload) => apiRequest(`/scheduler/schedules/${encodeURIComponent(id)}`, { method: 'PUT', body: payload }),
  setScheduleStatus: (id, status) => apiRequest(`/scheduler/schedules/${encodeURIComponent(id)}/status`, { method: 'POST', body: { status } }),
  deleteSchedule: (id) => apiRequest(`/scheduler/schedules/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  getSocialOverview: () => apiRequest('/scheduler/overview'),
  getSocialInsights: ({ days = 30, channel = '', account = '' } = {}) => apiRequest(`/scheduler/insights?days=${days}&channel=${encodeURIComponent(channel)}&account=${encodeURIComponent(account)}`),
  syncSocialInsights: () => apiRequest('/scheduler/insights/sync', { method: 'POST', timeoutMs: 120000 }),
  getPostResults: (postId) => apiRequest(`/scheduler/posts/${encodeURIComponent(postId)}/results`),
  // Media library
  getMediaLibrary: ({ kind = '', q = '', tag = '' } = {}) => apiRequest(`/scheduler/library?kind=${kind}&q=${encodeURIComponent(q)}&tag=${encodeURIComponent(tag)}`),
  uploadMedia: (files, tags = '') => {
    const form = new FormData();
    Array.from(files).forEach((f) => form.append('files', f));
    form.append('tags', tags);
    return apiRequest('/scheduler/library/upload', { method: 'POST', body: form, timeoutMs: 600000 });
  },
  importMediaUrl: (url) => apiRequest('/scheduler/library/import-url', { method: 'POST', body: { url }, timeoutMs: 120000 }),
  editMedia: (id, changes) => apiRequest(`/scheduler/library/${encodeURIComponent(id)}`, { method: 'PATCH', body: changes }),
  deleteMedia: (id, force = false) => apiRequest(`/scheduler/library/${encodeURIComponent(id)}${force ? '?force=true' : ''}`, { method: 'DELETE' }),
  // How this company's AI pictures look
  getImageSettings: () => apiRequest('/scheduler/image-settings'),
  saveImageSettings: (body) => apiRequest('/scheduler/image-settings', { method: 'PUT', body }),
  // AI video clips
  getVideos: (postId = '') => apiRequest(`/scheduler/videos?postId=${encodeURIComponent(postId)}`),
  makeVideo: (body) => apiRequest('/scheduler/videos', { method: 'POST', body }),
  getVideo: (id) => apiRequest(`/scheduler/videos/${encodeURIComponent(id)}`),
  // Bulk import
  getImportTemplate: () => apiRequest('/scheduler/import/template'),
  checkImport: (file) => {
    const form = new FormData();
    form.append('file', file);
    return apiRequest('/scheduler/import/check', { method: 'POST', body: form, timeoutMs: 60000 });
  },
  commitImport: (rows, approve) => apiRequest('/scheduler/import/commit', { method: 'POST', body: { rows, approve }, timeoutMs: 600000 }),
  // Reports
  listReports: () => apiRequest('/scheduler/reports'),
  getReportHistory: () => apiRequest('/scheduler/reports/history'),
  createReport: (body) => apiRequest('/scheduler/reports', { method: 'POST', body }),
  saveReport: (id, body) => apiRequest(`/scheduler/reports/${encodeURIComponent(id)}`, { method: 'PUT', body }),
  deleteReport: (id) => apiRequest(`/scheduler/reports/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  previewReport: (id) => apiRequest(`/scheduler/reports/${encodeURIComponent(id)}/preview`, { timeoutMs: 60000 }),
  sendReport: (id, to) => apiRequest(`/scheduler/reports/${encodeURIComponent(id)}/send`, { method: 'POST', body: to ? { to } : {}, timeoutMs: 120000 }),
  // Listening
  getListening: () => apiRequest('/scheduler/listening'),
  createListenTopic: (body) => apiRequest('/scheduler/listening/topics', { method: 'POST', body, timeoutMs: 90000 }),
  saveListenTopic: (id, body) => apiRequest(`/scheduler/listening/topics/${encodeURIComponent(id)}`, { method: 'PUT', body }),
  deleteListenTopic: (id) => apiRequest(`/scheduler/listening/topics/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  checkListenTopic: (id) => apiRequest(`/scheduler/listening/topics/${encodeURIComponent(id)}/check`, { method: 'POST', timeoutMs: 90000 }),
  getMentions: ({ topic = '', source = '', status = '' } = {}) => apiRequest(`/scheduler/listening/mentions?topic=${encodeURIComponent(topic)}&source=${source}&status=${status}`),
  markMentions: (ids, status) => apiRequest('/scheduler/listening/mentions/status', { method: 'POST', body: { ids, status } }),
  mentionsToLeads: (ids) => apiRequest('/scheduler/listening/mentions/leads', { method: 'POST', body: { ids } }),
  // Tracked links, test mode, learned style
  getSocialExtras: () => apiRequest('/scheduler/settings/extras'),
  saveSocialExtras: (body) => apiRequest('/scheduler/settings/extras', { method: 'PUT', body }),
  learnBrandStyle: () => apiRequest('/scheduler/brand-voice/learn', { method: 'POST', timeoutMs: 120000 }),
  saveLearnedStyle: (body) => apiRequest('/scheduler/brand-voice/learned', { method: 'PUT', body }),
  getSocialAccounts: (refresh = false) => apiRequest(`/scheduler/accounts${refresh ? '?refresh=true' : ''}`),
  deleteSocialAccount: (id) => apiRequest(`/scheduler/accounts/${id}`, { method: 'DELETE' }),
  publishPost: (postId, payload) => apiRequest(`/scheduler/posts/${postId}/publish`, { method: 'POST', body: payload || {} }),
  getSocialOauthApps: () => apiRequest('/scheduler/oauth/apps'),
  startSocialOauth: (platform, frontend) => apiRequest(`/scheduler/oauth/${platform}/start${frontend ? `?frontend=${encodeURIComponent(frontend)}` : ''}`),

  // Dedicated Process Logs (Multi-Subsystem)
  getCompliance: () => apiRequest('/profile/compliance'),
  saveCompliance: (data) => apiRequest('/profile/compliance', { method: 'PUT', body: data }),
  getCallingAnalytics: (days = 30) => apiRequest(`/analytics/overview?days=${encodeURIComponent(days)}`),
  getProcessLogs: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return apiRequest(`/logs${query ? `?${query}` : ''}`);
  },
  getSubsystemsStats: () => apiRequest('/logs/subsystems'),
  getRawFileLogs: (subsystem, lines = 100) => apiRequest(`/logs/raw/${subsystem}?lines=${lines}`),
  clearLogs: (subsystem) => apiRequest(`/logs${subsystem ? `?subsystem=${subsystem}` : ''}`, { method: 'DELETE' }),

  // Cal.com & Meeting Scheduler
  getCalcomOverview: () => apiRequest('/calcom/overview'),
  getCalcomEventTypes: () => apiRequest('/calcom/event-types'),
  createCalcomEventType: (payload) => apiRequest('/calcom/event-types', { method: 'POST', body: payload }),
  deleteCalcomEventType: (id) => apiRequest(`/calcom/event-types/${id}`, { method: 'DELETE' }),
  getCalcomSlots: (date, eventTypeSlug = '15-min-discovery') => apiRequest(`/calcom/slots?date=${encodeURIComponent(date)}&event_type_slug=${encodeURIComponent(eventTypeSlug)}`),
  getCalcomBookings: () => apiRequest('/calcom/bookings'),
  bookCalcomMeeting: (payload) => apiRequest('/calcom/book', { method: 'POST', body: payload }),
  rescheduleCalcomBooking: (bookingId, date, time, reason = '') => apiRequest(`/calcom/bookings/${bookingId}/reschedule`, { method: 'POST', body: { date, time, reason } }),
  cancelCalcomBooking: (bookingId, reason = 'Cancelled by user') => apiRequest(`/calcom/bookings/${bookingId}/cancel`, { method: 'POST', body: { reason } }),
  getCalcomIcsUrl: (bookingId) => `/api/calcom/bookings/${bookingId}/ics`,
  getCalcomSettings: () => apiRequest('/calcom/settings'),
  saveCalcomSettings: (payload) => apiRequest('/calcom/settings', { method: 'POST', body: payload, timeoutMs: 30000 }),
  testCalcomConnection: () => apiRequest('/calcom/test-connection', { method: 'POST' }),
  syncCalcomEventTypes: () => apiRequest('/calcom/sync-event-types', { method: 'POST', timeoutMs: 30000 }),
  getCalcomAccounts: () => apiRequest('/calcom/accounts'),
  saveCalcomAccount: (payload) => apiRequest('/calcom/accounts', { method: 'POST', body: payload }),
  deleteCalcomAccount: (id) => apiRequest(`/calcom/accounts/${id}`, { method: 'DELETE' }),
  testCalcomAccount: (id) => apiRequest(`/calcom/accounts/${id}/test`, { method: 'POST' }),
  getCalcomInvitePreview: (query = 'role=attendee') => apiRequest(`/calcom/invite-preview?${query}`),
  saveCalcomInviteTemplate: (payload) => apiRequest('/calcom/invite-template', { method: 'POST', body: payload }),

  calcom: {
    getOverview: () => apiRequest('/calcom/overview'),
    getEventTypes: () => apiRequest('/calcom/event-types'),
    createEventType: (payload) => apiRequest('/calcom/event-types', { method: 'POST', body: payload }),
    deleteEventType: (id) => apiRequest(`/calcom/event-types/${id}`, { method: 'DELETE' }),
    getSlots: (date, eventTypeSlug = '15-min-discovery') => apiRequest(`/calcom/slots?date=${encodeURIComponent(date)}&event_type_slug=${encodeURIComponent(eventTypeSlug)}`),
    getBookings: () => apiRequest('/calcom/bookings'),
    bookMeeting: (payload) => apiRequest('/calcom/book', { method: 'POST', body: payload }),
    rescheduleBooking: (bookingId, date, time, reason = '') => apiRequest(`/calcom/bookings/${bookingId}/reschedule`, { method: 'POST', body: { date, time, reason } }),
    cancelBooking: (bookingId, reason = 'Cancelled by user') => apiRequest(`/calcom/bookings/${bookingId}/cancel`, { method: 'POST', body: { reason } }),
    getIcsUrl: (bookingId) => `/api/calcom/bookings/${bookingId}/ics`,
    getSettings: () => apiRequest('/calcom/settings'),
    saveSettings: (payload) => apiRequest('/calcom/settings', { method: 'POST', body: payload, timeoutMs: 30000 }),
    testConnection: () => apiRequest('/calcom/test-connection', { method: 'POST' }),
    syncEventTypes: () => apiRequest('/calcom/sync-event-types', { method: 'POST', timeoutMs: 30000 })
  },

  // Conversation Templates & Dynamic Prompts
  getConversationTemplates: (direction) => apiRequest(`/conversation-templates/${direction ? `?call_direction=${encodeURIComponent(direction)}` : ''}`),
  getConversationTemplate: (id) => apiRequest(`/conversation-templates/${id}`),
  createConversationTemplate: (payload) => apiRequest('/conversation-templates/', { method: 'POST', body: payload }),
  updateConversationTemplate: (id, payload) => apiRequest(`/conversation-templates/${id}`, { method: 'PUT', body: payload }),
  deleteConversationTemplate: (id) => apiRequest(`/conversation-templates/${id}`, { method: 'DELETE' }),
  previewConversationTemplate: (id, sampleData) => apiRequest(`/conversation-templates/${id}/preview`, { method: 'POST', body: sampleData || {} }),

  // 5-Point Universal Diagnostics
  runVoiceAndBookingDiagnostics: () => apiRequest('/diagnostics/test-voice-and-booking', { method: 'POST' }),

  // Email outreach: mailboxes, warmup, campaigns, finding emails, replies, do-not-email list
  emailOverview: () => apiRequest('/email/overview'),
  emailMailboxes: () => apiRequest('/email/mailboxes'),
  emailConnectMailbox: (body) => apiRequest('/email/mailboxes', { method: 'POST', body, timeoutMs: 60000 }),
  emailUpdateMailbox: (id, body) => apiRequest(`/email/mailboxes/${id}`, { method: 'PATCH', body, timeoutMs: 60000 }),
  emailAddAlias: (id, address, name = '') => apiRequest(`/email/mailboxes/${id}/aliases`, { method: 'POST', body: { address, name } }),
  emailRemoveAlias: (id, address) => apiRequest(`/email/mailboxes/${id}/aliases?address=${encodeURIComponent(address)}`, { method: 'DELETE' }),
  emailDeleteMailbox: (id) => apiRequest(`/email/mailboxes/${id}`, { method: 'DELETE' }),
  emailTestMailbox: (id) => apiRequest(`/email/mailboxes/${id}/test`, { method: 'POST', timeoutMs: 60000 }),
  emailCheckDns: (id, dkimSelector) => apiRequest(`/email/mailboxes/${id}/dns-check`, { method: 'POST', body: dkimSelector ? { dkim_selector: dkimSelector } : {}, timeoutMs: 30000 }),
  emailDkimOverride: (id, allow) => apiRequest(`/email/mailboxes/${id}/dkim-override`, { method: 'POST', body: { allow } }),
  emailWarmup: (id, action) => apiRequest(`/email/mailboxes/${id}/warmup`, { method: 'POST', body: { action }, timeoutMs: 30000 }),
  emailCampaigns: () => apiRequest('/email/campaigns'),
  emailCampaign: (id) => apiRequest(`/email/campaigns/${id}`),
  emailCreateCampaign: (body) => apiRequest('/email/campaigns', { method: 'POST', body }),
  emailUpdateCampaign: (id, body) => apiRequest(`/email/campaigns/${id}`, { method: 'PUT', body }),
  emailCampaignStatus: (id, status) => apiRequest(`/email/campaigns/${id}/status`, { method: 'POST', body: { status } }),
  emailDeleteCampaign: (id) => apiRequest(`/email/campaigns/${id}`, { method: 'DELETE' }),
  emailAddLeads: (id, leads) => apiRequest(`/email/campaigns/${id}/leads`, { method: 'POST', body: { leads } }),
  emailRemoveLead: (id, leadId) => apiRequest(`/email/campaigns/${id}/leads/${leadId}`, { method: 'DELETE' }),
  emailFind: (body) => apiRequest('/email/find', { method: 'POST', body, timeoutMs: 90000 }),
  emailSent: (params = {}) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null && v !== undefined));
    return apiRequest(`/email/messages${q.toString() ? `?${q}` : ''}`);
  },
  emailSentOne: (id) => apiRequest(`/email/messages/${encodeURIComponent(id)}`),
  mailMailboxes: () => apiRequest('/email/mail/mailboxes'),
  mailCounts: (mailboxId = '') => apiRequest(`/email/mail/counts${mailboxId ? `?mailbox_id=${encodeURIComponent(mailboxId)}` : ''}`),
  mailMessages: ({ folder = 'inbox', mailbox_id = '', q = '', unread = false, starred = false, attachments = false } = {}) => {
    const p = new URLSearchParams({ folder });
    if (mailbox_id) p.set('mailbox_id', mailbox_id);
    if (q) p.set('q', q);
    if (unread) p.set('unread', 'true');
    if (starred) p.set('starred', 'true');
    if (attachments) p.set('attachments', 'true');
    return apiRequest(`/email/mail/messages?${p}`);
  },
  mailMessage: (id) => apiRequest(`/email/mail/messages/${encodeURIComponent(id)}`),
  mailThread: (key, folder = '') => apiRequest(`/email/mail/threads/${encodeURIComponent(key)}${folder ? `?folder=${encodeURIComponent(folder)}` : ''}`),
  mailActions: (ids, action) => apiRequest('/email/mail/actions', { method: 'POST', body: { ids, action } }),
  mailSync: (mailbox_id = '', force = false) => apiRequest('/email/mail/sync', { method: 'POST', body: { mailbox_id, force }, timeoutMs: 120000 }),
  mailSaveDraft: (data) => apiRequest('/email/mail/drafts', { method: 'POST', body: data }),
  mailSend: (data, files = []) => {
    const form = new FormData();
    form.append('payload', JSON.stringify(data));
    files.forEach((f) => form.append('files', f, f.name));
    return apiRequest('/email/mail/send', { method: 'POST', body: form, timeoutMs: 120000 });
  },
  mailAttachment: (id, index) => apiRequest(`/email/mail/messages/${encodeURIComponent(id)}/attachments/${index}`, { asBlob: true }),
  emailReplies: (category) => apiRequest(`/email/replies${category ? `?category=${encodeURIComponent(category)}` : ''}`),
  emailReplyCategory: (id, category) => apiRequest(`/email/replies/${id}/category`, { method: 'POST', body: { category } }),
  emailSuppressions: () => apiRequest('/email/suppression'),
  emailAddSuppression: (email) => apiRequest('/email/suppression', { method: 'POST', body: { email } }),
  emailRemoveSuppression: (id) => apiRequest(`/email/suppression/${id}`, { method: 'DELETE' }),
  emailTemplates: () => apiRequest('/email/templates'),
  emailCreateTemplate: (body) => apiRequest('/email/templates', { method: 'POST', body }),
  emailUpdateTemplate: (id, body) => apiRequest(`/email/templates/${id}`, { method: 'PUT', body }),
  emailDeleteTemplate: (id) => apiRequest(`/email/templates/${id}`, { method: 'DELETE' }),
  emailGetWritingProfile: () => apiRequest('/email/ai/profile'),
  emailSaveWritingProfile: (body) => apiRequest('/email/ai/profile', { method: 'PUT', body }),
  emailAiSequence: (body) => apiRequest('/email/ai/sequence', { method: 'POST', body, timeoutMs: 90000 }),
  emailAiRefine: (body) => apiRequest('/email/ai/refine', { method: 'POST', body, timeoutMs: 60000 }),
  emailAiPersonalise: (account_ids) => apiRequest('/email/ai/personalise', { method: 'POST', body: { account_ids }, timeoutMs: 180000 }),
  emailAiDraft: (body) => apiRequest('/email/ai/draft', { method: 'POST', body, timeoutMs: 45000 }),

  // Developer API Keys
  getDeveloperKeys: () => apiRequest('/developer/keys'),
  createDeveloperKey: (body) => apiRequest('/developer/keys', { method: 'POST', body }),
  updateDeveloperKey: (id, body) => apiRequest(`/developer/keys/${id}`, { method: 'PATCH', body }),
  revokeDeveloperKey: (id) => apiRequest(`/developer/keys/${id}`, { method: 'DELETE' }),

  // Developer Webhooks
  getDeveloperWebhooks: () => apiRequest('/developer/webhooks'),
  createDeveloperWebhook: (body) => apiRequest('/developer/webhooks', { method: 'POST', body }),
  updateDeveloperWebhook: (id, body) => apiRequest(`/developer/webhooks/${id}`, { method: 'PATCH', body }),
  deleteDeveloperWebhook: (id) => apiRequest(`/developer/webhooks/${id}`, { method: 'DELETE' }),
  testDeveloperWebhook: (id) => apiRequest(`/developer/webhooks/${id}/test`, { method: 'POST' }),
  getDeveloperWebhookLogs: (id) => apiRequest(`/developer/webhooks/${id}/logs`),

  // Partner programme
  getPartner: () => apiRequest('/partner'),
  applyPartner: (body) => apiRequest('/partner/apply', { method: 'POST', body }),
  acceptPartnerTerms: () => apiRequest('/partner/accept-terms', { method: 'POST' }),
  savePartnerSettings: (body) => apiRequest('/partner/settings', { method: 'PUT', body }),
  rotatePartnerWebhookSecret: () => apiRequest('/partner/webhook-secret/rotate', { method: 'POST' }),
  requestPartnerLive: () => apiRequest('/partner/request-live', { method: 'POST' }),
  getPartnerLinks: (status = '') => apiRequest(`/partner/links${status ? `?status=${status}` : ''}`),
  disconnectPartnerLink: (id) => apiRequest(`/partner/links/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  getPartnerConnections: () => apiRequest('/partner/connections'),
  disconnectPartnerConnection: (id) => apiRequest(`/partner/connections/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};


