const API_BASE = "/api";

export async function apiRequest(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
  const { timeoutMs, signal: outerSignal, ...fetchOptions } = options;
  const headers = {
    'Content-Type': 'application/json',
    ...(fetchOptions.headers || {}),
  };

  if (fetchOptions.body && typeof fetchOptions.body === 'object' && !(fetchOptions.body instanceof FormData)) {
    fetchOptions.body = JSON.stringify(fetchOptions.body);
  }

  if (fetchOptions.body instanceof FormData) {
    delete headers['Content-Type'];
  }

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
    const response = await fetch(url, {
      ...fetchOptions,
      headers,
      signal: controller.signal,
    });

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
        msg = JSON.stringify(errData.detail);
      } else if (errData.error) {
        msg = typeof errData.error === 'string' ? errData.error : JSON.stringify(errData.error);
      }
      throw new Error(msg);
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
}

export const api = {
  // Auth & Team
  login: (username, password) => apiRequest('/auth/login', { method: 'POST', body: { username, password } }),
  getMe: (username) => apiRequest(`/auth/me?username=${encodeURIComponent(username)}`),
  getUsers: () => apiRequest('/auth/users'),
  createUser: (data) => apiRequest('/auth/users', { method: 'POST', body: data }),

  // Missions
  getMissions: () => apiRequest('/missions'),
  createMission: (payload) => apiRequest('/missions', { method: 'POST', body: payload }),
  parseSpreadsheet: (formData) => apiRequest('/missions/upload-parse', { method: 'POST', body: formData }),

  // Prospects & Registry
  getProspects: () => apiRequest('/prospects'),
  getRegistry: () => apiRequest('/prospects/registry'),

  // Calls
  getLiveCalls: () => apiRequest('/calls/live'),
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
  resetDemoData: () => apiRequest('/connections/reset-demo-data', { method: 'POST' }),
  getTelephonyHub: () => apiRequest('/connections/telephony-hub'),
  provisionTelephonyHub: (payload) => apiRequest('/connections/telephony-hub/provision', { method: 'POST', body: payload }),
  testTelephonyPing: () => apiRequest('/connections/telephony-hub/test-ping', { method: 'POST' }),
  cloneVoice: (formData) => apiRequest('/connections/telephony-hub/voices/clone', { method: 'POST', body: formData }),
  selectVoice: (payload) => apiRequest('/connections/telephony-hub/voices/select', { method: 'POST', body: payload }),

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
  chatPlan: (payload, options = {}) => apiRequest('/scheduler/chat-plan', { 
    method: 'POST', 
    body: typeof payload === 'string' ? { text: payload } : payload,
    ...options
  }),
  updatePostStatus: (postId, status, copy, imageUrl, imagePrompt) => apiRequest(`/scheduler/posts/${postId}/status`, { 
    method: 'POST', 
    body: { status, copy, imageUrl, imagePrompt } 
  }),
  generateImage: (payload) => apiRequest('/scheduler/generate-image', { 
    method: 'POST', 
    body: typeof payload === 'string' ? { prompt: payload } : payload 
  }),
  generateSocialPackage: (payload) => apiRequest('/scheduler/generate-package', {
    method: 'POST',
    body: payload
  }),
  getEmails: () => apiRequest('/scheduler/emails'),
  createEmail: (payload) => apiRequest('/scheduler/emails', { method: 'POST', body: payload }),
  getSocialAccounts: (refresh = false) => apiRequest(`/scheduler/accounts${refresh ? '?refresh=true' : ''}`),
  saveSocialAccount: (payload) => apiRequest('/scheduler/accounts', { method: 'POST', body: payload }),
  testSocialAccount: (id) => apiRequest(`/scheduler/accounts/${id}/test`, { method: 'POST' }),
  deleteSocialAccount: (id) => apiRequest(`/scheduler/accounts/${id}`, { method: 'DELETE' }),
  publishPost: (postId, payload) => apiRequest(`/scheduler/posts/${postId}/publish`, { method: 'POST', body: payload || {} }),
  publishDuePosts: () => apiRequest('/scheduler/publish-due', { method: 'POST' }),
  getSocialOauthApps: () => apiRequest('/scheduler/oauth/apps'),
  saveSocialOauthApp: (payload) => apiRequest('/scheduler/oauth/apps', { method: 'POST', body: payload }),
  startSocialOauth: (platform, frontend) => apiRequest(`/scheduler/oauth/${platform}/start${frontend ? `?frontend=${encodeURIComponent(frontend)}` : ''}`),

  // Dedicated Process Logs (Multi-Subsystem)
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
  saveCalcomSettings: (payload) => apiRequest('/calcom/settings', { method: 'POST', body: payload }),
  testCalcomConnection: () => apiRequest('/calcom/test-connection', { method: 'POST' }),
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
    saveSettings: (payload) => apiRequest('/calcom/settings', { method: 'POST', body: payload }),
    testConnection: () => apiRequest('/calcom/test-connection', { method: 'POST' })
  }
};

