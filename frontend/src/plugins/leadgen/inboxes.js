// Mailboxes that are not a person. The server's copy is GENERAL_INBOXES / ROLE_INBOXES in backend/app/services/check_picks.py;
// backend/tests/test_check_picks.py fails if the two lists drift apart.

export const GENERAL_INBOXES = new Set([
  "sales", "info", "hello", "contact", "contactus", "enquiries", "enquiry", "office", "mail", "team", "general",
  "bookings", "orders", "reception", "marketing", "newbusiness", "hi",
]);

export const ROLE_INBOXES = new Set([
  "support", "help", "helpdesk", "service", "customerservice", "customerservices", "customercare", "care",
  "ir", "investor", "investors", "investorrelations", "press", "media", "pr", "news", "newsroom",
  "accounts", "accountspayable", "billing", "invoices", "invoice", "finance", "payments",
  "admin", "administrator", "noreply", "donotreply", "postmaster", "webmaster", "hostmaster", "abuse",
  "security", "privacy", "dpo", "gdpr", "dataprotection", "legal", "compliance",
  "hr", "jobs", "careers", "recruitment", "complaints", "returns", "feedback", "notifications", "alerts",
]);

// "person", "general" or "role", by the same rule as the server.
export function inboxKind(email) {
  const local = String(email || "").trim().toLowerCase().split("@")[0];
  const whole = local.replace(/[^a-z]/g, "");
  const first = local.split(/[._+-]/)[0];
  for (const word of [whole, first]) {
    if (ROLE_INBOXES.has(word)) return "role";
    if (GENERAL_INBOXES.has(word)) return "general";
  }
  return "person";
}
