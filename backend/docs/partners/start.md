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

## Step 4. Add one endpoint to your server (your developer)

This endpoint answers one question for your page: is this user connected, and if so, here is a pass. It runs **on your server**
(the code that already handles your logins and your database), never in the web page.

### 4a. Keep the secret key in a settings file, not in the code

1. Open the file where your server keeps its settings. Most projects have a file called `.env` in the main project folder. If you
   have none, create one there.
2. Add one line, with your own key after the `=` and no quotes or spaces:

```
OUTREACH_SECRET=psk_test_paste_your_key_here
```

Then:

- Make sure `.env` is listed in your `.gitignore` file, so the key is never uploaded to GitHub.
- On your live website the key goes in your hosting dashboard instead, under "Environment variables" (Vercel, Render, Heroku,
  Railway, AWS and others all have this). The `.env` file stays on your own computer.
- Restart your server after changing it. Settings are read only when the server starts. A Node server also needs to load the
   file: run it with `node --env-file=.env server.js`, or add the `dotenv` package. Next.js and most hosting set-ups do this for you.

### 4b. Add the endpoint to your server code

Put it in the file where your other routes live, for example `server.js`, `app.js` or `routes/outreach.js`. **Pick the version that
matches your server.**

**Node 18 or newer, Express**

```js
const OUTREACH = "https://outreach.aivhub.com/api/embed";

async function outreach(path, body) {
  const res = await fetch(`${OUTREACH}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OUTREACH_SECRET}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || `Outreach answered ${res.status}`);
  return data;
}

// requireLogin is whatever you already use to make sure someone is signed in.
app.get("/outreach-start", requireLogin, async (req, res) => {
  try {
    const external_id = String(req.user.id);          // your own id for the person who is signed in
    const component = req.query.component || "leads"; // leads, campaigns, mail, voice or social
    const info = await outreach("/connect-sessions", { external_id, component });
    if (!info.linked) return res.json({ connect_token: info.connect_token });   // not connected yet
    const pass = await outreach("/sessions", { external_id, component });
    res.json({ token: pass.token });
  } catch (err) {
    console.error("Outreach:", err.message);
    res.status(502).json({ error: "Outreach could not be reached." });
  }
});
```

**Next.js** (create the file `app/api/outreach-start/route.js`)

```js
const OUTREACH = "https://outreach.aivhub.com/api/embed";

