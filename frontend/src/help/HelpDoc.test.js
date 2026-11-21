import { describe, expect, it } from "vitest";
import { ALL_DOCS, DOCS_TREE, findDocByPath, searchDocs } from "./content";

describe("Documentation content model & tree structure", () => {
  it("includes all requested documentation sections", () => {
    const ids = DOCS_TREE.map((n) => n.id);
    expect(ids).toContain("getting-started");
    expect(ids).toContain("leads");
    expect(ids).toContain("voice");
    expect(ids).toContain("social");
    expect(ids).toContain("workflows");
    expect(ids).toContain("account");
    expect(ids).toContain("troubleshooting");
  });

  it("Leads contains required sub-pages: Find leads, Lists, Journeys, Mail, Forms, AI Assistant, About your business, Connectors", () => {
    const leadsNode = DOCS_TREE.find((n) => n.id === "leads");
    expect(leadsNode).toBeDefined();
    const childIds = leadsNode.children.map((c) => c.id);
    expect(childIds).toEqual([
      "leads-find",
      "leads-lists",
      "leads-journeys",
      "leads-mail",
      "leads-forms",
      "leads-assistant",
      "leads-business",
      "leads-connectors",
    ]);
  });

  it("Voice, Social, and Workflows contain detailed tab sub-pages", () => {
    const voiceNode = DOCS_TREE.find((n) => n.id === "voice");
    expect(voiceNode).toBeDefined();
    expect(voiceNode.children.map((c) => c.id)).toEqual([
      "voice-calls",
      "voice-conversations",
      "voice-schedule",
      "voice-analytics",
      "voice-studio",
      "voice-compliance",
    ]);

    const socialNode = DOCS_TREE.find((n) => n.id === "social");
    expect(socialNode).toBeDefined();
    expect(socialNode.children.map((c) => c.id)).toEqual([
      "social-calendar",
      "social-approve",
      "social-composer",
      "social-media",
      "social-connect",
      "social-results",
    ]);

    const workflowsNode = DOCS_TREE.find((n) => n.id === "workflows");
    expect(workflowsNode).toBeDefined();
    expect(workflowsNode.children.map((c) => c.id)).toEqual([
      "workflows-builder",
      "workflows-triggers",
      "workflows-activity",
    ]);
  });

  it("every page is real documentation: several sections, enough words, no placeholder text", () => {
    const words = (doc) => JSON.stringify(doc.sections || []).replace(/[{}\[\]":,]/g, " ").split(/\s+/).filter(Boolean).length;
    ALL_DOCS.forEach((doc) => {
      expect(doc.title, doc.id).toBeTruthy();
      expect(doc.summary, doc.id).toBeTruthy();
      expect(doc.sections.length, `${doc.id} needs at least 4 sections`).toBeGreaterThanOrEqual(4);
      expect(words(doc), `${doc.id} is too short`).toBeGreaterThanOrEqual(450);
      expect(JSON.stringify(doc).toLowerCase(), doc.id).not.toContain("being written");
    });
  });

  it("findDocByPath resolves root /help to getting-started", () => {
    expect(findDocByPath("/help").id).toBe("getting-started");
    expect(findDocByPath("help").id).toBe("getting-started");
    expect(findDocByPath("/").id).toBe("getting-started");
  });

  it("findDocByPath resolves deep links", () => {
    expect(findDocByPath("/help/leads").id).toBe("leads");
    expect(findDocByPath("/help/leads/find").id).toBe("leads-find");
    expect(findDocByPath("/help/leads/lists").id).toBe("leads-lists");
    expect(findDocByPath("/help/voice").id).toBe("voice");
    expect(findDocByPath("/help/social").id).toBe("social");
    expect(findDocByPath("/help/workflows").id).toBe("workflows");
    expect(findDocByPath("/help/account").id).toBe("account");
    expect(findDocByPath("/help/troubleshooting").id).toBe("troubleshooting");
  });

  it("searchDocs searches across titles, summaries and section contents", () => {
    const voiceResults = searchDocs("Voice");
    expect(voiceResults.some((r) => r.doc.id === "voice")).toBe(true);

    const workflowsResults = searchDocs("cross-app");
    expect(workflowsResults.some((r) => r.doc.id === "workflows")).toBe(true);

    const exclusionResults = searchDocs("Exclusion list");
    expect(exclusionResults.some((r) => r.doc.id === "leads-find")).toBe(true);
  });

  it("searchDocs returns empty array for empty search queries", () => {
    expect(searchDocs("")).toEqual([]);
    expect(searchDocs("   ")).toEqual([]);
  });
});

describe("the app names used by the sidebar links", () => {
  it("open their own guide, not Getting started", async () => {
    const { findDocByPath } = await import("./content/index.js");
    expect(findDocByPath("/help/leadgen").id).toBe("leads");
    expect(findDocByPath("/help/scheduler").id).toBe("social");
    expect(findDocByPath("/help/voice").id).toBe("voice");
    expect(findDocByPath("/help/leadgen/find").id).toBe("leads-find");
  });
});

describe("guide paths in the text become links", () => {
  it("turns /help paths into anchors and leaves other text alone", async () => {
    const { linkify } = await import("./DocRenderer.jsx");
    expect(linkify("No links here")).toBe("No links here");
    const out = linkify("See the guide (/help/leads/find) first.");
    expect(Array.isArray(out)).toBe(true);
    expect(out.find((n) => typeof n === "object").props.href).toBe("/help/leads/find");
  });
});
