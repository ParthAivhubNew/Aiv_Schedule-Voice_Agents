# 13 — Simplify the whole app: one shell, fewer menus, plain screens

Written 2026-11-26, after the owner looked at the test copy and said the app is confusing, the side menu is congested, the client's
name sits where Outreach should be, and the staff portal looks complicated. Based on a read of the frontend code (menus, shell,
brand logic, staff portal) and the owner's screenshots of Home, Find Leads and the staff Dashboard. **No code has been changed.**

**Status (2026-11-26):** the owner answered the decisions (section 6). **Steps 1 and 2 are done on the branch**, deployed on the
test copy and looked at by the owner. **Step 3 is done on the branch** (below), deployed on the test copy and looked at by the
owner (2026-11-27: the Settings menu swap "looks good"). **Step 4 is done on the branch** (below), deployed on the test copy
and looked at by the owner (2026-11-27: "looks good"). **Step 5 is done on the branch** (below), deployed on the test copy and
looked at by the owner (2026-11-27: the second pass "looks good"). **Step 6 has started with Find Leads** (below), deployed on
the test copy; the owner checked the full-width layout on 2026-11-27 ("looks good"). Lists is next.

- ✅ **Step 6a, Find Leads (2026-11-27):**
  - The toolbar is Filters, the company-name search and Saved searches (plus the company-rules chip).
  - Companies / People and List / Map moved onto the results' own header, beside the count, once there are results (before
    that they stay in the toolbar so they're always in reach). The header ends with a "⋯" menu: Import a spreadsheet, and
    Clear and start again.
  - Import appears once on Find Leads (the ⋯ menu); the page-header Import is gone there and now sits on Lists, where imported
    companies end up.
  - Filter help is a small ⓘ beside the field's name (Include, Leave out, Industry, Within, Data from, Exclusion list); the
    paragraph under Include is gone.
  - Owner's look: the change was hard to see, and the results header wrapped onto a second line by accident. Now it is two
    deliberate rows: Companies / People and List / Map on the left with Columns, View and ⋯ on the right; then the counts
    (All · New to you · Saved) as tabs underneath.
  - Then: "Set your ideal customer" is a small button on that first row instead of a full-width banner over the table, and the
    "Exclusions on" chip moved from the toolbar into the Filters panel's header. The toolbar is now Filters, search and Saved
    searches only.
  - Then (owner's screenshots): in the collapsed icon menu the expand button now sits on the Outreach logo and appears on hover,
    instead of taking its own row under the logo. The "Full profiles" group header in the table is a quiet grey row with a coloured
    dot instead of a bright green band, and the "Type, then comma or Enter · Expand" line under an empty Leave out box is gone
    (it comes back once there is a list).
  - Polish pass (owner: "yes, polish it"): the Filters column is narrower (272px) with lighter group names; "Describe it… / Fill"
    is one row with a sparkle, and Fill appears once something is typed; the long line beside "Find Leads" in the page header is
    gone; in the table, Ltd / PLC, an empty notes button and the open-in-new-tab mark show on the row under the pointer (notes
    that exist always show; touch screens show everything); website links read as plain text until hovered.
    Not changed: the black AI Assistant button (it is the same in every app; any change there belongs to the dark-mode / colour
    step 9).
  - Layout change (owner: "you decide, give me the best UI and UX"): the filter column is gone from the page. Filters is a button
    (with a count) that opens a panel sliding over the page from the left; Find companies, Escape, the × or a click on the
    backdrop closes it. The results take the whole width. The filters in use show as chips under the search bar: × on a chip
    takes that filter off and searches again; "Edit filters" opens the panel; "Clear all" starts again. Phones keep the
    Search / Results panes as before.
- ✅ **Step 6b, Lists (2026-11-27):** the row of coloured pills and drop-downs above the table (Google data, TPS checked, Data
  from, Came from, More filters) is one **Filters** menu beside the list's search, with a count; the filters that are on show as
  chips with × and Clear all. The "what to do next" groups (Ready to email … All, and Needs your choice) are tabs with counts
  inside the list's card. "Set your ideal customer" is a small button in that header. Shared parts: components/FilterPopover.jsx
  (FilterPopover, FilterChips, CountTabs).
- ✅ **Chosen tabs, everywhere (2026-11-27, owner: the blue underline isn't professional):** every tab bar now marks the chosen
  tab with a soft grey filled pill and dark text, the same as the Companies / List switches: Find Leads' counts, Lists, Settings'
  windows, Workflows, the staff portal, Import & match, API keys, Help, Forms, Voice and Social schedule windows, Social's day
  tabs. A test (components/filterPopover.test.jsx) keeps a coloured underline from coming back.
  - Owner checked Lists and the new tabs on 2026-11-27 ("looks good").
- ✅ **Step 6c, Journeys (2026-11-27):** the status buttons over the journey list are the shared count tabs (Running 3 · Paused …),
  the repeated "3 running · 1 paused" line is gone, and the chosen journey is a soft grey card instead of a blue one.
  Voice's Call list was looked at and left: it is already a grid of list cards with New list and Import.
  - Social's calendar is left for a look on screen (owner chose to skip to step 7).
- ✅ **Step 7, Search (⌘K) (2026-11-27):** ⌘K (Ctrl K on Windows) or the Search box in every header opens one search over the page.
  Before typing it offers a few places to start; as you type it lists matching pages of every app (Leads, Voice, Social), Settings
  sections this person may open (by the same rules as the Settings page), Workflows, Help and Support, then companies, people,
  calls, meetings and posts from GET /together/search. Arrow keys move, Enter opens, Escape closes. Home's header now has the
  Search box in place of its own Support and Documentation buttons (both are in the profile menu and in search).
  Files: hub/commandItems.js, hub/CommandPalette.jsx. Social now opens its other pages from the address too (plan, insights…).
  Owner checked it on 2026-11-27 ("looks good").
- ✅ **Step 8, Words (2026-11-27):** one glossary, docs/GLOSSARY.md, and the screens renamed to it. Leads: Connectors → Data sources,
  About your business → Company profile, the Mail page's title "Inbox and sent" → Mail. Voice: Business Setup → Company profile (its
  AI caller pages are titled AI caller). Social: Post approve → Posts to approve, Accounts → Social accounts, Theme → Brand look, and
  each Results & ideas / Library page is titled by its own name. "Lead Gen" → "Leads" and "plugin" → "app" on customer screens and in
  the server's messages ("This needs the Leads plan"). Search and Help use the same names. hub/glossary.test.js keeps the old names
  out of menus and titles. Owner checked it on 2026-11-27 ("looks good").
- ⏭️ **Step 9, Dark mode:** skipped by the owner on 2026-11-27., Journeys, Voice's Call list and Social's calendar.
  - Not browser-checked by me (Claude in Chrome wasn't connected).

- ✅ **Step 5, a calm Home (2026-11-27):**
  - Under the greeting, one "Next step" card: the first unfinished setup step, with Start, See all steps and hide. The full
    checklist moved to Settings → Company → Getting started (shown there done or not).
  - Your apps first, then "More apps". Each card has one button: Open (or Top up when that app is out of credits).
  - An app the company hasn't added is a neutral offer: "Add Voice", "From £…/month", See plans, and a quiet "or try it first".
    It never says "Out of credits"; nothing on Home is red. Running out on an app you have is amber.
  - The second Support / Documentation row at the bottom is gone (they're in the header and the profile menu).
  - Owner's first look: "better but not very impressive". Second pass (same day):
    - A hero band at the top: today's date, a time-of-day greeting, one line on how the day looks ("4 things need you today" /
      "You're all caught up"), and up to four live number tiles (replies waiting, posts to approve, tasks due, meetings this
      week, calls in the last 7 days, posts lined up). What needs a person comes first; each tile opens that page.
    - Each app card has a strip of its colour on top and shows its own two live numbers; credits and one button below.
    - Apps the company hasn't added sit under "Add to Outreach" as slim dashed offer rows (See plans, Try it first).
    - The numbers come from GET /together/today, which now also sends posts_to_approve, posts_scheduled and calls_7d for the apps
      the company has (tests/test_today_strip.py). Nothing is shown that the server didn't send.
    - Not browser-checked by me (Claude in Chrome wasn't connected).

- ✅ **Step 4, one Settings page (2026-11-27):**
  - Settings is now a page of its own at /settings, with the same dark sidebar as the apps: "← Back to <app or Home>", then the
    sections in groups: Your account (Profile, Contact & preferences, Notifications, Sign-in & security, Install the app), People
    (Users, Roles), Company (Company rules, Phone numbers, Plans & credits or Your credit use), Working together (Follow-ups,
    Automations, Do not contact, Data, Calendar & meetings), Developers (API keys & webhooks) and Apps (Leads, Voice and Social
    settings, which open that app's own Settings menu from step 3). Each person sees only what they may open (hub/settingsPages.js).
  - The profile menu is cut to: Your profile, Settings, Support, Documentation, Sign out (and AI Configuration for Outreach staff).
  - The Users, roles, numbers & credits window, the Your profile window, the Connections window and the API keys window no longer
    open over the page: they draw inside the Settings page (an inline mode on each). Old links still work: "See rules" and the
    Connections links go to their Settings section.
  - Left as it was: Calendar & meetings still opens its own large window from the Settings list (it is a workspace of its own;
    moving it inline is a later pass). The per-app setup pages stay in each app's Settings menu, as the owner approved in step 3,
    so section 3.2's "Company profile" merge of About your business / Business Setup / Theme is not done yet.
  - Social now opens /scheduler/accounts and /scheduler/theme from the address, so "Social settings" lands on Accounts.
  - Not browser-checked by me (Claude in Chrome wasn't connected).

- ✅ **Step 3, one menu layout (2026-11-26):**
  - Leads, Voice and Social now have the same sidebar: Outreach, the app switcher, the everyday work (no group label, since there
    is only one group), then **Settings**, then credits and the company badge. Shared pieces: `hub/PluginShell.jsx` (`SidebarGroups`)
    and `hub/settingsNav.js` (`settingsNavItem`).
  - **What each menu holds now:**
    - **Leads:** Find Leads, Lists, Journeys, Mail, Forms. Under Settings: Connectors, Email accounts, About your business, Workflows,
      Administration, Plan & credits.
    - **Voice:** Call list, Conversations, Meetings & callbacks, Call stats. Under Settings: Company profile, Working hours, What the
      AI says, Voice & rules, AI config (staff), Workflows, Plan & credits.
    - **Social:** Post calendar, Post approve, Results & Ideas, Library. Under Settings: Accounts, Theme, Workflows, Plan & credits.
  - **Settings swaps the menu** (changed the same day, after the owner found the first version unprofessional). The first version
    opened a dark panel beside the menu; at the bottom of the screen it ran off the page and a second label floated over the
    credits. Now clicking Settings opens its first page, and while any setup page is open the menu shows "← Back to <app>", a
    Settings heading and the setup pages in place of the everyday work, as Linear and Stripe do (`SidebarMenu`). Back opens the
    app's first page.
  - **Moved out of the menus:**
    - The AI Assistant: it's the header's button (the same chat). A partner's embed still lists it, since the embed has no header
      of ours.
    - Support and Documentation: they're in the profile menu, which now follows the app you're in (that app's guide, and Support is
      told the app).
  - **Apps without a plan** show a quiet "Try" in the app switcher (admins, who see plans).
  - Every page and old link still works; only the menus changed.
  - Tests: `hub/SidebarItems.test.js`, `hub/settingsNav.test.jsx`, `plugins/leadgen/dataAccess.test.jsx`.
- ✅ **Step 1, identity:**
  - `BrandMark` and `BrandLockup` are always Outreach's. Home, sign-in, pricing, help and staff sign-in no longer swap in a brand's
    name or logo.
  - The company shows only in the account badge at the bottom of an app's sidebar.
  - "Powered by Outreach" is gone (Outreach is at the top now), with its switch on the staff Brands page. The Brands page's help says
    the display name and logo are for that badge.
  - Tests: `brand/BrandUi.test.jsx`.
- ✅ **Step 2, staff portal:**
  - The menu is in five groups (Overview, Customers, Money, Platform, Operations). The labels hide on phones.
  - **The same alert again, while the last one is unseen, updates that one** (`ai_errors.alert_staff`: how many times, first and last
    seen) instead of adding a row. A new reference is still its own row.
  - **The banner groups older stored repeats by kind**, with "N times, since …", and Dismiss clears the whole group.
  - Checked on the test copy: a backend restart turned the newest CFG-01 into "count 2" instead of a 37th alert.
  - Tests: `tests/test_staff_alerts_repeat.py`, `adminPortal/alertsGroup.test.js`.
  - **Not done:** "expected findings are no alert" (Stripe in test mode on the test copy) and the Dashboard leading with numbers;
    with the grouping, the banner is already a few lines. Both fit step 3's rework.

---

## 1. What is wrong today, with the evidence

### 1.1 The same account shows two different identities
- **Home** shows "Federation of Small Businesses" next to *Outreach's* icon (`hub/BrandMark.jsx` `BrandLockup`: a brand with no logo
  keeps Outreach's icon but swaps in its own name). That mix is neither Outreach nor FSB.
- **Inside an app** the top of the sidebar is always Outreach (`PluginShell.jsx` `SidebarHead`, `outreach` flag), and the company
  shows again at the bottom ("Federation of Small Busi…", cut off) with a "FSB account" crown.
- So the person sees FSB → Outreach → FSB as they move from Home into Leads. Nothing tells them which one is the product.

### 1.2 Every app builds its own menu, and they don't agree
| | Leads | Voice | Social |
|---|---|---|---|
| Menu items | 11 in 3 groups, plus 2 sub-items under Mail | 7 in 2 groups | 9 in 2 groups, plus 5 sub-items |
| AI Assistant | in the menu **and** a black button in the header | in the menu | in the menu |
| Company details | "About your business" | "Business Setup" | "Theme" |
| Accounts / keys | "Connectors" | "AI config" | "Accounts" |
| Workflows, Documentation | in the menu | not in the menu | in the menu |

Under the menu, every app sidebar also stacks: the app switcher, Support, a credits box with Top up, the company badge, and
"Powered by Outreach". On a laptop screen that is 17–20 things down one dark strip.

### 1.3 Settings live in five places
The same kind of thing is reached from different doors:
- **Profile menu (top right), 10 entries:** Your profile, Users & roles, AI Configuration, Calendar & meetings, Admin APIs & Webhooks,
  Connections, Install the app, Documentation, Support, Sign out.
- **Team settings window:** Users, Roles, Phone numbers, Plans & credits, My credit use, Company rules.
- **Each app's "Setup" group:** Connectors, Workflows, About your business, Administration (Leads); AI config, Business Setup (Voice);
  Theme, Accounts (Social).
- **Users & roles** alone can be opened from three of these.
- **Documentation and Support** each appear in two or three places on the same screen.

### 1.4 Screens carry too much at once
Find Leads, from the screenshot:
- **Two Import buttons**: one in the page header, one in the toolbar.
- **Two ways into the AI Assistant**: the menu and the black header button.
- **Eight controls in the toolbar**, before any results: Filters, search, Saved searches, Companies / People, List / Map, Import.
- **The filter panel opens with paragraphs of help text** ("A common word on its own can be slow across the whole register…").

### 1.5 Home leads with problems, not with what to do
- **Voice and Social, which FSB hasn't bought, say "Out of credits: paused until you top up" in red.** That reads like something
  broke, not like an offer.
- **"Get started" sits above the apps**, with its 5 steps.
- **Each app card has two buttons** that aren't the same pair from card to card ("Open / Manage plan", "See plans / Try it").

### 1.6 The staff portal is a long flat list with a wall of red on top
- **16 menu items, one level, no groups**, over 36 screen files (the rest are tabs).
- **The Dashboard opens with "Urgent: 36 alerts need a look"**, and most of them are the same alert. The start-up configuration
  check (`services/config_check.py`) raises one CFG-01 alert **every time the backend starts**, and each says the same thing
  ("block: stripe_test; block: stripe_webhook; warn: staff_email"). On the test copy those are expected anyway. A real alert can't be
  seen among them.

---

## 2. What good looks like (the rules every step follows)

1. **One product, one shell.** Outreach's logo top-left, always (unless a paying partner has a white-label domain: decision 1).
   The customer's company lives in one place: the account switcher.
2. **One left menu for the whole suite, the same in every app.** It holds only the work people do every day: about six things
   per app. Everything about setting up goes into **Settings**, which has one door.
3. **One header row:** where you are, the page's main action, then notifications, help and you. Each action appears once.
4. **Show the next step, not every option.** The advanced controls are one click away (a "More" menu, a side panel), not on the page.
5. **Plain words, the same word for the same thing everywhere:** "Company profile", not "About your business" / "Business Setup" /
   "Theme".
6. **Calm by default.** Red only for something that needs action now. Things not bought are offers, in neutral colours.
7. **Each step ships on its own, is checked in a browser on the test copy, and changes nothing about what the app can do.**
   Nothing is removed, only moved, merged or renamed. Old links keep working.

These are the patterns of products people already find easy (Linear, HubSpot, Stripe's dashboard): a fixed shell, a short menu,
one Settings area with a left list of sections, and a command search for everything else.

---

## 3. The target design

### 3.1 The shell (every app, every screen)
```
┌───────────────┬────────────────────────────────────────────────────────────┐
│ ◉ Outreach    │  Find Leads                      [ main action ]   🔔 ? (FO)│
│               ├────────────────────────────────────────────────────────────┤
│ 🔍 Search ⌘K  │                                                            │
│               │                                                            │
│ ⌂ Home        │                     the page                               │
│ ── Leads ──   │                                                            │
│   Find        │                                                            │
│   Lists    8  │                                                            │
│   Journeys    │                                                            │
│   Inbox       │                                                            │
│ ── Voice ──   │                                                            │
│   Calls       │                                                            │
│   Meetings    │                                                            │
│ ── Social ──  │                                                            │
│   Calendar    │                                                            │
│   Approve  3  │                                                            │
│               │                                                            │
│ ⚙ Settings    │                                                            │
│ [FSB ▾] 550 cr│                                                            │
└───────────────┴────────────────────────────────────────────────────────────┘
```
- **One menu for all three apps.** You don't switch apps to get somewhere: an app you haven't bought shows as one line with a "Try"
  label, not a full section. This replaces the app switcher, and Home becomes the first item rather than a separate page with its own
  header.
- **Search (⌘K)** finds any page, setting, company, list or person. It's the escape hatch for everything that left the menu.
- **The AI Assistant is one button**, in the header, on every page. It's no longer a menu item in each app.
- **Bottom of the menu: Settings, then the account switcher**, which shows the company, its credits and Top up. "Powered by",
  Support and Documentation move into the **?** (help) menu in the header.
- **Collapsed rail and the phone tab bar stay** (they already work); they just carry the new, shorter list.

### 3.2 Settings: one place, one left list
```
Settings
  Your account     Profile · Sign-in & security · Notifications · Install the app
  Company          Company profile (was About your business / Business Setup / Theme) · Company rules
  People           Users · Roles
  Plans & credits  Plans · Credits & top-ups · Usage
  Leads            Data sources (Connectors) · Email accounts · Forms
  Voice            Phone numbers · AI caller · Working hours
  Social           Connected accounts · Brand look for posts
  Automation       Workflows · Calendar & meetings
  Developers       API keys & webhooks · Connections
```
- Opens as a full page with its own left list (not a window over the app). Every current setting has exactly one home here.
- The profile menu shrinks to: Your profile, Settings, Sign out.

### 3.3 Home
- **Greeting, then one "Next step" card.** Show only the single most useful unfinished step, not a 5-step checklist (the checklist
  is still in Settings → Company).
- **Your apps, then the others.** The app cards show what's happening ("12 new replies", "3 posts to approve", "550 credits"), with
  one button each: **Open**.
- **An app you haven't bought shows as an offer**, in neutral colours: "Add Voice: AI calls from £199.99/month · See plans".
  Never "Out of credits" in red.

### 3.4 Find Leads (the pattern for every list screen)
- **Toolbar:** search, Filters, Saved searches. That's all.
- **Results header:** the count, Companies / People, List / Map, and a "⋯" menu (Import, Export, Save this search).
- **Import appears once**, in Lists (where imported companies end up) and in the "⋯" menu, not in the page header too.
- **The filter panel shows labels and inputs only.** Help text becomes a small ⓘ next to the field.
- Applied to Lists, Journeys, Voice's Call list and Social's Calendar the same way.

### 3.5 The staff portal
- **Five groups instead of 16 flat items:**
  - **Overview:** Dashboard, Alerts
  - **Customers:** Clients, Demo organisations, Partners, Brands
  - **Money:** Revenue, Plans & pricing, Balances
  - **Platform:** Providers, Platform keys, Mailbox, API access, Assistant
  - **Operations:** Queue, Logs, Staff
- **Alerts are grouped by kind.** One row per kind, with "seen 12 times since 25 Nov" and Dismiss.
- **The start-up check stops alerting when nothing changed:** it raises CFG-01 only when its findings differ from the last one.
- **Expected findings are no alert at all.** Stripe in test mode on the test copy, for example, is shown on the Dashboard's
  Platform services row, which already says it.
- **The Dashboard leads with the numbers.** Alerts become a single line ("2 things need a look →") unless something is urgent.

---

## 4. Steps, in order

Each step is a separate commit or two, checked in a browser on the test copy, with the full test suite before any push.

| # | Step | What changes | Size |
|---|---|---|---|
| 1 | **Identity** | Outreach top-left everywhere (Home too); the company only in the account switcher, never cut off. Follows decision 1. | S |
| 2 | **Staff portal tidy** | Five menu groups; alerts grouped by kind; CFG-01 only on a change; expected test-copy findings not alerted. | S–M |
| 3 | **One shell and one menu** | The shared suite menu (3.1) in place of the three per-app menus and the app switcher; AI Assistant only in the header; help menu. Old `#/…` links keep working. | L |
| 4 | **Settings** | One Settings page (3.2); every setting moved there; the profile menu cut to three; the Team window and the per-app Setup groups go. | L |
| 5 | **Home** | Next step card, app cards with live figures, offers instead of red "Out of credits". | M |
| 6 | **Busy screens** | Find Leads first (3.4), then Lists, Journeys, Voice's Call list and Social's Calendar. One action once; help text into ⓘ. | M each |
| 7 | **Search (⌘K)** | Pages and settings first, then companies, lists and people. | M |
| 8 | **Words** | One glossary, then the menu, page titles and buttons renamed to it (e.g. Company profile, Data sources, Email accounts). | S |
| 9 | **Dark mode** | Last, as planned (plan 10). It is cheaper after 3–6, because the shell and settings are rebuilt once. | M |

Steps 1 and 2 are small and can start at once; they fix the two things the owner pointed at first. Step 3 is the big one: everything
after it gets simpler because of it.

**How we'll know it worked:** before step 3, time and count the clicks for five everyday tasks on the test copy, then again after
step 6:
1. find accountants in Leeds and save 10;
2. add a user;
3. top up Leads;
4. approve a social post;
5. see yesterday's calls.

The aim is fewer clicks for each, and no task that needs the person to know which app a setting lives in.

---

## 5. What doesn't change
- What each app can do, its prices, credits per app, and every rule and permission (plans 11 and 12).
- The work done on colours and shared parts (plan 10, Phase 4): the new shell is built from `app/ui.jsx` and the tokens.
- Phones keep the tab bar along the bottom; it carries the new short menu.
- Partner embeds (`embed/`) keep showing only the pages a partner allows, with no menu of ours around them.

---

## 6. Decisions (answered by the owner, 2026-11-26)
1. **White-label: "brand name should show in bottom of side bar only."**
   - Outreach's name and logo everywhere: Home, the sidebar head, the sign-in page.
   - The customer's company appears only in the account badge at the bottom of an app's sidebar.
   - No brand's name or logo replaces Outreach's anywhere else.
   - Partner embeds (`embed/`) are inside the partner's own page and are left as they are.
2. **Keep the app switcher.** Section 3.1 changes: each app keeps its own menu, but all three use one short layout. The work goes in
   the menu, setup goes to Settings, and the AI Assistant, Support and Documentation each appear once.
3. **Apps not bought:** one quiet "Try" line in the app switcher, and a neutral offer card on Home. Never "Out of credits" in red.
4. **Start with steps 1 and 2.**
