// The words a failed action shows: the server's own message when it sent one, otherwise the fallback.
export function failText(err, fallback = "That did not work. Try again.") {
  const text = String((err && err.message) || "").trim();
  if (!text || /^(failed to fetch|networkerror|load failed)/i.test(text)) return fallback;
  return text;
}
