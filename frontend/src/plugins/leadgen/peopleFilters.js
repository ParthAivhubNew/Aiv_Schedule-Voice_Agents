import { sourceKeysOf } from "./listFilters";
import { screeningOfNumber } from "./phoneNumbers";

// Saved people: a person you saved carries the company's phone and email, so those two sources apply. A person a company check found has
// no recorded source, so they count for no source and only the TPS filter can include them.
export const PEOPLE_SOURCE_FIELDS = ["phone", "email"];

export const personSources = (p) => (p.own ? sourceKeysOf(p.account, PEOPLE_SOURCE_FIELDS) : new Set());
export const personHasSource = (p, key) => personSources(p).has(key);

// The TPS/CTPS result of this person's own number: a saved person's number is looked up among every number on the company (not only its main
// phone); a person a company check found carries their own result.
export const personTps = (p) => (p.own ? (p.phone ? screeningOfNumber(p.account, p.phone) : null) : p.screening || screeningOfNumber(p.account, p.phone));
