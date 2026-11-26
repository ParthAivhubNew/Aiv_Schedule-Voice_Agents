# 13 — Simplify the whole app: one shell, fewer menus, plain screens

Written 2026-11-26, after the owner looked at the test copy and said the app is confusing, the side menu is congested, the client's
name sits where Outreach should be, and the staff portal looks complicated. Based on a read of the frontend code (menus, shell,
brand logic, staff portal) and the owner's screenshots of Home, Find Leads and the staff Dashboard. **No code has been changed.**

**Status (2026-11-26):** plan only. Waiting on the owner's answers to the decisions in section 6 before step 1 starts.

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

## 6. Decisions the owner needs to make
1. **White-label.** Should any customer ever see its own name and logo in place of Outreach's?
   - Recommended: only a paying partner on its own web address (e.g. outreach.fsb.org.uk).
   - Everyone else, FSB on new.outreach / outreach.aivhub.com included, sees Outreach, with their company in the account switcher.
2. **One menu for all apps (3.1), or keep an app switcher** with one shared menu layout inside each app?
   - Recommended: one menu. It removes the switching, and most customers will own one or two apps.
3. **Apps not bought:** show them in the menu as one "Try" line each (recommended), or hide them and offer them only on Home?
4. **Order of work:** steps 1–2 first (small, visible quickly), then 3–4 together. Or would you rather see a clickable mock-up of
   the new shell and Settings on the test copy before step 3 starts?
