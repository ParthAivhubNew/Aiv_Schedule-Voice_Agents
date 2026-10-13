import React, { useState } from "react";
import {
  Phone,
  Users,
  Megaphone,
  Wallet,
  Radio,
  ShieldCheck,
  AlertCircle,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  Terminal,
  Layers,
  Clock,
  ArrowRight,
  FileCode,
} from "lucide-react";
import { C, FONT_BODY, FONT_DISPLAY, FONT_MONO } from "../tokens";
import { MultiLangCodeBlock, SUPPORTED_LANGS, WEBHOOK_LANGS, getWebhookVerificationSnippets } from "./DeveloperCodeSnippets";
import { API_BASE, ENDPOINTS, ERRORS, GROUPS, IDEAS, STEPS, RUN_ACTIONS, runRequest, pluginAction } from "./developerCatalog";
import { snippetsFor } from "./developerSnippets";

const cardStyle = {
  background: "#fff",
  border: `1px solid ${C.borderLight}`,
  borderRadius: 12,
  padding: 18,
  boxShadow: "0 1px 3px rgba(0,0,0,0.02)",
};

const SAMPLE_PAYLOADS = {
  "call.completed": {
    id: "evt_9c2f1a7b3d4e5f",
    event: "call.completed",
    api_version: "2026-10",
    livemode: true,
    created_at: "2026-10-21T14:32:10Z",
    data: {
      id: "call_8f2a91c4",
      status: "completed",
      to: "+447911123456",
      to_name: "Jo Bloggs",
      outcome: "meeting_booked",
      meeting_booked: true,
      duration_seconds: 192,
      answers: { current_system: "Acuity", seats: 15 },
      recording_url: "https://api.outreach.aivhub.com/v1/voice/calls/call_8f2a91c4/recording",
      transcript: "AI: Hello, calling from Outreach. Customer: Yes, I would love to book a demo...",
    },
  },
  "leads.ready": {
    id: "evt_3d8a1c9e2f4b5a",
    event: "leads.ready",
    api_version: "2026-10",
    livemode: true,
    created_at: "2026-10-21T14:35:20Z",
    data: {
      search_id: "srch_7a1b2c3d",
      query: "Civil engineering contractors in London",
      total_found: 42,
      leads: [
        { name: "John Smith", company: "Apex Build Ltd", email: "john@apexbuild.co.uk", phone: "+447700900077" },
        { name: "Emma Davis", company: "Metro Civil", email: "emma@metrocivil.co.uk", phone: "+447700900088" },
      ],
    },
  },
  "post.ready": {
    id: "evt_5f1c4e7b8a2d3c",
    event: "post.ready",
    api_version: "2026-10",
    livemode: true,
    created_at: "2026-10-21T14:40:00Z",
    data: {
      post_id: "post_9e8d7c6b",
      topic: "Awarded NHAI Smart Highway EPC Contract",
      platforms: ["linkedin", "twitter"],
      caption: "Proud to announce our latest milestone: awarded the NHAI Smart Highway EPC project for 2026!",
      preview_url: "https://outreach.aivhub.com/posts/preview/post_9e8d7c6b",
      status: "pending_approval",
    },
  },
};

const SAMPLE_ERROR = {
  error: {
    code: "insufficient_credits",
    message: "You need 12 more Voice credits to initiate this call.",
    details: { service: "voice", top_up_url: "https://outreach.aivhub.com/#/voice/subscription" },
  },
  request_id: "req_4f1c9a2b7d3e8a10",
};

const SERVICE_BADGES = {
  voice: { label: "Voice AI", bg: "#ECFDF5", color: "#059669", border: "#A7F3D0", icon: Phone },
  leads: { label: "Lead Gen", bg: "#EFF6FF", color: "#2563EB", border: "#BFDBFE", icon: Users },
  social: { label: "Social", bg: "#F5F3FF", color: "#7C3AED", border: "#DDD6FE", icon: Megaphone },
  account: { label: "Account", bg: "#FFFBEB", color: "#D97706", border: "#FDE68A", icon: Wallet },
};

