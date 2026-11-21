import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AUTH_LOST_EVENT, SESSION_SET_EVENT, getAccessToken } from "../api/authStore";
import { getHostBrand, getMyBrand, getOrgPolicy } from "./brandApi";
import { NO_BRAND, buildTitle, resolveBrand } from "./brandLogic";

const BrandContext = createContext({ ...NO_BRAND, loading: false });

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

// The tab title, the tab icon and the accent variable follow the brand; with none they are put back as found.
function useBrandInDocument(brand) {
  const original = useRef(null);
  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const icons = Array.from(document.querySelectorAll("link[rel~='icon']"));
    if (!original.current) original.current = { title: document.title, icons: icons.map((l) => [l, l.getAttribute("href"), l.getAttribute("type")]) };
    const root = document.documentElement;
    document.title = brand.active ? buildTitle(brand.name, original.current.title) : original.current.title;
    if (brand.active && brand.accent) root.style.setProperty("--brand-accent", brand.accent);
    else root.style.removeProperty("--brand-accent");
    original.current.icons.forEach(([link, href, type]) => {
      if (brand.logoUrl) { link.setAttribute("href", brand.logoUrl); link.removeAttribute("type"); }
      else { if (href !== null) link.setAttribute("href", href); if (type) link.setAttribute("type", type); }
    });
    return undefined;
  }, [brand.active, brand.name, brand.accent, brand.logoUrl]);
}
