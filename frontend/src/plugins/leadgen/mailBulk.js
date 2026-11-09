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
