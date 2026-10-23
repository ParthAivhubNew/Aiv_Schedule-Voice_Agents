// What the public API offers, in one place: the Docs tab shows it and the Playground sends it.
// Paths are under https://api.outreach.aivhub.com. {id} is a path parameter.

export const API_BASE = "https://api.outreach.aivhub.com";

export const GROUPS = [
  { id: "start", label: "Start here" },
  { id: "voice", label: "Phone calls" },
  { id: "leads", label: "Find leads" },
  { id: "email", label: "Email campaigns" },
  { id: "social", label: "Social posts" },
  { id: "mail", label: "Mail" },
  { id: "meetings", label: "Meetings" },
  { id: "whatsapp", label: "WhatsApp" },
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
    body: { plugin: "mail", action: "guide", message: "Offer them Tuesday at 3pm instead" },
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
    summary: "The AI writes the sequence from your goal, your audience and your company profile (or send your own steps). It uses only those facts and invents no figures, customers or claims; anything it could not back up comes back in warnings. Nothing is sent until it is approved. Use {{firstName}}, {{lastName}} and {{company}} to personalise. Set personalise to true to add an opening line about each company, written only from the facts you send for it and the company register (match it with company_number or website). A company we know nothing about gets no line and is not charged. Choose which mailboxes send with mailbox_ids (or mailbox_id for one), using ids from GET /v1/email/mailboxes; leave it out and your ready mailboxes are used. An id that isn't yours is refused with mailbox_not_found. The campaign answer lists mailbox_ids.",
    body: {
      name: "Dentists in Leeds", goal: "Book a demo of our booking software", audience: "practice managers", emails: 3, personalise: true, mailbox_ids: ["mb_1a2b3c4d5e6f"],
      leads: [{ email: "jo@bloggs.example", first_name: "Jo", company: "Bloggs Dental", company_number: "01234567", facts: ["Opened a second surgery in 2025"] }],
    },
  },
  {
    group: "email", method: "POST", path: "/v1/email/send", scope: "email:approve", title: "Send one email now",
    summary: "One personal email to one person, straight away: no warm-up wait and no sending hours. It still skips anyone on your do-not-email list, adds the unsubscribe link and uses a credit. Up to 25 a day. For many people use a campaign. Choose the sender with mailbox_id (an id from GET /v1/email/mailboxes) or from (that mailbox's address, any letter case). If you send both they must be the same mailbox. Leave both out and Outreach picks the best mailbox that can send, as before. A mailbox that is not yours is answered as if it did not exist (mailbox_not_found, listing the ones you can use). A mailbox that can't send right now is refused with mailbox_cannot_send and a reason: spf_missing, dkim_missing, paused, connection_failed or daily_cap_reached. If you named no mailbox and none can send you get no_mailbox_can_send. All are 422. After 25 one-to-one emails in a day you get 429 daily_limit.",
    body: { to: "jo@bloggs.example", subject: "Your tender, {{firstName}}", body: "Hi {{firstName}},\n\nA quick note about your tender.\n\nThanks", first_name: "Jo", company: "Bloggs Dental", mailbox_id: "mb_1a2b3c4d5e6f" },
    response: { id: "5d1f...", status: "sent", to: "jo@bloggs.example", from: "sales@yourcompany.com", mailbox_id: "mb_1a2b3c4d5e6f" },
  },
  {
    group: "email", method: "GET", path: "/v1/email/mailboxes", scope: "email:write", title: "Your mailboxes",
    summary: "The mailboxes you have connected, with the ids to use as mailbox_id (one email) or mailbox_ids (a campaign). status is sending, warming_up, paused, not_started or needs_attention. can_send says whether a one-to-one email can go from it now and reason says why not (null when it can). daily_cap is how many one-to-one emails it may send a day and sent_today how many it has. spf is ok or missing; dkim is ok, skipped (you chose to send without it) or missing. Never includes passwords or tokens.",
    response: { data: [{ id: "mb_1a2b3c4d5e6f", email: "sales@yourcompany.com", status: "sending", can_send: true, reason: null, reason_code: null, daily_cap: 40, sent_today: 3, spf: "ok", dkim: "skipped" }] },
  },
  {
    group: "email", method: "GET", path: "/v1/email/messages", scope: "email:write", title: "List sent emails",
    summary: "The emails that actually went out, newest first, with what became of each: sent, replied or bounced. Filter with ?status=, ?campaign_id=, ?mailbox_id=, ?kind=one_to_one and ?q= (address or subject). Warm-up emails are left out.",
    response: { data: [{ id: "5d1f...", to: "jo@bloggs.example", subject: "Your tender", status: "sent", sent_at: "2026-11-03T10:30:00Z", mailbox: "sales@yourcompany.com", kind: "one_to_one" }], next_cursor: null },
  },
  { group: "email", method: "GET", path: "/v1/email/messages/{id}", scope: "email:write", title: "See one sent email", summary: "The email as it went out, plus the reply or the bounce reason if there was one.", pathParam: { name: "id", example: "5d1f0a7e-..." } },
  { group: "email", method: "GET", path: "/v1/email/campaigns/{id}", scope: "email:write", title: "See a campaign", summary: "The emails, any warnings about the AI-written text, the opening line written for each person and the facts it came from, how many went out, replies, and where it is in the approval.", pathParam: { name: "id", example: "cp_4a1b2c3d4e5f" } },
  { group: "email", method: "GET", path: "/v1/email/campaigns", scope: "email:write", title: "List campaigns", summary: "Campaigns made through the API." },
  {
    group: "email", method: "PATCH", path: "/v1/email/campaigns/{id}", scope: "email:write", title: "Change a campaign",
    summary: "Edit the emails or schedule, ask the AI to rewrite them (it adds no new facts), or pause and resume. A change sends it back for approval.",
    pathParam: { name: "id", example: "cp_4a1b2c3d4e5f" }, body: { regenerate: { instruction: "Make them shorter and less formal" } },
  },
  {
    group: "email", method: "POST", path: "/v1/email/campaigns/{id}/decision", scope: "email:approve", title: "Approve or reject a campaign",
    summary: "The only way a campaign starts sending. Approval is its own permission, so a different person or system can hold it.",
    pathParam: { name: "id", example: "cp_4a1b2c3d4e5f" }, body: { decision: "approve" },
  },
  // ── Mail: no URL of its own, it goes through POST /v1/run with plugin "mail" ──
  {
    group: "mail", method: "POST", path: "/v1/run?plugin=mail&action=mailboxes.list", scope: "mail:read", title: "Your mailboxes and unread counts",
    summary: "Mail goes through POST /v1/run like everything else: plugin is mail, action says what to do, and id and data carry the details. Each action needs its own permission: mail:read looks, mail:write sends and tidies (never erases), mail:delete erases what is already in Trash or Drafts. A key can also be limited to some mailboxes when it is made; mail in other mailboxes does not exist for it (404). Mail permissions are never included in an older full-access key: tick them on purpose.",
    body: { plugin: "mail", action: "mailboxes.list" },
    response: { data: [{ id: "mb_1a2b3c4d5e6f", email: "sales@yourcompany.com", unread: 3, synced_at: "2026-11-03T10:30:00" }] },
  },
  {
    group: "mail", method: "POST", path: "/v1/run?plugin=mail&action=folders.counts", scope: "mail:read", title: "Emails in each folder",
    summary: "How many emails are in Inbox, Sent, Drafts, Archive, Spam and Trash, and how many are unread. data.mailbox_id narrows it to one mailbox.",
    body: { plugin: "mail", action: "folders.counts", data: { mailbox_id: "mb_1a2b3c4d5e6f" } },
  },
  {
    group: "mail", method: "POST", path: "/v1/run?plugin=mail&action=messages.list", scope: "mail:read", title: "List a folder, or search",
    summary: "Conversations in a folder, newest first. data: folder (inbox, sent, drafts, archive, spam or trash), mailbox_id, q (sender, subject or text), unread, starred, attachments, limit (up to 100) and cursor from the last answer.",
    body: { plugin: "mail", action: "messages.list", data: { folder: "inbox", q: "proposal", unread: true, limit: 20 } },
    response: { data: [{ id: "mm_9c1d...", thread_key: "0ca792d4...", from: { name: "Tom Reed", email: "tom@kirkgate.example" }, subject: "Proposal for Q4", snippet: "Please find our proposal attached", is_read: false, has_attachments: true, count: 2 }], total: 1, next_cursor: null },
  },
  {
    group: "mail", method: "POST", path: "/v1/run?plugin=mail&action=messages.get", scope: "mail:read", title: "Read one email",
    summary: "The email in full: recipients, body (text and cleaned HTML) and its attachments list. id is the message id from a list.",
    body: { plugin: "mail", action: "messages.get", id: "mm_9c1d..." },
  },
  {
    group: "mail", method: "POST", path: "/v1/run?plugin=mail&action=thread.get", scope: "mail:read", title: "Read a whole conversation",
    summary: "Every email of one conversation, oldest first. id is the thread_key from a list. Add data.folder trash to include deleted ones.",
    body: { plugin: "mail", action: "thread.get", id: "0ca792d4..." },
  },
  {
    group: "mail", method: "POST", path: "/v1/run?plugin=mail&action=attachment.get", scope: "mail:read", title: "Download an attachment",
    summary: "One attachment as base64. id is the message id; data.index is its position in the attachments list (0 is the first).",
    body: { plugin: "mail", action: "attachment.get", id: "mm_9c1d...", data: { index: 0 } },
    response: { name: "Q4-proposal.pdf", type: "application/pdf", size: 52311, content_base64: "JVBERi0x..." },
  },
  {
    group: "mail", method: "POST", path: "/v1/run?plugin=mail&action=sync", scope: "mail:read", title: "Check for new mail now",
    summary: "Reads the mail server for new email. It also happens by itself every few minutes. data.mailbox_id limits it to one mailbox; data.force skips the short wait between checks.",
    body: { plugin: "mail", action: "sync", data: { mailbox_id: "mb_1a2b3c4d5e6f" } },
  },
  {
    group: "mail", method: "POST", path: "/v1/run?plugin=mail&action=send", scope: "mail:write", title: "Send an email, reply or forward",
    summary: "Sends from one of your mailboxes. data: mailbox_id, to, cc, bcc (lists or comma-separated), subject, body_html or body_text, from_address (a saved alias), in_reply_to_id (a message id: makes it a reply in the same conversation) and attachments: a list of { name, type, content_base64 } (up to 10 files, 20 MB together). Up to 50 people per email and 200 emails a day per mailbox. Use an Idempotency-Key header so a retry never sends twice.",
    body: { plugin: "mail", action: "send", data: { mailbox_id: "mb_1a2b3c4d5e6f", to: ["tom@kirkgate.example"], subject: "Re: Proposal for Q4", body_text: "Tuesday works. See you then.", in_reply_to_id: "mm_9c1d..." } },
    response: { ok: true, id: "mm_2e7f...", status: "sent" },
  },
  {
    group: "mail", method: "POST", path: "/v1/run?plugin=mail&action=draft.save", scope: "mail:write", title: "Save a draft",
    summary: "Saves an email without sending it. Send the same fields as send; add data.id to update a draft you saved before. Drafts have no attachments.",
    body: { plugin: "mail", action: "draft.save", data: { mailbox_id: "mb_1a2b3c4d5e6f", to: ["tom@kirkgate.example"], subject: "Following up", body_text: "Hi Tom," } },
  },
  {
    group: "mail", method: "POST", path: "/v1/run?plugin=mail&action=messages.mark", scope: "mail:write", title: "Mark read, unread or starred",
    summary: "data.ids is a list of up to 100 message ids (or send one in id). data.mark is read, unread, star or unstar. The mail server's own copy changes too.",
    body: { plugin: "mail", action: "messages.mark", data: { ids: ["mm_9c1d..."], mark: "read" } },
  },
  {
    group: "mail", method: "POST", path: "/v1/run?plugin=mail&action=messages.move", scope: "mail:write", title: "Archive, mark as spam, or move to Trash",
    summary: "data.to is archive, spam, trash or inbox (to put it back). Moving to Trash is not erasing: it can be undone by moving it to inbox. Up to 100 ids at a time.",
    body: { plugin: "mail", action: "messages.move", data: { ids: ["mm_9c1d..."], to: "trash" } },
  },
  {
    group: "mail", method: "POST", path: "/v1/run?plugin=mail&action=messages.delete", scope: "mail:delete", title: "Delete for good",
    summary: "Erases emails and their attachments, here and on the mail server. This cannot be undone, so it only works on emails already in Trash or Drafts (anything else is refused with 400: move it to trash first). It has its own permission, mail:delete, so a key that can send and tidy still cannot erase. Up to 100 ids at a time. Every call is recorded in the activity of the key.",
    body: { plugin: "mail", action: "messages.delete", data: { ids: ["mm_9c1d..."] } },
    response: { ok: true, changed: 1 },
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
    summary: "action: cancel, or reschedule with a new date and time.", pathParam: { name: "id", example: "mtg_1a2b3c4d" }, body: { plugin: "mail", action: "reschedule", date: "2026-11-04", time: "14:00" },
  },
  // ── Account ──
  {
    group: "account", method: "GET", path: "/v1/wallets", scope: "any key", title: "Balance and setup",
    summary: "Credits left, what each action costs, what is connected (social channels, mailboxes, phone numbers) and a link to fix anything that is not.",
  },
  // ── Connecting accounts, results, lists, scripts, WhatsApp and company knowledge ──
  { group: "social", method: "GET", path: "/v1/social/channels/providers", scope: "social:write", title: "Networks you can connect", summary: "LinkedIn, Facebook, Instagram, X and Threads, and whether each is set up on our side right now." },
  { group: "social", method: "POST", path: "/v1/social/channels/connect", scope: "social:write", title: "Connect a network", summary: "Returns auth_url. Open it in a popup: the user signs in on the network's own page, so you never see a password or token. The popup ends at your return_url with ?status=connected|error&provider=&channel_id=, and the page that opened it gets a message. Needs a key issued through the partner programme.", body: {"provider": "linkedin", "return_url": "https://app.example.com/connected"} },
  { group: "social", method: "GET", path: "/v1/social/channels", scope: "social:write", title: "Connected networks", summary: "Each connected channel with its status: connected, needs_reauth or error." },
  { group: "social", method: "DELETE", path: "/v1/social/channels/{id}", scope: "social:write", title: "Disconnect a network", summary: "Removes the connection. Posts already made stay.", pathParam: { name: "id", example: "soc_linkedin_1a2b3c4d" } },
  { group: "social", method: "POST", path: "/v1/social/media", scope: "social:write", title: "Add a picture or video", summary: "Send the file as base64. The answer has a full url to use as image.url when you create a post.", body: {"filename": "logo.png", "content_type": "image/png", "content_base64": "iVBORw0KGgo…", "alt": "Our logo"} },
  { group: "social", method: "POST", path: "/v1/social/media/import-url", scope: "social:write", title: "Copy a file into the library", summary: "Copies a file from a public https address into the library.", body: {"url": "https://example.com/picture.jpg"} },
  { group: "social", method: "GET", path: "/v1/social/media", scope: "social:write", title: "The media library", summary: "Pictures and videos, newest first. Filter with ?kind=image or ?q=." },
  { group: "social", method: "DELETE", path: "/v1/social/media/{id}", scope: "social:write", title: "Remove a file", summary: "Takes it out of the library. Posts that already use it keep working.", pathParam: { name: "id", example: "med_1a2b3c4d5e6f" } },
  { group: "social", method: "POST", path: "/v1/social/plan", scope: "social:write", title: "Plan many posts", summary: "Plan AI returns an outline: which posts, on which days and channels, about what. Nothing is created or written. Show it to your user, then send the posts they want to /v1/social/plan/apply.", body: {"prompt": "A month of LinkedIn posts, Mondays and Thursdays, about onboarding", "channels": ["linkedin"]} },
  { group: "social", method: "POST", path: "/v1/social/plan/apply", scope: "social:write", title: "Create the planned posts", summary: "Creates up to 30 posts from a plan. Each is written by the AI and waits for approval.", body: {"posts": [{"date": "2026-11-03", "time": "09:00", "channel": "linkedin", "headline": "Why onboarding matters", "angle": "What a good first week looks like"}]} },
  { group: "social", method: "GET", path: "/v1/social/insights", scope: "social:write", title: "How posts did", summary: "Totals and changes, by network, a daily series, best posts, best times and followers. ?days=7|30|90, ?channel= and ?account= take comma-separated lists. Every number is as of lastSyncedAt: the networks are read every few hours." },
  { group: "social", method: "GET", path: "/v1/social/posts/{id}/results", scope: "social:write", title: "One post's numbers", summary: "Its numbers per network, when they were last read (asOf), leads, meetings and tracked link clicks.", pathParam: { name: "id", example: "v2_1a2b3c4d5e6f" } },
  { group: "social", method: "POST", path: "/v1/social/posts/{id}/results/link", scope: "social:write", title: "Share one post's numbers", summary: "A link anyone can open with no sign-in. It always shows the latest numbers, works for 120 days, and the page says when it stops.", pathParam: { name: "id", example: "v2_1a2b3c4d5e6f" } },
  { group: "social", method: "GET", path: "/v1/social/reports", scope: "social:write", title: "Reports", summary: "Saved report definitions." },
  { group: "social", method: "POST", path: "/v1/social/reports", scope: "social:write", title: "Make a report", summary: "Saves a report (period, networks, recipients) and returns its live link. The page and every email say when their numbers are from.", body: {"name": "Acme monthly", "days": 30, "channels": ["linkedin"], "recipients": ["boss@acme.com"]} },
  { group: "social", method: "POST", path: "/v1/social/reports/{id}/link", scope: "social:write", title: "A fresh report link", summary: "A new link to the report's live page. It works for 120 days.", pathParam: { name: "id", example: "rep_1a2b3c4d5e" } },
  { group: "social", method: "POST", path: "/v1/social/reports/{id}/send", scope: "social:write", title: "Email a report", summary: "Emails the report now. Send data.to to use other addresses than the report's own.", pathParam: { name: "id", example: "rep_1a2b3c4d5e" } },
  { group: "social", method: "DELETE", path: "/v1/social/reports/{id}", scope: "social:write", title: "Delete a report", summary: "Its links stop working.", pathParam: { name: "id", example: "rep_1a2b3c4d5e" } },
  { group: "email", method: "POST", path: "/v1/email/mailboxes/connect", scope: "email:write", title: "Connect a mailbox", summary: "Returns connect_url. Open it in a popup: the user types their mailbox login on our page, so you never see the password. The popup ends at your return_url with ?status=connected&provider=mailbox&mailbox_id=.", body: {"return_url": "https://app.example.com/connected"} },
  { group: "email", method: "GET", path: "/v1/email/mailboxes/{id}", scope: "email:write", title: "One mailbox", summary: "Status, what blocks sending, the SPF, DKIM, DMARC and MX results, and the records to add. No secrets.", pathParam: { name: "id", example: "mb_1a2b3c4d5e6f" } },
  { group: "email", method: "POST", path: "/v1/email/mailboxes/{id}/check", scope: "email:write", title: "Check a mailbox's DNS", summary: "Re-checks SPF, DKIM, DMARC and MX now.", pathParam: { name: "id", example: "mb_1a2b3c4d5e6f" } },
  { group: "email", method: "POST", path: "/v1/email/mailboxes/{id}/warmup", scope: "email:write", title: "Warm a mailbox up", summary: "action: start, pause or skip (for a mailbox that is already warm). Start needs SPF and DKIM in place.", pathParam: { name: "id", example: "mb_1a2b3c4d5e6f" }, body: {"action": "start"} },
  { group: "email", method: "DELETE", path: "/v1/email/mailboxes/{id}", scope: "email:write", title: "Disconnect a mailbox", summary: "Removes it from every campaign.", pathParam: { name: "id", example: "mb_1a2b3c4d5e6f" } },
  { group: "email", method: "GET", path: "/v1/email/campaigns/{id}/results", scope: "email:write", title: "How a campaign did", summary: "Sent, opened, replied and bounced, overall and for each email in the sequence, plus the reply categories. Opens are a minimum: some mail apps block the tracking picture.", pathParam: { name: "id", example: "cmp_1a2b3c4d5e6f" } },
  { group: "email", method: "GET", path: "/v1/email/replies", scope: "email:write", title: "Replies", summary: "Replies to your campaign emails, newest first. Filter with ?category=." },
  { group: "email", method: "POST", path: "/v1/email/replies/{id}/category", scope: "email:write", title: "Sort a reply", summary: "category: interested, question, not_interested, ooo or unsubscribe. Unsubscribe also stops all further email to that person.", pathParam: { name: "id", example: "em_1a2b3c4d5e6f" }, body: {"category": "interested"} },
  { group: "email", method: "GET", path: "/v1/email/suppression", scope: "email:write", title: "The do-not-email list", summary: "Addresses and domains no campaign will email." },
  { group: "email", method: "POST", path: "/v1/email/suppression", scope: "email:write", title: "Add to the do-not-email list", summary: "An address, or a whole domain like example.com.", body: {"email": "nobody@example.com"} },
  { group: "email", method: "DELETE", path: "/v1/email/suppression/{id}", scope: "email:write", title: "Remove from the do-not-email list", summary: "Takes one entry off the do-not-email list.", pathParam: { name: "id", example: "sup_1a2b3c4d5e6f" } },
  { group: "leads", method: "GET", path: "/v1/leads/lists", scope: "leads:search", title: "Lead lists", summary: "Your lists of saved leads, with the lead ids in each." },
  { group: "leads", method: "POST", path: "/v1/leads/lists", scope: "leads:search", title: "Make a list", summary: "A named list, optionally with saved lead ids.", body: {"name": "Plumbers", "ids": []} },
  { group: "leads", method: "PATCH", path: "/v1/leads/lists/{id}", scope: "leads:search", title: "Change a list", summary: "Rename it, and add or remove leads.", pathParam: { name: "id", example: "lst_1a2b3c4d5e" }, body: {"name": "Plumbers North", "add": [], "remove": []} },
  { group: "leads", method: "DELETE", path: "/v1/leads/lists/{id}", scope: "leads:search", title: "Delete a list", summary: "The leads in it stay saved.", pathParam: { name: "id", example: "lst_1a2b3c4d5e" } },
  { group: "leads", method: "POST", path: "/v1/leads/companies/{id}/contacts", scope: "leads:search", title: "A company's contacts", summary: "The people on the company's official record (free) and what we hold. With include_web, also a website and phone found on the web: 1 Leads credit, only when found. Use the id of a company from a search.", pathParam: { name: "id", example: "biz_1a2b3c4d5e6f" }, body: {"include_web": false} },
  { group: "leads", method: "POST", path: "/v1/leads/email-find", scope: "leads:search", title: "Find a person's email", summary: "One named person's work email at a company. 1 Leads credit when one is found, nothing when not.", body: {"first_name": "Ann", "last_name": "Lee", "company_name": "Acme", "domain": "acme.com"} },
  { group: "voice", method: "POST", path: "/v1/voice/calls/{id}/summary", scope: "voice:calls", title: "Summarise a call", summary: "An AI summary of the call, so far if it is still running. Written once and kept.", pathParam: { name: "id", example: "call_8f2a91c4" } },
  { group: "voice", method: "GET", path: "/v1/voice/scripts/{id}", scope: "voice:calls", title: "One call script", summary: "The call script in full, every field.", pathParam: { name: "id", example: "tpl_1a2b3c4d5e6f" } },
  { group: "voice", method: "POST", path: "/v1/voice/scripts", scope: "voice:calls", title: "Make a call script", summary: "Anything you leave out is copied from the standard script. It is saved, not live, unless make_live is true (which replaces the script the AI uses now).", body: {"name": "Window cleaners", "greeting_template": "Hi {{name}}, it's Sam.", "value_prop_template": "We clean windows."} },
  { group: "voice", method: "PATCH", path: "/v1/voice/scripts/{id}", scope: "voice:calls", title: "Change a call script", summary: "Send only the fields to change.", pathParam: { name: "id", example: "tpl_1a2b3c4d5e6f" }, body: {"greeting_template": "Hello {{name}}"} },
  { group: "voice", method: "DELETE", path: "/v1/voice/scripts/{id}", scope: "voice:calls", title: "Delete a call script", summary: "The standard scripts cannot be deleted.", pathParam: { name: "id", example: "tpl_1a2b3c4d5e6f" } },
  { group: "voice", method: "GET", path: "/v1/voice/voices", scope: "voice:calls", title: "Call voices", summary: "The voices the AI can speak with, and which one is used now." },
  { group: "voice", method: "POST", path: "/v1/voice/voices/use", scope: "voice:calls", title: "Choose the call voice", summary: "Used for calls from now on.", body: {"kind": "library", "ref": "voice_id"} },
  { group: "meetings", method: "GET", path: "/v1/meetings/providers", scope: "calendar:book", title: "Video meeting accounts", summary: "Whether Google Meet, Microsoft Teams and Zoom are connected. Without one, meetings still book; they just get no video room." },
  { group: "meetings", method: "POST", path: "/v1/meetings/providers/connect", scope: "calendar:book", title: "Connect a video account", summary: "Returns auth_url. Open it in a popup; it ends at your return_url with ?status=&provider=&account=.", body: {"provider": "google", "return_url": "https://app.example.com/connected"} },
  { group: "meetings", method: "DELETE", path: "/v1/meetings/providers/{id}", scope: "calendar:book", title: "Disconnect a video account", summary: "id is google, microsoft or zoom.", pathParam: { name: "id", example: "google" } },
  { group: "whatsapp", method: "GET", path: "/v1/whatsapp/numbers", scope: "voice:calls", title: "WhatsApp numbers", summary: "Your numbers and whether WhatsApp is on for each." },
  { group: "whatsapp", method: "GET", path: "/v1/whatsapp/threads", scope: "voice:calls", title: "WhatsApp conversations", summary: "Newest first, with the unread count, a preview and whether you can still reply freely (windowOpen)." },
  { group: "whatsapp", method: "GET", path: "/v1/whatsapp/threads/{id}", scope: "voice:calls", title: "A WhatsApp conversation", summary: "Its messages. Reading it marks it read.", pathParam: { name: "id", example: "wt_1a2b3c4d5e6f" } },
  { group: "whatsapp", method: "POST", path: "/v1/whatsapp/threads/{id}/send", scope: "voice:calls", title: "Reply on WhatsApp", summary: "text within 24 hours of their last message; after that only an approved template is accepted (window_closed).", pathParam: { name: "id", example: "wt_1a2b3c4d5e6f" }, body: {"text": "Thursday works for us"} },
  { group: "whatsapp", method: "POST", path: "/v1/whatsapp/threads", scope: "voice:calls", title: "Start a WhatsApp conversation", summary: "WhatsApp needs an approved template for the first message.", body: {"our_number": "+442079460000", "contact_number": "+447700900123", "template": {"name": "hello", "language": "en_GB", "params": []}} },
  { group: "account", method: "GET", path: "/v1/company/profile", scope: "company:write", title: "The company profile", summary: "Name, pitch, tone, time zone, calling hours and what the AI says on calls." },
  { group: "account", method: "PATCH", path: "/v1/company/profile", scope: "company:write", title: "Change the company profile", summary: "Send only the fields to change. The caller ID cannot be changed here.", body: {"pitch": "We clean windows for shops and offices."} },
  { group: "account", method: "GET", path: "/v1/company/services", scope: "company:write", title: "Services the AI can talk about", summary: "The services the AI can talk about, as a list." },
  { group: "account", method: "PUT", path: "/v1/company/services", scope: "company:write", title: "Set the services", summary: "Replaces the whole list (up to 100).", body: {"services": [{"name": "Windows", "desc": "Outside cleaning", "ideal": "Shops"}]} },
  { group: "account", method: "GET", path: "/v1/company/faqs", scope: "company:write", title: "Questions and answers", summary: "The list the AI can use." },
  { group: "account", method: "PUT", path: "/v1/company/faqs", scope: "company:write", title: "Set the questions and answers", summary: "Replaces the whole list (up to 100).", body: {"faqs": [{"q": "Do you clean upstairs?", "a": "Yes."}]} },
];

