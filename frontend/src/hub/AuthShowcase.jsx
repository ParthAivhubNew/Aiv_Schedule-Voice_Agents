import React, { useEffect, useState } from "react";
import { PhoneCall, CalendarCheck, Mail, Search, Share2, Sparkles } from "lucide-react";
import { C, FONT_DISPLAY, FONT_BODY } from "../tokens";
import { BrandMark } from "./BrandMark";

// The left half of the sign-in page: a moving picture of what OutReach does across its apps
// (AI Voice, Lead generation, Email campaigns, Post scheduler).
// Purely decorative (hidden from screen readers); the sample figures are illustrations.

const TRANSCRIPT = [
  { who: "agent", text: "Hi Sam, it's Ava from Acme. Is now a good time?" },
  { who: "caller", text: "Sure, go ahead." },
  { who: "agent", text: "Could we book 20 minutes on Thursday at 10:30?" },
  { who: "caller", text: "Thursday works." },
  { who: "agent", text: "Booked. You'll get the invite by email." },
];

function useTicker(length, ms) {
  const [n, setN] = useState(1);
  useEffect(() => {
    const t = setInterval(() => setN((x) => (x >= length + 2 ? 1 : x + 1)), ms);
    return () => clearInterval(t);
  }, [length, ms]);
  return Math.min(n, length);
}

function Counter({ to, ms = 1600 }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf;
    const start = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - start) / ms);
      setV(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to, ms]);
  return <>{v.toLocaleString()}</>;
}

export function AuthShowcase() {
  const shown = useTicker(TRANSCRIPT.length, 1700);
  return (
    <aside className="auth-show" aria-hidden="true">
      <style>{SHOW_CSS}</style>
      <div className="sh-glow sh-glow-a" />
      <div className="sh-glow sh-glow-b" />
      <div className="sh-grid" />

      <div className="sh-brand">
        <BrandMark size={34} />
        <span>OutReach <em>by Aivhub</em></span>
      </div>

      <div className="sh-card sh-calls" style={{ animationDelay: ".1s" }}>
        <div className="sh-label"><Search size={12} /> Leads found <span className="sh-up">↑ 24%</span></div>
        <div className="sh-big"><Counter to={1284} /></div>
        <div className="sh-bars">
          {[38, 52, 44, 66, 58, 74, 90].map((h, i) => (
            <span key={i} style={{ height: `${h}%`, animationDelay: `${i * 0.08}s` }} />
          ))}
        </div>
      </div>

      <div className="sh-card sh-status" style={{ animationDelay: ".25s" }}>
        <div className="sh-row-head"><span className="sh-label">Your apps</span><span className="sh-live"><i /> Live</span></div>
        {[
          ["AI Voice", 88, C.cobalt],
          ["Lead generation", 74, "#F59E0B"],
          ["Email campaigns", 64, C.teal],
          ["Post scheduler", 72, "#8B5CF6"],
        ].map(([label, w, colour], i) => (
          <div key={label} className="sh-line">
            <span>{label}</span>
            <div className="sh-track"><b style={{ width: `${w}%`, background: colour, animationDelay: `${0.4 + i * 0.2}s` }} /></div>
          </div>
        ))}
      </div>

      <div className="sh-card sh-transcript" style={{ animationDelay: ".4s" }}>
        <div className="sh-row-head">
          <span className="sh-label"><PhoneCall size={12} /> AI call · Sam, Acme Ltd</span>
          <span className="sh-wave">{[0, 1, 2, 3, 4].map((i) => <i key={i} style={{ animationDelay: `${i * 0.12}s` }} />)}</span>
        </div>
        <div className="sh-msgs">
          {TRANSCRIPT.slice(0, shown).map((m, i) => (
            <div key={i} className={`sh-msg ${m.who}`}>{m.text}</div>
          ))}
        </div>
      </div>

      <div className="sh-card sh-ring" style={{ animationDelay: ".55s" }}>
        <svg width="74" height="74" viewBox="0 0 74 74">
          <circle cx="37" cy="37" r="30" fill="none" stroke="rgba(52,87,213,.15)" strokeWidth="7" />
          <circle cx="37" cy="37" r="30" fill="none" stroke="url(#shRing)" strokeWidth="7" strokeLinecap="round"
            strokeDasharray="188.5" strokeDashoffset="188.5" className="sh-ring-arc" transform="rotate(-90 37 37)" />
          <defs>
            <linearGradient id="shRing" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#5B7BFF" /><stop offset="1" stopColor="#19B3A0" /></linearGradient>
          </defs>
        </svg>
        <div className="sh-ring-num"><Counter to={82} />%</div>
        <div className="sh-ring-label"><Mail size={11} /> Email open rate</div>
      </div>

      <div className="sh-card sh-post" style={{ animationDelay: ".7s" }}>
        <div className="sh-row-head"><span className="sh-label"><Share2 size={12} /> Post scheduled</span><span className="sh-when">Tue 09:00</span></div>
        <div className="sh-post-img" />
        <div className="sh-post-text">New case study: how Acme booked 40 meetings in a month.</div>
        <div className="sh-nets">{["LinkedIn", "Instagram", "Facebook", "X"].map((n) => <span key={n}>{n}</span>)}</div>
      </div>

      <div className="sh-card sh-chip" style={{ animationDelay: ".85s" }}>
        <CalendarCheck size={14} color="#19B3A0" /> Meeting booked · invite sent
      </div>

      <div className="sh-foot">
        <div className="sh-tag"><Sparkles size={14} /> AI calls, leads, email and social posts</div>
        <h2>Find <span>·</span> Reach <span>·</span> Book <span>·</span> Grow</h2>
        <p>Find new leads, call them with an AI agent that sounds human, follow up by email and WhatsApp, and keep your social pages busy, all from one place.</p>
      </div>
    </aside>
  );
}

