// The Company rules tab's pure helpers (plan 12, F1). The server combines the brand's rules with the company's and checks them
// (PUT /org/rules); these only turn the form into the policy shape and say what the brand has already set.
import { parseDistricts, parseExtra, withPolicyDefaults } from "../brand/brandLogic";

export const SOURCE_NAMES = { google: "Google", apollo: "Enrichment data", search_engines: "Web search engines" };
export const SIGNIN_NAMES = { password: "Password", google: "Google", microsoft: "Microsoft" };
export const NETWORK_NAMES = { linkedin: "LinkedIn", x: "X", facebook: "Facebook", instagram: "Instagram", threads: "Threads", reddit: "Reddit" };
const SOCIAL_DEFAULT = { approver: "anyone", networks: [], ai_images: true, ai_video: true };
const socialOf = (p) => ({ ...SOCIAL_DEFAULT, ...((p && p.social) || {}) });

// The form's starting values, from the company's own rules.
export function draftFrom(company) {
  const p = withPolicyDefaults(company);
  const sets = Array.isArray(company?.exclusions?.sets) ? company.exclusions.sets : p.exclusions.fsb ? ["standard_b2b"] : [];
  return {
    sets,
    extraText: p.exclusions.extra.join("\n"),
    locked: company?.exclusions ? company.exclusions.locked !== false : true,
    memberList: p.member_suppression,
    districtsText: p.geo.districts.join(", "),
    sources: { ...p.restricted_sources },
    blockUnscreened: Boolean(p.screening.block_unscreened),
    signin: { ...p.signin },
    approver: socialOf(company).approver === "admin" ? "admin" : "anyone",
    networks: [...(socialOf(company).networks || [])],
    aiImages: socialOf(company).ai_images !== false,
    aiVideo: socialOf(company).ai_video !== false,
  };
}

// The policy the server takes, and what in the form can't be sent ({ payload, problems }).
// A company's own extra items are rows of its list now (Administration > Exclusions); only a brand still sends them here.
export function toPayload(draft, level = "company") {
  const geo = parseDistricts(draft.districtsText);
  const problems = geo.invalid.length ? [`These aren't postcode districts: ${geo.invalid.join(", ")}.`] : [];
  if (!Object.values(draft.signin).some(Boolean)) problems.push("Keep at least one sign-in method on, or nobody can sign in.");
  return {
    problems,
    payload: {
      exclusions: { sets: [...draft.sets], fsb: draft.sets.includes("standard_b2b"), extra: level === "brand" ? parseExtra(draft.extraText) : [], locked: Boolean(draft.locked) },
      member_suppression: Boolean(draft.memberList),
      geo: { districts: geo.districts },
      restricted_sources: { ...draft.sources },
      signin: { ...draft.signin },
      screening: { block_unscreened: Boolean(draft.blockUnscreened) },
      social: { approver: draft.approver === "admin" ? "admin" : "anyone", networks: [...(draft.networks || [])], ai_images: draft.aiImages !== false,
        ai_video: draft.aiVideo !== false },
    },
  };
}

// What the brand already set, so the screen shows it as set and can't be changed here.
export function fromBrand(brand) {
  const b = brand ? withPolicyDefaults(brand) : null;
  if (!b) return { sets: [], memberList: false, districts: [], sources: {}, blockUnscreened: false, signinOff: {}, extra: 0, approverAdmin: false, networks: [], aiImagesOff: false, aiVideoOff: false };
  const so = socialOf(brand);
  return {
    sets: Array.isArray(brand.exclusions?.sets) ? brand.exclusions.sets : b.exclusions.fsb ? ["standard_b2b"] : [],
    memberList: b.member_suppression,
    districts: b.geo.districts,
    sources: Object.fromEntries(Object.entries(b.restricted_sources).filter(([, on]) => on)),
    blockUnscreened: Boolean(b.screening.block_unscreened),
    signinOff: Object.fromEntries(Object.entries(b.signin).filter(([, on]) => !on).map(([k]) => [k, true])),
    extra: b.exclusions.extra.length,
    approverAdmin: so.approver === "admin",
    networks: so.networks || [],
    aiImagesOff: so.ai_images === false,
    aiVideoOff: so.ai_video === false,
  };
}

// "Hides 5,861 of 65,210 companies in your area" from the preview answer.
export function previewLine(r) {
  if (!r) return "";
  if (r.tooBig) return r.note || "Too many companies to count quickly.";
  const n = (x) => Number(x || 0).toLocaleString("en-GB");
  return `Hides ${n(r.hidden)} of ${n(r.total)} companies${r.inArea ? " in your area" : ""}. ${n(r.kept)} stay in your searches.`;
}
