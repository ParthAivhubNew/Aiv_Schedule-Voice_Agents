# AIVHub Prototype — Documentation

Single-file React prototype (`aivhub-prototype.jsx`). No backend — everything runs on
in-memory mock data seeded at the top of the file, so the whole app is fully click-through
without any server. This doc explains what's where, why it's structured that way, and what
dummy data backs each screen so anyone opening the file (or clicking through the UI) knows
what "working" looks like.

---

## 1. Three identities — don't confuse these

The app deliberately tracks three separate things, all visible in the sidebar footer:

| Identity | Where it lives | What it's for | Example |
|---|---|---|---|
| **Logged-in user** | hardcoded `"Jitendra S."` in `Sidebar` | The human using the dashboard right now | Jitendra S. · Admin |
| **AI caller persona** | `profile.callerName` | The name the AI *speaks as* on calls/messages — what prospects hear | "Sam" |
| **Company represented** | `profile.name` | Which business the AI says it's calling on behalf of | "AIVHub" |

Sidebar footer now reads **"AI speaks as Sam, on behalf of AIVHub"** / **"Logged in as: Jitendra S."** —
these were previously conflated (it said "Speaking as AIVHub", which is wrong: the AI never
introduces itself as the company name, it introduces itself as the caller persona — see any
transcript, e.g. *"Hi, this is Sam calling on behalf of AIVHub"*). Both `callerName` and
`companyName` are editable under **Company Profile → Identity**, and now flow correctly to:
- Sidebar footer
- Meeting booking panel title (`{companyName} × {prospect}`) — previously hardcoded to the
  literal string "AIVHub", now reads live from `profile.name`.
- Live Activity feed ("On behalf of {companyName}")
- Mission detail ("Representing {companyName}")

---

## 2. Navigation map (`Sidebar`, `NAV_GROUPS`)

```
Operations
  Missions        → MissionsView / MissionDetail
  Schedule        → ScheduleView
  Meetings        → MeetingsView
  Live Activity   → LiveCallsView        (nav label fixed to match page title — was "Live Calls")
  Prospects       → ProspectsView
Configuration
  Company Profile → CompanyProfileView
  Connections     → ConnectionsView
  AI Providers    → ProviderConfigView
Insights
  Analytics       → AnalyticsView
```

`view` state in `App` drives which of these renders. `missionDetail` is a pseudo-view (not in
`NAV_GROUPS`) reached only by clicking into a mission card; the sidebar highlights "Missions"
while it's open.

---

## 3. Data model

All mock data lives in constants near the top of the file (`INITIAL_*` / `PROSPECTS` /
`CONNECTIONS` etc.), then copied into `useState` in the components that own them, so edits in
the UI don't mutate the original constants.

### Mission
```
{ id, title, sector, region, status, contacted, total, meetingsBooked, created, source,
  prospects: [ { id, name, status, note, time } ],
  // only present on missions created via file-upload/manual entry in this session:
  concurrency, queueEstimate, callWindow }
```
`source` is `"discover"` (AI found the businesses itself) or `"manual"` (you gave it the list —
shown with the teal "PROVIDED LIST" tag). Seeded with 4 missions (`m1`–`m4`) covering every
status (`active`, `completed`, `needs_attention`) and both sources. **All four now have
populated `prospects` arrays** — two were previously empty, which meant clicking in showed
"No prospect activity" despite the stat cards claiming contacted/booked numbers. Fixed so the
detail view always backs up what the card claims.

### Prospect (mission-level, nested)
Status drives the icon + badge in `MissionDetail`: `calling` (live pulse), `meeting_booked`
(check), `human_review` (flag, shows "Join call" button), everything else a plain dot.

### Prospect (master list — `PROSPECTS`, used by `ProspectsView`)
Separate, flatter shape (`fit` score, `phone`, `site`, `contact`) — this is the company-wide
directory of everyone ever researched or contacted, independent of which mission touched them.

### Live call/message (`INITIAL_LIVE_CALLS`)
```
{ id, prospect, mission, state, channel, duration, transcript: [ "AI: ...", "Prospect: ..." ], flag? }
```
`channel` is `"voice"` or `"whatsapp"` — `LiveCallsView` renders spoken-line transcripts for
voice and chat bubbles for WhatsApp/SMS. 3 voice + 1 WhatsApp example seeded, covering
`negotiating`, `human_review`, and `pitching` states.

### Meeting (`INITIAL_MEETINGS`)
```
{ id, prospect, mission, date, time, duration, status, fit, channel, format,
  // format-specific: platform+videoLink (video) | dialIn (phone) | address (in_person)
  host, attendee, prep, outcome?,
  callTranscript: [...],       // the call that led to booking — always present
  meetingTranscript: [...]|null // the actual meeting, filled after it happens (or manually pasted)
}
```
4 meetings seeded, one of each format (video/phone/in-person is covered across them) and one
of each resolution state (`upcoming`, `needs_outcome`, `converted`, `not_fit`).

