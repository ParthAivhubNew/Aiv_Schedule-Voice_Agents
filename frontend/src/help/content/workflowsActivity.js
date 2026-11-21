const p = (text) => ({ type: "paragraph", text });

export const workflowsActivityDoc = {
  id: "workflows-activity",
  path: "/help/workflows/activity",
  title: "Activity & Run History",
  summary: "Monitor live workflow executions, inspect step-by-step audit logs, diagnose failed actions, and retry stalled automation runs.",
  sections: [
    {
      id: "overview",
      heading: "Overview of Workflow Activity",
      blocks: [
        p("The Activity tab in Workflows provides complete observability into every automated run. Whenever an event triggers a workflow, an execution record is created, detailing every condition evaluated, step performed, webhook sent, and operational error encountered."),
        p("The activity feed updates continuously in real time (refreshing every 10 seconds), allowing you to watch complex multi-step automations unfold as customer interactions happen across Leads, Voice, and Social."),
        p("Observability and error resilience are essential for high-volume outreach operations. The activity ledger guarantees that every trigger event produces an immutable audit record, ensuring zero lost leads and total transparency."),
      ],
    },
    {
      id: "run-statuses",
      heading: "Understanding Execution Statuses",
      blocks: [
        p("Each workflow execution is assigned a clear operational status:"),
        {
          type: "table",
          headers: ["Status", "Visual Indicator", "Meaning & System Action"],
          rows: [
            ["Success", "Emerald Check", "Every step and branching condition executed cleanly without errors or timeouts."],
            ["In Progress / Waiting", "Blue Pulse", "Currently paused at a time-delay step (e.g. 'Waiting 2 business days before automated follow-up call')."],
            ["Skipped", "Slate Arrow", "Trigger fired, but an 'Only if' filter condition was not met (e.g. call was answered, but outcome was not 'Meeting Booked')."],
            ["Failed", "Rose Cross", "An action step failed (e.g. external webhook returned HTTP 500 or recipient mailbox bounced)."],
          ],
        },
      ],
    },
    {
      id: "inspecting-runs",
      heading: "Inspecting Step-by-Step Logs",
      blocks: [
        p("Clicking on any execution record opens the Detailed Run Inspector sidebar:"),
        {
          type: "steps",
          items: [
            "Trigger Event Data: Inspect the exact JSON event payload that initiated the run (e.g. caller phone number, call duration, transcript snippet, or form submission fields).",
            "Condition Check: Shows exactly why a filter evaluated to True or False with evaluated variables.",
            "Step Timestamps: Millisecond timestamps recording when each sequential action began, executed, and completed.",
            "Outgoing Webhook Payloads: Review the exact HTTP body, headers, and destination response codes for outbound webhooks.",
          ],
        },
      ],
    },
    {
      id: "handling-failures",
      heading: "Diagnosing & Retrying Failed Actions",
      blocks: [
        p("If an external server goes down or a temporary network glitch occurs:"),
        {
          type: "steps",
          items: [
            "Error Diagnostics: The run inspector highlights the exact failing step in red with the server error message (e.g. 'Webhook endpoint timed out after 10s').",
            "One-Click Retry: Click 'Retry Execution' to re-run the failed step with the original payload, resuming the workflow seamlessly from the point of failure.",
            "Bulk Retry: Use the filter to display all failed runs from the past 24 hours and click 'Retry All Failed' to process them in the background.",
          ],
        },
      ],
    },
    {
      id: "audit-retention",
      heading: "Audit Trail Retention & Privacy",
      blocks: [
        p("Execution history is maintained in compliance with corporate governance and data audit requirements:"),
        {
          type: "steps",
          items: [
            "Rolling 90-Day History: Detailed step logs and payloads are stored for 90 days, after which summary metrics are aggregated into historical trend reports.",
            "Data Privacy: Personally identifiable information in webhook payloads respects your organization's data retention and compliance policies.",
            "Export Run History: Download complete execution records as CSV spreadsheets for compliance audits, management reviews, or external logging.",
          ],
        },
      ],
    },
  ],
};
