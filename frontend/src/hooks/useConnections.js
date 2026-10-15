import { useCallback, useEffect, useState } from "react";
import { api } from "../api/apiClient";
import { BILLING_CHANGED } from "../hub/BillingReturnBanner";
import { navigateHash } from "../utils/route";

// Which plugins this organisation has, and which links between them it can use. One answer for the whole
// app, from the server (the same rule the server uses), looked at again after a payment.

export const PLUGIN_NAME = { leads: "Lead Gen", voice: "Voice", social: "Social" };
const PLANS_PAGE = { leads: "#/leadgen/subscription", voice: "#/voice/subscription", social: "#/scheduler/subscription" };

let cache = null;
let inflight = null;
const listeners = new Set();

function publish(next) {
  cache = next;
  listeners.forEach((fn) => fn(next));
}

export function loadConnections(force = false) {
  if (cache && !force) return Promise.resolve(cache);
  if (inflight) return inflight;
  inflight = api.getPluginLinks()
    .then((res) => { publish({ ok: true, plugins: res.plugins || {}, links: res.links || {} }); return cache; })
    .catch(() => { publish({ ok: false, plugins: {}, links: {} }); return cache; })
    .finally(() => { inflight = null; });
  return inflight;
}

export function useConnections() {
  const [state, setState] = useState(cache);
  useEffect(() => {
    listeners.add(setState);
    loadConnections();
    const again = () => loadConnections(true);
    window.addEventListener(BILLING_CHANGED, again);
    return () => { listeners.delete(setState); window.removeEventListener(BILLING_CHANGED, again); };
  }, []);
  const refresh = useCallback(() => loadConnections(true), []);
  return { loading: !state, plugins: state?.plugins || {}, links: state?.links || {}, failed: state ? !state.ok : false, refresh };
}

// useConnection("call_leads") -> { available, reason, missing, loading }. While it is still loading a link
// counts as unavailable, so nothing flashes on and off.
export function useConnection(link) {
  const { loading, links, failed } = useConnections();
  const hit = links[link];
  if (loading) return { loading: true, available: false, reason: "", missing: [] };
  if (failed || !hit) return { loading: false, available: false, reason: "We couldn't check your plans just now.", missing: [] };
  return { loading: false, available: Boolean(hit.available), reason: hit.reason || "", missing: hit.missing || [] };
}

export function openPlans(plugin) {
  navigateHash(PLANS_PAGE[plugin] || "#/");
}

export function missingNames(missing) {
  return (missing || []).map((p) => PLUGIN_NAME[p] || p).join(" and ");
}

export function openConnectionSettings(tab = "") {
  try { window.dispatchEvent(new CustomEvent("aivhub:open-connections", { detail: tab })); } catch (_) { /* nothing to open */ }
}