### Company profile (`profile` state in `App`)
```
{ name, pitch, industry, website, social, callerName, callerId, tone, disclosure,
  legalName, icoRef, dpoContact, dncNotes }
```
Previously `industry`, `website`, `social`, and the entire Compliance tab (`legalName`,
`icoRef`, `dpoContact`, `dncNotes`) were **unset** — those fields fell back to empty strings, so
Company Profile looked half-finished on load. All now seeded with realistic values. Also
removed a dead `services: "..."` string field that duplicated the name of the real
`services` array (Services tab) and was never read anywhere — kept it would've meant two
unrelated things both called "services" in the same component, confusing to extend later.

---

## 4. Feature-by-feature

### Missions (`MissionsView` + `MissionDetail`)
List of outreach campaigns as cards (title, tag if provided-list, status badge, contacted/total,
meetings booked, progress bar). Click in for `MissionDetail`: prospect-by-prospect status feed
(expandable for notes) + a stats sidebar. If the mission was created via the New Outreach →
file-upload/manual flow in this session, a **Queue panel** also appears (see §5) — older/seeded
missions don't have this since they predate the concurrency feature.

Card header was fixed: previously title+tag shared a flex row with the status badge, so a long
title (e.g. "Provided contact list — Q3 warm leads") wrapping to two lines dragged the badge
down and cramped it against the tag. Now: title+badge always on their own row; tag+region/sector
on a second row below, regardless of title length.

### New Outreach (`NewMissionModal`) — three tabs
- **Discover**: free-text prompt, AI finds businesses itself. No real search — `parsed` just
  checks prompt length as a stand-in for "AI understood this."
- **Provide contact list**: two modes —
  - **Enter manually**: row-by-row form (name, phone, source link, per-row channel+fallback).
  - **Upload file**: the feature built this session. CSV/XLSX/XLS via `papaparse`/`xlsx`
    (need `npm install papaparse xlsx` in a real project — not bundled here). Auto-detects
    columns (company/phone/website/contact/channel) by fuzzy header matching, editable if wrong.
    Every row is validated on import: missing name, missing/malformed phone, and duplicate
    phone numbers (normalized so `+44 7700 900123` and `07700900123` match) are auto-flagged
    and left unchecked — only clean rows are included by default. Filter tabs (`All` /
    `Needs review` / `Duplicates`) let you jump straight to problem rows instead of scrolling
    a 100-row list. Bulk toolbar: check/uncheck all shown, set channel for all checked rows in
    one action, discard all flagged rows in one click.
- **Contact channel + call schedule**: mission-wide default channel (voice/WhatsApp/SMS/AI-
  chosen), overridable per row with an optional fallback channel ("if no reply, try X"). Call
  window is now restricted to 09:00–17:30 in 30-min steps — it used to offer 08:00 and 18:00
  as options right next to a label claiming a "09:00–17:30 compliance limit", which let you
  create a mission that violated its own stated rule. Fixed to match what `ScheduleCallModal`
  (single-call booking) already enforced correctly.
- **Concurrency + ETA**: "Calls running at once" (1/5/10/20) plus a live banner computing
  whether the batch fits in today's window (`AVG_CALL_MINUTES = 3` × count ÷ concurrency vs.
  window length), and if not, how many days it'll realistically take. This exists because a
  100-contact upload with no visibility into pacing was identified as the main thing that'd
  make someone give up mid-review — see §5.

### Schedule (`ScheduleView`)
One-off call bookings, separate from a mission's automatic queue — for callbacks a prospect
specifically requested. 7 seeded entries across yesterday/today/tomorrow, covering `queued`,
`retry`, and `completed`. Time options here were already correctly restricted to 09:00–17:00.

### Meetings (`MeetingsView` + `MeetingDetailModal`)
Post-booking view, grouped into "Needs outcome logged" / "Upcoming" / "Resolved". Detail modal
has the Cal.com-style `BookingPanel` (see §6), the call transcript that led to the booking
(always present), and a separate meeting transcript (auto-filled if recorded, or paste-in
manually via the textarea + "Save transcript").

### Live Activity (`LiveCallsView`)
Real-time feed of in-progress calls/messages. Voice calls render as spoken-line transcripts with
Take-over/End controls; WhatsApp renders as chat bubbles with equivalent controls. This is a
**static mock feed** — it does not reflect what missions actually have queued or running; it's
independent seeded data (`INITIAL_LIVE_CALLS`), same limitation as before this session, not
addressed here since it'd need a live backend to do properly.

### Prospects (`ProspectsView`)
Flat searchable table of every business ever researched, independent of mission — 10 seeded
rows spanning 3 sectors/regions, every status in `STATUS_MAP` represented at least once. "Schedule
call" jumps to Schedule pre-filled with that prospect's name.

