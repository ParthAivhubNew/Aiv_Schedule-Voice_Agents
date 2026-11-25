// How a company joined an account (LeadAccount.source), in words. The same list as the server's (backend services/source_catalog.ORIGINS,
// served at GET /leadgen/sources); the stored keys "scout" and "copilot" are Find Leads and the AI Assistant.
export const ORIGINS = [
  ["scout", "Find Leads", "Found with Find Leads"],
  ["copilot", "AI Assistant", "Found by the AI Assistant"],
  ["import", "Your file", "Imported from your file"],
  ["import_match", "Import & match", "Matched from your file"],
  ["inbound_form", "Web form", "Sent through your web form"],
  ["inbound_call", "Inbound call", "Called you"],
  ["social", "Social", "Engaged on social media or booked through your page"],
  ["api", "API", "Added through the API"],
  ["crm_sync", "CRM sync", "Synced from your CRM"],
  ["manual", "Added by hand", "Added by hand"],
];
const ALIASES = { find_leads: "scout", assistant: "copilot" };

export const ORIGIN_LABEL = Object.fromEntries(ORIGINS.map(([k, label]) => [k, label]));
export const ORIGIN_WORDS = Object.fromEntries(ORIGINS.map(([k, , words]) => [k, words]));

export const originKey = (source) => {
  const k = ALIASES[source] || source;
  return ORIGIN_LABEL[k] ? k : "manual";
};
export const originLabel = (source) => ORIGIN_LABEL[originKey(source)];
export const originWords = (source) => ORIGIN_WORDS[originKey(source)];

// [{key, label, count}] for each origin with at least one row, in the list's order: the choices of the "Came from" filter.
export function originOptions(rows) {
  const counts = {};
  (rows || []).forEach((a) => { const k = originKey(a.source); counts[k] = (counts[k] || 0) + 1; });
  return ORIGINS.filter(([k]) => counts[k]).map(([k, label]) => ({ key: k, label, count: counts[k] }));
}
