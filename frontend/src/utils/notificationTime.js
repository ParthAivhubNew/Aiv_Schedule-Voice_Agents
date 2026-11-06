// How long ago a notification was raised, in words. Notifications made in this browser carry their moment in the id ("n_1730000000000");
// those from the server carry an ISO `at`. Anything else keeps the text it was given.
export function ago(n, now = Date.now()) {
  const stamp = n?.at ? Date.parse(n.at) : Number(String(n?.id || "").match(/(\d{12,})/)?.[1]);
  if (!Number.isFinite(stamp)) return n?.time || "";
  const mins = Math.max(0, Math.floor((now - stamp) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
