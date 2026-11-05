import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChoiceCard, CustomizeBanner, FeedbackBar, ViewCard } from "./AssistantCards";

describe("the assistant's cards draw", () => {
  it("shows the draft card with its filters and count, and never a list of rows", () => {
    const html = renderToStaticMarkup(<ViewCard view={{ kind: "companies", title: "Companies view", summary: "Sector: chemicals · Town: Surat", filter_count: 2, total: 3162, asked: 200, capped: false, screen: "find_leads" }} onOpen={() => {}} />);
    expect(html).toContain("Companies view");
    expect(html).toContain("Draft");
    expect(html).toContain("2 filters");
    expect(html).toContain("200 of 3.2K");
    expect(html).toContain("Sector: chemicals");
    expect(html).not.toContain("<table");
  });

  it("leaves out the filter chip when there are none", () => {
    const html = renderToStaticMarkup(<ViewCard view={{ kind: "posts", title: "Posts view", summary: "", filter_count: 0, total: 6, screen: "#/scheduler/plan" }} onOpen={() => {}} />);
    expect(html).toContain("Posts view");
    expect(html).not.toContain("filter");
  });

  it("lists the pick-one options with the recommended one tagged", () => {
    const html = renderToStaticMarkup(<ChoiceCard choices={[{ id: "open", label: "Open the full list", note: "See all", recommended: true }, { id: "save", label: "Save these to a list", note: "" }]} onPick={() => {}} />);
    expect(html).toContain("Select one of the following");
    expect(html).toContain("Open the full list");
    expect(html.match(/Recommended/g)).toHaveLength(1);
  });

  it("shows the Customize your AI banner with what is missing", () => {
    const html = renderToStaticMarkup(<CustomizeBanner line="Tell me what you sell so my answers fit your business." onOpen={() => {}} onDismiss={() => {}} />);
    expect(html).toContain("Customize your AI");
    expect(html).toContain("what you sell");
  });

  it("starts the thumbs row with copy, up and down, and nothing asked yet", () => {
    const html = renderToStaticMarkup(<FeedbackBar message={{ id: "a1", text: "Here you go" }} question="cafes in Leeds" plugin="leads" chatId="c1" context={{}} onRemember={() => {}} />);
    expect(html).toContain("Copy the answer");
    expect(html).toContain("Good answer");
    expect(html).toContain("Not right");
    expect(html).not.toContain("What was wrong?");
  });
});
