// What the public API offers, in one place: the Docs tab shows it and the Playground sends it.
// Paths are under https://api.outreach.aivhub.com. {id} is a path parameter.

export const API_BASE = "https://api.outreach.aivhub.com";

export const GROUPS = [
  { id: "start", label: "Start here" },
  { id: "voice", label: "Phone calls" },
  { id: "leads", label: "Find leads" },
  { id: "email", label: "Email campaigns" },
  { id: "social", label: "Social posts" },
  { id: "meetings", label: "Meetings" },
  { id: "account", label: "Account" },
];

export const ENDPOINTS = [
  // ── Phone calls ──
  {
    group: "voice", method: "POST", path: "/v1/voice/calls", scope: "voice:calls", title: "Make a call",
    summary: "The AI phones one number (or up to 25). Say what the call is for, what to ask, or pick a saved script. It answers straight away; the result comes by webhook (call.completed) or by asking for the call.",
    body: {
      to: "+447911123456", lead_name: "Jo Bloggs", goal: "Book a 15 minute demo of our booking software",
      instructions: "Be brief and friendly. Do not talk about pricing.",
      questions: ["How many staff do you have?", { ask: "Which booking system do you use today?", key: "current_system" }],
      variables: { company: "Bloggs Dental" },
    },
    response: { id: "call_8f2a91c4", status: "ringing", to: "+447911123456", to_name: "Jo Bloggs", live_url: "https://outreach.aivhub.com/api/p/…", capabilities: { guide: false, take_over: false, hand_back: false, end: true } },
  },
  {
    group: "voice", method: "GET", path: "/v1/voice/calls/{id}", scope: "voice:calls", title: "See a call",
    summary: "Status, what was said, the answers to your questions, whether a meeting was booked, the recording link, and what you can do to the call right now.",
    pathParam: { name: "id", example: "call_8f2a91c4" },
    response: { id: "call_8f2a91c4", status: "completed", outcome: "meeting_booked", duration_seconds: 192, answers: { current_system: "Acuity" }, meeting_booked: true, transcript: [{ who: "ai", text: "Hello Jo…" }], recording_url: "https://api.outreach.aivhub.com/v1/voice/calls/call_8f2a91c4/recording" },
  },
  { group: "voice", method: "GET", path: "/v1/voice/calls", scope: "voice:calls", title: "List calls", summary: "The calls you made through the API, newest first. Filter with ?status=completed. Page with ?cursor=… from next_cursor." },
  {
    group: "voice", method: "DELETE", path: "/v1/voice/calls/{id}", scope: "voice:calls", title: "End a call", summary: "Hang up a call that is ringing or in progress.",
    pathParam: { name: "id", example: "call_8f2a91c4" },
  },
  {
    group: "voice", method: "POST", path: "/v1/voice/calls/{id}/control", scope: "voice:calls", title: "Steer a live call",
    summary: "guide: tell the AI what to do from now on (it pauses for a moment, then carries on). take_over: we ring your phone and connect you to the person. hand_back: give the call back to the AI with a note.",
    pathParam: { name: "id", example: "call_8f2a91c4" },
    body: { action: "guide", message: "Offer them Tuesday at 3pm instead" },
  },
  { group: "voice", method: "GET", path: "/v1/voice/calls/{id}/recording", scope: "voice:calls", title: "Download the recording", summary: "The call's recording as audio. Test calls have none.", pathParam: { name: "id", example: "call_8f2a91c4" } },
  { group: "voice", method: "GET", path: "/v1/voice/scripts", scope: "voice:calls", title: "Saved call scripts", summary: "Your saved outbound scripts. Use an id as script_id when you make a call." },
  // ── Leads ──
  {
    group: "leads", method: "POST", path: "/v1/leads/searches", scope: "leads:search", title: "Find companies",
    summary: "Find companies by words, towns, postcodes or a drawn area, get their contacts and check them, in one job. Add estimate_only to see the cost first. The job answers at once; poll the search or wait for the leads.ready webhook.",
    body: { sector: "dental", towns: ["Leeds"], limit: 25, contacts: "officers", checks: ["company", "email"], estimate_only: true },
    response: { estimate: { credits_at_most: 100, breakdown: { web_contacts: 0, company_check: 25, email_check: 63, phone_check: 0 }, balance: 500, can_afford: true } },
  },
  {
    group: "leads", method: "GET", path: "/v1/leads/searches/{id}", scope: "leads:search", title: "See a lead search",
    summary: "Progress while it runs; then the companies with their contacts and check results, a page at a time.",
    pathParam: { name: "id", example: "lsearch_3b9c1d7a2e44" },
  },
  {
    group: "leads", method: "POST", path: "/v1/leads", scope: "leads:search", title: "Add your own leads",
    summary: "Send a list of your own companies or people, optionally checked (company, email, phone). One lead (name, phone, email, company, notes) still works too.",
    body: { leads: [{ name: "Bloggs Dental", phone: "+441132000001", email: "hello@bloggs.example", website: "bloggs.example" }], checks: ["phone"] },
  },
  { group: "leads", method: "GET", path: "/v1/leads", scope: "leads:search", title: "Your saved leads", summary: "Saved leads with any check results. Search with ?q=bloggs." },
  // ── Email ──
  {
    group: "email", method: "POST", path: "/v1/email/campaigns", scope: "email:write", title: "Draft an email campaign",
    summary: "The AI writes the sequence from your goal (or send your own steps). Nothing is sent until it is approved. Use {{firstName}}, {{lastName}} and {{company}} to personalise.",
    body: {
      name: "Dentists in Leeds", goal: "Book a demo of our booking software", audience: "practice managers", emails: 3,
      leads: [{ email: "jo@bloggs.example", first_name: "Jo", company: "Bloggs Dental" }],
    },
  },
  { group: "email", method: "GET", path: "/v1/email/campaigns/{id}", scope: "email:write", title: "See a campaign", summary: "The emails, how many went out, replies, and where it is in the approval.", pathParam: { name: "id", example: "cp_4a1b2c3d4e5f" } },
  { group: "email", method: "GET", path: "/v1/email/campaigns", scope: "email:write", title: "List campaigns", summary: "Campaigns made through the API." },
  {
    group: "email", method: "PATCH", path: "/v1/email/campaigns/{id}", scope: "email:write", title: "Change a campaign",
    summary: "Edit the emails or schedule, ask the AI to rewrite them, or pause and resume. A change sends it back for approval.",
    pathParam: { name: "id", example: "cp_4a1b2c3d4e5f" }, body: { regenerate: { instruction: "Make them shorter and less formal" } },
  },
  {
    group: "email", method: "POST", path: "/v1/email/campaigns/{id}/decision", scope: "email:approve", title: "Approve or reject a campaign",
    summary: "The only way a campaign starts sending. Approval is its own permission, so a different person or system can hold it.",
    pathParam: { name: "id", example: "cp_4a1b2c3d4e5f" }, body: { decision: "approve" },
  },
  // ── Social ──
  {
    group: "social", method: "POST", path: "/v1/social/posts", scope: "social:write", title: "Write a post",
    summary: "The AI writes the post and its picture. You get a preview link to share; nothing goes live until it is approved.",
    body: { prompt: "Announce our new Leeds office opening on 1 November", channels: ["linkedin", "facebook"], publish_at: "2026-11-01T09:00:00Z", image: { mode: "ai", instruction: "A bright modern office" } },
    response: { id: "v2_5d1e0c9a7b21", status: "writing", channels: ["linkedin", "facebook"], preview_url: "https://outreach.aivhub.com/api/p/…" },
  },
  { group: "social", method: "GET", path: "/v1/social/posts/{id}", scope: "social:write", title: "See a post", summary: "Status, caption, picture, how it looks on each channel, and the result once it is published.", pathParam: { name: "id", example: "v2_5d1e0c9a7b21" } },
  { group: "social", method: "GET", path: "/v1/social/posts", scope: "social:write", title: "List posts", summary: "Posts made through the API. Filter with ?status=needs_approval or ?channel=linkedin." },
  {
    group: "social", method: "PATCH", path: "/v1/social/posts/{id}", scope: "social:write", title: "Change a post",
    summary: "Edit the text, picture, channels or time by hand, or ask the AI to write the text, the picture or both again. A change sends it back for approval.",
    pathParam: { name: "id", example: "v2_5d1e0c9a7b21" }, body: { regenerate: "text", instruction: "Shorter and friendlier" },
  },
  {
    group: "social", method: "POST", path: "/v1/social/posts/{id}/decision", scope: "social:approve", title: "Approve, reject or cancel a post",
    summary: "The only way a post goes live. Approval closes at the publish time; send a new publish_at to approve it for a later time.",
    pathParam: { name: "id", example: "v2_5d1e0c9a7b21" }, body: { decision: "approve" },
  },
  // ── Meetings ──
  { group: "meetings", method: "GET", path: "/v1/meetings/slots?date=2026-11-03&days=3", scope: "calendar:book", title: "Open times", summary: "Free times for each day. Add &event_type=… and &timezone=… if you need them." },
  {
    group: "meetings", method: "POST", path: "/v1/meetings", scope: "calendar:book", title: "Book a meeting",
    summary: "Books one of the open times and emails the invitation. If the time is taken, the answer lists the times that are free.",
    body: { name: "Jo Bloggs", email: "jo@bloggs.example", date: "2026-11-03", time: "10:30", notes: "Demo of the booking software" },
  },
  { group: "meetings", method: "GET", path: "/v1/meetings", scope: "calendar:book", title: "List meetings", summary: "Upcoming and past meetings, including ones the AI booked on calls. Filter with ?when=upcoming or ?booked_by=ai_call." },
  { group: "meetings", method: "GET", path: "/v1/meetings/{id}", scope: "calendar:book", title: "See a meeting", summary: "One meeting: when, who, the video link and who booked it.", pathParam: { name: "id", example: "mtg_1a2b3c4d" } },
  {
    group: "meetings", method: "PATCH", path: "/v1/meetings/{id}", scope: "calendar:book", title: "Cancel or move a meeting",
    summary: "action: cancel, or reschedule with a new date and time.", pathParam: { name: "id", example: "mtg_1a2b3c4d" }, body: { action: "reschedule", date: "2026-11-04", time: "14:00" },
  },
  // ── Account ──
  {
    group: "account", method: "GET", path: "/v1/wallets", scope: "any key", title: "Balance and setup",
    summary: "Credits left, what each action costs, what is connected (social channels, mailboxes, phone numbers) and a link to fix anything that is not.",
  },
];

