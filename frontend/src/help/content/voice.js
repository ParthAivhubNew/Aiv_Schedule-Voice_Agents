export const voiceDoc = {
  id: "voice",
  path: "/help/voice",
  title: "Voice",
  summary: "Call people with an AI caller or from your own browser, track every conversation, and book the meetings that come out of them.",
  sections: [
    {
      id: "what-voice-is-for",
      heading: "What Voice is for",
      blocks: [
        {
          type: "paragraph",
          text: "Voice makes phone calls for you. An AI caller rings the people on a list, says what you told it to say, answers questions from what it knows about your business, and books a meeting when someone agrees. You can also make a call yourself from your browser, and take over an AI call while it is happening.",
        },
        {
          type: "paragraph",
          text: "Everything is kept in one place: the call, its transcript, a short summary, the outcome, and any meeting or callback that came from it.",
        },
        {
          type: "table",
          headers: ["Screen", "What you do there"],
          rows: [
            ["AI Assistant", "Ask questions about your calls, lists, schedule and numbers in plain words."],
            ["Call list", "Call one number, or upload a spreadsheet and call the people you tick."],
            ["Conversations", "Read past calls on the left. Watch calls happening now on the right. WhatsApp chats open from the same screen."],
            ["Meetings & callbacks", "See booked meetings, calls to try again later, and schedule a list to be called at set times."],
            ["Call stats", "See how many calls were made, answered and turned into meetings."],
            ["Company profile", "Set your company details, working hours, what the AI says, and how it sounds."],
            ["Plan & credits", "Check your credits, buy phone numbers and turn on WhatsApp. Admins only."],
          ],
        },
      ],
    },
    {
      id: "first-time-setup",
      heading: "First-time setup, in order",
      blocks: [
        {
          type: "paragraph",
          text: "Do these in order. Each step needs the one before it. You can build lists and write scripts while you wait for a phone number, but you cannot place a call until you have one.",
        },
        {
          type: "steps",
          items: [
            "Open Business Setup, then “Company profile”. Fill in “Basics”: your company name, the name the AI uses for itself, the tone, and your “Organisation timezone”. Add what you sell under “What you sell” and upload facts under “What the AI knows”.",
            "Open “What the AI says” and check the script. The default has a greeting, a pitch, answers to objections and a booking step. Edit it to sound like you.",
            "Open “Voice & rules”. Pick a voice, press “Hear this voice”, and press “Save”. Add your own phone number to test with, then press “Call my phone” to hear your assistant.",
            "Open “Plan & credits”. Complete business verification, then buy a UK number. The number becomes your caller ID. Admins only.",
            "Open “Working hours” and choose when the AI may call and when it may book meetings.",
            "Check your credits. Calls are paid from your Voice credits, one credit per minute at the standard rate. Top up or subscribe on “Plan & credits” if you have none.",
          ],
        },
        {
          type: "callout",
          tone: "tip",
          title: "Test on yourself first",
          text: "Call your own phone before you call a customer. Numbers you own never need recorded permission, so the test call goes through straight away.",
        },
      ],
    },
    {
      id: "call-list",
      heading: "The Call list",
      blocks: [
        {
          type: "paragraph",
          text: "The Call list is where calls start. The top box, “Call anyone”, is for one number. The table below it holds a list of people.",
        },
        {
          type: "paragraph",
          text: "To call one number, pick the country code, type the number in “Phone number”, add a name if you have one, and press “Call”. A menu opens with two choices: “Call with AI” and “Call myself”. The small icons next to the box send a text, open a WhatsApp chat, or save the number to your contacts.",
        },
        {
          type: "paragraph",
          text: "To call a list, drop a file on the page or choose “Upload CSV / Excel” from the three-dots menu. Excel, CSV, TSV, text, OpenDocument and JSON files all work. You can also press “Add a row” and type contacts in by hand.",
        },
        {
          type: "steps",
          items: [
            "Upload your file. A window called “Match your columns” opens.",
            "For each column in your file, choose what it is under “Import as”: a standard column, “Others: keep as its own column”, or “Don't import”. We guess the matches, so you only fix the wrong ones.",
            "Leave “Remember these matches for files with the same columns” ticked to save the choices for next time.",
            "If your workbook has several sheets, pick the sheet at the top of the window. Press “Import N rows”.",
            "Tick the people you want to call. Tick none to call everyone the current filter shows.",
          ],
        },
        {
          type: "table",
          headers: ["Standard column", "Notes"],
          rows: [
            ["Company", "Used in the conversation and to match the company in Leads."],
            ["Contact", "The person's name. The AI uses it when it speaks."],
            ["Phone", "Needs at least 7 digits. Rows without a usable number cannot be called."],
            ["Email", "Used for follow-up emails and meeting confirmations."],
            ["Website", "Helps the AI know who it is calling."],
            ["LinkedIn", "Kept for your reference."],
          ],
        },
        {
          type: "paragraph",
          text: "Above the table, a summary line counts your contacts, how many have a working phone and how complete the details are. The tabs “All”, “Ready to call”, “Needs a number” and “Called” narrow the list. “More filters” adds Not called, No answer, Spoke with them, Interested, Meeting booked, Not interested and Do not call. “Filter by name, website, contact or place” searches the list. “Default view” lets you save a filter under a name. Saved views are kept in your browser only.",
        },
        {
          type: "paragraph",
          text: "Click a row to open the contact panel. It shows their details, their stage, a notes box, every call made to them with its summary, and a timeline. It has “Call”, “Text” and “WhatsApp” buttons. Notes, stage and timeline need the contact to be in Leads. If it is not, the panel offers “Add to a Leads list”.",
        },
        {
          type: "paragraph",
          text: "Under the table tools you will see “Find missing”, “Get contacts” and the number check. “Find missing” fills empty phones, emails and websites from public search. “Get contacts” fills in what is missing and checks each company, the same as in your Leads lists. It needs Leads, it shows the most it can cost before it starts, and it is paid from your Leads credits. The number check is covered under pre-call checks below.",
        },
      ],
    },
    {
      id: "starting-and-stopping",
      heading: "Starting and stopping calls",
      blocks: [
        {
          type: "paragraph",
          text: "The main button changes with what you have ticked.",
        },
        {
          type: "table",
          headers: ["What is ticked", "Button", "What happens"],
          rows: [
            ["One person", "“Call 1 selected”", "That person is called straight away."],
            ["Two or more", "“Call N selected”", "Those people are called, up to two at the same moment. The rest wait for a free line."],
            ["Nobody", "“Call N contacts”", "Everyone the current filter shows is called, one at a time."],
          ],
        },
        {
          type: "paragraph",
          text: "Two calls at once is the most. This is a fixed limit. A box asks you to confirm before a list starts. It reads, for example, “Call 40 contacts, 2 at a time?”, with the cost per minute and your Voice credit balance.",
        },
        {
          type: "paragraph",
          text: "After you confirm, the screen moves to Conversations and the calls appear under “Live now”. To stop a list that is still working through its queue, press “Stop queue”. To end one call, press “Hang up” on its card and confirm. Calls already finished stay in your history.",
        },
        {
          type: "paragraph",
          text: "You can also run a list on a timer. See “Meetings & callbacks” below for call schedules.",
        },
        {
          type: "callout",
          tone: "note",
          title: "What the person hears",
          text: "The AI speaks first, with the greeting from your script, unless you turned “Agent speaks first” off. It uses the contact's name if you have it. If you turned on “Record calls”, it says your recording notice before anything else. A minute before the call's credits run out, it says it needs to wrap up.",
        },
      ],
    },
    {
      id: "pre-call-checks",
      heading: "Pre-call checks and what they refuse",
      blocks: [
        {
          type: "paragraph",
          text: "Every AI call is checked before it dials. A number that fails is not called. The reason is shown to you. The checks run in this order.",
        },
        {
          type: "table",
          headers: ["Check", "What it does"],
          rows: [
            ["Do not call", "A number that opted out, or sits on your do-not-contact list, is always refused. No setting turns this off."],
            ["Permission for AI calls", "The AI only dials a number where you have recorded that the person agreed to automated calls. Your own numbers are exempt. Without permission the call is refused with “No permission recorded for AI calls to this number.”"],
            ["Credits", "You need at least one call minute. If you do not have enough for an average call, you are warned first and can choose to call anyway."],
            ["Calling hours", "Checked in the other person's own time zone, as worked out from their number. What happens when it fails depends on your “Working hours” setting."],
          ],
        },
        {
          type: "paragraph",
          text: "If your Voice credits run out during a list, the list pauses and you are notified. It carries on from the next number once you top up.",
        },
        {
          type: "paragraph",
          text: "When you call Leads companies from Leads (“Call this list” or “Call selected”), a preview sorts people into who can be called now and who cannot. It gives each skipped person one of these reasons.",
        },
        {
          type: "table",
          headers: ["Reason shown", "What it means"],
          rows: [
            ["No phone number", "The company has no number yet."],
            ["The number failed the check", "A number check marked it as not working."],
            ["On the do-not-contact list", "They asked not to be contacted."],
            ["Contacted recently", "They were reached within your “recontact” window. The standard window is 14 days. You can change it in Connections settings."],
            ["Already in a running call round", "They are already waiting or on a call."],
            ["Outside calling hours right now", "It is not a calling time in their zone."],
            ["No recorded permission for AI calls", "You have not recorded permission for this number."],
          ],
        },
        {
          type: "paragraph",
          text: "The number check on the Call list shows which numbers are real, what kind they are and who they are registered to. It costs 1 credit per 5 numbers at the standard rate. Numbers with a bad format, repeats and do-not-call entries are skipped for free. So are numbers that have already been answered. The check shows your balance and refuses if you cannot afford it.",
        },
      ],
    },
    {
      id: "conversations",
      heading: "Conversations",
      blocks: [
        {
          type: "paragraph",
          text: "Conversations has two panes. “Call history” shows finished calls. “Live now” shows calls in progress, with a number beside it when any are live. On a phone the two panes become tabs.",
        },
        {
          type: "paragraph",
          text: "The history has a search box for name, number, company or mission. It also has three groups of filters.",
        },
        {
          type: "table",
          headers: ["Filter", "Choices"],
          rows: [
            ["Who made the call", "“Everyone”, “AI calls”, “My own calls”"],
            ["Direction", "“All calls”, “Incoming”, “Outgoing”"],
            ["Outcome", "“All”, “Contacted”, “Booked”, “Voicemail”, “No answer”, “Failed”, “Cancelled”"],
          ],
        },
        {
          type: "paragraph",
          text: "Click a call to open it. You see the transcript line by line, with “AI summary of this call”. The AI summary can be emailed to you with “Email me this”. If a recording was kept, you can play it with “Play Call”, or download it. A call to a company that came from Leads has a link to open that company.",
        },
        {
          type: "table",
          headers: ["Outcome", "Meaning"],
          rows: [
            ["Meeting booked", "A meeting was agreed and put in your calendar."],
            ["Asked for a call back", "They want a call later. If no meeting was booked, the callback is added to your calendar."],
            ["Spoke with them", "A real conversation with no result yet."],
            ["Interested", "They showed interest."],
            ["Left a voicemail", "The call reached voicemail."],
            ["No answer", "Nobody picked up."],
            ["Busy", "The line was engaged."],
            ["Not interested", "They said no."],
            ["Wrong number", "It was not the person you wanted."],
            ["Asked not to be called", "They asked to be left alone."],
            ["Did not connect", "The call failed to start."],
            ["Cancelled", "The call was cancelled before it connected."],
            ["Ended by a person", "A team member ended it."],
            ["Needs review", "The call is flagged for a person to look at. Call stats counts these separately."],
          ],
        },
        {
          type: "paragraph",
          text: "On a live call card you see the status (“Ringing”, “Needs you”, “Your call”), the transcript as it grows, and these buttons.",
        },
        {
          type: "table",
          headers: ["Button", "What it does"],
          rows: [
            ["Expand transcript", "Shows the whole conversation so far."],
            ["Take over", "Pauses the AI and rings your phone so you can talk to the person. Set your phone in Business Setup under “Voice & rules”."],
            ["Hand back to AI", "Returns the call to the AI. You can add a note saying what you agreed, and the AI carries on from it."],
            ["Stop listening", "Stops you hearing the call."],
            ["Book from call", "Books a meeting from what was said, using the time and email in the transcript."],
            ["Hang up", "Ends the call. A second press of “Keep call” cancels."],
          ],
        },
        {
          type: "paragraph",
          text: "Listening and taking over need a browser that can play audio. Taking over by voice asks for your microphone.",
        },
      ],
    },
    {
      id: "whatsapp",
      heading: "WhatsApp chats",
      blocks: [
        {
          type: "paragraph",
          text: "Open Conversations, then the “WhatsApp” tab. WhatsApp runs on your own number and needs that number to have WhatsApp turned on in “Plan & credits”. Until then the tab explains how to turn it on.",
        },
        {
          type: "paragraph",
          text: "You write the replies. Outreach never answers WhatsApp for you. You get an email when a conversation has something new. Use “New conversation” to write first. WhatsApp only lets a business start a chat with an approved template, and only lets you send free text within 24 hours of the other person's last message. After 24 hours the screen asks for a template name and its values. Each message sent costs 1 credit at the standard rate.",
        },
      ],
    },
    {
      id: "meetings-and-callbacks",
      heading: "Meetings & callbacks",
      blocks: [
        {
          type: "paragraph",
          text: "This screen has a calendar and a list. “Calendar” shows free slots, bookings and, as dashed chips, the times your scheduled lists will be called. The list view shows every booking and its status. On the left, “Add booking” (or “Park a call or meeting”) lets you add one by hand. Click a free slot on the calendar to fill in the day and time.",
        },
        {
          type: "table",
          headers: ["Meeting type", "What it means"],
          rows: [
            ["Phone call", "Marked “We dial them”."],
            ["Video meeting", "Needs a join link. Choose Google Meet, “Outreach Meet (auto room)”, or paste your own Zoom, Teams or Meet link. Leave the link blank to get an Outreach Meet room."],
            ["In person", "Needs an address."],
          ],
        },
        {
          type: "paragraph",
          text: "You can send a “WhatsApp confirmation” for a booking. It sends from your WhatsApp number if they wrote in the last 24 hours. Otherwise it opens WhatsApp with the message ready for you to send. After the meeting, mark it as attended or as a no-show.",
        },
        {
          type: "paragraph",
          text: "The “Schedule” button opens call schedules. A schedule dials a Call list on your timetable, so nothing needs to stay open in a browser. It has three tabs: “Calls”, “Schedule” and “History”.",
        },
        {
          type: "table",
          headers: ["Setting", "Choices"],
          rows: [
            ["Frequency", "“Right now”, “Once”, or “Recurring”"],
            ["Pattern", "Daily, weekly (pick weekdays), monthly (pick a day; on shorter months a 31st calls on the last day), or custom dates"],
            ["Call times", "One to six times a day. The whole list is dialled each time."],
            ["Calls at once", "One or two"],
            ["Call from", "“My default number” or one of your numbers"],
            ["Start date, End date", "The default end is three months after the start"],
          ],
        },
        {
          type: "paragraph",
          text: "Each call is made the same way as a list you start by hand. If call minutes run out, the list pauses and carries on after a top-up. A run that falls due while Outreach is off for more than 45 minutes is skipped, not made late. You can pause, resume or delete a schedule.",
        },
        {
          type: "callout",
          tone: "note",
          title: "Time zone rules",
          text: "Your account has one time zone, set in Company profile under “Organisation timezone”. Meetings, the calendar, callbacks, call schedules and call logs are stored in it. On a call, the AI works out the caller's zone from their number, and uses it for the times it says out loud and emails. If the caller says they are in a different zone, it uses that one. By default the zone is not spoken. To have the AI ask for the caller's time zone and say it once when it confirms a meeting, turn on “Ask the caller's timezone, and say it once when confirming the meeting” in the booking rules.",
        },
      ],
    },
    {
      id: "call-stats",
      heading: "Call stats",
      blocks: [
        {
          type: "paragraph",
          text: "Choose “Last 7 days”, “Last 30 days” or “Last 90 days”. Each figure is compared with the period of the same length just before it. Everything is counted from real call history. Dates use your account time zone.",
        },
        {
          type: "table",
          headers: ["Figure", "What it means"],
          rows: [
            ["Calls", "Every call in the period."],
            ["Connect rate", "Connected calls divided by all calls. A call is not connected if it ended as no answer, failed, busy, voicemail, cancelled or unreachable."],
            ["Meetings booked", "Calls that ended with a booked meeting."],
            ["Booking rate", "Meetings booked divided by connected calls, not by all calls."],
            ["Avg talk time", "The average length of connected calls."],
            ["Callbacks asked", "Calls where the person asked to be called back."],
          ],
        },
        {
          type: "paragraph",
          text: "Below the figures: “Calls over time” (a chart or a table), “How calls ended” (every outcome and its count), “Best time to call” (a map of the share of calls answered by weekday and hour), “Campaigns” (calls, connect and booked per list or campaign) and “Meetings” (upcoming, needing an outcome, became customers, not a fit).",
        },
        {
          type: "paragraph",
          text: "Call stats starts visible to admins only. Press “Share call stats” to choose who else can see it.",
        },
      ],
    },
    {
      id: "business-setup",
      heading: "Company profile",
      blocks: [
        {
          type: "paragraph",
          text: "Business Setup has four pages: “Company profile”, “Working hours”, “What the AI says” and “Voice & rules”.",
        },
        {
          type: "paragraph",
          text: "“Company profile” has four tabs. “Basics” holds your company name, the name the AI uses, its tone, how to say your brand aloud, the caller ID number shown, your time zone, time format and the day the week starts. “What the AI knows” takes websites, files up to 10 MB, Google links and pasted notes, then indexes them so the AI can answer from them during a call. “What you sell” lists your services and ideal customer. “Legal details” holds your registered name, ICO registration reference, data protection contact and notes on how you handle do-not-call.",
        },
        {
          type: "paragraph",
          text: "“What the AI says” is your script. Pick or create a template, choose “Outbound” or “Inbound”, and edit five parts in the “Prompt & Flow Editor”.",
        },
        {
          type: "table",
          headers: ["Part", "What it is for"],
          rows: [
            ["Opening Hook & Greeting", "What is spoken the moment the call connects."],
            ["Permission & Timing Check", "Asks if they have two minutes."],
            ["Value Proposition & Core Pitch", "Your pitch, referring to a company benefit."],
            ["Objection Handling Matrix", "Answers to common objections, with a limit on how many times the AI tries."],
            ["Booking Flow & Closing", "How it moves to a meeting, and how it ends the call."],
          ],
        },
        {
          type: "paragraph",
          text: "Use “Insert variable…” to add things like the prospect's name, their company, your company or today's date. They are filled in on every call. The “Live Prompt Preview” tab shows how the script reads for a full Leads contact, a partial one, a direct call with only a number, and an inbound call. It also shows where each part of the prompt comes from, so you know where to change it.",
        },
        {
          type: "paragraph",
          text: "The “Booking & Call Rules” tab controls how meetings are booked. It is shared by every script, and it saves separately with “Save booking & call rules”.",
        },
        {
          type: "table",
          headers: ["Setting", "Effect"],
          rows: [
            ["Meeting types", "Which of phone call, video meeting and in person the AI may offer."],
            ["Ask which meeting type first", "The AI asks before it offers times."],
            ["Confirm if they already have a booking", "The AI checks for an existing booking."],
            ["Offer notify channel after booking", "The AI offers a WhatsApp confirmation."],
            ["Ask the caller's timezone, and say it once when confirming the meeting", "Off by default. See “Time zone rules”."],
            ["Ask before hanging up", "The AI asks if there is anything else, then says goodbye."],
            ["Hang-up timing", "How long the AI waits before it ends the call."],
            ["Extra call rules", "Free text for rules the toggles do not cover, such as “Never book Fridays after 15:00”."],
          ],
        },
        {
          type: "paragraph",
          text: "“Voice & rules” holds the voice and the rules for every call. Each person picks their own voice and phone number. Only admins change the company rules.",
        },
        {
          type: "table",
          headers: ["Setting", "What it does"],
          rows: [
            ["Voice, language, gender, search", "Narrow the list of voices, then choose one. “Hear this voice” plays a sample."],
            ["Speaking speed", "From 0.5 times to 2 times normal."],
            ["Background sound", "Silence or office, with a volume slider."],
            ["Language it listens for", "Detect automatically, or choose one."],
            ["Your phone", "Used for test calls and to ring you when you take over a call."],
            ["Your company's voices", "Clone a real voice from 5 to 10 seconds of clear speech. Free. Only your company sees it. The speaker must have agreed, and you tick a box to say so."],
            ["Hand over to a person when", "Situations the AI should pass to a human, such as refunds or complaints."],
            ["Never say or promise", "Things the AI must not say, such as discounts or delivery dates."],
            ["Find out on each call", "Facts to collect. They show in call history."],
            ["Default outbound script, Incoming calls script", "Which script is used when none is chosen."],
            ["Record calls", "Off by default. When on, the AI says the “Recording notice” first."],
            ["How every call behaves", "Whether the AI speaks first, whether people can interrupt, silence check-ins, a fallback number, a noise filter, words to recognise, and up to 10 people callers can be put through to."],
          ],
        },
        {
          type: "paragraph",
          text: "“Keep conversation history” in that list decides whether transcripts and insights are kept. If you turn it off, none are.",
        },
      ],
    },
    {
      id: "working-hours",
      heading: "Working hours",
      blocks: [
        {
          type: "paragraph",
          text: "“Working hours” has two cards: “Calling hours” and “Meeting hours”. Only admins, or people with Company profile: Full access, can change them.",
        },
        {
          type: "paragraph",
          text: "“Calling hours” decide when the AI may call, in each person's own time zone. Choose one of three.",
        },
        {
          type: "table",
          headers: ["Choice", "Meaning"],
          rows: [
            ["Weekdays (company hours)", "Monday to Friday, using your company hours (09:00 to 17:30 by default) and skipping lunch (12:00 to 13:00 by default)."],
            ["Every day 08:00–21:00", "Every day of the week between 08:00 and 21:00."],
            ["Custom days and hours", "You set each day's start and end, whether the day is open, and lunch."],
          ],
        },
        {
          type: "paragraph",
          text: "Then choose what happens when a call falls outside those hours.",
        },
        {
          type: "table",
          headers: ["Option", "What happens"],
          rows: [
            ["Call, but warn", "The call goes ahead. This is the default."],
            ["Don't call", "The call is refused."],
            ["Ignore the hours", "The hours are not checked."],
          ],
        },
        {
          type: "paragraph",
          text: "If a custom schedule includes weekends, or starts before 08:00 or ends after 21:00, the screen shows a note that UK guidance from Ofcom is to avoid marketing calls outside 08:00 to 21:00. The choice is yours.",
        },
        {
          type: "paragraph",
          text: "“Meeting hours” decide when the AI may book meetings, in your company time zone. “Same as calling hours” copies the calling hours across. Save each card on its own.",
        },
      ],
    },
    {
      id: "numbers-and-verification",
      heading: "Phone numbers and verification",
      blocks: [
        {
          type: "paragraph",
          text: "Phone numbers are managed in “Plan & credits” by admins. Calls go out from your company's own number.",
        },
        {
          type: "steps",
          items: [
            "Under “Business verification”, say whether you are a registered company or a sole trader and upload the documents the screen asks for. A registered company sends its certificate of incorporation and a recent utility bill. A sole trader sends passport or photo ID and a proof of address. Add a real street address, a working website and a contact person.",
            "Say what the number is for. Vague answers such as “business use” are rejected.",
            "Submit for review. We check who will use the number, usually within 3 days. The screen shows “Under review”, then “Verified” or “Not approved” with a reason. You can upload new documents if it is not approved.",
            "Once verified, open “Get a UK number”, type a town or area code, choose a number and confirm the price. The number switches on and becomes your caller ID.",
            "To use WhatsApp on a number, press “Turn on WhatsApp” and finish the signup in the new tab. It switches on by itself once approved.",
          ],
        },
        {
          type: "paragraph",
          text: "Under “Your numbers” you can set the default caller ID, turn WhatsApp on or off, and release a number. Releasing a number loses it for good. When you have more than one number, the Call list shows a “Call from” menu. “Outbound call destinations” sets which countries your AI and your browser calls are allowed to reach.",
        },
        {
          type: "callout",
          tone: "note",
          title: "Who can see what",
          text: "Only admins see “Plan & credits” for numbers. If you are not an admin and the screen says you need a number, ask your admin to add one for you.",
        },
      ],
    },
    {
      id: "credits-and-costs",
      heading: "Credits and what a call costs",
      blocks: [
        {
          type: "paragraph",
          text: "A Voice credit is a minute of calling at the standard rate. Your plan screen shows the rates that apply to you. Open “Plan & credits”, or press the credits box at the bottom of the left menu.",
        },
        {
          type: "table",
          headers: ["Item", "Standard rate"],
          rows: [
            ["Call minute (AI or browser)", "1 credit per minute"],
            ["Call minute with a premium AI engine or voice", "2 credits per minute"],
            ["WhatsApp message sent", "1 credit per message"],
            ["Browser call transcript and summary", "1 credit per minute of call"],
            ["Number check", "1 credit per 5 numbers"],
            ["Phone number rental", "15 credits per number per month"],
            ["Number setup", "5 credits per number"],
          ],
        },
        {
          type: "paragraph",
          text: "When a call starts, it holds the minutes you have left, so two calls cannot spend the same credits. When it ends, you are charged for the time it really used and the rest is released. No call can last longer than 4 hours. If you have only a few minutes left, a warning says how long the call will run and you can choose to call anyway. A minute before the limit, the AI tells the person it needs to wrap up.",
        },
        {
          type: "paragraph",
          text: "Plans are monthly. Plan credits that are not used are replaced when the plan renews. One-off top-ups never expire, and they are used after your plan credits. An admin can set a monthly credit limit for a person. A call that would break it is refused with a message that says so.",
        },
      ],
    },
    {
      id: "browser-phone",
      heading: "Calling from your browser",
      blocks: [
        {
          type: "paragraph",
          text: "Choose “Call myself” from any Call button, or press “Call” on a contact. A phone panel opens and you talk to the person yourself. You need a number of your own to call from, and your browser must be allowed to use the microphone.",
        },
        {
          type: "paragraph",
          text: "To record, tick “Record and transcribe this call”. You must confirm that you will tell the person the call is recorded. The panel suggests the line: “This call may be recorded for our records.” Without that confirmation, the call will not start. You can only have one browser call open at a time.",
        },
        {
          type: "paragraph",
          text: "When the call ends, choose “How did it go?”: Talked, No answer, Voicemail, Wrong number, Call back, Not interested or Do not call. Add a note if you like. “Do not call” puts the number on your do-not-call list.",
        },
        {
          type: "paragraph",
          text: "A recorded call gets an automatic transcript and summary. The transcript can contain mistakes, and the audio is kept for 30 days. You can copy the text from the panel. Your own calls appear in Conversations under “My own calls”.",
        },
        {
          type: "paragraph",
          text: "Browser calls follow looser rules than AI calls. They do not need recorded permission. They are still refused if the number opted out, and they use your credits and call-hours setting.",
        },
      ],
    },
    {
      id: "voice-and-leads",
      heading: "How Voice and Leads work together",
      blocks: [
        {
          type: "paragraph",
          text: "These links need both Leads and Voice on your plan. Calling also needs Calling access in your role.",
        },
        {
          type: "table",
          headers: ["Link", "How it works"],
          rows: [
            ["Leads list to Call list", "In Leads, press “Review in Voice first”. Companies with a phone number open on the Call list for you to check. Companies without a number are left out and counted. Or press “Call this list” in Leads to have the AI caller phone them directly."],
            ["Bring it across", "When you switch to Voice with a Leads list open, the app offers “Bring your list across”. It opens on the Call list. It saves the companies to Leads, skipping any you already have."],
            ["After a call", "By default, the company's stage, last call and timeline update by themselves. Facts found on a call are kept for you to accept, unless you turn on using them without asking."],
            ["Follow-up emails", "Turn on “Email them after they ask for a call back” to send a message from your mailbox, and “Email them after missed calls” to send a short note after a set number of misses."],
            ["Meetings", "A booking stops planned emails and calls for that person. You can also have reminder emails 24 hours and 1 hour before, a confirming call an hour before, and an email or call for people who did not attend."],
            ["Contacts from the Call list", "“More actions” on ticked people offers “Add to a Leads list”, “Set their stage” and “Email them from Leads”."],
          ],
        },
        {
          type: "paragraph",
          text: "The switches are in Settings, under Connections. They are opt-in unless they say otherwise. The same screen holds your do-not-contact list, which applies to calls, email and social.",
        },
        {
          type: "paragraph",
          text: "The “Workflows” item in the Voice menu lets you do something automatically when a call ends or a meeting is booked.",
        },
      ],
    },
    {
      id: "ai-assistant",
      heading: "The AI Assistant in Voice",
      blocks: [
        {
          type: "paragraph",
          text: "Open “AI Assistant” in the Voice menu, or use the “AI Assistant” button at the top of any screen. Ask in plain words. It reads your own data and tells you only what it finds. It does not place calls or change settings. When you want that, it gives you a button that takes you to the right screen.",
        },
        {
          type: "table",
          headers: ["You can ask it to", "Example"],
          rows: [
            ["Report how calls went", "“How many meetings did we book this week?”"],
            ["Find a call and read its summary or transcript", "“What did Acme say on Tuesday?”"],
            ["Check your numbers and the state of your AI caller", "“Is my number ready?”"],
            ["List your call lists and schedules", "“What is scheduled for tomorrow?”"],
            ["Tell you your credits", "“How many minutes do I have left?”"],
            ["Answer from your uploaded documents", "“What is our cancellation policy?”"],
            ["Write two options for a greeting", "“Give me a warmer opening line.” Nothing is changed."],
            ["Turn a Leads list into a call list", "It shows a button. Nothing is made until you press it."],
          ],
        },
      ],
    },
    {
      id: "safety-and-legal",
      heading: "Safety and legal basics",
      blocks: [
        {
          type: "paragraph",
          text: "This section describes what the product does. It is not legal advice. You remain responsible for who you call and why.",
        },
        {
          type: "table",
          headers: ["What the product does", "Detail"],
          rows: [
            ["Refuses opted-out numbers", "Always, for AI calls and browser calls."],
            ["Requires recorded permission for AI calls", "You record who agreed, which company they agreed to hear from, what the calls are about, how they agreed (a recorded call, a web form, in writing, or by email), and where the proof is kept. The exact wording they agreed to is stored with it. You can withdraw a permission at any time and the AI stops calling that number."],
            ["Checks calling hours", "In the other person's time zone, using the mode you chose."],
            ["Recording notice", "Recording is off by default. When on, the AI says your notice first. Browser calls need you to confirm you will tell the person."],
            ["Stores audio for a limited time", "Browser call audio is kept for 30 days."],
            ["Does not look up TPS for you", "The screen marks a number “Not screened: check TPS first”. You must check TPS yourself before a browser call. Recorded permission outweighs a TPS listing."],
          ],
        },
        {
          type: "paragraph",
          text: "To record permission, open Working hours and find “Permission for AI calls”. Fill in the number, company, optional person, what the calls are about and how they agreed, tick the box to say they agreed to that wording and you can show how, then press “Save permission”. The same form opens if an AI call is refused: press “Record permission” in the message, or choose “Record it and call with AI”. “Call myself instead” skips it.",
        },
      ],
    },
    {
      id: "troubleshooting",
      heading: "Troubleshooting",
      blocks: [
        {
          type: "table",
          headers: ["Problem", "What to check"],
          rows: [
            ["The Call button is greyed out and says to get a number", "You have no phone number yet. An admin adds one under “Plan & credits”. Business verification must be approved first."],
            ["A call is refused with “No permission recorded for AI calls to this number.”", "Record permission for that number, or choose “Call myself”."],
            ["A call is refused as opted out", "The number is on your do-not-contact list. It is never called. Remove the entry in Connections settings only if you have the right to contact them."],
            ["A call is refused for being out of hours", "Your “Working hours” are set to “Don't call”. Wait for calling hours, change the hours, or choose “Call, but warn”."],
            ["A call is refused for credits", "You have less than one call minute. Top up in “Plan & credits”. A list in progress pauses and resumes after a top-up."],
            ["“Calls to that country are not switched on for your account.”", "Add the country under “Outbound call destinations”."],
            ["Numbers are rejected or skipped", "Numbers need at least 7 digits. Use international format such as +44 7700 900123. Run the number check to find bad ones. Check the “Match your columns” step put the right column under Phone."],
            ["Your browser call will not start", "Allow the microphone. Pick one of your own numbers to call from. Confirm the recording line if recording. Close any other open call first."],
            ["The AI says the wrong thing", "Open the call in Conversations and read the transcript. Fix the script in “What the AI says”, check the facts under “What the AI knows”, add “Never say or promise” rules in “Voice & rules”, and use “Live Prompt Preview” to see the result before the next call."],
            ["The AI books the wrong time", "Check “Meeting hours” and your “Organisation timezone”. Add a rule under “Extra call rules”."],
            ["The AI sounds wrong", "Change the voice, speed or background sound in “Voice & rules”, then press “Call my phone” to hear it."],
          ],
        },
        {
          type: "callout",
          tone: "tip",
          title: "Still stuck",
          text: "Press “Support” in the left menu. It opens a form that already knows which Voice screen you were on.",
        },
      ],
    },
  ],
};
