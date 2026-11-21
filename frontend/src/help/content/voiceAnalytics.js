const p = (text) => ({ type: "paragraph", text });

export const voiceAnalyticsDoc = {
  id: "voice-analytics",
  path: "/help/voice/analytics",
  title: "Call Stats & Analytics",
  summary: "Analyze outbound campaign performance, track connect rates, monitor meeting conversion metrics, and evaluate agent effectiveness.",
  sections: [
    {
      id: "overview",
      heading: "Overview of Call Stats",
      blocks: [
        p("The Call Stats screen provides complete quantitative transparency into your outbound calling campaigns. It aggregates every dialed attempt, connected conversation, voicemail detection, and booked appointment into intuitive visual charts and conversion funnels."),
        p("Use these analytics to identify the best times of day to call, discover which conversation templates generate the highest conversion, and monitor operational team productivity in real time."),
        p("Outbound calling performance is deeply tied to data quality. By examining the statistical relationship between verified contact roles, statutory industry SIC sectors, and call outcomes, outreach teams can continuously refine their audience targeting criteria."),
      ],
    },
    {
      id: "key-metrics",
      heading: "Key Performance Indicators (KPIs)",
      blocks: [
        p("The top dashboard highlights four fundamental metrics updated continuously across all active campaigns:"),
        {
          type: "table",
          headers: ["Metric", "Formula / Meaning", "Target Benchmark"],
          rows: [
            ["Calls Placed", "Total outbound dial attempts initiated across your scheduled campaigns.", "Monitored against daily credit and concurrency allocation."],
            ["Connect Rate", "Percentage of dialed numbers answered by a live human speaker rather than automated IVR or voicemail.", "Healthy commercial B2B benchmark: 22% to 35%."],
            ["Meeting Conversion Rate", "Percentage of connected conversations resulting in a confirmed appointment or callback request.", "Top performing B2B campaigns: 8% to 15%."],
            ["Average Call Duration", "Mean length of live answered conversations across both qualification and objection phases.", "Typical discovery & booking conversations: 2m 30s to 4m 00s."],
          ],
        },
      ],
    },
    {
      id: "disposition-funnel",
      heading: "Disposition Breakdown & Call Funnel",
      blocks: [
        p("Every completed or attempted call is automatically classified into a standardized operational disposition category:"),
        {
          type: "steps",
          items: [
            "Meeting Booked: Prospect committed to an agreed calendar appointment or scheduled callback with your team.",
            "Information Requested: Contact requested detailed corporate brochures, capability statements, or pricing sent to their verified email address.",
            "Gatekeeper Block: Reception or executive assistant declined transfer to the decision-maker or commercial director.",
            "Not Interested / Bad Fit: Contact listened to the value proposition but confirmed no active commercial requirement at this time.",
            "Voicemail Reached: System detected an answering machine and either delivered a configured audio message or disconnected cleanly without consuming unnecessary duration.",
            "TPS / Opt-Out: Prospect asked not to be contacted again; instantly registered in your organization suppression database to enforce strict compliance.",
          ],
        },
      ],
    },
    {
      id: "temporal-analytics",
      heading: "Time-of-Day & Regional Heatmaps",
      blocks: [
        p("Understanding exactly when commercial prospects are receptive to phone outreach is essential for maximizing connect rates and sales momentum:"),
        {
          type: "steps",
          items: [
            "Hourly Connect Heatmaps: Identify peak answering windows for your target industries (commonly 09:30 - 11:30 and 14:00 - 16:00 across UK business sectors).",
            "Day of Week Trends: Compare Tuesday-Thursday peak engagement against Monday morning planning periods and Friday afternoon office wind-downs.",
            "Geographic Response Rates: Analyze performance across specific UK postcode districts (e.g. BN Sussex, London financial districts, and Midlands industrial clusters) to optimize regional caller ID presentation.",
          ],
        },
      ],
    },
    {
      id: "export-and-reporting",
      heading: "Exporting Data & Executive Reporting",
      blocks: [
        p("All operational metrics can be exported seamlessly for executive presentations, business reviews, or CRM synchronization:"),
        {
          type: "steps",
          items: [
            "CSV / Spreadsheet Export: Download complete tabular call records including timestamps, presentation numbers, durations, transcript references, and disposition tags.",
            "CRM Webhook Sync: Automatically push call metrics, notes, and appointment confirmations into external enterprise systems and data lakes.",
            "Scheduled Summary Digests: Configure periodic management digests highlighting top-performing conversation flows and total booked meetings.",
          ],
        },
      ],
    },
  ],
};
