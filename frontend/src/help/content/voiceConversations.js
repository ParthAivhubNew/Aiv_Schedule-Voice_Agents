const p = (text) => ({ type: "paragraph", text });

export const voiceConversationsDoc = {
  id: "voice-conversations",
  path: "/help/voice/conversations",
  title: "Conversations & Live Monitoring",
  summary: "Monitor active phone calls in real time, take over conversations from the AI, listen to recordings, review verbatim transcripts, and view WhatsApp chats.",
  sections: [
    {
      id: "overview",
      heading: "The Conversations Screen",
      blocks: [
        p("The Conversations screen is your live audio and transcript command center. It gives you full visibility into what your AI agents and team are saying on the phone. On the left side, you can browse through historical call logs with audio recordings and summaries. On the right side, active live calls stream in real time."),
        p("Every phone call handled by Outreach produces an instant verbatim transcript, an executive summary, sentiment scores, and an automated disposition record."),
      ],
    },
    {
      id: "live-call-monitoring",
      heading: "Real-Time Live Call Monitoring",
      blocks: [
        p("When an autonomous AI agent is speaking with a prospect, a live call card appears on your screen with real-time telemetry:"),
        {
          type: "steps",
          items: [
            "Live Waveforms: Visual audio waveforms illustrate speech cadence, pauses, and turn-taking between the caller and the prospect.",
            "Streaming Transcript: You see words appearing on your screen in real time as the conversation unfolds.",
            "Intent Detection: The system highlights key customer intents as they happen (e.g. pricing inquiries, technical objections, or scheduling agreement).",
            "Latency & Quality Metrics: Displays live round-trip network latency, packet stability, and carrier audio fidelity.",
          ],
        },
      ],
    },
    {
      id: "human-takeover",
      heading: "Human Takeover (Barge-in)",
      blocks: [
        p("If an enterprise prospect asks a complex bespoke question or requests to speak to a senior human specialist, you can take over the call instantly:"),
        {
          type: "steps",
          items: [
            "Click the 'Take Over Call' button on the active call card.",
            "Your browser softphone connects seamlessly to the live telephony channel within 200 milliseconds.",
            "The AI agent gracefully yields speech with a natural polite handover (e.g. 'Let me bring my senior colleague in right now').",
            "You continue the conversation directly through your computer headset with zero call drops or audio interruptions.",
            "After you finish, the entire conversation—both the AI portion and your human portion—is saved into a single unified transcript and audio file.",
          ],
        },
        {
          type: "callout",
          tone: "tip",
          title: "Seamless Handover",
          text: "The prospect remains on the same phone call throughout. There is no transfer tone, hold music, or disconnect risk.",
        },
      ],
    },
    {
      id: "historical-call-logs",
      heading: "Call History, Recordings & Transcripts",
      blocks: [
        p("Every completed call is archived with complete evidentiary records:"),
        {
          type: "table",
          headers: ["Record Item", "Details Included", "Export / Action"],
          rows: [
            ["Audio Recording", "Full dual-channel stereo recording with separate audio tracks for agent and customer.", "Play in browser, jump to key moments, or download MP3."],
            ["Verbatim Transcript", "Timestamped speaker diarization with millisecond accuracy.", "Copy text, search keywords, or export to CRM."],
            ["Executive Summary", "3-sentence bulleted summary highlighting customer situation, needs, and next steps.", "Included in email notifications and CRM notes."],
            ["Action Items", "Specific commitments made during the call (e.g. 'Send brochure by Friday').", "Synced to task queues and calendar reminders."],
          ],
        },
      ],
    },
    {
      id: "whatsapp-integration",
      heading: "WhatsApp Follow-Ups & Messaging",
      blocks: [
        p("When enabled on your account, Voice integrates seamlessly with official WhatsApp messaging:"),
        {
          type: "steps",
          items: [
            "Post-Call Confirmations: Automatically dispatch meeting confirmation links and calendar invites to mobile prospects over WhatsApp.",
            "Two-Way Chat View: View and reply to incoming WhatsApp replies directly inside the Conversations tab alongside phone call records.",
            "Regulatory Compliance: Messages are sent using approved business templates that comply fully with messaging opt-in rules.",
          ],
        },
      ],
    },
  ],
};
