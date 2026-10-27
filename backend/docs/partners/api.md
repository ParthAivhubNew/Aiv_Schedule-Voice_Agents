# Partner API: connecting accounts and what you can call

> **Older integration path.** New partners show Outreach screens inside their software instead (see the [embedding guide](embed.md)). This direct
> API keeps working for integrations already built on it.

For partners whose users sign in to Outreach from the partner's own pages. Everything goes through one door:

```
POST /v1/run   Authorization: Bearer sk_live_…   (or sk_test_… for test mode)
{ "plugin": "social", "action": "channel.connect", "id": "…", "data": { … } }
```

`id` is needed only for actions that act on one thing. Every call is checked against the key's permissions (scopes), the
user's plan and credits, exactly as in the app. Writes can carry an `Idempotency-Key` header for safe retries.

## Connecting accounts from your own page

Three things must be connected before the matching calls work. Each connect action returns a link you open **in a popup**.
The user signs in on our page or the network's page, so **you never see a password or token**.

| Action | Plugin | Scope | Starts | Ends with |
|---|---|---|---|---|
| `channel.connect` | social | `social:write` | the network's own sign-in (LinkedIn, Facebook, Instagram, X, Threads) | `?status=connected\|error&provider=&channel_id=` |
| `mailbox.connect` | leads | `email:write` | our page where the user enters their mailbox login | `?status=connected&provider=mailbox&mailbox_id=` |
| `meeting_provider.connect` | voice | `calendar:book` | Google, Microsoft or Zoom sign-in | `?status=connected\|error&provider=&account=` |

How it works for all three:

1. Call the action with `return_url` (and `provider` where it applies). The `return_url` must **exactly match** one of your
   registered return URLs, and its web address must also be one of your allowed web addresses. Otherwise: `422`.
2. You get back `auth_url` (or `connect_url` for a mailbox) and `expires_at` (30 minutes). Open it in a popup.
3. When the user finishes, the popup sends a message to the page that opened it and goes to your `return_url` with the
   result in the query string. The message is addressed only to the return URL's own web address. Its `type` is
   `outreach.channel`, `outreach.mailbox` or `outreach.meeting_provider`.
4. Refresh your screen with the matching list action.

Only keys issued through the partner programme can start these. A key made by hand in the app gets `403 partner_only`.

### Social

| Action | Input | Output |
|---|---|---|
| `channel.providers` | none | `{providers: [{provider, label, available}]}`; `available` is false when we have not set that network up yet |
| `channel.connect` | `provider`, `return_url` | `{auth_url, state, expires_at}` |
| `channel.list` | none | `{channels: [{id, provider, display_name, status, connected_at}]}`; status is `connected`, `needs_reauth` or `error` |
| `channel.disconnect` | `id` | `{ok: true}` |

Posting to a network that is not connected fails with `422 channel_not_connected`; the response names `connect_action: "channel.connect"`.

### Mailboxes

| Action | Input | Output |
|---|---|---|
| `mailbox.list` | none | the mailboxes with status, whether each can send, and why not |
| `mailbox.connect` | `return_url`, optional `email` (open the page for that address only) | `{connect_url, expires_at}` |
| `mailbox.get` | `id` | one mailbox in full: status, blockers, SPF/DKIM/DMARC/MX results and the records to add. No secrets |
| `mailbox.check_dns` | `id` | the same, after re-checking the records |
| `mailbox.warmup` | `id`, `data.action`: `start`, `pause` or `skip` | the mailbox. `start` needs SPF and DKIM to be in place |
| `mailbox.disconnect` | `id` | `{ok: true}` |

A new mailbox cannot send campaigns until its SPF and DKIM records exist and warm-up has started (or been skipped for a
mailbox that is already warm).

### Video meeting accounts (Google Meet, Microsoft Teams, Zoom)

Optional. Meetings book without one; they just get no video room.

| Action | Input | Output |
|---|---|---|
| `meeting_provider.list` | none | `{providers: [{provider, label, configured, connected, account, error}]}` |
| `meeting_provider.connect` | `provider` (`google`, `microsoft`, `zoom`), `return_url` | `{auth_url, expires_at}` |
| `meeting_provider.disconnect` | `id`: the provider name | `{ok, was_connected}` |

