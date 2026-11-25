import { describe, expect, it, vi } from "vitest";
vi.mock("./LeadsMap", () => ({ LeadsMap: () => null }));
import { EMPTY_FORM, GROUP_KEYS, filtersToForm, formToFilters, isOn } from "./FindLeadsView";
import { DATA_FROM_OPTIONS, summaryChips } from "./filterSummary";

const withForm = (patch) => ({ ...EMPTY_FORM, ...patch });
const activeIn = (form, group) => GROUP_KEYS[group].filter((k) => isOn(form, k)).length;

describe("TPS and source filters in Find Leads", () => {
  it("sends nothing when they are off", () => {
    const out = formToFilters(EMPTY_FORM);
    for (const k of ["tps_checked", "tps_status", "has_google_data", "data_from"]) expect(out).not.toHaveProperty(k);
  });

  it("sends one TPS key: the result choice already means checked", () => {
    expect(formToFilters(withForm({ tpsChecked: true }))).toMatchObject({ tps_checked: true });
    const out = formToFilters(withForm({ tpsChecked: true, tpsStatus: "listed" }));
    expect(out.tps_status).toBe("listed");
    expect(out).not.toHaveProperty("tps_checked");
  });

  it("round trips through a saved search or the assistant's Fill", () => {
    const form = withForm({ tpsChecked: true, tpsStatus: "clear", googleData: true, dataFrom: ["google", "register"] });
    const filters = formToFilters(form);
    expect(filters).toEqual({ tps_status: "clear", has_google_data: true, data_from: ["google", "register"] });
    expect(formToFilters(filtersToForm(filters))).toEqual(filters);
    expect(filtersToForm({ tps_checked: true })).toMatchObject({ tpsChecked: true, tpsStatus: "" });
    expect(filtersToForm({ tps_status: "listed" })).toMatchObject({ tpsChecked: true, tpsStatus: "listed" });
  });

  it("counts each filter once in its group and clears with the group", () => {
    const form = withForm({ tpsChecked: true, tpsStatus: "listed", googleData: true, dataFrom: ["web", "enrichment"] });
    expect(activeIn(form, "contact")).toBe(1);
    expect(activeIn(form, "company")).toBe(2);
    expect(activeIn(EMPTY_FORM, "contact") + activeIn(EMPTY_FORM, "company")).toBe(0);
    for (const k of GROUP_KEYS.contact.concat(GROUP_KEYS.company)) expect(k in EMPTY_FORM).toBe(true);
  });

  it("shows chips that remove just their own value", () => {
    const form = withForm({ googleData: true, dataFrom: ["google", "enrichment"], tpsChecked: true, tpsStatus: "clear" });
    const company = summaryChips("company", form);
    expect(company.map((c) => c.text)).toEqual(["Includes Google data", "From Google", "From Enrichment data"]);
    expect(company[1].patch(form)).toEqual({ dataFrom: ["enrichment"] });
    const [tps] = summaryChips("contact", form);
    expect(tps.text).toBe("Not on TPS");
    expect(tps.patch(form)).toEqual({ tpsChecked: false, tpsStatus: "" });
    expect(summaryChips("contact", withForm({ tpsChecked: true }))[0].text).toBe("TPS checked");
  });

  it("names sources in plain words with no supplier", () => {
    expect(DATA_FROM_OPTIONS.map(([, name]) => name)).toEqual(["Official register", "Web search", "Business data (licensed or scraped)", "Google", "Enrichment data"]);
  });
});
