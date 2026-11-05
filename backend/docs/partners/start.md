# Get started

Put Outreach's screens (finding leads, email campaigns, calls, social posts) **inside your own product** with one snippet of code.
Your users sign in to Outreach in a small window, so you never handle a password and nothing needs adding to your server.

## In 3 steps

**1. Start (you, in the dashboard, 1 minute).** Open **Admin APIs & Webhooks → Partner programme**, type your company name, agree to
the terms and press **Start in test mode**. There is no application and no waiting. Then press **Download your zip**.

**2. Paste the snippet (your developer, 2 minutes).** The zip has `snippet.html`. Paste its two lines where Outreach should show:

```html
<script src="https://YOUR-OUTREACH-HOST/embed.js" data-key="pk_YOUR_PUBLISHABLE_KEY" data-accent="#2f5be0"></script>
<div data-outreach="leadgen"></div>
```

The key in your zip is already filled in. It is a **publishable key**: it is meant to sit in a web page, and there is no secret key.

**3. Try it.** Open `outreach-test.html` from the zip through any small web server (for example `python -m http.server 8000`, then
`http://localhost:8000/outreach-test.html`). Click **Connect Outreach**, sign in or create an account in the small window, and the
screen opens. While you test, pages on your own computer work without adding any address.

When it works on your site: add the address of your site under **Partner programme → Add the address of your site**, then press
**Ask to go live**. Until you are live, only your own computer and the addresses you add can use your key.

### Change how it looks, from the snippet

Put these on the script tag (every screen) or on one `data-outreach` tag (that screen only):

| Attribute | What it changes | Example |
|---|---|---|
| `data-accent` | button and highlight colour | `#0a7a5a` |
| `data-bg`, `data-surface`, `data-text` | page, card and text colours | `#ffffff` |
| `data-danger` | error colour | `#c0392b` |
| `data-sidebar`, `data-sidebar-text` | the side menu | `#101828` |
| `data-radius` | rounded corners, 0 to 24 | `14` |
| `data-font` | `system`, `inter`, `serif`, `rounded` or `mono` | `inter` |
| `data-name`, `data-logo` | your name and an `https` logo address | `Acme` |
| `data-appearance="auto"` | copy the colours of your own page | |

Screens: `leadgen` (every page of the Leads app: AI Assistant, Find Leads, Lists, Journeys, Mail, Forms, Workflows, About your business), `voice` (every page of Voice) and `social` (every page of Social). Smaller slices of Leads, for a partner that wants only that: `leads`, `campaigns`, `mail`. Show one in a popup or side panel from your own button:
`<button data-outreach="voice" data-mode="popup">Calls</button>` (also `drawer`, and `page` for a full page). Every value is
checked on the Outreach side, so a wrong colour is ignored rather than breaking the screen.

### Use your own data and every feature

Your own code can put your data into the person's Outreach account and run any action, with one line each. The person connects once
(a click and the sign-in), and these calls then work for them. Call the first one from a button click, so the browser allows the
sign-in window.

```js
// Send your customers or leads into their account, and into a list
await Outreach.import(
  [{ name: "Harbour Dental Ltd", email: "hello@harbour.example", phone: "+441134960011" },
   { name: "Greenfield Bakery", website: "https://greenfield.example" }],
  { list: "My CRM customers" });

// Run any action of any plugin: leads, voice, social, whatsapp, mail, account
const calls = await Outreach.run("voice", "call.list");
await Outreach.run("voice", "call.start", { to: "+442071230000" });
await Outreach.run("social", "post.create", { text: "We are open on Sunday" });

// Open a screen with something already searched
Outreach.find("Harbour Dental");                       // Leads, with that company searched
// or as a tag:  <div data-outreach="leadgen" data-find="Harbour Dental"></div>
```

A record has `name` (required) and any of `email`, `phone`, `website`, `contact_name`, `contact_title`, `industry`, `region`, `notes`
(up to 500 at a time; more are sent in batches for you). Every action and what it takes is listed in the **API reference**.
What your code is allowed to do is only what the person agreed to on the sign-in screen, and it works only from the web addresses
you listed. **While your integration is in test mode, these actions are simulated and save nothing**, so you can build safely.
After you go live they are real, and the person's own plan and credits apply, as for any Outreach API key.

Once your data is in their account, every feature works on it: lists, journeys and email, calls from a list, enrichment and
checks, and social posts that mention it.

### How a person is connected

