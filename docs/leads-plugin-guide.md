# Leads plugin: every screen, what it holds and why

Written from the code on 2026-11-11.

## Layout

- **Left menu:** Outreach (AI Assistant, Find Leads, Lists, Journeys, Mail), Inbound (Forms), Setup (Workflows, About your business), and Plan & credits.
- **Top bar:** page title, AI Assistant button, and the credits chip. Hover the chip for credits left, credits on hold, and credits used in the last 30 days and today. Admins can click it to open Plan & credits.
- **Locked:** with no plan and no credits, everything except Plan & credits is locked.

## 1. AI Assistant
**Holds:** a chat over the user's own account and the UK company register.
**Why:** say what you want instead of learning the filters.
- Searches the register or sizes an audience (free).
- Answers questions on pipeline, campaigns, replies, mailboxes, follow-ups, journeys, tasks and one named company (free).
- Offers to save results to a list, check a list, or search the web. These cost credits, so the price is shown and the user confirms.
- Drafts and edits journeys, and creates workflows from a sentence.
- Never states a company, email or number that a tool did not return.

## 2. Find Leads
**Holds:** the whole UK company register, best-filled profiles first.
**Why:** where new companies are found. Searching is free.
- **Filters:** company name, job title, industry keywords (include and leave out), location (town, postcode start), size from filed accounts, company type and age, closed companies, details held (website, phone, email), and your lists (any, not in my lists, in my lists). Sort by best match, newest or name.
- **Views:** Companies or People; List or Map. On the map, draw an area and choose how many companies to read.
- **Actions:** save, add to a list, favourite, save and call, hide. Bulk actions work on ticked rows. Fill in missing people for free. Find a named person's email (1 credit, only if found). Import a CSV or Excel file.
- **Company drawer (tabs):** Overview (contact details and find buttons), Research, Details (register facts), Notes, Activity.
- **Full company page (tabs):** Overview ("Why now" and who to speak to), People (org chart or list), Filings and money, Notes, Activity.

## 3. Lists
**Holds:** everything saved or imported. **Why:** the working area between found and emailed. Three tabs:
- **Lists:** each list with its company count, how many have a sendable email, and when it last changed. Rename, create, add, import, or call the list.
- **Companies:** one table of every saved company.
  - Quick filters: All, New data found, Ready to email, Fixes to review, Needs attention, Import warnings, No email found, plus call history (never called, no answer, interested, recent, warm).
  - Saved views, hideable columns.
  - Bulk actions: check and improve, apply fixes, add to a list and start a journey, delete.
  - **Check & improve** fills gaps from our records (free), the registers, the web, then a deep search. The price is shown first and only what is found is charged. The user's own values are never overwritten until they accept.
- **People:** every person at saved companies, searchable by name, title, company or email.

## 4. Journeys
**Holds:** a path of emails, calls and tasks per person. It stops for anyone who replies, books or opts out.
**Why:** the sending engine.
- **Left column:** every journey and its status (Draft, Running, Paused, Finished).
- **Buttons:** Start/Pause, Rules, Design, Ask AI.
- **Checks:** red items block Start (no people, no mailbox, no steps, no sender address).
- **Needs you:** due tasks and replies to read.
- **Steps:** Email, Call (needs Voice), Email to write yourself, Call task, Task, Social task, LinkedIn task (a reminder only). Each has a wait, a condition, merge fields, and an optional A/B version.
- **When emails go out:** sending hours and time zone, whether the window is open, pace and expected finish. This is an estimate.
- **People:** status per person (queued, in progress, replied, booked, finished, unresponsive, bounced, opted out) and next send time. Add from a list or paste them in.
- **Rules:** sending mailboxes, days, hours, daily limit, stop conditions, days of silence before "no answer", stages to skip, and whether people can be in other journeys.
- **Design:** branded emails (logo, colours, buttons). Without it, emails are plain text with a short footer.
- **Who gets in:** closed or wrong companies and addresses that cannot receive mail are kept out. Unchecked people and individuals with no consent recorded are allowed, with a notice that they are emailed at the sender's own risk.

## 5. Mail
Two pages.
- **Inbox and sent:** a mail client with Inbox, Sent, Drafts, Archive, Spam and Trash, plus Replies (sorted by meaning), Sent by campaigns, and Do not email. Compose, reply, forward, search, bulk actions.
- **Email accounts:** connect a mailbox (one.com, Google, Microsoft 365, Zoho, other) and test its login. Per mailbox: daily target, signature, aliases, pause, mark as already warmed, sent log. New mailboxes warm up with a small daily limit that rises weekly. SPF, DKIM, DMARC and MX checks come with plain instructions.

## 6. Forms
**Holds:** web forms that turn visitors into leads. **Why:** people come to you instead.
- **Tabs:** Fields (each can map to name, email, phone, company, website or job title), Settings (target list, allowed email domains and sites), Share (link or iframe), Answers.
- Every answer with a working email becomes a lead in the chosen list.

## 7. Workflows
**Holds:** "when X happens, do Y". One page shared with Voice and Social.
- **Leads triggers:** a reply (by kind), an email opened, a company saved, a campaign finished.
- **Conditions:** stage, industry, area, has email, has phone.
- **Actions:** set stage, add to list, plan a follow-up, notify, send an email, call a webhook, add to do-not-contact, add a note.

## 8. About your business
**Holds:** the company profile, shared across apps. **Why:** the AI writes from it, and the law needs the legal name and postal address in every cold email. Also holds tone, website, ICO reference, data protection contact, social links and a knowledge file.

## 9. Plan & credits
**Holds:** the Leads plan, credit tank, top-ups and usage by day, item and person. Plan credits expire at renewal; top-ups never expire. The app is open if there is a live plan or any credits left.

## Credit prices (defaults, editable by staff)

| Action | Credits |
|---|---|
| Search, view, save, lists, journey setup, checks against our own records | Free |
| Registry check, per company | 1 |
| Lead researched (website, phone or email by web search) | 5 |
| Deep web search | 5 |
| Social page found | 2 |
| Contact email found | 2.5 |
| Phone check | 1 per 5 numbers |
| Personalised email lines | 1 per 5 lines |
| Email sent | 1 |
