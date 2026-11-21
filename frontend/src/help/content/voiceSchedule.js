const p = (text) => ({ type: "paragraph", text });

export const voiceScheduleDoc = {
  id: "voice-schedule",
  path: "/help/voice/schedule",
  title: "Meetings & Callbacks",
  summary: "Manage scheduled prospect callbacks, review meetings booked by the AI caller, configure calendar integrations, and enforce business hours.",
  sections: [
    {
      id: "overview",
      heading: "Overview of Meetings & Callbacks",
      blocks: [
        p("The Meetings & Callbacks screen handles the operational output of your phone campaigns. Whenever an AI caller or browser agent agrees on a meeting or promises a callback, the appointment is scheduled here. It prevents double-bookings, paces outbound retries, and coordinates team calendar availability."),
        p("The screen features both a unified calendar view (day, week, and month) and a structured queue view for upcoming tasks."),
      ],
    },
    {
      id: "booked-meetings",
      heading: "Booked Meetings & Calendar Synchronization",
      blocks: [
        p("When a prospect agrees to speak with your executive team during a phone call, the AI books the meeting directly:"),
        {
          type: "steps",
          items: [
            "Live Availability Check: The AI checks your real-time connected calendar slots so it never proposes a time you are busy.",
            "Meeting Type Selection: Supports phone appointments, video meetings (with automatic meeting link generation), or in-person visits.",
            "Calendar Invite Dispatch: Automatically sends an .ics calendar invite and email confirmation to both the prospect and your assigned team representative.",
            "Meeting Notes & Dossier: Attaches the company's statutory filing profile, verified decision-maker names, and the call recording summary directly to the calendar invitation.",
          ],
        },
        {
          type: "callout",
          tone: "tip",
          title: "Calendar Integrations",
          text: "Voice supports two-way synchronization with Cal.com, Google Calendar, and Microsoft Outlook. Connect your calendar under Settings to enable live slot booking.",
        },
      ],
    },
    {
      id: "managing-callbacks",
      heading: "Automated Callback Queuing & Pacing",
      blocks: [
        p("Often a busy business owner or director cannot speak immediately and asks the agent to call back later. Voice handles callbacks intelligently:"),
        {
          type: "table",
          headers: ["Callback Type", "How Voice Schedules It", "Trigger Window"],
          rows: [
            ["Specific Date & Time", "Prospect says 'Call me next Tuesday at 2pm'. The AI extracts the exact datetime and creates a high-priority calendar slot.", "Wakes up within 2 minutes of the promised slot."],
            ["General Delay", "Prospect says 'Try me again in a couple of days'. Voice schedules the retry 48 hours later within allowed working hours.", "Queued automatically for standard calling hours."],
            ["Gatekeeper Reschedule", "Secretary says 'The director is in a board meeting until lunchtime'. Voice queues a callback for 13:30.", "Dispatched in early afternoon."],
            ["Unanswered / Busy", "Phone rings out or returns user busy tone. System applies your campaign retry policy.", "Paced across 3 separate days at different hours."],
          ],
        },
      ],
    },
    {
      id: "rescheduling-and-modifications",
      heading: "Modifying & Cancelling Appointments",
      blocks: [
        p("You can adjust scheduled items at any time:"),
        {
          type: "steps",
          items: [
            "Reschedule: Open the meeting card, select a new time slot, and click 'Update Meeting'. An updated calendar invite is dispatched immediately.",
            "Reassign Representative: Reallocate the meeting to another team member without changing the agreed appointment time.",
            "Cancel & Notify: If a prospect notifies you of a cancellation, click 'Cancel'. You can choose whether to dispatch a courteous cancellation note automatically.",
          ],
        },
      ],
    },
    {
      id: "working-hours-and-guards",
      heading: "Working Hours & Calling Guardrails",
      blocks: [
        p("To maintain strict professional standards and respect prospect time, Voice enforces rigid guardrails:"),
        {
          type: "steps",
          items: [
            "Strict Business Hours: Outbound automated calls are restricted by default to Monday through Friday, 09:00 to 17:30 UK time.",
            "Timezone Protection: The system checks the geographic location and postcode of the recipient before initiating dial routines.",
            "Bank Holiday Suspension: Automated campaigns automatically pause on official UK bank holidays and resume on the next working business day.",
          ],
        },
      ],
    },
  ],
};
