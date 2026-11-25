import { describe, expect, it } from "vitest";
import { CONNECTOR_PRICING } from "./connectorPrices";

// The pricing ids the server's catalogue names (backend services/connector_catalog.py: COMING_SOON and KEYS).
const SERVER_PRICING_IDS = ["experian", "market_location", "salesforce", "hubspot", "dynamics365", "zoho_crm", "pipedrive", "bigquery", "postgres",
  "snowflake", "s3_lake", "airtable", "key_openai", "key_deepseek", "key_tavily", "key_apollo", "key_google_places"];

describe("connector pricing", () => {
  it("every entry has two https links and at least one price row", () => {
    for (const [id, p] of Object.entries(CONNECTOR_PRICING)) {
      expect(p.apiUrl, id).toMatch(/^https:\/\//);
      expect(p.pricingUrl, id).toMatch(/^https:\/\//);
      expect(p.pricing.length, id).toBeGreaterThan(0);
      p.pricing.forEach((r) => expect(r.plan && r.price && r.note, id).toBeTruthy());
    }
  });
  it("every pricing id the server names has an entry", () => {
    for (const id of SERVER_PRICING_IDS) expect(CONNECTOR_PRICING[id], id).toBeTruthy();
  });
});
