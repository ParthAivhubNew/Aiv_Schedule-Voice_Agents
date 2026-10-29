import { describe, it, expect, vi, beforeEach } from "vitest";

describe("bridge", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("sends nothing but empty messages until it knows the page above it", async () => {
    const post = vi.fn();
    vi.stubGlobal("window", Object.assign(Object.create(globalThis.window || {}), {
      parent: { postMessage: post }, location: { ancestorOrigins: [] }, addEventListener: vi.fn(),
    }));
    vi.stubGlobal("document", { referrer: "" });
    const b = await import("./bridge.js");
    b.toParent("event", { name: "lead.saved" });
    expect(post).not.toHaveBeenCalled();
    b.toParent("ready");
    expect(post).toHaveBeenCalledWith({ source: "outreach-embed", type: "ready" }, "*");
  });

  it("uses the address of the page above it once the browser names it", async () => {
    const post = vi.fn();
    vi.stubGlobal("window", { parent: { postMessage: post }, location: { ancestorOrigins: ["https://app.partner.test"] }, addEventListener: vi.fn() });
    vi.stubGlobal("document", { referrer: "" });
    const b = await import("./bridge.js");
    b.toParent("event", { name: "lead.saved" });
    expect(post).toHaveBeenCalledWith({ source: "outreach-embed", type: "event", name: "lead.saved" }, "https://app.partner.test");
  });
});
