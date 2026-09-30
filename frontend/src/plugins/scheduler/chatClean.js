export function coerceChatText(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch (_) {
      return "";
    }
  }
  return String(value);
}

export function looksLikeJunkDump(text) {
  const t = coerceChatText(text);
  if (!t) return false;
  if (/SQL_ERROR|fillBuffer|errorType|"format"\s*:\s*"sjson"|hierarchies|traceid/i.test(t)) return true;
  if (/^\s*\{/.test(t) && /"error"\s*:\s*true/i.test(t) && /sjson|traceid/i.test(t)) return true;
  if (/\n[a-zA-Z_]+\s*\n:\s*\n/.test(t) && /\b(error|format|data|hierarchies)\b/.test(t)) return true;
  if (/"caption"\s*:/.test(t) && /imagePrompt|image_prompt|"posts"\s*:/.test(t)) return true;
  if (/```plan/i.test(t)) return true;
  if (/Suggested Visual|Scattered data in\.|The fix isn['’]t another/i.test(t)) return true;
  if (/plan JSON block|Create exactly \d+ /i.test(t)) return true;
  if (/real scene for this day|draft onto this date|file, meeting, or system/i.test(t)) return true;
  if (/Friday close still lives|ERP dump|NetSuite export tab/i.test(t)) return true;
  return false;
}

function stripFences(text) {
  return String(text || "")
    .replace(/```(?:plan|json)[\s\S]*?```/gi, "")
    .replace(/```[\s\S]*?```/g, "")
    .trim();
}

export function humanizeAiReply(text, hadDraft) {
  let t = stripFences(coerceChatText(text));
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start && /"posts"\s*:/.test(t.slice(start, end + 1))) {
    t = (t.slice(0, start) + t.slice(end + 1)).replace(/\n{3,}/g, "\n\n").trim();
  }
  if (looksLikeJunkDump(t) || looksLikeJunkDump(text)) {
    return hadDraft
      ? "Draft is ready on the left. Change the image or caption, then approve to post."
      : "That dump is not a post. Give me the business topic and the date it should go out.";
  }
  if (/^\s*[{\[]/.test(t) && t.length > 80) {
    try {
      JSON.parse(t);
      return hadDraft
        ? "Draft is ready on the left. Change the image or caption, then approve to post."
        : "Tell me the topic and when to post. I'll draft caption and image for you to edit.";
    } catch (_) {}
  }
  t = t.replace(/\*\*([^*]+)\*\*/g, "$1");
  t = t.replace(/^\s*[-*]\s+\*\*[^*]+\*\*.*$/gm, "");
  if (/Applied to your calendar|Post summary|under your \d+ limit/i.test(t)) {
    return hadDraft
      ? "Draft is ready on the left. Change the image or caption, then approve to post."
      : "Draft is on the calendar. Open Review to change image or copy, then approve.";
  }
  t = t.replace(/\n{3,}/g, "\n\n").trim();
  if (t.length > 700) t = t.slice(0, 680).trim() + "…";
  if (!t) {
    return hadDraft
      ? "Draft is ready on the left. Change the image or caption, then approve to post."
      : "Tell me the topic and when to post.";
  }
  return t;
}
