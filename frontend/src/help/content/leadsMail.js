export const leadsMailDoc = {
  id: "leads-mail",
  path: "/help/leads/mail",
  title: "Mail",
  summary: "Connect the email accounts your journeys send from, warm them up safely, keep them healthy, and read replies in one inbox.",
  sections: [
    {
      id: "two-pages",
      heading: "What Mail covers",
      blocks: [
        {
          type: "paragraph",
          text: "Mail has two pages in the left menu, under Outreach. \"Email accounts\" is where you connect the mailboxes you send from, warm them up and check their health. \"Inbox and sent\" is where you read replies, see what your journeys sent and manage the do-not-email list.",
        },
        {
          type: "paragraph",
          text: "A journey can send only from a mailbox that is connected, has its domain checks in place and has started warm-up. The sections below follow that order.",
        },
      ],
    },
    {
      id: "connecting-an-account",
      heading: "Connecting an email account",
      blocks: [
        {
          type: "paragraph",
          text: "Open \"Email accounts\" and press \"Connect mailbox\". Fill in these fields:",
        },
        {
          type: "table",
          headers: ["Field", "What to enter"],
          rows: [
            ["Email address", "The address you send from, such as sam@yourcompany.com."],
            ["Name people see", "The name shown in the From line."],
            ["Email provider", "Choose \"one.com\", \"Google Workspace / Gmail\", \"Microsoft 365 / Outlook\", \"Zoho Mail\" or \"Other (enter servers)\". For a named provider the server settings are filled in for you."],
            ["Password", "Your mailbox password. For Gmail and Outlook it must be an app password, with IMAP turned on and 2-step verification on. Your normal password will not work."],
            ["Daily target (emails)", "The most emails this mailbox will send in a day once it has warmed up. The range is 5 to 100 and the default is 40. A low target is safer."],
            ["Signature", "Added under every email this mailbox sends."],
          ],
        },
        {
          type: "paragraph",
          text: "For \"Other (enter servers)\" you also enter the SMTP server and port, the IMAP server and port, and a username if it is not the email address.",
        },
        {
          type: "paragraph",
          text: "Press \"Test and connect\". We log in to the mailbox to prove the details work, then save it. A mailbox that is already connected cannot be added twice.",
        },
        {
          type: "callout",
          tone: "note",
          title: "What is stored",
          text: "We store the mailbox address, the server settings and the password. The password is kept encrypted and is never shown again. When you open \"Settings\" on a mailbox, the password field shows dots. Leave them alone to keep the saved password, or type a new one. Disconnecting a mailbox stops journeys using it. Nothing is deleted from your email account.",
        },
        {
          type: "paragraph",
          text: "If a login starts failing, the mailbox shows \"Needs attention\" and \"Connection problem\". Update the password under \"Settings\", then press \"Test connection\".",
        },
      ],
    },
    {
      id: "dns-checks",
      heading: "Domain checks before you can send",
      blocks: [
        {
          type: "paragraph",
          text: "Inboxes such as Gmail and Outlook trust mail more when your domain proves it is really you. Each mailbox shows four checks.",
        },
        {
          type: "table",
          headers: ["Check", "What it is", "Needed to send?"],
          rows: [
            ["SPF", "A DNS record that lists which servers may send mail for your domain.", "Yes"],
            ["DKIM", "A signature that proves the email was not changed on the way.", "Yes, unless you choose \"Send without DKIM\""],
            ["DMARC", "Tells receiving servers what to do with mail that fails SPF or DKIM.", "No, recommended"],
            ["MX", "Shows the domain can receive mail, so replies reach you.", "Shown as a check"],
          ],
        },
        {
          type: "paragraph",
          text: "Under \"Settings to add for\" your domain, each missing record is shown with its type, name and value, and a copy button. Add them where you manage your domain, usually the company where you bought it, in its DNS settings. Then press \"Check my settings\". The page also rechecks by itself about every 90 seconds while a record is missing. \"Re-check DNS\" runs the check on demand.",
        },
        {
          type: "paragraph",
          text: "\"Send without DKIM\" is available if you cannot add the record. Expect more of your emails to reach spam, and your domain's reputation, including for your normal email, can suffer. Bounces over 2% still pause the mailbox, and warm-up limits still apply. \"Require DKIM\" turns the safeguard back on.",
        },
      ],
    },
    {
      id: "warm-up",
      heading: "Warm-up in plain words",
      blocks: [
        {
          type: "paragraph",
          text: "A brand-new mailbox that suddenly sends lots of email looks like spam to inboxes. Warm-up fixes that. For about four weeks the mailbox sends a few emails a day and slowly sends more. Some of those emails are warm-up messages exchanged with other mailboxes, and some are your real journey emails. Replies to warm-up mail teach inboxes that your mail is wanted.",
        },
        {
          type: "paragraph",
          text: "Press \"Start warm-up\" once SPF and DKIM are in place. The mailbox changes from \"Warm-up not started\" to \"Warming up\". Here is what happens, by day of healthy sending:",
        },
        {
          type: "table",
          headers: ["Stage", "What the mailbox does"],
          rows: [
            ["Day 1", "A daily allowance of 5 emails."],
            ["Days 1 to 7", "Real journey emails are allowed from day one, about a third of each day's allowance and at least 2. The rest is warm-up mail."],
            ["Days 8 to 14", "About 60% of the allowance is warm-up mail."],
            ["Day 15 onward", "About 30% is warm-up mail."],
            ["Up to day 28", "The allowance rises, by about 20% a day at most, until it reaches your daily target."],
            ["Graduation", "After 21 healthy days, once the allowance has reached your daily target, the mailbox graduates. The status shows \"Sending\"."],
          ],
        },
        {
          type: "paragraph",
          text: "After graduation, routine warm-up stops. The whole daily allowance is for your real outreach. Your journeys keep the reputation up from then on. While a mailbox is warming, it shows \"Day N of about 21\".",
        },
        {
          type: "paragraph",
          text: "Warm-up messages are plain, harmless notes. Each one ends with a visible line saying it is an automated warm-up message between Aivhub mailboxes and that no reply or action is needed. Warm-up mail never carries your journey design, and it is not listed in \"Sent by journeys\". Warm-up uses your own mailboxes to warm each other, so connect two or more. A platform mailbox can also take part when the Outreach team has added one.",
        },
        {
          type: "callout",
          tone: "warning",
          title: "While a mailbox warms up, emails wait for you",
          text: "A journey that sends from a mailbox that is still warming up always asks you to approve each email first. Warm-up counts only healthy days, so a pause restarts the count.",
        },
        {
          type: "paragraph",
          text: "\"Skip warm-up\" is for a mailbox that already sends normal email every day. It lets the mailbox send up to its daily target straight away. Do not use it on a new mailbox.",
        },
      ],
    },
    {
      id: "daily-limits",
      heading: "Daily limits",
      blocks: [
        {
          type: "paragraph",
          text: "Every mailbox shows a line such as \"Today: 4 of 5 campaign emails, 3 of 8 warm-up, 1 reply, 0 bounces\". The campaign number is how many journey emails the mailbox may send today. When it is used up you see \"This mailbox has sent everything it is allowed today\". The rest of your journey waits until tomorrow.",
        },
        {
          type: "paragraph",
          text: "A journey also has its own \"Most emails a day\" setting, and a gap between emails of at least 30 seconds, set at 120 seconds by default. The lower limit wins. To send more in a day, connect another mailbox and add it to the journey. Raise the daily target only for a mailbox that has graduated and has healthy bounce numbers.",
        },
        {
          type: "paragraph",
          text: "Each journey email also uses credits from your Leads plan. A journey will not start if you do not have enough.",
        },
      ],
    },
    {
      id: "health",
      heading: "Health and the automatic pause",
      blocks: [
        {
          type: "paragraph",
          text: "A bounce is an email that could not be delivered. Too many bounces tell inboxes you are sending to bad addresses, so each mailbox watches its own rate over the last 7 days.",
        },
        {
          type: "table",
          headers: ["Bounce rate (7 days)", "What happens"],
          rows: [
            ["Under 1.5%", "Normal sending."],
            ["1.5% or more", "A warning: \"Bounces are getting high\". Sending continues. Check the addresses in your lists."],
            ["2% or more", "The mailbox pauses itself and the reason is shown."],
          ],
        },
        {
          type: "paragraph",
          text: "The rate counts only once the mailbox has sent at least 10 emails in the week, so one early bounce does not trigger it. A mailbox that paused for bounces stays paused until you press \"Start warm-up\" again. Fix the cause first, which is usually a list with bad addresses. Pressing \"Pause sending\" yourself stops everything the mailbox sends, warm-up and journeys alike.",
        },
        {
          type: "paragraph",
          text: "In \"Inbox and sent\", the \"Deliverability\" card shows the last 7 days for each mailbox: the bounce rate, complaints, and whether SPF, DKIM and DMARC are set up. It gives steps to fix each missing check for your mail provider.",
        },
      ],
    },
    {
      id: "inbox-and-sent",
      heading: "Inbox and sent",
      blocks: [
        {
          type: "paragraph",
          text: "\"Inbox and sent\" is a full mail client for your connected mailboxes. The folders are \"Inbox\", \"Sent\", \"Drafts\", \"Archive\", \"Spam\" and \"Trash\", with \"More folders\" hiding the quieter ones. Choose \"All mailboxes\" or one mailbox. You can search, filter by unread, starred or attachments, and select several conversations to archive, delete or move.",
        },
        {
          type: "paragraph",
          text: "Under the folders is a group for your journeys. \"Replies\" lists the replies your journeys received. \"Sent by journeys\" lists every journey email with its outcome, and you can filter by mailbox, journey and what happened. \"Do not email\" is your do-not-email list.",
        },
        {
          type: "paragraph",
          text: "To write a new email, use the compose button. You can pick which mailbox it goes from, add Cc and Bcc, format the text, add a link and attach files. Mark messages read or unread, star, archive, delete or move them to Spam. These changes are sent back to your mail server, so your mailbox looks the same in every other mail app.",
        },
        {
          type: "callout",
          tone: "note",
          title: "Your signature and the footer",
          text: "A sent email is shown as you wrote it. The mailbox signature and the unsubscribe footer are added when it is sent.",
        },
      ],
    },
    {
      id: "replies",
      heading: "Replies",
      blocks: [
        {
          type: "paragraph",
          text: "Your mailboxes are checked every 5 minutes. A reply to a journey email is matched to the email it answers, marked as replied, and the journey stops for that person. Each reply is sorted into one of five labels.",
        },
        {
          type: "table",
          headers: ["Label", "Next step offered"],
          rows: [
            ["Interested", "\"Send times\" or \"Reply with times\", when booking is part of your plan."],
            ["Question", "\"Reply\" or \"Draft a reply\"."],
            ["Not interested", "\"Mark lost\", or \"Stop and add to do-not-email\" on the Replies list."],
            ["Out of office", "\"Wait 3 days\". The journey does not stop for an out-of-office reply."],
            ["Unsubscribe", "Already added to your do-not-email list."],
          ],
        },
        {
          type: "paragraph",
          text: "The sorting reads the words of the reply, so it can be wrong. Use the label menu on a reply to change it.",
        },
      ],
    },
    {
      id: "do-not-email",
      heading: "The do-not-email list",
      blocks: [
        {
          type: "paragraph",
          text: "Nobody on this list is emailed by any journey. Unsubscribes and permanent bounces are added automatically. You can add an address, or a whole domain such as company.com, with \"Add\". Use \"Remove\" to allow an address again. The \"Why\" column shows \"Unsubscribed\", \"Bounced\" or \"Added by you\".",
        },
        {
          type: "paragraph",
          text: "The list is checked when people are added to a journey and again before each email is sent.",
        },
      ],
    },
    {
      id: "signatures-aliases-sync",
      heading: "Signatures, aliases and sync",
      blocks: [
        {
          type: "paragraph",
          text: "\"Settings\" on a mailbox changes the name people see, the daily target, the password and the signature. Save the signature as plain lines, for example your name and company.",
        },
        {
          type: "paragraph",
          text: "\"Add sender alias\" lets a mailbox send as another address on your domain, such as sales@. Create the alias at your email provider first, then add it here, with an optional display name. Pick it in a journey's guided setup under \"Send as\". Recipients see the alias in the From line and replies come back to the mailbox. \"Remove\" deletes an alias, and journeys that used it go back to the mailbox address.",
        },
        {
          type: "paragraph",
          text: "Sync copies your mailbox folders into \"Inbox and sent\". The first sync reads roughly the last 30 days. After that, new mail arrives about every 5 minutes. Press the refresh button, \"Check for new mail\", to look straight away. If a mailbox cannot be read, you see the reason in a message.",
        },
        {
          type: "paragraph",
          text: "\"View sent\" on a mailbox opens the list of everything it has sent and what became of it.",
        },
      ],
    },
  ],
};
