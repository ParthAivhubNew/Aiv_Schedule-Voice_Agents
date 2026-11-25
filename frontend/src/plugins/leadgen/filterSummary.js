import { SIGNAL_OPTIONS, coversText } from "./savedSearchLogic";
import { SOURCE_LABELS } from "./SourceMark";

// What a closed filter group shows under its name: one small chip per value that is on, each able to remove just that value.
// A chip is { id, text, patch }: patch(form) returns the part of the form to change to remove it.

const SIZE_NAMES = { micro: "Micro", small: "Small", medium_large: "Medium / large", dormant: "Dormant" };
const TYPE_NAMES = { ltd: "Ltd", plc: "PLC", llp: "LLP", cic: "CIC", guarantee: "By guarantee", partnership: "Partnership" };
const SOURCE_NAMES = { food: "Food hygiene register", care: "Care register", other: "Imported or web-found" };
const LEGAL_NAMES = { company: "Registered company", sole: "Sole trader / no company number" };
// The sources the server can tell apart (business_records.DATA_FROM), in the plain names clients see.
export const DATA_FROM_OPTIONS = [["register", SOURCE_LABELS.register], ["web", SOURCE_LABELS.web], ["data", "Business data (licensed or scraped)"],
  ["google", SOURCE_LABELS.google_places], ["enrichment", SOURCE_LABELS.apollo]];
const DATA_FROM_NAMES = Object.fromEntries(DATA_FROM_OPTIONS);
// "" = any result; the server treats a result choice as "checked" too.
export const TPS_OPTIONS = [["", "Any result"], ["listed", "On TPS"], ["clear", "Not on TPS"]];
const TPS_NAMES = { listed: "On TPS", clear: "Not on TPS" };
const LISTS_NAMES = { exclude: "Not in my lists", only: "In my lists" };

const split = (v) => String(v || "").split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
const without = (list, i) => list.filter((_, j) => j !== i);

const fromList = (form, key, prefix = "") => split(form[key]).map((t, i, all) => ({ id: `${key}:${i}`, text: prefix + t, patch: () => ({ [key]: without(all, i).join(", ") }) }));
const fromArray = (form, key, names, prefix = "") => (form[key] || []).map((v) => ({ id: `${key}:${v}`, text: prefix + (names?.[v] || v), patch: (f) => ({ [key]: (f[key] || []).filter((x) => x !== v) }) }));
const flag = (key, text) => (form) => (form[key] ? [{ id: key, text, patch: () => ({ [key]: false }) }] : []);
const one = (form, key, text) => (String(form[key] || "").trim() ? [{ id: key, text, patch: () => ({ [key]: "" }) }] : []);

export function summaryChips(group, form, sicLabels = {}) {
  switch (group) {
    case "industry":
      return [
        ...fromList(form, "sector"),
        ...split(form.sic).map((c, i, all) => ({ id: `sic:${c}`, text: sicLabels[c] || c, patch: () => ({ sic: without(all, i).join(", ") }) })),
        ...fromArray(form, "industryTypes"),
        ...fromList(form, "notSector", "Not "),
        ...flag("includeSecondary", "Side activities")(form),
        ...flag("includeNonBusiness", "Schools & community")(form),
      ];
    case "location":
      return [
        ...fromList(form, "town"),
        ...fromList(form, "postcode"),
        ...fromList(form, "notTown", "Not "),
        ...(form.near?.districts?.length ? [{ id: "near", text: `${form.near.miles || ""} mi of ${form.near.postcode || "postcode"} · ${coversText(form.near).replace("Covers ", "")}`, patch: () => ({ near: null, nearPostcode: "", nearError: "" }) }] : []),
      ];
    case "signals":
      return fromArray(form, "signals", Object.fromEntries(SIGNAL_OPTIONS.map(([k, n]) => [k, n])));
    case "size":
      return fromArray(form, "sizes", SIZE_NAMES);
    case "company":
      return [
        ...fromList(form, "category"),
        ...fromArray(form, "types", TYPE_NAMES),
        ...(form.legalForm ? [{ id: "legalForm", text: LEGAL_NAMES[form.legalForm] || form.legalForm, patch: () => ({ legalForm: "", recordSources: [] }) }] : []),
        ...fromArray(form, "recordSources", SOURCE_NAMES),
        ...flag("noCharities", "No charities")(form),
        ...flag("googleData", "Includes Google data")(form),
        ...fromArray(form, "dataFrom", DATA_FROM_NAMES, "From "),
        ...fromList(form, "notCategory", "Not "),
        ...fromList(form, "excludeItems", "Not "),
      ];
    case "status":
      return [...one(form, "minAge", `Trading ≥ ${form.minAge} yrs`), ...one(form, "maxAge", `Trading ≤ ${form.maxAge} yrs`), ...flag("includeClosed", "Incl. closed")(form)];
    case "contact":
      return [...flag("hasWebsite", "Has website")(form), ...flag("hasPhone", "Has phone")(form), ...flag("hasEmail", "Has email")(form),
        ...(form.tpsChecked || form.tpsStatus ? [{ id: "tpsChecked", text: TPS_NAMES[form.tpsStatus] || "TPS checked", patch: () => ({ tpsChecked: false, tpsStatus: "" }) }] : [])];
    case "lists":
      return form.saved ? [{ id: "saved", text: LISTS_NAMES[form.saved] || form.saved, patch: () => ({ saved: "" }) }] : [];
    case "person":
      return fromList(form, "title");
    default:
      return [];
  }
}
