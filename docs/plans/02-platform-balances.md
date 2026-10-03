# Plan B — "Balances" admin tab

## Goal
A staff-only admin tab named **Balances** (not "Platform Health") showing how much prepaid
credit/funds remain on the main company's own provider accounts — the keys everyone's usage is
metered against. Confirmed today: zero code queries any provider for this; only after-the-fact
Telnyx usage/cost reporting exists (`backend/app/services/telnyx_usage.py`).

## Providers with a real balance API — poll these live
- **Telnyx**: `GET /v2/balance` → `available_credit`, `balance`, `currency`. Add
  `TelnyxClient.get_balance()` in `backend/app/services/telnyx_client.py`, next to the existing
  `usage_report()` (line ~285). Uses the same `platform_key()` auth as everything else in that
  file (line 27-60).
- **DeepSeek**: `GET https://api.deepseek.com/user/balance`. Add alongside wherever DeepSeek
  calls currently live.
- Antigravity must confirm both exact paths/response shapes against each provider's *current*
  docs before wiring — API surfaces drift and these were not verified live, only recalled.

## Providers with no balance API — can't be polled
OpenAI, Anthropic, Groq, xAI, ElevenLabs, Deepgram, Cartesia, Cal.com do not expose an
account-balance endpoint. Don't attempt to poll these. Instead:
- Catch `402`/"insufficient quota"-type errors at call time on the *main company* key specifically
  (not user-supplied keys — `key_validator.py` already does this for those) and raise a staff
  alert when it happens.
- The real fix for these is outside the codebase: set spend-alert thresholds directly in each
  provider's dashboard (most support an email alert at a $ threshold). This is a one-time manual
  setup task, not something to build.

## UI
- New tab in the admin portal, labeled **Balances**.
- One card per polled provider (Telnyx, DeepSeek): live balance, currency, a configurable
  low-balance threshold, red/yellow/green indicator, manual "Refresh" button. Optional: poll
  automatically every 15 min via the existing scheduler.
- One section below listing the non-pollable providers as a static checklist ("Dashboard alert
  configured: yes/no", editable by staff) so there's at least a visible reminder of which
  providers still need manual spend-alert setup, and whether that setup has been done.
