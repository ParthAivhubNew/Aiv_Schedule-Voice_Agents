// An AI-voiced call is refused when nobody has recorded that the person agreed to it. Any screen that shows the refusal can offer
// "Record permission"; the Voice app is the one that opens the form.
const EVENT = "outreach:call-permission";
const REFUSAL = "No permission recorded for AI calls";

export function isNoPermission(message) {
  return typeof message === "string" && message.includes(REFUSAL);
}

/** Ask the Voice app to open the permission form, with the number filled in when it is known. */
export function askForPermission({ number = "", company = "" } = {}) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { number, company } }));
}

export function onPermissionRequest(handler) {
  const listener = (e) => handler(e.detail || {});
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
