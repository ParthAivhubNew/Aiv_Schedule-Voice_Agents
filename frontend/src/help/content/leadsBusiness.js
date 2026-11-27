export const leadsBusinessDoc = {
  id: "leads-business",
  path: "/help/leads/business",
  title: "Company profile",
  summary: "Tell Outreach what you sell, who you sell to and who is sending, so the assistant and the email writer say only true things.",
  sections: [
    {
      id: "why-it-matters",
      heading: "Why this page matters",
      blocks: [
        {
          type: "paragraph",
          text: "\"About your business\" is your company profile. Open it from the left menu, under Setup. The AI Assistant and the email writer read it every time they write. They are allowed to say about you only what is on this page, and nothing more.",
        },
        {
          type: "paragraph",
          text: "The profile is shared with your other Outreach tools. If you change it here, it changes there too. Services you have saved elsewhere are included automatically, and the page tells you how many.",
        },
        {
          type: "paragraph",
          text: "If the basics are empty, the \"Write the emails with AI\" button and the \"Improve with AI\" buttons are switched off, and the AI cannot write a journey for you. The page tells you what is still needed.",
        },
        {
          type: "callout",
          tone: "note",
          title: "Only an admin can change it",
          text: "Because every tool reads this profile, only an admin can save changes. Other people can read it and are asked to get an admin to update it.",
        },
      ],
    },
    {
      id: "company-fields",
      heading: "What to fill in",
      blocks: [
        {
          type: "table",
          headers: ["Field", "What it changes"],
          rows: [
            ["Company name (required)", "Your trading name. The AI uses it when it refers to your business."],
            ["Website", "Optional. Shown to the AI as your website."],
            ["Sign-off name (required)", "The name emails are signed with, for example Priya Shah."],
            ["Sign-off job title", "Optional. Shown under the name."],
            ["What your business does (required)", "Plain words about what you sell. The AI cannot say more about you than this."],
            ["Who it is for", "Who you help. It helps the AI aim the email."],
            ["Proof it may quote, one per line (only true things)", "The only results, numbers or customers the AI may quote. Leave it empty and the AI quotes none."],
            ["What to offer them", "The next step you offer the reader, for example a free 15-minute review."],
            ["Tone", "For example friendly, formal or direct."],
            ["Registered company name (printed in every email)", "The legal name of the company that sends. It is printed at the bottom of every marketing email."],
            ["Postal address (printed in every email)", "Where a person can write to you. It is printed at the bottom of every marketing email, as UK law requires."],
          ],
        },
        {
          type: "paragraph",
          text: "Press \"Save\" to keep your changes. \"Reset\" puts back what was last saved. The three required fields are your company name, what your business does, and the sign-off name.",
        },
        {
          type: "callout",
          tone: "warning",
          title: "Registered name and postal address",
          text: "A journey with email steps will not start until the registered company name and the postal address are filled in. UK rules need every marketing email to say who sent it and where to write to them.",
        },
      ],
    },
    {
      id: "proof-and-facts",
      heading: "Keep it true",
      blocks: [
        {
          type: "paragraph",
          text: "Every email the AI writes is checked against what you entered and against what Outreach holds about the receiving company. The AI is told never to invent a statistic, customer, award, deadline or claim. If a written email still contains something the facts do not back up, the screen flags it before you can send it. You can edit the line, remove it, or ask the AI to change it.",
        },
        {
          type: "paragraph",
          text: "That is why \"Proof it may quote\" matters. Add only results you could show to a customer, such as \"We have looked after 40 local shops since 2015\". A vague profile gives vague emails. A false line in the profile would be repeated to every recipient.",
        },
      ],
    },
    {
      id: "ideal-customer",
      heading: "Your ideal customer",
      blocks: [
        {
          type: "paragraph",
          text: "Below the profile is a card called \"Your ideal customer\". It holds who you want to sell to. Once it is set, each company gets a fit score from 0 to 100, worked out only from facts held about the company, with the reasons beside it. If nothing is set, no scores show.",
        },
        {
          type: "table",
          headers: ["Setting", "What it does"],
          rows: [
            ["Industries", "Type a trade such as cafes or plumbing, or a SIC code, and pick from the codes the register uses."],
            ["Postcode areas", "The first part of a postcode: LS for all of Leeds, or LS6 for one district."],
            ["Or a distance around a postcode", "A postcode and a number of miles."],
            ["Size, from their filed accounts", "Tick the size bands that suit you."],
            ["Company types", "Tick the kinds of company you want."],
            ["Leave out charities", "On by default."],
          ],
        },
        {
          type: "paragraph",
          text: "Pick at least one industry, area, size or company type for scores to show. \"Set it from my website\" reads your own website and fills in who you seem to sell to. Nothing is saved until you press \"Save\".",
        },
      ],
    },
    {
      id: "assistant-and-writer",
      heading: "How the assistant and the email writer use it",
      blocks: [
        {
          type: "paragraph",
          text: "The AI Assistant reads the profile to find companies that fit, to write draft journeys and to explain why a company suits you. If the profile is thin, a \"Customize your AI\" line in the assistant suggests what to add. The assistant can also fill the basics in for you. In its start screen, \"Tell me about your business\" takes your website address, \"Read it\" fills in the company name, what you sell, who buys it, your main offer and how you speak, and \"Save\" keeps it.",
        },
        {
          type: "paragraph",
          text: "The email writer reads the profile in the journey setup. \"Write the emails with AI\" writes the whole sequence from the profile and from what the list has in common. \"Anything to add?\" takes one extra instruction. The \"Improve with AI\" buttons, \"Shorter\", \"Softer ask\", \"More formal\", \"Clearer\" and \"Your own...\", change one email. Writing is limited each day, and the screen tells you when you reach it.",
        },
        {
          type: "paragraph",
          text: "\"Open each email with a line about that company\" adds an opening line for each company, built only from facts held about it, with the facts shown beside it. You can edit any line, and if nothing solid is known, the email simply opens without one. You are charged only for lines written, at 1 credit per 5.",
        },
      ],
    },
    {
      id: "legitimate-interests",
      heading: "The legitimate interests record",
      blocks: [
        {
          type: "paragraph",
          text: "At the bottom of the page is a card called \"LIA: why you may email these companies\". A legitimate interests assessment is a short record of why contacting a business is fair. It has four parts: \"Purpose: what you want and why\", \"Necessity: why contacting them is needed\", \"Balance: how it affects the people you write to\" and \"Safeguards: what protects them\".",
        },
        {
          type: "paragraph",
          text: "It starts with our suggested wording. Change it to fit how you really work, then save. The card shows when it was last saved and by whom. We keep your record. We do not judge it.",
        },
      ],
    },
  ],
};