## Social results (plugin `social`, scope `social:write`)

| Action | Input | Output |
|---|---|---|
| `insights.get` | `data`: `days` (7, 30 or 90), optional `channel` and `account` (comma-separated lists) | totals and changes, `byChannel`, the daily series, best posts (one entry per post), best times, followers and `lastSyncedAt` |
| `post.results` | `id` of a post | its numbers per network, `asOf` (when they were last read), leads, meetings, tracked link clicks |
| `post.results_link` | `id` of a post | `{link, expires_at}`: a page anyone can open, no sign-in, that shows the latest numbers |
| `report.create` | `name`, `days`, optional `channels`, `recipients`, `frequency` (`none`, `weekly`, `monthly`), `intro` | `{report, link, expires_at}` |
| `report.list` | none | the reports |
| `report.link` | `id` of a report | a fresh `{link, expires_at}` |
| `report.send` | `id`, optional `data.to` (emails) | `{sent, failed}` |
| `report.delete` | `id` | `{ok: true}` |

**How fresh the numbers are:** they are read back from each network every 6 hours (X once a day), for posts up to 90 days old
(X up to 30). Every number is "as of" the time it was last read, which is why results carry `asOf` / `lastSyncedAt`. A link
shows whatever has been read when it is opened; an email is a copy made when it was sent. Both say which. Links work for
**120 days**, and the page and emails state the date.

## Lists, contacts and email lookup (plugin `leads`, scope `leads:search`)

| Action | Input | Output |
|---|---|---|
| `list.list` | none | `{lists: [{id, name, ids, created_at}]}` |
| `list.create` | `name`, optional `ids` | `{list}` |
| `list.edit` | `id`, `name?`, `add?`, `remove?` (lead ids) | `{list}` |
| `list.delete` | `id` | `{ok: true}`; the leads stay saved |
| `company.contacts` | `id` of a company from `search.get`, `include_web?` | the people on the official record (free), what we hold, and with `include_web` a website and phone found on the web (1 Leads credit, only when found) |
| `email.find` | `first_name`, `last_name`, `company_name?`, `domain` | the person's work email and how it was checked. 1 Leads credit when one is found, nothing when not |

`search.create` already finds companies, their officers and checks them in one job (`contacts`, `checks`), and `call.start`
takes up to 25 numbers at once.

## Calls: summaries and transcripts (plugin `voice`, scope `voice:calls`)

`call.get` already returns the transcript, the answers to your questions, the outcome and a `recording_url`. `call.summary`
(`id`) writes the AI summary of a call, so far if it is still running, and returns `{summary}`.

## Company knowledge (plugin `account`, scope `company:write`)

`company:write` comes with the Voice, Leads and Social permissions. It edits the same record as the app's "About your business".

| Action | Input | Output |
|---|---|---|
| `profile.get` | none | name, pitch, tone, time zone, calling hours, what the AI says on calls |
| `profile.update` | any of `name`, `spokenName`, `pitch`, `industry`, `website`, `social`, `tone`, `disclosure`, `legalName`, `icoRef`, `dpoContact`, `dncNotes`, `timezone`, `weekStart`, `timeFormat`, `approverEmails`, `lunchStart`, `lunchEnd`, `callHoursPolicy`, `weekdayStart`, `weekdayEnd`, `callOpener`, `callHook`, `closingAsk`, `customRules`, `demoScript` | the profile. Other fields, including the caller ID, are refused with `422 unknown_field` |
| `services.get` / `services.set` | `set`: `services: [{name, desc, ideal}]` | the list. `set` **replaces** the whole list (up to 100) |
| `faqs.get` / `faqs.set` | `set`: `faqs: [{q, a}]` | the list. `set` **replaces** the whole list (up to 100) |

## Email campaign results (plugin `leads`, scope `email:write`)

