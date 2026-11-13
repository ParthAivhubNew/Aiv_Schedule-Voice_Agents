// True when `now` is what `was` became after taking something away: every filter left is one that was already there
// (a list keeps only some of its items), and at least one thing is gone. Adding or changing a filter is not that.
export function filterNarrowed(was, now) {
  const a = was || {};
  const b = now || {};
  if (JSON.stringify(a) === JSON.stringify(b)) return false;
  return Object.keys(b).every((k) => {
    if (!(k in a)) return false;
    if (Array.isArray(b[k])) return Array.isArray(a[k]) && b[k].every((x) => a[k].some((y) => JSON.stringify(y) === JSON.stringify(x)));
    return JSON.stringify(b[k]) === JSON.stringify(a[k]);
  });
}