export const STEPS = [
  { title: "Make a test key", text: "Open the Keys tab and make a key marked Test. It starts with sk_test_, costs nothing and pretends everything: calls, posts, emails and meetings all work but nothing real happens and nothing is charged." },
  { title: "Try a call", text: "Open “Build and test a request”, pick “Start a call”, paste your test key and press Send. A pretend call finishes in a few seconds; ask for it to see the answers." },
  { title: "Go live", text: "Make a live key (sk_live_…) in the Keys tab, give it only the permissions it needs, and use it in your software instead. The API uses the accounts connected to the user's Outreach account: social networks, mailboxes and video-meeting accounts. If you are a partner, start those from your own pages with channel.connect, mailbox.connect and meeting_provider.connect (a popup, so you never see a password or token); otherwise connect them in the app." },
];

export const IDEAS = [
  { title: "One endpoint for everything", text: "Send every request to POST /v1/run with a plugin (voice, leads, social, whatsapp, account, mail or numbers), an action (the step, such as call.start) and the details in data. Use id for something that already exists. One key, one address, a different payload for each step. The separate addresses listed below do the same and keep working." },
  { title: "Create, then wait", text: "Anything that takes time (a call, a post, a campaign, a lead search) answers at once with an id and a status. Ask for it again with that id, or set up a webhook and we tell you when it is done." },
  { title: "Nothing goes out without approval", text: "Posts and email campaigns wait for a decision. The preview link works without signing in, so anyone you share it with can read, edit, approve or reject it. Approving by link, email, the app or the API all change the same record." },
  { title: "Retries are safe", text: "Send an Idempotency-Key header (any unique text) with a request that creates something. If your software retries, you get the first answer back and nothing is done twice or charged twice. Only an answer that worked is remembered: a request that was refused (a mailbox that doesn't exist, not enough credits, a bad field) is not replayed, so you can fix it and retry with the same key. The same key with a different request, for example another mailbox, is refused with idempotency_key_reused." },
  { title: "Credits are the same as the app", text: "The same prices apply. If your balance is short the request is refused before anything starts, with the amount needed and a link to top up. Failed work is not charged." },
  { title: "Test keys are free", text: "Everything works with a test key, including webhooks (marked livemode: false). Nothing real is sent, posted, dialled or charged." },
  { title: "Limits", text: "120 requests a minute per key, and 30 creating or changing things. Over the limit you get 429 with a Retry-After header." },
];