| Action | Input | Output |
|---|---|---|
| `campaign.results` | `id` of a campaign | `totals` and `by_step` (each with `sent`, `opened`, `replied`, `bounced`, `failed` and the rates), `reply_categories` and `as_of` |
| `reply.list` | optional `data.category` | the replies: who, what they said, the campaign, how it was sorted |
| `reply.categorize` | `id` of a reply, `data.category`: `interested`, `question`, `not_interested`, `ooo` or `unsubscribe` | `{ok}`. `unsubscribe` also stops all further email to that person |
| `suppression.list` / `suppression.add` / `suppression.remove` | `add`: `data.email` (an address or a domain); `remove`: `id` | the do-not-email list, which no campaign will email |

Opens are counted when an email's tracking picture loads. Some mail apps block it, so **opens are a minimum, never an exact count**.

## Media and Plan AI (plugin `social`, scope `social:write`)

| Action | Input | Output |
|---|---|---|
| `media.upload` | `content_type`, `content_base64`, optional `filename`, `alt`, `tags` | the library item with a full `url`. Pictures: PNG, JPG, WebP. Videos: MP4, MOV. Size limits are the app's |
| `media.import_url` | `url` (public https) | the library item |
| `media.list` | optional `kind` (`image`, `video`), `q` | the library, newest first |
| `media.delete` | `id` | `{ok}`. Posts that already use the file keep working |
| `plan.create` | `prompt`, `channels`, optional `pinned_dates` | `{reply, range, posts: [{date, time, channel, headline, angle}]}`. Only an outline: nothing is created or written |
| `plan.apply` | `posts` (up to 30, from `plan.create`, edited if you like), optional `tone`, `approvers` | `{data: [posts], failed: [...]}`. Each post is written by the AI and waits for approval, like any post made through the API |

To use an uploaded picture, send its `url` as `image: {mode: "url", url}` in `post.create`.

## WhatsApp (plugin `whatsapp`, scope `voice:calls`, Voice plan)

Runs the app's own WhatsApp inbox, so its rules apply: you can reply freely within 24 hours of the person's last message, and
after that, or to start a conversation, only an approved template is accepted (`window_closed`).

| Action | Input | Output |
|---|---|---|
| `numbers` | none | your numbers and whether WhatsApp is on for each |
| `threads.list` | none | conversations with unread count, preview and `windowOpen` |
| `threads.get` | `id` | the messages. Reading marks it read |
| `threads.send` | `id`, `data.text` or `data.template` (`name`, `language`, `params`) | the message |
| `threads.start` | `our_number`, `contact_number`, `contact_name?`, `template` | the conversation |

The `whatsapp.message.received` webhook says when someone writes.

## Voice scripts and voices (plugin `voice`, scope `voice:calls`)

| Action | Input | Output |
|---|---|---|
| `script.get` | `id` | the script in full |
| `script.create` | `name`, `greeting_template`, `value_prop_template`, and optionally `description`, `call_direction`, `permission_check_template`, `objection_responses`, `booking_transition_template`, `confirmation_template`, `closing_template`, `custom_rules`, `flow_steps`, `agent_persona`, `tone_instructions`, `make_live` | `{template_id}`. Anything left out is copied from the standard script |
| `script.edit` | `id` and the fields to change | the script's id. Send only what changes |
| `script.delete` | `id` | `{ok}`. The standard scripts cannot be deleted |
| `voice.list` | none | the voices and which is used for calls now |
| `voice.use` | `kind` (`builtin` or `library`), `ref` | the voice list |

A new script is **saved, not live**. `make_live: true` makes it the script the AI uses on calls straight away, replacing the one in
use, so ask the user first. Use a script by sending its id as `script_id` in `call.start`.

## Phone numbers (plugin `numbers`, scope `voice:calls`, Voice plan)

