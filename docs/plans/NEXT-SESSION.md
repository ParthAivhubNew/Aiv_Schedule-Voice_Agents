# Prompt to continue in a new session

Paste everything below the line into a new Claude Code session started in `/opt/flow`.

---

Continue my Outreach (Aivhub) launch work. Read this whole message first, then `docs/plans/10-…`, `11-…` and `12-…` in `/opt/flow-new/docs/plans/`. Each has a dated "Status" section saying what is done and what is left.

**Where things are**
- **Live app** (https://outreach.aivhub.com) runs from `/opt/flow` on `main`. Its backend container bind-mounts `/opt/flow/backend` and restarts on its own. Never switch branches, edit code or restart anything there. Only untracked plan copies live in `/opt/flow/docs/plans/`.
- **All work happens in the git worktree `/opt/flow-new`, on branch `company-rules-fsb-migration`.** It is 33 commits ahead of `main` and none are pushed. The server has no Gitea credentials, so I push myself with `git -C /opt/flow-new push -u origin company-rules-fsb-migration`.
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
  - 556 hard-coded colours left in Leads, ratcheted by `tokens.test.js`.

**What's next, in order:**
1. ~~Run the full test suite.~~ **Done 2026-11-25:** backend 2,212 passed (known failures left out), frontend 728 passed. Run it again before a push if more work lands. Mount the frontend too (`-v /opt/flow-new/frontend:/frontend:ro`), because one backend test reads it.
2. **Look and feel (plan 10, Phase 4):**
   - ~~Social's small inline `Stat`.~~ Done 2026-11-26.
   - ~~Near-match colours.~~ First pass done 2026-11-26: the invisible ones (556 hard-coded colours left in Leads). What's left changes the look, so it needs a design decision and a browser check.
   - ~~Split `AccountsViews.jsx` and `FindLeadsView.jsx` into feature folders.~~ Done 2026-11-26 (`leadgen/accounts/`, `leadgen/find/`; the old files re-export). The 1,250-line `FindLeadsSearch` component is still one piece.
   - Dark mode later.
3. ~~Cost per source.~~ **Done 2026-11-25:** the Lead sources card shows credits by origin (plan 10, section 3.1).
4. ~~Prices before paid actions (plan 11, C.6).~~ **Done 2026-11-25:** every paid button reads its price from the rate card (`app/usePrice.js`), guarded by `app/noTypedPrices.test.js`. A public pricing page is still to do.
5. ~~Sign-up rate limits and bot protection (plan 11, C.1).~~ **Done 2026-11-26** (`services/signup_guard.py`). It also fixes the backend reading every visitor's address as the web container's, which made sign-up and sign-in limits shared by everyone. Cloudflare Turnstile isn't done: it needs a Cloudflare account.
6. ~~The shared wrapper for supplier calls (plan 11, step 4).~~ **Done 2026-11-26:** `app/providers/gateway.py` (plan, shared cache, cost cap, circuit breaker, key, one log row per call). Google Places is on it. **Next:** move Tavily, Telnyx lookup and Provero onto it, then config-only providers.

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
