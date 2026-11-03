# Inbound (Forms + Website visitors) for the Leads plugin

* **Author:** Parth Barot
* **Date:** 2026-11-03
* **Status:** Revision 2. Release 1 (Forms) built 2026-11-03; releases 1.5 and 2 not started.

## Goal

Add an **Inbound** group to the Leads plugin, modelled on Apollo's Inbound menu:
* **Forms:** build a form, share it, and turn each submission into a lead in a chosen list.
* **Website visitors:** a tracking pixel that shows which companies visit a customer's site.

Terms used below: the **leads store** is the `LeadAccount` table (what Leads, lists and journeys use). A **journey** is an email sequence on the campaign engine. A **credit** is a unit charged through `services/credits.py`.

## What Apollo has (recorded 2026-11-03)

**Forms** (`#/forms`): two paths, Form builder and Form enrichment (for existing site forms).
* Builder header: name, Draft badge, Editor / Settings tabs, Preview, Publish.
* Fields palette: Name, Email, Phone, Address; Heading, Paragraph; Short text, Number; Dropdown, Multi-select, Radio, Checkbox, Toggle; reCAPTCHA, Subscriber opt-in. New forms start with Name + Email + Submit; Email is required and unique.
* Field panel: Label, Placeholder, Map to Apollo field, Required, Hidden, Auto-fill, Hide if known.
* Design tab: font, radius, padding, colours, button style.
* Settings: name; block free email domains; allowed domains; contact enrichment (1 credit per verified email); phone enrichment (8 credits); weekly credit cap; form shortening; preserve visitor input.
* Form enrichment: 3-step wizard (Overview, Setup, Installation). Steps 2-3 not opened.

**Website visitors** (`#/websites`): Add website, then choose Company only or Company & person (paid add-on), and set page-intent rules (URL, label, High/Medium/Low). Visitor list not seen (empty account).

## Review findings that change the plan

| Finding | Change |
|---|---|
| `Prospect` is a voice-call target tied to a mission. Leads live in `LeadAccount` (`lead_accounts`, models.py:1562). | Create leads with the same logic as `add_accounts` in api/lead_accounts.py:933 (dedupes by domain or name). New source value `inbound_form`. |
| `check_rate` lives in `app/public_api/core.py:125`, is in-memory and per-process. | Use it as a first guard with `who="inbound:{public_key}:{ip}"`, plus a DB counter per form per day for real limits. |
| Lists are one settings document per org, not a table. | Add leads with `put_in_list(db, list_id, list_name, ids)` in api/lead_lists.py. |
| Unauthenticated routes have no org. RLS needs `app.org_id`; `TENANT_TABLES` in core/tenancy.py is hand-maintained. | Look up the form by hashed `public_key` under `system_scope()`, then do all writes inside `org_scope(form.org_id)`. Add every new table to `TENANT_TABLES`. Public router follows `scheduler_tools.public_router`. |
| `CreditEntry` must not be written directly. | Charge through `credits.charge` or `hold` then `confirm`. New rate-card items: `inbound_email_verify`, `inbound_phone_lookup`. |
| Anyone can burn a customer's credits by spamming the form. | Paid enrichment only after CAPTCHA, only once per email per 30 days, idempotent per submission id, capped per form per day. Refund on provider failure. |
| Writing unverified public input straight into leads can poison lists and email-bomb third parties through journeys. | Submissions land as leads with `stage="inbound_pending"`. They are promoted when the email verifies. Journey enrolment is manual in release 1. |
| "Allowed domains" meant two things. | Split into `allowed_origins` (which sites may show the form) and `allowed_email_domains` (which emails may submit). CORS is not authentication; the key is public, stored hashed, rotatable. |
| Visitor pixel needs consent, retention, deletion, salted IP hashing; no reverse-IP provider exists in the repo. | Release 2, gated on decision 1. |
| Release 1 was too big. | Phasing below. |

## Phasing

### Release 1: Forms (simple)
Matches the scope reviewer's right-sized cut, plus the security fixes above.