const SHOW_CSS = `
.auth-show { position: relative; overflow: hidden; min-height: 100vh; color: #fff; font-family: ${FONT_BODY};
  background: radial-gradient(1200px 700px at 15% 10%, #22346F 0%, transparent 60%), linear-gradient(160deg, #141B38 0%, #12141C 55%, #0D2A2A 100%); }
.sh-grid { position: absolute; inset: 0; background-image: linear-gradient(rgba(255,255,255,.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.04) 1px, transparent 1px);
  background-size: 44px 44px; mask-image: radial-gradient(ellipse at 50% 40%, #000 30%, transparent 75%); }
.sh-glow { position: absolute; border-radius: 50%; filter: blur(70px); opacity: .55; animation: shDrift 14s ease-in-out infinite alternate; }
.sh-glow-a { width: 420px; height: 420px; background: #3457D5; left: -80px; top: 20%; }
.sh-glow-b { width: 380px; height: 380px; background: #0C8C7D; right: -60px; bottom: 5%; animation-delay: -6s; }
.sh-brand { position: absolute; left: 48px; top: 40px; display: flex; align-items: center; gap: 10px; font-family: ${FONT_DISPLAY}; font-weight: 700; font-size: 20px; z-index: 2; }
.sh-brand em { font-style: normal; color: #8FA6FF; }
.sh-card { position: absolute; z-index: 2; background: rgba(255,255,255,.93); color: ${C.textInk}; border-radius: 16px; padding: 14px 16px;
  box-shadow: 0 20px 50px rgba(0,0,0,.35), inset 0 1px 0 rgba(255,255,255,.6); backdrop-filter: blur(8px);
  animation: shEnter .8s cubic-bezier(.16,1,.3,1) both, shFloat 7s ease-in-out infinite; }
.sh-label { font-size: 11.5px; font-weight: 600; color: ${C.slate}; display: inline-flex; align-items: center; gap: 6px; letter-spacing: .02em; }
.sh-up { color: #16A34A; font-weight: 700; }
.sh-big { font-family: ${FONT_DISPLAY}; font-weight: 700; font-size: 30px; letter-spacing: -0.03em; margin: 2px 0 8px; }
.sh-calls { left: 7%; top: 17%; width: 210px; }
.sh-bars { display: flex; align-items: flex-end; gap: 5px; height: 38px; }
.sh-bars span { flex: 1; border-radius: 4px 4px 2px 2px; background: linear-gradient(180deg, #5B7BFF, #3457D5); transform-origin: bottom; animation: shGrow 1s cubic-bezier(.16,1,.3,1) both; }
.sh-status { right: 7%; top: 13%; width: 270px; animation-duration: .8s, 8s; }
.sh-row-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
.sh-live { font-size: 11.5px; font-weight: 700; color: #16A34A; display: inline-flex; align-items: center; gap: 6px; }
.sh-live i { width: 7px; height: 7px; border-radius: 50%; background: #16A34A; box-shadow: 0 0 0 0 rgba(22,163,74,.6); animation: shPulse 1.6s infinite; }
.sh-line { display: grid; grid-template-columns: 110px 1fr; align-items: center; gap: 10px; font-size: 12px; color: ${C.slate}; margin-top: 7px; }
.sh-track { height: 6px; border-radius: 3px; background: #EEF0F4; overflow: hidden; }
.sh-track b { display: block; height: 100%; border-radius: 3px; transform-origin: left; animation: shFill 1.4s cubic-bezier(.16,1,.3,1) both; }
.sh-transcript { left: 12%; top: 42%; width: min(380px, 44%); animation-duration: .8s, 9s; }
.sh-msgs { display: flex; flex-direction: column; gap: 6px; min-height: 150px; }
.sh-msg { max-width: 85%; font-size: 12.5px; line-height: 1.4; padding: 7px 10px; border-radius: 12px; animation: shMsg .45s cubic-bezier(.16,1,.3,1) both; }
.sh-msg.agent { background: ${C.cobaltSoft}; color: ${C.cobaltDeep}; border-bottom-left-radius: 4px; align-self: flex-start; }
.sh-msg.caller { background: #F1F0EC; color: ${C.textInk}; border-bottom-right-radius: 4px; align-self: flex-end; }
.sh-wave { display: inline-flex; align-items: center; gap: 3px; height: 16px; }
.sh-wave i { width: 3px; height: 100%; border-radius: 2px; background: ${C.cobalt}; animation: shWave 1s ease-in-out infinite; }
.sh-ring { right: 14%; top: 40%; width: 132px; text-align: center; padding: 16px 12px 12px; animation-duration: .8s, 6.5s; }
.sh-ring svg { display: block; margin: 0 auto; }
.sh-ring-arc { animation: shArc 1.8s .6s cubic-bezier(.16,1,.3,1) forwards; }
.sh-ring-num { position: absolute; top: 40px; left: 0; right: 0; font-family: ${FONT_DISPLAY}; font-weight: 700; font-size: 16px; }
.sh-ring-label { font-size: 11.5px; font-weight: 600; color: ${C.slate}; margin-top: 6px; display: flex; align-items: center; justify-content: center; gap: 4px; }
.sh-post { right: 7%; top: 58%; width: 250px; padding: 12px 14px; animation-duration: .8s, 7.5s; }
.sh-when { font-size: 11px; font-weight: 700; color: #8B5CF6; }
.sh-post-img { height: 40px; border-radius: 10px; background: linear-gradient(120deg, #E0E7FF, #EDE9FE 50%, #CCFBF1); background-size: 200% 100%; animation: shShine 4s ease-in-out infinite alternate; }
.sh-post-text { font-size: 12px; line-height: 1.4; margin: 8px 0; }
.sh-nets { display: flex; gap: 4px; }
.sh-nets span { font-size: 10.5px; font-weight: 600; color: ${C.slate}; background: #F1F0EC; border-radius: 999px; padding: 2px 8px; }
.sh-chip { left: 14%; top: 66%; display: flex; align-items: center; gap: 8px; font-size: 12.5px; font-weight: 600; padding: 9px 13px; border-radius: 999px; animation-duration: .8s, 8.5s; }
.sh-foot { position: absolute; left: 48px; right: 48px; bottom: 44px; z-index: 2; }
.sh-tag { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: #BFD0FF; background: rgba(91,123,255,.16); border: 1px solid rgba(143,166,255,.3); padding: 5px 10px; border-radius: 999px; margin-bottom: 14px; }
.sh-foot h2 { font-family: ${FONT_DISPLAY}; font-size: 34px; letter-spacing: -0.03em; margin: 0 0 8px; }
.sh-foot h2 span { color: #19B3A0; }
.sh-foot p { margin: 0; max-width: 460px; font-size: 14.5px; line-height: 1.55; color: rgba(255,255,255,.72); }
@keyframes shEnter { from { opacity: 0; transform: translateY(24px) scale(.96); } to { opacity: 1; transform: none; } }
@keyframes shFloat { 0%,100% { translate: 0 0; } 50% { translate: 0 -10px; } }
@keyframes shDrift { from { transform: translate(0,0) scale(1); } to { transform: translate(60px,-40px) scale(1.15); } }
@keyframes shGrow { from { transform: scaleY(0); } to { transform: scaleY(1); } }
@keyframes shFill { from { transform: scaleX(0); } to { transform: scaleX(1); } }
@keyframes shPulse { 0% { box-shadow: 0 0 0 0 rgba(22,163,74,.6); } 70% { box-shadow: 0 0 0 8px rgba(22,163,74,0); } 100% { box-shadow: 0 0 0 0 rgba(22,163,74,0); } }
@keyframes shMsg { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@keyframes shWave { 0%,100% { transform: scaleY(.3); } 50% { transform: scaleY(1); } }
@keyframes shShine { from { background-position: 0% 0; } to { background-position: 100% 0; } }
@keyframes shArc { to { stroke-dashoffset: 34; } }
@media (max-height: 760px) { .sh-chip, .sh-post { display: none; } }
`;
