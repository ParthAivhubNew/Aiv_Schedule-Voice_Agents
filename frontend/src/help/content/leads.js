export const leadsDoc = {
  id: "leads",
  path: "/help/leads",
  title: "Leads",
  summary: "Find verified companies and decision makers, run personalized email sequences, and capture inbound interest.",
  sections: [
    {
      id: "introduction",
      heading: "Introduction",
      blocks: [
        {
          type: "callout",
          tone: "note",
          title: "Note",
          text: "This guide is being written.",
        },
        {
          type: "paragraph",
          text: "The Leads app combines targeted search filters, contact lists, multi-stage journeys, mailbox management, and custom web forms.",
        },
      ],
    },
    {
      id: "core-capabilities",
      heading: "Core capabilities",
      blocks: [
        {
          type: "table",
          headers: ["Capability", "Description", "Location"],
          rows: [
            ["Find leads", "Search verified company and contact directories", "Leads > Find leads"],
            ["Lists", "Organize prospect accounts and manage imports", "Leads > Lists"],
            ["Journeys", "Automated sequence steps and conditional triggers", "Leads > Journeys"],
            ["Mail", "Connected mailboxes, deliverability, and replies", "Leads > Mail"],
            ["Forms", "Lead capture forms for your website", "Leads > Forms"],
          ],
        },
      ],
    },
  ],
};