The first time, the person clicks **Connect Outreach**. Outreach shows your name and the address of your page, and asks them to sign
in or create an account and agree to what you can access. **You choose where that sign-in shows**, with `data-login` on the script
tag (every screen) or on one `data-outreach` tag:

| `data-login` | What the person sees |
|---|---|
| `popup` (default) | A small Outreach window. It closes and your screen opens |
| `inline` | The sign-in appears inside your page, in the place of the screen (inside the popup or side panel, if the screen is one). No new window, so no pop-up blocker |
| `page` | The whole window goes to Outreach and comes back to the same page, which then opens the screen |

Example: `<script src="…/embed.js" data-key="pk_…" data-login="inline"></script>`. Next time, with `popup` or `page`, they click once and the sign-in closes by itself, because Outreach remembers them in that browser (`inline` asks again when the browser blocks third-party cookies). If they
use another browser or device they sign in again. They can disconnect from Outreach at any time, and access stops at once.

### The Outreach browser extension

The zip also has two extension folders. Your team gets Outreach in a side panel on any page, signed in the same way as your screens.

| Browser | How to add it |
|---|---|
| Chrome | `chrome://extensions` > turn on **Developer mode** > **Load unpacked** > choose the `extension` folder |
| Edge | `edge://extensions` > turn on **Developer mode** > **Load unpacked** > choose the same `extension` folder |
| Firefox | `about:debugging` > **This Firefox** > **Load Temporary Add-on** > choose `extension-firefox/manifest.json` (needs `ALLOW_FIREFOX_EXTENSION` switched on by the Outreach team) |
| Safari | Not available yet |

Edit `config.json` in the folder to choose which screens show and to set the colours.

**Reading the page.** Click the Outreach button in the toolbar while you are on a page. The panel then offers to look that company
up in Leads, with the name filled in (you can change it first). The extension reads the page's address, title, site name, main
heading and any text you selected, only at that click and only for that page. It has no standing access to any site, and it sends
nothing anywhere from the page.

### Sharing credits with your users

Your people spend their own Outreach credits. You can fund them from your own account: top up your wallets on the normal Outreach
billing page, then in **Partner programme → Accounts** press **Give credits** next to a connected account, or set a **welcome gift**
that every new account created through you receives automatically (it stops when your wallet runs out, and nothing is created from
nowhere). Credits move from your wallet to theirs; what they spend is still charged to them.

### If something goes wrong

| What you see | Why | Fix |
|---|---|---|
| "…is not in your list of web addresses" | Your page's address is not listed (live partners only) | Add it exactly as the browser bar shows it, with `https://` and the port if there is one |
| "The browser did not say which page this is" | The page was opened from a file on disk | Open it through a web server, not by double-clicking |
| "Your browser blocked the sign-in window" | A pop-up blocker | Allow pop-ups for the site, then click Connect again |
| An empty box | Your page's address is not allowed to frame Outreach, or `data-key` is not your publishable key | Check the key and the address list. The browser console (F12) shows "Refused to frame" when the address is the problem |
| "That sign-in has expired" | The sign-in window stayed open for more than two minutes | Click Connect again |

## Optional: connect people from your own server

Everything below is **only for partners whose own server already knows who each user is** and who want people connected without the
sign-in window. It needs a secret key and one small file on your server. If you did the 3 steps above, you can stop here.

## The fastest way: the starter kit

In **Partner programme → Advanced → Connect with your own server**, pick what your product is built with and download a kit made for
you, with your publishable key and addresses already filled in. Each kit holds the same four things:

| In the kit | What it is |
|---|---|
| `.env.example` | Where your secret key goes. Copy it to `.env`. |
| **One server file**, named after your tool | The small file that hands your page a pass. It is the only server file in the kit. |
| `snippets/` | Page code to paste: panel, popup, side panel, full page, React component. |
| `check.mjs` | `node check.mjs` tests every part and says what to fix, in plain words. |

**Which server file?** It is named after the tool it plugs into, so it cannot be mixed up with another:

| You build with | Your server file | The two lines you add |
|---|---|---|
| Vite or React (no server of its own) | `outreach-vite.mjs` | in `vite.config.ts`: `import outreach from "./outreach-vite.mjs";` and `outreach()` inside `plugins: [ ... ]` |
| Your own Node / Express server | `outreach-express.mjs` | in your server file: `import outreach from "./outreach-express.mjs";` and `app.use(outreach());` |
| Next.js | `app/outreach-start/route.js` | nothing: it is already in the right folder |
| Python / Flask | `outreach_flask.py` | `from outreach_flask import outreach` and `app.register_blueprint(outreach)` |
| PHP | `outreach-start.php` | nothing: put it in your website folder |

