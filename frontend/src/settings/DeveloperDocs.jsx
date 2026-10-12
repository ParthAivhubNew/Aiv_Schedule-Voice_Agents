import React, { useState } from "react";
import { C, FONT_BODY, FONT_DISPLAY, FONT_MONO } from "../tokens";
import { MultiLangCodeBlock, SUPPORTED_LANGS, WEBHOOK_LANGS, getWebhookVerificationSnippets } from "./DeveloperCodeSnippets";
import { API_BASE, ENDPOINTS, ERRORS, GROUPS, IDEAS, STEPS, RUN_ACTIONS, runRequest } from "./developerCatalog";
import { snippetsFor } from "./developerSnippets";

const METHOD_COLOURS = { GET: ["#047857", "#ECFDF5"], POST: ["#1D4ED8", "#EFF6FF"], PATCH: ["#B45309", "#FFFBEB"], DELETE: ["#B91C1C", "#FEF2F2"] };
const LANGS = SUPPORTED_LANGS.filter((l) => ["curl", "node", "python", "php", "go", "java"].includes(l.id));

const FALLBACK_EVENTS = [
  { id: "call.completed", label: "Call completed", desc: "An AI phone call finished, with the outcome, answers and transcript." },
  { id: "call.needs_human", label: "Call needs a person", desc: "The AI asked for a person to step in." },
  { id: "post.ready", label: "Post ready to approve", desc: "A post was written and has a preview link." },
  { id: "post.published", label: "Post published", desc: "A post went live." },
  { id: "leads.ready", label: "Lead search finished", desc: "A lead search and its checks are done." },
  { id: "campaign.ready", label: "Campaign ready to approve", desc: "An email campaign was drafted." },
  { id: "campaign.reply", label: "Campaign reply", desc: "Someone replied to a campaign email." },
  { id: "meeting.booked", label: "Meeting booked", desc: "A meeting was booked, by you or by an AI call." },
];

const SAMPLE_EVENT = `{
  "id": "evt_9c2f1a7b3d4e5f",
  "event": "call.completed",
  "api_version": "2026-10",
  "livemode": true,
  "created_at": "2026-10-21T14:32:10Z",
  "data": {
    "id": "call_8f2a91c4",
    "status": "completed",
    "to": "+447911123456",
    "to_name": "Jo Bloggs",
    "outcome": "meeting_booked",
    "meeting_booked": true,
    "duration_seconds": 192,
    "answers": { "current_system": "Acuity" },
    "recording_url": "https://api.outreach.aivhub.com/v1/voice/calls/call_8f2a91c4/recording"
  }
}`;

const SAMPLE_ERROR = `{
  "error": {
    "code": "insufficient_credits",
    "message": "You need 12 more Voice credits to make this call.",
    "details": { "top_up_url": "https://outreach.aivhub.com/" }
  },
  "request_id": "req_4f1c9a2b7d3e8a10"
}`;

const card = { background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 };

function Method({ m }) {
  const [fg, bg] = METHOD_COLOURS[m] || [C.slate, "#F1F5F9"];
  return <span style={{ fontFamily: FONT_MONO, fontSize: 11.5, fontWeight: 700, color: fg, background: bg, borderRadius: 6, padding: "2px 8px" }}>{m}</span>;
}

