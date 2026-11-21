import { gettingStartedDoc } from "./gettingStarted";
import { leadsDoc } from "./leads";
import { leadsFindDoc } from "./leadsFind";
import { leadsListsDoc } from "./leadsLists";
import { leadsJourneysDoc } from "./leadsJourneys";
import { leadsMailDoc } from "./leadsMail";
import { leadsFormsDoc } from "./leadsForms";
import { leadsAssistantDoc } from "./leadsAssistant";
import { leadsBusinessDoc } from "./leadsBusiness";
import { leadsConnectorsDoc } from "./leadsConnectors";
import { voiceDoc } from "./voice";
import { voiceCallsDoc } from "./voiceCalls";
import { voiceConversationsDoc } from "./voiceConversations";
import { voiceScheduleDoc } from "./voiceSchedule";
import { voiceAnalyticsDoc } from "./voiceAnalytics";
import { voiceStudioDoc } from "./voiceStudio";
import { voiceComplianceDoc } from "./voiceCompliance";
import { socialDoc } from "./social";
import { socialCalendarDoc } from "./socialCalendar";
import { socialApproveDoc } from "./socialApprove";
import { socialComposerDoc } from "./socialComposer";
import { socialMediaDoc } from "./socialMedia";
import { socialConnectDoc } from "./socialConnect";
import { socialResultsDoc } from "./socialResults";
import { workflowsDoc } from "./workflows";
import { workflowsBuilderDoc } from "./workflowsBuilder";
import { workflowsTriggersDoc } from "./workflowsTriggers";
import { workflowsActivityDoc } from "./workflowsActivity";
import { accountDoc } from "./account";
import { troubleshootingDoc } from "./troubleshooting";

export const DOCS_TREE = [
  {
    id: "getting-started",
    label: "Getting started",
    doc: gettingStartedDoc,
  },
  {
    id: "leads",
    label: "Leads",
    doc: leadsDoc,
    children: [
      { id: "leads-find", label: "Find leads", doc: leadsFindDoc },
      { id: "leads-lists", label: "Lists", doc: leadsListsDoc },
      { id: "leads-journeys", label: "Journeys", doc: leadsJourneysDoc },
      { id: "leads-mail", label: "Mail", doc: leadsMailDoc },
      { id: "leads-forms", label: "Forms", doc: leadsFormsDoc },
      { id: "leads-assistant", label: "AI Assistant", doc: leadsAssistantDoc },
      { id: "leads-business", label: "About your business", doc: leadsBusinessDoc },
      { id: "leads-connectors", label: "Connectors & data sources", doc: leadsConnectorsDoc },
    ],
  },
  {
    id: "voice",
    label: "Voice",
    doc: voiceDoc,
    children: [
      { id: "voice-calls", label: "Call list & softphone", doc: voiceCallsDoc },
      { id: "voice-conversations", label: "Conversations & monitoring", doc: voiceConversationsDoc },
      { id: "voice-schedule", label: "Meetings & callbacks", doc: voiceScheduleDoc },
      { id: "voice-analytics", label: "Call stats", doc: voiceAnalyticsDoc },
      { id: "voice-studio", label: "AI Caller & studio", doc: voiceStudioDoc },
      { id: "voice-compliance", label: "TPS & call compliance", doc: voiceComplianceDoc },
    ],
  },
  {
    id: "social",
    label: "Social",
    doc: socialDoc,
    children: [
      { id: "social-calendar", label: "Post calendar", doc: socialCalendarDoc },
      { id: "social-approve", label: "Post approve", doc: socialApproveDoc },
      { id: "social-composer", label: "AI post writer & themes", doc: socialComposerDoc },
      { id: "social-media", label: "Pictures & library", doc: socialMediaDoc },
      { id: "social-connect", label: "Social accounts", doc: socialConnectDoc },
      { id: "social-results", label: "Results & ideas", doc: socialResultsDoc },
    ],
  },
  {
    id: "workflows",
    label: "Workflows",
    doc: workflowsDoc,
    children: [
      { id: "workflows-builder", label: "Workflow builder", doc: workflowsBuilderDoc },
      { id: "workflows-triggers", label: "Triggers & actions", doc: workflowsTriggersDoc },
      { id: "workflows-activity", label: "Activity & run history", doc: workflowsActivityDoc },
    ],
  },
  {
    id: "account",
    label: "Account and billing",
    doc: accountDoc,
  },
  {
    id: "troubleshooting",
    label: "Troubleshooting",
    doc: troubleshootingDoc,
  },
];

// Flat map of all docs by id and alias paths
export const ALL_DOCS = [
  gettingStartedDoc,
  leadsDoc,
  leadsFindDoc,
  leadsListsDoc,
  leadsJourneysDoc,
  leadsMailDoc,
  leadsFormsDoc,
  leadsAssistantDoc,
  leadsBusinessDoc,
  leadsConnectorsDoc,
  voiceDoc,
  voiceCallsDoc,
  voiceConversationsDoc,
  voiceScheduleDoc,
  voiceAnalyticsDoc,
  voiceStudioDoc,
  voiceComplianceDoc,
  socialDoc,
  socialCalendarDoc,
  socialApproveDoc,
  socialComposerDoc,
  socialMediaDoc,
  socialConnectDoc,
  socialResultsDoc,
  workflowsDoc,
  workflowsBuilderDoc,
  workflowsTriggersDoc,
  workflowsActivityDoc,
  accountDoc,
  troubleshootingDoc,
];

export function findDocByPath(path) {
  const clean = String(path || "").toLowerCase().replace(/\/+$/, "");
  if (!clean || clean === "/help" || clean === "help") {
    return gettingStartedDoc;
  }
  // The apps are called leadgen and scheduler inside the software; their guides are leads and social.
  const segment = clean
    .replace(/^\/?(help\/?)?/, "")
    .replace(/^leadgen(?=\/|$)/, "leads")
    .replace(/^scheduler(?=\/|$)/, "social");
  const dashSegment = segment.replace(/\//g, "-");

  const match = ALL_DOCS.find((d) => {
    const docSegment = d.id;
    return (
      docSegment === segment ||
      docSegment === dashSegment ||
      d.path.toLowerCase() === clean ||
      clean.endsWith(`/${docSegment}`) ||
      clean.endsWith(`/${docSegment.replace(/-/g, "/")}`)
    );
  });
  return match || gettingStartedDoc;
}

export function searchDocs(query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return [];
  const results = [];
  ALL_DOCS.forEach((doc) => {
    let matchScore = 0;
    const titleMatch = doc.title.toLowerCase().includes(q);
    const summaryMatch = doc.summary.toLowerCase().includes(q);
    const matchingSections = (doc.sections || []).filter((s) => {
      const headingMatch = s.heading.toLowerCase().includes(q);
      const textMatch = (s.blocks || []).some((b) => {
        if (b.type === "paragraph" && b.text?.toLowerCase().includes(q)) return true;
        if (b.type === "callout" && b.text?.toLowerCase().includes(q)) return true;
        if (b.type === "steps" && b.items?.some((it) => it.toLowerCase().includes(q))) return true;
        return false;
      });
      return headingMatch || textMatch;
    });

    if (titleMatch || summaryMatch || matchingSections.length > 0) {
      if (titleMatch) matchScore += 10;
      if (summaryMatch) matchScore += 5;
      matchScore += matchingSections.length * 2;
      results.push({ doc, matchingSections, matchScore });
    }
  });

  return results.sort((a, b) => b.matchScore - a.matchScore);
}
