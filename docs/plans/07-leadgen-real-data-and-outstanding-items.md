# Plan G — Make Leadgen's data real, plus every other outstanding item from this project

## Part 1: AI Lead Scout — swap fake data for the real backend (small, precise fix)
Confirmed: the real backend endpoint already exists and already works —
`POST /enrichment/discover-accounts` (`backend/app/api/enrichment.py:169-188`), calling
`discover_new_target_accounts()` in `enrichment_service.py`, which does a real web search and
returns real companies (name, phone if found, website, a fit score, an opening-line hook). It
already charges `lead_lookup` credits per account found, server-side, automatically. The frontend
API client function already exists too (`api.discoverAccounts`, `apiClient.js:331`). Nothing on
the backend needs building — only the frontend's fake handler needs replacing.

**File**: `frontend/src/plugins/leadgen/LeadGenerationPlugin.jsx`, `handleSimulatedSearch`
(currently ~line 351). Replace the `setTimeout` fabrication with:
```js
const handleSearch = async (e) => {
  e.preventDefault();
  if (!searchQuery.trim()) return;
  setIsSearching(true);
  try {
    const res = await api.discoverAccounts({ query: searchQuery, target_role: undefined });
    const mapped = (res.leads || []).map((d) => ({
      id: d.id, companyName: d.name, domain: d.site ? d.site.replace(/^https?:\/\//, "") : "",
      website: d.site || "", industry: d.sector || "", region: d.region || "",
      employees: "", decisionMaker: d.contactPerson || "", title: "", phone: d.phone || "",
      email: "", matchScore: d.fit || 0, status: "new", openingHook: d.openingHook || "",
      techStack: [], revenueEst: "", tags: ["Live Web Discovery"],
    }));
    setLeads((prev) => [...mapped, ...prev]);
    showToast(`Found ${mapped.length} account${mapped.length === 1 ? "" : "s"} for "${searchQuery}".`);
  } catch (err) {
    showToast(err.message || "Search failed.");
  } finally {
    setIsSearching(false);
  }
};
```
Note the real data has **no fabricated fields**: no fake employee count, decision-maker title, tech
stack, revenue estimate, or email (email only ever comes from the separate Find Work Email flow,
which already works and already costs its own credit) — don't backfill these with invented
placeholders the way the fake version did; leave them blank and let the UI show "—" for unknowns,
consistent with how `fill_contact_gaps` elsewhere in this codebase already refuses to invent data.

## Part 2: CSV Import — also already built server-side, just never connected
Confirmed: `POST /missions/upload-parse` (`backend/app/api/missions.py:195-`) already does real
CSV/XLSX/XLS parsing with automatic column detection (company/phone/website/contact). The
"Browse Files" button in Leadgen's Import & Export tab currently just shows a toast and does
nothing. Wire it to a real file input calling this endpoint, map the returned rows into the same
`leads` shape used above, same "don't invent missing fields" rule.

## Part 3 — the bigger finding: "Saved Accounts" isn't persisted anywhere, real or fake
Checked directly: `const [leads, setLeads] = useState(INITIAL_DUMMY_LEADS)` is the *only* place
this data lives — no `useLoad`, no API fetch, nothing server-side. Every account in Saved
Accounts/Decision Makers/Account Dossiers vanishes on page refresh and is invisible to any other
team member, even after Parts 1 and 2 above make the *source* of the data real. The backend
already has the right model for this — `Mission`/`Prospect`
(`backend/app/api/missions.py` `POST ""` creates a mission, `backend/app/api/prospects.py` lists
them) — already used by the Voice plugin for exactly this concept.

**Decision needed from you**: keep the leads list as a browser-only convenience (cheap, nothing
to build, but lost on refresh and not shared with your team), or make it a real persisted list
backed by `Mission`/`Prospect` like Voice's calling list already is (bigger: needs a `POST
/prospects` endpoint that doesn't currently exist, since today prospects only come from mission
processing, plus wiring Leadgen's UI to load/save through it instead of local state). I'd
recommend the real version — it's the only way Parts 1 and 2 actually stick — but it's
meaningfully more work than Parts 1-2 alone, so it's your call whether that's in scope now or
later.

## Part 4 — connects back to auto-enroll (already flagged, now has a real home)
Once Scout (Part 1) and/or CSV import (Part 2) produce real leads tied to a real `Mission` (Part
3), the auto-enroll feature already built earlier (`Mission.auto_enroll_campaign_id`, wired into
`enrichment_waterfall.py`) finally has a real trigger path — a lead found through the *actual*
discovery flow, not just the standalone Find Work Email tool. This was flagged as a gap earlier;
Part 3 is what actually closes it, not a separate task.

---

## Every other outstanding item from this project, so nothing gets lost

**Voice call AI cost tracking** (`docs/plans/06-voice-call-ai-cost-tracking.md`) — written,
not started. Needs your decision (second customer charge vs. internal cost-visibility only) and
an investigation step (what usage data Telnyx's webhook and the LiveKit path actually expose)
before building.

**Embeddings and Messaging aren't truly per-plugin isolated** — they're visually under the Voice
tab in Platform Keys, but the backend still reads from one shared pool underneath (unlike LLM and
Image, which are genuinely separated now). Flagged as a deliberate scope cut at the time because
I couldn't live-test the knowledge-base/RAG path. Still open if you want full parity with LLM/Image.

**Meta/LinkedIn/Stripe credentials are `.env`-only, no admin UI** — confirmed by reading the code:
`LINKEDIN_OAUTH_CLIENT_ID/SECRET`, `FACEBOOK_OAUTH_CLIENT_ID/SECRET` (or `FACEBOOK_APP_ID/SECRET`),
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PUBLISHABLE_KEY` all require editing the
server's `.env` and restarting. I offered to move these into the admin UI the same way provider
keys were redesigned — still open, your call whether it's worth building.

## Build order
1. Part 1 (Scout) — small, self-contained, do first.
2. Part 2 (CSV Import) — small, self-contained, independent of Part 1.
3. Part 3 (persistence decision + build, if you want it) — the real unlock for everything else;
   do this before Part 4 matters.
4. Part 4 (auto-enroll) — falls out of Part 3, not separate work.
5. Voice AI cost tracking, Embeddings/Messaging isolation, Meta/LinkedIn/Stripe UI — three
   independent, optional follow-ups; pick them up in any order once you decide you want them.

Test Parts 1-2 against real search queries with a real LLM/search key configured before trusting
the results, same as everything else in this project — automated tests confirm the code runs, not
that the AI's actual output is good.
