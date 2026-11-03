# Bulk jobs: one tray, one review queue (revision 2)

Elephant draft, then three fresh-reviewer (Goldfish) passes: UX, scope, codebase. 2026-11-03. Nothing built.

## Problem
A bulk check can find several websites, phones or emails for one company. The person never chooses. Progress is only visible on the Lists page.

## What the code already does (checked by the codebase reviewer)
- The check job keeps one best value per field (`company_check.check_row`, `build_fixes`). It becomes a **fill** (blank field, applied at once) or a **fix** (different value, offered, applied by Accept).
- **Several candidates already exist** in the web lookup: `web_harness.py` builds website, phone and email candidates; `contact_choices.options_from` keeps the top 3 (Likely or Possible, with source links); `company_contacts._remember_options` stores them on the shared `BusinessRecord.raw_data["lookup_options"]`. `lead_accounts.py` has a pick endpoint that only accepts one of the shown options.
- The bulk path (`company_check_job._web_research` → `lead_accounts.research_into`) returns only found or not found, so the options are dropped.
- Only the company check has a background job doc (`checkjob:{org}:{id}`, polled every 2 s). Number check is a library, single research is a synchronous call.
- All plugins stay mounted side by side in `App.jsx`, so progress already survives switching plugin. A tray placed after that list lives across Leads, Voice and Social.

## Decisions
| Question | Decision | Why |
|---|---|---|
| How big is release 1? | The smallest version that fixes both problems. | Scope review. |
| New table? | No. Put options inside the existing `verification.fixes`, as a list. Reuse the pick endpoint's validation. | Scope + code review. |
| Delete unanswered picks after 14 days? | **Never delete.** Open picks stay until chosen or skipped. | UX review: silent loss of paid-for results. |
| "Pick the top match for all"? | Not in release 1. | Easy to rubber-stamp. |
| Other jobs (number check, research)? | Later. Build for the check job only. | They have no job doc yet. |
| Does choosing cost credits? | Free. The check already paid for the lookup. Confirm against the existing pick endpoint, which charges once. | Code review. |

## Release 1
**1. The dock** (app shell, corner of the screen, every plugin)
- Starts appearing when a check begins. Does not steal focus.
- Text: “Checking 40 of 200 · 3 need you”. Press to open a small panel.
- Panel: now checking (company name), found so far (verdict counts), kept, needs you, credits used, Pause, Stop. A link to “Review 3”.
- When the job ends: “Done. 3 need you.” stays until the queue is empty. Also a count badge on **Lists**.
- Screen readers: one polite update every 10 s, not every poll.

**2. The pick**
- The check keeps up to 3 options per field and writes them into the company’s fixes.
- A company with options shows “2 options waiting” on its row in Lists.
- **Review list** (on Lists, filter “Needs you”): one card per company and field. Radio rows: the value, where it came from (with link), and a word for how sure (Likely, Possible). Two buttons: **Use this one** and **Skip for now**.
- A line at the top of the list: “Nothing here is saved until you choose. Skipped items stay here.”
- Choosing writes the value through the existing guard and records who chose and when, with a Change link.
- If a colleague already chose: “Sam chose X.” with Change.

**3. Phone and keyboard**
- Cards are full-width tappable rows, at least 44 px high. Evidence behind a “Why?” link.
- Arrow keys and Enter on the radio group. No number shortcuts.

## Later (only if release 1 proves it)
Centre sheet at Start. Three tabs. A tray for number check, research and imports. Reminder emails at job end and on days 7 and 11. Bulk “use top match” with a preview and undo.

## Risks
- `check_fixes.set_field` blocks listing-site websites only. Phone and email picks need their own sanity checks.
- Options live on a shared record today. They must be copied into the org’s own company result so one organisation cannot see another’s lookups.
- Check that `research_into` can return its options without extra cost.
