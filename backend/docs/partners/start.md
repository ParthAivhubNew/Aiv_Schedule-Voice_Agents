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

This endpoint answers one question for your page: is this user connected, and if so, here is a pass. Put your secret key in an
environment variable called `OUTREACH_SECRET`, never in the code.

```js
// Node (Express). Add this route to your server.
const OUTREACH = "https://outreach.aivhub.com/api/embed";
const headers = { "Authorization": `Bearer ${process.env.OUTREACH_SECRET}`, "Content-Type": "application/json" };

app.get("/outreach-start", async (req, res) => {
  const external_id = String(req.user.id);          // your own id for the person who is signed in
  const component = req.query.component || "leads"; // leads, campaigns, mail, voice or social

  const check = await fetch(`${OUTREACH}/connect-sessions`, { method: "POST", headers, body: JSON.stringify({ external_id, component }) });
  const info = await check.json();
  if (!info.linked) return res.json({ connect_token: info.connect_token });   // not connected yet

  const pass = await fetch(`${OUTREACH}/sessions`, { method: "POST", headers, body: JSON.stringify({ external_id, component }) });
  res.json({ token: (await pass.json()).token });
});
```

Any language works. Each call is a `POST` with the header `Authorization: Bearer <your secret key>` and a JSON body.

## Step 5. Paste this into your page (your developer)

Replace `pk_…` with your publishable key and `#box` with the element that should hold the screen.

```html
<div id="box"></div>
<script src="https://outreach.aivhub.com/embed.js"></script>
<script>
  const outreach = Outreach("pk_…");
  const ask = (component) => fetch("/outreach-start?component=" + component).then((r) => r.json());

  async function show(component) {
    const answer = await ask(component);
    if (answer.connect_token) {                      // first time: the person connects their account
      outreach.connect({ connectToken: answer.connect_token, onConnected: () => show(component) }).open({ mode: "modal" });
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

The first time, a window opens where the person signs in to Outreach (or creates an account) and agrees to what you can do. After
that, the screen opens straight away.

## Step 6. Test it

1. Open your page signed in as a test user. You should see the connect window, then the Leads screen.
2. Reload. The screen should open without the connect window.
3. Test keys only use fake credit. Nothing is sent to real people.

## Step 7. Go live

1. In **Partner programme → 3. Go live**, press the request button. It works once the terms are accepted and you have at least one web address and one return address. The Outreach team checks your integration and switches it on.
2. Make a new **live** secret key in Partner programme. The test key stops working for live use.
3. Put the live key in `OUTREACH_SECRET` and deploy.

## If something goes wrong

| What you see | Why | Fix |
|---|---|---|
| An empty box, "refused to connect" | Your page's address is not in the list | Add it in Step 2, exactly as it appears in the browser |
| `403` when your server asks for a pass | The request came from a browser, or the key is wrong | Call Outreach only from your server, with the secret key |
| `404` for a user | That user is not connected yet | Run the connect window for them (Step 5) |
| The screen stops after 15 minutes | The page kept an old pass | Use `getToken` as in Step 5. It fetches a fresh one |
| "…is not on this account yet" | The account has no plan for that screen | The person buys the plan on Outreach |
| The person cannot connect | Only the account's admin can connect it | Ask the admin of that Outreach account |

## What next

- Change the look, popups and side panels, and which screens exist: see the **Embedding reference**.
- Use the same account from your server (calls, lists, webhooks): see the **API reference**.
- Stuck? Write to the Outreach team and include the time and the user id.
