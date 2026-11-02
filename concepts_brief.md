# Outreach: Whole-Project Brief (first draft)

* **Author:** Parth Barot
* **Date:** 2026-11-02
* **Status:** Draft built from project memory and the repo. Not yet reviewed by Goldfish lenses. Mark it up, then tell me which screen or feature to brainstorm first.

## Overview

Outreach (outreach.aivhub.com) is a multi-company web app that finds business leads, contacts them by email and phone, and posts to social media. It has three plugins that work alone and together.

| Plugin | What it does | Main parts |
| :--- | :--- | :--- |
| **Lead Gen** | Finds companies and people, saves them to lists, runs outreach. | Find Leads (People/Companies tabs, filters, ranked tiers, profile drawer, map, AI chat), Company page, Lists, Saved accounts, Journeys (email sequences with call and manual-task steps), Mail, Today agenda, Number check, Import |
| **Voice** | AI cold-calls and answers calls, books meetings. | Missions (campaigns), Prospects, Live calls (listen in, take over), Call log, Meetings and built-in calendar, Callbacks, Conversation templates, UK PECR rules (calling hours, lunch break, do-not-contact) |
| **Social (Post Scheduler)** | Plans and publishes posts. | AI planner chat, Approval inbox, Post editor, Calendar, Carousels and video, Reddit, Library, Reports, Listening, Tracked links, Test mode |

Shared across all three: company profile and knowledge base, one do-not-contact list, credits, the assistant chat, Workflows, Connections, and a "Today" agenda that shows one day across every app the company has.

Who uses it: small teams selling to UK businesses (data starts from 5.7M Companies House rows plus CQC, Charity Commission and FSA). Partners (e.g. TenderFlow) use it without the screens, through `/v1/run` with an `sk_` key.

## How the pieces connect

* Lead Gen calls leads through Voice (`Call` button, calls start from a Lead Gen list). Voice meetings and replies update the lead's stage and timeline.
* Social engagement (people who react or comment) can become leads.
* Workflows: "when X happens, do Y" across plugins (8 events, 8 actions, if/else, wait, run log, Try it).
* The assistant chat can do anything a screen can, except start a journey. It proposes and the person confirms.
* Clients never see supplier names (Telnyx, xAI and so on). Platform keys drive all calls.

## Analysis (what is weak or unfinished today)

1. **Two frontends per screen.** The classic edition inside the ~25,800-line `App.jsx` and the modular "simple" edition. Many `views/` files are dead. Every change risks editing the wrong copy.
2. **Journeys gaps.** No CC/BCC sending, no "Add to journey" from Find Leads, no TPS/CTPS screening or AI-call consent (a legal question), no director-owned-companies lookup.
3. **Apollo parity gaps (agreed order A–F).** AI Research columns, Lookalikes UI, Agents and Copilot, call AI (Ask over calls), scheduled workflow triggers, saved searches with alerts, Cmd-K search, Slack, MCP.
4. **Find Leads deferred.** Saved-search alerts, Add-to-list cost preview, column chooser, cross-channel filters, hiring/funding/lookalike filters.
5. **Company page missing.** Call button, financial figures, similar companies, "Open page" from Saved accounts and Lists rows.
6. **Partner API open items.** Own-number porting, voice cloning, Listening and tracked links for partners, per-partner address limits. Billing and top-up are deliberately last.
7. **Tests.** Seven known failing tests on a clean checkout (voice clone, webhook network guard, revenue, signup x2 with Firebase env, Telnyx price). Full run takes about 20 minutes.
8. **Data trust.** Web-found contact data stays labelled "unverified" and never overwrites registry data. Any new feature must keep this.

## Goals vs. Non-Goals

* **In-Scope Goals:** keep the three plugins working alone and together; finish Apollo-parity groups A–F in the agreed order; close Journeys and Company page gaps; finish partner API coverage.
* **Out-of-Scope Non-Goals (for now):** partner billing and top-up; third-party logo fetching (initials tiles on purpose); showing origin and freshness date on every assistant result (declined); claiming features that are not built.

## Alternatives Weighed

* Merge the two frontend editions into one: not decided. Cost is high, benefit is fewer wrong-file edits.
* Build Agents on the existing campaign engine pattern (`call_schedule_engine`) versus a new scheduler: leaning to reuse.
* Sequences as a new feature versus extending email campaigns: chose extending (Journeys uses the same tables).

## Key Decisions & Staging for Next Steps

Decided: product name "Outreach"; simple edition is the default and the active path; plan first, layman's wording, label data origin; chat never starts journeys.

Questions for you to answer while reading:
1. Which plugin or screen should the first brainstorm cover?
2. Is the Apollo-parity order (A Context+Memory, B AI Research, C Lookalikes, D Agents+Copilot, E call AI, F triggers/alerts/Cmd-K/Slack/MCP) still right?
3. Should the two frontend editions be merged, or left as they are?
4. Do you want TPS/CTPS screening and AI-call consent handled before Journeys call steps go to real customers?
5. Anything above that is wrong or missing?
