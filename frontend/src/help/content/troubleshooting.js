const p = (text) => ({ type: "paragraph", text });

export const troubleshootingDoc = {
  id: "troubleshooting",
  path: "/help/troubleshooting",
  title: "Troubleshooting",
  summary: "Common problems across Leads, Voice, Social and Workflows, the exact message you see, and what to do about it.",
  sections: [
    {
      id: "quick-table",
      heading: "Find your problem fast",
      blocks: [
        p("Match what you see to a row. The sections below say more."),
        {
          type: "table",
          headers: ["What you see", "Likely cause", "Go to"],
          rows: [
            ["“The search didn't finish. Try again.”", "The search took too long or the connection dropped.", "Searches and results"],
            ["“No companies match these filters.”", "Your filters are too narrow.", "Searches and results"],
            ["A screen titled “… Recovery” with “Reload Section”", "That screen hit a display fault, often after an update.", "Recovery screens"],
            ["“Connection problem.” on a mailbox", "The mailbox login is failing.", "Mailbox and email"],
            ["“Sending is paused.”", "You paused it, or bounces went over 2%.", "Mailbox and email"],
            ["No replies in Mail", "The mailbox has not been checked yet, or it has a connection problem.", "Replies not showing"],
            ["“No outbound Caller ID configured.”", "No phone number is set up.", "Calls"],
            ["“This number opted out (do not call).”", "The number is on your do-not-call list.", "Calls"],
            ["“USR-01: Out of … credits.”", "That app's credits are at zero.", "Credits"],
            ["A form answer says “Checking”", "The email domain check has not finished.", "Form answers"],
            ["“Stopped: a step failed” on a workflow run", "One step failed.", "Workflows"],
            ["Post marked “Failed”", "A network refused it or could not be reached.", "Social"],
          ],
        },
      ],
    },
    {
      id: "searches-and-results",
      heading: "Searches and results",
      blocks: [
        {
          type: "table",
          headers: ["Message or symptom", "Why", "What to do"],
          rows: [
            ["“The search didn't finish. Try again.”", "The search did not complete. The list is cleared.", "Press “Find companies” again. If it keeps happening, add a filter such as a town to make the search smaller."],
            ["“Request timed out — backend may be restarting or unreachable. Try again.”", "The server did not answer in time.", "Wait a minute and try again."],
            ["“The server didn't answer. Nothing was saved. Try again in a minute.”", "The service was briefly unavailable.", "Try again in a minute. Nothing was saved, so repeat the action."],
            ["“No companies match these filters. Try a wider town, a broader industry word, or tick ‘Include closed’.”", "No company fits every filter.", "Remove a filter, widen the town, or use a broader industry word."],
            ["“Nothing found inside this area. Our data covers the UK…”", "The drawn shape is outside the UK or too small.", "Draw over a UK town or a few postcodes, or use “Redraw area”."],
            ["“No company in this area matches your filters.”", "The map area is fine but the other filters remove everything.", "Press “Show every company in this area”."],
            ["“The area couldn't be counted. Try again.”", "The count did not finish.", "Press it again, or draw a smaller area."],
            ["“Your session ended. Please sign in again.”", "You were signed out, for example after a long idle time.", "Sign in again. Your admin may have set automatic sign-out limits."],
          ],
        },
        p("A search that is paused shows “Resume”. “Stop and keep what's found” ends a long area search and keeps the pins already found."),
      ],
    },
    {
      id: "recovery-screens",
      heading: "The “Recovery” screen after an update",
      blocks: [
        p("Sometimes a screen shows a white card with a heading such as “Leads Recovery” and the line “encountered a temporary display issue”. This happens when one screen hits a fault while drawing itself, often right after we release an update and your browser still holds old files."),
        {
          type: "steps",
          items: [
            "Press “Reload Section”. This retries just that screen.",
            "If it comes back, refresh the whole page in your browser (hold Ctrl and press R, or Cmd and R on a Mac).",
            "If the whole app shows “Application UI Recovery” with a red message, press “Reload Page”. If that does not help, press “Reset Session & Return to Hub” and sign in again.",
            "If it still fails, copy the message and send it from the Support panel. See the end of this guide.",
          ],
        },
        p("Social has its own card: “Social hit an error”, with a “Try again” button."),
      ],
    },
    {
      id: "mailbox-and-email",
      heading: "Mailbox paused and emails not sending",
      blocks: [
        p("Open the mailbox in Leads. A coloured banner says the one thing you need to know right now."),
        {
          type: "table",
          headers: ["Banner or message", "What it means", "What to do"],
          rows: [
            ["“Connection problem.” The mailbox login is failing, so nothing can send.", "The password or server settings are wrong.", "Check the password in “Settings”, then press “Test connection”. It says “Connection works.” when it is fixed."],
            ["“Permission to send is not set up (SPF).”", "Without SPF most inboxes reject your emails, so the mailbox cannot send.", "Copy the Name and Value shown into your domain's DNS settings. The page checks again every 90 seconds."],
            ["“Email signature is not set up (DKIM).”", "More of your emails may go to spam.", "Add the setting shown, or choose to send without it."],
            ["“Ready to warm up.”", "Settings are in place but warm-up has not started.", "Start warm-up. Do not skip it unless the mailbox already sends daily."],
            ["“Warming up.” Day N of about 21.", "A new mailbox sends a few emails a day and sends more each day.", "Wait. Do not rush it."],
            ["“Sending is paused.”", "It shows why: “Paused by you.” or a bounce message.", "Press the button to start it again once the cause is fixed."],
            ["“Bounces are getting high.”", "More emails are bouncing than usual.", "Clean your list. Remove addresses that bounce."],
            ["“High bounce rate (2.0% or more) over past 7 days.”", "Bounces went over 2% so the mailbox was paused automatically to protect your domain.", "Fix the list first, then restart sending."],
          ],
        },
        p("“Pause sending” stops everything the mailbox sends, both warm-up and journeys, until you start it again. Nobody loses their place in a journey. If a journey's first step does not go out at once, it goes at the next sending window."),
        p("If emails say “skipped” in a workflow, the log shows the reason. A workflow's email step also needs the Leads plan."),
      ],
    },
    {
      id: "replies-not-showing",
      heading: "Replies not showing",
      blocks: [
        {
          type: "steps",
          items: [
            "Open Mail and choose the mailbox. Press the refresh icon, “Check for new mail”. Mail is also checked every minute while the page is open.",
            "If a toast says “Could not check for mail.”, open the mailbox and read its banner. A “Connection problem.” stops both sending and receiving.",
            "If Mail says “No mailbox connected yet”, connect one first.",
          ],
        },
        p("Replies are sorted into “Interested”, “Question”, “Not interested”, “Out of office” or “Unsubscribe”. A workflow that starts on “Someone replied to an email” can use these as the result."),
      ],
    },
    {
      id: "calls",
      heading: "Calls not connecting",
      blocks: [
        {
          type: "table",
          headers: ["Message", "Why", "What to do"],
          rows: [
            ["“No outbound Caller ID configured. Please configure and auto-register your active phone line…”", "You have no active phone number.", "Add a number in “Users & roles”, “Phone numbers”."],
            ["“A valid phone number (at least 7 digits) is required.”", "The number is too short or has letters.", "Correct the number."],
            ["“This number opted out (do not call).”", "The person asked not to be called.", "Do not call them. The number stays blocked."],
            ["“Permission for this call could not be checked, so it was not placed.”", "AI calls need recorded permission. The check could not run.", "Try again. If it repeats, report it with the number."],
            ["“It is 08:10 for this number (Europe/London): …”", "The call is outside the calling hours you set.", "Wait, or change your working hours. In some settings this is a warning and you can call anyway."],
            ["“Only N call minutes left; your calls average M minutes.”", "Not enough Voice minutes for a normal call.", "Top up, or press OK to call anyway. The call ends when minutes run out, with a wrap-up a minute before."],
            ["“Call not placed. Top up Voice credits in Plans & credits for longer calls.”", "You chose Cancel on the warning above.", "Top up, then try again."],
            ["“Outbound dial failed:” and a reason", "The call could not be placed.", "Read the reason after the colon. Try again once. If it repeats, report it."],
          ],
        },
      ],
    },
    {
      id: "credits",
      heading: "Credits not enough",
      blocks: [
        p("When an app runs out, only that app pauses. The message is “USR-01: Out of” the app name “credits. Top up to carry on; nothing more is charged until you do.” The home screen card says “Out of credits: paused until you top up”."),
        {
          type: "steps",
          items: [
            "Open the app and choose “Plan & credits”. If you are not an admin, ask an admin. Social shows “Ask your admin to top up.”",
            "Choose a monthly plan or a one-off top-up.",
            "Come back. After a payment, your credits appear within a minute.",
          ],
        },
        p("In Social, “AI writing paused.” shows how many posts are waiting. Press “Continue where it stopped” after you top up. Nothing was charged for the paused posts. “Choose a plan or buy a top-up to unlock Social.” means the company has no Social plan at all. Workflows show “Workflows need a plan. Choose a plan or buy a top-up to unlock them.”"),
        p("If you paid and nothing changed, wait a minute and reload the page. A failed card shows “Your last payment failed. Update your card in Card & invoices.”"),
      ],
    },
    {
      id: "form-answers",
      heading: "Form submissions pending",
      blocks: [
        p("An answer to a web form first shows the status “Checking”. We check that the email's domain can receive mail. When it can, the answer becomes “Saved as a lead”. The Forms list shows “(N checking)” beside the form."),
        {
          type: "table",
          headers: ["Status", "What it means", "What to do"],
          rows: [
            ["Checking", "The check has not finished.", "Wait a few seconds and reload. Or press “Save as lead” to approve it yourself."],
            ["Saved as a lead", "It is now a company in your leads, in the list you chose.", "Press “Open lead”."],
            ["Blocked", "Blocked, with a reason: “The email's domain cannot receive mail.” or “This person has opted out.”", "Nothing. You can also block a checking answer by hand with “Block”."],
          ],
        },
        p("If a form has no answers, the page says “No answers yet. They appear here a few seconds after someone sends the form.”"),
      ],
    },
    {
      id: "social",
      heading: "Social: posts that do not go out",
      blocks: [
        {
          type: "table",
          headers: ["Symptom", "Why", "What to do"],
          rows: [
            ["A post is “Waiting”", "It needs your approval.", "Open “Post approve” and approve it."],
            ["A post is “Approval missed”", "Its time passed with no approval.", "Move it to a new time and approve it."],
            ["A post is “Failed”", "Read the reason on the post.", "A busy network is retried by itself. For a login problem press “Reconnect” under “Accounts”, then retry."],
            ["An account says “Needs reconnect”", "Its login expired.", "Press “Reconnect”."],
            ["A card says “App not set up”", "Connecting that network is not switched on for you.", "Contact support."],
            ["Nothing reaches the network but the post says “Posted”", "Test mode is on.", "Switch “Test mode” off under “Accounts”."],
            ["“Approval email not sent to” an address", "The email could not be delivered.", "Press “Change” on the approvers line, check the address, then “Send again”."],
            ["“No numbers yet.” on results", "Numbers are read a few hours after the post goes live.", "Check again later."],
          ],
        },
      ],
    },
    {
      id: "workflows",
      heading: "Workflows: a run failed or did not start",
      blocks: [
        {
          type: "table",
          headers: ["Symptom", "Why", "What to do"],
          rows: [
            ["Run status “Stopped: a step failed”", "A step failed. The red cross line shows why.", "Fix the cause, then press “Try again” on the run. It carries on from the failed step."],
            ["“your address answered 500”, “could not reach your address”", "Your own system rejected the call or did not answer.", "Check your system, then press “Try again”."],
            ["“not sent: That address is not allowed.”", "Webhook addresses must be public and start with https://.", "Use a public https address."],
            ["Run status “Skipped”", "It never started. The log says why.", "Read the reason. It may be a filter, the daily limit or a repeat."],
            ["“skipped: this event has no lead behind it”", "The step needs a company but the event has none.", "Use a notification or a webhook for events like “A post went live”."],
            ["“skipped: sending needs the Leads plan”", "The email step needs the Leads plan.", "Choose a Leads plan."],
            ["Nothing happens at all", "The switch is off, or the event did not fire.", "Check the switch is on, then open “Activity”."],
            ["““Name” isn't complete or isn't allowed.”", "The workflow was refused on saving.", "Check that it has an event and at least one step with everything filled in."],
          ],
        },
      ],
    },
    {
      id: "contacting-support",
      heading: "Contacting support",
      blocks: [
        p("Open the Support panel from the “Support” button on the home screen, or from the profile menu. The panel opens in the lower right corner."),
        {
          type: "steps",
          items: [
            "On “Report issue”, check your name and email.",
            "Choose a “Category”: “Bug”, “Question”, “Billing” or “Idea”.",
            "Write a “Subject” of up to 150 characters.",
            "In “Problem details”, say what happened, what you expected and any error message. At least 10 characters are needed.",
            "Attach up to 5 files, each up to 10 MB. Allowed types are PNG, JPG, GIF, WebP, PDF, TXT, CSV, LOG and ZIP. A screenshot of the message helps most.",
            "Press “Submit ticket”. Your tickets are listed under “My tickets”.",
          ],
        },
        {
          type: "callout",
          tone: "tip",
          title: "What to include",
          text: "The exact message, which app and screen you were on, what you pressed, and roughly when it happened. For a call or post, give the company or post name.",
        },
        p("If the panel says “Support tickets are not switched on yet. Nothing was sent.”, the ticket did not go. Tell your admin."),
      ],
    },
  ],
};
