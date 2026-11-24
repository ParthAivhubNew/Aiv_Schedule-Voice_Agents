import { describe, expect, it } from "vitest";
import { CONNECTOR_PRICING } from "./connectorPrices";
import { CONNECTOR_PROVIDES } from "./ConnectorsView";

describe("connector pricing", () => {
  it("every entry has two https links and at least one price row", () => {
    for (const [id, p] of Object.entries(CONNECTOR_PRICING)) {
      expect(p.apiUrl, id).toMatch(/^https:\/\//);
      expect(p.pricingUrl, id).toMatch(/^https:\/\//);
      expect(p.pricing.length, id).toBeGreaterThan(0);
      p.pricing.forEach((r) => expect(r.plan && r.price && r.note, id).toBeTruthy());
    }
  });
  it("every data connector from a vendor has a price entry", () => {
    for (const id of Object.keys(CONNECTOR_PROVIDES)) {
      if (id === "web_dossier" || id === "csv_pipeline") continue;
      expect(CONNECTOR_PRICING[id], id).toBeTruthy();
    }
  });
});
