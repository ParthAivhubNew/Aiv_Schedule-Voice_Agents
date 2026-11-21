const p = (text) => ({ type: "paragraph", text });

export const socialCalendarDoc = {
  id: "social-calendar",
  path: "/help/social/calendar",
  title: "Post Calendar & Scheduling",
  summary: "Plan, visualize, reschedule, and organize your multi-channel social media publishing calendar across weeks and months.",
  sections: [
    {
      id: "overview",
      heading: "Overview of the Post Calendar",
      blocks: [
        p("The Post Calendar is your editorial publishing command center. It presents every scheduled post, draft, approved update, and published update across all connected networks in a clean, interactive calendar interface."),
        p("You can switch between full monthly calendar overviews and detailed weekly agendas to inspect timing, avoid content clustering, and ensure consistent brand presence across all target channels."),
      ],
    },
    {
      id: "calendar-views",
      heading: "Calendar Modes & Navigation",
      blocks: [
        p("The calendar supports multiple viewing perspectives to help you plan with precision:"),
        {
          type: "table",
          headers: ["View Mode", "What It Shows", "Best Use Case"],
          rows: [
            ["Month Grid", "A comprehensive 30-day view showing daily post density and channel badges for every date.", "High-level content planning, campaign milestone mapping, and ensuring no quiet days."],
            ["Week Timeline", "An hourly breakdown across the 7 days of the week, showing exact publication slots and drafts.", "Fine-tuning publishing times, spacing posts throughout the day, and checking daily cadences."],
            ["List View", "A chronological feed of upcoming scheduled content sorted by publication date.", "Quick editorial review of captions and attached imagery across an upcoming campaign batch."],
          ],
        },
      ],
    },
    {
      id: "drag-and-drop",
      heading: "Drag-and-Drop Rescheduling",
      blocks: [
        p("Adjusting your publishing schedule is as simple as dragging cards on screen:"),
        {
          type: "steps",
          items: [
            "Moving Dates: Click and drag any scheduled post to a new date on the calendar. The system automatically recalculates the optimal time slot for that day.",
            "Channel Filters: Use the network toggles at the top of the calendar to focus on specific platforms (e.g. show only LinkedIn posts or only X threads).",
            "Day Drawer: Clicking directly on any date opens the Day Detail panel, revealing every post scheduled for that date with full caption previews and visual thumbnails.",
            "Quick Add: Click the plus (+) icon on any day cell to immediately compose or draft an update for that specific date.",
          ],
        },
      ],
    },
    {
      id: "optimal-timing",
      heading: "Optimal Publishing Times & Cadence Pacing",
      blocks: [
        p("Timing is critical for maximizing social engagement. Social incorporates intelligent publishing slot recommendations:"),
        {
          type: "steps",
          items: [
            "B2B Peak Windows: For professional networks like LinkedIn, Outreach prioritizes morning commute slots (07:45 - 08:45) and midday lunch breaks (12:00 - 13:00).",
            "Consumer Engagement: For networks like Instagram and Facebook, evening engagement windows (17:30 - 19:30) and weekend slots are highlighted.",
            "Anti-Clustering Guards: The system warns you if multiple posts targeting the same channel are scheduled within 90 minutes of each other, preventing audience fatigue.",
          ],
        },
      ],
    },
    {
      id: "status-indicators",
      heading: "Understanding Post Status Indicators",
      blocks: [
        p("Every item on the calendar features a distinct status badge:"),
        {
          type: "table",
          headers: ["Status Badge", "Visual Color", "Meaning & Next Action"],
          rows: [
            ["Draft", "Slate Gray", "Work in progress. Content has been outlined but caption or imagery is still being finalized."],
            ["Waiting Approval", "Amber / Orange", "Complete and ready for review. Requires an internal team member or client sign-off."],
            ["Approved / Scheduled", "Emerald Green", "Fully locked and verified. Will dispatch automatically at the scheduled time."],
            ["Published", "Cobalt Blue", "Successfully published to live social feeds. Performance analytics are now tracking."],
            ["Failed / Alert", "Rose Red", "Network authentication expired or media formatting error. Click to review error details."],
          ],
        },
      ],
    },
  ],
};
