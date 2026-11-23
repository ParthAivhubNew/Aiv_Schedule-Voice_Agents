import { describe, expect, it } from "vitest";
import { CONNECTOR_PROVIDES, DATA_KINDS, providesKind } from "./ConnectorsView";

describe("data they provide", () => {
  it("all data keeps every connector", () => {
    expect(providesKind({ id: "anything" }, "all")).toBe(true);
  });
  it("sole traders come from the food hygiene and care registers only, not the company register", () => {
    const sole = Object.keys(CONNECTOR_PROVIDES).filter((id) => providesKind({ id }, "sole"));
    expect(sole.sort()).toEqual(["cqc_care", "fsa_hygiene"]);
  });
  it("phone screening is the TPS register and a connector with no listing gives nothing", () => {
    expect(providesKind({ id: "tps_ctps" }, "screening")).toBe(true);
    expect(providesKind({ id: "made_up" }, "phone")).toBe(false);
  });
  it("every kind used by a connector is a listed kind", () => {
    const known = DATA_KINDS.map((d) => d[0]);
    Object.values(CONNECTOR_PROVIDES).flat().forEach((k) => expect(known).toContain(k));
  });
});
