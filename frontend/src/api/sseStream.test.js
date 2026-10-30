import { describe, expect, it } from "vitest";
import { createSseParser } from "./sseStream";

describe("createSseParser", () => {
  it("emits one object per message, even when the network splits the text anywhere", () => {
    const got = [];
    const feed = createSseParser((e) => got.push(e));
    const text = 'data: {"type":"status","text":"Thinking"}\n\ndata: {"type":"step","step":{"label":"A"}}\n\n';
    for (let i = 0; i < text.length; i += 7) feed(text.slice(i, i + 7));
    expect(got).toEqual([{ type: "status", text: "Thinking" }, { type: "step", step: { label: "A" } }]);
  });

  it("skips comments and messages that are not JSON", () => {
    const got = [];
    const feed = createSseParser((e) => got.push(e));
    feed(': keep-alive\n\ndata: not json\n\ndata: {"type":"final"}\n\n');
    expect(got).toEqual([{ type: "final" }]);
  });
});
