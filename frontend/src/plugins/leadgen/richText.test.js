import { describe, it, expect } from "vitest";
import { blocks } from "./RichText";

describe("assistant text blocks", () => {
  it("splits paragraphs and keeps single line breaks inside one", () => {
    expect(blocks("Hi\nthere\n\nBye")).toEqual([{ kind: "p", items: ["Hi", "there"] }, { kind: "p", items: ["Bye"] }]);
  });
  it("reads dash and numbered lists", () => {
    expect(blocks("- one\n- two\n\n1. a\n2) b")).toEqual([{ kind: "ul", items: ["one", "two"] }, { kind: "ol", items: ["a", "b"] }]);
  });
});