async function outreach(path, body) {
  const res = await fetch(`${OUTREACH}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OUTREACH_SECRET}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || `Outreach answered ${res.status}`);
  return data;
}

export async function GET(request) {
  const user = await getCurrentUser();                // your own way of finding who is signed in
  if (!user) return Response.json({ error: "Sign in first." }, { status: 401 });
  const component = new URL(request.url).searchParams.get("component") || "leads";
  const info = await outreach("/connect-sessions", { external_id: String(user.id), component });
  if (!info.linked) return Response.json({ connect_token: info.connect_token });
  const pass = await outreach("/sessions", { external_id: String(user.id), component });
  return Response.json({ token: pass.token });
}
```

**Python (Flask)**

```python
import os, requests
from flask import jsonify, request

OUTREACH = "https://outreach.aivhub.com/api/embed"

def outreach(path, body):
    r = requests.post(OUTREACH + path, json=body, timeout=15,
                      headers={"Authorization": "Bearer " + os.environ["OUTREACH_SECRET"]})
    r.raise_for_status()
    return r.json()

@app.get("/outreach-start")
@login_required                                      # your own sign-in check
def outreach_start():
    external_id = str(current_user.id)               # your own id for the person who is signed in
    component = request.args.get("component", "leads")
    info = outreach("/connect-sessions", {"external_id": external_id, "component": component})
    if not info["linked"]:
        return jsonify(connect_token=info["connect_token"])
    return jsonify(token=outreach("/sessions", {"external_id": external_id, "component": component})["token"])
```

Any other language works too. Each call is a `POST` to `https://outreach.aivhub.com/api/embed/...` with the header
`Authorization: Bearer <your secret key>` and a JSON body.

### Things to get right

- **The address must match Step 5.** The page asks for `/outreach-start`. If you name the route something else, change it in the
  page snippet too.
- **Sign-in check:** only signed-in people may reach this route, and `external_id` must always come from your own login, never
  from the request. Otherwise anyone could ask for a pass for someone else's account.
- **`external_id` never changes for a person.** Use your own user id (or your account id, if one Outreach account serves a whole
  team). Do not use an email address, which people change.
- **Only your server calls Outreach.** A call from a browser is refused with `403`, on purpose.
- **Screen names:** `leads`, `campaigns`, `mail`, `voice` and `social`. Any other word gives a `422` error.
- **The endpoint is code that runs, not a file that is shown.** Put it in the server program (the one you start with `node server.js`,
  `flask run` and so on), never in a file inside the folder your web server hands out to browsers. A file served as a page is never
  run: the address then returns your own site's page instead of JSON.
- **Register the route before any catch-all.** Many single-page set-ups end with a rule such as `app.get("*", ...)` or
  `try_files ... /index.html` that returns `index.html` for every unknown address. The `/outreach-start` route must come before it.
  If your page is served by a separate front-end server (a static host, a container, an nginx), set that server to pass
  `/outreach-start` on to your back end.
- **Test the route by itself.** Open `https://your-site/outreach-start?component=leads` in a browser tab (signed in to your product).
  You must see JSON such as `{"connect_token": "..."}`, or a sign-in error in JSON. If you see your own website, the route is
  not reaching the server code.
- **The secret key lives in the settings, not in the code.** Read it from `OUTREACH_SECRET` (see 4a). A key written into a code
  file ends up in GitHub or in a page anyone can read. If a key was ever put in a file that is served or uploaded, revoke it in
  Partner programme and make a new one.

### If your product has no server of its own (Vite, Lovable, Bolt, Create React App)

These tools build only the web page. Nothing in them can keep a secret key, and the development server answers every unknown
address with `index.html`. That is why the page asks for `/outreach-start` and gets a web page back (`Content-Type: text/html`)
instead of JSON, and the Outreach box stays blank. The endpoint has to run somewhere that is not the browser. Pick one:

**A. A small Node server next to your app.** Save the Step 4b Express code as `server.js` with `app.listen(3000)` at the end, and
put `OUTREACH_SECRET` in a `.env` file next to it. Start it with `node --env-file=.env server.js`. Then tell Vite to pass that
one address to it, in `vite.config.ts`:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/outreach-start": "http://localhost:3000" } },
});
```

Restart `npm run dev`. On your live site, do the same with your web server or host: send `/outreach-start` to the server.

**B. A serverless function** (Supabase Edge Function, Vercel or Netlify function, Cloudflare Worker). Put the Step 4b code in
the function, store `OUTREACH_SECRET` in the platform's secrets, and change the page's `fetch("/outreach-start…")` to the
function's own address. The function must answer with the header `Access-Control-Allow-Origin` set to your site.

**Do not** put the secret in a `.env` variable that starts with `VITE_` (or `NEXT_PUBLIC_`, `REACT_APP_`). Those are copied into
the web page for anyone to read. The secret belongs only in the server's own settings.

To check it worked, open `/outreach-start?component=leads` straight in the browser's address bar. You should see JSON such as
`{"connect_token":"…"}`. If you see your app's page, the route is still not reaching the server.

### 4c. Test it before touching the page

Start your server, then run this in a terminal, with your own key and a user id that exists in your product:

```
curl -X POST https://outreach.aivhub.com/api/embed/connect-sessions \
  -H "Authorization: Bearer psk_test_paste_your_key_here" \
  -H "Content-Type: application/json" \
  -d '{"external_id":"user-123","component":"leads"}'
```

You should get back `"linked": false` and a `connect_token`. That means your key works. A `401` means the key is wrong or has a
space in it. A `403` with "terms" in the message means you have not accepted the partner terms yet (Step 1). A `403` saying the integration is
paused means the Outreach team has paused it: write to them.

## Step 5. Paste this into your page (your developer)

This part runs **in the browser**, on the page of your product where the Outreach screen should appear. Your **publishable key**
(`pk_…`) goes here. It is safe to put in a page. Your **secret key** (`psk_…`) must never appear in it.

Before you paste, check three things:

- The page's address is in your list from Step 2, exactly as it shows in the browser bar. While testing on your own computer add
  `http://localhost:3000` (use your own port number).
- The route name matches Step 4. The snippets call `/outreach-start`.
- If your site sets a Content-Security-Policy, allow `https://outreach.aivhub.com` for scripts and frames.

**Pick the version that matches your product.**

**A plain page** (an `.html` file, or a template such as `templates/outreach.html`, `views/outreach.ejs` or `outreach.php`):
paste this where the screen should show, near the end of the page just before `</body>`.

