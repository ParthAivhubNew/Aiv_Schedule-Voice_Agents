import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, beforeEach } from "vitest";
import { filledSummary, nextTabIndex, readOpen, readTab, writeOpen, writeTab } from "./profileState";
import { batches, cleanNote, countWords, isAddShortcut, noteByline, noteProblem, oneLine, personKey, personRef } from "./notesLogic";
import { Collapsible } from "./ProfileLayout";

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), clear: () => m.clear() };
}
beforeEach(() => { globalThis.window = { localStorage: memoryStorage() }; });

describe("tabs remembered per screen", () => {
  it("returns the saved tab only when the screen still has it", () => {
    expect(readTab("account", ["overview", "notes"], "overview")).toBe("overview");
    writeTab("account", "notes");
    expect(readTab("account", ["overview", "notes"], "overview")).toBe("notes");
    expect(readTab("drawer", ["overview", "notes"], "overview")).toBe("overview");
    writeTab("account", "gone");
    expect(readTab("account", ["overview", "notes"], "overview")).toBe("overview");
  });

  it("moves with the arrow keys, wrapping round, and ignores other keys", () => {
    expect(nextTabIndex(0, "ArrowRight", 5)).toBe(1);
    expect(nextTabIndex(4, "ArrowRight", 5)).toBe(0);
    expect(nextTabIndex(0, "ArrowLeft", 5)).toBe(4);
    expect(nextTabIndex(2, "Home", 5)).toBe(0);
    expect(nextTabIndex(2, "End", 5)).toBe(4);
    expect(nextTabIndex(2, "a", 5)).toBe(-1);
  });

  it("says how many details are filled", () => {
    expect(filledSummary(["a", "", null, " ", "b"])).toBe("2 of 5 details");
  });
});

describe("Collapsible", () => {
  it("starts closed unless asked, and opens once the person opened it before", () => {
    const draw = (props) => renderToStaticMarkup(<Collapsible id="t:one" title="Checks" summary="3 checks" {...props}><p>inside</p></Collapsible>);
    const closed = draw();
    expect(closed).toContain('aria-expanded="false"');
    expect(closed).toContain("3 checks");
    expect(closed).not.toContain("inside");
    expect(draw({ defaultOpen: true })).toContain("inside");
    writeOpen("t:one", true);
    expect(draw()).toContain("inside");
    expect(draw()).toContain('aria-expanded="true"');
  });

  it("works when the browser keeps nothing", () => {
    globalThis.window = { get localStorage() { throw new Error("blocked"); } };
    expect(readOpen("t:x", true)).toBe(true);
    writeOpen("t:x", false);
    expect(readTab("account", ["overview"], "overview")).toBe("overview");
  });

  it("uses its default until the person chooses", () => {
    expect(readOpen("t:two", true)).toBe(true);
    writeOpen("t:two", false);
    expect(readOpen("t:two", true)).toBe(false);
  });
});

describe("notes helpers", () => {
  it("trims a note and refuses an empty or too long one", () => {
    expect(cleanNote("  hi\r\nthere  ")).toBe("hi\nthere");
    expect(noteProblem("   ")).toBe("Write a note first.");
    expect(noteProblem("x".repeat(2001))).toMatch(/up to 2,000/);
    expect(noteProblem("ok")).toBe("");
  });

  it("keys a person by company and register name, like the server", () => {
    expect(personKey("SMITH,  John ")).toBe("smith, john");
    expect(personRef("br_1", "SMITH,  John")).toBe("br_1|smith, john");
  });

  it("adds on Ctrl+Enter or Cmd+Enter only", () => {
    expect(isAddShortcut({ key: "Enter", ctrlKey: true })).toBe(true);
    expect(isAddShortcut({ key: "Enter", metaKey: true })).toBe(true);
    expect(isAddShortcut({ key: "Enter" })).toBe(false);
  });

  it("writes who and when, and labels the old notes field", () => {
    expect(noteByline({ earlier: true })).toBe("Earlier note");
    expect(noteByline({ author_name: "Ann Lee", created_at: "2026-11-09T10:04:00Z" })).toMatch(/^Ann Lee · /);
    expect(oneLine("a\n\nb   c", 140)).toBe("a b c");
    expect(oneLine("x".repeat(10), 5)).toBe("xxxx…");
    expect(countWords(0)).toBe("No notes");
    expect(countWords(1)).toBe("1 note");
    expect(countWords(3)).toBe("3 notes");
  });

  it("splits a big page into batches the server accepts", () => {
    const ids = Array.from({ length: 450 }, (_, i) => `id${i}`);
    expect(batches(ids).map((b) => b.length)).toEqual([200, 200, 50]);
    expect(batches([])).toEqual([]);
  });
});
