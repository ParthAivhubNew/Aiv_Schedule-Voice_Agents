const p = (text) => ({ type: "paragraph", text });

export const voiceCallsDoc = {
  id: "voice-calls",
  path: "/help/voice/calls",
  title: "Call List & Dialing",
  summary: "Manage outbound calling lists, launch autonomous AI phone campaigns, or dial prospects directly from your browser using the built-in softphone.",
  sections: [
    {
      id: "overview",
      heading: "Overview of the Call List",
      blocks: [
        p("The Call List is the operational hub for making calls in Voice. It holds the telephone numbers, company details, contact names, and dial queues for your outbound campaigns. You can load contacts from your saved Leads lists, upload spreadsheets directly, or enter single numbers for immediate dialing."),
        p("Every number on the list is validated against UK formatting standards and automatically screened against statutory Telephone Preference Service (TPS) registers before a call can be initiated."),
        {
          type: "callout",
          tone: "info",
          title: "Two Ways to Call",
          text: "You can let the autonomous AI caller dial down the list according to your schedule, or you can click 'Call from browser' to place calls yourself using your computer microphone and headset.",
        },
      ],
    },
    {
      id: "importing-numbers",
      heading: "Importing Contacts into the Call Queue",
      blocks: [
        p("There are three straightforward ways to add phone numbers to your calling queue:"),
        {
          type: "steps",
          items: [
            "Send from Leads: When browsing companies in Leads, select your target accounts, click 'Send to Voice', and choose whether to add them to an existing queue or create a new call campaign.",
            "Upload a Spreadsheet: Click 'Upload CSV or XLSX'. Match your spreadsheet columns to Name, Company, Phone Number, and Optional Notes. Outreach automatically parses UK landlines and mobile numbers into E.164 international format (+44).",
            "Single Number Dial: Click 'Direct Call', enter the phone number and contact name, select your caller ID, and immediately initiate an AI briefing or browser phone call.",
          ],
        },
      ],
    },
    {
      id: "calling-modes",
      heading: "Autonomous AI vs Browser Calling",
      blocks: [
        p("Outreach gives you complete flexibility between full automation and human touch:"),
        {
          type: "table",
          headers: ["Mode", "How It Operates", "Ideal Use Case"],
          rows: [
            ["Autonomous AI Calling", "The AI dials numbers in sequence within your allowed working hours. When answered, it greets the contact, delivers your value pitch, handles objections from its knowledge base, and books a calendar meeting.", "High-volume prospecting, event invitations, customer satisfaction check-ins, and membership renewals."],
            ["Browser Dialing", "A softphone appears right in your browser. Audio streams directly through your computer headset. You see the company profile, balance sheet, and live talking points on screen while you speak.", "High-value enterprise accounts, bespoke partner discussions, or taking over complex negotiations."],
          ],
        },
      ],
    },
    {
      id: "call-controls",
      heading: "Queue Controls & Disposition Management",
      blocks: [
        p("While working through a list, you have full control over the pace and priority:"),
        {
          type: "steps",
          items: [
            "Select All or Subsets: Tick individual contacts or use bulk selection to target specific regions, industries, or company sizes.",
            "Start / Pause Campaign: Click 'Start AI Calling' to activate the automated queue. You can pause the campaign at any moment with one click.",
            "Outcome Dispositions: After each call, the system records the result: Answered, Meeting Booked, Callback Requested, Gatekeeper Refusal, No Answer, or Do-Not-Call Opt-Out.",
            "Automated Recycling: Numbers that ring out or hit busy signals are automatically scheduled for retry later according to your retry rules, preventing wasted opportunities.",
          ],
        },
      ],
    },
    {
      id: "best-practices",
      heading: "Best Practices for Outbound Success",
      blocks: [
        p("To maximize connect rates and ensure professional, compliant conversations:"),
        {
          type: "steps",
          items: [
            "Always verify your caller ID number so prospects see an authentic local or national UK number on their caller display.",
            "Keep daily call pacing reasonable so your numbers maintain clean carrier reputation scores.",
            "Review your AI conversation template before launching to make sure your objection handling sounds natural and concise.",
            "Ensure working hours are configured strictly to standard business hours (09:00 to 17:30 Monday through Friday).",
          ],
        },
      ],
    },
  ],
};
