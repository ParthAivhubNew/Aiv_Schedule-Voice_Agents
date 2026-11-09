// "Write an email to this address": any screen can ask, and the Leads app opens a new message in Mail with the address filled in.
// Where Mail is not available, the person's own mail program opens instead.
export const WRITE_EMAIL_EVENT = "aivhub:write-email";

export function writeEmail(to) {
  const address = String(to || "").trim();
  if (!address || typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(WRITE_EMAIL_EVENT, { detail: address }));
}
