// "Approve all drafts": which drafts the button takes, and the question asked before it runs.
// Drafts the single Approve button refuses (text too long, a network problem) are left out, so the bulk button
// never gets round a check the one-by-one button makes.

export const isDraft = (p) => Boolean(p) && (!p.status || p.status === "draft");

// isBlocked(post): the check the single Approve button uses. dueMs(post): when the post is due to go out.
export function approvalBatch(posts, { isBlocked = () => false, dueMs = () => Infinity, nowMs = Date.now() } = {}) {
  const drafts = (posts || []).filter(isDraft);
  const ready = drafts.filter((p) => !isBlocked(p));
  const skipped = drafts.length - ready.length;
  const goNow = ready.filter((p) => !(dueMs(p) > nowMs + 60000)).length;
  return { ready, skipped, goNow };
}

const posts = (n) => `${n.toLocaleString()} draft${n === 1 ? "" : "s"}`;

export function approvalQuestion({ ready, skipped, goNow }, testMode = false) {
  const n = ready.length;
  const parts = [`Approve ${posts(n)}?`];
  const one = n === 1;
  if (goNow) parts.push(goNow === n ? (one ? "Its time has passed, so it goes out now." : "Their time has passed, so they go out now.") : `${goNow.toLocaleString()} go out now because their time has passed; the rest go out at their set times.`);
  else parts.push(one ? "It goes out at its set time." : "They go out at their set times.");
  if (skipped) parts.push(`${posts(skipped)} left out: fix ${skipped === 1 ? "its" : "their"} text first.`);
  if (testMode) parts.push("Test mode is on, so nothing is sent to any network.");
  return parts.join(" ");
}
