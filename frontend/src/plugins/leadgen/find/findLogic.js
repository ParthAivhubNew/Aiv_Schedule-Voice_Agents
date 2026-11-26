

// The most rows one "Select all" ticks across pages; the server holds the same cap (lead_accounts.SELECT_ALL_CAP).
export const SELECT_ALL_LIMIT = 2000;

export const FAVOURITES = "Favourites";

export const SIZE_OPTIONS = [["micro", "Micro"], ["small", "Small"], ["medium_large", "Medium / large"], ["dormant", "Dormant"]];
export const EMPTY_FORM = { name: "", sector: "", sic: "", industryTypes: [], town: "", postcode: "", sizes: [], minAge: "", maxAge: "", includeClosed: false, includeNonBusiness: false, includeSecondary: false, hasWebsite: false, hasPhone: false, hasEmail: false, tpsChecked: false, tpsStatus: "", googleData: false, dataFrom: [], category: "", types: [], noCharities: false, excludeItems: "", legalForm: "", recordSources: [], notSector: "", notTown: "", notCategory: "", saved: "", title: "", nearPostcode: "", nearMiles: "5", near: null, nearError: "", signals: [], keep: {} };
export const FIRST_KEY = "aivhub_find_first";
export const GROUP_KEYS = { name: ["name"], industry: ["sector", "sic", "industryTypes", "notSector", "includeSecondary", "includeNonBusiness"], location: ["town", "postcode", "notTown", "nearPostcode", "near", "nearError"], signals: ["signals"], size: ["sizes"], company: ["category", "types", "noCharities", "excludeItems", "legalForm", "recordSources", "notCategory", "googleData", "dataFrom"], status: ["minAge", "maxAge", "includeClosed"], contact: ["hasWebsite", "hasPhone", "hasEmail", "tpsChecked", "tpsStatus"], lists: ["saved"], person: ["title"] };
export const isOn = (form, k) => (k === "nearPostcode" || k === "nearError" ? false : k === "tpsStatus" ? false : k === "near" ? Boolean(form.near?.districts?.length) : Array.isArray(form[k]) ? form[k].length > 0 : typeof form[k] === "boolean" ? form[k] : String(form[k] || "").trim() !== "");
export const FORM_OPTIONS = [["", "Any"], ["company", "Registered company"], ["sole", "Sole trader / no company number"]];
export const SOURCE_OPTIONS = [["food", "Food hygiene register"], ["care", "Care register"], ["other", "Imported or web-found"]];
export const TYPE_OPTIONS = [["ltd", "Ltd"], ["plc", "PLC"], ["llp", "LLP"], ["cic", "CIC"], ["guarantee", "By guarantee"], ["partnership", "Partnership"]];

export const splitList = (v) => String(v || "").split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
const num = (v) => (v === "" || v == null || Number.isNaN(Number(v)) ? undefined : Number(v));

// The filter panel and the chat are the same search: the panel's fields become this filter object,
// and a chat reply's filters are written back into the panel -- so neither can drift from the other.
// Filters the panel has no control for (the standard FSB exclusions, a site filter, a status such as Dissolved) are carried in form.keep,
// so applying the panel again, or filling it from a sentence, does not silently drop them.
const KEEP_KEYS = ["fsb_exclusions", "site"];
const keptFrom = (fl) => {
  const keep = Object.fromEntries(KEEP_KEYS.filter((k) => fl[k] && !(Array.isArray(fl[k]) && !fl[k].length)).map((k) => [k, fl[k]]));
  const status = String(fl.status || "");
  if (status && !["active", "any"].includes(status.toLowerCase())) keep.status = status;
  return keep;
};

