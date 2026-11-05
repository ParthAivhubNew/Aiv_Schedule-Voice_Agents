import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AccountScreen from "./AccountScreen";

describe("the embedded Account screen", () => {
  it("starts on users, numbers and credits, with plans and API keys one tab away, and has no close button", () => {
    const html = renderToStaticMarkup(<AccountScreen operator={{ id: "op1", is_admin: true }} />);
    expect(html).toContain("Users, numbers &amp; credits");
    expect(html).toContain("Plans &amp; billing");
    expect(html).toContain("API keys &amp; webhooks");
    expect(html).toContain("Users, roles, numbers &amp; credits"); // the Team screen inside it
    expect(html).not.toContain('aria-label="Close"');
  });
});
