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
  cancelPlan: (wallet, cancel = true) => apiRequest('/billing/cancel', { method: 'POST', body: { wallet, cancel } }),
  updateMe: (data) => apiRequest('/auth/me', { method: 'PATCH', body: data }),
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
  saveLeadAccounts: (accounts) => apiRequest('/leads/accounts', { method: 'POST', body: { accounts } }),
  updateLeadAccount: (id, changes) => apiRequest(`/leads/accounts/${encodeURIComponent(id)}`, { method: 'PATCH', body: changes }),
  deleteLeadAccount: (id) => apiRequest(`/leads/accounts/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  searchCompanies: (body) => apiRequest('/leads/search', { method: 'POST', body, timeoutMs: 40000 }),
  geocodeCompanies: (ids) => apiRequest('/leads/geocode', { method: 'POST', body: { ids }, timeoutMs: 40000 }),
  companyContacts: (id, body) => apiRequest(`/leads/companies/${encodeURIComponent(id)}/contacts`, { method: 'POST', body, timeoutMs: 120000 }),
  researchLeadAccount: (id) => apiRequest(`/leads/accounts/${encodeURIComponent(id)}/research`, { method: 'POST', timeoutMs: 120000 }),
  quickCheckLeadAccount: (id) => apiRequest(`/leads/accounts/${encodeURIComponent(id)}/quick-check`, { method: 'POST' }),
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
  emailDeleteMailbox: (id) => apiRequest(`/email/mailboxes/${id}`, { method: 'DELETE' }),
  emailTestMailbox: (id) => apiRequest(`/email/mailboxes/${id}/test`, { method: 'POST', timeoutMs: 60000 }),
  emailCheckDns: (id) => apiRequest(`/email/mailboxes/${id}/dns-check`, { method: 'POST', timeoutMs: 30000 }),
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
  emailReplies: (category) => apiRequest(`/email/replies${category ? `?category=${encodeURIComponent(category)}` : ''}`),
  emailReplyCategory: (id, category) => apiRequest(`/email/replies/${id}/category`, { method: 'POST', body: { category } }),
  emailSuppressions: () => apiRequest('/email/suppression'),
  emailAddSuppression: (email) => apiRequest('/email/suppression', { method: 'POST', body: { email } }),
  emailRemoveSuppression: (id) => apiRequest(`/email/suppression/${id}`, { method: 'DELETE' }),
  emailTemplates: () => apiRequest('/email/templates'),
  emailCreateTemplate: (body) => apiRequest('/email/templates', { method: 'POST', body }),
  emailUpdateTemplate: (id, body) => apiRequest(`/email/templates/${id}`, { method: 'PUT', body }),
  emailDeleteTemplate: (id) => apiRequest(`/email/templates/${id}`, { method: 'DELETE' }),
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
};


