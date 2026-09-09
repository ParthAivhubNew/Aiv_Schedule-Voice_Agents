const API_BASE = "/api";

export async function apiRequest(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
    options.body = JSON.stringify(options.body);
  }

  if (options.body instanceof FormData) {
    delete headers['Content-Type'];
  }

  try {
    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      let msg = `Request failed with status ${response.status}`;
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
    console.error(`API Error on ${url}:`, error);
    throw error;
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
  deleteLiveCall: (callId) => apiRequest(`/calls/live/${callId}`, { method: 'DELETE' }),
  clearLiveCalls: () => apiRequest('/calls/live/clear', { method: 'POST' }),
  toggleListen: (callId) => apiRequest(`/calls/live/${callId}/listen`, { method: 'POST' }),
  toggleTakeover: (callId) => apiRequest(`/calls/live/${callId}/takeover`, { method: 'POST' }),
  confirmBooking: (callId) => apiRequest(`/calls/live/${callId}/confirm-booking`, { method: 'POST' }),
  getCallLogs: () => apiRequest('/calls/logs'),
  dialOutbound: (payload) => apiRequest('/calls/outbound/dial', { method: 'POST', body: payload }),
  getCarrierPlugins: () => apiRequest('/calls/outbound/carriers'),

  // Meetings
  getMeetings: () => apiRequest('/meetings'),
  logOutcome: (meetingId, payload) => apiRequest(`/meetings/${meetingId}/outcome`, { method: 'POST', body: payload }),
  saveMeetingTranscript: (meetingId, transcript) => apiRequest(`/meetings/${meetingId}/transcript`, { method: 'POST', body: { transcript } }),

  // Schedule
  getSchedule: () => apiRequest('/schedule'),
  createScheduleItem: (payload) => apiRequest('/schedule', { method: 'POST', body: payload }),

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
  testConnection: (payload) => apiRequest('/connections/test', { method: 'POST', body: payload }),
  testAndSaveConnection: (payload) => apiRequest('/connections/test-and-save', { method: 'POST', body: payload }),
  resetDemoData: () => apiRequest('/connections/reset-demo-data', { method: 'POST' }),
  getTelephonyHub: () => apiRequest('/connections/telephony-hub'),
  provisionTelephonyHub: (payload) => apiRequest('/connections/telephony-hub/provision', { method: 'POST', body: payload }),
  testTelephonyPing: () => apiRequest('/connections/telephony-hub/test-ping', { method: 'POST' }),

  // AI Lead Radar & Enrichment
  enrichProspect: (payload) => apiRequest('/enrichment/enrich-prospect', { method: 'POST', body: payload }),
  discoverAccounts: (payload) => apiRequest('/enrichment/discover-accounts', { method: 'POST', body: payload }),
  copilotChat: (payload) => apiRequest('/enrichment/copilot-chat', { method: 'POST', body: payload }),
  openChat: (payload) => apiRequest('/enrichment/copilot-chat', { method: 'POST', body: payload }),

  // Analytics
  getAnalytics: () => apiRequest('/analytics'),

  // Post Scheduler & Visual Generator
  getPosts: () => apiRequest('/scheduler/posts'),
  createPost: (payload) => apiRequest('/scheduler/posts/create', { method: 'POST', body: payload }),
  deletePost: (postId) => apiRequest(`/scheduler/posts/${postId}`, { method: 'DELETE' }),
  chatPlan: (payload) => apiRequest('/scheduler/chat-plan', { 
    method: 'POST', 
    body: typeof payload === 'string' ? { text: payload } : payload 
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

  // Dedicated Process Logs (Multi-Subsystem)
  getProcessLogs: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return apiRequest(`/logs${query ? `?${query}` : ''}`);
  },
  getSubsystemsStats: () => apiRequest('/logs/subsystems'),
  getRawFileLogs: (subsystem, lines = 100) => apiRequest(`/logs/raw/${subsystem}?lines=${lines}`),
  clearLogs: (subsystem) => apiRequest(`/logs${subsystem ? `?subsystem=${subsystem}` : ''}`, { method: 'DELETE' }),
};

