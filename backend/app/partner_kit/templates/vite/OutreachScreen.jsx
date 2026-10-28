import { useEffect, useRef } from "react";

// Shows an Outreach screen inside your React page: <OutreachScreen component="leads" />
// component can be leads, campaigns, mail, voice or social.
const HOST = "{{HOST}}";
const PUBLISHABLE_KEY = "{{CLIENT_ID}}"; // safe to keep in code

function loadOutreach() {
  if (window.Outreach) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `${HOST}/embed.js`;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

const ask = (component) => fetch(`/outreach-start?component=${component}`, { cache: "no-store" }).then(async (r) => {
  const text = await r.text();
  try { return JSON.parse(text); } catch { throw new Error(`/outreach-start answered ${r.status} and not JSON: ${text.slice(0, 150)}`); }
});

export default function OutreachScreen({ component = "leads" }) {
  const box = useRef(null);

  useEffect(() => {
    let screen, win, gone = false;
    async function show() {
      await loadOutreach();
      if (gone) return;
      const outreach = window.Outreach(PUBLISHABLE_KEY, { host: HOST });
      const answer = await ask(component);
      if (gone) return;
      if (answer.connect_token) {
        win = outreach.connect({ connectToken: answer.connect_token, onConnected: () => { win.close(); show(); } });
        win.open({ mode: "modal" });
        return;
      }
      screen = outreach.create(component, { getToken: () => ask(component).then((a) => a.token), appearance: "auto" });
      screen.mount(box.current);
    }
    show().catch((err) => console.error("Outreach:", err.message));
    return () => { gone = true; if (screen) screen.destroy(); if (win) win.destroy(); };
  }, [component]);

  return <div ref={box} style={{ height: 700 }} />;
}
