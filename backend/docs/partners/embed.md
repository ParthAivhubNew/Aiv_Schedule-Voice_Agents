# Embedding reference

Everything about showing Outreach's screens (Leads, Campaigns, Mail, Voice, Social) inside your product. Your users sign in to
Outreach, or create an account, without leaving your pages, and you never see their password.

> **New here?** Read [Get started](start.md) first. It is seven short steps. This page is for looking things up afterwards.

> **Just want it working?** The one-tag way needs no JavaScript: one script line with `data-key` and `data-pass`, then
> `<div data-outreach="leads"></div>` where the screen should show. See [Copy-paste code](snippets.md). This page covers the longer
> `Outreach(...)` calls, for when you want events, your own colours or full control.

This is the way to integrate from now on. The older direct API (see the [API reference](api.md)) keeps working for integrations
already built on it.

## How it fits together

Three parties: your page, your server, and Outreach.

```
 your page                     your server                      Outreach
 ─────────                     ───────────                      ────────
 outreach.create("leads")
   └─ getToken() ──────────────▶ POST /api/embed/sessions ─────▶ checks your secret key and the link
                               ◀──────────── token (15 min) ◀──┘
   └─ opens the screen ───────────────────────────────────────▶ checks the token and your web address
```

1. One of your users is **linked** to an Outreach account. You do this once per user ([Connect your users](#connect-your-users)).
2. When your page wants to show a screen, it asks **your server** for a **token**. Your server asks Outreach with your secret key.
3. The page hands the token to the screen. The screen runs on Outreach's own address inside an iframe, so your page cannot read it.
4. The token works for one account and one screen, for 15 minutes. The page asks your server again when it runs out.

## Keys and web addresses

| | What it is | Where it goes |
|---|---|---|
| Publishable key `pk_…` | Names your integration. Not secret. | Your web page |
| Secret key `psk_test_…` or `psk_live_…` | Lets your server ask for tokens. Shown once, when you make it. | **Your server only.** Never a web page or app |

- While you are testing you get `psk_test_` keys. After you go live, make a new key and it is a `psk_live_` one.
- Making a new key stops the old one at once. Update your server straight after.
- **Web addresses** are the pages allowed to show Outreach. Each is a full address with no path, such as `https://app.yourproduct.com`.
  `www` and the bare domain count as two addresses. A page on any other address shows an empty box ("refused to connect").

## Your server: ask for a token

```
POST https://outreach.aivhub.com/api/embed/sessions
Authorization: Bearer psk_…
Content-Type: application/json

{ "external_id": "user-42", "component": "leads", "access": "full", "ttl_seconds": 900 }
```

| Field | Needed? | What it is |
|---|---|---|
| `external_id` | One of these two | Your own id for the person, the one you used when you linked them |
| `link_id` | One of these two | The link's id, if you stored it |
| `component` | Yes | The screen: `leads`, `campaigns`, `mail`, `voice` or `social` |
| `access` | No | `full` (the default) or `view` (read only, nothing can be changed) |
| `ttl_seconds` | No | How long the token lasts, 60 to 3600. Default 900 (15 minutes) |

The answer: `{ "token": "…", "expires_at": 1767225600, "component": "leads", "access": "full", "link_id": "plink_…" }`

- Call this **from your server**. A call that carries a browser `Origin` header is refused (`403`), so your secret key can never be used from a web page.
- A user who is not linked, or whose link was ended, gets `404`.
- Do not store tokens. Ask for a new one when the page needs one.

## Your page: show a screen

```html
<script src="https://outreach.aivhub.com/embed.js"></script>
<script>
  const outreach = Outreach("pk_…");                       // your publishable key

  const getToken = () =>                                   // asks YOUR server, which asks Outreach
    fetch("/my-server/outreach-token?component=leads").then(r => r.json()).then(d => d.token);

  outreach.create("leads", { getToken }).mount("#box");                              // inline, inside an element
  outreach.create("campaigns", { getToken }).open({ mode: "modal" });                // popup
  outreach.create("voice", { getToken }).open({ mode: "drawer", side: "right" });    // side panel
  outreach.redirect("mail", { getToken });                                           // the whole page
</script>
```

Pick the layout that fits where the screen lives:

| I want it to… | Use |
|---|---|
| Sit inside a part of my page | `.mount("#box")` |
| Open in a popup over my page | `.open({ mode: "modal" })` |
| Slide in from the side | `.open({ mode: "drawer", side: "right" })` |
| Take over the whole page | `outreach.redirect("mail", { getToken })` |

### Options for `outreach.create(screen, options)`

| Option | What it does |
|---|---|
| `getToken` | A function that returns a token (or a promise of one). Use this one: it is called again when the token ends. |
| `token` | A token as plain text, if you cannot use `getToken`. It cannot be renewed. |
| `appearance` | Colours and fonts. See [Colours and fonts](#colours-and-fonts). Use `"auto"` to match your page. |
| `height` | Height when inline. Default `640px`. |
| `onReady(info)` | Called when the screen has loaded. |
| `onError({ message })` | Called when the screen or your token request fails. Show your user a message. |
| `onSessionEnded()` | Called when the session ended and could not be renewed (the account was disconnected, or your server refused a new token). |
| `onClose()` | Called when a popup or side panel is closed. |
| `onEvent({ name, data })` | Reserved for events from inside the screen. None are sent yet. |

### What you can do with the object it returns

| Method | What it does |
|---|---|
| `.mount(selectorOrElement)` | Puts the screen inside your element. |
| `.open({ mode, side, width, height })` | Opens a popup (`mode: "modal"`, up to 1100 px wide) or side panel (`mode: "drawer"`, `side: "right"` or `"left"`). Esc, the × button, or a click outside closes it. |
| `.close()` | Closes a popup or panel, or removes an inline screen. |
| `.update({ appearance })` | Changes the look without reloading. |
| `.destroy()` | Closes it and stops listening. |

### Full page: `outreach.redirect(screen, { getToken, appearance, newTab })`

Replaces your page with the screen, or opens a new tab with `newTab: true`. A full-page screen cannot renew its token, so it ends
when the token does. Give full pages a longer `ttl_seconds`.

> **Tip:** you can ignore `embed.js` and talk to the screen with `postMessage` yourself, but `embed.js` does all of that for you. Use it unless you must not.

## Connect your users

A screen shows one Outreach account's data, so each of your users needs a **link** to an Outreach account.

| Case | Who | Who pays | How the link is made |
|---|---|---|---|
| **Existing account** | The person already uses Outreach | Their own credits | They sign in to Outreach inside the connect window and agree |
| **New account** | The person has no account | Free while the programme is free | They create one in the connect window. It belongs to your integration |
| **Direct** | They use Outreach on its own | Their own credits | Nothing changes. No link |

### The steps

1. **Your server** asks: is this person linked?
   ```
   POST /api/embed/connect-sessions      Authorization: Bearer psk_…
   { "external_id": "user-42", "component": "leads" }
   ```
   - `{ "linked": true, "link_id": "plink_…", "mode": "existing" }` (or `"partner_created"`): they are linked. Ask for a token.
   - `{ "linked": false, "connect_token": "…", "expires_at": … }`: show the connect window.
2. **Your page** opens the connect window:
   ```js
   outreach.connect({ connectToken, onConnected: ({ linkId, externalId, mode }) => { … } }).open({ mode: "modal" });
   ```
   The window asks the person to sign in (or create an account) and to agree to what you can do, in words that match the screen. When they agree, the link is made.
3. **Later**, your server can look a link up: `GET /api/embed/links/{external_id}` with your secret key. It returns the link, or `404`.

### Use the same account from your server (an API key)

If you also want to use the account without the screens (calls, lists, webhooks), ask for an API key for that user:

```
POST /api/embed/links/{external_id}/key      Authorization: Bearer psk_…
```

It returns `{ "api_key": "sk_…", "key_mode": "test", "link_id": … }` (`key_mode` is `test` or `live`).

- Server only. A call with an `Origin` header is refused, so the key never passes through a browser.
- The key is shown once. It has the permissions your programme was approved for.
- Asking again gives a new key and the old one stops working. Ending the link deletes the key.
- `404` if the user is not linked.

### Rules that protect your users

- **Only the account's admin can connect it.** A team member who is not an admin is told to ask the admin.
- **An email address is never enough.** The person proves they own the account with its password, on Outreach's own page.
- **One Outreach account links to one of your users.** If the account is already linked to a different user of yours, you get `409` until that link is ended.
- **One of your users links to one Outreach account.** The same `external_id` cannot be linked to a second account.
- **One account can work with several partners.** Each link is separate: its own agreement and its own tokens. Ending one leaves the others working.
- If email confirmation is on, a new account works once the person follows the link in the email. The connect window says so.

### Ending a link

- **You:** in Admin APIs & Webhooks → Partner programme → Accounts → Disconnect (or `DELETE /api/partner/links/{link_id}`).
- **The user:** in their own Admin APIs & Webhooks → Partner programme → "Software connected to your account" → Disconnect.
- **Outreach:** pausing your integration stops every token and secret key you hold.

Tokens for an ended link stop working within about 5 seconds.

## Which screens exist

| Screen | What the user sees | Can change | Can only read |
|---|---|---|---|
| `leads` | Find Leads, My lists | leads, lists, enrichment | email data |
| `campaigns` | My lists, Email campaigns, Email accounts | leads and email | |
| `mail` | Mail, Email accounts | email | leads data |
| `voice` | Call list, Conversations, Meetings & callbacks | calls, call lists, meetings | leads data |
| `social` | Post calendar, Approvals, Results & Ideas, Library, Accounts | posts and social accounts | agenda, company sources |

- These are the same screens people use on Outreach, with the menu cut down to the pages above. Home, switching apps, credits and Log out are left out: those belong to your product.
- `access: "view"` makes a token read-only everywhere.
- A token only reaches the pages in this table. Anything else (billing, users, keys, other screens, the admin API) is refused with `403 embed_scope`.
- An account with no plan or credits for an app sees "… is not on this account yet". Plans are bought on Outreach itself.

## Colours and fonts

Make the screens look like your product.

```js
outreach.create("leads", {
  getToken,
  appearance: { variables: { colorPrimary: "#0f766e", colorBackground: "#f4f1ea", colorText: "#1c1917", fontFamily: "serif", borderRadius: 10 } },
});
```

| Setting | Value | What changes |
|---|---|---|
| `colorPrimary` | `#rgb` or `#rrggbb` | Buttons, selected items and highlights |
| `colorBackground` | a hex colour | Page background |
| `colorSurface` | a hex colour | Cards and panels |
| `colorText` | a hex colour | Text (the lighter greys are worked out from it) |
| `colorDanger` | a hex colour | Errors |
| `colorSidebar` | a hex colour | The side menu's background |
| `colorSidebarText` | a hex colour | The side menu's text. Left out, it is white or dark grey, whichever reads best |
| `fontFamily` | `system`, `inter`, `serif`, `rounded` or `mono` | The font |
| `borderRadius` | 0 to 24 | How round the corners of cards and fields are |
| `brandName` | up to 40 characters | Replaces the app's name above the menu |
| `logoUrl` | an `https` address of a picture | Replaces the app's icon above the menu |

- **Save a default** in Partner programme → Look, which has a live preview. A page's own `appearance` wins over it.
- Only these settings are read. Anything else (a colour name, a non-`https` address, a font that is not in the list) is ignored, so a theme can never inject styles or scripts.
- Status colours and charts keep their own so they stay readable.
- Change it while the screen is open with `screen.update({ appearance })`.
- There is no dark theme yet (see [What is not there yet](#what-is-not-there-yet)).

### Match my software automatically

Let the screen read your page and copy its colours:

```js
outreach.create("leads", { getToken, appearance: "auto" }).mount("#box");
```

When the guess is not right, say where to look. Anything you set yourself wins:

```js
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

- It keeps following your page: when your theme class, `data-theme` or colour scheme changes, the screen follows a moment later.
- **Dark pages:** the screens have no dark theme yet, so on a dark page they keep their light background and take only your button colour, corners, font, error colour and side menu.
- With nothing named it is a guess. Naming the CSS variable or the element makes it exact.

## Data and privacy

- A link gives you what the person agreed to, for the screens you show. You do not get their password, and you do not get Outreach's own company data (its enrichment and supplier data stays inside the screens).
- What a person creates in a screen belongs to their Outreach account: lists, campaigns, call recordings and transcripts, replies. It stays theirs if they disconnect.
- A screen only ever reads the one account its token names. Accounts are kept apart in the database, not just in the application.
- Disconnecting ends your access at once. It does not delete the account or its data.
- Usage caused through your screens is recorded against your integration. You can see credits used per account over the last 30 days in the dashboard.

## Billing

- An **existing** account always uses its own Outreach credits and plan.
- A **new** account made through your connect window is free while the partner programme is free.
- Each credit line records who used it, who was charged and, when it came from your screen, your integration.

Not built yet: charging **your** credit for your users' usage, and topping up a partner wallet.

## Security

- **Framing:** screens are served so that only **your web addresses** may show them in a frame. Any other site that tries is refused by the browser. Adding or removing an address takes effect on the next page load.
- **Tokens** are signed and last 15 minutes by default (60 seconds to 1 hour). Each belongs to one link and one screen and cannot be put in a web address. They live only in the screen's memory, never in storage.
- **Ending a link** (disconnecting, pausing your integration, suspending the account) stops live tokens within about 5 seconds.
- **The secret key** is for servers only and is stored hashed. A request that carries a browser `Origin` is refused, so a key leaked into a web page is no use from a browser.
- **Passwords** are typed into Outreach's own page only. Your software never sees one.
- **Handshake:** a screen only accepts its token from the page that frames it.
- **No wildcard CORS** for these calls: the screens run on Outreach's own address, so their calls stay on one origin.

## Fixing problems

Errors from `/api/embed/…` come with an HTTP status and a `detail` message.

| Status and message | What it means | What to do |
|---|---|---|
| `401` Invalid secret key | The key is wrong, was replaced, or is a test key on a live integration (or the other way round) | Use the current key for your integration's status |
| `403` Create embed sessions from your server | The call came from a browser | Call from your server |
| `403` `embed_scope` | A screen asked for something outside its pages | Not allowed. See [Which screens exist](#which-screens-exist) |
| `403` `admin_required` | The person connecting is not an admin of the account | Ask the account's admin to connect |
| `404` That account is not connected to you | No active link for that user | Run the connect window for them |
| `409` already linked | The account, or the user, is already linked to someone else | End the existing link first |
| `422` `consent_required` | The person did not agree | They must agree in the connect window |
| `422` `component` or `access` | The value is not one of the allowed ones | Use a value from the tables above |
| `429` | Too many requests | Slow down. The `Retry-After` header says how long |

## Go-live checklist

- [ ] Terms accepted
- [ ] Every page that shows Outreach is in your web address list, over `https`
- [ ] The secret key is on your server only, and not in any page, repository or log
- [ ] You tested linking an existing account **and** creating a new one
- [ ] You tested a token ending (set `ttl_seconds` to 60) and a user being disconnected while a screen is open
- [ ] Your page shows a clear message from `onError` and `onSessionEnded`
- [ ] You show your users what you can access (the connect window already does) and never ask for their Outreach password
- [ ] You asked to go live, then made a **live** secret key

## What is not there yet

- **Dark theme.** Parts of the app draw their own light colours, so a dark theme would look broken. Colours, font and corners work.
- **Charging a partner for its users' usage**, and partner wallet top-ups.
- **A webhook when a link is made.** Use the `onConnected` callback or `GET /api/embed/links/{external_id}`.
- **Live call monitoring in embedded Voice.** Calls, conversations, meetings and the AI caller work.
- **Events from inside a screen** (`onEvent`). The channel exists, but no events are sent yet.
- **Marking background work** (a call that finishes later) with your integration. Those lines record who paid but not the partner.
- **Removing Outreach's name** from the screens.

## Notes for the Outreach team

- **Try it locally:** `tools/embed_demo` stands in for a partner's software: a page with a button for each layout and a theme panel, plus a tiny server that holds the secret key and asks for tokens.
  ```
  OUTREACH_HOST=http://localhost:5173 OUTREACH_CLIENT_ID=pk_… OUTREACH_SECRET=psk_test_… python tools/embed_demo/server.py
  ```
  Open `http://localhost:5174` (add that address to the web addresses first). `TOKEN_TTL=60` shortens tokens so you can watch renewal.
- **Migrations** (additive, run on start): `partners.secret_hash/secret_prefix/theme`, `partner_links.external_id`, `credit_ledger.partner_id/payer_org_id`.
- **nginx** (`frontend/nginx.conf`) needs the `auth_request` module (the stock `nginx:alpine` image has it). `/embed/…` asks the backend at `/api/embed/frame-policy`, which answers with the partner's `frame-ancestors`. If that call fails, nginx returns an error for the page and never falls back to an open policy.
- The frontend build has a third page, `embed.html`, and a static `embed.js`. Both are in `dist` after `npm run build`.
- The 5-second revoke window is per backend process. With more than one worker, a revoke can take up to 5 seconds on each.
- The main app's own pages get no `frame-ancestors` rule from this feature. Adding `frame-ancestors 'self'` to the `/` location would also protect the sign-in page from being framed; it was left out because it changes existing behaviour.
