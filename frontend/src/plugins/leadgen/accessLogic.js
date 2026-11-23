// What the signed-in person may do with data, as /auth/me reports it. A missing block means no personal limits.
export function accessFlags(operator, policy) {
  const d = (operator && operator.data_access) || (policy && policy.data_access) || {};
  const districts = Array.isArray(d.districts) ? d.districts : [];
  const admin = Boolean(operator && (operator.is_admin || operator.role === "Admin"));
  return {
    limited: !admin && Boolean(d.limited),
    districts,
    exportOff: !admin && d.allow_export === false,
    googleOff: !admin && d.allow_google === false,
  };
}

export const CONTACT_LINE = "Contact your administrator for access.";
export const EXPORT_OFF_LINE = "Export is switched off for your account. Ask your administrator.";

export const isOutsideAccess = (e) => Boolean(e) && e.status === 403 && e.code === "outside_access";

// The server's sentence, plus the contact line only when it does not already tell them to ask.
export function noticeLines(detail) {
  const text = String(detail || "").trim();
  if (!text) return [];
  return /administrator|admin\b/i.test(text) ? [text] : [text, CONTACT_LINE];
}

export const limitedLine = (districts) => `Your account is limited to: ${(districts || []).join(", ")}. Ask your administrator to change this.`;
