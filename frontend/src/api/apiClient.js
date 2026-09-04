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
      throw new Error(errData.detail || `Request failed with status ${response.status}`);
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
  toggleListen: (callId) => apiRequest(`/calls/live/${callId}/listen`, { method: 'POST' }),
  toggleTakeover: (callId) => apiRequest(`/calls/live/${callId}/takeover`, { method: 'POST' }),
  confirmBooking: (callId) => apiRequest(`/calls/live/${callId}/confirm-booking`, { method: 'POST' }),
  getCallLogs: () => apiRequest('/calls/logs'),

  // Meetings
  getMeetings: () => apiRequest('/meetings'),
  logOutcome: (meetingId, payload) => apiRequest(`/meetings/${meetingId}/outcome`, { method: 'POST', body: payload }),
  saveMeetingTranscript: (meetingId, transcript) => apiRequest(`/meetings/${meetingId}/transcript`, { method: 'POST', body: { transcript } }),

  // Schedule
  getSchedule: () => apiRequest('/schedule'),
  createScheduleItem: (payload) => apiRequest('/schedule', { method: 'POST', body: payload }),

  // Profile & Knowledge
  getProfile: () => apiRequest('/profile'),
  updateProfile: (profile) => apiRequest('/profile', { method: 'PUT', body: profile }),
  getSources: () => apiRequest('/profile/sources'),
  addSource: (source) => apiRequest('/profile/sources', { method: 'POST', body: source }),
  getServices: () => apiRequest('/profile/services'),
  getFaqs: () => apiRequest('/profile/faqs'),
  getNotifications: () => apiRequest('/profile/notifications'),

  // Connections & Key Testing
  getConnections: () => apiRequest('/connections'),
  addConnection: (conn) => apiRequest('/connections', { method: 'POST', body: conn }),
  testConnection: (payload) => apiRequest('/connections/test', { method: 'POST', body: payload }),
  testAndSaveConnection: (payload) => apiRequest('/connections/test-and-save', { method: 'POST', body: payload }),
  resetDemoData: () => apiRequest('/connections/reset-demo-data', { method: 'POST' }),

  // Analytics
  getAnalytics: () => apiRequest('/analytics'),

  // Post Scheduler
  getPosts: () => apiRequest('/scheduler/posts'),
  chatPlan: (text) => apiRequest('/scheduler/chat-plan', { method: 'POST', body: { text } }),
  updatePostStatus: (postId, status, copy) => apiRequest(`/scheduler/posts/${postId}/status`, { method: 'POST', body: { status, copy } }),
  getEmails: () => apiRequest('/scheduler/emails'),
};
