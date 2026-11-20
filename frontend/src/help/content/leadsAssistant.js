export const leadsAssistantDoc = {
  id: "leads-assistant",
  path: "/help/leads/assistant",
  title: "AI Assistant",
  summary: "Ask in plain words to find companies, check your lists, journeys and mailboxes, and plan a job. It only proposes. You press the button.",
  sections: [
    {
      id: "opening-the-assistant",
      heading: "Opening the assistant",
      blocks: [
        {
          type: "paragraph",
          text: "There are two ways to use it. The \"AI Assistant\" button at the top of every Leads screen opens it as a panel beside the page. You can keep working on the page while it answers. Or choose \"AI Assistant\" at the top of the left menu, under Outreach, to use it as a full page.",
        },
        {
          type: "paragraph",
          text: "In the panel, \"Open full screen\" moves the chat to the full page. Going from the full page to another screen docks the chat back in the panel, with the answer still coming in. It is the same conversation in both places. \"Close\" hides the panel. The \"Start a new chat\" button starts a fresh conversation.",
        },
        {
          type: "paragraph",
          text: "The assistant is available on each of the Voice and Social apps too. Each has its own chats and its own memory, and a chat in one app never appears in another. This guide covers the Leads assistant.",
        },
      ],
    },
    {
      id: "what-it-can-do",
      heading: "What it can do",
      blocks: [
        {
          type: "table",
          headers: ["You ask for", "What it does"],
          rows: [
            ["Find or count companies", "Searches the UK company register with the filters you describe, such as \"software companies in Leeds\". Searching is free. It can also count a market, for example how many companies could buy from you and how many have a website, email or phone."],
            ["Find lookalikes", "Reads the sectors and towns of your best saved companies, then searches for more like them."],
            ["Explain one company", "Reads everything you hold about a saved company: contact, stage, last call, next follow-up and notes. If you have not saved it, it looks it up on the register."],
            ["Read your own account", "Your pipeline by stage, your journeys and how they are doing, open journey tasks, how replies were sorted, mailbox health, and follow-ups due in the next 7 days."],
            ["Show credits", "Tells you how many credits you have."],
            ["Write a draft journey", "Writes a draft journey of emails, calls and tasks from your About your business details. Nothing is sent."],
            ["Change a journey", "Edits the steps or settings of a draft. See below for journeys that are running."],
            ["Plan a bigger job", "Talks through a job with several steps, then proposes a plan. See \"Plans\" below."],
          ],
        },
        {
          type: "paragraph",
          text: "On the full page, the start screen has presets in groups: \"Prospecting\", \"Research\", \"Sequencing\", \"Analytics\" and \"Deliverability\". Each preset is a ready question, such as \"How are my journeys doing?\" or \"Check my mailbox health\".",
        },
        {
          type: "paragraph",
          text: "The assistant uses only what it can read in your account and the register. It does not name a company, number, email or phone that it did not find, and it says so when something is not known. If your request is missing something it needs, it asks one short question.",
        },
      ],
    },
    {
      id: "it-only-proposes",
      heading: "What it only proposes",
      blocks: [
        {
          type: "paragraph",
          text: "The assistant never spends credits, sends email or starts a journey on its own. When an action needs your say-so, it shows a card with the facts and a button. Nothing happens until you press the button. The panel says it at the bottom: saving, checking and sending only happen when you press the button on a card.",
        },
        {
          type: "table",
          headers: ["It does at once", "It offers on a card"],
          rows: [
            ["Searches the register", "Saving the companies it found to a list"],
            ["Reads your pipeline, journeys, replies and mailboxes", "Checking a saved list, which costs credits and shows the price first"],
            ["Writes a draft journey and edits a draft", "Adding a list of people to a journey"],
            ["Shows your credits", "Starting, pausing or stopping a journey, or changing one that is running"],
            ["", "Marking journey tasks done or skipped"],
            ["", "Searching the web for more companies, which costs credits"],
            ["", "Starting an email campaign to a list"],
          ],
        },
        {
          type: "paragraph",
          text: "The assistant can never start a journey itself. It will not say it has. When you want to start one, it takes you to the journey, where you press \"Start\".",
        },
        {
          type: "paragraph",
          text: "Some questions need another app. For example, a Leads chat may need call results from Voice. It then shows a card, \"This needs Voice\", and asks that app's assistant only when you press the button. The answer comes back into your chat.",
        },
      ],
    },
    {
      id: "plans",
      heading: "Plans for bigger jobs",
      blocks: [
        {
          type: "paragraph",
          text: "For a job with several steps, the assistant first talks it through with you. When you agree, it shows a plan with the steps in order. Nothing runs until you press \"Run\". A plan can have up to 12 steps and can use more than one app.",
        },
        {
          type: "paragraph",
          text: "Steps that only read, and steps that save companies to a list, run on their own. A step that costs credits, sends or places something waits for you. You do it on its own screen and then say you are done. A plan is saved, so it carries on when you close the panel or change page. You can pause it, resume it or cancel it. If the server restarts during a run, the run is marked as interrupted and you can resume it. Nothing is silently lost.",
        },
        {
          type: "paragraph",
          text: "Ask for changes in the chat and the assistant replaces the plan with a revised one.",
        },
      ],
    },
    {
      id: "web-search",
      heading: "Web search and its cost",
      blocks: [
        {
          type: "paragraph",
          text: "The register holds UK companies. For a business that is not on it, such as a new or non-UK business, switch on \"Web search\" under the message box. The label shows \"On\" or \"Off\", and your choice is remembered in your browser.",
        },
        {
          type: "paragraph",
          text: "With it on, the assistant may offer to search public web pages and directories. It offers the search only when the register found nothing or too few, or when you ask for businesses that are not in the register. The search is not run by itself. A card shows the search and its price, and it runs when you press the button. The cost is credits per company found, with a maximum for the number you asked for, and nothing if none are found. If a search fails, the card says nothing was charged.",
        },
        {
          type: "paragraph",
          text: "Companies found this way carry a \"web\" tag, because they come from public web pages and not from the register. Press \"Save\" on one to put it in your \"Unsorted\" list.",
        },
      ],
    },
    {
      id: "memory-and-history",
      heading: "Memory, saving and history",
      blocks: [
        {
          type: "paragraph",
          text: "Type \"/remember\" followed by a preference, for example \"/remember I only sell to companies with a website\". The assistant saves it and follows it in every chat. Each saved line can be up to 300 characters. \"/memory\" or \"What I know\" in the menu shows what it remembers, and the bin icon, labelled \"Forget this\", removes a line. You can also add lines in the \"Something to remember\" box.",
        },
        {
          type: "paragraph",
          text: "\"What I know\" also links to About your business. Every answer, search and email follows that profile. If it is thin, a \"Customize your AI\" line suggests what to tell it. You can dismiss it.",
        },
        {
          type: "paragraph",
          text: "Your chats are saved and grouped by date down the left of the full page. In the panel, use the clock icon, \"Earlier chats\". Open one to carry on, or delete it with its bin icon. The start screen offers \"Continue\" to pick up your latest chat. A saved chat keeps your filters and the cards you pressed.",
        },
        {
          type: "paragraph",
          text: "Under an answer there are thumbs and a copy button. If an answer was wrong, choose a reason: \"Wrong companies\", \"Wrong information\", \"Missed what I asked\", \"Too long or slow\" or \"Something else\". You may be offered a short lesson to keep in memory.",
        },
      ],
    },
    {
      id: "slash-commands",
      heading: "Slash commands",
      blocks: [
        {
          type: "paragraph",
          text: "Type \"/\" in the message box to see the commands. Use the arrow keys with Tab or Enter, or click one.",
        },
        {
          type: "table",
          headers: ["Command", "What it does"],
          rows: [
            ["/find-leads", "Puts \"Find \" in the box for you to finish."],
            ["/find-lookalikes", "Finds companies like the ones in your lists, in the same sector and area."],
            ["/what-can-i-do", "Asks what the assistant can help with."],
            ["/remember", "Saves a preference for every chat."],
            ["/memory", "Shows and removes what it remembers."],
            ["/import", "Opens the import for your own spreadsheet of companies."],
          ],
        },
      ],
    },
    {
      id: "which-screen",
      heading: "How it knows which screen you are on",
      blocks: [
        {
          type: "paragraph",
          text: "When you use the panel beside a page, it sends the name of the screen you are on, such as \"Journeys\" or \"Inbox and sent\". That lets \"this\" and \"here\" mean what you expect. For example, on Journeys you can press \"Ask AI\" and ask it to improve the journey you are looking at. The screen name is used only to understand your words. It is never treated as an instruction.",
        },
        {
          type: "paragraph",
          text: "The full page has no other screen behind it, so it sends no screen name. Say what you mean in words, such as the name of the journey.",
        },
      ],
    },
    {
      id: "limits",
      heading: "Limits to know about",
      blocks: [
        {
          type: "table",
          headers: ["Limit", "Detail"],
          rows: [
            ["Message length", "Up to 2,000 characters a message."],
            ["Speed", "A lot of messages in one minute, more than 60, are held back for a few seconds. Normal use never gets near it."],
            ["Daily messages", "There is no daily cap on messages."],
            ["Tool rounds", "For one question the assistant reads and decides up to four times. Ask a follow-up if it needs more."],
            ["Search results", "A search lists up to 200 companies at a time."],
            ["Memory line", "300 characters each."],
          ],
        },
        {
          type: "callout",
          tone: "tip",
          title: "Get better answers",
          text: "Fill in About your business, add a few /remember lines, and name the trade and the place in a search. The assistant matches the trade you name and tells you when it had to widen the search.",
        },
        {
          type: "callout",
          tone: "note",
          title: "Stopping an answer",
          text: "While it is working, the send button turns into \"Stop\". If an answer stops part way, try again.",
        },
      ],
    },
  ],
};