### Company Profile (`CompanyProfileView`) — 5 tabs
Identity / Knowledge Sources / Services / Call Script & FAQ / Compliance. All five now have
seeded content (Compliance tab was previously fully blank — see §3). Everything here is what
the AI actually uses on calls, per the section intros — this is the "what a new hire would be
handed on day one" equivalent for the AI.

### Connections (`ConnectionsView`)
API-key management per provider category (LLM/STT/TTS/Voice/Telephony/Calendar/Business
Discovery/Other), separate from *which* provider is active (that's AI Providers, next). Seeded
with a realistic mix of `connected`/`not_configured`/`error` across categories so every badge
state is demonstrated.

### AI Providers (`ProviderConfigView`)
Per-layer toggle between "Paid/Managed" and "Open Source/self-hosted", or fully custom mix.
6 layers seeded with both a paid and OSS option each.

### Analytics (`AnalyticsView`)
4 top-line metric cards + a trend line (6 points, rising 11%→18%) + a paid-vs-OSS cost bar chart
(4 layers). All static — recalculating from actual mission data isn't wired up (would need real
call outcomes flowing back in).

---

## 5. Bulk-import bottleneck fixes (this session)

Original ask: "someone gives a list of 100 contacts — will calls actually get running for all of
them?" Five concrete gaps found and fixed inside `NewMissionModal`'s upload flow + `MissionDetail`:

1. **Bad data reaching the dialer** → `validateRows()` flags missing name, missing/malformed
   phone, duplicate phone (normalized). Only clean rows auto-included.
2. **Can't manually review 100 rows** → filter tabs (`All`/`Needs review`/`Duplicates`), so you
   jump straight to what needs fixing instead of scrolling past 90 clean rows.
3. **No bulk actions** → check/uncheck all shown, set channel for all checked rows, discard all
   flagged rows — each one action instead of 100 clicks.
4. **No queue visibility after submit** → `computeQueueEstimate()` (in `AVG_CALL_MINUTES`,
   `CONCURRENCY_OPTIONS`, `timeToMinutes`/`minutesToTime`) computes whether the batch fits
   today's window, shown live in the modal and stored on the mission for the Queue panel in
   `MissionDetail` (calling now / waiting / concurrent lines / call window / finish estimate).
5. **No pacing math at all** → concurrency selector added; first `N` (=concurrency) prospects
   are marked `calling` at creation, rest `queued`, so the prospect list visibly shows "what's
   happening right now" vs. "what's waiting" instead of one flat list.

**Known limitation, stated honestly**: the calling/queued split is a one-time snapshot computed
at mission creation, not a live ticking simulation — there's no timer moving prospects from
queued → calling → done over time, since there's no real backend here. Live Activity page is
still separate static mock data, not pulled from a given mission's actual queue.

---

## 6. Cal.com integration — what's real vs. decorative

`BookingPanel` (own AIVHub-styled card, small "SYNCED VIA CAL.COM" tag) shows date/time, a
format-aware line (video link / dial-in / address), host+attendee, and Reschedule/Cancel/
Join-or-Directions buttons. `ScheduleCallModal` lets you book against a fixed list of time
slots.

**Not real**: time slots are hardcoded, not pulled from actual Cal.com availability; the
"synced" tag is static, not driven by a webhook; no timezone handling; no round-robin/team
assignment. This is expected for a prototype with no backend — flagged here so it's not mistaken
for working integration if this gets built on top of.

---

## 7. Known gaps not addressed in this pass

- Live Activity feed doesn't reflect actual per-mission queues (see §5).
- No dedupe check against the master `PROSPECTS` list when importing a new file (only
  within-file duplicates are caught).
- Phone numbers aren't validated against a real format/region beyond a loose digit-count check.
- Excel import only reads the first sheet of a workbook.
- Analytics numbers are static, not derived from actual mission/meeting data.
- Cal.com panel is display-only (§6).

---

## 8. Where things are in the file (quick index)

| Section | Approx. lines |
|---|---|
| Design tokens (`C`), fonts | 1–105 |
| Mock data (`INITIAL_*`, `PROSPECTS`, `CONNECTIONS`, etc.) | 105–356 |
| `STATUS_MAP`, `Badge`, small shared components | 357–456 |
| `Sidebar`, `NAV_GROUPS` | 439–547 |
| `TopBar`, `NotificationBell` | 551–680 |
| Missions list + detail | 687–913 |
| Live Activity | 914–1002 |
| Schedule (+ single-call modal) | 1002–1130 |
| Meetings (+ booking panel, transcript, detail modal) | 1215–1442 |
| Prospects | 1525–1600 |
| Company Profile | 1641–1898 |
| Connections + Add Integration modal | 1855–2006 |
| AI Providers | 2006–2133 |
| Analytics | 2133–2223 |
| New Outreach modal + file-import/validation/queue-math helpers | 2223–2956 |
| `App` root, routing, profile state | 2956–end |
