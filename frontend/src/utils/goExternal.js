// Stripe (checkout, the billing portal) refuses to be shown inside another page. Inside a partner's page we are a frame, so these open in a new tab
// instead; in the normal app the page itself goes there, as before.
export function inFrame() {
  try {
    return window.self !== window.top;
  } catch (_) {
    return true; // a parent we are not allowed to look at is a parent
  }
}

export function goExternal(url) {
  if (inFrame()) {
    window.open(url, "_blank", "noopener");
    return;
  }
  window.location.assign(url);
}
