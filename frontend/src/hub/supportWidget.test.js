import { afterEach, describe, expect, it, vi } from "vitest";
import { initSupportWidget, loadSupportWidget, openSupportWidget, resetSupportWidget, supportWidgetReady } from "./supportWidget";
import { openSupport, SUPPORT_UNAVAILABLE_EVENT } from "./openSupport";

const fakeWidget = () => ({ init: vi.fn(), open: vi.fn(), close: vi.fn(), logout: vi.fn() });

afterEach(() => { resetSupportWidget(); delete globalThis.window; });

describe("support widget", () => {
  it("is not ready until it has been started for a signed-in person", () => {
    globalThis.window = { AivSupport: fakeWidget() };
    expect(supportWidgetReady()).toBe(false);
    expect(openSupportWidget()).toBe(false);
    expect(initSupportWidget({ email: "", name: "x" })).toBe(false); // no email, no start
    expect(initSupportWidget({ email: "a@b.co", name: "Ann", company: "Acme" })).toBe(true);
    expect(globalThis.window.AivSupport.init).toHaveBeenCalledWith({ email: "a@b.co", name: "Ann", company: "Acme" });
    expect(supportWidgetReady()).toBe(true);
    expect(openSupportWidget()).toBe(true);
    expect(globalThis.window.AivSupport.open).toHaveBeenCalled();
  });
  it("starts once per person and again for a different one", () => {
    globalThis.window = { AivSupport: fakeWidget() };
    initSupportWidget({ email: "a@b.co", name: "Ann" });
    initSupportWidget({ email: "a@b.co", name: "Ann" });
    expect(globalThis.window.AivSupport.init).toHaveBeenCalledTimes(1);
    initSupportWidget({ email: "c@d.co", name: "Cy" });
    expect(globalThis.window.AivSupport.init).toHaveBeenCalledTimes(2);
  });
  it("sign-out closes the drawer, drops the identity and the widget is no longer used", () => {
    globalThis.window = { AivSupport: fakeWidget() };
    initSupportWidget({ email: "a@b.co", name: "Ann" });
    resetSupportWidget();
    expect(globalThis.window.AivSupport.close).toHaveBeenCalled();
    expect(globalThis.window.AivSupport.logout).toHaveBeenCalled();
    expect(supportWidgetReady()).toBe(false);
  });
  it("openSupport uses the widget when ready and says so when it is not", () => {
    const events = [];
    globalThis.window = { AivSupport: fakeWidget(), dispatchEvent: (e) => events.push(e) };
    globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } };
    openSupport({ plugin: "leads" });
    expect(events).toHaveLength(1); // not started yet: the person is told, nothing of ours opens
    expect(events[0].type).toBe(SUPPORT_UNAVAILABLE_EVENT);
    initSupportWidget({ email: "a@b.co", name: "Ann" });
    openSupport({ plugin: "leads" });
    expect(events).toHaveLength(1); // the widget took it
    expect(globalThis.window.AivSupport.open).toHaveBeenCalledTimes(1);
  });
  it("a script that loads but never defines the widget counts as not loaded", async () => {
    globalThis.window = {};
    const head = [];
    const doc = { createElement: () => ({}), head: { appendChild: (t) => { head.push(t); setTimeout(() => t.onload(), 0); } } };
    expect(await loadSupportWidget(doc)).toBe(false);
    expect(head[0].src).toContain("aiv-support-widget.js");
    expect(await loadSupportWidget(doc)).toBe(false); // can be tried again, no stuck promise
    expect(head).toHaveLength(2);
  });
  it("a script that defines the widget counts as loaded", async () => {
    globalThis.window = {};
    const doc = { createElement: () => ({}), head: { appendChild: (t) => { globalThis.window.AivSupport = fakeWidget(); setTimeout(() => t.onload(), 0); } } };
    expect(await loadSupportWidget(doc)).toBe(true);
  });
});
