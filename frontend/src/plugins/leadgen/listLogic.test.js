import { describe, expect, it } from "vitest";
import { bucket, duplicateFlags, firstSeen, listStats, openPicks } from "./listLogic";

const row = (id, extra = {}) => ({ id, name: `Co ${id}`, ...extra });
const ready = (id, extra = {}) => row(id, { email: `a@${id}.co.uk`, verification: { email: { state: "verified" } }, ...extra });

describe("which tab a company is on", () => {
  it("puts anyone already in touch under contacted, even with a good email", () => {
    expect(bucket(ready("a", { connection: { last_contact_at: "2026-11-01T10:00:00Z" } }))).toBe("contacted");
    expect(bucket(ready("b", { connection: { last_called_at: "2026-11-01T10:00:00Z" } }))).toBe("contacted");
    expect(bucket(ready("c", { connection: { stage: "interested" } }))).toBe("contacted");
    expect(bucket(ready("d", { connection: { stage: "new" } }))).toBe("ready");
  });
  it("needs an unblocked email to be ready, and sends the rest to needs contact", () => {
    expect(bucket(ready("a"))).toBe("ready");
    expect(bucket(ready("b", { send_block: { code: "consent", reason: "x" } }))).toBe("needs");
    expect(bucket(row("c"))).toBe("needs");
    expect(bucket(row("d", { phone: "0113 496 0000" }))).toBe("needs");
  });
});

describe("answers waiting for a choice", () => {
  it("ignores picks already applied and other kinds of fix", () => {
    const a = row("a", { verification: { fixes: [{ kind: "pick", field: "phone" }, { kind: "pick", field: "email", applied: true }, { kind: "fix", field: "website" }] } });
    expect(openPicks(a).map((f) => f.field)).toEqual(["phone"]);
    expect(openPicks(row("b"))).toEqual([]);
  });
});

describe("possible duplicates and shared phones", () => {
  it("marks rows with the same company number, domain, or name and postcode", () => {
    const flags = duplicateFlags([
      row("1", { registration_number: "01234567" }), row("2", { registration_number: "01234567" }),
      row("3", { domain: "acme.co.uk" }), row("4", { domain: "ACME.co.uk" }),
      row("5", { name: "Bright Cafe", postcode: "LS1 4AP" }), row("6", { name: "bright cafe", postcode: "ls14ap" }),
      row("7", { name: "Lone", postcode: "LS1 4AP" }),
    ]);
    ["1", "2", "3", "4", "5", "6"].forEach((id) => expect(flags[id]).toContain("duplicate"));
    expect(flags["7"]).toBeUndefined();
  });
  it("ignores phone formatting, and one company twice is not a shared phone", () => {
    const flags = duplicateFlags([
      row("1", { phone: "0113 496 0000", registration_number: "AAA11111" }), row("2", { phone: "01134960000", registration_number: "BBB22222" }),
      row("3", { phone: "0161 496 0000", registration_number: "CCC33333" }), row("4", { phone: "0161 496 0000", registration_number: "CCC33333" }),
    ]);
    expect(flags["1"]).toEqual(["shared_phone"]);
    expect(flags["2"]).toEqual(["shared_phone"]);
    expect(flags["3"]).toEqual(["duplicate"]);
  });
});

describe("list numbers", () => {
  it("words where a company first came from", () => {
    expect(firstSeen({ source: "import", created_at: "2026-11-03T10:00:00Z" })).toBe("Imported · 3 Nov 2026");
    expect(firstSeen({ source: "weird" })).toBe("Added by hand");
  });
  it("averages only scored rows, counts ready ones, and says Mixed without a clear majority", () => {
    const rows = [ready("a", { source: "import", fit: { score: 80 } }), row("b", { source: "scout", fit: { score: 40 } }), row("c", { source: "import" }), row("d", { source: "manual" })];
    expect(listStats(rows)).toEqual({ ready: 1, avgFit: 60, source: "Mixed" });
    expect(listStats([row("x", { source: "import" }), row("y", { source: "import" })])).toEqual({ ready: 0, avgFit: null, source: "Import" });
    expect(listStats([])).toEqual({ ready: 0, avgFit: null, source: "" });
  });
});
