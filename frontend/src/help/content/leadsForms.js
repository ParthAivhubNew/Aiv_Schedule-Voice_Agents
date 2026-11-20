export const leadsFormsDoc = {
  id: "leads-forms",
  path: "/help/leads/forms",
  title: "Forms",
  summary: "Embed customizable lead intake forms on your websites and landing pages.",
  sections: [
    {
      id: "form-builder",
      heading: "Form builder",
      blocks: [
        {
          type: "callout",
          tone: "note",
          title: "Note",
          text: "This guide is being written.",
        },
        {
          type: "paragraph",
          text: "Design intake forms to collect prospect contact information, qualification criteria, and project requirements.",
        },
      ],
    },
    {
      id: "embedding-forms",
      heading: "Embedding on your website",
      blocks: [
        {
          type: "code",
          language: "html",
          code: '<script src="https://outreach.aivhub.com/forms/embed.js" data-form="your-form-id"></script>',
        },
      ],
    },
  ],
};
