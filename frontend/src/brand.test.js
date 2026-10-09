import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Clients see Outreach, not the companies behind it. Words on client screens must not name
// them. Staff-only screens (admin portal, Connections / AI config) keep real names, and so does
// anything on a line that says "staff". Google Meet, Cal.com and WhatsApp are things a client
// connects or uses themselves, so they are allowed.
const SUPPLIERS = /\b(telnyx|twilio|vonage|plivo|xai|grok|openai|deepgram|cartesia|eleven ?labs|livekit|whisper|llama|jitsi|anthropic|deepseek|mistral|groq|pgvector)\b/i;

const CLIENT_FILES = [
  "plugins/voice/AssistantOptions.jsx",
  "plugins/voice/AgentStudio.jsx",
  "plugins/voice/VoicePicker.jsx",
  "plugins/voice/CompanyProfileView.jsx",
  "plugins/voice/ConversationTemplatesView.jsx",
  "plugins/voice/calling/NumbersPage.jsx",
  "plugins/voice/calling/LiveCallCard.jsx",
  "plugins/voice/calling/CallingSchedule.jsx",
  "plugins/voice/calling/WorkingHoursTab.jsx",
  "plugins/voice/calling/CallingWorkspace.jsx",
  "plugins/voice/calling/NumberCheckBar.jsx",
  "plugins/voice/calling/numberCheck.js",
  "team/NumbersTab.jsx",
  "plugins/leadgen/CheckCompanies.jsx",
];

// Words a person can read: string literals that contain a space, and text between JSX tags.
function visibleText(source) {
  const noComments = source.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/(^|\s)\/\/.*$/, "$1"));
  const found = [];
  noComments.forEach((rawLine, i) => {
    let line = rawLine;
    if (/staff/i.test(rawLine)) return;
    line = line.replace(/value="[^"]*"/g, ""); // stored values are not shown
    for (const m of line.matchAll(/(["'`])((?:\\.|(?!\1).)*)\1/g)) if (/\s/.test(m[2])) found.push([i + 1, m[2]]);
    for (const m of line.matchAll(/>([^<>{}]+)</g)) found.push([i + 1, m[1]]);
  });
  return found;
}

describe("client screens do not name the platform's suppliers", () => {
  for (const file of CLIENT_FILES) {
    it(file, () => {
      const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
      const hits = visibleText(source).filter(([, text]) => SUPPLIERS.test(text)).map(([line, text]) => `${file}:${line} ${text.trim().slice(0, 80)}`);
      expect(hits).toEqual([]);
    });
  }
});
