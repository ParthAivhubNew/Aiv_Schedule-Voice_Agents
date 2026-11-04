// The heading above a list of found companies. It says how many are listed and how many match, so a saved list is never a surprise.
export function foundHeading(found) {
  const shown = (found.top || []).length;
  const total = found.total || 0;
  const plus = found.capped ? "+" : "";
  const word = (n) => (n === 1 ? "company" : "companies");
  if (!total) return { title: "No companies found", note: "" };
  if (shown >= total) return { title: `${total.toLocaleString()}${plus} ${word(total)}`, note: "" };
  const asked = found.asked && found.asked === shown;
  return {
    title: `${shown.toLocaleString()} ${word(shown)}, out of ${total.toLocaleString()}${plus} that match`,
    note: asked ? `The ${shown.toLocaleString()} you asked for: the best matches first, the ones we know most about.` : "The best matches first, the ones we know most about.",
  };
}

// What the web search says when it is done. A shortfall is said plainly, and only the companies found are charged.
export function webResultText(found, asked, query) {
  if (!found) return `Nothing found on the web for “${query}”. Nothing was charged.`;
  const unverified = " They are unverified: check them before you rely on them.";
  if (asked && found < asked) return `Found ${found} of the ${asked} you asked for. That is all the web search turned up, so only ${found} ${found === 1 ? "is" : "are"} charged.${unverified}`;
  return `Found ${found} on the web.${unverified}`;
}
