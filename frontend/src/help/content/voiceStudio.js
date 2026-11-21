const p = (text) => ({ type: "paragraph", text });

export const voiceStudioDoc = {
  id: "voice-studio",
  path: "/help/voice/studio",
  title: "AI Caller & Studio",
  summary: "Design conversational phone scripts, select natural neural voices, configure objection handling logic, and fine-tune AI speech dynamics.",
  sections: [
    {
      id: "overview",
      heading: "Overview of the AI Studio",
      blocks: [
        p("The AI Studio gives you complete creative and architectural control over how your autonomous AI caller sounds and behaves. It combines a natural voice selector with a flexible conversation template builder."),
        p("Rather than rigid pre-recorded interactive voice trees, Outreach uses real-time conversational intelligence. The AI listens, understands nuanced natural language, responds with human-like warmth, and guides the conversation purposefully toward a commercial qualification outcome."),
      ],
    },
    {
      id: "voice-selection",
      heading: "Selecting & Tuning Neural Voices",
      blocks: [
        p("Outreach provides a curated library of high-definition neural voices tailored for executive British business communication:"),
        {
          type: "steps",
          items: [
            "Voice Persona Selection: Choose between authoritative executive tones, friendly consultative advisors, and energetic outreach representatives across male and female vocal profiles.",
            "Sample Audio Audition: Click 'Hear this voice' to listen to realistic audio previews with corporate terminology.",
            "Speech Speed & Inflection: Fine-tune the speaking rate (0.85x to 1.15x) to match your industry's conversational cadence.",
            "Conversational Warmth: Adjust temperature parameters to allow natural pauses, breathing rhythms, and conversational acknowledgments (e.g. 'I understand', 'Certainly').",
            "Call My Phone Test: Enter your private phone number and click 'Call my phone' to experience an interactive live rehearsal before deploying to prospects.",
          ],
        },
      ],
    },
    {
      id: "script-architecture",
      heading: "Conversation Script Structure",
      blocks: [
        p("A high-converting B2B phone script follows four structured conversational phases:"),
        {
          type: "table",
          headers: ["Phase", "Purpose", "Example Architecture"],
          rows: [
            ["1. Opening Hook", "Confirms the contact identity politely and introduces your organization with brevity.", "'Hello Jane, this is Sam calling from Outreach. I see you are the managing director at Acme Ltd...'"],
            ["2. Value Proposition", "States the clear commercial problem you solve for businesses in their specific trade or sector.", "'We help regional logistics providers streamline automated route compliance and cut administrative overhead.'"],
            ["3. Qualification Check", "Asks a focused qualifying question to gauge current interest and verify business fit.", "'Are you currently reviewing your compliance systems heading into the new quarter?'"],
            ["4. Booking Call-to-Action", "Secures a non-binding introductory appointment with an executive specialist.", "'I'd love to set up a quick 15-minute briefing with our technical director next Tuesday. Would morning or afternoon suit you better?'"],
          ],
        },
      ],
    },
    {
      id: "objection-handling",
      heading: "Handling Objections & Complex Queries",
      blocks: [
        p("Prospective clients often raise questions before committing to a meeting. The AI handles common objections gracefully:"),
        {
          type: "steps",
          items: [
            "'We already have a supplier': Acknowledges the relationship and focuses on benchmarking without demanding immediate switching.",
            "'Send me an email first': Validates their email address on file and pairs the email with an invitation to review the materials together.",
            "'I'm too busy right now': Immediately asks for an optimal callback window and schedules the task without pushing aggressively.",
            "'How much does it cost?': Outlines standard tiering while explaining that exact pricing depends on team scale, proposing a discovery briefing.",
          ],
        },
      ],
    },
    {
      id: "dynamic-variables",
      heading: "Dynamic Variable Interpolation",
      blocks: [
        p("Make every outbound call deeply personalized using dynamic variables automatically populated from Leads and Companies House registries:"),
        {
          type: "table",
          headers: ["Variable Tag", "Extracted Value", "Example Spoken Text"],
          rows: [
            ["{{company_name}}", "Registered business name", "'Calling regarding your team at Apex Solutions.'"],
            ["{{director_name}}", "Active statutory officer", "'May I speak with Sarah?'"],
            ["{{town}} / {{postcode}}", "Registered geographic locality", "'As an established business in Brighton...'"],
            ["{{sic_description}}", "Primary filed commercial activity", "'Given your expertise in commercial freight transport...'"],
          ],
        },
      ],
    },
  ],
};
