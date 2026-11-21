const p = (text) => ({ type: "paragraph", text });

export const voiceComplianceDoc = {
  id: "voice-compliance",
  path: "/help/voice/compliance",
  title: "TPS & Call Compliance",
  summary: "Ensure full statutory compliance with UK Telephone Preference Service (TPS) regulations, Corporate TPS (CTPS), and GDPR telemarketing rules.",
  sections: [
    {
      id: "overview",
      heading: "Overview of UK Telemarketing Regulations",
      blocks: [
        p("Outbound commercial telephone calls in the United Kingdom are governed by statutory legal frameworks under the Privacy and Electronic Communications Regulations (PECR) and the Information Commissioner's Office (ICO)."),
        p("It is a statutory offense to place unsolicited marketing phone calls to any individual or corporate entity registered on the Telephone Preference Service (TPS) or Corporate TPS (CTPS) registers, unless explicit prior commercial consent exists."),
        {
          type: "callout",
          tone: "warning",
          title: "Regulatory Protection",
          text: "Fines for statutory TPS non-compliance can reach up to £500,000 per violation from the Information Commissioner's Office. Outreach incorporates automated 28-day screening to safeguard your organization.",
        },
      ],
    },
    {
      id: "automated-screening",
      heading: "How 28-Day Automated TPS Screening Works",
      blocks: [
        p("Outreach integrates direct verification pipelines with statutory registers:"),
        {
          type: "steps",
          items: [
            "Real-Time Query: Every telephone number uploaded to a Call List or dialed from the softphone is automatically checked against live TPS and CTPS databases.",
            "Visual Status Badges: Numbers are flagged with clear indicators: Clean (Ready to Call), TPS Protected (Suppressed from Automated Dialing), or Flagged for Review.",
            "28-Day Recertification: Since statutory registrations take effect within 28 days of registration, Outreach automatically re-verifies cached phone numbers every 28 days.",
            "Hard Dialing Blocks: The autonomous AI dialing engine strictly refuses to dial any number with an active TPS or CTPS registration unless a validated corporate consent record is attached.",
          ],
        },
      ],
    },
    {
      id: "tps-vs-ctps",
      heading: "Understanding TPS vs CTPS",
      blocks: [
        p("UK telemarketing law distinguishes between personal and corporate telephone lines:"),
        {
          type: "table",
          headers: ["Register", "Applicable Entity Types", "Legal Rules"],
          rows: [
            ["TPS (Telephone Preference Service)", "Sole traders, partnerships, residential numbers, and personal mobiles.", "Absolute protection against unsolicited marketing calls. No B2B exemptions apply to sole proprietors or partnerships."],
            ["CTPS (Corporate TPS)", "Incorporated companies (Ltd, PLC), LLPs, Scottish partnerships, and government bodies.", "Protected against unsolicited commercial calls. Corporate entities must opt in or exhibit clear legitimate interest."],
          ],
        },
      ],
    },
    {
      id: "do-not-call-lists",
      heading: "Internal Do-Not-Call (DNC) Suppression",
      blocks: [
        p("In addition to national government registers, Outreach maintains your organization's private Do-Not-Call list:"),
        {
          type: "steps",
          items: [
            "Instant Opt-Out: If a prospect states 'Do not call this number again', the AI caller recognizes the intent immediately, terminates the conversation politely, and permanently flags the phone number.",
            "Company-Wide Suppression: When a number is added to your Do-Not-Call list, it is blocked across all campaigns, team members, and future file uploads.",
            "Manual Additions: You can manually add numbers, domains, or company registration numbers to your permanent exclusion list under Find Leads or Voice Settings.",
          ],
        },
      ],
    },
    {
      id: "consent-and-audit-trails",
      heading: "Statutory Audit Trails & Evidentiary Records",
      blocks: [
        p("Under ICO guidelines, the burden of proof rests on the calling organization to demonstrate regulatory compliance:"),
        {
          type: "steps",
          items: [
            "Timestamped Screening Proof: Every call log records the exact date, time, and verification token of the statutory TPS check performed before dialing.",
            "Verbatim Call Recordings: Audio files and transcripts provide clear evidence of customer consent or graceful acknowledgment of opt-out requests.",
            "Audit Certificate Export: Export comprehensive compliance inspection spreadsheets at any time for legal or regulatory review.",
          ],
        },
      ],
    },
  ],
};