Unzip the kit **into your project folder** (next to `package.json`), then follow `START-HERE.txt`. The same files are on the
[Copy-paste code](snippets.md) page, so you can also do all of this by hand or in another language.

## Before you start

- You can sign in to Outreach as an account admin.
- You know the web address your product runs on, for example `https://app.yourproduct.com`.
- A developer can add one small piece to your server and paste one snippet into your page. Both are below, ready to copy.

## Step 1. Start and agree to the terms (you, in the dashboard)

1. Sign in to Outreach and open **Admin APIs & Webhooks → Partner programme**.
2. Press **Start in test mode** and agree to the terms (partners who applied earlier accept the terms on the same page).

## Step 2. Add your web address and a return address (you)

In **Partner programme**, add every address that will show Outreach, one per line, with no path:

```
https://app.yourproduct.com
```

`www.yourproduct.com` and `yourproduct.com` are two different addresses. Add both if you use both. A page on an address you have
not added shows an empty box that says "refused to connect".

## Step 3. Make your secret key (you)

1. In **Partner programme → Advanced → Connect with your own server**, make a secret key.
2. **Copy it now.** It is shown once. Give it to your developer to keep on the server, never in the page.
3. Also copy your **publishable key** (starts with `pk_`, shown as "Publishable" or "Client ID"). This one is not secret and goes in your page.

While you are testing you get a test key (`psk_test_…`).

## Step 4. Add the server file (your developer)

Your page needs somewhere on **your server** to ask for a pass. That is the one small server file from the starter kit. It reads the
secret key from a `.env` file, asks Outreach for a pass, and hands it to your page. It never runs in the browser.

1. **Unzip the kit into your project folder**, next to `package.json`. Some tools unzip into a new folder named after the zip: if
   you see one, move everything out of it into your project folder (including the hidden `.env.example`).
2. **Put the secret key in `.env`.** Copy `.env.example` to `.env` (`.env.local` for Next.js), and paste the key after
   `OUTREACH_SECRET=`. No quotes, no spaces. In Docker, set `OUTREACH_SECRET` as an environment variable on the container instead.
3. **Add the two lines** from the table above to your own file. Use exactly that spelling.
4. **Restart your app.** A new plugin or route only loads on a restart.
5. **Run `node check.mjs`**, in the project folder, with your page's address: `node check.mjs https://app.yourproduct.com`.
   Every line must say `[ok]`.

Not using one of those tools? The [Copy-paste code](snippets.md) page has the steps for any language, in three plain parts: call
`POST /api/embed/connect-sessions` with your secret key, return the `connect_token` if the user is not linked yet, otherwise call
`POST /api/embed/sessions` and return the `token`.

**Keep the key safe.** Never put the secret key in a variable whose name starts with `VITE_`, `NEXT_PUBLIC_` or `REACT_APP_`: those
are copied into the web page.

## Step 5. Show the screen in your page (your developer)

Open the `snippets` folder in the kit, or the [Copy-paste code](snippets.md) page, and pick how Outreach should look:

| You want | Use |
|---|---|
| The screen inside your page | `panel.html` |
| A button that opens a popup | `popup.html` |
| A button that opens a side panel | `drawer.html` |
| A link that opens a full page | `full-page.html` |
| A React or Next.js component | `OutreachScreen.jsx` |

Each file has two parts: **one script line** (once per page, just before `</body>`) and **one tag** where the screen should show.
Your publishable key (`pk_…`) is already in the script line. It is safe in a page. The secret key must never appear there.

Before you paste, check:

- The page's address is in your list from Step 2, exactly as it shows in the browser bar. While testing on your own computer add
  `http://localhost:3000` (use your own port number).
- If your site sets a Content-Security-Policy, allow `https://outreach.aivhub.com` for scripts and frames.

**What the person sees:** the first time, a window opens where they sign in to Outreach (or create an account) and agree to what
you can do. When they finish it closes and the screen appears. After that the screen opens straight away.

## Step 6. Test it

1. Start your app (with the secret key in `.env`, see Step 4) and open your page in the browser, or open `/outreach-test.html` from the kit. Sign in to your own product as a
   test user.
