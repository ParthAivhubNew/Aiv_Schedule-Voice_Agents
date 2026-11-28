import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SourceBadge } from "./SourceBadge";
import { effectiveSources, GoogleG } from "./SourceMark";
import { describeSources } from "./sourceBadgeLogic";

// An older loaded company: no saved source tag, but the server flagged its phone as "From Google".
const loaded = { name: "A Ltd", phone: "01273 000000", field_sources: {}, restricted: { phone: true }, restricted_note: { phone: "From Google. You can see and use it in Outreach, but it can't be downloaded." } };

describe("Google as a visible source", () => {
  it("a value the server flagged as from Google counts as Google, not as nothing or the register", () => {
    expect(effectiveSources(loaded).phone).toBe("google_places");
    const d = describeSources(loaded);
    expect(d.fields).toEqual([{ key: "google_places", field: "Phone", label: "Google" }]);
  });
  it("a saved tag is never overridden", () => {
    expect(effectiveSources({ ...loaded, field_sources: { phone: "website" } }).phone).toBe("website");
  });
  it("the badge under the company name shows the Google G", () => {
    const html = renderToStaticMarkup(<SourceBadge account={loaded} />);
    expect(html).toContain('title="Google"');
    expect(html).toContain("#4285F4");
  });
  it("the G is labelled for screen readers", () => {
    expect(renderToStaticMarkup(<GoogleG />)).toContain('aria-label="Google"');
  });
});
