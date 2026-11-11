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
export const DMARC_NOTE = "DMARC pass rate is not measured yet.";
