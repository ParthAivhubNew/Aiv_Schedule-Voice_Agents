const p = (text) => ({ type: "paragraph", text });

export const socialConnectDoc = {
  id: "social-connect",
  path: "/help/social/connect",
  title: "Social Accounts & Channels",
  summary: "Connect social media networks via official OAuth, manage publisher permissions, configure test publishing mode, and set up UTM tracking.",
  sections: [
    {
      id: "overview",
      heading: "Overview of Account Connections",
      blocks: [
        p("To publish updates automatically, you must connect your public social channels to Outreach. The Accounts screen manages OAuth credentials, token refresh cycles, and connection status for every supported network."),
        p("Outreach integrates directly with official platform APIs using secure OAuth 2.0 authorization. You never share your social media passwords with Outreach; access can be revoked at any time from your platform settings."),
      ],
    },
    {
      id: "supported-networks",
      heading: "Supported Social Networks & Account Types",
      blocks: [
        p("You can connect both corporate brand pages and individual executive profiles:"),
        {
          type: "table",
          headers: ["Network", "Supported Account Types", "Authentication Protocol"],
          rows: [
            ["LinkedIn", "Company Pages and Personal Executive Profiles.", "Official LinkedIn OAuth 2.0 with w_member_social and w_organization_social scopes."],
            ["X (Twitter)", "Brand Accounts and Personal Handles.", "X OAuth 2.0 User Context with tweet.read, tweet.write, and users.read scopes."],
            ["Facebook", "Verified Business Pages.", "Meta Graph API with pages_manage_posts and pages_read_engagement permissions."],
            ["Instagram", "Professional / Business Accounts linked to a Facebook Page.", "Instagram Graph API with instagram_content_publish permissions."],
            ["Threads", "Threads Profiles linked to verified Instagram accounts.", "Meta Threads API."],
            ["Reddit", "User Accounts and Subreddit moderators.", "Reddit OAuth with submit and identity scopes."],
          ],
        },
      ],
    },
    {
      id: "connection-steps",
      heading: "How to Connect a Social Channel",
      blocks: [
        p("Connecting a channel takes less than 30 seconds:"),
        {
          type: "steps",
          items: [
            "Open the 'Accounts' tab inside Social.",
            "Find the target network card (e.g. LinkedIn) and click 'Connect Account'.",
            "A secure pop-up window directs you to the network's official sign-in page.",
            "Log in and click 'Authorize Outreach' to grant publishing permissions.",
            "The pop-up closes automatically, and the card updates to green 'Connected' displaying your handle or page name.",
          ],
        },
        {
          type: "callout",
          tone: "tip",
          title: "Multi-Account Connections",
          text: "You can connect both your corporate Company Page and individual executive profiles (e.g. CEO or Founder profile) simultaneously to publish company updates alongside personal thought leadership.",
        },
      ],
    },
    {
      id: "test-mode",
      heading: "Test Mode: Rehearsing Without Live Publishing",
      blocks: [
        p("If you are setting up Social for the first time and want to verify the entire pipeline without broadcasting to your live followers:"),
        {
          type: "steps",
          items: [
            "Toggle 'Test Mode' to ON at the top of the Accounts screen.",
            "While Test Mode is active, posts move through the full lifecycle: draft, approval, and scheduled execution.",
            "When a post's publishing time arrives, the system simulates publication, validates payload formatting, and logs success—without sending data to live feeds.",
            "Once you are confident in your content templates, toggle Test Mode to OFF to enable real-world broadcasting.",
          ],
        },
      ],
    },
    {
      id: "utm-and-link-tracking",
      heading: "Automated UTM Link Tracking",
      blocks: [
        p("Measuring website traffic generated from social updates is essential for ROI attribution:"),
        {
          type: "steps",
          items: [
            "Enable Link Tracking: Switch on 'Automatic UTM Tagging' under Accounts settings.",
            "Standard Parameter Injection: Whenever you include a link to your website in a caption, Outreach automatically appends standard Google Analytics parameters: utm_source (e.g. linkedin), utm_medium (social), and utm_campaign (your campaign theme).",
            "Clean Short Links: Links are automatically shortened using your custom domain or Outreach shortener to save character space.",
          ],
        },
      ],
    },
  ],
};