| Action | Input (`data`) | Output |
|---|---|---|
| `connect` | `return_url` (one of your registered return URLs) | `{connect_url, expires_at}`. Open `connect_url` in a popup: the user searches, buys and uploads the business documents on our page, and it ends at your `return_url` with `?status=connected&provider=number&number_id=`. Partner keys only. The popup also posts `{type: "outreach.number", status, number_id}` to the opener. Listen for `number.ready` and `number.verification_changed` for the real outcome |
| `list` | none | `numbers`, `orders`, `verification` and `price` (`monthlyCredits`, `setupCredits`) |
| `search` | `country`, `number_type`, optional `locality`, `area_code`, `contains` | `{data: [{phone_number, region, features, monthly_credits}]}` |
| `order` | `phone_number`, `country`, `number_type` | the order; poll `list` or wait for `number.ready` |
| `release` | `id` of the number | `{ok: true}` |
| `verification.requirements` | `country`, `number_type` | the fields and documents that country asks for |
| `verification.submit` | `country`, `number_type`, `entity_type`, `texts`, `addresses`, `documents` | the verification and its status |
| `verification.status` | optional `country`, `number_type` | `{verification}` |
| `check.estimate` | `items`: `[{key, phone, names?}]` | what checking would do and cost, before anything is spent |
| `check.run` | `items` | one answer per number (real? mobile or landline? on the do-not-call list?), a summary and `credits_charged`. 1 credit per 5 numbers that got an answer; numbers that could not be checked are not charged |

- `documents` is `{field: {filename, content_type, content_base64}}`.
- Prices are in the user's credits. Ordering fails if credits are short.
- Only numbers bought through Outreach are supported through the API.
- Test keys return simulated numbers, and `verification.submit` returns an approved verification at once. `connect` with a test key
  goes straight to your `return_url` with `number_id=num_test`.
- `account.wallet` → `connected.phone_number_status` counts `active`, `held`, `pending` (orders being set up),
  `verification_pending` and `verification_rejected`.
- To call from a given number, send `from_number` in `call.start`. Without it the user's default number is used.

## Webhooks

One address per partner. Each delivery is signed: `X-Outreach-Signature: t=<unix time>,v1=<hex HMAC-SHA256>` over
`t=<time>.` plus the raw body, using your webhook secret. Also sent: `X-Outreach-Event` and `X-Outreach-Delivery`.
Every payload carries `org_id`.

| Event | When |
|---|---|
| `social.channel.connected` | a network was connected (`provider`, `channel_id`) |
| `social.channel.disconnected` | a network was removed |
| `social.channel.needs_reauth` | a network's login stopped working and the user must reconnect. Sent once, when it first breaks |
| `email.mailbox.connected` | a mailbox was connected (`mailbox_id`, `email`) |
| `email.mailbox.disconnected` | a mailbox was removed |
| `email.mailbox.needs_reauth` | the mailbox's login started failing. Sent once, when it first fails |
| `meeting.provider.connected` / `.disconnected` / `.needs_reauth` | the same, for Google, Microsoft and Zoom (`provider`) |
| `number.ready` | a bought number is active (`number`, `number_id`) |
| `number.verification_changed` | business verification became `approved`, `declined` or `expired` (`status`, `reason`) |
| `number.status_changed` | an active number was held by the carrier, or came back (`number`, `status`) |
| `post.ready`, `post.approved`, `post.rejected`, `post.published` | social posts |
| `campaign.ready`, `campaign.approved`, `campaign.completed`, `campaign.reply` | email campaigns |
| `leads.ready` | a lead search finished |
| `meeting.booked` | a meeting was booked |
| `call.completed`, `call.needs_human` | calls |
| `whatsapp.message.received` | a person wrote on a WhatsApp number (`thread_id`, `contact_number`, `our_number`, `contact_name`, `preview`) |

## Test keys

With `sk_test_…` every connect action returns a simulated result straight to your `return_url`, the list actions return
sample accounts, and nothing real is connected, sent or charged.

## Common errors

| Status | Code | Meaning |
|---|---|---|
| 401 | `invalid_api_key` | the key is wrong, revoked or expired |
| 403 | `missing_scope` | the key lacks the permission named in the response |
| 403 | `partner_only` | the action is only for keys issued through the partner programme |
| 402 | `service_not_subscribed` | the user has no plan for that plugin |
| 422 | `return_url_not_allowed` | the `return_url` is not on your registered list |
| 422 | `return_url_origin_not_allowed` | the `return_url`'s web address is not one of your allowed web addresses |
| 422 | `channel_not_connected` | connect the network first (`channel.connect`) |
| 429 | | slow down: 120 calls a minute, 30 writes a minute per key |