function JsonBox({ value }) {
  const [copied, setCopied] = useState(false);
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);

  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ position: "relative", borderRadius: 10, overflow: "hidden" }}>
      <button
        type="button"
        onClick={handleCopy}
        style={{
          position: "absolute",
          top: 10,
          right: 10,
          background: "rgba(255,255,255,0.1)",
          color: "#E2E8F0",
          border: "none",
          borderRadius: 6,
          padding: "4px 8px",
          fontSize: 11,
          fontWeight: 600,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 4,
          zIndex: 2,
        }}
      >
        {copied ? <Check size={12} color="#34D399" /> : <Copy size={12} />}
        {copied ? "Copied" : "Copy"}
      </button>
      <pre
        style={{
          margin: 0,
          background: "#0F172A",
          color: "#E2E8F0",
          padding: 14,
          fontFamily: FONT_MONO,
          fontSize: 12,
          lineHeight: 1.55,
          overflowX: "auto",
        }}
      >
        {text}
      </pre>
    </div>
  );
}

function EndpointAccordion({ ep, apiKey }) {
  const [open, setOpen] = useState(false);
  const path = ep.pathParam ? ep.path.replace(`{${ep.pathParam.name}}`, ep.pathParam.example) : ep.path;
  const body = ep.body ? JSON.stringify(ep.body, null, 2) : "";
  const run = runRequest(ep, body);
  const pa = pluginAction(ep);
  const badge = SERVICE_BADGES[pa.plugin] || SERVICE_BADGES.voice;
  const PluginIcon = badge.icon;

  return (
    <div style={{ ...cardStyle, padding: 0, overflow: "hidden", transition: "all 0.15s ease" }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        style={{
          display: "flex",
          gap: 10,
          alignItems: "center",
          flexWrap: "wrap",
          width: "100%",
          textAlign: "left",
          background: open ? "#FAFBFD" : "#fff",
          border: "none",
          padding: "12px 16px",
          cursor: "pointer",
          fontFamily: FONT_BODY,
        }}
      >
        <span
          style={{
            fontSize: 9.5,
            fontWeight: 800,
            padding: "2px 6px",
            borderRadius: 4,
            backgroundColor: badge.bg,
            color: badge.color,
            border: `1px solid ${badge.border}`,
            display: "inline-flex",
            alignItems: "center",
            gap: 3,
            flexShrink: 0,
          }}
        >
          <PluginIcon size={9} strokeWidth={2.5} />
          {badge.label}
        </span>
        <code style={{ fontFamily: FONT_MONO, fontSize: 12.5, fontWeight: 700, color: C.textInk, overflowWrap: "anywhere" }}>
          {pa.action || ep.path}
        </code>
        <span style={{ fontSize: 13, color: C.slate, flex: "1 1 200px" }}>{ep.title}</span>
        <ChevronRight
          size={16}
          color={C.slate}
          style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform 0.15s ease" }}
        />
      </button>

      {open && (
        <div style={{ padding: "0 16px 16px", borderTop: `1px solid ${C.borderLight}`, display: "grid", gap: 12 }}>
          <p style={{ margin: "12px 0 0", fontSize: 13, lineHeight: 1.55, color: C.textInk }}>{ep.summary}</p>
          <MultiLangCodeBlock
            snippets={snippetsFor(run.method, run.path, apiKey, run.body)}
            availableLangs={SUPPORTED_LANGS.filter((l) => ["curl", "node", "python", "php", "go"].includes(l.id))}
            defaultLang="curl"
            title={`Dispatcher Request: POST /v1/run`}
          />
          {ep.response && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", marginBottom: 6 }}>
                Example Response
              </div>
              <JsonBox value={ep.response} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function DeveloperDocs({ apiKey = "sk_test_YOUR_KEY", events = [], webhookSecret = "" }) {
  const [docTab, setDocTab] = useState("quickstart");
  const [actionCategory, setActionCategory] = useState("all");
  const [sampleEventTab, setSampleEventTab] = useState("call.completed");

  const effectiveSecret = webhookSecret || "whsec_YOUR_ENDPOINT_SECRET";

  const eventCategories = [
    {
      id: "voice",
      title: "Voice AI & Calendar Events",
      badge: SERVICE_BADGES.voice,
      events: [
        { id: "call.completed", label: "Call completed", desc: "An AI phone call finished. Includes answers, sentiment, and full transcript." },
        { id: "call.failed", label: "Call failed", desc: "A call could not be completed (busy, unanswered, rejected, carrier drop)." },
        { id: "call.needs_human", label: "Call needs a person", desc: "The customer or AI requested human intervention." },
        { id: "meeting.booked", label: "Meeting booked", desc: "A calendar slot was booked by the AI during a live call or API request." },
      ],
    },
    {
      id: "leads",
      title: "Lead Generation & Email Campaigns",
      badge: SERVICE_BADGES.leads,
      events: [
        { id: "leads.ready", label: "Lead search finished", desc: "B2B search criteria and enrichment checks have completed." },
        { id: "campaign.ready", label: "Campaign ready to approve", desc: "An automated email sequence was drafted with preview link." },
        { id: "campaign.approved", label: "Campaign approved", desc: "A drafted email campaign was approved and began sending." },
        { id: "campaign.reply", label: "Campaign reply", desc: "A recipient responded to an outreach email." },
        { id: "campaign.completed", label: "Campaign finished", desc: "All emails and scheduled follow-ups have been delivered." },
      ],
    },
    {
      id: "social",
      title: "Social Media Automation",
      badge: SERVICE_BADGES.social,
      events: [
        { id: "post.ready", label: "Post ready to approve", desc: "An AI social post was drafted and is awaiting approval." },
        { id: "post.approved", label: "Post approved", desc: "A post was approved and queued for publication." },
        { id: "post.published", label: "Post published", desc: "A post went live on LinkedIn, X/Twitter, or Instagram." },
        { id: "post.rejected", label: "Post rejected or cancelled", desc: "A post was rejected in review and will not be published." },
        { id: "post.failed", label: "Post failed", desc: "A post failed to publish (e.g. platform token expired)." },
      ],
    },
  ];

  return (
    <div style={{ display: "grid", gap: 20, fontFamily: FONT_BODY }}>
      {/* Top Segmented Navigation */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 6,
          backgroundColor: "#F1F5F9",
          padding: 4,
          borderRadius: 10,
          border: `1px solid ${C.borderLight}`,
        }}
      >
        {[
          { id: "quickstart", label: "Quickstart", icon: Terminal },
          { id: "webhooks", label: "Webhooks & Events", icon: Radio },
          { id: "catalog", label: "Actions (26)", icon: Layers },
          { id: "errors", label: "Errors & Keys", icon: ShieldCheck },
        ].map((tab) => {
          const isActive = docTab === tab.id;
          const TabIcon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setDocTab(tab.id)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                padding: "8px 10px",
                borderRadius: 7,
                border: "none",
                background: isActive ? "#fff" : "transparent",
                color: isActive ? C.cobalt : C.slate,
                fontWeight: isActive ? 700 : 600,
                fontSize: 12.5,
                cursor: "pointer",
                boxShadow: isActive ? "0 1px 3px rgba(0, 0, 0, 0.08)" : "none",
                transition: "all 0.15s ease",
                whiteSpace: "nowrap",
              }}
            >
              <TabIcon size={14} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* ── TAB 1: QUICKSTART & DISPATCHER ── */}
      {docTab === "quickstart" && (
        <div style={{ display: "grid", gap: 20 }}>
          {/* Hero Banner */}
          <div
            style={{
              padding: "20px 24px",
              borderRadius: 14,
              background: "linear-gradient(135deg, #1E293B 0%, #0F172A 100%)",
              color: "#fff",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 16,
            }}
          >
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 700, background: "#38BDF8", color: "#0F172A", padding: "2px 8px", borderRadius: 4 }}>
                  SINGLE MASTER ENDPOINT
                </span>
                <span style={{ fontSize: 12, color: "#94A3B8" }}>API v2026-10</span>
              </div>
              <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 20, margin: "0 0 6px", fontWeight: 700 }}>
                <code>POST {API_BASE}/v1/run</code>
              </h2>
              <p style={{ margin: 0, fontSize: 13, color: "#CBD5E1", maxWidth: 580, lineHeight: 1.5 }}>
                Instead of managing 26 different endpoints, execute all actions through this single master dispatcher.
                Specify <code>plugin</code>, <code>action</code>, and your payload in <code>data</code>.
              </p>
            </div>
            <div
              style={{
                background: "rgba(255,255,255,0.08)",
                padding: "10px 16px",
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.15)",
                fontSize: 12,
                fontFamily: FONT_MONO,
              }}
            >
              <div style={{ color: "#94A3B8", fontSize: 11, marginBottom: 4 }}>AUTHENTICATION HEADER</div>
              <div style={{ color: "#38BDF8" }}>Authorization: Bearer sk_...</div>
            </div>
          </div>

          {/* 3 Step Getting Started */}
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
            {STEPS.map((s, i) => (
              <div key={s.title} style={cardStyle}>
                <div style={{ fontSize: 11, fontWeight: 800, color: C.cobalt, marginBottom: 6, letterSpacing: "0.5px" }}>
                  STEP 0{i + 1}
                </div>
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6, color: C.textInk }}>{s.title}</div>
                <div style={{ fontSize: 13, color: C.slate, lineHeight: 1.5 }}>{s.text}</div>
              </div>
            ))}
          </div>

          {/* Core Dispatcher Snippets */}
          <div style={cardStyle}>
            <h3 style={{ fontFamily: FONT_DISPLAY, fontSize: 16, margin: "0 0 10px", color: C.textInk }}>
              Quick Dispatcher Request Example
            </h3>
            <p style={{ margin: "0 0 14px", fontSize: 13, color: C.slate }}>
              Here is how to initiate an AI voice call via the master dispatcher:
            </p>
            <MultiLangCodeBlock
              snippets={{
                curl: `curl -X POST "${API_BASE}/v1/run" \\
  -H "Authorization: Bearer ${apiKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "plugin": "voice",
    "action": "call.start",
    "data": {
      "to": "+14155552671",
      "lead_name": "Sarah Jenkins",
      "goal": "Schedule a 15-minute product demonstration"
    }
  }'`,
                node: `const response = await fetch("${API_BASE}/v1/run", {
  method: "POST",
  headers: {
    "Authorization": "Bearer ${apiKey}",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    plugin: "voice",
    action: "call.start",
    data: {
      to: "+14155552671",
      lead_name: "Sarah Jenkins",
      goal: "Schedule a 15-minute product demonstration"
    }
  })
});

const result = await response.json();
console.log("Call Dispatched:", result.id, result.status);`,
                python: `import requests

res = requests.post(
    "${API_BASE}/v1/run",
    headers={"Authorization": "Bearer ${apiKey}"},
    json={
        "plugin": "voice",
        "action": "call.start",
        "data": {
            "to": "+14155552671",
            "lead_name": "Sarah Jenkins",
            "goal": "Schedule a 15-minute product demonstration"
        }
    }
)
print("Call Dispatched:", res.json())`,
              }}
              availableLangs={SUPPORTED_LANGS.filter((l) => ["curl", "node", "python"].includes(l.id))}
              defaultLang="curl"
              title="Live Example: POST /v1/run"
            />
          </div>

          {/* Architecture Principles */}
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
            {IDEAS.map((idea) => (
              <div key={idea.title} style={{ ...cardStyle, backgroundColor: "#FAFBFD" }}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4, color: C.textInk }}>{idea.title}</div>
                <div style={{ fontSize: 12.5, color: C.slate, lineHeight: 1.5 }}>{idea.text}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── TAB 2: WEBHOOKS & REAL-TIME EVENTS ── */}
      {docTab === "webhooks" && (
        <div style={{ display: "grid", gap: 20 }}>
          {/* Webhook Overview Banner */}
          <div
            style={{
              padding: "20px 24px",
              borderRadius: 14,
              background: "linear-gradient(135deg, #0F766E 0%, #115E59 100%)",
              color: "#fff",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 16,
            }}
          >
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 700, background: "#5EEAD4", color: "#134E4A", padding: "2px 8px", borderRadius: 4 }}>
                  SECURE HMAC-SHA256 SIGNED
                </span>
                <span style={{ fontSize: 12, color: "#CCFBF1" }}>X-Outreach-Signature</span>
              </div>
              <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 20, margin: "0 0 6px", fontWeight: 700 }}>
                Real-Time Event Webhooks
              </h2>
              <p style={{ margin: 0, fontSize: 13, color: "#E6FFFA", maxWidth: 620, lineHeight: 1.5 }}>
                Never poll for updates. When an AI phone call finishes, an email campaign gets a reply, or a social post
                is drafted, Outreach sends an instant signed HTTP POST payload directly to your server.
              </p>
            </div>
            <div
              style={{
                background: "rgba(0,0,0,0.2)",
                padding: "10px 14px",
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.2)",
                fontSize: 12,
                fontFamily: FONT_MONO,
              }}
            >
              <div style={{ color: "#99F6E4", fontSize: 11, marginBottom: 4 }}>RETRY POLICY</div>
              <div>Failed deliveries are retried at +10s and +60s.</div>
            </div>
          </div>

          {/* Webhook Lifecycle 4-Step Diagram */}
          <div style={cardStyle}>
            <h3 style={{ fontFamily: FONT_DISPLAY, fontSize: 16, margin: "0 0 14px", color: C.textInk }}>
              Webhook Delivery Lifecycle
            </h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12 }}>
              {[
                { step: "1", title: "Action Completes", desc: "AI finishes call, leads are searched, or post is drafted." },
                { step: "2", title: "Payload Signed", desc: "Outreach computes HMAC-SHA256 signature using your secret." },
                { step: "3", title: "POST to Your Server", desc: "Dispatched to your URL with X-Outreach-Signature header." },
                { step: "4", title: "Verify & Return 200", desc: "Your server verifies signature and replies with 2xx HTTP code." },
              ].map((s) => (
                <div
                  key={s.step}
                  style={{
                    backgroundColor: "#FAFBFD",
                    borderRadius: 10,
                    padding: 14,
                    border: `1px solid ${C.borderLight}`,
                  }}
                >
                  <div
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 6,
                      backgroundColor: C.cobalt,
                      color: "#fff",
                      fontSize: 12,
                      fontWeight: 700,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      marginBottom: 8,
                    }}
                  >
                    {s.step}
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: C.textInk, marginBottom: 4 }}>{s.title}</div>
                  <div style={{ fontSize: 12, color: C.slate, lineHeight: 1.45 }}>{s.desc}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Signature Verification Code */}
          <div style={cardStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div>
                <h3 style={{ fontFamily: FONT_DISPLAY, fontSize: 16, margin: 0, color: C.textInk }}>
                  Verifying Signatures on Your Server
                </h3>
                <p style={{ margin: "3px 0 0", fontSize: 12.5, color: C.slate }}>
                  Always verify the <code>X-Outreach-Signature</code> header before processing payloads:
                </p>
              </div>
              <div
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 11,
                  backgroundColor: "#F1F5F9",
                  padding: "4px 8px",
                  borderRadius: 6,
                  color: C.slate,
                }}
              >
                Secret: <code>{effectiveSecret ? `${effectiveSecret.slice(0, 12)}...` : "whsec_..."}</code>
              </div>
            </div>

            <MultiLangCodeBlock
              snippets={getWebhookVerificationSnippets(effectiveSecret)}
              availableLangs={WEBHOOK_LANGS}
              defaultLang="node"
              title="Webhook Signature Verifier Code"
            />
          </div>

          {/* Interactive Sample Payloads */}
          <div style={cardStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
              <div>
                <h3 style={{ fontFamily: FONT_DISPLAY, fontSize: 16, margin: 0, color: C.textInk }}>
                  Sample Webhook Payloads
                </h3>
                <p style={{ margin: "2px 0 0", fontSize: 12.5, color: C.slate }}>
                  Exact JSON structure delivered to your server:
                </p>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {[
                  { id: "call.completed", label: "call.completed", badge: SERVICE_BADGES.voice },
                  { id: "leads.ready", label: "leads.ready", badge: SERVICE_BADGES.leads },
                  { id: "post.ready", label: "post.ready", badge: SERVICE_BADGES.social },
                ].map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSampleEventTab(s.id)}
                    style={{
                      padding: "4px 10px",
                      borderRadius: 6,
                      fontSize: 11.5,
                      fontFamily: FONT_MONO,
                      fontWeight: 600,
                      cursor: "pointer",
                      border: `1px solid ${sampleEventTab === s.id ? s.badge.border : C.borderLight}`,
                      backgroundColor: sampleEventTab === s.id ? s.badge.bg : "#fff",
                      color: sampleEventTab === s.id ? s.badge.color : C.slate,
                    }}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            <JsonBox value={SAMPLE_PAYLOADS[sampleEventTab] || SAMPLE_PAYLOADS["call.completed"]} />
          </div>

          {/* Supported Events Catalog */}
          <div style={cardStyle}>
            <h3 style={{ fontFamily: FONT_DISPLAY, fontSize: 16, margin: "0 0 12px", color: C.textInk }}>
              All Supported Webhook Events
            </h3>
            <div style={{ display: "grid", gap: 16 }}>
              {eventCategories.map((cat) => {
                const CatIcon = cat.badge.icon;
                return (
                  <div key={cat.id}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "6px 10px",
                        marginBottom: 8,
                        borderRadius: 6,
                        backgroundColor: cat.badge.bg,
                        color: cat.badge.color,
                        fontSize: 11,
                        fontWeight: 700,
                        textTransform: "uppercase",
                        letterSpacing: "0.5px",
                      }}
                    >
                      <CatIcon size={12} strokeWidth={2.5} />
                      <span>{cat.title} ({cat.events.length})</span>
                    </div>
                    <div style={{ display: "grid", gap: 6 }}>
                      {cat.events.map((ev) => (
                        <div
                          key={ev.id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            padding: "8px 12px",
                            borderRadius: 8,
                            backgroundColor: "#FAFBFD",
                            border: `1px solid ${C.borderLight}`,
                            flexWrap: "wrap",
                          }}
                        >
                          <code
                            style={{
                              fontFamily: FONT_MONO,
                              fontSize: 11.5,
                              fontWeight: 700,
                              color: C.textInk,
                              minWidth: 160,
                            }}
                          >
                            {ev.id}
                          </code>
                          <span style={{ fontWeight: 600, fontSize: 12.5, color: C.textInk, minWidth: 180 }}>
                            {ev.label}
                          </span>
                          <span style={{ fontSize: 12, color: C.slate, flex: 1 }}>{ev.desc}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── TAB 3: ACTION CATALOG (26 ENDPOINTS) ── */}
      {docTab === "catalog" && (
        <div style={{ display: "grid", gap: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
            <div>
              <h3 style={{ fontFamily: FONT_DISPLAY, fontSize: 16, margin: 0, color: C.textInk }}>
                Complete Action Catalog
              </h3>
              <p style={{ margin: "2px 0 0", fontSize: 12.5, color: C.slate }}>
                All 26 actions can be dispatched via <code>POST /v1/run</code> or called directly.
              </p>
            </div>

            {/* Service Filters */}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {[
                { id: "all", label: "All Actions" },
                { id: "voice", label: "Voice AI", badge: SERVICE_BADGES.voice },
                { id: "leads", label: "Lead Gen", badge: SERVICE_BADGES.leads },
                { id: "social", label: "Social", badge: SERVICE_BADGES.social },
                { id: "account", label: "Account", badge: SERVICE_BADGES.account },
              ].map((cat) => {
                const count = ENDPOINTS.filter(
                  (e) => cat.id === "all" || pluginAction(e).plugin === cat.id
                ).length;
                const isSelected = actionCategory === cat.id;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setActionCategory(cat.id)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "5px 12px",
                      borderRadius: 99,
                      border: `1px solid ${isSelected ? C.cobalt : C.borderLight}`,
                      backgroundColor: isSelected ? C.cobalt : "#fff",
                      color: isSelected ? "#fff" : C.textInk,
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                    }}
                  >
                    <span>{cat.label}</span>
                    <span
                      style={{
                        fontSize: 10.5,
                        padding: "1px 6px",
                        borderRadius: 99,
                        backgroundColor: isSelected ? "rgba(255,255,255,0.25)" : "#F1F5F9",
                        color: isSelected ? "#fff" : C.slate,
                        fontWeight: 700,
                      }}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            {ENDPOINTS.filter((e) => {
              if (actionCategory === "all") return true;
              return pluginAction(e).plugin === actionCategory;
            }).map((ep) => (
              <EndpointAccordion key={`${ep.method} ${ep.path}`} ep={ep} apiKey={apiKey} />
            ))}
          </div>
        </div>
      )}

      {/* ── TAB 4: ERRORS & IDEMPOTENCY ── */}
      {docTab === "errors" && (
        <div style={{ display: "grid", gap: 20 }}>
          <div style={cardStyle}>
            <h3 style={{ fontFamily: FONT_DISPLAY, fontSize: 16, margin: "0 0 6px", color: C.textInk }}>
              Standard Error Envelope
            </h3>
            <p style={{ margin: "0 0 12px", fontSize: 13, color: C.slate }}>
              Every API failure returns a uniform JSON envelope with a machine-readable <code>code</code> and human <code>message</code>:
            </p>
            <JsonBox value={SAMPLE_ERROR} />
          </div>

          <div style={{ ...cardStyle, padding: 0, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ backgroundColor: "#F8FAFC", borderBottom: `1px solid ${C.borderLight}` }}>
                  <th style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase" }}>Error Code</th>
                  <th style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase" }}>HTTP Status</th>
                  <th style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase" }}>Meaning & Remediation</th>
                </tr>
              </thead>
              <tbody>
                {ERRORS.map(([code, status, text]) => (
                  <tr key={code} style={{ borderBottom: `1px solid ${C.borderLight}` }}>
                    <td style={{ padding: "10px 14px", fontFamily: FONT_MONO, fontWeight: 700, color: "#DC2626" }}>
                      {code}
                    </td>
                    <td style={{ padding: "10px 14px", fontFamily: FONT_MONO, color: C.slate }}>
                      {status}
                    </td>
                    <td style={{ padding: "10px 14px", color: C.textInk, lineHeight: 1.45 }}>
                      {text}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={cardStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <ShieldCheck size={18} color={C.cobalt} />
              <h3 style={{ fontFamily: FONT_DISPLAY, fontSize: 16, margin: 0, color: C.textInk }}>
                Safe Retries with Idempotency Keys
              </h3>
            </div>
            <p style={{ margin: 0, fontSize: 13, color: C.slate, lineHeight: 1.55 }}>
              For any request that mutates data or incurs credits (like starting phone calls or posting to social networks),
              pass an <code>Idempotency-Key: &lt;unique-id&gt;</code> header. If a network timeout occurs, you can safely retry the
              exact same request without being billed twice or initiating duplicate calls.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
