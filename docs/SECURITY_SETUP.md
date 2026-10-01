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
| `TELNYX_MANAGED_ASSISTANTS` | `true` to give every user their own Telnyx AI Assistant, made and kept up to date by the app (section 8). Off: calls use the assistant ID pasted in AI config, as before |
| `TELNYX_ASSISTANT_MODEL`, `TELNYX_ASSISTANT_VOICE` | Optional. The model and voice the managed assistants use (Telnyx's names, e.g. as shown in the Telnyx portal); empty = Telnyx's defaults |
| `TELNYX_SCRIPT_VAR_LIMIT` | Optional. How many characters of a script are sent with each call (default 6000); the assistant reads the rest with a tool |
| `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` | Payments. `.env.local` (in git) holds the sandbox's TEST keys so every developer can try payments; the app then shows "test mode". On the live server put the `sk_live_…`/`pk_live_…` keys and the live webhook secret in `.env`, which overrides `.env.local`; never commit live keys. A server without its own keys runs in test mode |
| `STRIPE_AUTOMATIC_TAX` | `true` once Stripe Tax is set up (section 6): Checkout adds VAT/sales tax and asks business customers for a VAT number |
| `PLATFORM_ORG_ID` | OutReach's own organisation (default `org_default`). Only its admins see and change AI, carrier and provider keys (AI config); every other organisation uses the keys OutReach runs. It gives no staff powers: those are in the staff admin portal (section 7) |
| `STAFF_ADMIN_EMAIL`, `STAFF_ADMIN_PASSWORD` | First staff admin of the staff admin portal (`/admin`), created at startup when there is no staff account yet. Remove the password from the env file after the first sign-in |
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
   (staff admin portal → Queue → *Switch WhatsApp on*; the client is told). Until then the number
   shows "WhatsApp requested".

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
  rate card as "Phone number, per month"; 0 = included). Staff admin portal → Plans & pricing →
  *Telnyx costs and margin* shows, per client and month, Telnyx's cost for its billing group (Telnyx
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
4. In the staff admin portal (`/admin` → Plans & pricing), put plans and top-ups on sale either way:
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

## 7. Staff admin portal (`/admin`)

The Aivhub team runs the platform from its own site at `https://outreach.aivhub.com/admin`,
separate from the client app:

- **Own accounts.** Staff accounts are not client users: no client role can become staff, a client
  sign-in never opens `/api/admin-api`, and a staff sign-in never opens the client app. The first
  staff admin comes from `STAFF_ADMIN_EMAIL` / `STAFF_ADMIN_PASSWORD`; add the rest under *Staff*.
- **Two-factor sign-in is required.** At the first sign-in the portal shows a QR code for an
  authenticator app (Google Authenticator, Microsoft Authenticator, 1Password); every sign-in
  after that needs the 6-digit code. Wrong passwords or codes are limited to 6 per 15 minutes.
  A lost phone: another staff admin presses *Reset two-factor* for that person.
- **Roles.** *Admin* can change things; *Support* can look at everything but change nothing.
- **Pages.** Dashboard (totals and platform services), Clients (wallets, adding or removing
  credits, stop-at-zero, numbers and WhatsApp, verification, users, orders, credit history,
  suspend/reactivate), Queue (business verifications and WhatsApp requests waiting on us),
  Plans & pricing (plans, prices made in Stripe, the rate card, Telnyx costs and margin), Logs
  (all clients) and Staff.
- **Suspending a client** signs everyone in it out at once; nobody in it can sign in until it is
  reactivated.
- **Hosting.** nginx serves `admin.html` for every `/admin` path (not cached, not indexed, not
  framed). To limit it further, allow only office/VPN addresses on that location in nginx.

## 8. Managed voice assistants (`TELNYX_MANAGED_ASSISTANTS=true`)

- **One assistant per user,** made in Telnyx the first time they call (and one per organisation
  for numbers nobody is assigned to). Named `OutReach · <company> · <user>`; nobody pastes IDs.
- **The assistant in Telnyx is a fixed shell**: rules and placeholders only. Scripts, company
  details and the prospect are sent with every call, so editing a script never needs Telnyx and
  two scripts can never clash. Changes made by hand in Telnyx are put back within a day, or at
  once when the shell changes in a release.
- **During the call** the assistant calls our tools at `/api/telnyx-assistant/tools/...`:
  look up knowledge, check availability, book a meeting, ask for a person, save the outcome,
  read the rest of a long script. Every tool request is signed by Telnyx and carries the call's
  own signed reference, so it only touches that call's organisation and data.
- **Numbers:** a user calls from any of the organisation's numbers they may use; their own
  assistant talks. Incoming calls are answered by the assistant of the user the number is
  assigned to, or the organisation's shared one.
- **Set-up:** point the webhook of the Call Control app your numbers use (`TELNYX_CONNECTION_ID`)
  to `https://outreach.aivhub.com/api/telnyx-assistant/call-control`, so incoming calls reach
  the app. Calls we dial set their own webhook, so nothing else changes.
- **Before switching it on for clients:** make one test call each way with a real number.
- **Agent Studio** (Voice → Agent Studio): each user picks their assistant's voice and model from
  the list staff keep in the admin portal (Platform AI → Call assistant voices and models; use
  Telnyx's exact names) and adds their own phone. Admins set the company's call rules (handover,
  never say, what to find out, recording) and a script per campaign. Recording is off by default;
  when on, Telnyx records the call and the agent says the recording notice first.
- **Taking over a call:** Live → Take over pauses the assistant and rings the user's own phone
  from the call's number; answering joins them to the call. Hand back (with an optional note)
  hangs up their phone and the assistant carries on from the note. Hanging up also hands back.

## 9. Revenue and costs (admin portal → Revenue)

Per month: what clients paid per app (from Stripe payments), usage per item (call minutes,
WhatsApp messages, AI posts, leads), our cost (units × "our cost per unit", which staff enter on
the same page), margin per client, failed payments, live subscriptions and the monthly value of
live plans. Telnyx's real cost per client is under Plans & pricing → Telnyx costs and margin.

What uses credits: call minutes, WhatsApp messages and phone numbers (Voice), AI-written posts
(Post scheduler) and leads found in Lead generation (one credit per lead by default; staff can
change it in the rate card). Email sends are priced but not charged: Email outreach does not send
outreach emails yet.