export const STEPS = [
  { title: "Make a test key", text: "Open the Keys tab and make a key marked Test. It starts with sk_test_, costs nothing and pretends everything: calls, posts, emails and meetings all work but nothing real happens and nothing is charged." },
  { title: "Try a call", text: "Open “Build and test a request”, pick “Start a call”, paste your test key and press Send. A pretend call finishes in a few seconds; ask for it to see the answers." },
  { title: "Go live", text: "Make a live key (sk_live_…) in the Keys tab, give it only the permissions it needs, and use it in your software instead. Connect your social accounts and mailboxes in the app first; the API uses them." },
];

export const IDEAS = [
  { title: "One endpoint for everything", text: "Send every request to POST /v1/run with a plugin (voice, leads, social or account), an action (the step, such as call.start) and the details in data. Use id for something that already exists. One key, one address, a different payload for each step. The separate addresses listed below do the same and keep working." },
  { title: "Create, then wait", text: "Anything that takes time (a call, a post, a campaign, a lead search) answers at once with an id and a status. Ask for it again with that id, or set up a webhook and we tell you when it is done." },
  { title: "Nothing goes out without approval", text: "Posts and email campaigns wait for a decision. The preview link works without signing in, so anyone you share it with can read, edit, approve or reject it. Approving by link, email, the app or the API all change the same record." },
  { title: "Retries are safe", text: "Send an Idempotency-Key header (any unique text) with a request that creates something. If your software retries, you get the first answer back and nothing is done twice or charged twice." },
  { title: "Credits are the same as the app", text: "The same prices apply. If your balance is short the request is refused before anything starts, with the amount needed and a link to top up. Failed work is not charged." },
  { title: "Test keys are free", text: "Everything works with a test key, including webhooks (marked livemode: false). Nothing real is sent, posted, dialled or charged." },
  { title: "Limits", text: "120 requests a minute per key, and 30 creating or changing things. Over the limit you get 429 with a Retry-After header." },
];

