import { gettingStartedDoc } from "./gettingStarted";
import { leadsDoc } from "./leads";
import { leadsFindDoc } from "./leadsFind";
import { leadsListsDoc } from "./leadsLists";
import { leadsJourneysDoc } from "./leadsJourneys";
import { leadsMailDoc } from "./leadsMail";
import { leadsFormsDoc } from "./leadsForms";
import { voiceDoc } from "./voice";
import { socialDoc } from "./social";
import { workflowsDoc } from "./workflows";
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
    ],
  },
  {
    id: "voice",
    label: "Voice",
    doc: voiceDoc,
  },
  {
    id: "social",
    label: "Social",
    doc: socialDoc,
  },
  {
    id: "workflows",
    label: "Workflows",
    doc: workflowsDoc,
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
  voiceDoc,
  socialDoc,
  workflowsDoc,
  accountDoc,
  troubleshootingDoc,
];

export function findDocByPath(path) {
  const clean = String(path || "").toLowerCase().replace(/\/+$/, "");
  if (!clean || clean === "/help" || clean === "help") {
    return gettingStartedDoc;
  }
  // The apps are called leadgen and scheduler inside the software; their guides are leads and social.
  const segment = clean.replace(/^\/?(help\/?)?/, "").replace(/^leadgen(?=\/|$)/, "leads").replace(/^scheduler(?=\/|$)/, "social");
  const match = ALL_DOCS.find((d) => {
    const docSegment = d.id;
    return (
      docSegment === segment ||
      d.path.toLowerCase() === clean ||
      clean.endsWith(`/${docSegment}`) ||
      (segment === "leads/find" && d.id === "leads-find") ||
      (segment === "leads/lists" && d.id === "leads-lists") ||
      (segment === "leads/journeys" && d.id === "leads-journeys") ||
      (segment === "leads/mail" && d.id === "leads-mail") ||
      (segment === "leads/forms" && d.id === "leads-forms")
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
