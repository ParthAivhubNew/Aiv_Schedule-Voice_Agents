import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SummaryTab } from "./SummaryParts";

const render = (props) => renderToStaticMarkup(<SummaryTab profile={null} account={null} loading={false} error="" onGoTab={() => {}} companyId="c1" {...props} />);

describe("Summary tab for a contact the register holds but has not opened", () => {
  it("shows Held with a Reveal button, not 'Not found yet'", () => {
    const html = render({ closed: { email: true, phone: true }, onReveal: () => {} });
    expect(html).toContain("Held");
    expect(html).toContain("Reveal");
    expect(html).not.toContain("Not found yet");
  });
  it("only the held contact gets the button", () => {
    const html = render({ closed: { email: true }, onReveal: () => {} });
    expect(html.match(/Reveal<\/button>/g)).toHaveLength(1);
    expect(html).toContain("Not found yet");
  });
  it("with nothing held it still says Not found yet", () => {
    const html = render({ closed: {}, onReveal: () => {} });
    expect(html).not.toContain("Held");
    expect(html).toContain("Not found yet");
  });
});
