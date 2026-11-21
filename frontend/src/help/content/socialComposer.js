const p = (text) => ({ type: "paragraph", text });

export const socialComposerDoc = {
  id: "social-composer",
  path: "/help/social/composer",
  title: "AI Post Writer & Themes",
  summary: "Generate high-converting social media copy tailored to specific networks, establish company brand voice, and craft engaging hooks.",
  sections: [
    {
      id: "overview",
      heading: "Overview of the AI Post Writer",
      blocks: [
        p("Writing engaging, original social media updates every week across six different networks can consume hours of manual copywriting time. The AI Post Writer automates this process by transforming simple ideas, company news, and industry topics into polished social posts."),
        p("Rather than writing generic one-size-fits-all text, Outreach tailors character length, line breaks, tone, and call-to-actions specifically for each social network's unique audience culture."),
      ],
    },
    {
      id: "channel-adaptation",
      heading: "Platform-Specific Copywriting Rules",
      blocks: [
        p("The AI dynamically adapts writing styles across supported platforms:"),
        {
          type: "table",
          headers: ["Platform", "Formatting & Length", "Tone & Style"],
          rows: [
            ["LinkedIn", "Medium-to-long format with clean spacing, strong opening hooks, bulleted insights, and professional closing questions.", "Executive thought leadership, industry commentary, B2B case studies, and company culture."],
            ["X (Twitter)", "Concise (under 280 characters) or structured multi-tweet threads with punchy, high-impact phrasing.", "Timely news commentary, bold observations, direct engagement prompts, and concise statistics."],
            ["Facebook", "Conversational storytelling with community-centric phrasing, customer testimonials, and clear link invitations.", "Warm, accessible, community-focused, and friendly commercial updates."],
            ["Instagram", "Visual-first narrative captions with rich descriptive phrasing, spacing dots, and 3 to 5 targeted hashtags.", "Brand lifestyle, behind-the-scenes glimpses, visual highlights, and creative showcases."],
            ["Threads", "Conversational micro-blogging focusing on genuine dialogue and casual observations.", "Spontaneous, authentic, and discussion-provoking."],
            ["Reddit", "Long-form informative discussion posts devoid of obvious marketing jargon, strictly respecting subreddit etiquette.", "Value-first insights, technical deep dives, and genuine community participation."],
          ],
        },
      ],
    },
    {
      id: "ai-assistant-prompting",
      heading: "Prompting the AI Assistant in Chat",
      blocks: [
        p("You can generate entire multi-week publishing plans simply by talking to the AI Assistant:"),
        {
          type: "steps",
          items: [
            "Open the AI Assistant tab inside Social.",
            "Describe your campaign goal: 'Plan 8 posts for next month highlighting our new logistics compliance software for UK freight operators.'",
            "Review the Proposed Outline: The AI generates a structured table listing proposed dates, target channels, themes, and hooks.",
            "Refine or Adjust: Ask the AI to tweak specific dates or swap topics (e.g. 'Make post 3 focus on fuel duty savings instead').",
            "Confirm the Outline: Click 'Confirm & Generate Posts'. The AI immediately writes the complete captions and queues appropriate graphic imagery.",
          ],
        },
      ],
    },
    {
      id: "one-click-refinements",
      heading: "One-Click Editorial Polish Tools",
      blocks: [
        p("When reviewing any draft caption in the composer, you have dedicated one-click AI refinement shortcuts:"),
        {
          type: "steps",
          items: [
            "Make It Punchier: Rewrites the first line to grab attention and strips out passive filler words.",
            "Shorten: Reduces caption length by approximately 50% while preserving the core message and call-to-action.",
            "Add Hashtags: Analyzes the text and appends 3 to 5 trending, highly relevant industry tags.",
            "Rewrite for Channel: Instantly reformats a caption written for LinkedIn into an optimized post for X or Facebook.",
          ],
        },
      ],
    },
    {
      id: "brand-theme-setup",
      heading: "Configuring Brand Themes & Tone",
      blocks: [
        p("Under the Theme tab in Social, you configure your core brand profile:"),
        {
          type: "steps",
          items: [
            "Company Pitch & Offerings: Describe what your business sells and your ideal customer profile.",
            "Tone of Voice: Choose your signature brand persona: Professional & Authoritative, Consultative & Helpful, or Bold & Energetic.",
            "Corporate Colors & Logo: Upload your brand mark and primary hex colors, which are automatically applied when the visual generator creates graphics.",
          ],
        },
      ],
    },
  ],
};