**Backend**
* Tables (all org-scoped, RLS, added to `TENANT_TABLES`): `inbound_forms` (name, status draft/published, `fields` JSON list, `settings` JSON, `schema_version`, `public_key_hash`, `allowed_origins`, target `list_id`), `inbound_form_submissions` (form id, schema version, sanitised payload, email, status, lead id, ip hash with rotating salt, created at; unique per form + email + day).
* Field JSON per entry: `id`, `type` (name, email, phone, text, dropdown, checkbox), `label`, `placeholder`, `required`, `maps_to` (a `LeadAccount` column or `custom.<key>`), `options`.
* Routes, authed (`/inbound/forms`): list, create, get, update, publish, unpublish, rotate key, list submissions.
* Routes, public (`/f/{public_key}`): GET render config (no supplier names), POST submit. The hosted page serves the form; an iframe snippet embeds it. No script embed in release 1.
* Submit flow: resolve org, size and field-count limits, validate against the published schema version, reject unknown keys, strip HTML, neutralise leading `= + - @`, honeypot, rate limit, domain rules, store submission, create or update the `LeadAccount` as `inbound_pending`, add to the chosen list, then enrich asynchronously: company from the email domain (`enrichment_service`, with `fill_contact_gaps` / `enrichment_waterfall` for email verification) and promote the lead when the email verifies.
* Editing a published form creates a new `schema_version`; old submissions keep their version.
* Hosted page sends CSP `frame-ancestors` from `allowed_origins`.

**Frontend** (Leads nav group "Inbound" in LeadGenerationPlugin.jsx, plus a `viewTitles` entry)
* Create `InboundFormsView.jsx`: list with name, status, submissions, created; empty state with one action.
* Create `FormEditor.jsx`: ordered field list (add, remove, move up/down, edit label, placeholder, required, maps-to) and a live preview using the same renderer as the hosted page. Tabs: Fields, Settings, Share, Submissions. No drag-and-drop and no Design tab in release 1.
* Settings: name, target list, allowed origins, allowed email domains, block free-email domains, email verification toggle (credit cost shown), daily credit cap.
* Share tab: hosted link, iframe snippet, key rotate.
* Submissions tab: table with status and "open lead".
* Modify: `LeadGenerationPlugin.jsx`, `main.py` (router registration), `core/tenancy.py`.

**Tests:** schema validation and sanitising, org resolution and RLS isolation, rate limit and honeypot, credit charge/refund/idempotency, dedupe, promote-on-verify, brand test (no supplier names in public responses).

**Success:** a published form can be submitted from an iframe on a test site; the submission appears in Leads in the chosen list; spam burst of 100 posts charges at most the daily cap.

### Release 1.5: Forms polish
Design tab (colours, radius, button), Heading/Paragraph/Number/Radio/Multi-select/Toggle fields, JS embed script, phone enrichment, notification email, auto-enrol into a journey.

### Release 2: Website visitors
Only after decision 1 and a privacy sign-off.
* Tables: `inbound_sites` (domain, verify method meta-tag/DNS, `verified_at`, `intent_rules` JSON of `{match: exact|prefix, url, label, intent}`), `inbound_visits` (short-lived raw rows, monthly partition, 30-90 day TTL), `inbound_site_company_day` (aggregates).
* Pixel: tiny, async, wrapped in try/catch, loads only after the site's consent signal or runs cookieless. Rejects hits whose Origin does not match the site.
* Company lookup cached per IP per day. Bot filtering and per-site rate limit. Deletion path by visitor id.
* UI: `VisitorsView.jsx` with add-site modal (URL, Company only; Company & person shown as coming soon), intent rules table, pixel snippet with verify status, visitor companies table with "Save to list".

### Deferred
Enriching third-party forms, person-level identification, Apollo-style auto-fill.

## Open decisions (need the user)
1. Visitor company identification: paid reverse-IP provider, or none (release 2 shelved)?
2. Scope: ship release 1 as above (simple forms), or build the full Apollo-style builder first?
3. Lead approval: confirm `inbound_pending` until the email verifies.
