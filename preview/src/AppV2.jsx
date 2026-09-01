import React, { useState } from "react";
import {
  PhoneCall,
  Calendar,
  Clock,
  AlertTriangle,
  PlusCircle,
  X,
  Radio,
  Mic,
  PhoneOff,
  Headphones,
  Quote,
  History,
  Settings2,
  ChevronRight,
  ChevronDown,
  UploadCloud,
  Ban,
  CalendarClock,
  Building2,
  Check,
} from "lucide-react";
import Papa from "papaparse";

/* ---------------------------------- tokens ---------------------------------- */

const C = {
  ink: "#12141C",
  inkLine: "#2A2D3A",
  paper: "#F6F5F2",
  paperCard: "#FFFFFF",
  paperSoft: "#EFEDE8",
  border: "#E4E1D9",
  cobalt: "#3457D5",
  cobaltSoft: "#EAEEFC",
  cobaltDeep: "#26409E",
  teal: "#0C8C7D",
  tealSoft: "#E4F5F2",
  amber: "#B8760A",
  amberSoft: "#FCEFDA",
  red: "#C2410C",
  redSoft: "#FBEAE8",
  green: "#15803D",
  greenSoft: "#E7F5EB",
  slate: "#6B7280",
  slateLight: "#9CA3AF",
  textInk: "#1B1D24",
};

const FONT_DISPLAY = "'Space Grotesk', sans-serif";
const FONT_BODY = "'Inter', sans-serif";
const FONT_MONO = "'JetBrains Mono', monospace";

const STATUS = {
  live: { label: "On a call", bg: C.cobaltSoft, fg: C.cobaltDeep },
  needs_you: { label: "Needs you", bg: C.redSoft, fg: C.red },
  meeting: { label: "Meeting booked", bg: C.greenSoft, fg: C.green },
  callback: { label: "Call back later", bg: C.tealSoft, fg: C.teal },
  dnc: { label: "Don't call", bg: C.paperSoft, fg: C.slate },
  queued: { label: "In queue", bg: C.cobaltSoft, fg: C.cobaltDeep },
  done: { label: "Done", bg: C.paperSoft, fg: C.slate },
  skipped: { label: "Already known", bg: C.amberSoft, fg: C.amber },
};

function Badge({ status }) {
  const s = STATUS[status] || STATUS.done;
  return (
    <span style={{ background: s.bg, color: s.fg, fontFamily: FONT_BODY, fontSize: 11, fontWeight: 600, padding: "3px 8px", borderRadius: 999, whiteSpace: "nowrap" }}>
      {s.label}
    </span>
  );
}

function Pulse() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 3, height: 14 }}>
      {[0, 1, 2, 3].map((i) => (
        <span key={i} style={{ display: "inline-block", width: 3, borderRadius: 2, background: C.cobalt, animation: `pulseBar 1s ease-in-out ${i * 0.12}s infinite` }} />
      ))}
    </div>
  );
}

/* ---------------------------------- seed: one record per company ---------------------------------- */

