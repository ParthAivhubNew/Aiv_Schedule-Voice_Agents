const p = (text) => ({ type: "paragraph", text });

export const workflowsBuilderDoc = {
  id: "workflows-builder",
  path: "/help/workflows/builder",
  title: "Workflow Builder & Canvas",
  summary: "Design automated cross-application pipelines connecting Leads, Voice, and Social with step-by-step branching and conditional logic.",
  sections: [
    {
      id: "overview",
      heading: "Overview of the Workflow Builder",
      blocks: [
        p("The Workflow Builder allows you to create autonomous, event-driven pipelines that link together all parts of the Outreach platform. A workflow operates on a simple but powerful principle: 'When this specific event happens, automatically execute these sequential actions.'"),
        p("Workflows eliminate repetitive manual coordination. For example, a single workflow can listen for an answered phone call in Voice, examine the outcome, update the prospect's stage in Leads, and dispatch a tailored email confirmation—all within seconds."),
      ],
    },
    {
      id: "building-a-workflow",
      heading: "Step-by-Step Workflow Construction",
      blocks: [
        p("Creating a new workflow follows an intuitive visual structure:"),
        {
          type: "steps",
          items: [
            "Initiate Workflow: Click 'New workflow' (or 'Create a workflow' on an empty directory).",
            "Select the Trigger Event: Choose which event starts the pipeline. Triggers are organized by app: Voice (e.g. Call Completed, Meeting Booked), Leads (e.g. Email Replied, New Form Submission), or Social (e.g. Post Published).",
            "Define Filter Conditions: Narrow the trigger using 'Only when' rules (for example, only trigger if the call outcome was 'Meeting Booked' or only if the prospect's company is in London).",
            "Add Sequential Steps: Click 'Add Step' to attach actions: Change Stage, Send Email, Create Task, Webhook Dispatch, Delay / Wait, or Conditional Branch.",
            "Save & Activate: Give your workflow a clear descriptive title and click 'Save & Turn On'.",
          ],
        },
      ],
    },
    {
      id: "conditional-branching",
      heading: "Conditional Logic & Decision Branches",
      blocks: [
        p("Complex business processes often require different actions depending on prospect behavior:"),
        {
          type: "table",
          headers: ["Branch Condition", "How It Operates", "Example Use Case"],
          rows: [
            ["Call Duration Filter", "Branches based on how long a prospect stayed on the phone (e.g. > 120 seconds).", "Long conversations that did not book an immediate meeting receive a high-priority follow-up task."],
            ["Email Reply Sentiment", "Evaluates whether an incoming email reply is interested, asking questions, or declining.", "Interested replies trigger an urgent Slack alert; opt-outs trigger immediate suppression."],
            ["Lead Fit Score Tier", "Checks the AI fit score calculated during statutory registry enrichment.", "Companies scoring 90+ are routed immediately to executive calling queues."],
            ["Time Delays", "Pauses execution for a set period (e.g. 'Wait 2 business days').", "Allows natural spacing between outreach touchpoints."],
          ],
        },
      ],
    },
    {
      id: "workflow-safety",
      heading: "Safety Controls & Execution Caps",
      blocks: [
        p("To prevent runaway automation loops and ensure budget protection:"),
        {
          type: "steps",
          items: [
            "Maximum Workflows: Organizations can maintain up to 30 active workflows simultaneously, ensuring clean and maintainable architecture.",
            "Execution Loop Guards: The engine automatically detects and blocks circular triggers (e.g. an action triggering an event that triggers itself).",
            "Admin Edit Permissions: Only team members with Admin or Manager permissions can create, edit, or delete workflows. Standard viewers can inspect logic without editing.",
          ],
        },
      ],
    },
    {
      id: "pre-built-templates",
      heading: "Ready-Made Workflow Templates",
      blocks: [
        p("Outreach includes pre-built workflow templates you can activate with one click:"),
        {
          type: "steps",
          items: [
            "Voice Meeting to Calendar & Leads Sync: Automatically syncs booked phone appointments to Google/Outlook calendars and moves the prospect to 'Meeting Agreed' in Leads.",
            "Inbound Form to Auto-Call Queue: Adds website form submissions directly into the morning AI outbound calling queue within 15 minutes of submission.",
            "Post-Call Email Follow-Up: Automatically sends an executive briefing email with attachments whenever a call outcome is marked 'Information Requested'.",
          ],
        },
      ],
    },
  ],
};
