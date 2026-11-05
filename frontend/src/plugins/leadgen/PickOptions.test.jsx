import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { PickOptions } from "./PickOptions";

beforeAll(() => { globalThis.document = { querySelector: () => null }; }); // no anchor on the page: the panel is centred

const draw = (options) => renderToStaticMarkup(<PickOptions kind="website" company="Acme Ltd" options={options} anchorKey="none" onPick={() => {}} onClose={() => {}} onRetry={() => {}} />);

describe("when a lookup is not sure", () => {
  it("keeps the text box hidden behind a button, with and without suggestions", () => {
    const none = draw([]);
    expect(none).toContain("Add details");
    expect(none).not.toContain("<textarea");
    const some = draw([{ value: "https://acme.co.uk", score: 60, label: "Likely", sources: [] }]);
    expect(some).toContain("None of these? Add details");
    expect(some).not.toContain("<textarea");
  });

  it("sends nobody to a prepared Google search", () => {
    const html = draw([]);
    expect(html).not.toContain("google.com");
    expect(html).not.toContain("Where to look");
    expect(html).not.toContain("Look here");
  });
});