const INITIAL_COMPANIES = [
  {
    id: "acme",
    name: "Acme Logistics Ltd",
    aliases: ["ACME LOGISTICS LIMITED", "Acme Logistics"],
    contact: "James Whitfield · Ops Director",
    phone: "+44 161 496 0123",
    sector: "Logistics",
    region: "Manchester",
    listId: "l1",
    status: "meeting",
    dnc: false,
    next: { kind: "meeting", day: "Thu 3 Sep", time: "14:00", format: "video", quote: "Yeah, put something in for Thursday afternoon." },
    log: [
      {
        id: "lg1",
        at: "26 Aug, 14:32",
        channel: "voice",
        outcome: "meeting",
        quote: "Yeah, put something in for Thursday afternoon.",
        transcript: [
          { who: "ai", text: "Hi, this is Sam calling on behalf of AIVHub — do you have a quick minute?" },
          { who: "them", text: "Sure, what's this about?" },
          { who: "ai", text: "We build BI dashboards for logistics operators. How does your team track dispatch today?" },
          { who: "them", text: "Mostly spreadsheets, honestly. It's a mess." },
          { who: "ai", text: "Would a 15-minute call Thursday work?" },
          { who: "them", text: "Yeah, put something in for Thursday afternoon." },
        ],
      },
    ],
  },
  {
    id: "nfc",
    name: "Northern Freight Co",
    aliases: ["Northern Freight Company", "NFC Ltd"],
    contact: "Ops lead",
    phone: "+44 161 220 4471",
    sector: "Logistics",
    region: "Manchester",
    listId: "l1",
    status: "live",
    dnc: false,
    next: null,
    log: [],
  },
  {
    id: "pennine",
    name: "Pennine Distribution",
    aliases: ["Pennine Dist", "Pennine Distribution Ltd"],
    contact: "Tom Radcliffe · Finance Director",
    phone: "+44 161 998 3345",
    sector: "Logistics",
    region: "Manchester",
    listId: "l1",
    status: "needs_you",
    dnc: false,
    next: null,
    log: [
      {
        id: "lg2",
        at: "26 Aug, 13:12",
        channel: "voice",
        outcome: "needs_you",
        quote: "What exactly does this cost us, roughly?",
        transcript: [
          { who: "ai", text: "Hi Tom, Sam from AIVHub — do you have a moment?" },
          { who: "them", text: "What exactly does this cost us, roughly?" },
        ],
      },
    ],
  },
  {
    id: "speedy",
    name: "Speedy Haulage",
    aliases: ["Speedy Haulage Ltd"],
    contact: "Priya Nair · MD",
    phone: "+44 161 774 5510",
    sector: "Logistics",
    region: "Manchester",
    listId: "l1",
    status: "dnc",
    dnc: true,
    next: null,
    log: [
      {
        id: "lg3",
        at: "26 Aug, 10:41",
        channel: "voice",
        outcome: "dnc",
        quote: "Not interested, please don't call this number again.",
        transcript: [
          { who: "ai", text: "Hi Priya, this is Sam from AIVHub — got a minute?" },
          { who: "them", text: "Not interested, please don't call this number again." },
        ],
      },
    ],
  },
  {
    id: "coventry",
    name: "Coventry Precision Ltd",
    aliases: ["Coventry Precision"],
    contact: "Plant contact",
    phone: "+44 247 611 4402",
    sector: "Manufacturing",
    region: "Coventry",
    listId: "l2",
    status: "callback",
    dnc: false,
    next: { kind: "callback", day: "Mon 31 Aug", time: "10:00", quote: "Call me back next week, Monday morning if you can." },
    log: [
      {
        id: "lg4",
        at: "26 Aug, 16:05",
        channel: "voice",
        outcome: "callback",
        quote: "Call me back next week, Monday morning if you can.",
        transcript: [
          { who: "ai", text: "Hi, Sam from AIVHub — is now an OK time?" },
          { who: "them", text: "Caught me on the shop floor. Call me back next week, Monday morning if you can." },
        ],
      },
    ],
  },
  {
    id: "wessex",
    name: "Wessex Components",
    aliases: ["Wessex Components Ltd"],
    contact: "Site contact",
    phone: "+44 238 220 1104",
    sector: "Manufacturing",
    region: "Southampton",
    listId: "l2",
    status: "live",
    dnc: false,
    next: null,
    log: [],
  },
  {
    id: "greenmile",
    name: "Green Mile Logistics",
    aliases: [],
    contact: "—",
    phone: "+44 161 552 9081",
    sector: "Logistics",
    region: "Manchester",
    listId: "l1",
    status: "queued",
    dnc: false,
    next: { kind: "call", day: "Today, 27 Aug", time: "09:30", quote: null },
    log: [],
  },
  {
    id: "ferrum",
    name: "Ferrum Manufacturing",
    aliases: ["Ferrum Mfg"],
    contact: "David Oyelaran · COO",
    phone: "+44 113 220 5541",
    sector: "Manufacturing",
    region: "Leeds",
    listId: "l3",
    status: "meeting",
    dnc: false,
    next: { kind: "meeting", day: "Fri 21 Aug", time: "11:00", format: "phone", quote: "Friday works." },
    log: [
      {
        id: "lg5",
        at: "20 Aug, 10:51",
        channel: "voice",
        outcome: "meeting",
        quote: "Friday works.",
        transcript: [
          { who: "ai", text: "Would a short call Friday 11am work?" },
          { who: "them", text: "Friday works." },
        ],
      },
    ],
  },
];

const INITIAL_LISTS = [
  { id: "l1", title: "Logistics — Manchester", created: "24 Aug" },
  { id: "l2", title: "Q3 warm leads", created: "26 Aug" },
  { id: "l3", title: "Manufacturing SMEs — Leeds", created: "20 Aug" },
];

const INITIAL_LIVE = [
  {
    id: "live-nfc",
    companyId: "nfc",
    channel: "voice",
    duration: "02:14",
    state: "talking",
    transcript: [
      "AI: Would Thursday at 2pm work for a short call with your ops lead?",
      "Prospect: Let me check — maybe Wednesday instead.",
      "AI: Wednesday works well — morning or afternoon suits better?",
    ],
  },
  {
    id: "live-wessex",
    companyId: "wessex",
    channel: "voice",
    duration: "01:08",
    state: "talking",
    transcript: [
      "AI: Would a 15-minute call next week work to see if we're a fit?",
      "Prospect: I am busy right now and have nothing for you at the moment. Give me a call in 6 months as I may have a new project by then.",
    ],
  },
];