function Json({ value }) {
  return (
    <pre style={{ margin: 0, background: "#0F172A", color: "#E2E8F0", borderRadius: 10, padding: 12, fontFamily: FONT_MONO, fontSize: 11.5, lineHeight: 1.5, overflowX: "auto" }}>
      {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
    </pre>
  );
}

function Endpoint({ ep, apiKey }) {
  const [open, setOpen] = useState(false);
  const path = ep.pathParam ? ep.path.replace(`{${ep.pathParam.name}}`, ep.pathParam.example) : ep.path;
  const body = ep.body ? JSON.stringify(ep.body, null, 2) : "";
  const run = runRequest(ep, body);
  const action = RUN_ACTIONS[`${ep.method} ${ep.path.split("?")[0]}`] || "";
  return (
    <div style={{ ...card, padding: 0, overflow: "hidden" }}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", width: "100%", textAlign: "left", background: "none", border: "none", padding: "12px 16px", cursor: "pointer", fontFamily: FONT_BODY }}>
        <Method m="POST" />
        <code style={{ fontFamily: FONT_MONO, fontSize: 12.5, color: C.textInk, overflowWrap: "anywhere" }}>{action}</code>
        <span style={{ fontSize: 13, color: C.slate, flex: "1 1 200px" }}>{ep.title}</span>
        <span style={{ fontSize: 11, color: C.slate, fontFamily: FONT_MONO }}>{ep.scope}</span>
      </button>
      {open && (
        <div style={{ padding: "0 16px 16px", display: "grid", gap: 12 }}>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: C.textInk }}>{ep.summary}</p>
          <MultiLangCodeBlock snippets={snippetsFor(run.method, run.path, apiKey, run.body)} availableLangs={LANGS} defaultLang="curl" title="Example request (one endpoint)" />
          <div style={{ fontSize: 11.5, color: C.slate }}>
            Also available at its own address: <code style={{ fontFamily: FONT_MONO }}>{ep.method} {path}</code>
          </div>
          {ep.response && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", marginBottom: 4 }}>Example answer</div>
              <Json value={ep.response} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// The Docs tab: how to start, the ideas behind the API, every call with examples, webhooks and errors.
export function DeveloperDocs({ apiKey = "sk_test_YOUR_KEY", events = [], webhookSecret = "" }) {
  const [group, setGroup] = useState("all");
  const shown = ENDPOINTS.filter((e) => group === "all" || e.group === group);
  const eventList = events.length ? events : FALLBACK_EVENTS;
  return (
    <div style={{ display: "grid", gap: 22, fontFamily: FONT_BODY }}>
      <section>
        <h3 style={{ fontFamily: FONT_DISPLAY, fontSize: 17, margin: "0 0 4px", color: C.textInk }}>Use Outreach from your own software</h3>
        <p style={{ margin: "0 0 12px", fontSize: 13, color: C.slate, lineHeight: 1.55 }}>
          Make phone calls, find and check leads, send email campaigns and write social posts from your own software. Everything goes to one address, <code>POST {API_BASE}/v1/run</code>, with your key as <code>Authorization: Bearer sk_…</code>. Say which plugin (voice, leads, social) and which action you want, and put the details in <code>data</code>.
        </p>
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
          {STEPS.map((s, i) => (
            <div key={s.title} style={card}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.cobalt, marginBottom: 4 }}>STEP {i + 1}</div>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4, color: C.textInk }}>{s.title}</div>
              <div style={{ fontSize: 12.5, color: C.slate, lineHeight: 1.5 }}>{s.text}</div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 style={{ fontFamily: FONT_DISPLAY, fontSize: 15, margin: "0 0 10px", color: C.textInk }}>How it works</h3>
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
          {IDEAS.map((s) => (
            <div key={s.title} style={card}>
              <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 4, color: C.textInk }}>{s.title}</div>
              <div style={{ fontSize: 12.5, color: C.slate, lineHeight: 1.5 }}>{s.text}</div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 style={{ fontFamily: FONT_DISPLAY, fontSize: 15, margin: "0 0 10px", color: C.textInk }}>Every call</h3>
        <div role="tablist" style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
          {[{ id: "all", label: "All" }, ...GROUPS.filter((g) => g.id !== "start")].map((g) => (
            <button key={g.id} type="button" role="tab" aria-selected={group === g.id} onClick={() => setGroup(g.id)}
              style={{ padding: "6px 12px", borderRadius: 99, border: `1px solid ${group === g.id ? C.cobalt : C.border}`, background: group === g.id ? C.cobalt : "#fff", color: group === g.id ? "#fff" : C.textInk, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
              {g.label}
            </button>
          ))}
        </div>
        <div style={{ display: "grid", gap: 8 }}>
          {shown.map((ep) => <Endpoint key={`${ep.method} ${ep.path}`} ep={ep} apiKey={apiKey} />)}
        </div>
      </section>

      <section>
        <h3 style={{ fontFamily: FONT_DISPLAY, fontSize: 15, margin: "0 0 4px", color: C.textInk }}>Webhooks: be told when something happens</h3>
        <p style={{ margin: "0 0 10px", fontSize: 13, color: C.slate, lineHeight: 1.55 }}>
          An account admin adds the address in the Webhooks tab. We send a signed POST; reply with any 2xx. A failed delivery is tried again twice. Events from a test key have <code>livemode: false</code>.
        </p>
        <div style={{ display: "grid", gap: 6, marginBottom: 12 }}>
          {eventList.map((ev) => (
            <div key={ev.id} style={{ ...card, padding: "8px 12px", display: "flex", gap: 10, flexWrap: "wrap" }}>
              <code style={{ fontFamily: FONT_MONO, fontSize: 12, fontWeight: 700, color: C.textInk, minWidth: 190 }}>{ev.id}</code>
              <span style={{ fontSize: 12.5, color: C.slate, flex: "1 1 240px" }}>{ev.desc || ev.label}</span>
            </div>
          ))}
        </div>
        <p style={{ margin: "0 0 8px", fontSize: 13, color: C.slate, lineHeight: 1.55 }}>
          Check the signature before you trust a message: <code>X-Outreach-Signature</code> is <code>t=timestamp,v1=signature</code>, the HMAC-SHA256 of <code>t=&#123;timestamp&#125;.&#123;raw body&#125;</code> with your endpoint secret. Reject messages more than five minutes old.
        </p>
        <MultiLangCodeBlock snippets={getWebhookVerificationSnippets(webhookSecret || "whsec_YOUR_ENDPOINT_SECRET")} availableLangs={WEBHOOK_LANGS} defaultLang="node" title="Verify the signature" />
        <div style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", margin: "4px 0" }}>A message</div>
        <Json value={SAMPLE_EVENT} />
      </section>

      <section>
        <h3 style={{ fontFamily: FONT_DISPLAY, fontSize: 15, margin: "0 0 4px", color: C.textInk }}>When something goes wrong</h3>
        <p style={{ margin: "0 0 10px", fontSize: 13, color: C.slate, lineHeight: 1.55 }}>Every error looks the same, with a plain message and a code you can test for.</p>
        <Json value={SAMPLE_ERROR} />
        <div style={{ ...card, padding: 0, overflowX: "auto", marginTop: 10 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 480, fontSize: 12.5 }}>
            <tbody>
              {ERRORS.map(([code, status, text]) => (
                <tr key={code} style={{ borderTop: `1px solid ${C.border}` }}>
                  <td style={{ padding: "8px 12px", fontFamily: FONT_MONO, fontWeight: 700, whiteSpace: "nowrap" }}>{code}</td>
                  <td style={{ padding: "8px 12px", fontFamily: FONT_MONO, color: C.slate }}>{status}</td>
                  <td style={{ padding: "8px 12px", color: C.textInk }}>{text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