2. You should see the connect window. Sign in to an Outreach account, or create a new one, and tick the agreement. The window
   closes and the Leads screen appears.
3. Reload the page. The screen should open without the connect window.
4. If something fails, press F12 in the browser and open the **Console** tab, and the **Network** tab for the `outreach-start`
   request. The messages there match the table below.
5. Test keys only use fake credit. Nothing is sent to real people.

## Step 7. Go live

1. In **Partner programme → 3. Go live**, press the request button. It works once the terms are accepted and you have at least one web address. The Outreach team checks your integration and switches it on.
2. Make a new **live** secret key in Partner programme (it starts with `psk_live_`). The test key stops working for live use.
3. On your live website, open your hosting dashboard's "Environment variables" and replace the value of `OUTREACH_SECRET` with
   the live key. Your own `.env` file keeps the test key. Then redeploy or restart the live server. (The Vite plugin only runs under
   `npm run dev` and `npm run preview`: a site hosted as plain static files needs a server route at `/outreach-start` as well.)
4. Check that the page is served from a live address that is in your list from Step 2 (for example `https://app.yourproduct.com`),
   not only `localhost`.

## If something goes wrong

| What you see | Why | Fix |
|---|---|---|
| An empty box, "refused to connect" | Your page's address is not in the list | Add it in Step 2, exactly as it appears in the browser |
| A blank box, but your server answered `200` | The browser refused to put Outreach in your page, or the key given to `Outreach(...)` is not your publishable key | Open the browser console (F12) and look for "Refused to frame". Then run the check just below this table |
| `403` when your server asks for a pass | The request came from a browser, or the key is wrong | Call Outreach only from your server, with the secret key |
| `404` for a user | That user is not connected yet | Run the connect window for them (Step 5) |
| The screen stops after 15 minutes | The page kept an old pass | Use `getToken` as in Step 5. It fetches a fresh one |
| "…is not on this account yet" | The account has no plan for that screen | The person buys the plan on Outreach |
| The person cannot connect | Only the account's admin can connect it | Ask the admin of that Outreach account |
| Console says `Unexpected token '<', "<!doctype "... is not valid JSON`, or the page says "your app answered with its own web page" | The page asked your own server for `/outreach-start` and got an HTML page back: the server file is not added yet, or sits behind a catch-all that returns `index.html` | Do Step 4: add the two lines, put them before any catch-all route, and restart. Nothing is wrong at Outreach: the request never reached it |
| `No matching export in "…mjs" for import "outreach"`, or `outreach is not defined` (any error about an `outreach` import) | The import in your config does not match the file in your kit. Each kit has its own file name (`outreach-vite.mjs`, `outreach-express.mjs`, `outreach_flask.py`), and the JavaScript ones are imported without curly braces | Use the lines from the table in "The fastest way". Check you downloaded the kit for your tool. `node check.mjs` names the exact lines to fix |
| `Cannot find module '.../check.mjs'` | The kit files are not in your project folder, often because the unzip tool made a sub-folder | Move everything out of that folder into the folder with `package.json`, including hidden files |
| The app does not start after you add the two lines | The import line is missing, misspelled, or the file is not where `./` points | Run `grep -n outreach vite.config.ts` (or your server file): you must see the import line and the call. In Docker, the kit files must be inside the container too |
| The `outreach-start` request in the Network tab shows `200` or `304` with an HTML response | Same cause. `304` only means the browser re-used a saved copy of that page | Same fix. Click the request and read its **Response** tab: it must be JSON |
| Your `curl` to `/api/embed/connect-sessions` works but the page still fails | That proves the key, not the route on your own site | Open `/outreach-start` in your browser: it must show JSON. Run `node check.mjs` |

**Check which sites Outreach lets frame the screen.** Run this with your own publishable key:

```
curl -sI "https://outreach.aivhub.com/embed/leads?client_id=pk_paste_your_key_here" | grep -i content-security-policy
```

The answer must contain your page's address, for example `frame-ancestors https://app.yourproduct.com`. If it says `'none'`, the
key is not recognised or the web address list is empty: check the key, and Step 2. If your address is not in the list it prints,
add it exactly as the browser bar shows it, with `https://`, with or without `www.`, and with the port number if there is one.

## What next

- Change the look, popups and side panels, and which screens exist: see the **Embedding reference**.
- Use the same account from your server (calls, lists, webhooks): see the **API reference**.
- Stuck? Write to the Outreach team and include the time and the user id.
