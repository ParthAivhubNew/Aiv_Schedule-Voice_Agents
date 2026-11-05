import { afterEach, describe, expect, it, vi } from "vitest";
import { goExternal, inFrame } from "./goExternal";

afterEach(() => { vi.unstubAllGlobals(); });

describe("leaving for Stripe", () => {
  it("opens a new tab when we are a frame inside a partner's page", () => {
    const open = vi.fn();
    const assign = vi.fn();
    vi.stubGlobal("window", { self: {}, top: {}, open, location: { assign } });
    expect(inFrame()).toBe(true);
    goExternal("https://checkout.stripe.test/pay");
    expect(open).toHaveBeenCalledWith("https://checkout.stripe.test/pay", "_blank", "noopener");
    expect(assign).not.toHaveBeenCalled();
  });

  it("goes there in the same page in the normal app", () => {
    const open = vi.fn();
    const assign = vi.fn();
    const me = {};
    vi.stubGlobal("window", { self: me, top: me, open, location: { assign } });
    expect(inFrame()).toBe(false);
    goExternal("https://checkout.stripe.test/pay");
    expect(assign).toHaveBeenCalledWith("https://checkout.stripe.test/pay");
    expect(open).not.toHaveBeenCalled();
  });

  it("treats a parent it may not look at as a frame", () => {
    const top = new Proxy({}, {});
    vi.stubGlobal("window", { self: {}, get top() { throw new Error("cross-origin"); }, open: vi.fn(), location: { assign: vi.fn() } });
    expect(inFrame()).toBe(true);
    expect(top).toBeTruthy();
  });
});
