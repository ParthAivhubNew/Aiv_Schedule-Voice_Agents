import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AUTH_LOST_EVENT, SESSION_SET_EVENT, getAccessToken } from "../api/authStore";
import { getHostBrand, getMyBrand, getOrgPolicy } from "./brandApi";
import { ACCENT_PROPS, NO_BRAND, accentShades, resolveBrand } from "./brandLogic";

export const BrandContext = createContext({ ...NO_BRAND, loading: false });

// Without a provider (tests, the embedded screens) the app looks exactly as it did before brands.
export function useBrand() {
  return useContext(BrandContext);
}

const safe = (call) => call().catch(() => ({}));

// Reads the look once for the web address, then again when someone signs in (their account may follow a brand).
// It never holds the page back: until the answer arrives the app renders with the defaults.
export function BrandProvider({ children }) {
  const [state, setState] = useState({ host: null, me: null, policy: null, loading: true });
  const signedIn = useRef(false);

  const read = useCallback(async (withAccount) => {
    const host = typeof window !== "undefined" ? window.location.host : "";
    const [hostLook, me, policy] = await Promise.all([
      safe(() => getHostBrand(host)),
      withAccount ? safe(getMyBrand) : Promise.resolve(null),
      withAccount ? safe(getOrgPolicy) : Promise.resolve(null),
    ]);
    setState(() => ({ host: hostLook, me: withAccount ? me : null, policy: withAccount ? policy : null, loading: false }));
  }, []);

  useEffect(() => {
    let live = true;
    const go = (withAccount) => { if (live) read(withAccount); };
    signedIn.current = Boolean(getAccessToken());
    go(signedIn.current);
    const onSignIn = () => { if (!signedIn.current) { signedIn.current = true; go(true); } };
    const onLost = () => { signedIn.current = false; setState((s) => ({ ...s, me: null, policy: null })); };
    window.addEventListener(SESSION_SET_EVENT, onSignIn);
    window.addEventListener(AUTH_LOST_EVENT, onLost);
    return () => { live = false; window.removeEventListener(SESSION_SET_EVENT, onSignIn); window.removeEventListener(AUTH_LOST_EVENT, onLost); };
  }, [read]);

  const value = useMemo(() => ({ ...resolveBrand(state), loading: state.loading, refresh: () => read(signedIn.current) }), [state, read]);
  useBrandInDocument(value);
  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>;
}

// The accent variable follows the brand; with none it is put back as found. The tab title and icon stay Outreach's for every
// company, like the top of the sidebar: the company's own name and logo show in the account badge at the bottom of the sidebar.
function useBrandInDocument(brand) {
  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const root = document.documentElement;
    if (brand.active && brand.accent) root.style.setProperty("--brand-accent", brand.accent);
    else root.style.removeProperty("--brand-accent");
    // The brand's accent is the app's accent everywhere: buttons, links, selected items, focus rings (one accent per product).
    const shades = brand.active ? accentShades(brand.accent) : null;
    ACCENT_PROPS.forEach((name) => (shades ? root.style.setProperty(name, shades[name]) : root.style.removeProperty(name)));
    return undefined;
  }, [brand.active, brand.accent]);
}
