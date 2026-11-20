export const leadsJourneysDoc = {
  id: "leads-journeys",
  path: "/help/leads/journeys",
  title: "Journeys",
  summary: "Set up a path of emails, calls and tasks once, and let it run for every person on a list until they reply, book or opt out.",
  sections: [
    {
      id: "what-a-journey-is",
      heading: "What a journey is",
      blocks: [
        {
          type: "paragraph",
          text: "A journey is a path that each person follows through your outreach. It is made of steps: an email, a call, or a task for you. Between steps there is a wait, such as 3 days. You set the path up once. The journey then moves every person along it, one step at a time, at their own pace.",
        },
        {
          type: "paragraph",
          text: "A journey stops for a person as soon as they reply, book a meeting or opt out. Nobody who answers gets another message from it. You do not have to watch the list and take people off by hand.",
        },
        {
          type: "paragraph",
          text: "Open Journeys in the left menu, under Outreach. The list on the left shows your journeys in four groups: \"Running\", \"Drafts\", \"Finished\" and \"Archived\". \"Running\" also holds paused journeys. Pick one to see it on one page: its steps, its people, its results and its rules.",
        },
        {
          type: "callout",
          tone: "note",
          title: "Nothing is sent by accident",
          text: "A new journey is always a draft. Nothing goes out until you press \"Start\". The journey can also be paused or stopped at any time.",
        },
      ],
    },
    {
      id: "creating-a-journey",
      heading: "Creating a journey",
      blocks: [
        {
          type: "paragraph",
          text: "Press \"New journey\". You have four ways to start. All of them make a draft that you then check and change.",
        },
        {
          type: "table",
          headers: ["Way to start", "What it does"],
          rows: [
            ["Say what it is for and we write it", "Type one sentence, such as \"Introduce us to dental practices in Leeds\". Press \"Write it for me\". The journey is written from what you entered in About your business and never invents facts. You can tick \"Add a call\" (needs the Voice plan) and \"Add a task for me\"."],
            ["Or start from a ready-made journey", "Pick one of the saved templates and press \"Use\". Each shows how many steps it has and what it suits best."],
            ["Start from a blank email", "Makes a journey with a single email step for you to write."],
            ["Guided setup with a personal opening line for each person", "The one-page setup. It asks who, what to say, when to send, then shows a check before you launch."],
          ],
        },
        {
          type: "paragraph",
          text: "The optional \"Who is it for?\" list at the top of \"New journey\" adds the people from one of your lists as a draft. You can also leave it empty and add people later.",
        },
        {
          type: "paragraph",
          text: "A journey can have up to 12 steps.",
        },
      ],
    },
    {
      id: "one-page-or-step-by-step",
      heading: "Guided setup: one page or step by step",
      blocks: [
        {
          type: "paragraph",
          text: "The guided setup opens as one page called \"New journey\", with four blocks: \"Who\", \"Emails\", \"When\" and \"Before you launch\". It is made for someone who has never sent a journey. You pick a list, let the AI write the emails or write them yourself, check the summary, and launch.",
        },
        {
          type: "paragraph",
          text: "Press \"More options\" on that page for the step-by-step version. It has five steps: \"Who\", \"Emails\", \"Send from\", \"Schedule\" and \"Launch\". It adds things the one-page version keeps out of the way: the exact wait between emails, a call step between emails, and the address emails are sent as. \"Back to the simple version\" takes you back.",
        },
        {
          type: "paragraph",
          text: "Both versions make the same kind of journey. At the end you choose \"Save as draft\" or launch it straight away. If you launch and something is not ready, such as a mailbox that is still being set up, the journey is saved as a draft and you are told why.",
        },
        {
          type: "callout",
          tone: "tip",
          title: "Fill in About your business first",
          text: "The AI writes only from what you tell it in About your business. If that is empty, the \"Write the emails with AI\" button is switched off. See the About your business guide.",
        },
      ],
    },
    {
      id: "steps",
      heading: "Steps: emails, follow-ups, calls and tasks",
      blocks: [
        {
          type: "paragraph",
          text: "On a journey's page, the \"Steps\" card lists the path in order. Click a step to open and change it. Use the arrows to move a step and \"Remove step\" to delete it. \"Add a step\" offers these types:",
        },
        {
          type: "table",
          headers: ["Step type", "What happens"],
          rows: [
            ["Email", "Sent for you, inside your sending hours."],
            ["Call", "Your AI caller rings the person. Needs the Voice plan."],
            ["Email to write yourself", "Becomes a task for you, with the text ready."],
            ["Call task", "A task for you to ring them."],
            ["Task", "Anything else you do by hand."],
            ["Social task", "Like, comment or message on social media."],
            ["LinkedIn task", "A reminder. LinkedIn is never automated."],
            ["Letter task", "A reminder to post a letter."],
          ],
        },
        {
          type: "paragraph",
          text: "Every step after the first has a wait, set in days and hours. The first step has none, because it starts when the journey does.",
        },
        {
          type: "paragraph",
          text: "In an email step you can use the merge fields {{first_name}}, {{last_name}}, {{company}}, {{personal_line}} and {{source_line}}. The last one writes a short line saying where you found the person. Use \"Insert source line\" to add it. Step 1 shows an amber warning if it is missing, because UK GDPR expects you to tell people where you got their details.",
        },
        {
          type: "callout",
          tone: "tip",
          title: "Follow-ups in the same thread",
          text: "On any email after the first, leave \"Subject\" empty. The email is then sent as a reply in the same conversation, so it reads like a nudge and not a new message. If you do write a subject, it starts a new conversation.",
        },
        {
          type: "paragraph",
          text: "Under an email step, \"Test a second version\" lets you write a second subject and body. Half the people get each version. Results show the replies for each version so you can keep the better one. \"Insert form link\" adds a personal link to one of your published forms. See the Forms guide.",
        },
        {
          type: "paragraph",
          text: "A call step has these settings. \"What is this call for?\" is the goal. \"Talking points\" is optional. \"Call when\" is \"Always\", \"They have not replied\" or \"They opened but did not reply\". \"Voicemail\" is \"Hang up\" or \"Leave a short message\". \"If nobody answers\" is \"Move on\" or up to three more tries. If a call reports nothing for 36 hours, the journey treats it as unanswered and carries on.",
        },
        {
          type: "paragraph",
          text: "Task steps appear under \"Needs you today\" on the journey page, grouped as \"Overdue\", \"Today\" and \"Later\". Press \"Done\" or \"Skip\". For a call task, choose how it went: \"Spoke to them\", \"Interested\", \"Call me back\", \"No answer\", \"Left a voicemail\", \"Wrong number\", \"Not interested\" or \"Don't call again\". The person waits at a task until you mark it done.",
        },
      ],
    },
    {
      id: "sending-rules",
      heading: "Sending window, days and daily cap",
      blocks: [
        {
          type: "paragraph",
          text: "Press \"Rules\" on a journey to open its settings. They decide when and how emails go out.",
        },
        {
          type: "table",
          headers: ["Setting", "What it does"],
          rows: [
            ["Send emails as", "The mailboxes the journey sends from. Pick one or more and the journey spreads its emails across them. A follow-up goes from the mailbox that sent the first email, unless that one is blocked."],
            ["Send on", "The days of the week emails may go out. The default is Monday to Friday."],
            ["From / Until", "The sending window. The default is 09:00 to 17:00, in your account's timezone."],
            ["Most emails a day", "A limit for this journey. 0 means no extra limit. Each mailbox also has its own daily allowance, and the lower of the two applies."],
            ["Stop for a person when they", "Replying, booking a meeting and opting out always stop the journey for that person. You can also stop it when they say they are not interested, or send back a form."],
            ["Before each email goes", "Tick \"Let me read and approve it\" to check every email before it is sent. See Approvals below."],
          ],
        },
        {
          type: "paragraph",
          text: "Under \"More options\" there are three more. \"Mark as no answer after\" sets how many days of silence after the last step before a person is marked as \"No answer\". The default is 7 and 0 means never. \"Leave out anyone whose stage is\" skips people whose stage is Won, Lost, Do not contact, Meeting booked or Interested. \"Other journeys\" holds the one-at-a-time rule.",
        },
        {
          type: "paragraph",
          text: "The \"When emails go out\" card gives an estimate of when the first email will reach everyone, based on your rules. Each person's exact next send shows under \"People\" once the journey runs.",
        },
        {
          type: "callout",
          tone: "note",
          title: "Why emails may wait",
          text: "A mailbox can send only up to its own daily allowance, and a new mailbox starts small. When the allowance is used, the rest waits until the next day. Add a second mailbox to send more. See the Mail guide.",
        },
      ],
    },
    {
      id: "one-at-a-time",
      heading: "The \"one at a time\" rule",
      blocks: [
        {
          type: "paragraph",
          text: "By default a person can be in only one running journey. The setting is \"Skip people already in another running journey\", under Rules, \"More options\". It stops the same person getting emails from two journeys at once.",
        },
        {
          type: "paragraph",
          text: "The rule is checked in two places. When you add people, anyone already active in a different running journey is skipped, and the count shows as \"already in another journey\". When you press Start, the journey checks again for people who were added while it was a draft. If any clash, it will not start and tells you how many are in another running journey.",
        },
        {
          type: "paragraph",
          text: "A paused or finished journey does not block anyone. Only people who are in progress in a journey that is running count. To get past a clash, pause the other journey, or turn the setting off for this one.",
        },
      ],
    },
    {
      id: "who-is-eligible",
      heading: "Who gets an email",
      blocks: [
        {
          type: "paragraph",
          text: "Not everyone on a list can be emailed. The rules follow UK email marketing law (PECR). A company is judged from our copy of the company register, so a journey never needs you to sort people by hand.",
        },
        {
          type: "table",
          headers: ["Who", "What the journey does"],
          rows: [
            ["A registered company: Ltd, LLP, PLC and similar bodies, and Scottish partnerships", "Emailed as normal."],
            ["No clear match on the register yet", "Waits for a quick choice from you. See below."],
            ["A sole trader, an individual, or an ordinary partnership", "Not emailed without consent. Their email steps are skipped. A call, letter or LinkedIn task is made instead and the journey carries on."],
            ["Anyone with consent recorded", "Emailed. Consent means they opted in, are an existing customer, or made an enquiry."],
            ["A closed company, a number that belongs to another company, or an address that cannot receive mail", "Left out. Nothing is gained by writing to them."],
            ["Anyone on your do-not-email list", "Skipped when added and again before each send."],
          ],
        },
        {
          type: "paragraph",
          text: "A personal address such as Gmail or Hotmail at a company counts as an individual unless consent is recorded. A person pasted in by hand with no saved company is emailed only if the company name beside them plainly has Ltd, LLP or PLC in it.",
        },
        {
          type: "paragraph",
          text: "The \"Who gets what\" card shows the split, for example \"186 get email, 9 need a quick choice, 5 are reached another way\". For each person who needs a choice you can press \"Is this ...?\" on a suggested company, \"Search the register\", \"It's a sole trader\", or \"They've opted in / existing contact\". The last one asks you to say how and when they agreed. Choosing sole trader lets you pick \"Call them\", \"Send a letter\", \"Reach them on LinkedIn\" or \"Let the journey decide\". A call task shows a \"Check TPS first\" tag so you check the number against the TPS register before you ring.",
        },
        {
          type: "callout",
          tone: "note",
          title: "Checked again before each send",
          text: "\"Checked before sending\" means the journey judges each person again at the moment an email would go out. Whatever let them in, nobody who may not be emailed is emailed. If the check fails, the email is not sent and they are reached another way.",
        },
        {
          type: "paragraph",
          text: "When you add people, the result says how many were skipped and why: already in, on the do-not-email list, without a valid email, already in another journey, or with no contact details. People left out for safety are listed with the reason.",
        },
      ],
    },
    {
      id: "starting-pausing-stopping",
      heading: "Starting, pausing and stopping",
      blocks: [
        {
          type: "paragraph",
          text: "On a draft, the \"Start\" button stays off until the red warnings are fixed. Each warning has a \"Fix\" button that takes you to the right place. The checks include these:",
        },
        {
          type: "steps",
          items: [
            "The journey has at least one step and at least one person waiting to start.",
            "Your business name and postal address are filled in under About your business. UK law requires them in every marketing email.",
            "An email account is chosen, and it can send: its DNS checks are done and warm-up has started.",
            "You have enough credits to send.",
            "If there is a call step, you have the Voice plan and enough calling minutes.",
          ],
        },
        {
          type: "paragraph",
          text: "Amber lines are advice, not blocks. Green means \"Ready\". When you press \"Start\" on a journey that already has people, a box asks you to confirm and says when the first emails should be out.",
        },
        {
          type: "paragraph",
          text: "\"Pause\" stops sending for now. Nobody loses their place, and \"Resume\" carries on. Under the \"...\" menu, \"Stop it\" ends the journey for everyone still in it. A stopped journey cannot be started again. Use \"Make a copy\" to start a new draft with the same steps and rules and nobody in it. A finished journey can be archived to tidy it away, and you can bring it back. \"Delete\" removes the journey, its tasks and everyone's place in it. Your saved companies and contacts stay.",
        },
        {
          type: "paragraph",
          text: "You can edit steps while a journey runs. People part-way through keep their place.",
        },
      ],
    },
    {
      id: "replies-bounces-unsubscribes",
      heading: "Replies, bounces and unsubscribes",
      blocks: [
        {
          type: "table",
          headers: ["What happens", "What the journey does"],
          rows: [
            ["Someone replies", "The reply is read and sorted as Interested, Question, Not interested, Out of office or Unsubscribe. The journey stops for that person. An out-of-office auto-reply does not stop it."],
            ["Someone books a meeting", "The journey stops for that person."],
            ["Someone unsubscribes", "The journey stops. The address goes on your do-not-email list and is never emailed by any journey again."],
            ["An email bounces", "A permanent failure puts the address on the do-not-email list, marks the email as bounced and stops the journey for that person."],
            ["Someone says they are not interested", "Stops the journey, unless you turned that rule off."],
            ["Someone sends back a form from a link in your email", "Stops the journey, unless you turned that rule off."],
            ["No answer after the last step", "After the number of days in \"Mark as no answer after\", the person is marked \"No answer\"."],
          ],
        },
        {
          type: "paragraph",
          text: "Every email carries an unsubscribe link, your business name and postal address, and a \"Why you got this\" link. You do not add these yourself. Replies appear in Mail under \"Replies\". The journey page shows \"Needs you today\" with the number who have replied and a \"Read replies\" button.",
        },
      ],
    },
    {
      id: "approvals",
      heading: "Approvals",
      blocks: [
        {
          type: "paragraph",
          text: "When approval is on, each email waits for you before it goes. They collect under \"Emails waiting for you\" on the journey page. Open one to read it. \"Edit\" changes the subject or wording, then \"Save\". \"Approve\" sends that one in the next sending window. \"Approve all\" does the lot.",
        },
        {
          type: "paragraph",
          text: "Approval turns on in two cases. You tick \"Let me read and approve it\" under Rules. Or a mailbox the journey uses is still warming up, in which case approval is always on, because a new mailbox must send carefully. Newer accounts also start with approval on by default for new journeys. Your edits are always kept: an approved or edited email goes out exactly as it reads.",
        },
        {
          type: "paragraph",
          text: "\"Preview with a real person\" shows an email as one chosen person will see it, with the merge fields filled in. Use it before you press Start.",
        },
      ],
    },
    {
      id: "reading-results",
      heading: "Reading the results",
      blocks: [
        {
          type: "paragraph",
          text: "Once emails are sent, a results bar sits under the journey's name. Click it, or choose \"Results and advice\" from the \"...\" menu, to see the numbers for each step.",
        },
        {
          type: "table",
          headers: ["Count", "What it means"],
          rows: [
            ["Sent", "Emails that left your mailbox."],
            ["Delivered", "Sent emails that did not bounce."],
            ["Opened", "Emails opened at least once. This is a minimum: some mail apps hide opens. If open tracking is switched off in your connection settings, opens are not counted at all."],
            ["Replied", "People who wrote back, with the reply rate."],
            ["Booked", "People who booked a meeting."],
            ["Bounced", "Emails that could not be delivered, with the bounce rate."],
            ["Opted out", "People who unsubscribed."],
          ],
        },
        {
          type: "paragraph",
          text: "The table \"Each step\" shows these numbers per step, so you can see which email works. \"Advice from the numbers\" gives plain rule-based tips. For example it suggests a shorter first email if fewer than 2 in 100 get a reply once at least 50 are sent, a list check if bounces reach 4%, and a call step if there is none. The advice does not need the AI.",
        },
        {
          type: "paragraph",
          text: "Under \"People\", each person shows where they are: \"In progress\", \"Replied\", \"Booked\", \"Finished\", \"No answer\", \"Sent the form back\", \"Bounced\", \"Opted out\" or \"Reached another way\". A finished person shows why, such as \"replied\" or \"never answered\". \"Add people\" takes a list or pasted lines of email, first name, last name and company. The \"X\" next to a person takes them out.",
        },
      ],
    },
    {
      id: "good-first-emails",
      heading: "Tips for good first emails",
      blocks: [
        {
          type: "paragraph",
          text: "Keep the first email short. Ask one clear question. Name their company in the subject. These rules come from the numbers the journey itself checks.",
        },
        {
          type: "steps",
          items: [
            "Write for one person. Use {{first_name}} and {{company}}, and say why you chose them.",
            "Say where you found them with {{source_line}}.",
            "Make one ask, such as a 15 minute intro.",
            "Leave the subject empty on follow-ups so they stay in the same thread.",
            "Wait 2 to 3 days between steps. Waiting too short looks pushy.",
            "Test a second version of the first email, then keep the better one.",
            "Add a call step or task two days after the first email for people who have not replied.",
            "Send a first batch to a small list and read the results before you add more people.",
          ],
        },
        {
          type: "callout",
          tone: "warning",
          title: "Protect your sender reputation",
          text: "A mailbox pauses itself when its bounce rate reaches 2%. Check the addresses in a list before you send, and keep new mailboxes to their warm-up limits. See the Mail guide.",
        },
      ],
    },
  ],
};
