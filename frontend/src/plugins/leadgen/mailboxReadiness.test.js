import { describe, expect, it } from "vitest";
import { readiness } from "./OutreachViews";

const base = { status: "connected", spf_verified: true, dkim_verified: true, dkim_override: false, consecutive_healthy_days: 0 };

describe("the one message a mailbox card shows", () => {
  it("asks for SPF first, because mail without it is rejected", () => {
    expect(readiness({ ...base, spf_verified: false, dkim_verified: false }).title).toBe("SPF record missing.");
  });
  it("offers to send without DKIM only while DKIM is missing and not yet skipped", () => {
    expect(readiness({ ...base, dkim_verified: false }).action).toBe("skip");
    const skipped = readiness({ ...base, dkim_verified: false, dkim_override: true });
    expect(skipped.action).toBe("require");
    expect(skipped.body).toContain("Next step: start warm-up.");
  });
  it("says what to do next once the records pass", () => {
    expect(readiness(base).title).toBe("Ready to warm up.");
    expect(readiness({ ...base, status: "warming", consecutive_healthy_days: 4 }).body).toContain("Day 4 of about 21");
    expect(readiness({ ...base, status: "active" })).toBeNull();
  });
});
