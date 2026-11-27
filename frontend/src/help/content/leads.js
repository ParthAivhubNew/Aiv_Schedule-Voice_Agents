const p = (text) => ({ type: "paragraph", text });

export const leadsDoc = {
  id: "leads",
  path: "/help/leads",
  title: "Leads",
  summary: "Find companies and the people at them, keep them in lists, email them in journeys, and read the replies.",
  sections: [
    {
      id: "what-leads-is-for",
      heading: "What Leads is for",
      blocks: [
        p("Leads helps you find companies that could buy from you, work out how to reach them, and contact them in a planned way. You search a register of UK companies, save the ones you want into lists, set up a journey of emails, calls and tasks, and read what comes back."),
        p("Searching the register is free. Credits are only used when you ask us to look for a contact detail we do not hold, or when you send email. The credits section below lists each case."),
        p("The Leads app sits in the left menu in three groups: Outreach, Inbound and Setup. Each page has its own guide. This page tells you what each one is for and how they fit together."),
      ],
    },
    {
      id: "left-menu",
      heading: "The screens in the left menu",
      blocks: [
        {
          type: "table",
          headers: ["Menu item", "Group", "What it is for"],
          rows: [
            ["AI Assistant", "Outreach", "Ask in plain words. It reads your companies, journeys and mailboxes. It does nothing that costs credits until you confirm."],
            ["Find Leads", "Outreach", "Every company on the register, best profiles first. Filter them, or ask the AI Assistant. Import your own spreadsheet from here."],
            ["Lists", "Outreach", "Everything you save or import lands in a list. Get contact details, fix what is wrong, then start a journey. It has three tabs: Lists, Companies and People."],
            ["Journeys", "Outreach", "A path through emails, calls and tasks for each person. Set it up once. It stops when they reply, book or opt out."],
            ["Mail", "Outreach", "Everything your journeys sent and got back. It has two pages: “Inbox and sent” for replies, sent emails and the do-not-email list, and “Email accounts” for connecting the accounts you send from, warming them up and checking their health."],
            ["Forms", "Inbound", "Build a web form, share its link, and every answer with a working email becomes a lead in the list you choose."],
            ["Workflows", "Setup", "When something happens in Leads, Voice or Social, do something automatically."],
            ["Company profile", "Setup", "What the AI may say about you when it writes emails, and who your ideal customer is. This is your company profile, shared with your other Outreach tools."],
          ],
        },
        p("“Plan & credits” shows your Leads plan and credits. You can change plan, top up or cancel there. If your account is locked, the other pages ask you to choose a plan or top up first."),
        p("The header on each page also has “Import”, to bring in your own spreadsheet of companies, and a way to add one company by hand."),
      ],
    },
    {
      id: "a-typical-day",
      heading: "How a typical day goes",
      blocks: [
        {
          type: "steps",
          items: [
            "Open “Find Leads”. Describe what you want in a sentence, or set the filters. For example, accountants in Leeds. Press “Find companies”.",
            "Look at the results. Hide any you do not want. Select the rest, and press “Add to list” to put them in a list with a name you will recognise.",
            "Open “Lists”. Open the list. See which companies are in “Ready”, which are in “Needs contact”, and which are in “Reach another way”.",
            "Use “Reveal” for details we already hold, which is free. Use “Get contacts” for companies still missing an email. The box shows the most it can cost before you start.",
            "Press “Start journey” on the list. Choose the steps, write or generate the emails, and start it.",
            "Open “Mail” to read replies. Answer the ones that need you. Journeys stop for anyone who replies, books or opts out.",
            "Come back to “Lists” to see how many are called, contacted or interested.",
          ],
        },
        p("You do not have to do this in order. You can import a file instead of searching, and you can ask the AI Assistant to do the searching and drafting for you. It shows you a draft and asks before anything costs credits."),
        p("Saved searches make this easier. Save a search as a list and let it update weekly. New companies that match arrive in the list by themselves, and your admins are told what was added."),
      ],
    },
    {
      id: "how-it-fits-together",
      heading: "How the pieces fit together",
      blocks: [
        p("Find Leads is the register. Lists is your own saved collection. A company can be in many lists, and deleting a list never deletes the companies in it. Journeys run on a list. Mail shows what the journeys sent and received. Forms feed new leads into lists. About your business sets the ideal customer used for the fit score and tells the AI how to describe you."),
        {
          type: "table",
          headers: ["If you want to", "Go to"],
          rows: [
            ["Find new companies", "Find Leads"],
            ["Keep, check and improve companies", "Lists"],
            ["Contact a list by email, calls and tasks", "Journeys"],
            ["Read replies and manage senders", "Mail"],
            ["Let visitors to your website become leads", "Forms"],
            ["Tell us who you sell to", "Company profile"],
            ["Get answers or drafts in plain words", "AI Assistant"],
          ],
        },
      ],
    },
    {
      id: "credits",
      heading: "Where credits are used, and where they are not",
      blocks: [
        p("These actions are free. They never use credits."),
        {
          type: "table",
          headers: ["Free", "Notes"],
          rows: [
            ["Searching the register in Find Leads", "Companies and People, any filters, any number of searches."],
            ["Saving a company to a list", "Including a saved search and its weekly runs."],
            ["Reveal", "Opens the website, phone and email our register already holds."],
            ["Reading the register for the people at a company", "Directors and others the register names."],
            ["Drawing an area on the map and counting what is in it", "Pins are placed by the registered postcode."],
            ["The first steps of Get contacts", "Our own records, format checks and the company register."],
          ],
        },
        p("These actions use credits, and only when something is found or sent."),
        {
          type: "table",
          headers: ["Action", "When you are charged"],
          rows: [
            ["Find website, Find phone, Find email on a company", "Only if the web search or the deep web search finds it. A miss is not charged."],
            ["Find email for a named person", "Only if one is found."],
            ["Social page (LinkedIn, Facebook, X, Instagram)", "Only when a page is found. It costs less than a website, phone or email."],
            ["Get contacts", "You see the most it can cost first. You pay only for what is found. Unused credits are given back."],
            ["Check phone numbers", "A small charge per group of 5 numbers that get a real answer. Numbers checked in the last 30 days are free."],
            ["Sending an email in a journey", "Each email sent uses a credit."],
            ["Personalised email lines", "A credit for each group of 5 lines written."],
          ],
        },
        p("At the standard rates, a website, phone or email found on the web costs 5 credits, a social page costs 2, and each email sent costs 1. The button or box always shows the price you will actually pay, and “Plan & credits” shows your price list. The same lookup for the same company is not charged twice within 90 days."),
        {
          type: "callout",
          tone: "note",
          title: "Nothing surprises you",
          text: "Anything that can cost credits shows its price first, on the button as “N credits if found” or in a box that opens before it starts. The AI Assistant also asks you to confirm before it does anything that costs credits.",
        },
      ],
    },
    {
      id: "where-to-next",
      heading: "Where to read next",
      blocks: [
        p("Start with the Find leads guide to learn every filter and how contact lookups are charged. Then read the Lists guide for readiness, deleting and calling. Journeys, Mail, Forms, the AI Assistant and About your business each have a guide of their own in the Leads section."),
        p("If your results look wrong, the Find leads guide has a “Common problems” section. If a list will not do what you expect, the Lists guide has one too."),
      ],
    },
  ],
};
