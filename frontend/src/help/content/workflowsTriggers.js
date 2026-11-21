const p = (text) => ({ type: "paragraph", text });

export const workflowsTriggersDoc = {
  id: "workflows-triggers",
  path: "/help/workflows/triggers",
  title: "Cross-App Triggers & Actions",
  summary: "Explore all available system triggers across Leads, Voice, and Social, and configure automated actions, webhooks, and notifications.",
  sections: [
    {
      id: "overview",
      heading: "Understanding Triggers & Actions",
      blocks: [
        p("A trigger is an event that occurs in your workspace that initiates a workflow. An action is an automated operation executed by the system in response to that trigger. Because Outreach shares a unified database across Leads, Voice, and Social, events in one module can trigger actions in any other module seamlessly."),
      ],
    },
    {
      id: "available-triggers",
      heading: "System Triggers by Application",
      blocks: [
        p("Outreach monitors the following events across your apps:"),
        {
          type: "table",
          headers: ["App", "Trigger Event Name", "Trigger Condition & Data Available"],
          rows: [
            ["Voice", "Call Ended", "Fires whenever an outbound or inbound call terminates. Includes duration, outcome disposition, transcript, and audio link."],
            ["Voice", "Meeting Booked", "Fires when the AI or softphone successfully confirms a calendar appointment. Includes date, time, and attendee details."],
            ["Voice", "Voicemail Left", "Fires when an answering machine is detected and a message is recorded."],
            ["Leads", "New Lead Saved", "Fires when a company or officer is saved from Find Leads into a list."],
            ["Leads", "Email Opened / Clicked", "Fires when a prospect opens an outreach sequence email or clicks an embedded tracked short link."],
            ["Leads", "Email Reply Received", "Fires when a prospect replies to an email journey. Includes parsed reply sentiment (Interested, Question, or Opt-Out)."],
            ["Leads", "Inbound Form Submitted", "Fires when a visitor completes a public web form created in Forms."],
            ["Social", "Post Published", "Fires when a scheduled social post is broadcast to live feeds."],
            ["Social", "Approval Requested", "Fires when new drafts are queued and require team review."],
          ],
        },
      ],
    },
    {
      id: "available-actions",
      heading: "Available Workflow Actions",
      blocks: [
        p("When a trigger fires, you can chain together any combination of the following actions:"),
        {
          type: "table",
          headers: ["Action Category", "Specific Operation", "What It Does"],
          rows: [
            ["CRM & Pipeline", "Update Lead Stage", "Transitions the company's status (e.g. from 'Contacted' to 'Qualified Opportunity')."],
            ["CRM & Pipeline", "Add Follow-Up Task", "Creates an urgent task in your dashboard with an assigned due date and reminder."],
            ["Messaging & Email", "Send Email Template", "Dispatches a bespoke email from your connected mailbox containing dynamic prospect variables."],
            ["Telephony", "Queue for AI Calling", "Inserts the contact into your priority outbound phone queue for immediate or scheduled dial."],
            ["External Integration", "Dispatch Outbound Webhook", "Sends a real-time JSON payload to an external URL (e.g. Zapier, Make, Salesforce, or internal API)."],
            ["Alerts", "Team In-App Notification", "Pushes an immediate bell notification to designated team members."],
          ],
        },
      ],
    },
    {
      id: "webhook-payloads",
      heading: "Configuring Outbound Webhooks",
      blocks: [
        p("Outbound webhooks allow you to send real-time data to external enterprise systems:"),
        {
          type: "steps",
          items: [
            "Select 'Send Webhook' as your action step.",
            "Enter the target destination URL (must use HTTPS).",
            "Select HTTP Method (POST or PUT).",
            "Custom Headers: Add authentication headers (e.g. 'Authorization: Bearer your_token').",
            "Automated Payload: Outreach automatically bundles the complete event context: company registration number, officer names, call summary, and event timestamp.",
            "Test Payload: Click 'Test Webhook' to transmit a sample payload and verify HTTP 200 receipt.",
          ],
        },
      ],
    },
    {
      id: "action-delays",
      heading: "Time Windows & Execution Delays",
      blocks: [
        p("Avoid overwhelming prospects by adding natural spacing:"),
        {
          type: "steps",
          items: [
            "Wait Step: Add a 'Wait for X hours/days' step between an email opening and an automated follow-up call.",
            "Business Hours Clamp: Configure actions to only execute between 09:00 and 17:30 UK time, pausing overnight and resuming the following morning.",
          ],
        },
      ],
    },
  ],
};
