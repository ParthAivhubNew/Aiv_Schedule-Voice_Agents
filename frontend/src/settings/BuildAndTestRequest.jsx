import React, { useState, useMemo, useEffect, useRef } from "react";
import {
  Phone,
  Users,
  Megaphone,
  Wallet,
  Search,
  Send,
  Copy,
  Check,
  Code2,
  Terminal,
  ExternalLink,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Sparkles,
  Layers,
  ArrowRight,
  ShieldCheck,
  Eye,
  Calendar,
  Lock,
} from "lucide-react";
import { C, FONT_BODY, FONT_DISPLAY, FONT_MONO } from "../tokens";
import { API_BASE } from "./developerCatalog";

export function renderJsonSyntax(jsonStr) {
  if (!jsonStr || typeof jsonStr !== "string") {
    return <span>{String(jsonStr || "")}</span>;
  }

  const jsonRegex = /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?|[{}[\],:])/g;

  let lastIndex = 0;
  const elements = [];
  let match;
  let keyIndex = 0;

  while ((match = jsonRegex.exec(jsonStr)) !== null) {
    if (match.index > lastIndex) {
      elements.push(
        <span key={`t-${keyIndex++}`}>{jsonStr.slice(lastIndex, match.index)}</span>
      );
    }
    const token = match[0];

    if (/^"/.test(token)) {
      if (/:$/.test(token.trim())) {
        const colonIdx = token.lastIndexOf(":");
        const keyPart = token.slice(0, colonIdx);
        const colonPart = token.slice(colonIdx);
        elements.push(
          <span key={`k-${keyIndex++}`} style={{ color: "#7DD3FC", fontWeight: 600 }}>
            {keyPart}
          </span>
        );
        elements.push(
          <span key={`c-${keyIndex++}`} style={{ color: "#94A3B8" }}>
            {colonPart}
          </span>
        );
      } else {
        elements.push(
          <span key={`s-${keyIndex++}`} style={{ color: "#86EFAC" }}>
            {token}
          </span>
        );
      }
    } else if (/true|false/.test(token)) {
      elements.push(
        <span key={`b-${keyIndex++}`} style={{ color: "#F472B6", fontWeight: 600 }}>
          {token}
        </span>
      );
    } else if (/null/.test(token)) {
      elements.push(
        <span key={`n-${keyIndex++}`} style={{ color: "#CBD5E1", fontStyle: "italic" }}>
          {token}
        </span>
      );
    } else if (/^-?\d/.test(token)) {
      elements.push(
        <span key={`num-${keyIndex++}`} style={{ color: "#FBBF24" }}>
          {token}
        </span>
      );
    } else if (/[{}[\]]/.test(token)) {
      elements.push(
        <span key={`br-${keyIndex++}`} style={{ color: "#E2E8F0" }}>
          {token}
        </span>
      );
    } else if (/[:,]/.test(token)) {
      elements.push(
        <span key={`p-${keyIndex++}`} style={{ color: "#94A3B8" }}>
          {token}
        </span>
      );
    } else {
      elements.push(
        <span key={`o-${keyIndex++}`}>{token}</span>
      );
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < jsonStr.length) {
    elements.push(
      <span key={`tail-${keyIndex++}`}>{jsonStr.slice(lastIndex)}</span>
    );
  }

  return elements;
}

export const BUILD_AREAS = {
  voice: {
    id: "voice",
    name: "Phone calls and meetings",
    short: "Call people with an AI agent, book meetings",
    color: "#3B82F6",
    perm: "Phone calls and meetings",
    icon: Phone,
  },
  leads: {
    id: "leads",
    name: "Leads and email",
    short: "Find companies, run email campaigns",
    color: "#10B981",
    perm: "Leads and email campaigns",
    icon: Users,
  },
  social: {
    id: "social",
    name: "Social posts",
    short: "Write, approve and schedule posts",
    color: "#EA580C",
    perm: "Social posts",
    icon: Megaphone,
  },
  account: {
    id: "account",
    name: "Account",
    short: "Your balance and setup",
    color: "#8B5CF6",
    perm: "Balance and setup (read only)",
    icon: Wallet,
  },
};

const F = (k, l, p, type = "text") => ({ k, l, p, type });

