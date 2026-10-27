# Apollo "Prospect and enrich" reference

What Apollo's People, Companies, Lists and Data enrichment screens contain, from clicking through a free-plan account on 2026-10-27 (plus Apollo's API docs for credit rules). Nothing that spends credits or changes data was clicked. Paid-plan screens are only known from their locked labels.

## People (`#/people`)

- **Top bar:** Default view (saved views), Hide Filters, name search, Research with AI (run custom AI prompt, generate AI formula, use Apollo Assistant, start with a template), Create workflow (auto-add to sequence, auto-add to lists, auto-update records, create from scratch), Save as new search, Sort, Search settings, Import (single contact, CSV).
- **Counts:** Total, Net New, Saved.
- **Empty state:** an AI box ("Look for nurses working…") and quick filters (locations, email status, job titles, industry).
- **Sort by:** Relevance, Name, Job title, Emails, Company, Phone numbers, Company employees, Company industries, ascending or descending.
- **Search settings:** Fields (13 shown, 52 available to add, drag to reorder) and Applied filters.
- **Columns by default:** Name, Job title, Company, Emails ("Access email"), Phone numbers ("Access Mobile"), Qualify Contact and Company Qualify Account (AI, "Click to run"), Actions, Links, Score, Location, Employees, Industries, Keywords.
- **Row:** list button, manage sequences, more menu. Last names are masked until the email is accessed.
- **Selecting rows** opens a bar: Clear, Save, Email, Sequence, Workflow, Add to list, Export, Research with AI, Push to CRM/ATS, More Actions (View Companies).
  - **Add to list** dialog: choose a list (tabs All, My, Team, Create new list), then shows verified-email percentage, email status counts (verified, unverified, unavailable), "include catch-all", a **credit estimate** (records to save, net new, email enrichment cost with a "find data via waterfall" switch, credit total) and an "export selected records to CSV" option.
  - **Sequence:** add to new or existing sequence, connect Salesloft or Outreach.
  - **Export:** Export as CSV, add to lists, send email with AI, add to sequence, assign owner, mobile numbers (8 credits), export all emails or verified only. Notes say a new verified email costs 1 credit and a mobile number 8.
  - **Email:** needs a linked mailbox (Gmail, Outlook, or other IMAP).
- **Pagination:** 25 per page.

### People filters (50+; a lock means a paid plan)
- **Pinned (editable):** Job Titles, People Lookalikes (locked), Company (specific companies: current or past, is any of / none of; "only companies with a known domain"; is known / is unknown), Location, Industry & Keywords (industries, company keywords with include, include ALL, exclude).
- **Person info:** Persona, Email Status, Name, Education, Awards & Certifications (beta), Work URLs, Time Zone, Total Years of Experience, Job Change, Time in Current Role, Territories (locked), Person Deleted.
- **Company info:** Company Lookalikes (locked), # Employees, Market Segments, SIC and NAICS, Buying Intent, Technologies (locked), # Employees by Dept. (locked), Headcount Growth, Revenue (locked), Funding (locked), Founded Year (locked), Languages (locked), Job Postings (locked), News (locked), Website Visitors.
- **Engagement activity:** Sequence, Workflows, Email Opened / Sent / Clicked / Replied / Meeting Set / Bounced / Unsubscribed / Spamblocked / Auto Responder, Last Activity, Call Restrictions.
- **Conversation:** Conversation Recorded, Conversation Transcript.
- **Created source:** Source, Contact CSV Import, Contact Data Request, Contact Created Date.
- **Misc:** Phone Status, Parent Companies (locked), Lists, AI Filters, Scores (locked), Owner, Stage, Custom Fields, Signals.
- Filter dialog has a "Search filters" box, a Type: All switch, a live records-found count and an Apply Filters button.

## Companies (`#/companies`)
- Same top bar as People. Total 26.9M, Net New, Saved.
- **Quick filters:** locations, employee count bands (1-10, 11-20, 21-50), industry.
- **Pinned filters:** Company, Lookalikes (locked), Account Location, # Employees, Industry & Keywords, Website Visitors.
- **30+ filters:** Employees by Dept., Headcount Growth, Market Segments, SIC and NAICS, Buying Intent, Job Titles (hiring), Technologies, Revenue, Funding, Founded Year, Languages, Job Postings, Scores, News, Work URLs; engagement (Last Activity, Sequence, Workflows); created source (Source, Account CSV Import, Account Created Date); misc (Parent Companies, Lists, Territories, AI Filters, Signals, Owner, Stage, Account Custom Fields).

## Lists (`#/lists`)
- Empty state "Welcome to your lists" with two templates: Create a people list, Create a company list.
- **New List dialog:** list target (people or companies), add records from Filters or from a CSV upload, Cancel / Create.
- Lists appear as a filter on People and Companies, and in Add to list.

## Data enrichment (`#/enrichment-status/...`)
- **Header:** View scheduled jobs (count), Automate Enrichment (scheduled: from scratch or from templates; real-time: enable).
- **Tabs:** Data health center, CRM (new), CSV, Job change alerts, Form enrichment.
- **Data health center:** contact emails and mobile numbers enriched since a date; Job changes (contacts with a job change, % up to date, % needing enrichment, View contacts, Schedule); Credit usage (email enrichment, mobile enrichment, records exported, View credit usage); Missing emails (View contacts, Schedule); Enrichment job activity (Create scheduled enrichment); CRM status (Connect CRM).
- **Scheduled jobs:** Scheduled and Activity log tabs, Add new, View enrichment history.
- **CRM:** connect Salesforce or HubSpot (benefits: enrich CRM fields, save time, keep data consistent).
- **CSV:** upload up to 100K rows and fill missing fields. Locked on the free plan.
- **Job change alerts:** shows saved people who now work somewhere else. Locked (needs Basic).
- **Form enrichment:** enrich an existing website form, or build a new form (drag-and-drop builder with built-in enrichment).

## Credit rules (from API docs)
- Search is free. Email reveal 1 credit, mobile 8, company enrichment 1. Waterfall charges when a source returns a result. People enrichment API: 1-9 credits per person; bulk call takes 10 people.
- Organization search costs 1 credit per page of up to 100; people search is 0 credits. Results cap at 50,000 records.
