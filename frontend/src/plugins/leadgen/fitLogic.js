// The fit score and "why now" signals as the lists show them. The server works the score out from facts we hold and sends
// the reasons with it; these helpers only order, colour and word what it sent.

export const SIZE_WORDS = { micro: "Micro", small: "Small", medium_large: "Medium or large" };

// With an ideal customer set, "Best fit" replaces "Best match": the fit score orders the list, the fullest records break ties.
export const sortOptions = (icpSet) => [icpSet ? ["fit", "Best fit"] : ["best", "Best match"], ["newest", "Newest first"], ["name", "Name A to Z"]];

export function fitTone(score) {
  if (score == null) return null;
  if (score >= 70) return { word: "Strong fit", fg: "#166534", bg: "#DCFCE7" };
  if (score >= 40) return { word: "Some fit", fg: "#92400E", bg: "#FEF3C7" };
  return { word: "Weak fit", fg: "#475569", bg: "#F1F5F9" };
}

// The hover text: the score, then each reason on its own line.
export function fitTip(fit) {
  if (!fit) return "";
  const why = (fit.reasons || []).length ? fit.reasons.map((r) => `• ${r}`).join("\n") : "Nothing we hold matches your ideal customer yet.";
  return `Fit ${fit.score} of 100\n${why}`;
}

// Best fit first; rows with no score keep their order after the scored ones.
export function byFit(rows, fitOf = (r) => r.fit) {
  return rows
    .map((r, i) => [r, i])
    .sort((x, y) => {
      const a = fitOf(x[0])?.score;
      const b = fitOf(y[0])?.score;
      if (a == null && b == null) return x[1] - y[1];
      if (a == null) return 1;
      if (b == null) return -1;
      return b - a || x[1] - y[1];
    })
    .map(([r]) => r);
}

// The ICP in one line, for the saved summary and the Find Leads note.
export function icpSummary(icp, typeLabels = {}) {
  if (!icp) return "";
  const parts = [];
  const sic = icp.sic_codes || [];
  if (sic.length) parts.push(sic.slice(0, 3).map((c) => (icp.sic_labels?.[c] ? `${icp.sic_labels[c]} (${c})` : c)).join(", ") + (sic.length > 3 ? ` and ${sic.length - 3} more` : ""));
  const where = [...(icp.postcode_areas || []), ...(icp.areas || []).map((a) => `within ${a.radius_miles} miles of ${a.postcode}`)];
  if (where.length) parts.push(where.join(", "));
  if ((icp.size_bands || []).length) parts.push(icp.size_bands.map((s) => SIZE_WORDS[s] || s).join(" or "));
  if ((icp.company_types || []).length) parts.push(icp.company_types.map((t) => typeLabels[t] || t).join(" or "));
  if (icp.exclude_charities) parts.push("no charities");
  return parts.join(" · ");
}

// "LS, M1, bd" typed in one box -> ["LS", "M1", "BD"].
export function splitAreas(text) {
  return [...new Set(String(text || "").split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean))];
}

export const isIcpSet = (icp) => Boolean(icp && ((icp.sic_codes || []).length || (icp.postcode_areas || []).length || (icp.areas || []).length
  || (icp.size_bands || []).length || (icp.company_types || []).length));
