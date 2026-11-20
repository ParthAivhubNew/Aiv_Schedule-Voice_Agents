# Plan: AI chat on Workflows and on every tab of every plugin

## What exists today (verified in code)
- One chat component, `frontend/src/plugins/leadgen/AssistantPanel.jsx`, with three configs (`PLUGINS`: leads, voice, social). Backend: Leads `api/lead_assistant.py`; Voice and Social `api/plugin_assistant.py` (`POST /assistant/{plugin}/ask/stream`) on `services/assistant_engine.py`.
- Each plugin renders its own header button and panel: `LeadGenerationPlugin.jsx:352,453`, `SocialWorkspace.jsx:4026,4487`, `CallingWorkspace.jsx:2953,4677`. All three pass `PluginHeader assistant={false}`.
- All three assistants already have a `create_workflow` tool (`services/workflows.py:567`) that returns a card the person confirms.
- `GlobalAssistant.jsx` / `PluginHeader assistant` (default true) is not used by any current screen.

## Gaps found
1. **Workflows page has no usable chat.** `WorkflowsPage.jsx` is a `position:fixed; z-index:120` layer that starts at the sidebar's right edge and the header's bottom. The panel sits in the plugin layout at `z-index:70` (desktop) or `90` (phone, full screen), so it opens underneath the page. In Voice the header button is also removed on purpose (`!workflowsOn`, `CallingWorkspace.jsx:2953`).
2. **No tab awareness.** Only Social sends `workspace` (calendar). Leads and Voice send nothing, and the backend ignores `workspace` except Social's `plan_posts`. So on any tab the chat answers as if it were on the home screen, and its starter chips never change with the tab.
3. **Hidden on some tabs.** The button is not shown on the full-page "AI Assistant" tab (intended) or when the plugin is locked (intended: no plan). No other tab hides it. To be confirmed by a test that lists every tab id per plugin and asserts the button.

## Decisions
- Reuse the existing component and endpoints. No new chat, no new endpoint, no new tool.
- Workflows is one company-wide page. The chat on it is the assistant of the plugin the person came from (`context.from`, falls back to Leads if they have it, else the one plugin they own). It already can create a workflow.
- Tab awareness is one short line added to the model's context: "The person is on the <screen name> screen of <plugin>." plus, on Workflows, the open workflow's name and trigger. No data is sent beyond names that are already on screen.
- Starter chips change per tab only where a tab has clear questions; other tabs keep the plugin's defaults.

## Changes
### Frontend
1. `WorkflowsPage.jsx`
   - Add body class `wf-open` while mounted.
   - Measure the open panel (`.as-wrap`) like it already measures the sidebar and set `right` to its width on desktop, so the panel stays visible beside the page.
   - On the editor, expose the open workflow (name, trigger) through a small module store `workflows/workflowContext.js` (`setWorkflowContext`, `getWorkflowContext`).
2. `AssistantPanel.jsx` CSS: `.wf-open .as-wrap{z-index:130}` so the phone's full-screen panel is above the Workflows page.
3. `CallingWorkspace.jsx`: remove `!workflowsOn` from the button condition; pass `workspace={() => ({ screen: titles[page][0], tab: page, ...workflowContext() })}` to both `AssistantPanel`s.
4. `LeadGenerationPlugin.jsx`: pass the same kind of `workspace` (`viewTitles[view].title`, `view`).
5. `SocialWorkspace.jsx`: add `screen`/`tab` to the existing `workspaceNow`.
6. `AssistantPanel.jsx`: when `workspace().screen` is Workflows, show workflow starters ("Make a workflow that…", "Why did my last workflow fail?"). Other tabs: unchanged.
7. Remove the dead `GlobalAssistant.jsx` and the `assistant` prop of `PluginHeader` only if nothing imports them (they are unused; deleting is optional, listed so it is not forgotten).

### Backend
8. `plugin_assistant._stream` and `lead_assistant._events`: build `screen_line(workspace)` and add it to `context`. One helper in `services/assistant_engine.py`: `screen_line(workspace) -> str` (empty when no screen; clips to 120 chars; strips control characters).
9. `agent_runs` / tools unchanged.

## Revised after EGM review (this section wins over the text above)
Cut: `workflowContext.js` store, per-tab starter chips, deleting `GlobalAssistant`, any open-workflow name. Keep it to the screen name.
- Order: backend first, then frontend.
- Backend: add `workspace: Dict[str, Any] = {}` to `AskIn` (`lead_assistant.py:113`). One helper `screen_line(workspace)` in `assistant_engine.py` (keys `screen`, `plugin` only; each clipped to 60 chars, control characters removed). Insert its result into `context` in `lead_assistant._events` (after the `JA.context_line` line, ~607) and in `plugin_assistant._stream`. No new tool.
- Frontend body: `AssistantPanel.jsx:507-508` leads branch must also send `workspace`.
- Each plugin passes `workspace={() => ({ screen: workflowsOn ? "Workflows" : <tab title> })}` using `useWorkflowsOpen()`: Voice `titles[page][0]` (CallingWorkspace.jsx:2830), Leads `viewTitles[view].title` (:321), Social merges `screen` into `workspaceNow` (:3792).
- Workflows chat = the assistant of the plugin currently on screen (its panel is already mounted); no `context.from` logic.
- Placement: `WorkflowsPage` gets a `right` state next to `left`/`top`, set from the `.as-wrap` rect with a ResizeObserver on desktop; `.wf-open .as-wrap{z-index:130}` for phones. Voice drops `!workflowsOn` at :2953.
- Tab audit: tabs in Voice = keys of `titles`; Leads = keys of `viewTitles`; Social = its `page` ids. Button hidden only on the "assistant" tab and when locked.

## Not in scope
- Hub home screen (no plugin there), the full-page "AI Assistant" tab (already is the chat), Settings/Team pages, new tools per tab (reading the open Lists/Journeys tab data). Tab data tools can follow once the screen line proves useful.

## Tests
- Backend: `screen_line` (empty, normal, long, injected newlines); `_stream` context contains the line (monkeypatched `events`).
- Frontend: `workflowContext` store; vitest render of WorkflowsPage with a `.as-wrap` stub sets `right`; a per-plugin test that every tab id has the button unless locked or on the assistant tab.
- Manual (needs a browser, not available in this session): open Workflows from each plugin, desktop and phone width; panel visible, sends a message, "create a workflow" card appears over the page.

## Risks
- Measuring `.as-wrap` while it animates (`as-grow` 0.28s) gives a wrong width. Use a ResizeObserver on it, not a one-off read.
- Voice hid the button on Workflows on purpose; the reason is not in the code. The Workflows header replaces the Voice header text only, so the button should be safe, but this is the one change to check first in a browser.
- The context line is model-visible text built from client input: it must be clipped and stripped (done in `screen_line`) so it cannot carry instructions of any length.
