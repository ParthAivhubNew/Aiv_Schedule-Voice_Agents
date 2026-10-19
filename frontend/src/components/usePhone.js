import { useEffect, useState } from "react";

const QUERY = "(max-width: 820px) and (pointer: coarse)";

// True on a touch phone (or small touch tablet) held upright. The phone screens use it to pick a
// different layout; the CSS in global.css uses the same query for the sizing rules.
export function usePhone() {
  const read = () => {
    try {
      return window.matchMedia(QUERY).matches;
    } catch (_) {
      return false;
    }
  };
  const [phone, setPhone] = useState(read);
  useEffect(() => {
    let mq;
    try {
      mq = window.matchMedia(QUERY);
    } catch (_) {
      return undefined;
    }
    const on = () => setPhone(mq.matches);
    // Safari before 14 only has addListener.
    if (mq.addEventListener) mq.addEventListener("change", on);
    else mq.addListener(on);
    return () => (mq.removeEventListener ? mq.removeEventListener("change", on) : mq.removeListener(on));
  }, []);
  return phone;
}

// Puts a class on <body> while the calling screen is shown, so global.css can make room for it
// (the tab bar, the Home screen) without a :has() selector re-checking the whole page on every change.
export function useBodyClass(name) {
  useEffect(() => {
    document.body.classList.add(name);
    return () => document.body.classList.remove(name);
  }, [name]);
}
