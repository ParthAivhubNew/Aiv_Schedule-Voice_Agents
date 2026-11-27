# Prompt to continue in a new session

Paste everything below the line into a new Claude Code session started in `/opt/flow`.

---

Continue my Outreach (Aivhub) launch work. Read this whole message first, then `docs/plans/10-…`, `11-…` and `12-…` in `/opt/flow-new/docs/plans/`. Each has a dated "Status" section saying what is done and what is left.

**Where things are**
- **Live app** (https://outreach.aivhub.com) runs from `/opt/flow` on `main`. Its backend container bind-mounts `/opt/flow/backend` and restarts on its own. Never switch branches, edit code or restart anything there. Only untracked plan copies live in `/opt/flow/docs/plans/`.
- **All work happens in the git worktree `/opt/flow-new`, on branch `company-rules-fsb-migration`.** **Keep the code on this branch only (my instruction, 2026-11-26): don't merge it into `main`.** It is 50 commits ahead of `main` and none are pushed. The server has no Gitea credentials, so I push myself with `git -C /opt/flow-new push -u origin company-rules-fsb-migration`.
- **Test app:** https://new.outreach.aivhub.com runs `/opt/flow-new` as compose project `flownew` (`docker-compose.new.yml`, containers `aivhub_new_*`). It has its own Postgres and Redis, holding a copy of live data.
  - `/opt/flow-new/.env` has `TEST_COPY=true` (`backend/app/core/test_copy.py`): live keys can't make outward writes. **Never remove it** while that file holds the live `SECRET_KEY`.
  - Reach it from the server with `--resolve new.outreach.aivhub.com:443:62.171.163.98`.
  - Deploy after a change:
    `cd /opt/flow-new && docker build -q -t flownew-frontend:latest frontend && docker compose -p flownew -f docker-compose.new.yml up -d --force-recreate frontend && docker compose -p flownew -f docker-compose.new.yml restart backend`
    Then wait for "Application startup complete" in `docker logs aivhub_new_backend`.

**How I want you to work**
- **Tests:** after each task, run only the tests for the files you changed, plus new tests. Run the full suite once at the end of a batch, before any push or merge, split across several throwaway Postgres containers in parallel. Never run two test containers against the same database.
  - Backend:
    1. `docker network create flow_test_net; docker run -d --rm --name flow_test_pg --network flow_test_net -e POSTGRES_USER=t -e POSTGRES_PASSWORD=t -e POSTGRES_DB=aiv_pytest pgvector/pgvector:pg16`
    2. Wait until `CREATE EXTENSION vector` succeeds in it.
    3. `docker run --rm --network flow_test_net -v /opt/flow-new/backend:/app -w /app -e TEST_DATABASE_URL=postgresql+asyncpg://t:t@flow_test_pg/aiv_pytest --entrypoint python flow-backend -m pytest -q <files> $(grep -vE '^\s*(#|$)' tests/known_failures.txt | sed 's/^/--deselect /')`
    4. Remove the container and network afterwards.
  - Frontend: `docker run --rm -v /opt/flow-new/frontend:/src:ro node:20-alpine sh -c 'cp -r /src /w && cd /w && rm -rf node_modules package-lock.json && npm install --no-audit --no-fund --loglevel=error >/dev/null 2>&1 && npx vitest run && npx eslint src/<changed paths> && npx vite build'`
- **Commits:** commit each finished task on the branch with `git -c user.name="jits023" -c user.email="<my account e-mail>" commit` and the `Co-Authored-By` line. Run the commit command on its own, not in the same command as a URL. When I say "Next task first" or "Commit and continue", commit the task you finished and go on. Never push.
- **Rules:**
  - Never print secrets or key tails.
  - Ask before anything destructive or anything that touches live.
  - Keep `fsbadmin` / `fsbuser`; they are being moved into the real FSB company, not retired.
  - Don't run paid provider checks (Google Places, Provero) without asking.
  - Use plain English on screens. Clients never see supplier names.
  - Update the plan docs' status sections as you go, and copy them to `/opt/flow/docs/plans/`.
  - Keep me posted while long jobs run.

**Done on the branch (details in the plans):**
- Plan 12, steps 1–7: company rules for every company, FSB as a real company, rule sets as data, the Rules screen, sign-in / Voice / Social rules everywhere, demo organisations, notices.
- Plan 11, steps 1–7: launch blockers, silent losses, cost ledger and profit per client, provider registry, plans with limits / cost cap / margin guard / fixed costs, Connectors and lead sources, launch tidy-up with a production config check and onboarding.
- Plan 10, Phases 0–3: real Connectors, honest provenance, the BN file's Google values view-only, lead sources on screens.
- Plan 10, Phase 4, partly:
  - One set of colour tokens, read from CSS variables.
  - One cobalt accent across the product, which a brand's accent replaces.
  - Shared Tooltip / EmptyState / Banner / Pill / Toast / StatTile in `app/ui.jsx`.
  - 438 hard-coded colours left in Leads, ratcheted by `tokens.test.js`.

**What's next, in order:**
1. ~~Run the full test suite.~~ **Done again 2026-11-26, after all the work below:** backend 2,275 passed (20 skipped; the known failures left out), frontend 746 passed, no lint errors, build clean. Run it again before a push if more work lands. Mount the frontend too (`-v /opt/flow-new/frontend:/frontend:ro`), because one backend test reads it.
2. **Look and feel (plan 10, Phase 4):**
   - ~~Social's small inline `Stat`.~~ Done 2026-11-26.
   - ~~Near-match colours.~~ Three passes done 2026-11-26 (438 hard-coded colours left in Leads, about 200 of them data that must stay; new tokens `lineStrong`, `limeSoft`, `limeInk`, `surface`, `onAccent`). What's left changes the look, so it needs a design decision and a browser check.
   - ~~Split `AccountsViews.jsx` and `FindLeadsView.jsx` into feature folders.~~ Done 2026-11-26 (`leadgen/accounts/`, `leadgen/find/`; the old files re-export). Its filter panel and results card moved into `find/FilterPanel.jsx` and `find/ResultsCard.jsx` on 2026-11-26 (checked in a browser); its state was grouped into hooks the same day (`find/useContactActions.js`, `useSelectionActions.js`, `useFavourites.js`; checked in a browser).
   - Dark mode: moved to the end of the list (below).
3. ~~Cost per source.~~ **Done 2026-11-25:** the Lead sources card shows credits by origin (plan 10, section 3.1).
4. ~~Prices before paid actions (plan 11, C.6).~~ **Done 2026-11-25:** every paid button reads its price from the rate card (`app/usePrice.js`), guarded by `app/noTypedPrices.test.js`. A public pricing page is still to do.
5. ~~Sign-up rate limits and bot protection (plan 11, C.1).~~ **Done 2026-11-26** (`services/signup_guard.py`). It also fixes the backend reading every visitor's address as the web container's, which made sign-up and sign-in limits shared by everyone. Cloudflare Turnstile isn't done: it needs a Cloudflare account.
6. ~~The shared wrapper for supplier calls (plan 11, step 4).~~ **Done 2026-11-26:** `app/providers/gateway.py` (plan, shared cache, cost cap, circuit breaker, key, one log row per call). Google Places is on it. Tavily, Telnyx lookup, Provero, the e-mail finders and Apollo moved onto it the same day, so every paid provider uses it.
7. ~~Config-only providers (plan 11, step 4).~~ **Done 2026-11-26:** staff add an e-mail finder on the Providers page with no code (`app/providers/generic_http.py`). Plan 11 step 4 is done.
8. ~~Pre-filled sample search in Get started (plan 11, C.6).~~ **Done 2026-11-26:** the company's own ideal customers, or accountants and bookkeepers.
9. ~~Public pricing page (plan 11, C.6).~~ **Done 2026-11-26** at `/pricing`, from the server's plans and rate card. It mentions VAT only when Stripe adds it.
10. ~~Sample data in demo organisations (plan 12).~~ **Done 2026-11-26:** an optional sample list of up to 25 companies. Plan 12 is now done.
11. ~~Company rules that switch off when they can't be read (plan 11, C.1).~~ **Checked 2026-11-26:** they already fail safe; the cache and Connectors were tidied.
12. ~~Monthly spending limits per supplier.~~ **Done 2026-11-26:** Providers → Monthly budgets (alerts at 80% and 100%, optional pause).
13. ~~Retention for call recordings and supplier logs.~~ **Done 2026-11-26:** staff portal → Data compliance → How long data is kept. Decided: default periods; **switch it on when the branch goes live** (staff portal → Data compliance), not on the test copy; raw register data is kept.

**Still open, in order (2026-11-26):**
1. ~~**LiveKit is open to the internet.**~~ Closed on live 2026-11-26:
   - Nothing outside the server uses it. The backend reaches it inside Docker (`ws://livekit:7880`). No room has been made on live since it restarted on 2026-10-18; its log shows only internet scanners.
   - The browser's "Test call in web (LiveKit)" button (Voice) is handed `wss://<site>:7880`. Port 7880 has no TLS, so that button can't work over HTTPS today, and closing the port changes nothing for it.
   - **Worse than open: live uses the published development key and secret** (`devkey`, the same in `livekit.yaml` and the compose defaults). Anyone who can reach port 7880 can make room tokens.
   - **On the branch:** `docker-compose.override.yml` binds 7880–7882 to 127.0.0.1 (the test copy doesn't read that file).
   - ✅ **Applied to live 2026-11-26** (my OK): the same block is in `/opt/flow/docker-compose.override.yml` and only the LiveKit container was recreated. Ports 7880–7882 now listen on 127.0.0.1 only; the public address is refused; the backend still reaches `livekit:7880`; the site answers.
   - **Still waiting on my OK (touches live):** new random `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` in `/opt/flow/.env` and `livekit.yaml`, then restart LiveKit and the backend. Less urgent now that the port is closed.
   - Later: either serve LiveKit through nginx with TLS so the browser test call works, or hide that button.
2. ~~**Colour passes for Voice, Social and the home screen**, and naming Leads' deliberate colour sets.~~ **Done 2026-11-26** (plan 10, Phase 4): Voice / Social / home 1,021 → 440 hard-coded colours, Leads 438 → 400, all four folders ratcheted. No visible change. Settings and calendar done the same day (1,111 → 686, ratcheted). What's left in all six folders is data, deliberately fixed looks (dark code blocks, a partner's theme preview) or colours with no token yet; dark mode decides those.
3. ~~Optional: the Find Leads map-area actions as a hook.~~ **Done 2026-11-26** (`find/useMapArea.js`). Checked in a browser: it found and fixed an older bug where a first-drawn area was overridden by the opening list's retry. Stop and Clear area weren't covered.
4. **Simplify the whole app (plan 13, written 2026-11-26).** The owner found the app confusing: the client's name where Outreach should be, a congested side menu, settings in five places, and a staff portal with 16 flat items under 36 mostly repeated alerts. Plan 13 sets out one shell, one menu, one Settings page, a calm Home and a grouped staff portal, in 9 steps. Decisions answered 2026-11-26 (the company shows only at the bottom of the sidebar; keep the app switcher; unbought apps get a quiet "Try" line; start with steps 1–2). **Steps 1–2 done** (Outreach identity everywhere; staff menu in five groups; repeated alerts counted, not added). **Step 3 done and checked by the owner 2026-11-27** (every app's menu has the same short shape: work, then one Settings entry holding the setup pages; the AI Assistant only in the header; Support and Documentation in the profile menu, following the app; "Try" in the app switcher). **Step 4 done** (one Settings page at /settings with its own left list; the profile menu cut to profile, Settings, help and Sign out; the Users, profile, Connections and API keys windows now draw inside it), waiting for the owner's look. Next: step 5, Home.
5. **Dark mode, last** (now step 9 of plan 13): a dark value for every shared colour, a light / dark / match-system switch, and a check of each screen.

**Waiting on me (ask, don't guess):**
- Stripe live keys and VAT.
- `STAFF_ADMIN_EMAIL` on live.
- An off-site backup destination.
- An error-tracking account.
- FSB's real e-mail addresses for `fsbadmin` / `fsbuser`, and whether to make both choose a new password.
- Prices for DeepSeek and Apollo, and for Leads / Social top-ups.
- Whether to raise AI video to 39 credits and phone-number rent to 18 (I said "not yet").
- Vendor licence terms.
- Whether to add Cloudflare Turnstile to sign-up (needs a Cloudflare account).
- Whether to patch live now for the BN Google export gap (on `main`, BN phones and websites can be exported; none have been yet).

**After the branch is merged and live:**
- Staff run `POST /admin-api/maintenance/provenance`, first as a dry run, then with `{"apply": true}`.
- Delete the old `bn_*.py`, `bn_*.sh`, `load_*.py` and `industry_values.py` files in the `/opt/flow` root. Copies are in `backend/scripts/data_loads/`.
- Set `APP_ENV=production` only once live Stripe keys are in, or the config check stops start-up.
- Switch data retention on (staff portal → Data compliance → How long data is kept), after looking at its dry run.
