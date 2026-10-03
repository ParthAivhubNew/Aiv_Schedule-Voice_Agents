# Plan C — Lock plugin tabs until subscribed

## Goal
In every plugin (Voice, Post Scheduler, Leadgen — per Plan A, Email is no longer a separate
hub app), every tab except Subscription is **translucent and unclickable** until the org has an
active plan for that plugin's wallet. This applies the same way everywhere — one shared
implementation, not per-plugin logic.

## What "active plan" means
`hasActivePlan(wallet)` = `BillingSubscription.plans[wallet]` points at a **paid** plan row — one
actually purchased through Stripe checkout. There is no free tier and no trial of any kind. Per
Plan A §3, the old automatic starter-credit grant is deleted outright, not replaced — a brand-new
org has zero credits, no plan, and every tab locked until an admin pays.

## Backend
- Extend the existing billing-overview endpoint (`GET /billing/overview`, feeds
  `frontend/src/team/SubscriptionPage.jsx:27`) to return `has_active_plan` per wallet alongside
  the balance info it already returns.

## Frontend
- One shared component, e.g. `PluginAccessGate`, used identically by Voice, Post Scheduler, and
  Leadgen's plugin shells.
- **Nav tabs**: when `!hasActivePlan(wallet)`, every tab except Subscription renders with
  `opacity: 0.4; cursor: not-allowed; pointer-events: none` (or an onClick that no-ops / shows a
  short toast — "Subscribe to unlock this") instead of navigating. Subscription tab stays fully
  normal and clickable always.
- **Deep links**: a locked tab's hash (typed URL, bookmark, old link) must not bypass the visual
  lock. When `!hasActivePlan(wallet)`, the plugin shell renders the Subscription page content in
  the main pane regardless of which sub-hash was requested, while the tab bar still shows the
  requested tab as the "active-looking" one but translucent — i.e. the content area is always
  Subscription-only pre-plan, no matter how the user got there.
- Apply via the plugin shell wrapper, not inside each individual tab/view component — same gate
  object wraps all three plugins so there is exactly one place this logic lives.

## Scope check
Only 3 plugins need this per Plan A (Email no longer exists as a separate hub entry — its views
live inside Leadgen and are gated as Leadgen's "Email Sequences"/"Mailboxes" tabs along with
everything else leadgen-side, under the single `leadgen` wallet check).
