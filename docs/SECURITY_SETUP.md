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
| `STARTER_CREDITS` | Free trial credits a self-signup organisation gets in each app, for 30 days (default 0: no trial); those organisations stop at zero |
| `TELNYX_API_KEY` | Our (manager) Telnyx key: number search/orders, verification, WhatsApp |
| `TELNYX_ACCOUNT_MODE` | `billing_group` (default, pay-as-you-go: one Telnyx account and balance, a billing group per client, section 5) or `managed_account` (a Telnyx managed account per client, once Telnyx approves us as a manager) |
| `TELNYX_DAILY_SPEND_LIMIT_USD` | Optional. Pay-as-you-go: a cap Telnyx itself enforces on each client's outbound calls per day (USD), set on its outbound profile when the profile is created |
| `TELNYX_MAX_DESTINATION_RATE` | Optional. Pay-as-you-go: calls to destinations dearer than this per minute (USD) are refused by Telnyx |
| `FX_USD_TO_GBP` | Optional. Staff margin report: converts Telnyx's USD costs to GBP (e.g. `0.79`); without it the margin column is left blank |
| `TELNYX_CONNECTION_ID`, `TELNYX_MESSAGING_PROFILE_ID` | billing_group mode: the Call Control app and messaging profile new numbers attach to (managed accounts get their own automatically) |
| `TELNYX_ASSISTANT_PUBLIC_KEY` | Telnyx public key (Mission Control → Keys & Credentials); every Telnyx webhook is checked against it |
| `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` | Payments. `.env.local` (in git) holds the sandbox's TEST keys so every developer can try payments; the app then shows "test mode". On the live server put the `sk_live_…`/`pk_live_…` keys and the live webhook secret in `.env`, which overrides `.env.local`; never commit live keys. A server without its own keys runs in test mode |
| `STRIPE_AUTOMATIC_TAX` | `true` once Stripe Tax is set up (section 6): Checkout adds VAT/sales tax and asks business customers for a VAT number |
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

### Pay-as-you-go: one Telnyx balance, clients pay us

Customer → OutReach → customer's prepaid credits → Telnyx usage. Clients never see Telnyx or its
prices; they pay us (Stripe) and we pay Telnyx from one balance.

- **Per client on Telnyx**, made automatically the first time the client opens Numbers (and for
  existing clients, on their next call or visit to Numbers): a **billing group**; an **outbound
  voice profile** in that billing group, limited to the client's countries (UK by default) and
  the optional caps above; and a **Call Control app** on that profile. Numbers bought for the
  client go in its billing group; its outbound calls from those numbers are dialled through its
  own app. So Telnyx reports every client's calls separately. A billing group is for reports
  only: it holds no money, and all usage comes out of our one balance.
- **Our app is the source of truth for balances.** A client on our account has its credits
  enforced (set when its outbound profile is made): a call is refused when its Voice credits are
  gone, and each call is capped at the minutes left plus 5 minutes' grace.
- **Margin.** Clients pay our prices (plans, top-ups, and a monthly price per number set in the
  rate card as "Phone number, per month"; 0 = included). Team → Plans & credits → *Telnyx costs
  and margin* (staff) shows, per client and month, Telnyx's cost for its billing group (Telnyx
  usage reports), the minutes we billed against the minutes Telnyx billed, what the client paid
  us, and the margin. Products Telnyx does not report per billing group (Telnyx could not confirm
  this for Voice AI charges) appear as account-wide totals, never split by guesswork.
- **Inbound calls** answered by the Telnyx-hosted assistant cannot be refused by our app before
  they start; their minutes are charged afterwards like any call.
- **Moving to managed accounts later**: set `TELNYX_ACCOUNT_MODE=managed_account` once Telnyx
  approves it; new clients then get their own account and balance.

## 6. Stripe (UK account, prices in GBP, clients abroad pay in their own currency)

1. Stripe Dashboard → Settings → Payments → **Adaptive Pricing**: turn it on (the app also asks
   for it on every Checkout).
2. Developers → Webhooks → add endpoint `https://outreach.aivhub.com/api/billing/webhook` with
   events `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `invoice.paid`,
   `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`.
   Copy its signing secret into `STRIPE_WEBHOOK_SECRET`.
3. Settings → Billing → **Customer portal**: turn it on (clients change card, plans, invoices there).
4. In the app (staff, Team → Plans & credits), put plans and top-ups on sale either way:
   - Products already made in Stripe (monthly = plan, one-off = top-up) are listed under
     *Already in your Stripe account*: check the app (guessed from the product name), enter
     the credits each gives (a Voice credit is a minute of calls, so 1 hour = 60 credits) and press
     **Put on sale**. The credits of anything on sale can be corrected in the list above it.
   - Or add a plan here (USD) and press **Create in Stripe**.
5. Tax (optional): Settings → Tax: add the head office address, your tax registrations, the default
   tax code (software as a service) and whether prices include tax. Then set `STRIPE_AUTOMATIC_TAX=true`.

Admins manage each app's plan on its **Subscription** page (Voice, Post scheduler and Lead
generation sidebars): subscribe, move to another plan, cancel at the end of the paid period (or keep
it after all), buy one-off top-ups, and open Stripe for the card and invoices. Team → Plans &
credits shows every app together. Each purchase of a plan is its own Stripe subscription, so a
app can be added, changed or cancelled without touching the others. Subscriptions and top-ups
both produce a Stripe invoice.

Changing plan: a dearer plan starts at once, the card is charged the difference for the rest of
the period and only the extra credits are added; if the bank asks for confirmation the customer
pays on Stripe's invoice page and the plan changes once paid. A cheaper plan starts at the next
renewal, with nothing refunded and this period's credits kept.

Credits are only granted from signed Stripe webhooks, and each Stripe event is applied once.
Plan credits expire at the next renewal (no rollover); top-ups never expire; the batch closest to
expiry is spent first.