export const BUILD_ACTIONS = [
  // ── Phone calls & Meetings ──
  {
    p: "voice",
    a: "call.start",
    title: "Start a call",
    desc: "An AI agent phones one person and talks to them using your goal and instructions.",
    id: false,
    read: false,
    data: {
      to: "+447911123456",
      lead_name: "Jo Bloggs",
      goal: "Book a 15 minute demo of our booking software",
      instructions: "Be brief and friendly. Do not talk about pricing.",
      questions: ["How many staff do you have?", { ask: "Which booking system do you use today?", key: "current_system" }],
      variables: { company: "Bloggs Dental" },
    },
    fields: [
      F("to", "Phone number", "+447911123456"),
      F("lead_name", "Their name", "Jo Bloggs"),
      F("goal", "What should the call achieve?", "Book a 15 minute demo"),
      F("instructions", "How should the agent behave?", "Be brief and friendly"),
    ],
  },
  {
    p: "voice",
    a: "call.get",
    title: "See a call",
    desc: "Status, outcome, answers and transcript of one call.",
    id: true,
    idExample: "call_8f2e91c4",
    read: true,
    data: {},
    fields: [],
  },
  {
    p: "voice",
    a: "call.list",
    title: "List calls",
    desc: "Your recent calls, newest first.",
    id: false,
    read: true,
    data: { status: "completed", limit: 20 },
    fields: [
      F("status", "Status filter", "completed"),
      F("limit", "How many", 20, "number"),
    ],
  },
  {
    p: "voice",
    a: "call.hangup",
    title: "End a call",
    desc: "Hang up a call that is still going.",
    id: true,
    idExample: "call_8f2e91c4",
    read: false,
    data: {},
    fields: [],
  },
  {
    p: "voice",
    a: "call.control",
    title: "Steer a live call",
    desc: "Give the agent a new instruction while the call is happening.",
    id: true,
    idExample: "call_8f2e91c4",
    read: false,
    data: { instruction: "Offer to book a meeting for Tuesday at 3pm." },
    fields: [
      F("instruction", "Instruction to give live agent", "Offer to book a meeting for Tuesday at 3pm"),
    ],
  },
  {
    p: "voice",
    a: "call.recording",
    title: "Download the recording",
    desc: "The audio recording of a finished call.",
    id: true,
    idExample: "call_8f2e91c4",
    read: true,
    data: {},
    fields: [],
  },
  {
    p: "voice",
    a: "scripts.list",
    title: "Saved call scripts",
    desc: "The call scripts saved in your account.",
    id: false,
    read: true,
    data: {},
    fields: [],
  },
  {
    p: "voice",
    a: "meeting.slots",
    title: "Open times",
    desc: "Free times people can be booked into.",
    id: false,
    read: true,
    data: { from: "2026-10-14", days: 7 },
    fields: [
      F("from", "From date (YYYY-MM-DD)", "2026-10-14"),
      F("days", "Days ahead", 7, "number"),
    ],
  },
  {
    p: "voice",
    a: "meeting.book",
    title: "Book a meeting",
    desc: "Book one of your open calendar times for a person.",
    id: false,
    read: false,
    data: { name: "Jo Bloggs", email: "jo@bloggsdental.com", start: "2026-10-15T10:00:00Z" },
    fields: [
      F("name", "Name", "Jo Bloggs"),
      F("email", "Email", "jo@bloggsdental.com"),
      F("start", "Start time (ISO-8601)", "2026-10-15T10:00:00Z"),
    ],
  },
  {
    p: "voice",
    a: "meeting.list",
    title: "List meetings",
    desc: "Meetings booked in your account.",
    id: false,
    read: true,
    data: {},
    fields: [],
  },
  {
    p: "voice",
    a: "meeting.get",
    title: "See a meeting",
    desc: "One meeting and who it is with.",
    id: true,
    idExample: "mtg_41a7d2e8",
    read: true,
    data: {},
    fields: [],
  },
  {
    p: "voice",
    a: "meeting.update",
    title: "Cancel or move a meeting",
    desc: "Change the time of a meeting or cancel it.",
    id: true,
    idExample: "mtg_41a7d2e8",
    read: false,
    data: { status: "cancelled" },
    fields: [
      F("status", "New status (cancelled or confirmed)", "cancelled"),
    ],
  },

  // ── Leads & Email ──
  {
    p: "leads",
    a: "search.create",
    title: "Find companies",
    desc: "Ask the AI to find companies that match a description.",
    id: false,
    read: false,
    data: { query: "dental clinics in Leeds", limit: 25 },
    fields: [
      F("query", "What are you looking for?", "dental clinics in Leeds"),
      F("limit", "How many companies", 25, "number"),
    ],
  },
  {
    p: "leads",
    a: "search.get",
    title: "See a search",
    desc: "Progress and results of a company search.",
    id: true,
    idExample: "srch_77c1b4a9",
    read: true,
    data: {},
    fields: [],
  },
  {
    p: "leads",
    a: "lead.add",
    title: "Add your own leads",
    desc: "Save people and companies you already have into the database.",
    id: false,
    read: false,
    data: { leads: [{ name: "Jo Bloggs", email: "jo@bloggsdental.com", company: "Bloggs Dental" }] },
    fields: [],
  },
  {
    p: "leads",
    a: "lead.list",
    title: "Your saved leads",
    desc: "View leads and contact cards in your account.",
    id: false,
    read: true,
    data: { limit: 50 },
    fields: [
      F("limit", "How many leads", 50, "number"),
    ],
  },
  {
    p: "leads",
    a: "campaign.create",
    title: "Draft an email campaign",
    desc: "The AI drafts the emails. It waits for approval before sending.",
    id: false,
    read: false,
    data: { name: "Leeds dentists, October", goal: "Book a demo of our software" },
    fields: [
      F("name", "Campaign name", "Leeds dentists, October"),
      F("goal", "Goal of the campaign", "Book a demo of our software"),
    ],
  },
  {
    p: "leads",
    a: "campaign.get",
    title: "See a campaign",
    desc: "Status, open rates, and reply numbers for one campaign.",
    id: true,
    idExample: "cmp_29d0f1a8",
    read: true,
    data: {},
    fields: [],
  },
  {
    p: "leads",
    a: "campaign.list",
    title: "List campaigns",
    desc: "View all your email campaigns.",
    id: false,
    read: true,
    data: {},
    fields: [],
  },
  {
    p: "leads",
    a: "campaign.edit",
    title: "Change a campaign",
    desc: "Edit a campaign that has not started yet.",
    id: true,
    idExample: "cmp_29d0f1a8",
    read: false,
    data: { name: "Leeds dentists, Q4 Extended" },
    fields: [
      F("name", "New campaign name", "Leeds dentists, Q4 Extended"),
    ],
  },
  {
    p: "leads",
    a: "campaign.decision",
    title: "Approve or reject a campaign",
    desc: "Let a drafted campaign start sending, or stop it.",
    id: true,
    idExample: "cmp_29d0f1a8",
    read: false,
    data: { decision: "approve" },
    fields: [
      F("decision", "Decision (approve or reject)", "approve"),
    ],
  },

  // ── Social Posts ──
  {
    p: "social",
    a: "post.create",
    title: "Write a post",
    desc: "The AI writes a post. It waits for approval before going live.",
    id: false,
    read: false,
    data: {
      prompt: "Announce our newly awarded NHAI Smart Highway EPC contract 2026",
      channels: ["linkedin"],
      tone: "professional",
    },
    fields: [
      F("prompt", "What is the post about?", "Announce our newly awarded NHAI contract"),
      F("tone", "Tone of voice", "professional"),
    ],
  },
  {
    p: "social",
    a: "post.get",
    title: "See a post",
    desc: "Text, status and preview link of one post.",
    id: true,
    idExample: "post_5b3e92a1",
    read: true,
    data: {},
    fields: [],
  },
  {
    p: "social",
    a: "post.list",
    title: "List posts",
    desc: "Your posts across all connected networks.",
    id: false,
    read: true,
    data: {},
    fields: [],
  },
  {
    p: "social",
    a: "post.edit",
    title: "Change a post",
    desc: "Edit a post that has not gone live.",
    id: true,
    idExample: "post_5b3e92a1",
    read: false,
    data: { caption: "Online booking is now live for all partners." },
    fields: [
      F("caption", "New post caption", "Online booking is now live for all partners."),
    ],
  },
  {
    p: "social",
    a: "post.decision",
    title: "Approve, reject or cancel a post",
    desc: "Let a post go live, or cancel publication.",
    id: true,
    idExample: "post_5b3e92a1",
    read: false,
    data: { decision: "approve" },
    fields: [
      F("decision", "Decision (approve, reject or cancel)", "approve"),
    ],
  },

  // ── Account & Setup ──
  {
    p: "account",
    a: "wallet",
    title: "Balance and setup",
    desc: "Credits left, prices, what is connected and what this key may do.",
    id: false,
    read: true,
    data: {},
    fields: [],
  },
];

