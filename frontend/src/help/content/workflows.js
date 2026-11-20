const p = (text) => ({ type: "paragraph", text });

export const workflowsDoc = {
  id: "workflows",
  path: "/help/workflows",
  title: "Workflows",
  summary: "Do things automatically across Leads, Voice and Social: when a call ends, someone replies or a post goes live, run the steps you choose.",
  sections: [
    {
      id: "what-a-workflow-is",
      heading: "What a workflow is",
      blocks: [
        p("A workflow says: when this happens, do that. It has one trigger (an event), optional filters on which companies it applies to, and a list of steps. The steps can change a stage, add a note, plan a follow-up, send an email, notify you, call your own web address, wait, or branch on a condition."),
        p("Workflows belong to the whole company, not to one app. This is the cross-app part: a call that ends in Voice can move a company to a new stage in Leads, and a post going live in Social can send you a notification. One page holds them all."),
        {
          type: "callout",
          tone: "note",
          title: "Nothing runs until you save and switch it on",
          text: "A workflow does nothing until it is saved and its switch is on. A workflow written by the AI Assistant appears as a card and runs only after you press “Turn on”.",
        },
        p("Workflows need a plan for at least one app (Leads, Voice or Social) or a credit balance. Without one the page shows “Workflows need a plan. Choose a plan or buy a top-up to unlock them.” Workflows themselves do not use credits. Only people who can edit company settings can create, change or delete one. Others can look."),
      ],
    },
    {
      id: "the-page",
      heading: "The Workflows page",
      blocks: [
        p("Open it from the “Workflows” card on the home screen, or from “Workflows” in the left menu of Leads, Voice or Social. The page has two tabs."),
        {
          type: "table",
          headers: ["Tab", "What it shows"],
          rows: [
            ["Workflows", "One card per workflow, written as a short line: the trigger, any “Only if” filters, then each step. The count shows beside the tab name."],
            ["Activity", "Every run, newest first, with what each step did. Filter by workflow or by status. It refreshes every 10 seconds."],
          ],
        },
        p("Each workflow card has a switch to turn it on or off, an “Edit” button and a bin icon to delete it. Under the steps it says how often the workflow ran and when it last ran, how many runs are waiting, failed or skipped, and a “See activity” link to its runs. Deleting asks first: “Delete and stop 2 waiting?” if runs are waiting."),
        p("“Show workflows from” filters the list by app: Voice, Leads or Social. You can have up to 30 workflows. Past that, saving says “You can have up to 30 workflows. Delete one first.”"),
      ],
    },
    {
      id: "creating-one",
      heading: "Creating a workflow",
      blocks: [
        {
          type: "steps",
          items: [
            "Press “New workflow” (or “Create a workflow” on an empty page).",
            "On “What should start it?” pick the event, grouped under Voice, Leads and Social. Under each event are ready-made examples you can start from.",
            "In the editor, check “When this happens”. For some events you can narrow it with “Only when the result is”, for example a call outcome.",
            "Optionally press “Only for some companies” to add filters. Each filter is an “Only if” line, and more are “and”. You can add up to six.",
            "Add steps under it: “Action”, “If / else”, “Wait” or “Stop”. Reorder them with the arrows.",
            "Give it a name in “Name”. If you leave it blank, the event's name is used.",
            "Under “How often it can run”, choose how it repeats (see below).",
            "Press “Try it on a company” to see what it would do, then “Save workflow”.",
          ],
        },
        p("“Try it on a company” uses your most recently saved company. It lists what each step would do, one line each, and says “nothing was changed or sent”. If you have no saved company, it says “Save a company first, then try the workflow on it.”"),
        p("Texts in steps can use {{first_name}} and {{company}}, which are filled in for each company."),
      ],
    },
    {
      id: "events",
      heading: "The events you can start from",
      blocks: [
        {
          type: "table",
          headers: ["Event on screen", "App", "When it fires", "Company behind it", "“Only when the result is” choices"],
          rows: [
            ["A call finished", "Voice", "When a call ends", "Yes", "meeting booked, callback requested, contacted, left voicemail, no answer, rejected, wrong number, do not call"],
            ["A call needs a person", "Voice", "When the AI asks for a person", "Yes", "none"],
            ["A meeting was booked", "Voice", "When a meeting is booked", "Yes", "none"],
            ["Someone replied to an email", "Leads", "When someone replies", "Yes", "interested, question, not interested, unsubscribe"],
            ["Someone opened an email", "Leads", "When an email is opened", "Yes", "none"],
            ["A company was saved", "Leads", "When a company is saved", "Yes", "none"],
            ["An email campaign finished sending", "Leads", "When a campaign finishes", "No", "none"],
            ["A post went live", "Social", "When a post goes live", "No", "none"],
          ],
        },
        p("When no company is behind an event (“An email campaign finished sending” and “A post went live”), the editor says: “No company is behind this event, so only steps that do not need one will run (a notification or a web address).” Filters on the company cannot be added to these."),
        p("If an event comes from a call to a number that matches no company in your lists, the run is recorded as “Skipped” with the reason “no company in your list matches this event”."),
      ],
    },
    {
      id: "actions",
      heading: "The steps you can use",
      blocks: [
        {
          type: "table",
          headers: ["Action on screen", "What it does", "Needs a company"],
          rows: [
            ["Move the lead to a stage", "Sets the stage to one of: new, contacted, interested, meeting, won, lost, do not contact.", "Yes"],
            ["Add the lead to a list", "Adds the company to the list you name. The list is made if it is new.", "Yes"],
            ["Plan a follow-up for the lead", "Sets the company's next action to your text, due in the number of days you give (0 to 365).", "Yes"],
            ["Send me a notification", "Adds a notification for you. Text only.", "No"],
            ["Send the lead an email", "Sends an email with your subject and message from your own mailbox. Needs the Leads plan.", "Yes"],
            ["Send the details to my own web address (webhook)", "Posts the details to an address you give. See the safety rules below.", "No"],
            ["Add the lead to the do-not-contact list", "Blocks the company's phone and email and sets the stage to do not contact. It then stops every app from contacting them.", "Yes"],
            ["Add a note to the lead's timeline", "Adds your text as a note.", "Yes"],
          ],
        },
        p("Other blocks are not actions."),
        {
          type: "table",
          headers: ["Block", "What it does"],
          rows: [
            ["Wait", "Parks the run for a number of hours or days, from 1 hour up to 30 days. The run carries on afterwards."],
            ["If / else", "Checks a condition. Steps under “If yes” run when it holds, steps under “If no” run when it does not. An empty “If no” does nothing. An if can sit inside another if once, but no deeper."],
            ["Stop", "Ends the run here for this company. Steps after a Stop never run."],
          ],
        },
        p("A workflow can have up to 25 blocks in total. A step that needs a company is skipped, with the line “skipped: this event has no lead behind it”, when the event has none."),
      ],
    },
    {
      id: "conditions",
      heading: "Conditions: “Only if” and “If”",
      blocks: [
        p("The same conditions are used in the top filters (“Only if”) and in an “If / else” block. If a top filter does not match, the run is recorded as “Skipped” with the reason, for example “it did not match: Stage is new”."),
        {
          type: "table",
          headers: ["Filter on", "Comparisons", "Value"],
          rows: [
            ["Stage", "is, is not", "new, contacted, interested, meeting, won, lost, do not contact"],
            ["Industry", "contains, does not contain", "Text to look for"],
            ["Town or area", "contains, does not contain", "Text to look for"],
            ["Has an email address", "is", "yes or no"],
            ["Has a phone number", "is", "yes or no"],
            ["Is in the list", "is, is not", "The list name"],
          ],
        },
      ],
    },
    {
      id: "how-often",
      heading: "How often it can run",
      blocks: [
        {
          type: "table",
          headers: ["Option", "What it does"],
          rows: [
            ["Every time it happens", "Runs for the same company each time the event fires."],
            ["Only once per company", "A company goes through it once, ever."],
            ["At most once every few days", "A company goes through it again only after the number of days you set (1 to 365)."],
          ],
        },
        p("Next to it, “Up to … runs a day” caps the whole workflow, from 1 to 1,000. The default is 100. When the cap is reached, further runs are recorded as “Skipped” with the line “today's limit of 100 runs was reached”."),
        {
          type: "callout",
          tone: "warning",
          title: "Email loops are stopped for you",
          text: "A workflow that starts on “Someone opened an email” and sends an email would trigger itself. If you leave it on “Every time it happens”, it is saved as “Only once per company”.",
        },
        p("The same event arriving twice is recognised as a repeat and recorded once."),
      ],
    },
    {
      id: "turning-on-and-off",
      heading: "Turning a workflow on and off",
      blocks: [
        p("Use the switch at the left of the card. “Off” shows beside the name of a workflow that is off, and its steps are dimmed. A toast confirms, for example “Weekly follow-up is on.”"),
        p("A run that is waiting when its workflow is turned off or deleted does not carry on. When its wait ends it is marked “Stopped”, and its log gets the line “The workflow was turned off or deleted.” A run is also stopped, with “The company was deleted.”, if its company is removed."),
      ],
    },
    {
      id: "run-activity",
      heading: "Run activity and statuses",
      blocks: [
        p("Each run is saved with one line per step, so you can see what happened and why something did not run. Open a run with the arrow. A red cross marks a failed step, a square marks a skipped run, and a green tick marks a step that worked. Runs are kept for 45 days."),
        {
          type: "table",
          headers: ["Status on screen", "What it means"],
          rows: [
            ["Running", "The steps are being carried out now."],
            ["Waiting", "A “Wait” step is holding it. The run shows “carries on” and the date and time. Times in the log are UTC."],
            ["Done", "Every step finished."],
            ["Stopped: a step failed", "A step failed and the run stopped at that step. Nothing after it ran."],
            ["Stopped", "It was stopped: by you (“You stopped it.”), by a Stop block, or because the workflow was turned off or deleted."],
            ["Skipped", "It never started. The reason is in the log: the filter did not match, the daily limit was reached, the company already went through it, or no company matched the event."],
          ],
        },
        p("Reasons for a skipped run: “it did not match” followed by the filter, “today's limit of N runs was reached”, “this lead already went through it”, “this lead went through it in the last N days”, and “no company in your list matches this event”."),
      ],
    },
    {
      id: "failures-and-retries",
      heading: "Failures and retries",
      blocks: [
        p("A step that fails stops that run where it is. The failed step's line shows the reason, for example “your address answered 500” or “could not reach your address”. Fix the cause, then press “Try again” on the run. It continues from the step that failed, not from the start."),
        p("“Stop” on a waiting or failed run ends it for good. “Try again” and “Stop” need permission to edit company settings. Only a run that failed can be retried. If someone else is already retrying it, the page says “That run is already being retried.”"),
        p("If a run cannot continue for a reason outside its steps, the system tries again by itself. After five tries it is marked failed with “Use Retry once the problem is fixed.”"),
        {
          type: "table",
          headers: ["Message in the run", "What to do"],
          rows: [
            ["skipped: sending needs the Leads plan", "The company has no Leads plan, so the email step cannot send. Choose a plan under Leads."],
            ["email skipped: and a reason", "The email was not sent. Read the reason. Common causes are a missing email address or a mailbox that is paused."],
            ["not sent: and a reason", "The web address was refused by the safety rules below."],
            ["your address answered 4xx or 5xx", "Your own system rejected the call. Check it, then press “Try again”."],
            ["could not reach your address", "Your address did not answer within 8 seconds. Check it, then press “Try again”."],
          ],
        },
      ],
    },
    {
      id: "webhook-safety",
      heading: "Webhook safety rules",
      blocks: [
        p("The webhook step posts a small message to your own web address. Use it to send details to your CRM or another system. The message holds the workflow name, the event, the time, and the company's name, email, phone, stage, industry and region."),
        {
          type: "table",
          headers: ["Rule", "What it means"],
          rows: [
            ["https only", "The address must start with https://. The editor says “the web address must start with https://.” A plain http address is refused."],
            ["No local or private addresses", "Addresses such as localhost, or ones that point inside a private network, are refused. The message is “That address is not allowed.” or “That address points inside a private network, which is not allowed.”"],
            ["Public address", "A saved workflow with a bad address is rejected with “a web address must be a public https address”."],
            ["Short wait", "The call waits 8 seconds for your address to answer."],
            ["No redirects", "If your address redirects, the redirect is not followed."],
            ["A 2xx answer means success", "Any other answer marks the step as failed."],
            ["Hidden path", "People without permission to edit see only the host of the address, not its path or secret."],
          ],
        },
        {
          type: "callout",
          tone: "note",
          title: "Who can see the address",
          text: "Only people who can edit company settings see the whole address. Everyone else sees the host only, because the path often holds a token.",
        },
      ],
    },
    {
      id: "examples",
      heading: "Ready-made examples",
      blocks: [
        p("These examples appear under their event on the “What should start it?” screen. Pressing one opens it in the editor, where you can change anything before saving."),
        {
          type: "table",
          headers: ["Example", "Starts on", "What it does"],
          rows: [
            ["Move to Meeting and plan the prep", "A meeting was booked", "Moves the lead to Meeting, plans a follow-up “Prepare for the meeting with the company” for the next day, and sends you a notification."],
            ["Send it to my own system", "A meeting was booked", "Posts the lead's details to a web address you give, such as your CRM or an automation hook. You fill in the address."],
            ["Tell me and plan a follow-up", "Someone replied to an email, result interested", "Moves the lead to interested, notifies you, and plans a reply for the next day."],
            ["Never contact them again", "Someone replied to an email, result unsubscribe", "Adds the person to the do-not-contact list with the reason “Unsubscribed”."],
            ["Plan the call back", "A call finished, result callback requested", "Plans “Call the company back” for the next day and notifies you."],
            ["Try again in two days", "A call finished, result no answer", "Plans another try in two days."],
            ["Stop contacting them", "A call finished, result do not call", "Adds the lead to the do-not-contact list with the reason “Asked not to be called”."],
          ],
        },
      ],
    },
    {
      id: "from-the-ai-chat",
      heading: "Creating one from the AI chat",
      blocks: [
        p("In the AI Assistant of Leads, Voice or Social you can ask for a workflow in plain words, for example “When a call ends with a callback request, plan a follow-up for tomorrow.” The assistant writes it and shows a card in the chat with the name and a one-line summary."),
        {
          type: "steps",
          items: [
            "Read the card. It shows what starts the workflow and each step.",
            "Press “Turn on” to save it and switch it on. Press “Not now” to drop it. Nothing runs until you press “Turn on”.",
            "After it is on, the card says “It is on. It runs the next time that happens.” Press “See it in Workflows” to open it.",
          ],
        },
        p("If the assistant's workflow is not complete, the card says “That workflow is not complete.” Ask it to fix the event, the result or a missing step, or build it by hand in the editor."),
      ],
    },
  ],
};
