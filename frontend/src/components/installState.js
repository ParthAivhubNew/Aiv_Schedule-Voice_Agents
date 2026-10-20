import { useEffect, useState } from "react";

// Android's install prompt fires once, early, so it is caught here when the file loads and kept
// for whichever screen (the bottom card, the steps sheet) wants to start the install.
let installEvent = null;
let installed = false;
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    installEvent = e;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    installed = true;
    installEvent = null;
    notify();
  });
}

export function isInstalledApp() {
  if (installed) return true;
  try {
    return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  } catch (_) {
    return false;
  }
}

export function isPhone() {
  try {
    return window.matchMedia("(max-width: 820px) and (pointer: coarse)").matches;
  } catch (_) {
    return false;
  }
}

export function isIos() {
  const ua = window.navigator.userAgent || "";
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && window.navigator.maxTouchPoints > 1);
}

export function canInstallNow() {
  return Boolean(installEvent);
}

// Opens the browser's own install dialog. Resolves true if the person accepted it.
export async function promptInstall() {
  if (!installEvent) return false;
  const evt = installEvent;
  installEvent = null;
  notify();
  evt.prompt();
  try {
    const choice = await evt.userChoice;
    return choice?.outcome === "accepted";
  } catch (_) {
    return false;
  }
}

// Re-renders when the install prompt arrives or the app gets installed.
export function useInstallState() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const fn = () => setTick((n) => n + 1);
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, []);
  return { installed: isInstalledApp(), phone: isPhone(), ios: isIos(), canPrompt: canInstallNow() };
}

// A phone that has not installed the app yet: the only place the install steps are offered.
export function useShowInstallSteps() {
  const { installed: done, phone } = useInstallState();
  return phone && !done;
}