export default function BuildAndTestRequest({
  apiKey = "",
  keys = [],
  onKeyChange,
  onNavigateToKeys,
}) {
  const [activeArea, setActiveArea] = useState("voice");
  const [selectedAction, setSelectedAction] = useState(BUILD_ACTIONS[0]);
  const [searchQuery, setSearchQuery] = useState("");
  const [jsonMode, setJsonMode] = useState(false);
  const [formData, setFormData] = useState(BUILD_ACTIONS[0].data);
  const [idInput, setIdInput] = useState("");
  const [jsonInput, setJsonInput] = useState(JSON.stringify(BUILD_ACTIONS[0].data, null, 2));
  const [jsonError, setJsonError] = useState("");
  const [selectedLang, setSelectedLang] = useState("curl");
  const [isTestMode, setIsTestMode] = useState(true);

  // Live send state
  const [sending, setSending] = useState(false);
  const [serverResponse, setServerResponse] = useState(null);
  const [copiedSent, setCopiedSent] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  // Sync state when picking a new action
  const handleSelectAction = (act) => {
    setSelectedAction(act);
    setActiveArea(act.p);
    const initialData = JSON.parse(JSON.stringify(act.data || {}));
    setFormData(initialData);
    setJsonInput(JSON.stringify(initialData, null, 2));
    setIdInput(act.idExample || "");
    setJsonError("");
    setJsonMode(false);
    setServerResponse(null);
  };

  // Switch Area
  const handleSelectArea = (areaKey) => {
    setActiveArea(areaKey);
    setSearchQuery("");
    const firstAct = BUILD_ACTIONS.find((a) => a.p === areaKey);
    if (firstAct) handleSelectAction(firstAct);
  };

  // Filter actions based on area & search
  const filteredActions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      return BUILD_ACTIONS.filter(
        (a) =>
          a.title.toLowerCase().includes(q) ||
          a.a.toLowerCase().includes(q) ||
          a.p.toLowerCase().includes(q) ||
          a.desc.toLowerCase().includes(q)
      );
    }
    return BUILD_ACTIONS.filter((a) => a.p === activeArea);
  }, [searchQuery, activeArea]);

  // Compute what gets sent to POST /v1/run
  const requestPayload = useMemo(() => {
    const payload = {
      plugin: selectedAction.p,
      action: selectedAction.a,
    };
    if (selectedAction.id) {
      payload.id = idInput.trim() || "<id>";
    }
    const currentData = jsonMode ? (() => {
      try {
        return JSON.parse(jsonInput || "{}");
      } catch {
        return formData;
      }
    })() : formData;

    if (currentData && typeof currentData === "object" && Object.keys(currentData).length > 0) {
      payload.data = currentData;
    }
    return payload;
  }, [selectedAction, idInput, jsonMode, jsonInput, formData]);

  const requestJsonString = useMemo(() => {
    return JSON.stringify(requestPayload, null, 2);
  }, [requestPayload]);

  // Handle Form Input change
  const handleFormFieldChange = (key, value, type) => {
    setFormData((prev) => {
      const next = { ...prev };
      if (type === "number") {
        next[key] = value === "" ? "" : isNaN(Number(value)) ? value : Number(value);
      } else {
        next[key] = value;
      }
      setJsonInput(JSON.stringify(next, null, 2));
      return next;
    });
  };

  // Handle JSON Textarea change
  const [beautified, setBeautified] = useState(false);
  const [copiedJson, setCopiedJson] = useState(false);
  const jsonPreRef = useRef(null);

  const handleJsonChange = (e) => {
    const text = e.target.value;
    setJsonInput(text);
    try {
      const parsed = JSON.parse(text || "{}");
      setFormData(parsed);
      setJsonError("");
    } catch (err) {
      setJsonError("Invalid JSON: " + err.message);
    }
  };

  const handleBeautifyJson = () => {
    try {
      const parsed = JSON.parse(jsonInput || "{}");
      const formatted = JSON.stringify(parsed, null, 2);
      setJsonInput(formatted);
      setFormData(parsed);
      setJsonError("");
      setBeautified(true);
      setTimeout(() => setBeautified(false), 1800);
    } catch (err) {
      setJsonError("Cannot beautify: " + err.message);
    }
  };

  // Client Snippet Generator
  const generatedCode = useMemo(() => {
    const keyVal = apiKey.trim() || (isTestMode ? "sk_test_mock_developer_key" : "sk_live_YOUR_KEY");
    const payloadStr = JSON.stringify(requestPayload, null, 2);
    const ind = (s, n) => s.split("\n").map((l, i) => (i ? " ".repeat(n) + l : l)).join("\n");
    const isIdempotent = !selectedAction.read;

    if (selectedLang === "curl") {
      return `curl -X POST "${API_BASE}/v1/run" \\
  -H "Authorization: Bearer ${keyVal}" \\
  -H "Content-Type: application/json" \\
${isIdempotent ? '  -H "Idempotency-Key: a-unique-request-id" \\\n' : ""}  -d '${payloadStr}'`;
    }

    if (selectedLang === "node") {
      return `const response = await fetch("${API_BASE}/v1/run", {
  method: "POST",
  headers: {
    "Authorization": "Bearer ${keyVal}",
    "Content-Type": "application/json"${isIdempotent ? ',\n    "Idempotency-Key": crypto.randomUUID()' : ""}
  },
  body: JSON.stringify(${ind(payloadStr, 2)})
});

const result = await response.json();
console.log("Server response:", result);`;
    }

    if (selectedLang === "python") {
      return `import requests

res = requests.post(
    "${API_BASE}/v1/run",
    headers={
        "Authorization": "Bearer ${keyVal}",
        "Content-Type": "application/json"${isIdempotent ? ',\n        "Idempotency-Key": "a-unique-request-id"' : ""}
    },
    json=${payloadStr.replace(/true/g, "True").replace(/false/g, "False").replace(/null/g, "None")},
)
print("Status:", res.status_code)
print("Response:", res.json())`;
    }

    if (selectedLang === "php") {
      return `<?php
$ch = curl_init("${API_BASE}/v1/run");
curl_setopt_array($ch, [
  CURLOPT_POST => true,
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_HTTPHEADER => [
    "Authorization: Bearer ${keyVal}",
    "Content-Type: application/json"${isIdempotent ? ',\n    "Idempotency-Key: a-unique-request-id"' : ""}
  ],
  CURLOPT_POSTFIELDS => '${payloadStr.replace(/'/g, "\\'")}',
]);
$response = curl_exec($ch);
echo $response;`;
    }

    return `package main

import (
  "bytes"
  "fmt"
  "io"
  "net/http"
)

func main() {
  body := []byte(\`${payloadStr}\`)
  req, _ := http.NewRequest("POST", "${API_BASE}/v1/run", bytes.NewReader(body))
  req.Header.Set("Authorization", "Bearer ${keyVal}")
  req.Header.Set("Content-Type", "application/json")
  
  res, _ := http.DefaultClient.Do(req)
  defer res.Body.Close()
  out, _ := io.ReadAll(res.Body)
  fmt.Println(string(out))
}`;
  }, [selectedLang, apiKey, isTestMode, requestPayload, selectedAction]);

  // Real Execute to POST /v1/run
  const handleSendRequest = async () => {
    if (!apiKey.trim() || apiKey.includes("...")) {
      setServerResponse({
        status: 401,
        statusText: "Authentication Required",
        durationMs: 0,
        ok: false,
        data: {
          error: {
            code: "missing_bearer_token",
            message: "Please enter your full API Secret Key (e.g. sk_live_... or sk_test_...). You can copy it from the Active Keys tab.",
          },
        },
      });
      return;
    }

    setSending(true);
    setServerResponse(null);
    const start = performance.now();

    try {
      const res = await fetch("/v1/run", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey.trim()}`,
        },
        body: JSON.stringify(requestPayload),
      });

      const durationMs = Math.round(performance.now() - start);
      let data = {};
      try {
        data = await res.json();
      } catch {
        data = { text: await res.text() };
      }

      setServerResponse({
        status: res.status,
        statusText: res.statusText,
        durationMs,
        ok: res.ok,
        data,
      });
    } catch (err) {
      const durationMs = Math.round(performance.now() - start);
      setServerResponse({
        status: 500,
        statusText: "Network Error",
        durationMs,
        ok: false,
        data: {
          error: {
            code: "network_failure",
            message: err.message || "Failed to connect to /v1/run",
          },
        },
      });
    } finally {
      setSending(false);
    }
  };

  const currentAreaInfo = BUILD_AREAS[selectedAction.p];

  return (
    <div style={{ display: "grid", gap: 16, fontFamily: FONT_BODY }}>
      {/* Top Banner & Info */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 12,
          padding: "12px 18px",
          backgroundColor: "#F8FAFC",
          borderRadius: 14,
          border: `1px solid ${C.borderLight}`,
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <h3 style={{ fontFamily: FONT_DISPLAY, fontSize: 16, fontWeight: 700, margin: 0, color: C.textInk }}>
              Build and test a request
            </h3>
            <span
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                padding: "2px 8px",
                borderRadius: 6,
                backgroundColor: "#ECFDF5",
                color: "#059669",
                border: "1px solid #A7F3D0",
                fontFamily: FONT_MONO,
              }}
            >
              POST /v1/run
            </span>
          </div>
          <p style={{ margin: "2px 0 0", fontSize: 12.5, color: C.slate }}>
            Choose an area, then a step. We construct the payload for you; test it live and copy production client code.
          </p>
        </div>

        {/* API Key Selector / Input */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 11.5, fontWeight: 600, color: C.slate }}>Bearer Key:</span>
            <input
              type="text"
              value={apiKey}
              onChange={(e) => onKeyChange && onKeyChange(e.target.value)}
              placeholder="Paste sk_live_... or sk_test_..."
              style={{
                width: 260,
                padding: "6px 10px",
                fontSize: 12,
                fontFamily: FONT_MONO,
                borderRadius: 8,
                border: `1px solid ${C.border}`,
                backgroundColor: "#fff",
                outline: "none",
              }}
            />
          </div>
        </div>
      </div>

      {/* Main Two-Column Layout */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "310px minmax(0, 1fr)",
          gap: 20,
          alignItems: "start",
        }}
      >
        {/* ── LEFT SIDEBAR: AREAS & ACTIONS ── */}
        <div>
          {/* 4 Area Cards */}
          <div style={{ display: "grid", gap: 8, marginBottom: 14 }}>
            {Object.values(BUILD_AREAS).map((area) => {
              const isSelected = activeArea === area.id;
              const AreaIcon = area.icon;
              return (
                <button
                  key={area.id}
                  type="button"
                  onClick={() => handleSelectArea(area.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "10px 14px",
                    borderRadius: 12,
                    border: `1.5px solid ${isSelected ? area.color : C.borderLight}`,
                    backgroundColor: isSelected ? "#FAFBFD" : "#fff",
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "all 0.15s ease",
                    boxShadow: isSelected ? `0 2px 8px rgba(0,0,0,0.04)` : "none",
                  }}
                >
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 10,
                      backgroundColor: `${area.color}15`,
                      color: area.color,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <AreaIcon size={18} />
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: isSelected ? C.textInk : C.textInk }}>
                      {area.name}
                    </div>
                    <div style={{ fontSize: 11, color: C.slate, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {area.short}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Search Box */}
          <div style={{ position: "relative", marginBottom: 10 }}>
            <Search
              size={14}
              style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: C.slate }}
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search steps, e.g. book, post, call..."
              style={{
                width: "100%",
                padding: "8px 10px 8px 32px",
                borderRadius: 8,
                border: `1px solid ${C.borderLight}`,
                fontSize: 12,
                backgroundColor: "#fff",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>

          {/* Step Actions List */}
          <div
            className="custom-scrollbar"
            style={{
              maxHeight: 460,
              overflowY: "auto",
              display: "grid",
              gap: 4,
              paddingRight: 6,
            }}
          >
            {filteredActions.map((act) => {
              const isSelected = selectedAction.p === act.p && selectedAction.a === act.a;
              return (
                <button
                  key={`${act.p}.${act.a}`}
                  type="button"
                  onClick={() => handleSelectAction(act)}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 8,
                    padding: "9px 12px",
                    borderRadius: 10,
                    border: `1px solid ${isSelected ? C.cobalt : "transparent"}`,
                    backgroundColor: isSelected ? C.cobaltSoft : "transparent",
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "all 0.12s ease",
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) e.currentTarget.style.backgroundColor = "#F8FAFC";
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) e.currentTarget.style.backgroundColor = "transparent";
                  }}
                >
                  <span style={{ fontSize: 12.5, fontWeight: isSelected ? 700 : 500, color: isSelected ? C.cobalt : C.textInk }}>
                    {act.title}
                  </span>
                  <span
                    style={{
                      fontFamily: FONT_MONO,
                      fontSize: 11,
                      color: isSelected ? C.cobalt : C.slate,
                      backgroundColor: isSelected ? "#fff" : "#F1F5F9",
                      padding: "2px 6px",
                      borderRadius: 4,
                    }}
                  >
                    {act.a}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── RIGHT MAIN: HERO, INTERACTIVE FORM, REQUEST & RESPONSE ── */}
        <div style={{ display: "grid", gap: 16 }}>
          {/* Hero Header for Action */}
          <div
            style={{
              padding: "16px 20px",
              backgroundColor: "#fff",
              borderRadius: 14,
              border: `1px solid ${C.borderLight}`,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
              <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 700, margin: 0, color: C.textInk }}>
                {selectedAction.title}
              </h2>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "2px 8px",
                  borderRadius: 99,
                  backgroundColor: selectedAction.read ? "#F1F5F9" : `${currentAreaInfo.color}18`,
                  color: selectedAction.read ? C.slate : currentAreaInfo.color,
                }}
              >
                {selectedAction.read ? "Only reads" : "Makes a change"}
              </span>
              <span
                style={{
                  fontSize: 11,
                  fontFamily: FONT_MONO,
                  fontWeight: 700,
                  padding: "2px 8px",
                  borderRadius: 6,
                  backgroundColor: "#F8FAFC",
                  color: C.slate,
                  border: `1px solid ${C.borderLight}`,
                }}
              >
                {selectedAction.p} · {selectedAction.a}
              </span>
            </div>

            <p style={{ margin: "0 0 12px", fontSize: 13, color: C.slate }}>
              {selectedAction.desc}
            </p>

            {/* Facts bar */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 11.5, padding: "3px 9px", borderRadius: 6, backgroundColor: "#F1F5F9", color: C.slate }}>
                Needs permission: <strong style={{ color: C.textInk }}>{currentAreaInfo.perm}</strong>
              </span>
              <span style={{ fontSize: 11.5, padding: "3px 9px", borderRadius: 6, backgroundColor: "#F1F5F9", color: C.slate }}>
                Cost: <strong style={{ color: C.textInk }}>{selectedAction.read ? "Free" : "May use credits"}</strong>
              </span>
              <span style={{ fontSize: 11.5, padding: "3px 9px", borderRadius: 6, backgroundColor: "#F1F5F9", color: C.slate }}>
                {selectedAction.id ? "Works on one item: needs an ID" : "No id needed"}
              </span>
            </div>
          </div>

          {/* Two-Column Grid: 1. Fill details vs 2. What gets sent & 3. What comes back */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1.1fr 1fr",
              gap: 16,
              alignItems: "stretch",
            }}
          >
            {/* Box 1: Fill in the details */}
            <div
              style={{
                backgroundColor: "#fff",
                borderRadius: 14,
                border: `1px solid ${C.borderLight}`,
                padding: 18,
                display: "flex",
                flexDirection: "column",
                minHeight: 480,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: C.textInk }}>
                  1. Fill in the details
                </span>
                <div style={{ display: "inline-flex", borderRadius: 8, border: `1px solid ${C.borderLight}`, overflow: "hidden" }}>
                  <button
                    type="button"
                    onClick={() => setJsonMode(false)}
                    style={{
                      padding: "4px 10px",
                      fontSize: 11,
                      fontWeight: 600,
                      border: "none",
                      backgroundColor: !jsonMode ? C.cobalt : "#fff",
                      color: !jsonMode ? "#fff" : C.slate,
                      cursor: "pointer",
                    }}
                  >
                    Form
                  </button>
                  <button
                    type="button"
                    onClick={() => setJsonMode(true)}
                    style={{
                      padding: "4px 10px",
                      fontSize: 11,
                      fontWeight: 600,
                      border: "none",
                      backgroundColor: jsonMode ? C.cobalt : "#fff",
                      color: jsonMode ? "#fff" : C.slate,
                      cursor: "pointer",
                    }}
                  >
                    JSON
                  </button>
                </div>
              </div>

              {/* ID Input if action requires one */}
              {selectedAction.id && (
                <div style={{ marginBottom: 12 }}>
                  <label style={{ display: "block", fontSize: 11.5, fontWeight: 600, color: C.textInk, marginBottom: 4 }}>
                    Resource ID <span style={{ color: C.red }}>*</span>
                  </label>
                  <input
                    type="text"
                    value={idInput}
                    onChange={(e) => setIdInput(e.target.value)}
                    placeholder={`e.g. ${selectedAction.idExample || "id_12345"}`}
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: 8,
                      border: `1px solid ${C.border}`,
                      fontFamily: FONT_MONO,
                      fontSize: 12,
                      boxSizing: "border-box",
                      backgroundColor: "#FAFBFD",
                    }}
                  />
                  <small style={{ fontSize: 10.5, color: C.slate }}>
                    The specific item ID returned when created (e.g. from <code>call.start</code> or <code>post.create</code>).
                  </small>
                </div>
              )}

              {/* Form Mode Inputs */}
              {!jsonMode && (
                <div>
                  {selectedAction.fields.length > 0 ? (
                    <div style={{ display: "grid", gap: 10 }}>
                      {selectedAction.fields.map((f) => (
                        <div key={f.k}>
                          <label style={{ display: "block", fontSize: 11.5, fontWeight: 600, color: C.textInk, marginBottom: 4 }}>
                            {f.l}
                          </label>
                          <input
                            type={f.type === "number" ? "number" : "text"}
                            value={formData[f.k] ?? ""}
                            onChange={(e) => handleFormFieldChange(f.k, e.target.value, f.type)}
                            placeholder={f.p}
                            style={{
                              width: "100%",
                              padding: "7px 10px",
                              borderRadius: 8,
                              border: `1px solid ${C.border}`,
                              fontSize: 12.5,
                              boxSizing: "border-box",
                              outline: "none",
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  ) : Object.keys(selectedAction.data || {}).length > 0 ? (
                    <div style={{ padding: "14px 0", fontSize: 12, color: C.slate }}>
                      This action accepts complex nested data. Switch to <strong>JSON mode</strong> to customize.
                    </div>
                  ) : (
                    <div style={{ padding: "14px 0", fontSize: 12, color: C.slate }}>
                      This action does not require any additional parameters in <code>data</code>.
                    </div>
                  )}
                </div>
              )}

              {/* JSON Mode Input */}
              {jsonMode && (
                <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                  {/* Toolbar: Beautify, Copy, and Validation Status */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: 8,
                      gap: 8,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <button
                        type="button"
                        onClick={handleBeautifyJson}
                        title="Format & Beautify JSON with 2-space indentation (like Postman)"
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 5,
                          padding: "4px 10px",
                          borderRadius: 6,
                          border: `1px solid ${beautified ? "#059669" : C.border}`,
                          backgroundColor: beautified ? "#ECFDF5" : "#F8FAFC",
                          color: beautified ? "#059669" : C.cobalt,
                          fontSize: 11.5,
                          fontWeight: 600,
                          cursor: "pointer",
                          transition: "all 0.15s ease",
                        }}
                      >
                        {beautified ? <Check size={12} color="#059669" /> : <Sparkles size={12} />}
                        <span>{beautified ? "Beautified!" : "Beautify"}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(jsonInput);
                          setCopiedJson(true);
                          setTimeout(() => setCopiedJson(false), 1500);
                        }}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                          padding: "4px 8px",
                          borderRadius: 6,
                          border: `1px solid ${C.borderLight}`,
                          backgroundColor: "#fff",
                          color: C.slate,
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        {copiedJson ? <Check size={11} color="#059669" /> : <Copy size={11} />}
                        <span>{copiedJson ? "Copied" : "Copy"}</span>
                      </button>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      {jsonError ? (
                        <span style={{ fontSize: 11, color: C.red, display: "inline-flex", alignItems: "center", gap: 4 }}>
                          <AlertCircle size={11} /> Invalid JSON
                        </span>
                      ) : (
                        <span style={{ fontSize: 11, color: "#059669", display: "inline-flex", alignItems: "center", gap: 4 }}>
                          <CheckCircle2 size={11} /> Valid JSON
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Syntax Highlighted JSON Editor with synchronized overlay */}
                  <div
                    style={{
                      position: "relative",
                      flex: 1,
                      minHeight: 320,
                      borderRadius: 10,
                      backgroundColor: "#0B1120",
                      border: `1px solid ${jsonError ? C.red : "#1E293B"}`,
                      overflow: "hidden",
                    }}
                  >
                    <pre
                      ref={jsonPreRef}
                      aria-hidden="true"
                      style={{
                        position: "absolute",
                        inset: 0,
                        margin: 0,
                        padding: 12,
                        fontFamily: FONT_MONO,
                        fontSize: 12,
                        lineHeight: "19px",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-all",
                        overflow: "hidden",
                        pointerEvents: "none",
                        boxSizing: "border-box",
                        color: "#F8FAFC",
                      }}
                    >
                      {renderJsonSyntax(jsonInput)}
                    </pre>

                    <textarea
                      value={jsonInput}
                      onChange={handleJsonChange}
                      onScroll={(e) => {
                        if (jsonPreRef.current) {
                          jsonPreRef.current.scrollTop = e.target.scrollTop;
                          jsonPreRef.current.scrollLeft = e.target.scrollLeft;
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Tab") {
                          e.preventDefault();
                          const start = e.target.selectionStart;
                          const end = e.target.selectionEnd;
                          const val = e.target.value;
                          const newVal = val.substring(0, start) + "  " + val.substring(end);
                          setJsonInput(newVal);
                          try {
                            const parsed = JSON.parse(newVal || "{}");
                            setFormData(parsed);
                            setJsonError("");
                          } catch (err) {
                            setJsonError("Invalid JSON: " + err.message);
                          }
                          setTimeout(() => {
                            e.target.selectionStart = e.target.selectionEnd = start + 2;
                          }, 0);
                        }
                      }}
                      spellCheck={false}
                      className="custom-scrollbar-dark"
                      style={{
                        position: "relative",
                        width: "100%",
                        height: "100%",
                        minHeight: 320,
                        padding: 12,
                        fontFamily: FONT_MONO,
                        fontSize: 12,
                        lineHeight: "19px",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-all",
                        overflow: "auto",
                        backgroundColor: "transparent",
                        color: "transparent",
                        caretColor: "#38BDF8",
                        border: "none",
                        outline: "none",
                        resize: "none",
                        boxSizing: "border-box",
                      }}
                    />
                  </div>
                  {jsonError && (
                    <div style={{ color: C.red, fontSize: 11, marginTop: 4 }}>{jsonError}</div>
                  )}
                </div>
              )}

              {/* Send Button */}
              <div style={{ marginTop: "auto", paddingTop: 16 }}>
                <button
                  type="button"
                  onClick={handleSendRequest}
                  disabled={sending}
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    borderRadius: 10,
                    border: "none",
                    backgroundColor: C.cobalt,
                    color: "#fff",
                    fontWeight: 700,
                    fontSize: 13,
                    cursor: sending ? "wait" : "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    boxShadow: "0 2px 8px rgba(52, 87, 213, 0.25)",
                    transition: "all 0.15s ease",
                  }}
                >
                  {sending ? (
                    <>
                      <RefreshCw size={14} className="animate-spin" /> Dispatching to /v1/run...
                    </>
                  ) : (
                    <>
                      <Send size={14} /> Send Live Request
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Right Column: In Form mode shows "What gets sent" + "What comes back". In JSON mode, Server response takes the full height */}
            <div style={{ display: "flex", flexDirection: "column", gap: 14, height: "100%" }}>
              {/* 2. What gets sent (Only in Form Mode to demonstrate how form inputs map to API JSON) */}
              {!jsonMode && (
                <div
                  style={{
                    backgroundColor: "#fff",
                    borderRadius: 14,
                    border: `1px solid ${C.borderLight}`,
                    padding: 16,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: C.textInk }}>
                        2. What gets sent
                      </span>
                      <span style={{ fontSize: 10, color: C.slate, backgroundColor: "#F1F5F9", padding: "1px 6px", borderRadius: 4 }}>
                        Generated from Form
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(requestJsonString);
                        setCopiedSent(true);
                        setTimeout(() => setCopiedSent(false), 1500);
                      }}
                      style={{
                        background: "none",
                        border: "none",
                        color: C.cobalt,
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                      }}
                    >
                      {copiedSent ? <Check size={12} color="#059669" /> : <Copy size={12} />}
                      {copiedSent ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <div
                    className="custom-scrollbar-dark"
                    style={{
                      backgroundColor: "#0F172A",
                      borderRadius: 10,
                      padding: 12,
                      fontFamily: FONT_MONO,
                      fontSize: 11.5,
                      color: "#F8FAFC",
                      maxHeight: 160,
                      overflowY: "auto",
                    }}
                  >
                    <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                      {renderJsonSyntax(requestJsonString)}
                    </pre>
                  </div>
                </div>
              )}

              {/* Server Response Card: In Form mode it is Step 3, in JSON mode it expands to full height as Step 2 */}
              <div
                style={{
                  backgroundColor: "#fff",
                  borderRadius: 14,
                  border: `1px solid ${C.borderLight}`,
                  padding: 16,
                  display: "flex",
                  flexDirection: "column",
                  flex: 1,
                  minHeight: jsonMode ? 480 : "auto",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: C.textInk }}>
                      {jsonMode ? "2. Server response" : "3. What comes back"}
                    </span>
                    {serverResponse && (
                      <span
                        style={{
                          fontSize: 10.5,
                          fontWeight: 700,
                          padding: "1px 6px",
                          borderRadius: 4,
                          backgroundColor: serverResponse.ok ? "#ECFDF5" : "#FEF2F2",
                          color: serverResponse.ok ? "#059669" : "#DC2626",
                        }}
                      >
                        HTTP {serverResponse.status} {serverResponse.durationMs ? `(${serverResponse.durationMs}ms)` : ""}
                      </span>
                    )}
                  </div>
                  {serverResponse && (
                    <button
                      type="button"
                      onClick={() => {
                        const str = typeof serverResponse.data === "object" ? JSON.stringify(serverResponse.data, null, 2) : String(serverResponse.data);
                        navigator.clipboard.writeText(str);
                      }}
                      style={{
                        background: "none",
                        border: "none",
                        color: C.cobalt,
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                      }}
                    >
                      <Copy size={12} />
                      <span>Copy</span>
                    </button>
                  )}
                </div>

                <div
                  className="custom-scrollbar-dark"
                  style={{
                    backgroundColor: "#0F172A",
                    borderRadius: 10,
                    padding: 12,
                    fontFamily: FONT_MONO,
                    fontSize: 11.5,
                    color: "#F8FAFC",
                    flex: 1,
                    minHeight: jsonMode ? 380 : 120,
                    maxHeight: jsonMode ? "none" : 220,
                    overflowY: "auto",
                  }}
                >
                  {serverResponse ? (
                    <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                      {renderJsonSyntax(typeof serverResponse.data === "object" ? JSON.stringify(serverResponse.data, null, 2) : String(serverResponse.data))}
                    </pre>
                  ) : (
                    <div style={{ color: "#64748B", textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center", height: "100%", minHeight: 120 }}>
                      Press "Send Live Request" to see server output.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Box 4: Copy the code */}
          <div
            style={{
              backgroundColor: "#fff",
              borderRadius: 14,
              border: `1px solid ${C.borderLight}`,
              padding: 18,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: C.textInk }}>
                {jsonMode ? "3. Copy the code" : "4. Copy the code"}
              </span>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                {[
                  { id: "curl", label: "cURL" },
                  { id: "node", label: "Node.js" },
                  { id: "python", label: "Python" },
                  { id: "php", label: "PHP" },
                  { id: "go", label: "Go" },
                ].map((lang) => (
                  <button
                    key={lang.id}
                    type="button"
                    onClick={() => setSelectedLang(lang.id)}
                    style={{
                      padding: "3px 9px",
                      borderRadius: 6,
                      border: `1px solid ${selectedLang === lang.id ? C.cobalt : C.borderLight}`,
                      backgroundColor: selectedLang === lang.id ? C.cobalt : "#fff",
                      color: selectedLang === lang.id ? "#fff" : C.slate,
                      fontSize: 11.5,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    {lang.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(generatedCode);
                    setCopiedCode(true);
                    setTimeout(() => setCopiedCode(false), 1500);
                  }}
                  style={{
                    padding: "3px 10px",
                    borderRadius: 6,
                    border: `1px solid ${C.border}`,
                    backgroundColor: "#fff",
                    color: C.textInk,
                    fontSize: 11.5,
                    fontWeight: 600,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  {copiedCode ? <Check size={12} color="#059669" /> : <Copy size={12} />}
                  {copiedCode ? "Copied" : "Copy code"}
                </button>
              </div>
            </div>

            <div
              style={{
                backgroundColor: "#0F172A",
                borderRadius: 10,
                padding: 14,
                fontFamily: FONT_MONO,
                fontSize: 11.5,
                color: "#E2E8F0",
                maxHeight: 240,
                overflowX: "auto",
                lineHeight: 1.5,
              }}
            >
              <pre style={{ margin: 0 }}>{generatedCode}</pre>
            </div>

            {selectedAction.read && (
              <div style={{ marginTop: 10, fontSize: 11.5, color: C.slate }}>
                💡 Because this step only reads, it can also be requested via direct link:{" "}
                <code style={{ color: C.cobalt, fontFamily: FONT_MONO }}>
                  {API_BASE}/v1/run?plugin={selectedAction.p}&amp;action={selectedAction.a}{selectedAction.id ? "&id=<id>" : ""}
                </code>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
