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
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | "Sign in with Google" (button appears once set) |
| `ALLOW_SIGNUP` | `true` to let new companies register themselves |
| `CALL_WINDOW_ENFORCEMENT` | Default calling-hours mode if an organisation has not chosen one |
| `EXPOSE_API_DOCS` | `true` only if you want `/docs` public (off by default) |

## 4. Library update to run once (blocked in the build environment)

```bash
cd frontend
npm install https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
```

This replaces `xlsx@0.18.5`, which has known security issues when opening untrusted files.