export function formToFilters(f) {
  const out = { ...(f.keep || {}) };
  // One box for industry words and company names: each word is matched against both.
  if (String(f.name || "").trim()) out.name_contains = f.name.trim();
  if (splitList(f.sector).length) out.keyword = splitList(f.sector);
  if (splitList(f.sic).length) out.sic_codes = splitList(f.sic);
  if ((f.industryTypes || []).length) out.industry_types = f.industryTypes;
  if (splitList(f.town).length) out.towns = splitList(f.town);
  if (splitList(f.postcode).length) out.postcode_prefixes = splitList(f.postcode);
  if (f.sizes.length) out.size_bands = f.sizes;
  if (num(f.minAge) !== undefined) out.min_age_years = num(f.minAge);
  if (num(f.maxAge) !== undefined) out.max_age_years = num(f.maxAge);
  if (f.includeClosed) out.status = "any";
  if (f.category.trim()) out.company_category = f.category.trim();
  if ((f.types || []).length) out.company_types = f.types;
  if (f.noCharities) out.exclude_charities = true;
  if (splitList(f.excludeItems).length) out.exclude_items = splitList(f.excludeItems);
  if (f.legalForm) out.legal_form = f.legalForm;
  if ((f.recordSources || []).length) out.record_sources = f.recordSources;
  if (f.hasWebsite) out.has_website = true;
  if (f.includeNonBusiness) out.include_non_business = true;
  if (f.includeSecondary) out.include_secondary_activity = true;
  if (f.hasPhone) out.has_phone = true;
  if (f.hasEmail) out.has_email = true;
  // A TPS result choice already means "checked", so the server gets one key, not two.
  if (f.tpsStatus) out.tps_status = f.tpsStatus;
  else if (f.tpsChecked) out.tps_checked = true;
  if (f.googleData) out.has_google_data = true;
  if ((f.dataFrom || []).length) out.data_from = f.dataFrom;
  if (splitList(f.notSector).length) out.not_keyword = splitList(f.notSector);
  if (splitList(f.notTown).length) out.not_towns = splitList(f.notTown);
  if (splitList(f.notCategory).length) out.not_company_category = splitList(f.notCategory);
  if (f.saved === "only" || f.saved === "exclude") out.saved = f.saved;
  if (f.near?.districts?.length) out.near = f.near;
  if ((f.signals || []).length) out.signals = f.signals;
  return out;
}

// What the user asked for, in a few words ("accounting, bookkeeping · Leeds"), for the status card.
export function appliedWords(f) {
  return [f.sector, f.town, f.postcode ? `postcode ${f.postcode}` : ""].map((s) => String(s || "").trim()).filter(Boolean).join(" · ");
}

export function filtersToForm(fl) {
  return {
    name: fl.name_contains || "", sector: [...(fl.keyword || []), ...(fl.sector || [])].join(", "), sic: (fl.sic_codes || []).join(", "), industryTypes: fl.industry_types || [],
    types: fl.company_types || [], noCharities: !!fl.exclude_charities, excludeItems: (fl.exclude_items || []).join(", "), legalForm: fl.legal_form || "", recordSources: fl.record_sources || [], town: (fl.towns || []).map((t) => t.replace(/\b\w/g, (m) => m.toUpperCase())).join(", "),
    postcode: (fl.postcode_prefixes || []).join(", "), sizes: fl.size_bands || [],
    minAge: fl.min_age_years != null ? String(fl.min_age_years) : "", maxAge: fl.max_age_years != null ? String(fl.max_age_years) : "",
    includeClosed: String(fl.status || "").toLowerCase() === "any", category: fl.company_category || "",
    includeNonBusiness: !!fl.include_non_business, includeSecondary: !!fl.include_secondary_activity, hasWebsite: !!fl.has_website, hasPhone: !!fl.has_phone, hasEmail: !!fl.has_email,
    tpsChecked: !!(fl.tps_checked || fl.tps_status), tpsStatus: fl.tps_status || "", googleData: !!fl.has_google_data, dataFrom: fl.data_from || [],
    notSector: (fl.not_keyword || []).join(", "), notTown: (fl.not_towns || []).join(", "), notCategory: (fl.not_company_category || []).join(", "),
    saved: fl.saved || "", title: "",
    near: fl.near || null, nearPostcode: fl.near?.postcode || "", nearMiles: fl.near ? String(fl.near.miles) : "5", nearError: "", signals: fl.signals || [],
    keep: keptFrom(fl),
  };
}

export function asAccount(c) {
  const notes = [c.registration_number && `Reg no. ${c.registration_number}`, c.status, c.sic_text, c.postcode].filter(Boolean).join(" · ");
  return { name: c.name, website: c.website || "", phone: c.phone || "", email: c.email || "", industry: c.industry || "", region: c.region || "", notes, source: "scout", business_record_id: c.id,
    registration_number: c.registration_number || "", postcode: c.postcode || "", address: c.address || "" };
}

// The second line under an officer: how long in the role, nationality, trade, where they live, birth year. Only what the register publishes.
export function personLine(o) {
  const years = o.years_in_role == null ? "" : o.years_in_role === 0 ? "joined this year" : `${o.years_in_role} ${o.years_in_role === 1 ? "year" : "years"} in the role`;
  return [years, o.nationality, o.occupation, o.country_of_residence ? `lives in ${o.country_of_residence}` : "", o.born_year ? `born ${o.born_year}` : ""].filter(Boolean).join(" · ");
}

// The strip over a search handed to Find Leads: from the assistant, or from "Get started" (the company's ideal customers or a sample).
export function draftTitle(draft) {
  if (draft?.own) return "Your ideal customers, from About your business. Change any filter to look further.";
  if (draft?.sample) return "A sample search, to show how it works. Change any filter, or clear them to start your own.";
  return "Draft from the AI assistant";
}
