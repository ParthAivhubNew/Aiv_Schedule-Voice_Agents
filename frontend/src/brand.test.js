import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Clients see Outreach, not the companies behind it. Words on client screens must not name
// them. Staff-only screens (admin portal, Connections / AI config) keep real names, and so does
// anything on a line that says "staff". Google Meet, Cal.com and WhatsApp are things a client
// connects or uses themselves, so they are allowed.
const SUPPLIERS = /\b(telnyx|twilio|vonage|plivo|xai|grok|openai|deepgram|cartesia|eleven ?labs|livekit|whisper|llama|jitsi|anthropic|deepseek|mistral|groq|pgvector)\b/i;

const CLIENT_FILES = [
  "settings/PartnerProgram.jsx",
  "settings/PartnerEmbed.jsx",
  "embed/ConnectScreen.jsx",
  "embed/EmbedApp.jsx",
  "embed/bridge.js",
  "embed/theme.js",
  "plugins/voice/AssistantOptions.jsx",
  "plugins/voice/AgentStudio.jsx",
  "plugins/voice/VoicePicker.jsx",
  "plugins/voice/CompanyProfileView.jsx",
  "plugins/voice/ConversationTemplatesView.jsx",
  "plugins/voice/calling/NumbersPage.jsx",
  "plugins/voice/calling/LiveCallCard.jsx",
  "plugins/voice/calling/CallingSchedule.jsx",
  "plugins/voice/calling/WorkingHoursTab.jsx",
  // Phase 7: voice compliance and retention
  "plugins/voice/calling/CallPermissions.jsx",
  "plugins/leadgen/RetentionReview.jsx",
  "plugins/leadgen/MemberList.jsx",
  "plugins/leadgen/DataAccess.jsx",
  "plugins/leadgen/AccessNotice.jsx",
  "plugins/leadgen/accessLogic.js",
  "components/AdminCrown.jsx",
  "brand/BrandContext.jsx",
  "brand/brandLogic.js",
  "brand/brandApi.js",
  "brand/PoweredBy.jsx",
  "brand/StandingChip.jsx",
  "utils/callConsent.js",
  "plugins/voice/calling/CallingWorkspace.jsx",
  "plugins/voice/calling/NumberCheckBar.jsx",
  "plugins/voice/calling/TpsCheckBar.jsx",
  "plugins/leadgen/TpsCheckDialog.jsx",
  "plugins/leadgen/tpsCheck.js",
  "plugins/voice/calling/numberCheck.js",
  "team/NumbersTab.jsx",
  "team/CreditsTab.jsx",
  "team/SubscriptionPage.jsx",
  "plugins/leadgen/CheckCompanies.jsx",
  "plugins/leadgen/CallFlow.jsx",
  "plugins/leadgen/LeadActivity.jsx",
  "plugins/leadgen/FindLeadsView.jsx",
  "plugins/leadgen/ImportMatch.jsx",
  "plugins/leadgen/MonthlyChanges.jsx",
  "plugins/leadgen/importMatchLogic.js",
  "plugins/leadgen/ExportDialog.jsx",
  "plugins/leadgen/ConnectorsView.jsx",
  "plugins/leadgen/ConnectorLogos.jsx",
  // Phase 4: saved searches
  "plugins/leadgen/SavedSearches.jsx",
  "plugins/leadgen/savedSearchLogic.js",
  "plugins/leadgen/inboxes.js",
  "plugins/leadgen/JourneysView.jsx",
  "plugins/leadgen/journeyLogic.js",
  "plugins/leadgen/ConsentDeclaration.jsx",
  "plugins/leadgen/OutreachViews.jsx",
  "plugins/leadgen/IcpEditor.jsx",
  "plugins/leadgen/FitParts.jsx",
  "plugins/leadgen/fitLogic.js",
  "plugins/leadgen/listLogic.js",
  "plugins/leadgen/summaryLogic.js",
  "plugins/leadgen/SummaryParts.jsx",
  "plugins/scheduler/SocialConnect.jsx",
  "plugins/scheduler/SocialResults.jsx",
  "plugins/scheduler/SocialMedia.jsx",
  "plugins/scheduler/SocialPictures.jsx",
  "plugins/scheduler/SocialImport.jsx",
  "plugins/scheduler/SocialReports.jsx",
  "plugins/scheduler/SocialListening.jsx",
  "connections/ConnectionsSettings.jsx",
  "connections/ConnectedHome.jsx",
  // Phase 6 and 7c
  "connections/todayStrip.js",
  "plugins/leadgen/MailView.jsx",
  "plugins/leadgen/mailBulk.js",
  "plugins/leadgen/LiaCard.jsx",
  "plugins/leadgen/liaText.js",
  "hooks/useConnections.js",
  "settings/developerCatalog.js",
  "settings/developerSnippets.js",
  "settings/DeveloperDocs.jsx",
  "hub/SupportHub.jsx",
  "hub/openSupport.js",
  "hub/supportApi.js",
  "hub/SidebarAccountBadge.jsx",
  "help/HelpPage.jsx",
  "help/DocRenderer.jsx",
  "help/content/index.js",
  "help/content/gettingStarted.js",
  "help/content/leads.js",
  "help/content/leadsFind.js",
  "help/content/leadsLists.js",
  "help/content/leadsJourneys.js",
  "help/content/leadsMail.js",
  "help/content/leadsForms.js",
  "help/content/voice.js",
  "help/content/social.js",
  "help/content/workflows.js",
  "help/content/account.js",
  "help/content/troubleshooting.js",
  "plugins/leadgen/admin/AdministrationView.jsx",
  "plugins/leadgen/admin/UserManagement.jsx",
  "plugins/leadgen/admin/RoleManagement.jsx",
  "plugins/leadgen/admin/adminUi.jsx",
  "plugins/leadgen/admin/adminLogic.js",
];

const PAYMENT_SUPPLIERS = /\bstripe\b/i;
const ALLOWED_NAMES = { "plugins/leadgen/ConnectorsView.jsx": /\b(openai|deepseek)\b/gi };

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
      // The owner asked for ChatGPT (OpenAI) and DeepSeek to be named in the Leads Connectors key list (2026-11-23).
      // This exception covers exactly those two names in exactly this file; every other supplier is still refused there.
      const allowed = ALLOWED_NAMES[file];
      const hits = visibleText(source).map(([line, text]) => [line, allowed ? text.replace(allowed, "") : text]).filter(([, text]) => SUPPLIERS.test(text) || PAYMENT_SUPPLIERS.test(text)).map(([line, text]) => `${file}:${line} ${text.trim().slice(0, 80)}`);
      expect(hits).toEqual([]);
    });
  }
});
