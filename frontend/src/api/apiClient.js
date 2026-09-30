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
  const { timeoutMs, signal: outerSignal, ...fetchOptions } = options;
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

      return await response.json();
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
  googleExchange: async (code) => {
    const res = await apiRequest('/auth/google/exchange', { method: 'POST', body: { code } });
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
  orderNumber: (n) => apiRequest('/telnyx/numbers/order', { method: 'POST', body: { phoneNumber: n.phoneNumber, monthlyCost: n.monthlyCost, upfrontCost: n.upfrontCost, currency: n.currency } }),
  releaseNumber: (id) => apiRequest(`/telnyx/numbers/${encodeURIComponent(id)}/release`, { method: 'POST' }),
  requestWhatsapp: (id) => apiRequest(`/wa/numbers/${encodeURIComponent(id)}/request`, { method: 'POST' }),
  getWaStatus: () => apiRequest('/wa/status'),
  getWaThreads: () => apiRequest('/wa/threads'),
  getWaThread: (id) => apiRequest(`/wa/threads/${encodeURIComponent(id)}`),
  sendWa: (id, payload) => apiRequest(`/wa/threads/${encodeURIComponent(id)}/send`, { method: 'POST', body: payload }),
  patchWaThread: (id, data) => apiRequest(`/wa/threads/${encodeURIComponent(id)}`, { method: 'PATCH', body: data }),
  startWaThread: (data) => apiRequest('/wa/threads', { method: 'POST', body: data }),
  setCreditSettings: (data) => apiRequest('/credits/settings', { method: 'PUT', body: data }),
  getPlatformOrgs: () => apiRequest('/credits/platform/orgs'),
  grantCredits: (org_id, amount, note, wallet = 'voice', expires_in_days = null) => apiRequest('/credits/platform/grant', { method: 'POST', body: { org_id, amount, note, wallet, expires_in_days } }),
  getPlatformPlans: () => apiRequest('/credits/platform/plans'),
  createPlatformPlan: (data) => apiRequest('/credits/platform/plans', { method: 'POST', body: data }),
  syncPlanToStripe: (id) => apiRequest(`/credits/platform/plans/${encodeURIComponent(id)}/sync-stripe`, { method: 'POST' }),
  getBillingOverview: () => apiRequest('/billing/overview'),
  startCheckout: (plans, topups) => apiRequest('/billing/checkout', { method: 'POST', body: { plans, topups } }),
  openBillingPortal: () => apiRequest('/billing/portal', { method: 'POST' }),
  setOrgCreditEnforce: (orgId, enforce) => apiRequest(`/credits/platform/orgs/${encodeURIComponent(orgId)}`, { method: 'PUT', body: { enforce } }),
  setCreditRates: (rates) => apiRequest('/credits/platform/rates', { method: 'PUT', body: { rates } }),
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
  confirmBooking: (callId) => apiRequest(`/calls/live/${callId}/confirm-booking`, { method: 'POST' }),
  getCallLogs: () => apiRequest('/calls/logs'),
  dialOutbound: (payload) => apiRequest('/calls/outbound/dial', { method: 'POST', body: payload }),
  dialOutboundBatch: (payload) => apiRequest('/calls/outbound/batch', { method: 'POST', body: payload }),
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
  getSources: () => apiRequest('/profile/sources'),
  addSource: (source) => apiRequest('/profile/sources', { method: 'POST', body: source }),
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
  dialViaTelnyxAssistant: (payload) => apiRequest('/telnyx-assistant/dial', { method: 'POST', body: payload, timeoutMs: 15000 }),
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
  discoverAccounts: (payload) => apiRequest('/enrichment/discover-accounts', { method: 'POST', body: payload }),
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
  saveSocialOauthApp: (payload) => apiRequest('/scheduler/oauth/apps', { method: 'POST', body: payload }),
  startSocialOauth: (platform, frontend) => apiRequest(`/scheduler/oauth/${platform}/start${frontend ? `?frontend=${encodeURIComponent(frontend)}` : ''}`),
  getSchedulerAiSettings: () => apiRequest('/scheduler/ai-settings'),
  saveSchedulerAiSettings: (payload) => apiRequest('/scheduler/ai-settings', { method: 'POST', body: payload }),
  testSchedulerAiSettings: () => apiRequest('/scheduler/ai-settings/test', { method: 'POST', timeoutMs: 30000 }),

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
  runVoiceAndBookingDiagnostics: () => apiRequest('/diagnostics/test-voice-and-booking', { method: 'POST' })
};