export const ERRORS = [
  ["invalid_request", "422", "Something in your request is missing or wrong. The details list each field."],
  ["missing_scope", "403", "This key is not allowed to do that. Give it the permission in the Keys tab."],
  ["insufficient_credits", "402", "Not enough credits. The message says how many are needed."],
  ["not_found", "404", "That id does not exist in your account."],
  ["approval_closed", "409", "A post can no longer be approved because its time passed. Send a new publish_at."],
  ["rate_limited", "429", "Too many requests. Wait the number of seconds in Retry-After."],
  ["internal_error", "500", "Our side. Quote the request_id if you contact us."],
];

// The plugin and action that send each call through the one endpoint, POST /v1/run.
export const RUN_ACTIONS = {
  "POST /v1/voice/calls": "voice.call.start",
  "GET /v1/voice/calls/{id}": "voice.call.get",
  "GET /v1/voice/calls": "voice.call.list",
  "DELETE /v1/voice/calls/{id}": "voice.call.hangup",
  "POST /v1/voice/calls/{id}/control": "voice.call.control",
  "GET /v1/voice/calls/{id}/recording": "voice.call.recording",
  "GET /v1/voice/scripts": "voice.scripts.list",
  "GET /v1/meetings/slots": "voice.meeting.slots",
  "POST /v1/meetings": "voice.meeting.book",
  "GET /v1/meetings": "voice.meeting.list",
  "GET /v1/meetings/{id}": "voice.meeting.get",
  "PATCH /v1/meetings/{id}": "voice.meeting.update",
  "POST /v1/leads/searches": "leads.search.create",
  "GET /v1/leads/searches/{id}": "leads.search.get",
  "POST /v1/leads": "leads.lead.add",
  "GET /v1/leads": "leads.lead.list",
  "POST /v1/email/campaigns": "leads.campaign.create",
  "GET /v1/email/campaigns/{id}": "leads.campaign.get",
  "GET /v1/email/campaigns": "leads.campaign.list",
  "PATCH /v1/email/campaigns/{id}": "leads.campaign.edit",
  "POST /v1/email/campaigns/{id}/decision": "leads.campaign.decision",
  "POST /v1/social/posts": "social.post.create",
  "GET /v1/social/posts/{id}": "social.post.get",
  "GET /v1/social/posts": "social.post.list",
  "PATCH /v1/social/posts/{id}": "social.post.edit",
  "POST /v1/social/posts/{id}/decision": "social.post.decision",
  "GET /v1/wallets": "account.wallet",
};

