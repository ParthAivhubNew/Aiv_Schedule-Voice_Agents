import { describe, expect, it } from "vitest";
import { BLANK, fromForm, idFromName, toForm } from "./customFinderLogic";

describe("an e-mail finder set up in the portal", () => {
  it("gets an id the server allows from its name", () => {
    expect(idFromName("Finder X Pro")).toBe("finder_x_pro");
    expect(idFromName("  123 Leads! ")).toBe("leads");
    expect(idFromName("x".repeat(60))).toHaveLength(41);
  });

  it("goes from the form to the server and back without losing anything", () => {
    const form = { ...BLANK, name: "Finder X", url: "https://api.finderx.test/find", verifiedValues: "valid, verified", priceUsd: "0.04", key: "k-1" };
    const { config, key } = fromForm(form);
    expect(key).toBe("k-1");
    expect(config).toMatchObject({ id: "finder_x", query: { first_name: "{first_name}", last_name: "{last_name}", domain: "{domain}" },
      body: {}, priceUsd: 0.04, order: 90 });
    expect(config.key).toBeUndefined();
    const back = toForm({ ...config, verifiedValues: ["valid", "verified"], catchAllValues: [], keySaved: true });
    expect(back.verifiedValues).toBe("valid, verified");
    expect(JSON.parse(back.query)).toEqual(config.query);
    expect(back.key).toBe(""); // a saved key is never sent back to the screen
  });

  it("says plainly when the JSON is broken, and keeps a body only for POST", () => {
    expect(() => fromForm({ ...BLANK, name: "X", query: "{ nope" })).toThrow("The query isn't valid JSON.");
    expect(() => fromForm({ ...BLANK, name: "X", method: "POST", body: "[1, 2]" })).toThrow("The body must be a JSON object");
    expect(fromForm({ ...BLANK, name: "X", method: "GET", body: '{"a": "b"}' }).config.body).toEqual({});
    expect(fromForm({ ...BLANK, name: "X", method: "POST", body: '{"site": "{domain}"}' }).config.body).toEqual({ site: "{domain}" });
  });
});
