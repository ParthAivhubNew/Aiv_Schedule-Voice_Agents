const p = (text) => ({ type: "paragraph", text });

export const gettingStartedDoc = {
  id: "getting-started",
  path: "/help",
  title: "Getting started",
  summary: "A first-day path through Outreach by Aivhub: Leads to find companies and email them, Voice to call them, Social to post, and Workflows to tie them together.",
  sections: [
    {
      id: "what-outreach-is",
      heading: "What Outreach is",
      blocks: [
        p("Outreach by Aivhub is three apps and one automation page. You use them in the order a customer does: find people, contact them, and keep your name in front of them."),
        {
          type: "table",
          headers: ["App", "Use it to", "Guide"],
          rows: [
            ["Leads", "Find verified target companies and decision makers, save them to lists, and run automated email sequences from your own mailboxes.", "Leads guide (/help/leads)"],
            ["Voice", "Let AI agents call your prospects, hold the conversation and book meetings while you supervise.", "Voice guide (/help/voice)"],
            ["Social", "Plan posts in a chat, approve them on a calendar, and publish to six networks.", "Social guide (/help/social)"],
            ["Workflows", "Do something automatically when a call ends, someone replies, a meeting is booked or a post goes live.", "Workflows guide (/help/workflows)"],
          ],
        },
        p("Each app is bought on its own, with its own plan and credits. You can open any app and try it before you buy."),
      ],
    },
    {
      id: "your-first-hour",
      heading: "Your first hour",
      blocks: [
        {
          type: "steps",
          items: [
            "Sign in. To create a new company account, choose “Create account” on the sign-in page. Confirm the email we send you, then sign in. The Account and billing guide (/help/account) has the details.",
            "On the home screen, look at the “Get started” list if you are an admin. It has six steps: “Describe your company”, “Set your working hours”, “Add a phone number”, “Invite your team”, “Connect a mailbox” and “Make your first call”. Each step is a button that takes you to the right place. The list goes away when you finish it or hide it.",
            "Describe your company. Everything the apps write for you, such as calls, emails and posts, is based on it. In Leads, “About your business” also sets your ideal customer, which scores companies for fit. See the About your business guide (/help/leads/business).",
            "Choose a plan for the app you want. Open the app, then “Plan & credits”. New companies start with zero credits.",
            "Invite your team from the profile menu, under “Users & roles”.",
          ],
        },
        {
          type: "callout",
          tone: "tip",
          title: "Start with one app",
          text: "You do not need to set up all three on day one. Most people start with Leads, then add Voice or Social once they have a list worth contacting.",
        },
      ],
    },
    {
      id: "first-day-leads",
      heading: "Day one in Leads",
      blocks: [
        {
          type: "steps",
          items: [
            "Open Leads and go to “Find leads”. Pick an industry and a place, then press “Find companies”. Searching our company register costs no credits. The Find leads guide (/help/leads/find) explains every filter.",
            "Open a company to see its profile. Credits are used only when you ask us to look for a contact detail we do not already hold, and the button shows the price first.",
            "Save the companies you want to a list. The Lists guide (/help/leads/lists) covers lists.",
            "Connect a mailbox before you send email. Add the SPF and DKIM settings the page shows for your domain. The Mail guide (/help/leads/mail) walks through it.",
            "Build a journey, which is a multi-step email sequence, and start it. A new mailbox warms up first: it sends a few emails a day and sends more each day for about three to four weeks. The Journeys guide (/help/leads/journeys) explains how.",
            "To collect enquiries instead of searching, build a web form. See the Forms guide (/help/leads/forms).",
          ],
        },
        p("The AI Assistant in Leads can do much of this for you in plain words. See the AI Assistant guide (/help/leads/assistant)."),
      ],
    },
    {
      id: "first-day-voice",
      heading: "Day one in Voice",
      blocks: [
        {
          type: "steps",
          items: [
            "Fill in the company page so the agent knows what to say, and set your working hours. Each call is checked against the hours you choose.",
            "Add a phone number from “Users & roles”, then “Phone numbers”.",
            "Pick a list of people to call, and place a first call yourself while you listen.",
            "Check the result of the call. A call that ends in a meeting appears as a booked meeting.",
          ],
        },
        p("Calls use Voice credits, at one credit for each minute. The Voice guide (/help/voice) covers numbers, working hours, call permissions and results."),
      ],
    },
    {
      id: "first-day-social",
      heading: "Day one in Social",
      blocks: [
        {
          type: "steps",
          items: [
            "Open “Theme” and fill in what your business does, so posts are written in your own words.",
            "Open “Accounts” and connect a network. Switch on “Test mode” if you want to try the flow without posting.",
            "Open “AI Assistant” and ask for a few posts, for example “Plan 3 posts for next week”. Check the outline and press “Write these posts”.",
            "Open “Post approve”, read each post and approve it.",
          ],
        },
        p("Nothing is published until you approve it. The Social guide (/help/social) has the rest."),
      ],
    },
    {
      id: "first-workflow",
      heading: "Your first workflow",
      blocks: [
        p("Open “Workflows” from the home screen. Press “New workflow”, choose an event and pick one of the ready-made examples under it, such as “Plan the call back” under “A call finished”. Press “Try it on a company” to see what it would do, then “Save workflow”. Or ask the AI Assistant for one and press “Turn on”."),
        p("The Workflows guide (/help/workflows) lists every event and step."),
      ],
    },
    {
      id: "where-to-get-help",
      heading: "Getting help",
      blocks: [
        p("Press “Support” on the home screen, or choose “Support” in the profile menu. The panel has “Report issue” and “My tickets”. The Troubleshooting guide (/help/troubleshooting) lists common problems and fixes first. This documentation opens from “Documentation” in the same menu."),
      ],
    },
    {
      id: "glossary",
      heading: "Glossary",
      blocks: [
        {
          type: "table",
          headers: ["Term", "What it means in Outreach"],
          rows: [
            ["Register", "The company register Find leads searches. It holds registered companies, plus sole traders and premises matched from other registers."],
            ["SIC code", "A standard code for what a company does, for example 47110 for retail sale in non-specialised stores. The industry filter can use SIC codes."],
            ["Tier", "Search results in “Best match” order come in three groups: “Full profiles” (website, phone, email and more on file), “Partial profiles” (some contact details) and “Basic records” (registry facts only)."],
            ["Fit", "A score out of 100 for how well a company matches your ideal customer. “Strong fit” is 70 or more, “Some fit” 40 to 69, “Weak fit” below 40. It appears after you set your ideal customer."],
            ["List", "A saved group of companies. You search, save to a list, then email or call from it."],
            ["Stage", "Where a company is with you: new, contacted, interested, meeting, won, lost or do not contact."],
            ["Journey", "A multi-step email sequence that sends from your own mailbox. You can pause it, and nobody loses their place."],
            ["Mailbox", "An email account you connect so Outreach can send and read mail as you."],
            ["Warm-up", "The first weeks of a new mailbox, when it sends a few emails a day and sends more each day so inboxes learn to trust it."],
            ["SPF and DKIM", "Two settings on your domain that prove your emails really come from you. SPF is needed before a mailbox can send. DKIM can be skipped, but more of your emails may go to spam."],
            ["Bounce", "An email that could not be delivered. A mailbox whose bounces go over 2% is paused automatically."],
            ["Do-not-contact", "A block on a person's phone and email. Once a company is added, no app contacts them."],
            ["Credit", "The unit each app spends. Leads, Voice and Social each have their own balance. Plan credits renew monthly and do not carry over. Top-up credits never expire."],
            ["Wallet", "An app's balance of credits. Running out pauses only that app."],
            ["Outcome", "How a call ended, such as meeting booked, callback requested, no answer or do not call."],
            ["Approval", "A yes from a person. Social posts need it before they are published."],
            ["Test mode", "A Social setting that runs the whole flow without sending anything to a network."],
            ["Tracked link", "A short link in a Social post. It counts clicks."],
            ["Mention", "A public post that talks about your brand, products or competitors. Social finds them."],
            ["Workflow", "A saved rule: when an event happens, run steps. It works across the apps."],
            ["Run", "One time a workflow started, with a log of every step."],
          ],
        },
      ],
    },
  ],
};