/* ---------------------------------- when they asked ---------------------------------- */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function addMonthsLabel(n) {
  const d = new Date(Date.UTC(2026, 7, 27));
  d.setUTCMonth(d.getUTCMonth() + n);
  return `${DOW[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function themLines(transcript) {
  return (transcript || [])
    .map((l) => (typeof l === "string" ? l : `${l.who === "them" ? "Prospect" : "AI"}: ${l.text}`))
    .filter((l) => /^Prospect:/i.test(l))
    .map((l) => l.replace(/^Prospect:\s*/i, ""));
}

function lockTranscript(lines) {
  return (lines || []).map((l) => {
    if (typeof l !== "string") return { who: l.who, text: l.text };
    return { who: /^AI:/i.test(l) ? "ai" : "them", text: l.replace(/^AI:\s*|^Prospect:\s*/i, "") };
  });
}

// reads THEIR words only. "in 6 months" is a callback, not a meeting.
function extractWhen(transcript) {
  const them = themLines(transcript);
  if (!them.length) return null;
  const exact =
    them.find((t) =>
      /month|week|quarter|monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|afternoon|morning|\d{1,2}(:\d{2})?\s*(am|pm)|busy|call me|nothing for you/i.test(t)
    ) || them[them.length - 1];
  const lower = exact.toLowerCase();

  const monthsN = lower.match(/in\s+(\d+)\s+months?/) || lower.match(/(\d+)\s+months?/);
  if (monthsN || /few months|next quarter/.test(lower)) {
    const n = monthsN ? parseInt(monthsN[1], 10) : 3;
    return { kind: "callback", day: addMonthsLabel(n), time: "10:00", quote: exact };
  }

  if (/not interested|don't call|do not call|nothing for you/.test(lower) && !/call me|give me a call|in \d/.test(lower)) {
    return { kind: "dnc", day: null, time: null, quote: exact };
  }

  let time = "14:00";
  if (/morning/.test(lower)) time = "10:00";
  else if (/afternoon/.test(lower)) time = "14:00";
  const tm = lower.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if (tm) {
    let h = parseInt(tm[1], 10);
    const min = tm[2] || "00";
    const ap = (tm[3] || "").toLowerCase();
    if (ap === "pm" && h < 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
    time = `${String(h).padStart(2, "0")}:${min}`;
  }

  const nextWeek = /next week/.test(lower);
  let day = null;
  if (/tomorrow/.test(lower)) day = "Tomorrow, 28 Aug";
  else if (/monday/.test(lower)) day = nextWeek ? "Mon 7 Sep" : "Mon 31 Aug";
  else if (/tuesday/.test(lower)) day = "Tue 1 Sep";
  else if (/wednesday/.test(lower)) day = "Wed 2 Sep";
  else if (/thursday/.test(lower)) day = nextWeek ? "Thu 3 Sep" : "Today, 27 Aug";
  else if (/friday/.test(lower)) day = nextWeek ? "Fri 4 Sep" : "Tomorrow, 28 Aug";
  else if (nextWeek) day = "Mon 31 Aug";

  if (!day) return { kind: "callback", day: addMonthsLabel(1), time: "10:00", quote: exact };
  return { kind: "meeting", day, time, quote: exact };
}

function normCompany(raw) {
  return (raw || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9\s]/g, " ").replace(/\b(ltd|limited|llp|plc|inc|co|company|group|the|uk)\b/g, " ").replace(/\s+/g, " ").trim();
}

function findKnown(name, companies) {
  const n = normCompany(name);
  if (!n) return null;
  return companies.find((c) => [c.name, ...(c.aliases || [])].some((a) => normCompany(a) === n)) || null;
}

function nowStamp() {
  return "27 Aug, " + new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
}

/* ---------------------------------- chrome ---------------------------------- */

const NAV = [
  { id: "today", label: "Today", icon: Radio },
  { id: "lists", label: "Lists", icon: Building2 },
  { id: "calendar", label: "Calendar", icon: Calendar },
  { id: "setup", label: "Setup", icon: Settings2 },
];

function Sidebar({ view, setView, callerName, companyName }) {
  return (
    <div style={{ width: 200, minWidth: 200, background: C.ink, height: "100vh", display: "flex", flexDirection: "column", padding: "22px 12px", boxSizing: "border-box" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 8px 22px" }}>
        <div style={{ width: 28, height: 28, borderRadius: 8, background: `linear-gradient(135deg, ${C.cobalt}, ${C.teal})`, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <PhoneCall size={15} color="#fff" strokeWidth={2.4} />
        </div>
        <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18, color: "#fff" }}>AIVHub</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
        {NAV.map((n) => {
          const Icon = n.icon;
          const active = view === n.id;
          return (
            <button
              key={n.id}
              onClick={() => setView(n.id)}
              style={{
                display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 8, border: "none", cursor: "pointer",
                background: active ? "rgba(255,255,255,0.08)" : "transparent", color: active ? "#fff" : "#9AA0AE",
                fontFamily: FONT_BODY, fontSize: 14, fontWeight: 500, textAlign: "left",
              }}
            >
              <Icon size={16} /> {n.label}
            </button>
          );
        })}
      </div>
      <div style={{ padding: "12px 10px", borderTop: `1px solid ${C.inkLine}`, fontFamily: FONT_BODY, fontSize: 11, color: "#5B6070" }}>
        Speaks as <span style={{ color: "#C8CCD6", fontWeight: 600 }}>{callerName}</span>, for {companyName}
      </div>
    </div>
  );
}

function PageHead({ title, sub, right }) {
  return (
    <div style={{ padding: "22px 32px 16px", display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16 }}>
      <div>
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 24, fontWeight: 700, color: C.textInk, letterSpacing: "-0.02em" }}>{title}</div>
        {sub && <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.slate, marginTop: 4 }}>{sub}</div>}
      </div>
      {right}
    </div>
  );
}

function PrimaryBtn({ children, onClick, color }) {
  return (
    <button onClick={onClick} style={{ background: color || C.ink, color: "#fff", border: "none", borderRadius: 8, padding: "9px 14px", fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
      {children}
    </button>
  );
}

function GhostBtn({ children, onClick, danger }) {
  return (
    <button onClick={onClick} style={{ background: "#fff", border: `1px solid ${danger ? C.red : C.border}`, color: danger ? C.red : C.textInk, borderRadius: 8, padding: "8px 12px", fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
      {children}
    </button>
  );
}

/* ---------------------------------- company panel (one place for a company) ---------------------------------- */

function CompanyPanel({ company, onClose }) {
  if (!company) return null;
  const last = (company.log || [])[0];
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(18,20,28,0.4)", zIndex: 40, display: "flex", justifyContent: "flex-end" }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 440, maxWidth: "100%", height: "100%", background: "#fff", boxShadow: "-12px 0 40px rgba(0,0,0,0.12)", overflowY: "auto", padding: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 20, color: C.textInk }}>{company.name}</div>
            <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate, marginTop: 4 }}>{company.contact} · {company.region}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} color={C.slate} /></button>
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          <Badge status={company.status} />
          {company.dnc && <Badge status="dnc" />}
        </div>
        {company.aliases?.length > 0 && (
          <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.amber, marginBottom: 14 }}>Also listed as {company.aliases.join(", ")}</div>
        )}
        {company.next && (
          <div style={{ background: company.next.kind === "meeting" ? C.greenSoft : C.tealSoft, borderRadius: 10, padding: 12, marginBottom: 16 }}>
            <div style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: company.next.kind === "meeting" ? C.green : C.teal, marginBottom: 4 }}>
              {company.next.kind === "meeting" ? "NEXT: MEETING" : company.next.kind === "callback" ? "NEXT: CALL THEM BACK" : "NEXT: WE CALL"}
            </div>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 15, color: C.textInk }}>{company.next.day} · {company.next.time}</div>
            {company.next.quote && (
              <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.textInk, fontStyle: "italic", marginTop: 8, display: "flex", gap: 6 }}>
                <Quote size={13} style={{ flexShrink: 0, marginTop: 2 }} /> “{company.next.quote}”
              </div>
            )}
          </div>
        )}
        <div style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.slate, letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 8 }}>What they said — never edited</div>
        {(company.log || []).length === 0 && <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.slateLight }}>No calls yet.</div>}
        {(company.log || []).map((e) => (
          <div key={e.id} style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, marginBottom: 10 }}>
            <div style={{ fontFamily: FONT_MONO, fontSize: 11, color: C.slate, marginBottom: 8 }}>{e.at} · {e.channel}</div>
            {(e.transcript || []).map((line, i) => (
              <div key={i} style={{ fontFamily: FONT_BODY, fontSize: 13, lineHeight: 1.45, color: line.who === "them" ? C.textInk : C.cobaltDeep, marginBottom: 6, fontStyle: line.who === "them" ? "italic" : "normal" }}>
                {line.who === "them" ? "Them: " : "Sam: "}{line.text}
              </div>
            ))}
          </div>
        ))}
        {last && (
          <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.teal, marginTop: 8, display: "flex", alignItems: "center", gap: 5 }}>
            <History size={12} /> Last saved {last.at} — words locked
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------- today ---------------------------------- */

function TodayView({ companies, live, onOpenCompany, onOutcome, onListen, onTake, onEnd }) {
  const needs = companies.filter((c) => c.status === "needs_you");
  const activeLive = live.filter((l) => !l.ended);
  const todayCal = companies.filter((c) => c.next && /today|27 aug|31 aug/i.test(c.next.day));

  return (
    <>
      <PageHead
        title="Today"
        sub={
          needs.length
            ? `${needs.length} need you · ${activeLive.length} live`
            : activeLive.length
              ? `${activeLive.length} live conversation${activeLive.length === 1 ? "" : "s"}`
              : "Nothing waiting — you're clear"
        }
      />
      <div style={{ padding: "0 32px 32px", display: "flex", flexDirection: "column", gap: 22 }}>
        {needs.length > 0 && (
          <section>
            <div style={{ fontFamily: FONT_BODY, fontSize: 12, fontWeight: 700, color: C.red, letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 8 }}>Needs you</div>
            {needs.map((c) => (
              <div key={c.id} onClick={() => onOpenCompany(c.id)} style={{ background: "#fff", border: `1px solid ${C.redSoft}`, borderRadius: 12, padding: 14, marginBottom: 8, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 15 }}>{c.name}</div>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate, marginTop: 3, fontStyle: "italic" }}>“{c.log[0]?.quote}”</div>
                </div>
                <GhostBtn onClick={(e) => { e.stopPropagation(); onOpenCompany(c.id); }}><AlertTriangle size={13} /> Open</GhostBtn>
              </div>
            ))}
          </section>
        )}

        <section>
          <div style={{ fontFamily: FONT_BODY, fontSize: 12, fontWeight: 700, color: C.slate, letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 8 }}>Live</div>
          {activeLive.length === 0 && <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.slateLight }}>No live calls.</div>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 12 }}>
            {activeLive.map((l) => {
              const co = companies.find((c) => c.id === l.companyId);
              const guess = extractWhen(l.transcript);
              const suggest = guess?.kind || "meeting";
              return (
                <div key={l.id} style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <button onClick={() => onOpenCompany(l.companyId)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}>
                      <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 16, color: C.textInk }}>{co?.name}</div>
                      <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.slate, marginTop: 2 }}>{co?.contact}</div>
                    </button>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <Pulse />
                      <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: C.slate }}>{l.duration}</span>
                    </div>
                  </div>
                  <div style={{ background: C.paper, borderRadius: 8, padding: 10, margin: "12px 0", minHeight: 72 }}>
                    {l.transcript.map((line, i) => (
                      <div key={i} style={{ fontFamily: FONT_BODY, fontSize: 12.5, lineHeight: 1.4, color: line.startsWith("AI") ? C.cobaltDeep : C.textInk, marginBottom: 4, fontStyle: line.startsWith("Prospect") ? "italic" : "normal" }}>
                        {line}
                      </div>
                    ))}
                    {l.taken && <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.red, fontStyle: "italic" }}>— You're speaking —</div>}
                  </div>
                  {guess && (
                    <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.teal, marginBottom: 10, display: "flex", gap: 6 }}>
                      <Quote size={12} style={{ flexShrink: 0, marginTop: 2 }} />
                      Heard: {guess.kind === "callback" ? `call back ${guess.day}` : guess.kind === "dnc" ? "don't call again" : `meet ${guess.day} ${guess.time}`}
                    </div>
                  )}
                  <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                    <PrimaryBtn color={suggest === "meeting" ? C.green : C.ink} onClick={() => onOutcome(l, "meeting")}>
                      <Calendar size={13} /> Book meeting
                    </PrimaryBtn>
                    <PrimaryBtn color={suggest === "callback" ? C.teal : C.ink} onClick={() => onOutcome(l, "callback")}>
                      <CalendarClock size={13} /> Call back later
                    </PrimaryBtn>
                    <GhostBtn danger onClick={() => onOutcome(l, "dnc")}>
                      <Ban size={13} /> Don't call again
                    </GhostBtn>
                    <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                      <GhostBtn onClick={() => onTake(l.id)}><Mic size={12} /> {l.taken ? "Hand back" : "Take over"}</GhostBtn>
                      <GhostBtn onClick={() => onListen(l.id)}><Headphones size={12} /> {l.listening ? "Stop" : "Listen"}</GhostBtn>
                      <GhostBtn danger onClick={() => onEnd(l.id)}><PhoneOff size={12} /> End</GhostBtn>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section>
          <div style={{ fontFamily: FONT_BODY, fontSize: 12, fontWeight: 700, color: C.slate, letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 8 }}>Coming up</div>
          <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
            {todayCal.length === 0 && <div style={{ padding: 16, fontFamily: FONT_BODY, fontSize: 13, color: C.slateLight }}>Nothing else today.</div>}
            {todayCal.map((c, i) => (
              <div key={c.id} onClick={() => onOpenCompany(c.id)} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 16px", borderTop: i ? `1px solid ${C.border}` : "none", cursor: "pointer" }}>
                <div style={{ fontFamily: FONT_MONO, fontWeight: 600, width: 52 }}>{c.next.time}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: 13.5 }}>{c.name}</div>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.slate }}>{c.next.kind === "meeting" ? "Meeting" : c.next.kind === "callback" ? "Call them back" : "Outbound call"}</div>
                </div>
                <Badge status={c.status} />
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

/* ---------------------------------- lists ---------------------------------- */

function NewListModal({ onClose, onCreate, companies }) {
  const [mode, setMode] = useState("have");
  const [prompt, setPrompt] = useState("");
  const [paste, setPaste] = useState("");
  const [showAdv, setShowAdv] = useState(false);
  const [windowStart, setWindowStart] = useState("09:00");
  const [windowEnd, setWindowEnd] = useState("17:30");

  const names = paste.split("\n").map((l) => l.trim()).filter(Boolean);
  const knownHits = names.map((n) => ({ n, hit: findKnown(n, companies) })).filter((x) => x.hit);
  const fresh = names.filter((n) => !findKnown(n, companies));
  const can = mode === "find" ? prompt.length > 8 : names.length > 0;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(18,20,28,0.5)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ background: "#fff", borderRadius: 16, width: 520, maxHeight: "88vh", overflowY: "auto", padding: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18 }}>New list</div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} color={C.slate} /></button>
        </div>
        <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.slate, marginBottom: 16 }}>Two questions. That's it.</div>

        <div style={{ fontFamily: FONT_BODY, fontSize: 12, fontWeight: 700, color: C.slate, marginBottom: 8 }}>1. Who are we calling?</div>
        <div style={{ display: "flex", gap: 6, marginBottom: 12, background: C.paperSoft, padding: 4, borderRadius: 9 }}>
          {[
            ["have", "I have a list"],
            ["find", "Find companies"],
          ].map(([id, label]) => (
            <button key={id} onClick={() => setMode(id)} style={{ flex: 1, padding: "8px", border: "none", borderRadius: 7, cursor: "pointer", background: mode === id ? "#fff" : "transparent", fontFamily: FONT_BODY, fontWeight: 600, fontSize: 13, color: mode === id ? C.textInk : C.slate }}>
              {label}
            </button>
          ))}
        </div>
        {mode === "find" ? (
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="e.g. Mid-size logistics companies in Manchester" style={{ width: "100%", minHeight: 72, padding: 12, borderRadius: 10, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 14, resize: "none", outline: "none", boxSizing: "border-box" }} />
        ) : (
          <>
            <textarea value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={"One company per line\ne.g. ACME LOGISTICS LIMITED\nWessex Components"} style={{ width: "100%", minHeight: 100, padding: 12, borderRadius: 10, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 14, resize: "none", outline: "none", boxSizing: "border-box" }} />
            <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, fontFamily: FONT_BODY, fontSize: 12, color: C.slate, cursor: "pointer" }}>
              <UploadCloud size={13} />
              Or drop a CSV
              <input type="file" accept=".csv" style={{ display: "none" }} onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                Papa.parse(f, { header: true, skipEmptyLines: true, complete: (res) => {
                  const rows = res.data || [];
                  const key = Object.keys(rows[0] || {}).find((k) => /company|name|business/i.test(k)) || Object.keys(rows[0] || {})[0];
                  setPaste(rows.map((r) => r[key]).filter(Boolean).join("\n"));
                }});
              }} />
            </label>
            {knownHits.length > 0 && (
              <div style={{ marginTop: 10, background: C.amberSoft, borderRadius: 8, padding: 10, fontFamily: FONT_BODY, fontSize: 12.5, color: C.textInk, lineHeight: 1.45 }}>
                Won't call again: {knownHits.map((x) => `${x.n} (already ${STATUS[x.hit.status]?.label || x.hit.status})`).join(" · ")}
              </div>
            )}
          </>
        )}

        <div style={{ fontFamily: FONT_BODY, fontSize: 12, fontWeight: 700, color: C.slate, margin: "18px 0 8px" }}>2. When can we call?</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: FONT_BODY, fontSize: 13, color: C.slate }}>
          <Clock size={14} />
          <select value={windowStart} onChange={(e) => setWindowStart(e.target.value)} style={{ padding: "6px 8px", borderRadius: 7, border: `1px solid ${C.border}` }}>
            {["09:00", "09:30", "10:00"].map((t) => <option key={t}>{t}</option>)}
          </select>
          –
          <select value={windowEnd} onChange={(e) => setWindowEnd(e.target.value)} style={{ padding: "6px 8px", borderRadius: 7, border: `1px solid ${C.border}` }}>
            {["16:00", "17:00", "17:30"].map((t) => <option key={t}>{t}</option>)}
          </select>
          <span style={{ color: C.slateLight }}>UK 09:00–17:30</span>
        </div>

        <button onClick={() => setShowAdv((s) => !s)} style={{ marginTop: 14, background: "none", border: "none", color: C.slate, fontFamily: FONT_BODY, fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
          <ChevronDown size={13} style={{ transform: showAdv ? "none" : "rotate(-90deg)" }} /> Advanced
        </button>
        {showAdv && (
          <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate, padding: 10, background: C.paper, borderRadius: 8 }}>
            Channel and how many calls at once stay on defaults (voice, 5 at a time). Change later in Setup if you need to.
          </div>
        )}

        <button
          disabled={!can}
          onClick={() => can && onCreate({ mode, prompt, names: mode === "have" ? names : [], windowStart, windowEnd })}
          style={{ marginTop: 18, width: "100%", padding: 12, border: "none", borderRadius: 9, background: can ? C.ink : C.paperSoft, color: can ? "#fff" : C.slateLight, fontFamily: FONT_BODY, fontWeight: 600, fontSize: 14, cursor: can ? "pointer" : "default" }}
        >
          {mode === "have" ? `Start — call ${fresh.length}, skip ${knownHits.length}` : "Start finding"}
        </button>
      </div>
    </div>
  );
}

function ListsView({ lists, companies, onOpenCompany, onNew }) {
  const [openList, setOpenList] = useState(null);
  const detail = lists.find((l) => l.id === openList);

  if (detail) {
    const rows = companies.filter((c) => c.listId === detail.id);
    return (
      <>
        <div style={{ padding: "22px 32px 0" }}>
          <button onClick={() => setOpenList(null)} style={{ background: "none", border: "none", color: C.slate, fontFamily: FONT_BODY, fontSize: 13, cursor: "pointer" }}>← All lists</button>
        </div>
        <PageHead title={detail.title} sub={`${rows.length} companies · click any row for the full story`} />
        <div style={{ padding: "0 32px 32px" }}>
          <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
            {rows.map((c, i) => (
              <div key={c.id} onClick={() => onOpenCompany(c.id)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 16px", borderTop: i ? `1px solid ${C.border}` : "none", cursor: "pointer" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: 14 }}>{c.name}</div>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.slate }}>{c.next?.quote ? `“${c.next.quote}”` : c.contact}</div>
                </div>
                <Badge status={c.status} />
                <ChevronRight size={16} color={C.slateLight} />
              </div>
            ))}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHead title="Lists" sub="Who we're calling. One list at a time." right={<PrimaryBtn onClick={onNew}><PlusCircle size={15} /> New list</PrimaryBtn>} />
      <div style={{ padding: "0 32px 32px", display: "grid", gap: 12 }}>
        {lists.map((l) => {
          const rows = companies.filter((c) => c.listId === l.id);
          const meetings = rows.filter((c) => c.status === "meeting").length;
          const skipped = rows.filter((c) => c.status === "dnc" || c.status === "skipped").length;
          return (
            <div key={l.id} onClick={() => setOpenList(l.id)} style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, padding: 18, cursor: "pointer" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 16 }}>{l.title}</div>
                <ChevronRight size={16} color={C.slateLight} />
              </div>
              <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.slate, marginTop: 8 }}>
                {rows.length} companies · {meetings} meetings · {skipped} won't be called again
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ---------------------------------- calendar ---------------------------------- */

function CalendarView({ companies, onOpenCompany }) {
  const [filter, setFilter] = useState("all");
  const items = companies
    .filter((c) => c.next)
    .filter((c) => filter === "all" || c.next.kind === filter)
    .sort((a, b) => String(a.next.day).localeCompare(String(b.next.day)) || String(a.next.time).localeCompare(String(b.next.time)));
  const days = [...new Set(items.map((c) => c.next.day))];

  return (
    <>
      <PageHead title="Calendar" sub="Meetings, callbacks they asked for, and calls we still owe." />
      <div style={{ padding: "0 32px 32px" }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          {[
            ["all", "All"],
            ["meeting", "Meetings"],
            ["callback", "Call backs"],
            ["call", "Our calls"],
          ].map(([id, label]) => (
            <button key={id} onClick={() => setFilter(id)} style={{ padding: "6px 12px", borderRadius: 7, border: `1px solid ${filter === id ? C.ink : C.border}`, background: filter === id ? C.ink : "#fff", color: filter === id ? "#fff" : C.slate, fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
              {label}
            </button>
          ))}
        </div>
        {days.map((day) => (
          <div key={day} style={{ marginBottom: 18 }}>
            <div style={{ fontFamily: FONT_BODY, fontSize: 12, fontWeight: 700, color: C.slate, letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 6 }}>{day}</div>
            <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
              {items.filter((c) => c.next.day === day).map((c, i) => (
                <div key={c.id} onClick={() => onOpenCompany(c.id)} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 16px", borderTop: i ? `1px solid ${C.border}` : "none", cursor: "pointer" }}>
                  <div style={{ fontFamily: FONT_MONO, fontWeight: 600, width: 52 }}>{c.next.time}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: 13.5 }}>{c.name}</div>
                    {c.next.quote && <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.teal, fontStyle: "italic", marginTop: 2 }}>“{c.next.quote}”</div>}
                  </div>
                  <Badge status={c.next.kind === "meeting" ? "meeting" : c.next.kind === "callback" ? "callback" : "queued"} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

/* ---------------------------------- setup ---------------------------------- */

function SetupView({ profile, setProfile }) {
  const [saved, setSaved] = useState(false);
  const [stack, setStack] = useState("paid");
  const upd = (k, v) => setProfile((p) => ({ ...p, [k]: v }));
  const field = (label, key, hint) => (
    <label style={{ display: "block", marginBottom: 12 }}>
      <div style={{ fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 5 }}>{label}</div>
      <input value={profile[key] || ""} onChange={(e) => upd(key, e.target.value)} style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13.5, outline: "none", boxSizing: "border-box" }} />
      {hint && <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.slateLight, marginTop: 4 }}>{hint}</div>}
    </label>
  );
  return (
    <>
      <PageHead title="Setup" sub="Who the AI is, and how it calls. One page." />
      <div style={{ padding: "0 32px 32px", maxWidth: 560 }}>
        <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, marginBottom: 14 }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 15, marginBottom: 12 }}>Who we are</div>
          {field("Company name", "name")}
          {field("One-line pitch", "pitch")}
          {field("AI speaks as", "callerName", "Prospects hear this name, not the company name.")}
          {field("Tone", "tone")}
          <label style={{ display: "block", marginBottom: 12 }}>
            <div style={{ fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 5 }}>Opening disclosure</div>
            <textarea value={profile.disclosure || ""} onChange={(e) => upd("disclosure", e.target.value)} style={{ width: "100%", minHeight: 56, padding: "8px 10px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13.5, outline: "none", boxSizing: "border-box", resize: "none" }} />
          </label>
        </div>
        <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, marginBottom: 14 }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 15, marginBottom: 8 }}>Voice stack</div>
          <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate, marginBottom: 10 }}>Paid APIs or self-hosted. Keys live here; you don't pick a provider per call.</div>
          <div style={{ display: "flex", gap: 8 }}>
            {[["paid", "Paid / managed"], ["oss", "Open source"]].map(([id, label]) => (
              <button key={id} onClick={() => setStack(id)} style={{ flex: 1, padding: 12, borderRadius: 9, border: `2px solid ${stack === id ? C.ink : C.border}`, background: stack === id ? C.ink : "#fff", color: stack === id ? "#fff" : C.textInk, fontFamily: FONT_BODY, fontWeight: 600, fontSize: 13, cursor: "pointer" }}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <PrimaryBtn onClick={() => { setSaved(true); setTimeout(() => setSaved(false), 1600); }}>
          <Check size={14} /> Save
        </PrimaryBtn>
        {saved && <div style={{ marginTop: 10, fontFamily: FONT_BODY, fontSize: 12.5, color: C.teal }}>Saved — used on the next call</div>}
      </div>
    </>
  );
}

/* ---------------------------------- confirm overlay ---------------------------------- */

function ConfirmAction({ live, companies, kind, onCancel, onConfirm }) {
  const co = companies.find((c) => c.id === live.companyId);
  const parsed = extractWhen(live.transcript) || { kind, day: kind === "callback" ? addMonthsLabel(1) : "Wed 2 Sep", time: "14:00", quote: themLines(live.transcript).slice(-1)[0] || "" };
  const when = kind === "dnc" ? null : { ...parsed, kind: kind === "callback" ? "callback" : "meeting", day: kind === "callback" && parsed.kind !== "callback" ? addMonthsLabel(1) : parsed.day, time: parsed.time || (kind === "callback" ? "10:00" : "14:00") };

  const title = kind === "dnc" ? `Don't call ${co?.name} again` : kind === "callback" ? `Call ${co?.name} back when they asked` : `Book a meeting with ${co?.name}`;
  const body =
    kind === "dnc"
      ? "Saved to their record. They won't appear on new lists."
      : `We'll use their words, not a guessed slot:\n“${when.quote}”\n→ ${when.day} at ${when.time}`;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(18,20,28,0.5)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "#fff", borderRadius: 14, width: 420, padding: 22 }}>
        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17, marginBottom: 10 }}>{title}</div>
        <div style={{ fontFamily: FONT_BODY, fontSize: 13.5, color: C.textInk, whiteSpace: "pre-wrap", lineHeight: 1.5, marginBottom: 16 }}>{body}</div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <GhostBtn onClick={onCancel}>Cancel</GhostBtn>
          <PrimaryBtn color={kind === "dnc" ? C.red : kind === "callback" ? C.teal : C.green} onClick={() => onConfirm(when)}>
            Confirm
          </PrimaryBtn>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------- app ---------------------------------- */