export const ERRORS = [
  ["invalid_request", "422", "Something in your request is missing or wrong. The details list each field."],
  ["missing_scope", "403", "This key is not allowed to do that. Give it the permission in the Keys tab."],
  ["insufficient_credits", "402", "Not enough credits. The message says how many are needed."],
  ["not_found", "404", "That id does not exist in your account."],
  ["mailbox_not_found", "422", "No mailbox with that id or address is connected. details.valid lists the mailboxes you can use (id and email)."],
  ["mailbox_cannot_send", "422", "The mailbox you chose can't send right now. details.reason is spf_missing, dkim_missing, paused, connection_failed or daily_cap_reached, and details.fix_url opens its settings."],
  ["mailbox_mismatch", "422", "mailbox_id and from name different mailboxes. Send one of them, or make them the same."],
  ["no_mailbox_can_send", "422", "You didn't choose a mailbox and none can send. details.mailboxes says why for each."],
  ["daily_limit", "429", "25 one-to-one emails have gone today (a mailbox's own limit is mailbox_cannot_send with reason daily_cap_reached)."],
  ["idempotency_key_reused", "422", "That Idempotency-Key was already used for a different request."],
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
  "POST /v1/email/send": "leads.email.send",
  "GET /v1/email/mailboxes": "leads.mailbox.list",
  "GET /v1/email/messages": "leads.email.list",
  "GET /v1/email/messages/{id}": "leads.email.get",
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
  "GET /v1/social/channels/providers": "social.channel.providers",
  "POST /v1/social/channels/connect": "social.channel.connect",
  "GET /v1/social/channels": "social.channel.list",
  "DELETE /v1/social/channels/{id}": "social.channel.disconnect",
  "POST /v1/social/media": "social.media.upload",
  "POST /v1/social/media/import-url": "social.media.import_url",
  "GET /v1/social/media": "social.media.list",
  "DELETE /v1/social/media/{id}": "social.media.delete",
  "POST /v1/social/plan": "social.plan.create",
  "POST /v1/social/plan/apply": "social.plan.apply",
  "GET /v1/social/insights": "social.insights.get",
  "GET /v1/social/posts/{id}/results": "social.post.results",
  "POST /v1/social/posts/{id}/results/link": "social.post.results_link",
  "GET /v1/social/reports": "social.report.list",
  "POST /v1/social/reports": "social.report.create",
  "POST /v1/social/reports/{id}/link": "social.report.link",
  "POST /v1/social/reports/{id}/send": "social.report.send",
  "DELETE /v1/social/reports/{id}": "social.report.delete",
  "POST /v1/email/mailboxes/connect": "leads.mailbox.connect",
  "GET /v1/email/mailboxes/{id}": "leads.mailbox.get",
  "POST /v1/email/mailboxes/{id}/check": "leads.mailbox.check_dns",
  "POST /v1/email/mailboxes/{id}/warmup": "leads.mailbox.warmup",
  "DELETE /v1/email/mailboxes/{id}": "leads.mailbox.disconnect",
  "GET /v1/email/campaigns/{id}/results": "leads.campaign.results",
  "GET /v1/email/replies": "leads.reply.list",
  "POST /v1/email/replies/{id}/category": "leads.reply.categorize",
  "GET /v1/email/suppression": "leads.suppression.list",
  "POST /v1/email/suppression": "leads.suppression.add",
  "DELETE /v1/email/suppression/{id}": "leads.suppression.remove",
  "GET /v1/leads/lists": "leads.list.list",
  "POST /v1/leads/lists": "leads.list.create",
  "PATCH /v1/leads/lists/{id}": "leads.list.edit",
  "DELETE /v1/leads/lists/{id}": "leads.list.delete",
  "POST /v1/leads/companies/{id}/contacts": "leads.company.contacts",
  "POST /v1/leads/email-find": "leads.email.find",
  "POST /v1/voice/calls/{id}/summary": "voice.call.summary",
  "GET /v1/voice/scripts/{id}": "voice.script.get",
  "POST /v1/voice/scripts": "voice.script.create",
  "PATCH /v1/voice/scripts/{id}": "voice.script.edit",
  "DELETE /v1/voice/scripts/{id}": "voice.script.delete",
  "GET /v1/voice/voices": "voice.voice.list",
  "POST /v1/voice/voices/use": "voice.voice.use",
  "GET /v1/meetings/providers": "voice.meeting_provider.list",
  "POST /v1/meetings/providers/connect": "voice.meeting_provider.connect",
  "DELETE /v1/meetings/providers/{id}": "voice.meeting_provider.disconnect",
  "GET /v1/whatsapp/numbers": "whatsapp.numbers",
  "GET /v1/whatsapp/threads": "whatsapp.threads.list",
  "GET /v1/whatsapp/threads/{id}": "whatsapp.threads.get",
  "POST /v1/whatsapp/threads/{id}/send": "whatsapp.threads.send",
  "POST /v1/whatsapp/threads": "whatsapp.threads.start",
  "GET /v1/company/profile": "account.profile.get",
  "PATCH /v1/company/profile": "account.profile.update",
  "GET /v1/company/services": "account.services.get",
  "PUT /v1/company/services": "account.services.set",
  "GET /v1/company/faqs": "account.faqs.get",
  "PUT /v1/company/faqs": "account.faqs.set",
  "POST /v1/run?plugin=mail&action=mailboxes.list": "mail.mailboxes.list",
  "POST /v1/run?plugin=mail&action=folders.counts": "mail.folders.counts",
  "POST /v1/run?plugin=mail&action=messages.list": "mail.messages.list",
  "POST /v1/run?plugin=mail&action=messages.get": "mail.messages.get",
  "POST /v1/run?plugin=mail&action=thread.get": "mail.thread.get",
  "POST /v1/run?plugin=mail&action=attachment.get": "mail.attachment.get",
  "POST /v1/run?plugin=mail&action=sync": "mail.sync",
  "POST /v1/run?plugin=mail&action=send": "mail.send",
  "POST /v1/run?plugin=mail&action=draft.save": "mail.draft.save",
  "POST /v1/run?plugin=mail&action=messages.mark": "mail.messages.mark",
  "POST /v1/run?plugin=mail&action=messages.move": "mail.messages.move",
  "POST /v1/run?plugin=mail&action=messages.delete": "mail.messages.delete",
};

