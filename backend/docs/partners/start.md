# Get started

This page takes you from nothing to an Outreach screen working inside your own software. Follow the steps in order. Each one says
who does it: you in the Outreach dashboard, or your developer in your code.

## What you are building

Your users see Outreach's screens (finding leads, email campaigns, calls, social posts) **inside your product**, as if you made them.
Outreach does the work behind them. You never handle passwords.

Three words you will see:

- **Secret key**: a password for your server. It lets your server ask Outreach for permission to show a screen. Never put it in a web page.
- **Link**: the connection between one of your users and one Outreach account. You make it once per user.
- **Token**: a short pass (15 minutes) that lets one screen open for one user. Your server asks for it each time. You never keep it.

```
Your page  →  asks your server  →  your server asks Outreach (with the secret key)  →  token  →  the screen opens
```

## The fastest way: the starter kit

In **Partner programme**, step 4 is **Download your starter kit**. Pick what your product is built with and download a zip made for
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

## Step 1. Apply and agree to the terms (you, in the dashboard)

1. Sign in to Outreach and open **Admin APIs & Webhooks → Partner programme**.
2. Fill in the application and send it. You get an email when it is approved.
3. Open the same page again, read the terms and accept them.

## Step 2. Add your web address and a return address (you)

In **Partner programme**, add every address that will show Outreach, one per line, with no path:

```
https://app.yourproduct.com
```

Also add at least one **return address**: the page of yours where people land after they confirm their email, for example
`https://app.yourproduct.com/outreach-done`. You need one before you can go live.

`www.yourproduct.com` and `yourproduct.com` are two different addresses. Add both if you use both. A page on an address you have
not added shows an empty box that says "refused to connect".

## Step 3. Make your secret key (you)

1. In **Partner programme**, make a secret key.
2. **Copy it now.** It is shown once. Give it to your developer to keep on the server, never in the page.
3. Also copy your **publishable key** (starts with `pk_`, shown as "Publishable" or "Client ID"). This one is not secret and goes in your page.

While you are testing you get test keys (`psk_test_…`). Nothing real is sent or charged.

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

1. In **Partner programme → 5. Go live**, press the request button. It works once the terms are accepted and you have at least one web address and one return address. The Outreach team checks your integration and switches it on.
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
