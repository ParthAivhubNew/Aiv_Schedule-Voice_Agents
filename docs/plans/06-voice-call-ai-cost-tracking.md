# Plan F — Track the real AI cost of a voice call, not just Telnyx's carrier rate

## The gap, confirmed in code
"Our cost per unit" → "Voice call minute" is the only cost figure for a call anywhere in the
system. It's one manually-typed number (`backend/app/services/revenue.py` reads it from
`DEFAULT_RATES["voice_minute"]`-keyed staff input), and nothing enforces what it represents.
Checked `CallLog` (`backend/app/models/models.py:311`, the table that records every call) — it
has no cost or token field at all. Whichever LLM actually answers the phone (Telnyx's own
AI, or another provider depending on how the voice stack is configured — see
`voice_plugin_plan.resolve_voice_plan()`) costs real money per call, and that cost is currently
invisible: not measured, not stored, not reflected in margin anywhere.

This mirrors a problem the codebase already solved once: `EnrichmentAttempt.cost_usd`
(`backend/app/models/models.py`, Leadgen's enrichment waterfall) already tracks the real
per-lookup provider cost for lead-finding. Voice calls have no equivalent.

## Decision needed from you first
Does the AI-usage cost become a **second credit charge to the customer** (on top of the existing
`voice_minute` charge), or does it stay **internal cost-visibility only** (so margin on the
existing `voice_minute` charge is calculated correctly, without charging the customer twice for
one call)? This plan assumes **internal visibility only** — it does not add a new customer-facing
charge — because that's what your actual question was about (the Revenue/margin page), and adding
a second charge is a pricing decision, not a bug fix. Say the word if you want the double-charge
version instead; the backend pieces below are mostly the same either way, just with one more
rate-card item and a `credits.charge()` call added at the end.

## Step 0 — Investigate before building (don't guess the capture point)
The exact place to capture token/cost usage depends on which engine actually serves a given call,
resolved dynamically per call by `resolve_voice_plan()`:
- **Telnyx-hosted AI Assistant** (managed): Telnyx's own post-call "insights" webhook event
  (`backend/app/api/telnyx_assistant_webhook.py` already receives these, currently just logs them
  per its own docstring — "post-call / insights events fire once the call ends, for logging").
  Check whether that payload actually includes token/usage/cost fields Telnyx provides — read a
  real captured payload (`process_logs` table, subsystem `telephony`, already logs the raw body
  per `telnyx_assistant_webhook.py`'s `log_process_event` calls) rather than assuming the shape.
- **Self-hosted LiveKit pipeline** (STT → LLM → TTS orchestrated by this app, LLM call going
  through `llm_gateway.py`): the LLM provider's own API response (OpenAI/Anthropic/etc. chat
  completion responses include `usage.prompt_tokens`/`completion_tokens`) is already being
  discarded by `call_open_chat_llm`/`resolve_llm_credentials` — find exactly where the live-call
  LLM request happens in the LiveKit agent path and confirm the raw response (with usage data) is
  reachable there before committing to the field design below.

Do this read-only investigation first, report what's actually available in each path, then proceed
— the schema and charge in the following steps are easy to adjust, but only once it's known what
data genuinely exists to populate them.

## Step 1 — New columns on CallLog
```python
llm_provider = Column(String, default="")        # which provider actually served this call
llm_tokens_in = Column(Integer, nullable=True)
llm_tokens_out = Column(Integer, nullable=True)
llm_cost_usd = Column(Float, nullable=True)       # real cost, computed from the provider's own
                                                    # per-token pricing, same pattern as
                                                    # EnrichmentAttempt.cost_usd
```
Add via the standard `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` migration step
(`backend/app/core/migrations.py`, same pattern as every other step in that file).

## Step 2 — Populate it
Wire the capture point(s) found in Step 0 to write these fields onto the `CallLog` row when the
call ends (same place `duration`/`outcome`/`transcript` already get written — find that write
site and add these fields alongside it, don't create a second write path).

## Step 3 — Surface it in Revenue
In `backend/app/services/revenue.py`'s `report()`: alongside the existing manually-entered
"Voice call minute" cost, add a second, **computed** (not staff-typed) figure — the actual sum of
`CallLog.llm_cost_usd` for calls in the selected month — shown as its own row in the "Usage and
our cost" table (e.g. "AI usage during calls"), separate from the Telnyx carrier estimate. Margin
for the voice wallet should subtract both the entered Telnyx rate *and* this real AI cost sum, not
just the one manually-entered number as it does today.

## Build order
1. Step 0 (investigate) — don't skip this, the whole design depends on what's actually available.
2. Step 1 (schema) — small, safe, additive.
3. Step 2 (capture) — the real work; scope depends entirely on Step 0's findings.
4. Step 3 (Revenue display) — small, depends on Steps 1-2 being populated first to mean anything.

Test against a handful of real calls (both a Telnyx-managed-assistant call and a self-hosted
LiveKit call, if both paths are actually in use) before trusting the numbers — confirm the
captured cost roughly matches what the provider's own billing dashboard shows for that call,
not just that a number appears.
