import React from "react";
import { FONT_BODY } from "../tokens";
import { APPS } from "./apps";

// The left half of the sign-in page (wide screens only): what Outreach is, in one sentence,
// and its three apps. The logo sits above the form on the right.
export function AuthShowcase() {
  return (
    <aside className="auth-show">
      <style>{SHOW_CSS}</style>
      <div className="sh-body">
        <h2>Find, Connect &amp; Engage</h2>
        <p>Find leads, call them with AI, and stay in touch on social media. Three apps that share one company profile and one team.</p>
        <ul className="sh-apps">
          {APPS.map((app) => {
            const Icon = app.icon;
            return (
              <li key={app.id}>
                <span className="sh-icon" style={{ background: app.accent }}><Icon size={18} /></span>
                <div>
                  <strong>{app.name}</strong>
                  <span className="sh-desc">{app.blurb}</span>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
}

const SHOW_CSS = `
.auth-show { position: relative; display: flex; flex-direction: column; min-height: 100vh; box-sizing: border-box; padding: 40px clamp(32px, 5vw, 64px); color: #fff; font-family: ${FONT_BODY};
  background: radial-gradient(900px 600px at 0% 0%, rgba(52,87,213,.22), transparent 60%), #111520; }
.sh-body { margin: auto 0; max-width: 500px; padding: 48px 0; }
.sh-body h2 { font-size: clamp(28px, 3vw, 38px); font-weight: 600; line-height: 1.2; letter-spacing: -0.02em; margin: 0 0 14px; text-wrap: balance; }
.sh-body > p { font-size: 15px; line-height: 1.55; color: #A7AEBD; margin: 0 0 36px; }
.sh-apps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 22px; }
.sh-apps li { display: flex; gap: 14px; align-items: flex-start; }
.sh-icon { width: 36px; height: 36px; border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; color: #fff; }
.sh-apps strong { display: block; font-size: 15px; font-weight: 600; margin-bottom: 3px; }
.sh-desc { display: block; font-size: 13.5px; line-height: 1.5; color: #A7AEBD; }
`;
