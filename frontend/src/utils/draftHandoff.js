// A search draft the AI assistant opened from outside the Leads screens ("Open the full list" while on Voice). The Leads screen is not
// mounted yet when it is sent, so the draft waits here until Leads starts and takes it.
let pending = null;

export function setPendingDraft(draft) {
  pending = draft && typeof draft === "object" ? draft : null;
}

export function takePendingDraft() {
  const d = pending;
  pending = null;
  return d;
}
