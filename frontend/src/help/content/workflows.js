export const workflowsDoc = {
  id: "workflows",
  path: "/help/workflows",
  title: "Workflows",
  summary: "Automate cross-app actions triggered when calls end, emails receive replies, or meetings are booked.",
  sections: [
    {
      id: "overview",
      heading: "Overview",
      blocks: [
        {
          type: "callout",
          tone: "note",
          title: "Note",
          text: "This guide is being written.",
        },
        {
          type: "paragraph",
          text: "Workflows connect Leads, Voice, and Social together. For example, when a call completes with an interested outcome, you can trigger a follow-up journey or draft a social spotlight.",
        },
      ],
    },
    {
      id: "triggers-and-actions",
      heading: "Triggers and actions",
      blocks: [
        {
          type: "table",
          headers: ["Trigger Event", "Source App", "Available Actions"],
          rows: [
            ["Call completed", "Voice", "Add to list, start journey, send webhook"],
            ["Meeting booked", "Voice", "Update status, notify team"],
            ["Reply received", "Leads", "Pause sequence, create task"],
          ],
        },
      ],
    },
  ],
};
