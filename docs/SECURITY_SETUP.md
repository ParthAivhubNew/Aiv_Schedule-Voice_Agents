# Security setup for the live server

Do these once, in this order. Nothing here changes the app's code.

## 1. Change the secrets that were in the repository

These values were committed to git and must be treated as public. Create new ones at each
provider, then put the new values on the server (step 2).

| Secret | Where to change it |
|---|---|
| SIPgate SIP password | SIPgate account → SIP trunk / device settings |
| LiveKit API key + secret (`devkey` / `secret1234…`) | Generate a new pair, put it in `livekit.yaml` (`keys:`) **and** the backend env |
| `SECRET_KEY` (signs sign-in tokens) | Any long random string, e.g. `openssl rand -base64 48` |
| Anything else in the committed root `.env` | Rotate it too |

After `SECRET_KEY` changes, everyone signs in again once. Nothing else is affected.

## 2. Move secrets out of git

The root `.env` is in git even though `.gitignore` lists it. Removing it from git deletes it on
the server at the next `git pull`, so move it first:

```bash
# on the server, in the project folder
cp .env /opt/outreach/.env.production      # keep a copy outside the repo
# edit /opt/outreach/.env.production with the NEW values from step 1
# point docker compose at it (either):
#   docker compose --env-file /opt/outreach/.env.production up -d
# or copy it back as .env after the pull below
```

Then, from a development machine:

```bash
git rm --cached .env
git commit -m "Stop tracking .env"
git push
```

On the server after `git pull`, make sure the env file is in place before restarting.

## 3. Environment variables the app now reads

| Variable | Needed for |
|---|---|
| `SECRET_KEY` | Sign-in tokens (if missing, a random key is stored in the database) |
| `ADMIN_PASSWORD` | First admin password on a brand-new database (must be changed at first sign-in) |
| `PUBLIC_BASE_URL` | `https://outreach.aivhub.com` (links in emails, webhooks) |
| `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | LiveKit (same pair as `livekit.yaml`) |
| `SIPGATE_SIP_ID`, `SIPGATE_PASSWORD` | SIPgate trunk, only if you use it (no longer built in) |
| `SYSTEM_MAIL_HOST`, `SYSTEM_MAIL_PORT`, `SYSTEM_MAIL_USER`, `SYSTEM_MAIL_PASSWORD`, `SYSTEM_MAIL_FROM`, `SYSTEM_MAIL_FROM_NAME`, `SYSTEM_MAIL_TLS` | Platform email (invites, resets, verification) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | "Sign in with Google" (button appears once set). In Google Cloud → Credentials → OAuth client (Web application), add the redirect URI `https://outreach.aivhub.com/api/auth/google/callback` |
| `ALLOW_SIGNUP` | `true` to let new companies register themselves (with the platform mailbox set, they must confirm their email first) |
| `STARTER_CREDITS` | Credits a self-signup organisation starts with (default 500); those organisations stop at zero |
| `TELNYX_API_KEY` | Our (manager) Telnyx key: number search/orders, verification, WhatsApp |
| `TELNYX_ACCOUNT_MODE` | `billing_group` (default: one Telnyx account, a billing group per client) or `managed_account` (a Telnyx managed account per client, once Telnyx approves us as a manager) |
| `TELNYX_CONNECTION_ID`, `TELNYX_MESSAGING_PROFILE_ID` | billing_group mode: the Call Control app and messaging profile new numbers attach to (managed accounts get their own automatically) |
| `TELNYX_ASSISTANT_PUBLIC_KEY` | Telnyx public key (Mission Control → Keys & Credentials); every Telnyx webhook is checked against it |
| `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` | Payments. Use `sk_test_…` keys first (the app shows "test mode"), then swap in live keys |
| `PLATFORM_ORG_ID` | Organisation whose admins are OutReach staff: they add credits and set rates (default `org_default`) |
| `CALL_WINDOW_ENFORCEMENT` | Default calling-hours mode if an organisation has not chosen one |
| `EXPOSE_API_DOCS` | `true` only if you want `/docs` public (off by default) |

## 4. Library update to run once (blocked in the build environment)

```bash
cd frontend
npm install https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
```

This replaces `xlsx@0.18.5`, which has known security issues when opening untrusted files.

## 5. Telnyx: numbers, verification and WhatsApp

1. Set `TELNYX_API_KEY` and `TELNYX_ASSISTANT_PUBLIC_KEY` (and the mode, see above).
2. In Mission Control, send webhooks for **number orders** and **requirement groups** to
   `https://outreach.aivhub.com/api/telnyx/webhook`.
3. On the messaging profile used for WhatsApp, set the webhook to
   `https://outreach.aivhub.com/api/telnyx/messaging-webhook`.
4. WhatsApp per number: the client presses *Turn on WhatsApp* on the Numbers page; complete the
   Meta business signup for that number in the Telnyx portal, then switch the number on for them
   (staff portal). Until then the number shows "WhatsApp requested".

Webhooks only make the app re-read the order or verification from Telnyx, so a forged webhook
cannot mark anything approved. The Numbers page also re-checks pending items every minute.

## 6. Stripe (UK account, prices in USD, clients pay in GBP)

1. Stripe Dashboard → Settings → Payments → **Adaptive Pricing**: turn it on (the app also asks
   for it on every Checkout).
2. Developers → Webhooks → add endpoint `https://outreach.aivhub.com/api/billing/webhook` with
   events `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`,
   `customer.subscription.updated`, `customer.subscription.deleted`. Copy its signing secret into
   `STRIPE_WEBHOOK_SECRET`.
3. Settings → Billing → **Customer portal**: turn it on (clients change card, plans, invoices there).
4. In the app (staff, Team → Plans & credits): add plans and top-ups per plugin, then press
   **Create in Stripe** on each to put it on sale.

Credits are only granted from signed Stripe webhooks, and each Stripe event is applied once.
Plan credits expire at the next renewal; top-ups 30 days after purchase; the batch closest to
expiry is spent first.
