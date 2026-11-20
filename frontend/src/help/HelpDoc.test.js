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

  it("Leads contains required sub-pages: Find leads, Lists, Journeys, Mail, Forms", () => {
    const leadsNode = DOCS_TREE.find((n) => n.id === "leads");
    expect(leadsNode).toBeDefined();
    const childIds = leadsNode.children.map((c) => c.id);
    expect(childIds).toEqual([
      "leads-find",
      "leads-lists",
      "leads-journeys",
      "leads-mail",
      "leads-forms",
    ]);
  });

  it("every page is a real designed page with correct headings and callout saying 'This guide is being written.'", () => {
    ALL_DOCS.forEach((doc) => {
      expect(doc.title).toBeTruthy();
      expect(doc.summary).toBeTruthy();
      expect(doc.sections.length).toBeGreaterThan(0);

      // Verify the honest callout
      const hasWritingCallout = doc.sections.some((s) =>
        (s.blocks || []).some(
          (b) => b.type === "callout" && b.text === "This guide is being written."
        )
      );
      expect(
        hasWritingCallout,
        `Doc "${doc.id}" must contain honest callout: "This guide is being written."`
      ).toBe(true);
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

    const calloutResults = searchDocs("being written");
    expect(calloutResults.length).toBeGreaterThan(0);
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
