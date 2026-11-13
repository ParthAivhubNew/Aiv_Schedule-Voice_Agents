// The most conversations "Select all" ticks in Mail; the server takes no more in one bulk action (mail_client.SELECT_ALL_CAP).
export const MAIL_SELECT_CAP = 500;

export const conversations = (n) => `${Number(n || 0).toLocaleString()} conversation${n === 1 ? "" : "s"}`;

const DONE = {
  archive: "Archived", trash: "Moved to Trash", spam: "Moved to Spam", inbox: "Moved to Inbox",
  delete_forever: "Deleted for good", read: "Marked as read", unread: "Marked as unread", star: "Starred", unstar: "Star removed",
};

// What the toast says after a bulk action: "Archived 3 conversations."
export function bulkDoneText(action, n) {
  const verb = DONE[action] || "Done";
  return n ? `${verb}: ${conversations(n)}.` : `${verb}.`;
}

// Phase 6: what a reply category looks like on a Mail row, and the one next step offered beside it.
// "times" opens ReplyWithTimes, "reply" the normal reply, "lost" sets the company's stage, "wait" is a note only,
// and "done" is already handled on the server (the address went on the do-not-email list when they said so).
export const REPLY_CHIP = {
  interested: ["Interested", "green"], question: ["Question", "blue"], not_interested: ["Not interested", "slate"],
  ooo: ["Out of office", "slate"], unsubscribe: ["Unsubscribe", "red"],
};
const NEXT_STEP = {
  interested: { key: "times", label: "Send times" },
  question: { key: "reply", label: "Reply" },
  not_interested: { key: "lost", label: "Mark lost" },
  ooo: { key: "wait", label: "Wait 3 days" },
  unsubscribe: { key: "done", label: "Added to Do not email", passive: true },
};
export const replyNextStep = (category) => NEXT_STEP[category] || null;

// The folders kept out of the way until asked for.
export const MORE_FOLDERS = ["drafts", "spam", "trash"];

// A mailbox's one-line health from what /email/mailboxes returns for the last 7 days.
export function deliverability(m) {
  const sent = Number(m.sent_7d || 0);
  const pct = sent ? `${((Number(m.bounced_7d || 0) / sent) * 100).toFixed(1)}%` : "No sends yet";
  return {
    bounce: pct,
    complaints: Number(m.complaints_7d || 0),
    spf: m.spf_verified ? "Set up" : "Not set up",
    dkim: m.dkim_verified ? "Set up" : "Not set up",
    dmarc: m.dmarc_verified ? "Record found" : "Not found",
    warn: m.bounce_health?.state === "warning" || m.bounce_health?.state === "paused",
  };
}
// Which mail provider a mailbox is on, from its server names and address, so "how to fix" speaks to them. "" when unknown.
export function providerOf(m) {
  const s = `${m?.smtp_host || ""} ${m?.imap_host || ""} ${m?.email || ""}`.toLowerCase();
  if (/one\.com/.test(s)) return "one.com";
  if (/gmail|google/.test(s)) return "Google";
  if (/outlook|office365|microsoft|hotmail|live\./.test(s)) return "Microsoft";
  return "";
}

const HOW = {
  dkim: { "one.com": "In one.com, open your domain's DNS settings and add the DKIM TXT record we show under Email accounts.",
    Google: "In Google Workspace Admin, go to Apps > Gmail > Authenticate email, generate the DKIM key, and add the TXT record at your domain host.",
    Microsoft: "In Microsoft 365 Defender, go to Email & collaboration > Policies > DKIM, turn it on, and add the two CNAME records at your domain host.",
    "": "Add the DKIM record we show under Email accounts at the company that hosts your domain's DNS." },
  spf: { "": "Add or update your domain's SPF TXT record so it includes your mail provider. The exact value is under Email accounts." },
  dmarc: { "": "Add a DMARC TXT record at _dmarc.yourdomain, for example v=DMARC1; p=none. Start with p=none and tighten later." },
};

// Each check as green, amber or red, with the steps to fix it for this mailbox's provider. A check that passes has no steps.
export function deliverabilityChecks(m) {
  const d = deliverability(m || {});
  const p = providerOf(m);
  const row = (key, label, ok, word, bad = "bad") => ({ key, label, state: ok ? "ok" : bad, word, how: ok ? "" : (HOW[key][p] || HOW[key][""]) });
  return [
    row("spf", "SPF", m?.spf_verified, d.spf),
    row("dkim", "DKIM", m?.dkim_verified || m?.dkim_override, m?.dkim_override && !m?.dkim_verified ? "Skipped" : d.dkim),
    row("dmarc", "DMARC", m?.dmarc_verified, d.dmarc, "warn"),
  ];
}

export const DMARC_NOTE = "DMARC pass rate is not measured yet.";