// The details to start from for a call: its example body, or for a read its filters (the part after "?").
export function defaultData(ep) {
  if (ep.body) return JSON.stringify(ep.body, null, 2);
  const query = Object.fromEntries(new URLSearchParams(ep.path.split("?")[1] || ""));
  return Object.keys(query).length ? JSON.stringify(query, null, 2) : "";
}

// "voice.call.start" -> { plugin: "voice", action: "call.start" } for a documented call.
export function pluginAction(ep) {
  const [plugin, ...rest] = (RUN_ACTIONS[endpointKey({ method: ep.method, path: ep.path.split("?")[0] })] || "").split(".");
  return { plugin, action: rest.join(".") };
}

// The same call as one request to POST /v1/run: { plugin, action, id?, data? }. `id` overrides the example id.
export function runRequest(ep, bodyText, id) {
  const request = pluginAction(ep);
  if (ep.pathParam) request.id = (id || "").trim() || ep.pathParam.example;
  let data = {};
  try { data = JSON.parse((bodyText || "").trim() || "{}"); } catch { data = {}; }
  if (!bodyText?.trim() && ep.method === "GET") data = JSON.parse(defaultData(ep) || "{}");
  if (data && typeof data === "object" && Object.keys(data).length) request.data = data;
  return { method: "POST", path: "/v1/run", body: JSON.stringify(request, null, 2) };
}

export function defaultBody(ep) {
  return ep.body ? JSON.stringify(ep.body, null, 2) : "";
}

export function endpointKey(ep) {
  return `${ep.method} ${ep.path}`;
}
