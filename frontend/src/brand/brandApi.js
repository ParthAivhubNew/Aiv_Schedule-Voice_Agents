import { apiRequest } from "../api/apiClient";
import { normaliseHost } from "./brandLogic";

// The look for this web address: public, so it works before anyone signs in. {} when the address has no brand.
export const getHostBrand = (host) => apiRequest(`/brand?host=${encodeURIComponent(normaliseHost(host))}`);
export const getMyBrand = () => apiRequest("/me/brand");
export const getOrgPolicy = () => apiRequest("/org/policy");
export const getMemberList = () => apiRequest("/org/member-suppression");
export const uploadMemberList = (file, replace) => {
  const form = new FormData();
  form.append("file", file);
  return apiRequest(`/org/member-suppression${replace ? "?replace=true" : ""}`, { method: "POST", body: form, timeoutMs: 120000 });
};
export const clearMemberList = () => apiRequest("/org/member-suppression", { method: "DELETE" });

// The company's own rules (organisation admins): each level's rules, a preview of what a draft hides, and the rule sets on offer.
export const getOrgRules = () => apiRequest("/org/rules");
export const saveOrgRules = (body) => apiRequest("/org/rules", { method: "PUT", body });
export const previewOrgRules = (body) => apiRequest("/org/rules/preview", { method: "POST", body, timeoutMs: 30000 });
export const getRuleSets = () => apiRequest("/org/rule-sets");
