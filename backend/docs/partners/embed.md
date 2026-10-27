# Embedding Outreach in your software

Show Outreach's screens (Leads, Campaigns, Mail, Voice, Social) inside your own product, in your colours. You choose the
layout in your code: inline, popup, side panel or full page. Your users sign in to Outreach, or create an account, without
leaving your product, and you never see their password.

This is the way to integrate from now on. The older direct API (`POST /v1/run`, see the [API reference](api.md)) keeps working for
integrations built on it; new integrations should use screens.

- [How it fits together](#how-it-fits-together)
- [Quick start](#quick-start)
- [Keys and web addresses](#keys-and-web-addresses)
- [Your server: ask for a token](#your-server-ask-for-a-token)
- [Your page: show a screen](#your-page-show-a-screen)
- [Connecting your users](#connecting-your-users)
- [The screens](#the-screens)
- [Look and feel](#look-and-feel)
- [Data and privacy](#data-and-privacy)
- [Billing](#billing)
- [Security](#security)
- [Errors](#errors)
- [Go-live checklist](#go-live-checklist)
- [Try it locally](#try-it-locally)
- [Deploying this (for the Outreach team)](#deploying-this-for-the-outreach-team)
- [What is not there yet](#what-is-not-there-yet)

## How it fits together

```
 your page                     your server                      Outreach
 ─────────                     ───────────                      ────────
 outreach.create("leads")
   └─ getToken() ──────────────▶ POST /api/embed/sessions ─────▶ checks secret key and link
                               ◀──────────── token (15 min) ◀──┘
   └─ iframe /embed/leads  ───────────────────────────────────▶ checks token + your web address may frame it
        every request carries the token; it reaches only the Leads screen's data, for that one account
```

1. A person in your product is linked to an Outreach account (once; see [Connecting your users](#connecting-your-users)).
2. When your page wants to show a screen, it asks **your server** for a token. Your server asks Outreach with your secret key.
3. The page gives the token to the screen. The screen lives in an iframe on Outreach's own address, so the browser keeps it
   separate from your page.
4. The token works for that one account and that one screen, for 15 minutes. The page asks your server again when it ends.

## Quick start

1. Apply to the partner programme and accept the terms (Admin APIs & Webhooks → Partner programme).
2. Add the web addresses of the pages that will show Outreach, for example `https://app.yourproduct.com`.
3. Make a secret key. Keep it on your server.
4. Link a user ([below](#connecting-your-users)), then add the server endpoint and the page code.
5. Test in the sandbox: test keys, fake credit, nothing real is sent or charged.
6. Ask to go live.

## Keys and web addresses

| | What | Where it goes |
|---|---|---|
| Publishable key `pk_…` | Names your integration. Not secret. | Your web page |
| Secret key `psk_test_…` / `psk_live_…` | Lets your server ask for tokens and look up links. Shown once when made. | **Your server only**. Never in a web page or app |

- A sandbox integration gets `psk_test_` keys, a live one `psk_live_` keys. When you go live, make a new key.
- Making a new key stops the old one at once.
- **Web addresses**: only these may show Outreach screens in a frame, and only they may call Outreach from a browser. Each is a
  full address with no path (`https://app.yourproduct.com`). `www` and the bare domain are two addresses. A page on any other
  address sees an empty frame ("refused to connect") because the browser refuses.

## Your server: ask for a token

```
POST https://YOUR-OUTREACH-HOST/api/embed/sessions
Authorization: Bearer psk_…
Content-Type: application/json

{ "external_id": "user-42", "component": "leads", "access": "full", "ttl_seconds": 900 }
```

| Field | | |
|---|---|---|
| `external_id` | one of these two | your id for the person (set when you linked them) |
| `link_id` | one of these two | the link id, if you stored it |
| `component` | required | `leads`, `campaigns`, `mail`, `voice` or `social` |
| `access` | optional | `full` (default) or `view` (reads only; nothing can be changed) |
| `ttl_seconds` | optional | 60 to 3600. Default 900 |

Answer: `{ "token": "…", "expires_at": 1767225600, "component": "leads", "access": "full", "link_id": "plink_…" }`

- Call this **from your server**. A request that carries a browser `Origin` header is refused (`403`), so the secret key can never
  be used from a web page.
- A user who is not linked, or whose link was revoked, gets `404`.
- Do not store tokens. Ask when the page needs one.

## Your page: show a screen

```html
<script src="https://YOUR-OUTREACH-HOST/embed.js"></script>
<script>
  const outreach = Outreach("pk_…");                       // optional second argument: { host }

  const getToken = () =>                                   // asks YOUR server (which calls Outreach)
    fetch("/my-server/outreach-token?component=leads").then(r => r.json()).then(d => d.token);

  outreach.create("leads", { getToken }).mount("#box");                                        // inline
  outreach.create("campaigns", { getToken }).open({ mode: "modal" });                          // popup
  outreach.create("voice", { getToken }).open({ mode: "drawer", side: "right" });              // side panel
  outreach.redirect("mail", { getToken });                                                     // full page
</script>
```

### `outreach.create(screen, options)`

| Option | |
|---|---|
| `getToken` | Function returning a token, or a promise of one. Preferred: it is called again when the token ends. |
| `token` | A token string, if you cannot use `getToken`. It cannot be renewed. |
| `appearance` | See [Look and feel](#look-and-feel). Use `"auto"` to match your page. |
| `height` | Inline height. Default `640px`. |
| `onReady(info)` | The screen has loaded. |
| `onError({ message })` | The screen or your token request failed. |
| `onSessionEnded()` | The session ended and could not be renewed (the account was disconnected, or your server refused a new token). |
| `onClose()` | The popup or panel was closed. |
| `onEvent({ name, data })` | Reserved for events from inside the screen. |

Methods on the object it returns:

| Method | |
|---|---|
| `.mount(selectorOrElement)` | Inline: the screen sits inside your element. |
| `.open({ mode, side, width, height })` | `mode: "modal"` (a centred panel, up to 1100 px wide) or `"drawer"` (`side: "right"` or `"left"`). Esc, the × button, or a click outside closes it. Focus returns to where it was. |
| `.close()` | Closes a popup or panel, or removes an inline screen. |
| `.update({ appearance })` | Changes the look without reloading the screen. |
| `.destroy()` | Closes it and stops listening. |

### `outreach.redirect(screen, { getToken | token, appearance, newTab })`

Replaces your page with the screen (or opens a new tab with `newTab: true`). The token travels in the address fragment
(`#token=…`), which is never sent to any server, and the screen removes it from the address bar at once. A full-page screen cannot
renew its token: it ends after the token's lifetime, so give full pages a longer `ttl_seconds`.

### Messages (if you do not use `embed.js`)

The screen and your page talk with `postMessage`. Our side sends `{ source: "outreach-embed", type }` with types `ready`,
`ready-ui`, `token-needed`, `connected`, `session-ended`, `error`. Your side answers `{ source: "outreach-loader", type: "init",
token | connectToken, appearance }` and `{ type: "token", token }`. `embed.js` does all of this; use it unless you must not.

## Connecting your users

A screen shows an Outreach account's data, so each of your users needs a **link** to an Outreach account. There are three cases.

| Case | Who | Who pays | How the link is made |
|---|---|---|---|
| **Existing account** | The person already has Outreach | Their own credits | They sign in to Outreach inside the connect screen and agree. |
| **New account** | The person has no account | Free while the programme is free | They create one in the connect screen; it belongs to your integration. |
| **Direct** | They use Outreach on its own | Their own credits | Nothing changes. No link. |

### The connect flow

1. **Your server**: is this person linked?
   ```
   POST /api/embed/connect-sessions      Authorization: Bearer psk_…
   { "external_id": "user-42", "component": "leads" }
   ```
   - `{ "linked": true, "link_id": "plink_…", "mode": "existing" | "partner_created" }`: already linked. Ask for a token.
   - `{ "linked": false, "connect_token": "…", "expires_at": … }`: show the connect screen.
2. **Your page**:
   ```js
   outreach.connect({ connectToken, onConnected: ({ linkId, externalId, mode }) => { … } }).open({ mode: "modal" });
   ```
   The connect screen asks the person to sign in (or create an account) and to agree to what you can do, in words that match the
   screen. When they agree it links them and opens the screen they asked for.
3. **Later**: `GET /api/embed/links/{external_id}` (server only, secret key) returns the link, or `404`.
4. **An API key for `/v1/run`** (to use the same account from your server without the embed):
   ```
   POST /api/embed/links/{external_id}/key      Authorization: Bearer psk_…
   ```
   Returns `{ "api_key": "sk_…", "key_mode": "test" | "live", "link_id": … }`. Server only: a call with an `Origin` header is
   refused, so the key never passes through a browser. The key is shown once and has the scopes your programme was approved
   for. Calling it again issues a new key and the old one stops working. Disconnecting the link deletes the key. `404` if the
   user is not linked.

Rules that protect your users:

- **Only the account's admin can connect it.** A team member who is not an admin is told to ask the admin.
- **An email address is never enough.** The person proves they own the account with its password, inside our page, and agrees.
- **One Outreach account, one of your users.** If the account is already linked to a different user of yours, the connect is
  refused (`409`) until that link is disconnected.
- **One of your users, one Outreach account.** The same external id cannot be linked to a second account.
- **One account can work through several partners.** Each link is separate: its own agreement, its own tokens. Disconnecting one
  leaves the others working.
- If email confirmation is on, a new account is usable once the person follows the email link; the connect screen says so.

### Ending a link

- You: `DELETE /api/partner/links/{link_id}` (Admin APIs & Webhooks → Partner programme → Disconnect).
- The user: Admin APIs & Webhooks → Partner programme → "Software connected to your account" → Disconnect.
- Outreach: pausing your integration stops every token and secret key you hold.

All live tokens for the link stop working within about 5 seconds (see [Security](#security)).

## The screens

| Screen | Shows | May change | May only read |
|---|---|---|---|
| `leads` | Find Leads, My lists | leads, lists, enrichment | email data |
| `campaigns` | My lists, Email campaigns, Email accounts | leads and email | |
| `mail` | Mail, Email accounts | email | leads data |
| `voice` | Call list, Conversations, Meetings & callbacks | calls, call lists, meetings | leads data |
| `social` | Post calendar, Approvals, Results & Ideas, Library, Accounts | posts and social accounts | agenda, company sources |

- The screens are the same app people use on Outreach, with the menu cut down to the pages above and without Home, switching
  apps, credits or Log out: those belong to your product.
- `access: "view"` makes a token read-only everywhere.
- A token reaches only the paths in the table. Anything else (billing, users, keys, other screens, the admin API) is refused with
  `403 embed_scope`.
- An account with no plan or credits for an app sees "… is not on this account yet". Plans are bought on Outreach itself.

## Look and feel

```js
outreach.create("leads", {
  getToken,
  appearance: { variables: { colorPrimary: "#0f766e", colorBackground: "#f4f1ea", colorText: "#1c1917", fontFamily: "serif", borderRadius: 10 } },
});
```

| Variable | Value | Changes |
|---|---|---|
| `colorPrimary` | `#rgb` or `#rrggbb` | Buttons, selected items, highlights (and their lighter and darker shades) |
| `colorBackground` | hex | Page background |
| `colorSurface` | hex | Cards and panels |
| `colorText` | hex | Text (the lighter greys are derived from it) |
| `colorDanger` | hex | Errors |
| `colorSidebar` | hex | The side menu's background. Its hover, selected and line colours are worked out from it. |
| `colorSidebarText` | hex | The side menu's text. Left out, it is white or dark grey, whichever is readable on the menu colour. |
| `fontFamily` | `system`, `inter`, `serif`, `rounded`, `mono` | The font |
| `borderRadius` | 0 to 24 | Corner roundness of cards and fields |
| `brandName` | up to 40 characters | Replaces the app's name above the menu ("Leads", "Voice"...). `<` and `>` are removed. |
| `logoUrl` | an `https` address of a picture | Replaces the app's icon above the menu. If you leave it out, the logo saved on your integration is used. |

- **Save a default** in Partner programme, Look and feel, which has a live preview. A page's own `appearance` wins over it.
- Only these keys and values are read. Anything else (a colour name, a URL that is not `https`, a font you invented) is ignored, so a
  theme can never inject styles or scripts. The dashboard refuses a bad value instead of quietly dropping it.
- Status colours and charts keep their own so they stay readable. Some parts of the app draw their own colours (for example each
  app's icon badge); your colours reach everything that uses the app's palette, which is most of it.
- Change it live with `screen.update({ appearance })`.
- There is no dark theme yet (see [What is not there yet](#what-is-not-there-yet)).

### Match my software (automatic)

Instead of choosing colours, let the screen read your page and match it:

```js
outreach.create("leads", { getToken, appearance: "auto" }).mount("#box");

// When the guess is not right, say where to look. Anything you set yourself wins.
outreach.create("leads", {
  getToken,
  appearance: {
    auto: { primary: "--brand-color",   // a CSS variable on your page, or a selector such as ".btn-primary"
            danger: "--error",          // a CSS variable
            sidebar: "#app-sidebar" },  // the selector of your own side menu
    variables: { borderRadius: 12 },    // your values win over what was read
  },
});
```

`embed.js` runs in your page, so it can read it; the screen (on Outreach's address) cannot. What it reads:

| Taken from | Used for |
|---|---|
| The CSS variable you name, else common names (`--primary`, `--brand`, `--accent`, `--color-primary`, `--bs-primary`...), else the colour of the element you name, else the first coloured button, else a link | Buttons and highlights |
| The same button (or the first input) | Corner roundness |
| The page body | Background and text |
| The body's font | The nearest of our five fonts. We cannot load a font from your site. |
| `--danger`, `--error`, `--destructive`... or the variable you name | Errors |
| The element you name, else the first `<aside>` or `<nav>` with a solid colour | The side menu |

- **It keeps following the page.** When your page's theme class, `data-theme` or colour scheme changes, the screen is updated a
  moment later.
- **Dark pages:** the screens have no dark theme yet, so on a dark page the screen keeps its own light background and text and
  only takes the button colour, corners, font, error colour and side menu from you.
- **It is a guess when you name nothing.** Naming the CSS variable or the element makes it exact.
- Grey buttons are ignored when looking for your brand colour, and a colour it cannot read is skipped.

## Data and privacy

- A link gives you what the person agreed to, for the screens you show. You do not get their password, and you do not get
  Outreach's own data about companies (its enrichment and supplier data stays inside the screens).
- The data a person creates in a screen belongs to their Outreach account: lists, campaigns, call recordings and transcripts,
  replies. It stays theirs if they disconnect.
- A screen only ever reads the one account its token names. Accounts are isolated from each other in the database, not just in
  the application.
- Disconnecting ends your access immediately. It does not delete the account or its data.
- Usage caused through your screens is recorded against your integration, so you can see it in the dashboard
  (credits used per account in the last 30 days).

## Billing

What works today:

- An **existing** account uses its own Outreach credits and plan, always.
- A **new** account made through your connect screen is free while the partner programme is free.
- Each credit line records who used it (`org_id`), who was charged (`payer_org_id`) and, when it came from your screen, your
  integration (`partner_id`). The dashboard shows credits used per linked account over 30 days.

Not built yet: charging **your** credit for your users' usage, and topping up a partner wallet. Until then, new accounts are
free and existing accounts pay for themselves.

## Security

- **Framing**: Outreach serves screens at `/embed/…` with `Content-Security-Policy: frame-ancestors` set to **your web
  addresses only**. The browser refuses any other site that tries to frame them. Outreach's API responses keep their existing
  frame block. The rule for screens is set by the web server from your integration's settings, so adding or removing an address takes effect on the next page load.
- **Tokens** are signed, last 15 minutes by default (60 s to 1 h), belong to one link and one screen, and cannot be used in a URL.
  They live only in the screen's memory, never in storage.
- **Revoking** (disconnect, pausing the integration, suspending the account) stops live tokens within about 5 seconds. Tokens are
  also checked against the link on every cache refresh, not only when they are minted.
- **Secret key**: server only, stored hashed. Requests that carry a browser `Origin` are refused, so a key leaked into a web page
  is still no use from the browser.
- **Passwords** are typed into Outreach's own page only. Your software never sees one.
- **Handshake**: a screen only accepts its token from the page that frames it, and the browser only allows your own addresses
  to frame it.
- **No wildcard CORS** for these calls: the screens run on Outreach's own address, so their calls are same-origin.

## Errors

Errors from `/api/embed/…` use HTTP status and `detail`. Common ones:

| Status | Meaning |
|---|---|
| `401` Invalid secret key | Wrong, old (rotated) or test key on a live integration (or the other way round) |
| `403` Create embed sessions from your server | The call came from a browser. Call it from your server. |
| `403` embed_scope | A screen's token asked for something outside its screen |
| `403` admin_required | The person who tried to connect is not an admin of the account |
| `404` That account is not connected to you | No active link for that user |
| `409` already linked | The account (or the user) is already linked to someone else; disconnect first |
| `422` consent_required | The person did not agree |
| `422` component / access | Not one of the allowed values |
| `429` | Too many requests; slow down (`Retry-After` is set) |

## Go-live checklist

- [ ] Terms accepted
- [ ] Every page that shows Outreach is in the web address list, over `https`
- [ ] A secret key is on your server only, and not in any page, repository or log
- [ ] You tested linking an existing account **and** creating a new one
- [ ] You tested a token ending (set `ttl_seconds: 60`) and a user being disconnected while a screen is open
- [ ] Your page shows a clear message from `onError` and `onSessionEnded`
- [ ] You show your users what you can access (the connect screen already does) and never ask for their Outreach password
- [ ] You asked to go live, then made a **live** secret key

## Try it locally

`tools/embed_demo` is a stand-in for a partner's software: a page with a button for each layout and a theme panel, plus a tiny
server that holds the secret key and asks for tokens.

```
OUTREACH_HOST=http://localhost:5173 OUTREACH_CLIENT_ID=pk_… OUTREACH_SECRET=psk_test_… python tools/embed_demo/server.py
```

Open `http://localhost:5174` (add that address to your web addresses first). `TOKEN_TTL=60` shortens tokens so you can watch
renewal.

## Deploying this (for the Outreach team)

- **Migrations** (additive, run on start): `partners.secret_hash/secret_prefix/theme`, `partner_links.external_id`,
  `credit_ledger.partner_id/payer_org_id`.
- **nginx** (`frontend/nginx.conf`) must have the `auth_request` module (the stock `nginx:alpine` image does). `/embed/…`
  asks the backend at `/api/embed/frame-policy`, which answers with the partner's `frame-ancestors`. If that call fails, nginx
  returns an error for the page: it never falls back to an open policy.
- The frontend build now has a third page, `embed.html`, and a static `embed.js`. Both are in `dist` after `npm run build`.
- The 5-second revoke window is per backend process. With more than one worker, a revoke can take up to 5 seconds on each.
- The main app's own pages are not given a `frame-ancestors` rule by this change. Adding `frame-ancestors 'self'` to the `/`
  location would also protect the sign-in page from being framed; it was left out because it changes existing behaviour.

## What is not there yet

- **Dark theme.** Parts of the app draw their own light colours, so a dark theme would look broken. Colours, font and corners work.
- **Charging a partner for its users' usage**, and partner wallet top-ups.
- **A webhook when a link is made.** Use the `onConnected` callback or `GET /api/embed/links/{external_id}`.
- **Live call monitoring in embedded Voice** (it needs a WebSocket, which tokens do not use). Calls, conversations, meetings
  and the AI caller work.
- **Events from inside a screen** (`onEvent`): the channel exists, no events are sent yet.
- **Stamping background work** (a call finishing later) with your integration. Those lines record the payer but not the partner.
- **Removing Outreach's name** from the screens.
