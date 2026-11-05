// Any screen can open the browser phone without knowing about it: it sends this event and the phone (mounted once in the app) answers.
const EVENT = "outreach:human-call";

/** Open the phone with a number filled in. `leadId` and `name` tie the call to a lead. */
export function openPhone({ number = "", leadId = "", name = "" } = {}) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { number, leadId, name } }));
}

/** Open a finished call's transcript. */
export function openTranscript(callRef) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { transcript: callRef } }));
}

export function onPhoneRequest(handler) {
  const listener = (e) => handler(e.detail || {});
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
