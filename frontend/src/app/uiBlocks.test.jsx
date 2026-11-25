import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Building2, ShieldAlert } from "lucide-react";
import { Banner, EmptyState, Pill, Toast, Tooltip } from "./ui";
import { Pill as PortalPill } from "../adminPortal/ui";

// Plan 10, Phase 4 item 4: one tooltip, one empty state and one notice for every screen.
describe("shared building blocks", () => {
  it("a tooltip is a labelled button described by its card, closed until asked", () => {
    const closed = renderToStaticMarkup(<Tooltip trigger={<b>i</b>} label="What this is">The card text</Tooltip>);
    expect(closed).toContain("<button");
    expect(closed).toContain("aria-describedby");
    expect(closed).toContain('aria-expanded="false"');
    expect(closed).toContain("What this is");
    expect(closed).toMatch(/role="tooltip" style="position:absolute;width:1px/); // clipped, still read aloud
    const open = renderToStaticMarkup(<Tooltip trigger={<b>i</b>} defaultOpen>The card text</Tooltip>);
    expect(open).toContain('aria-expanded="true"');
    expect(open).toContain("box-shadow");
  });

  it("an empty state has its icon, words and actions", () => {
    const html = renderToStaticMarkup(<EmptyState icon={Building2} title="No lists yet" body="Search or import."><button type="button">Go</button></EmptyState>);
    expect(html).toContain("No lists yet");
    expect(html).toContain("Search or import.");
    expect(html).toContain("<button");
  });

  it("a notice carries its meaning in words and icon, and a problem is an alert", () => {
    expect(renderToStaticMarkup(<Banner tone="warn" icon={ShieldAlert} title="Limited">Two areas only.</Banner>)).toMatch(/role="status".*Limited.*Two areas only/);
    expect(renderToStaticMarkup(<Banner tone="bad">It failed.</Banner>)).toContain('role="alert"');
  });

  it("a pill looks the same in the apps and the staff portal, and a toast is a polite status", () => {
    expect(PortalPill).toBe(Pill);
    expect(renderToStaticMarkup(<Pill tone="good">Ready</Pill>)).toBe(renderToStaticMarkup(<Pill tone="green">Ready</Pill>));
    expect(renderToStaticMarkup(<Toast message="Saved." />)).toMatch(/role="status" aria-live="polite".*Saved\./);
    expect(renderToStaticMarkup(<Toast message="" />)).toBe("");
  });
});