```html
<div id="box" style="height: 700px"></div>
<script src="https://outreach.aivhub.com/embed.js"></script>
<script>
  const outreach = Outreach("pk_…", { host: "https://outreach.aivhub.com" });
  const ask = (component) => fetch("/outreach-start?component=" + component).then((r) => r.json());

  async function show(component) {
    const answer = await ask(component);
    if (answer.connect_token) {                      // first time: the person connects their account
      const win = outreach.connect({
        connectToken: answer.connect_token,
        onConnected: () => { win.close(); show(component); },   // close the window, then show the screen
      });
      win.open({ mode: "modal" });
      return;
    }
    outreach.create(component, {
      getToken: () => ask(component).then((a) => a.token),   // fetches a new pass when the old one ends
      appearance: "auto",                                    // matches your colours
    }).mount("#box");
  }
  show("leads");
</script>
```

Replace `pk_…` with your publishable key and `"leads"` with the screen you want.

**A React app** (also fine in Next.js, as a client component): create a new file `src/OutreachScreen.jsx`, paste this in, then use
`<OutreachScreen component="leads" />` on the page where the screen should appear. Do not add a script tag by hand: the file loads
it.

```jsx
import { useEffect, useRef } from "react";

const HOST = "https://outreach.aivhub.com";
const PUBLISHABLE_KEY = "pk_…"; // safe to keep in code

function loadOutreach() {
  if (window.Outreach) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `${HOST}/embed.js`;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

const ask = (component) => fetch(`/outreach-start?component=${component}`).then((r) => r.json());

export default function OutreachScreen({ component = "leads" }) {
  const box = useRef(null);

  useEffect(() => {
    let screen, win, gone = false;
    async function show() {
      await loadOutreach();
      if (gone) return;
      const outreach = window.Outreach(PUBLISHABLE_KEY, { host: HOST });
      const answer = await ask(component);
      if (gone) return;
      if (answer.connect_token) {
        win = outreach.connect({ connectToken: answer.connect_token, onConnected: () => { win.close(); show(); } });
        win.open({ mode: "modal" });
        return;
      }
      screen = outreach.create(component, { getToken: () => ask(component).then((a) => a.token), appearance: "auto" });
      screen.mount(box.current);
    }
    show();
    return () => { gone = true; if (screen) screen.destroy(); if (win) win.destroy(); };
  }, [component]);

  return <div ref={box} style={{ height: 700 }} />;
}
```

If your front end and server run on different addresses (for example the page on port 5173 and the server on port 3000), the
`fetch` in either version needs the server's full address, or a proxy set in your dev server's settings. Otherwise the page asks
itself and gets "not found".

**What the person sees:** the first time, a window opens where they sign in to Outreach (or create an account) and agree to what
you can do. When they finish it closes and the screen appears. After that the screen opens straight away.

## Step 6. Test it

1. Start your server (with `OUTREACH_SECRET` set, see Step 4a) and open your page in the browser. Sign in to your own product as a
   test user.
2. You should see the connect window. Sign in to an Outreach account, or create a new one, and tick the agreement. The window
   closes and the Leads screen appears.
3. Reload the page. The screen should open without the connect window.
4. If something fails, press F12 in the browser and open the **Console** tab, and the **Network** tab for the `outreach-start`
   request. The messages there match the table below.
5. Test keys only use fake credit. Nothing is sent to real people.

## Step 7. Go live

1. In **Partner programme → 3. Go live**, press the request button. It works once the terms are accepted and you have at least one web address and one return address. The Outreach team checks your integration and switches it on.
2. Make a new **live** secret key in Partner programme (it starts with `psk_live_`). The test key stops working for live use.
3. On your live website, open your hosting dashboard's "Environment variables" and replace the value of `OUTREACH_SECRET` with
   the live key. Your own `.env` file keeps the test key. Then redeploy or restart the live server.
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
| Console says `Unexpected token '<', "<!doctype "... is not valid JSON` | The page asked your own server for `/outreach-start` and got an HTML page back: the route does not exist, is served as a static file, or sits behind a catch-all that returns `index.html` | Add the Step 4 endpoint to your running server, before any catch-all, and check the address shows JSON (see "Things to get right"). Nothing is wrong at Outreach: the request never reached it |
| The `outreach-start` request in the Network tab shows `200` or `304` with an HTML response | Same cause. `304` only means the browser re-used a saved copy of that page | Same fix. Click the request and read its **Response** tab: it must be JSON |
| Your `curl` to `/api/embed/connect-sessions` works but the page still fails | Step 4c proves the key, not the route on your own site | Test `/outreach-start` itself, as in "Things to get right" |

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
