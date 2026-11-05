// Plain logic for the browser phone (no React, no browser phone library): numbers, the call's stages, the clock and what it costs.

export const OUTCOMES = [
  { id: "talked", label: "Talked" },
  { id: "no_answer", label: "No answer" },
  { id: "voicemail", label: "Voicemail" },
  { id: "wrong_number", label: "Wrong number" },
  { id: "callback_requested", label: "Call back" },
  { id: "not_interested", label: "Not interested" },
  { id: "do_not_call", label: "Do not call" },
];

/** What a person typed or pasted, as a number the server accepts: digits and one leading +. UK 07/01/02 numbers get +44. */
export function cleanNumber(raw) {
  const text = String(raw || "").trim();
  let digits = text.replace(/[^\d+]/g, "");
  if (digits.startsWith("00")) digits = `+${digits.slice(2)}`;
  digits = digits.replace(/(?!^)\+/g, "");
  if (!digits) return "";
  if (digits.startsWith("+")) return digits.replace(/^\+440/, "+44");
  if (digits.startsWith("0") && digits.length >= 10 && digits.length <= 11) return `+44${digits.slice(1)}`;
  return digits;
}

export function validNumber(raw) {
  return /^\+\d{8,15}$/.test(cleanNumber(raw));
}

/** The phone library's call state, in the three words the screen uses. */
export function stageOf(sdkState) {
  const s = String(sdkState || "").toLowerCase();
  if (s === "active") return "connected";
  if (s === "hangup" || s === "destroy" || s === "purge") return "ended";
  if (s === "new" || s === "trying" || s === "requesting" || s === "ringing" || s === "early") return "ringing";
  return "";
}

export function clock(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** Minutes of credit left in the call, from the longest it may last and how long it has gone on. */
export function minutesLeft(maxSeconds, elapsed) {
  if (!maxSeconds) return null;
  return Math.max(0, Math.ceil((maxSeconds - elapsed) / 60));
}

/** "2 credits a minute with transcript" / "1 credit a minute" */
export function rateLine(rates, record) {
  const per = (Number(rates?.call) || 0) + (record ? Number(rates?.transcript) || 0 : 0);
  if (!per) return "";
  return `${per} credit${per === 1 ? "" : "s"} a minute${record ? " with transcript" : ""}`;
}

/** What a finished call cost, for the line under the form. */
export function costLine(minutes, rates, record) {
  const call = minutes * (Number(rates?.call) || 0);
  const transcript = record ? minutes * (Number(rates?.transcript) || 0) : 0;
  if (!minutes) return "Not charged";
  if (!transcript) return `${minutes} min · ${call} credit${call === 1 ? "" : "s"}`;
  return `${minutes} min call + ${minutes} min transcript = ${call + transcript} credits`;
}

export function transcriptWords(state, error = "") {
  if (state === "waiting" || state === "working") return "Transcript is being made";
  if (state === "ready") return "Transcript ready";
  if (state === "failed") return error || "The transcript could not be made";
  return "";
}

/** "00:09" from seconds, for a line in the transcript. */
export const stamp = clock;

export function speakerWord(who) {
  return who === "you" ? "You" : "Them";
}
