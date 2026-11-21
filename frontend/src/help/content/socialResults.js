const p = (text) => ({ type: "paragraph", text });

export const socialResultsDoc = {
  id: "social-results",
  path: "/help/social/results",
  title: "Results & Social Listening",
  summary: "Track published content engagement metrics, analyze audience reach, monitor industry mentions, and generate strategic content ideas.",
  sections: [
    {
      id: "overview",
      heading: "Overview of Results & Ideas",
      blocks: [
        p("Publishing content is only the first half of a successful social strategy; understanding how your audience responds is what drives long-term commercial growth. The Results & Ideas section in Social brings together post analytics, mention tracking, and AI-driven ideation."),
        p("The section is divided into three focused sub-screens:"),
        {
          type: "table",
          headers: ["Screen", "Primary Purpose", "Key Metrics Tracked"],
          rows: [
            ["Post Results", "Quantitative performance of published social content across all networks.", "Impressions, engagement rates, reactions, comments, reposts, and link clicks."],
            ["Audience & Ideas", "AI-generated content suggestions based on top-performing topics and trending industry queries.", "Content gap analysis, topic resonance scores, and weekly outline recommendations."],
            ["Mentions & Listening", "Real-time feed tracking brand mentions, executive names, and designated industry keywords.", "Brand sentiment, prospective inbound questions, and competitor discussions."],
          ],
        },
      ],
    },
    {
      id: "post-performance",
      heading: "Analyzing Post Performance Metrics",
      blocks: [
        p("Whenever a post publishes, Outreach begins querying official network APIs to track engagement telemetry over its first 30 days:"),
        {
          type: "steps",
          items: [
            "Impressions & Reach: The total number of times your post appeared in member feeds or search streams.",
            "Engagement Rate: The percentage of viewers who interacted with the post (clicks, likes, comments, or reposts) relative to total impressions.",
            "Click-Through Rate (CTR): The proportion of audience members who clicked through on your embedded website links.",
            "Top Performing Leaderboard: Ranks your historical posts by total engagement, making it easy to identify which formats (e.g. carousel infographics vs text threads) perform best.",
          ],
        },
      ],
    },
    {
      id: "audience-and-ideas",
      heading: "Audience Insights & Content Ideation",
      blocks: [
        p("Never run out of strategic topics to post about. The Audience & Ideas engine continuously analyzes your business profile and audience response:"),
        {
          type: "steps",
          items: [
            "Topic Resonance: Highlights which subjects (e.g. 'regulatory compliance updates' vs 'customer success stories') generate the highest comment velocity.",
            "Industry Question Extraction: Identifies common pain points and queries asked by business directors in your target sectors.",
            "One-Click Plan Injection: Click 'Turn Idea into Post' beside any recommended concept to immediately queue it into your calendar with draft captions.",
          ],
        },
      ],
    },
    {
      id: "social-listening",
      heading: "Social Listening & Keyword Monitoring",
      blocks: [
        p("Stay informed whenever key commercial topics or brand terms are discussed publicly:"),
        {
          type: "steps",
          items: [
            "Brand Monitoring: Tracks direct @mentions and public shares of your company name across X and LinkedIn.",
            "Industry Keyword Streams: Set up custom search monitors for strategic industry phrases (e.g. 'UK haulage regulations', 'commercial property tax').",
            "Inbound Opportunity Alerts: Identifies prospective buyers asking for supplier recommendations, flagging them as potential high-intent leads.",
          ],
        },
      ],
    },
    {
      id: "reporting-and-export",
      heading: "Exporting Performance Summaries",
      blocks: [
        p("Share monthly results with marketing executives or clients:"),
        {
          type: "steps",
          items: [
            "Monthly Executive PDF / CSV: Export consolidated performance spreadsheets breaking down monthly audience growth and top-performing posts.",
            "Cross-App Correlation: Compare social engagement spikes against website visits in Leads and inbound call inquiries in Voice.",
          ],
        },
      ],
    },
  ],
};