// The details to start from for a call: its example body, or for a read its filters (the part after "?").
export function defaultData(ep) {
  if (ep.body) return JSON.stringify(ep.body, null, 2);
  const query = Object.fromEntries(new URLSearchParams(ep.path.split("?")[1] || ""));
  return Object.keys(query).length ? JSON.stringify(query, null, 2) : "";
}

// "voice.call.start" -> { plugin: "voice", action: "call.start" } for a documented call.
export function pluginAction(ep) {
  const [plugin, ...rest] = (RUN_ACTIONS[endpointKey(ep)] || RUN_ACTIONS[endpointKey({ method: ep.method, path: ep.path.split("?")[0] })] || "").split(".");
  return { plugin, action: rest.join(".") };
}

// The same call as one request to POST /v1/run: { plugin, action, id?, data? }. `id` overrides the example id.
export function runRequest(ep, bodyText, id) {
  const request = pluginAction(ep);
  if (ep.pathParam) request.id = (id || "").trim() || ep.pathParam.example;
  let data = {};
  try { data = JSON.parse((bodyText || "").trim() || "{}"); } catch { data = {}; }
  if (ep.path.startsWith("/v1/run?plugin=mail")) { // a mail call already says what it does: its own id and data go straight into the envelope
    const own = data && typeof data === "object" ? data : {};
    if (own.id) request.id = own.id;
    if (own.data && Object.keys(own.data).length) request.data = own.data;
    return { method: "POST", path: "/v1/run", body: JSON.stringify(request, null, 2) };
  }
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