export default function App() {
  const [view, setView] = useState("today");
  const [companies, setCompanies] = useState(INITIAL_COMPANIES);
  const [lists, setLists] = useState(INITIAL_LISTS);
  const [live, setLive] = useState(INITIAL_LIVE.map((l) => ({ ...l, taken: false, listening: false, ended: false })));
  const [openId, setOpenId] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [pending, setPending] = useState(null);
  const [toast, setToast] = useState(null);
  const [profile, setProfile] = useState({
    name: "AIVHub",
    pitch: "AI-powered BI dashboards for mid-market ops teams",
    callerName: "Sam",
    tone: "Professional, concise, friendly",
    disclosure: "This call may be recorded for quality and training purposes.",
  });

  const flash = (text) => {
    setToast(text);
    setTimeout(() => setToast(null), 2800);
  };

  const patchCompany = (id, fn) => setCompanies((cs) => cs.map((c) => (c.id === id ? fn(c) : c)));

  const applyOutcome = (item, kind, when) => {
    const locked = lockTranscript(item.transcript);
    const quote = when?.quote || themLines(item.transcript).slice(-1)[0] || "";
    patchCompany(item.companyId, (c) => ({
      ...c,
      status: kind === "dnc" ? "dnc" : kind === "callback" ? "callback" : "meeting",
      dnc: kind === "dnc",
      next: kind === "dnc" ? null : { kind, day: when.day, time: when.time, quote, format: kind === "meeting" ? "video" : undefined },
      log: [
        {
          id: "lg_" + Date.now(),
          at: nowStamp(),
          channel: item.channel,
          outcome: kind,
          quote,
          transcript: locked,
        },
        ...(c.log || []),
      ],
    }));
    setLive((ls) => ls.map((l) => (l.id === item.id ? { ...l, ended: true } : l)));
    setPending(null);
    if (kind === "dnc") flash(`${item.companyId} — won't be called again. Words saved.`);
    else flash(`Saved. Next: ${when.day} ${when.time}. Their words locked.`);
  };

  const createList = (payload) => {
    setShowNew(false);
    if (payload.mode === "find") {
      const id = "l_" + Date.now();
      setLists((ls) => [{ id, title: payload.prompt.slice(0, 42) || "New search", created: "just now" }, ...ls]);
      flash("List queued — we'll find matching companies (demo).");
      setView("lists");
      return;
    }
    const id = "l_" + Date.now();
    setLists((ls) => [{ id, title: `List — ${payload.names.length} names`, created: "just now" }, ...ls]);
    const added = payload.names.map((name, i) => {
      const hit = findKnown(name, companies);
      if (hit) {
        return {
          id: "co_" + Date.now() + "_" + i,
          name,
          aliases: [],
          contact: "—",
          phone: "",
          sector: "—",
          region: "—",
          listId: id,
          status: "skipped",
          dnc: hit.dnc,
          next: hit.next,
          log: [{ id: "lg_s" + i, at: nowStamp(), channel: "system", outcome: "skipped", quote: null, transcript: [{ who: "ai", text: `Skipped — same company as ${hit.name} (${STATUS[hit.status]?.label}).` }] }],
        };
      }
      return {
        id: "co_" + Date.now() + "_" + i,
        name,
        aliases: [],
        contact: "—",
        phone: "",
        sector: "—",
        region: "Uploaded",
        listId: id,
        status: "queued",
        dnc: false,
        next: { kind: "call", day: "Today, 27 Aug", time: payload.windowStart, quote: null },
        log: [],
      };
    });
    setCompanies((cs) => [...added, ...cs]);
    const skipN = added.filter((a) => a.status === "skipped").length;
    flash(`${added.length - skipN} to call, ${skipN} skipped (already known).`);
    setView("lists");
  };

  const openCo = companies.find((c) => c.id === openId);

  return (
    <div style={{ display: "flex", height: "100vh", background: C.paper, fontFamily: FONT_BODY }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; }
        @keyframes pulseBar { 0%, 100% { height: 4px; opacity: 0.5; } 50% { height: 14px; opacity: 1; } }
      `}</style>
      <Sidebar view={view} setView={setView} callerName={profile.callerName} companyName={profile.name} />
      <div style={{ flex: 1, overflowY: "auto" }}>
        {view === "today" && (
          <TodayView
            companies={companies}
            live={live}
            onOpenCompany={setOpenId}
            onOutcome={(item, kind) => setPending({ item, kind })}
            onListen={(id) => setLive((ls) => ls.map((l) => (l.id === id ? { ...l, listening: !l.listening } : l)))}
            onTake={(id) => setLive((ls) => ls.map((l) => (l.id === id ? { ...l, taken: !l.taken } : l)))}
            onEnd={(id) => {
              const item = live.find((l) => l.id === id);
              setLive((ls) => ls.map((l) => (l.id === id ? { ...l, ended: true } : l)));
              if (item) {
                patchCompany(item.companyId, (c) => ({
                  ...c,
                  status: "done",
                  log: [{ id: "lg_" + Date.now(), at: nowStamp(), channel: item.channel, outcome: "done", quote: null, transcript: lockTranscript(item.transcript) }, ...(c.log || [])],
                }));
                flash("Call ended. Words saved on the company.");
              }
            }}
          />
        )}
        {view === "lists" && <ListsView lists={lists} companies={companies} onOpenCompany={setOpenId} onNew={() => setShowNew(true)} />}
        {view === "calendar" && <CalendarView companies={companies} onOpenCompany={setOpenId} />}
        {view === "setup" && <SetupView profile={profile} setProfile={setProfile} />}
      </div>

      {openId && <CompanyPanel company={openCo} onClose={() => setOpenId(null)} />}
      {showNew && <NewListModal onClose={() => setShowNew(false)} onCreate={createList} companies={companies} />}
      {pending && (
        <ConfirmAction
          live={pending.item}
          companies={companies}
          kind={pending.kind}
          onCancel={() => setPending(null)}
          onConfirm={(when) => applyOutcome(pending.item, pending.kind, when)}
        />
      )}
      {toast && (
        <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: C.ink, color: "#fff", padding: "12px 18px", borderRadius: 10, fontFamily: FONT_BODY, fontSize: 13, zIndex: 70, maxWidth: 520, textAlign: "center" }}>
          {toast}
        </div>
      )}
    </div>
  );
}
