"""Standalone Mock Client Application & Webhook Receiver for Outreach API
Run with:
    python client_test_app.py

Then open in your browser:
    http://localhost:8001

Features:
- Tests both GET and POST requests across all 27 Outreach API actions (Voice, Leads, Social, Account)
- Live Webhook Listener on http://localhost:8001/webhook
- Validates HMAC-SHA256 signatures with your Webhook Secret (whsec_...)
- Real-time event log and payload inspector in the web browser
- 1-Click Social Webhook Simulator (triggers post.ready, post.approved, post.published, post.rejected)
"""

import hashlib
import hmac
import http.server
import json
import os
import sys
import threading
import time
import urllib.error
import urllib.request
from typing import Any, Dict, List

PORT = 8001
HOST = "0.0.0.0"

# In-memory storage for received webhooks
RECEIVED_EVENTS: List[Dict[str, Any]] = []
CONFIG = {
    "api_base": os.getenv("OUTREACH_API_BASE", "http://127.0.0.1:8000"),
    "api_key": os.getenv("OUTREACH_API_KEY", ""),
    "webhook_secret": os.getenv("OUTREACH_WEBHOOK_SECRET", ""),
}

HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Acme CRM - Outreach API & Webhook Test Client</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #F1F5F9;
      --card-bg: #FFFFFF;
      --card-border: #E2E8F0;
      --card-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.05), 0 1px 2px -1px rgba(0, 0, 0, 0.05);
      --text: #0F172A;
      --heading: #0F172A;
      --slate: #64748B;
      --cobalt: #2563EB;
      --green: #10B981;
      --purple: #7C3AED;
      --amber: #D97706;
      --red: #EF4444;
      --input-bg: #F8FAFC;
      --input-border: #CBD5E1;
      --input-color: #0F172A;
      --pre-bg: #0F172A;
      --pre-text: #38BDF8;
      --tab-bg: #F1F5F9;
      --tab-color: #64748B;
      --tab-border: #E2E8F0;
      --preset-bg: #F8FAFC;
      --preset-border: #CBD5E1;
      --preset-color: #1E293B;
      --preset-hover-bg: #E2E8F0;
      --webhook-bg: #F8FAFC;
      --webhook-border: #E2E8F0;
      --step-bg: #EFF6FF;
      --step-border: #BFDBFE;
      --step-text: #1E3A8A;
      --social-box-bg: #FAF5FF;
      --social-box-border: #D8B4FE;
    }

    [data-theme="dark"] {
      --bg: #0B1120;
      --card-bg: #1E293B;
      --card-border: #334155;
      --card-shadow: none;
      --text: #F8FAFC;
      --heading: #E2E8F0;
      --slate: #94A3B8;
      --cobalt: #3B82F6;
      --green: #10B981;
      --purple: #8B5CF6;
      --amber: #F59E0B;
      --red: #EF4444;
      --input-bg: #0F172A;
      --input-border: #334155;
      --input-color: #FFFFFF;
      --pre-bg: #070B14;
      --pre-text: #38BDF8;
      --tab-bg: #0F172A;
      --tab-color: #94A3B8;
      --tab-border: #334155;
      --preset-bg: #0F172A;
      --preset-border: #334155;
      --preset-color: #E2E8F0;
      --preset-hover-bg: #1E293B;
      --webhook-bg: #0F172A;
      --webhook-border: #334155;
      --step-bg: rgba(59, 130, 246, 0.08);
      --step-border: rgba(59, 130, 246, 0.25);
      --step-text: inherit;
      --social-box-bg: linear-gradient(180deg, rgba(139, 92, 246, 0.06) 0%, var(--card-bg) 100%);
      --social-box-border: rgba(139, 92, 246, 0.4);
    }

    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      max-width: 100vw;
      overflow-x: hidden;
      background: var(--bg);
      color: var(--text);
      font-family: 'Inter', -apple-system, sans-serif;
    }
    body {
      padding: 16px 20px;
    }
    .container {
      width: 100%;
      max-width: 1360px;
      margin: 0 auto;
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--card-border);
      flex-wrap: wrap;
      gap: 12px;
    }
    h1 {
      margin: 0;
      font-size: 19px;
      font-weight: 800;
      color: var(--heading);
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .badge {
      font-size: 11px;
      padding: 3px 8px;
      border-radius: 99px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .badge-live { background: #ECFDF5; color: #065F46; border: 1px solid #A7F3D0; }
    [data-theme="dark"] .badge-live { background: #064E3B; color: #6EE7B7; border: 1px solid #059669; }
    
    .badge-get { background: #ECFDF5; color: #047857; font-weight: 800; font-size: 10px; padding: 2px 6px; border-radius: 4px; border: 1px solid #A7F3D0; }
    [data-theme="dark"] .badge-get { background: #064E3B; color: #34D399; border: none; }

    .badge-post { background: #EFF6FF; color: #1D4ED8; font-weight: 800; font-size: 10px; padding: 2px 6px; border-radius: 4px; border: 1px solid #BFDBFE; }
    [data-theme="dark"] .badge-post { background: #1E3A8A; color: #60A5FA; border: none; }
    
    .grid {
      display: grid;
      grid-template-columns: minmax(0, 1.15fr) minmax(0, 0.85fr);
      gap: 16px;
      width: 100%;
    }
    .grid > div {
      min-width: 0;
      width: 100%;
    }
    @media (max-width: 980px) {
      .grid { grid-template-columns: minmax(0, 1fr); }
    }
    
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 16px;
      box-shadow: var(--card-shadow);
      width: 100%;
      box-sizing: border-box;
    }
    h2 {
      margin: 0 0 10px;
      font-size: 14px;
      font-weight: 700;
      color: var(--heading);
      display: flex;
      align-items: center;
      gap: 6px;
    }
    label { display: block; font-size: 11.5px; font-weight: 600; color: var(--slate); margin-bottom: 4px; }
    input, select, textarea {
      width: 100%;
      max-width: 100%;
      box-sizing: border-box;
      background: var(--input-bg);
      border: 1px solid var(--input-border);
      border-radius: 6px;
      padding: 7px 10px;
      color: var(--input-color);
      font-size: 12.5px;
      font-family: inherit;
      outline: none;
      transition: border 0.15s, box-shadow 0.15s;
    }
    input:focus, select:focus, textarea:focus {
      border-color: var(--cobalt);
      box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.15);
    }
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      border-radius: 6px;
      font-weight: 600;
      font-size: 12px;
      cursor: pointer;
      border: none;
      transition: all 0.15s;
    }
    .btn:hover { filter: brightness(1.08); transform: translateY(-1px); }
    .btn:active { transform: translateY(0); }
    .btn-primary { background: var(--cobalt); color: #fff; }
    .btn-secondary {
      background: var(--tab-bg);
      color: var(--text);
      border: 1px solid var(--card-border);
    }
    .btn-success { background: var(--green); color: #fff; }
    .btn-amber { background: var(--amber); color: #fff; }
    .btn-danger { background: var(--red); color: #fff; }
    
    .category-tab {
      padding: 6px 12px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
      background: var(--tab-bg);
      color: var(--tab-color);
      border: 1px solid var(--tab-border);
      transition: all 0.15s;
    }
    .category-tab.active {
      background: var(--cobalt);
      color: #fff;
      border-color: var(--cobalt);
    }
    
    .preset-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 9px;
      border-radius: 6px;
      background: var(--preset-bg);
      color: var(--preset-color);
      border: 1px solid var(--preset-border);
      font-size: 11.5px;
      cursor: pointer;
      transition: all 0.15s;
      white-space: nowrap;
    }
    .preset-btn:hover {
      border-color: var(--cobalt);
      background: var(--preset-hover-bg);
    }
    .preset-btn.active {
      border-color: var(--cobalt);
      background: rgba(37, 99, 235, 0.1);
      color: var(--cobalt);
    }
    
    .webhook-item {
      background: var(--webhook-bg);
      border: 1px solid var(--webhook-border);
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 10px;
      width: 100%;
      box-sizing: border-box;
    }
    .webhook-meta {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      margin-bottom: 6px;
    }
    .sig-verified {
      background: #ECFDF5;
      color: #065F46;
      border: 1px solid #A7F3D0;
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 4px;
      font-weight: 700;
    }
    [data-theme="dark"] .sig-verified { background: #064E3B; color: #6EE7B7; border-color: #059669; }
    
    .sig-invalid {
      background: #FEF2F2;
      color: #991B1B;
      border: 1px solid #FECACA;
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 4px;
      font-weight: 700;
    }
    [data-theme="dark"] .sig-invalid { background: #7F1D1D; color: #FCA5A5; border-color: #DC2626; }
    
    pre {
      margin: 0;
      padding: 10px 12px;
      background: var(--pre-bg);
      border-radius: 6px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 11.5px;
      color: var(--pre-text);
      max-height: 280px;
      overflow-x: auto;
      white-space: pre-wrap;
      word-break: break-all;
      word-wrap: break-word;
      max-width: 100%;
      box-sizing: border-box;
    }
    .step-box {
      background: var(--step-bg);
      border: 1px solid var(--step-border);
      color: var(--step-text);
      border-radius: 8px;
      padding: 10px 14px;
      margin-bottom: 12px;
      font-size: 12px;
      line-height: 1.45;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div>
        <h1>🏢 Acme CRM Client App <span class="badge badge-live">External Simulator</span></h1>
        <div style="font-size: 12px; color: var(--slate); margin-top: 4px;">
          Test <strong>GET</strong> & <strong>POST</strong> requests for all 27 Outreach API actions and inspect incoming webhooks in real-time.
        </div>
      </div>
      <div style="display: flex; align-items: center; gap: 14px; text-align: right;">
        <div style="font-size: 12px; color: var(--slate);">
          REGISTER WEBHOOK URL:<br>
          <code style="color: var(--cobalt); font-weight: 700; font-size: 12.5px;" id="webhookUrlDisp">http://localhost:8001/webhook</code>
        </div>
        <button class="btn btn-secondary" onclick="toggleTheme()" id="themeToggleBtn" style="padding: 5px 10px; font-size: 11.5px;">
          ☀️ Light Theme
        </button>
      </div>
    </header>

    <div class="grid">
      <!-- LEFT COLUMN: REQUESTS & TOOLS -->
      <div>
        <!-- 1. Credentials Card -->
        <div class="card">
          <h2>1. Client Credentials & Target Server</h2>
          <div style="display: flex; gap: 8px; margin-bottom: 12px;">
            <button class="btn btn-secondary" onclick="setServer('local')">🖥️ Localhost (127.0.0.1:8000)</button>
            <button class="btn btn-secondary" onclick="setServer('live')">☁️ Live Cloud (outreach.aivhub.com)</button>
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px;">
            <div>
              <label>Outreach API Base URL</label>
              <input type="text" id="apiBase" value="http://127.0.0.1:8000">
            </div>
            <div>
              <label>API Secret Key (Bearer sk_live_... / sk_test_...)</label>
              <input type="text" id="apiKey" placeholder="sk_test_..." value="">
            </div>
          </div>
          <div style="margin-bottom: 10px;">
            <label>Webhook Signing Secret (whsec_... from Outreach Webhooks tab)</label>
            <input type="text" id="whSecret" placeholder="whsec_xxxxxxxxxxxxxxxxxxxxxxxx" value="">
          </div>
          <button class="btn btn-primary" onclick="saveConfig()">💾 Save Client Credentials</button>
        </div>

        <!-- 2. Interactive Social Media Webhook Tester -->
        <div class="card" style="border-color: rgba(139, 92, 246, 0.4); background: linear-gradient(180deg, rgba(139, 92, 246, 0.06) 0%, var(--card-bg) 100%);">
          <h2>📢 Social Media Webhook Workflow</h2>
          <div class="step-box">
            <strong>How to test Social Webhooks here:</strong><br>
            1. Copy <code style="color:#38BDF8;" id="stepWebhookUrl">http://localhost:8001/webhook</code> and register it in <strong>Outreach Settings → Developer → Webhooks</strong> tab (check <em>post.ready, post.approved, post.published, post.rejected</em>).<br>
            2. Paste the generated <strong>whsec_...</strong> secret above and click <strong>Save</strong>.<br>
            3. Click the buttons below in sequence to test post creation, approval, and live webhooks!
          </div>

          <div style="display: flex; gap: 8px; flex-wrap: wrap;">
            <button class="btn btn-primary" onclick="testSocialCreate()">
              🚀 1. Trigger post.create (Fires post.ready)
            </button>
            <button class="btn btn-success" id="btnApprove" disabled onclick="testSocialApprove()">
              ✅ 2. Approve Post (Fires post.approved & post.published)
            </button>
            <button class="btn btn-danger" id="btnReject" disabled onclick="testSocialReject()">
              ❌ 3. Reject Post (Fires post.rejected)
            </button>
          </div>
          <div id="socialTestStatus" style="font-size: 11.5px; color: var(--slate); margin-top: 8px;">
            Ready to test. Click "1. Trigger post.create" to draft a post and inspect its incoming webhook on the right.
          </div>
        </div>

        <!-- 3. API Command Center (Supports ALL 27 Actions with GET and POST) -->
        <div class="card">
          <h2>2. Send API Command (GET & POST)</h2>
          
          <!-- Category Tabs -->
          <div style="display: flex; gap: 6px; margin-bottom: 10px; flex-wrap: wrap;">
            <button class="category-tab active" onclick="switchCategory('social')">📢 Social Posts (5)</button>
            <button class="category-tab" onclick="switchCategory('voice')">📞 Voice & Meetings (12)</button>
            <button class="category-tab" onclick="switchCategory('leads')">👥 Leads & Email (9)</button>
            <button class="category-tab" onclick="switchCategory('account')">💳 Account & Wallets (1)</button>
          </div>

          <!-- Actions Grid -->
          <div id="presetsContainer" style="display: flex; gap: 6px; margin-bottom: 14px; flex-wrap: wrap;">
            <!-- Rendered by JS -->
          </div>

          <!-- Request Bar -->
          <div style="display: flex; gap: 8px; margin-bottom: 10px; align-items: center;">
            <select id="reqMethod" style="width: 110px; font-weight: 700;" onchange="handleMethodChange()">
              <option value="POST">POST</option>
              <option value="GET">GET</option>
              <option value="PATCH">PATCH</option>
              <option value="DELETE">DELETE</option>
            </select>
            <input type="text" id="reqEndpoint" value="/v1/run" style="font-family: 'JetBrains Mono', monospace; font-size: 12px;">
            <button class="btn btn-primary" style="padding: 7px 16px; white-space: nowrap;" onclick="sendRequest()">
              🚀 Send Request
            </button>
          </div>

          <!-- Body Section (Shown for POST/PATCH) -->
          <div id="bodyContainer">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
              <label style="margin: 0;">Request JSON Body</label>
              <button class="btn btn-secondary" style="padding: 2px 8px; font-size: 10.5px;" onclick="beautifyJson()">✨ Beautify JSON</button>
            </div>
            <textarea id="requestBody" rows="9" style="font-family: 'JetBrains Mono', monospace; font-size: 12px;"></textarea>
          </div>
          <div id="getNote" style="display: none; padding: 10px; background: #0F172A; border-radius: 6px; font-size: 12px; color: var(--slate); margin-bottom: 10px;">
            ℹ️ <strong>GET Request mode:</strong> Parameters are passed in the URL query string above. No request body is sent.
          </div>

          <h2 style="margin-top: 16px; font-size: 13.5px;">Response Output</h2>
          <pre id="responseOutput">// Server reply will appear here...</pre>
        </div>
      </div>

      <!-- RIGHT COLUMN: REAL-TIME WEBHOOK INBOX -->
      <div>
        <div class="card" style="height: 100%;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
            <h2>3. Live Webhook Inbox (<span id="eventCount">0</span> events)</h2>
            <div style="display: flex; gap: 6px;">
              <button class="btn btn-secondary" style="padding: 3px 8px; font-size: 11px;" onclick="simulateLocalWebhook()">🧪 Test Verification</button>
              <button class="btn btn-secondary" style="padding: 3px 8px; font-size: 11px;" onclick="clearEvents()">Clear</button>
            </div>
          </div>

          <p style="font-size: 12px; color: var(--slate); margin: 0 0 12px;">
            Incoming HTTP POST events from Outreach are automatically verified via <code>X-Outreach-Signature</code> HMAC-SHA256.
          </p>

          <div id="eventsContainer" style="max-height: 800px; overflow-y: auto;">
            <div style="padding: 30px 20px; text-align: center; color: var(--slate); font-size: 13px;">
              Waiting for incoming webhooks on <code style="color:var(--cobalt); font-weight:700;" id="inboxWebhookUrl">http://localhost:8001/webhook</code>...
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <script>
    let currentPostId = null;
    let activeCategory = 'social';

    // Complete catalog of 27 actions across Voice, Leads, Social, Account
    const ACTIONS = {
      social: [
        {
          id: "post.create",
          title: "Write a post",
          method: "POST",
          endpoint: "/v1/run",
          body: {
            plugin: "social",
            action: "post.create",
            data: {
              prompt: "Announce our newly awarded NHAI Smart Highway EPC contract 2026",
              channels: ["linkedin"],
              tone: "professional"
            }
          }
        },
        {
          id: "post.get",
          title: "See a post [GET]",
          method: "GET",
          endpoint: "/v1/run?plugin=social&action=post.get&id=post_sample_id",
          body: null
        },
        {
          id: "post.list",
          title: "List posts [GET]",
          method: "GET",
          endpoint: "/v1/run?plugin=social&action=post.list",
          body: null
        },
        {
          id: "post.edit",
          title: "Change a post",
          method: "POST",
          endpoint: "/v1/run",
          body: {
            plugin: "social",
            action: "post.edit",
            id: "post_sample_id",
            data: {
              caption: "Updated caption: Partnering for clean tech expansion in 2026."
            }
          }
        },
        {
          id: "post.decision",
          title: "Approve / Reject post",
          method: "POST",
          endpoint: "/v1/run",
          body: {
            plugin: "social",
            action: "post.decision",
            id: "post_sample_id",
            data: {
              decision: "approve"
            }
          }
        }
      ],
      voice: [
        {
          id: "call.start",
          title: "Start a call",
          method: "POST",
          endpoint: "/v1/run",
          body: {
            plugin: "voice",
            action: "call.start",
            data: {
              to: "+447911123456",
              lead_name: "Sarah Jenkins",
              goal: "Schedule a 15-minute product demo",
              instructions: "Be polite and friendly. Do not discuss pricing."
            }
          }
        },
        {
          id: "call.get",
          title: "See a call [GET]",
          method: "GET",
          endpoint: "/v1/run?plugin=voice&action=call.get&id=call_sample_id",
          body: null
        },
        {
          id: "call.list",
          title: "List calls [GET]",
          method: "GET",
          endpoint: "/v1/run?plugin=voice&action=call.list&status=completed&limit=20",
          body: null
        },
        {
          id: "call.hangup",
          title: "End a call",
          method: "POST",
          endpoint: "/v1/run",
          body: {
            plugin: "voice",
            action: "call.hangup",
            id: "call_sample_id",
            data: {}
          }
        },
        {
          id: "call.control",
          title: "Steer live call",
          method: "POST",
          endpoint: "/v1/run",
          body: {
            plugin: "voice",
            action: "call.control",
            id: "call_sample_id",
            data: { instruction: "Offer Tuesday at 3pm instead." }
          }
        },
        {
          id: "call.recording",
          title: "Download recording [GET]",
          method: "GET",
          endpoint: "/v1/run?plugin=voice&action=call.recording&id=call_sample_id",
          body: null
        },
        {
          id: "scripts.list",
          title: "Call scripts [GET]",
          method: "GET",
          endpoint: "/v1/run?plugin=voice&action=scripts.list",
          body: null
        },
        {
          id: "meeting.slots",
          title: "Open times [GET]",
          method: "GET",
          endpoint: "/v1/run?plugin=voice&action=meeting.slots&days=7",
          body: null
        },
        {
          id: "meeting.book",
          title: "Book a meeting",
          method: "POST",
          endpoint: "/v1/run",
          body: {
            plugin: "voice",
            action: "meeting.book",
            data: {
              name: "Sarah Jenkins",
              email: "sarah@acme.com",
              start: "2026-10-18T14:00:00Z"
            }
          }
        },
        {
          id: "meeting.list",
          title: "List meetings [GET]",
          method: "GET",
          endpoint: "/v1/run?plugin=voice&action=meeting.list",
          body: null
        },
        {
          id: "meeting.get",
          title: "See a meeting [GET]",
          method: "GET",
          endpoint: "/v1/run?plugin=voice&action=meeting.get&id=mtg_sample_id",
          body: null
        },
        {
          id: "meeting.update",
          title: "Cancel/Move meeting",
          method: "POST",
          endpoint: "/v1/run",
          body: {
            plugin: "voice",
            action: "meeting.update",
            id: "mtg_sample_id",
            data: { status: "cancelled" }
          }
        }
      ],
      leads: [
        {
          id: "search.create",
          title: "Find companies",
          method: "POST",
          endpoint: "/v1/run",
          body: {
            plugin: "leads",
            action: "search.create",
            data: { query: "dental clinics in Leeds", limit: 10 }
          }
        },
        {
          id: "search.get",
          title: "See search [GET]",
          method: "GET",
          endpoint: "/v1/run?plugin=leads&action=search.get&id=srch_sample_id",
          body: null
        },
        {
          id: "lead.add",
          title: "Add your leads",
          method: "POST",
          endpoint: "/v1/run",
          body: {
            plugin: "leads",
            action: "lead.add",
            data: {
              leads: [{ name: "Dr. Jo Bloggs", email: "jo@bloggsdental.com", company: "Bloggs Dental" }]
            }
          }
        },
        {
          id: "lead.list",
          title: "Saved leads [GET]",
          method: "GET",
          endpoint: "/v1/run?plugin=leads&action=lead.list&limit=25",
          body: null
        },
        {
          id: "campaign.create",
          title: "Draft campaign",
          method: "POST",
          endpoint: "/v1/run",
          body: {
            plugin: "leads",
            action: "campaign.create",
            data: { name: "Leeds Dentists Outreach", goal: "Book software demo" }
          }
        },
        {
          id: "campaign.get",
          title: "See campaign [GET]",
          method: "GET",
          endpoint: "/v1/run?plugin=leads&action=campaign.get&id=cmp_sample_id",
          body: null
        },
        {
          id: "campaign.list",
          title: "List campaigns [GET]",
          method: "GET",
          endpoint: "/v1/run?plugin=leads&action=campaign.list",
          body: null
        },
        {
          id: "campaign.edit",
          title: "Edit campaign",
          method: "POST",
          endpoint: "/v1/run",
          body: {
            plugin: "leads",
            action: "campaign.edit",
            id: "cmp_sample_id",
            data: { name: "Leeds Dentists Q4" }
          }
        },
        {
          id: "campaign.decision",
          title: "Approve campaign",
          method: "POST",
          endpoint: "/v1/run",
          body: {
            plugin: "leads",
            action: "campaign.decision",
            id: "cmp_sample_id",
            data: { decision: "approve" }
          }
        }
      ],
      account: [
        {
          id: "wallet",
          title: "Wallets & Balance [GET]",
          method: "GET",
          endpoint: "/v1/run?plugin=account&action=wallet",
          body: null
        }
      ]
    };

    function setServer(env) {
      const baseInput = document.getElementById("apiBase");
      baseInput.value = (env === 'live') ? "https://outreach.aivhub.com" : "http://127.0.0.1:8000";
    }

    function switchCategory(cat) {
      activeCategory = cat;
      document.querySelectorAll('.category-tab').forEach(b => b.classList.remove('active'));
      const activeBtn = Array.from(document.querySelectorAll('.category-tab')).find(b => b.innerText.toLowerCase().includes(cat));
      if (activeBtn) activeBtn.classList.add('active');

      const cont = document.getElementById("presetsContainer");
      cont.innerHTML = ACTIONS[cat].map(item => `
        <button class="preset-btn" onclick="selectAction('${cat}', '${item.id}')">
          <span class="${item.method === 'GET' ? 'badge-get' : 'badge-post'}">${item.method}</span>
          <span>${item.title.replace(' [GET]', '')}</span>
        </button>
      `).join('');
    }

    function selectAction(cat, actionId) {
      const item = ACTIONS[cat].find(a => a.id === actionId);
      if (!item) return;

      let ep = item.endpoint;
      if (currentPostId) {
        ep = ep.replace("post_sample_id", currentPostId);
      }
      document.getElementById("reqMethod").value = item.method;
      document.getElementById("reqEndpoint").value = ep;
      handleMethodChange();

      if (item.body) {
        const bodyClone = JSON.parse(JSON.stringify(item.body));
        if (bodyClone.id === "post_sample_id" && currentPostId) {
          bodyClone.id = currentPostId;
        }
        document.getElementById("requestBody").value = JSON.stringify(bodyClone, null, 2);
      } else {
        document.getElementById("requestBody").value = "";
      }
    }

    function handleMethodChange() {
      const method = document.getElementById("reqMethod").value;
      const isGet = (method === 'GET');
      document.getElementById("bodyContainer").style.display = isGet ? 'none' : 'block';
      document.getElementById("getNote").style.display = isGet ? 'block' : 'none';
    }

    function beautifyJson() {
      try {
        const parsed = JSON.parse(document.getElementById("requestBody").value);
        document.getElementById("requestBody").value = JSON.stringify(parsed, null, 2);
      } catch (e) {
        alert("Invalid JSON: " + e.message);
      }
    }

    async function saveConfig() {
      const cfg = {
        api_base: document.getElementById("apiBase").value.trim(),
        api_key: document.getElementById("apiKey").value.trim(),
        webhook_secret: document.getElementById("whSecret").value.trim()
      };
      localStorage.setItem("acme_api_base", cfg.api_base);
      localStorage.setItem("acme_api_key", cfg.api_key);
      localStorage.setItem("acme_wh_secret", cfg.webhook_secret);
      await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cfg)
      });
      alert("Credentials saved in test client!");
    }

    async function sendRequest() {
      const out = document.getElementById("responseOutput");
      out.innerText = "Dispatching request...";

      let api_base = document.getElementById("apiBase").value.trim();
      if (api_base.includes("api.outreach.aivhub.com")) {
        api_base = api_base.replace("api.outreach.aivhub.com", "outreach.aivhub.com");
        document.getElementById("apiBase").value = api_base;
      }
      const api_key = document.getElementById("apiKey").value.trim();
      const webhook_secret = document.getElementById("whSecret").value.trim();

      if (!api_key) {
        out.innerText = "⚠️ Missing API Secret Key! Please enter your sk_live_... or sk_test_... key above.";
        return;
      }

      // Auto-persist in localStorage
      localStorage.setItem("acme_api_base", api_base);
      localStorage.setItem("acme_api_key", api_key);
      if (webhook_secret) localStorage.setItem("acme_wh_secret", webhook_secret);

      const method = document.getElementById("reqMethod").value;
      const endpoint = document.getElementById("reqEndpoint").value.trim();
      let body = null;

      if (method !== 'GET') {
        const bodyStr = document.getElementById("requestBody").value.trim();
        if (bodyStr) {
          try {
            body = JSON.parse(bodyStr);
          } catch (e) {
            out.innerText = "Error: Invalid JSON body\\n" + e.message;
            return;
          }
        }
      }

      try {
        const res = await fetch("/api/proxy-run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ method, endpoint, body, api_base, api_key, webhook_secret })
        });
        const json = await res.json();
        out.innerText = JSON.stringify(json, null, 2);
        return json;
      } catch (err) {
        out.innerText = "Request failed: " + err.message;
      }
    }

    // ── Dedicated Social Webhook Tester ──
    async function testSocialCreate() {
      const st = document.getElementById("socialTestStatus");
      st.innerHTML = "⏳ Creating post via <code>social.post.create</code>...";
      const currentBody = document.getElementById("requestBody").value.trim();
      const currentMethod = document.getElementById("reqMethod").value;
      if (!currentBody || !currentBody.includes("post.create") || currentMethod !== "POST") {
        selectAction('social', 'post.create');
      }
      const res = await sendRequest();

      if (res && (res.id || (res.data && res.data.id))) {
        currentPostId = res.id || res.data.id;
        st.innerHTML = `✅ Post created: <strong>${currentPostId}</strong>. Check Live Webhook Inbox on the right for <strong>post.ready</strong> event! Now click "2. Approve Post" below.`;
        document.getElementById("btnApprove").disabled = false;
        document.getElementById("btnReject").disabled = false;
      } else {
        st.innerHTML = `⚠️ Post request responded: ${JSON.stringify(res)}`;
      }
    }

    async function testSocialApprove() {
      if (!currentPostId) return alert("Create a post first!");
      const st = document.getElementById("socialTestStatus");
      st.innerHTML = `⏳ Approving post <code>${currentPostId}</code>...`;

      document.getElementById("reqMethod").value = "POST";
      document.getElementById("reqEndpoint").value = "/v1/run";
      handleMethodChange();
      document.getElementById("requestBody").value = JSON.stringify({
        plugin: "social",
        action: "post.decision",
        id: currentPostId,
        data: { decision: "approve" }
      }, null, 2);

      await sendRequest();
      st.innerHTML = `✅ Post approved! Outreach will dispatch <strong>post.approved</strong> and <strong>post.published</strong> webhooks!`;
    }

    async function testSocialReject() {
      if (!currentPostId) return alert("Create a post first!");
      const st = document.getElementById("socialTestStatus");
      st.innerHTML = `⏳ Rejecting post <code>${currentPostId}</code>...`;

      document.getElementById("reqMethod").value = "POST";
      document.getElementById("reqEndpoint").value = "/v1/run";
      handleMethodChange();
      document.getElementById("requestBody").value = JSON.stringify({
        plugin: "social",
        action: "post.decision",
        id: currentPostId,
        data: { decision: "reject" }
      }, null, 2);

      await sendRequest();
      st.innerHTML = `❌ Post rejected! Outreach will dispatch <strong>post.rejected</strong> webhook!`;
    }

    async function simulateLocalWebhook() {
      await fetch("/api/test-webhook-simulate", { method: "POST" });
      pollEvents();
    }

    // ── Live Webhook Inbox Polling ──
    async function pollEvents() {
      try {
        const res = await fetch("/api/events");
        const events = await res.json();
        document.getElementById("eventCount").innerText = events.length;

        const cont = document.getElementById("eventsContainer");
        if (events.length === 0) {
          cont.innerHTML = `<div style="padding: 30px 20px; text-align: center; color: var(--slate); font-size: 13px;">Waiting for incoming webhooks on <code style="color:var(--cobalt); font-weight:700;">${myWebhookUrl}</code>...</div>`;
          return;
        }

        cont.innerHTML = events.slice().reverse().map((ev) => {
          const sigBadge = ev.sig_valid
            ? '<span class="sig-verified">HMAC SIGNATURE VERIFIED ✅</span>'
            : (ev.sig_header ? '<span class="sig-invalid">SIGNATURE MISMATCH ❌</span>' : '<span style="color:var(--slate); font-size:11px;">NO SIGNATURE</span>');

          return `
            <div class="webhook-item">
              <div class="webhook-meta">
                <span style="font-weight: 700; color: var(--cobalt); font-family: monospace;">${ev.event || "webhook.event"}</span>
                <span style="font-size: 11px; color: var(--slate);">${ev.time}</span>
              </div>
              <div style="margin-bottom: 6px;">${sigBadge}</div>
              <pre>${JSON.stringify(ev.payload, null, 2)}</pre>
            </div>
          `;
        }).join("");
      } catch (e) {
        console.error("Poll failed:", e);
      }
    }

    async function clearEvents() {
      await fetch("/api/clear-events", { method: "POST" });
      pollEvents();
    }

    // ── Theme Management (Light by default) ──
    function setTheme(theme) {
      const btn = document.getElementById('themeToggleBtn');
      if (theme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
        if (btn) btn.innerHTML = '🌙 Dark Mode';
        localStorage.setItem('acme_theme', 'dark');
      } else {
        document.documentElement.removeAttribute('data-theme');
        if (btn) btn.innerHTML = '☀️ Light Mode';
        localStorage.setItem('acme_theme', 'light');
      }
    }

    function toggleTheme() {
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      setTheme(isDark ? 'light' : 'dark');
    }

    // Initialize UI and restore saved settings
    const savedTheme = localStorage.getItem('acme_theme') || 'light';
    setTheme(savedTheme);

    const savedKey = localStorage.getItem("acme_api_key");
    let savedBase = localStorage.getItem("acme_api_base");
    if (savedBase && savedBase.includes("api.outreach.aivhub.com")) {
      savedBase = savedBase.replace("api.outreach.aivhub.com", "outreach.aivhub.com");
      localStorage.setItem("acme_api_base", savedBase);
    }
    const savedSecret = localStorage.getItem("acme_wh_secret");
    if (savedKey) document.getElementById("apiKey").value = savedKey;
    if (savedBase) document.getElementById("apiBase").value = savedBase;
    if (savedSecret) document.getElementById("whSecret").value = savedSecret;

    // Dynamically set webhook URLs to current host and port
    const myWebhookUrl = window.location.origin + "/webhook";
    const whDisp = document.getElementById("webhookUrlDisp");
    if (whDisp) whDisp.innerText = myWebhookUrl;
    const stepUrlElem = document.getElementById("stepWebhookUrl");
    if (stepUrlElem) stepUrlElem.innerText = myWebhookUrl;
    const inboxWh = document.getElementById("inboxWebhookUrl");
    if (inboxWh) inboxWh.innerText = myWebhookUrl;

    switchCategory('social');
    selectAction('social', 'post.create');
    setInterval(pollEvents, 1500);
    pollEvents();
  </script>
</body>
</html>
"""


class ClientHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # Keep terminal log clean
        if "GET /api/events" not in args[0]:
            sys.stdout.write(f"[{time.strftime('%X')}] {format % args}\n")

    def do_GET(self):
        if self.path == "/" or self.path == "/index.html":
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(HTML_TEMPLATE.encode("utf-8"))

        elif self.path == "/api/events":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(RECEIVED_EVENTS).encode("utf-8"))

        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        raw_body = self.rfile.read(length)

        # ── 1. WEBHOOK LISTENER ENDPOINT (POST /webhook) ──
        if self.path == "/webhook":
            sig_header = self.headers.get("X-Outreach-Signature", "")
            secret = CONFIG.get("webhook_secret", "").strip()

            sig_valid = False
            if sig_header and secret:
                try:
                    parts = dict(p.split("=", 1) for p in sig_header.split(","))
                    ts = parts.get("t", "")
                    v1 = parts.get("v1", "")

                    to_sign = f"t={ts}.".encode("utf-8") + raw_body
                    expected = hmac.new(secret.encode("utf-8"), to_sign, hashlib.sha256).hexdigest()
                    sig_valid = hmac.compare_digest(v1, expected)
                except Exception:
                    sig_valid = False

            payload = {}
            event_name = "unknown"
            try:
                payload = json.loads(raw_body.decode("utf-8"))
                event_name = payload.get("event", "event.received")
            except Exception:
                payload = {"raw": raw_body.decode("utf-8", errors="ignore")}

            # Store in event log
            event_record = {
                "id": len(RECEIVED_EVENTS) + 1,
                "time": time.strftime("%Y-%m-%d %H:%M:%S"),
                "event": event_name,
                "sig_valid": sig_valid,
                "sig_header": bool(sig_header),
                "payload": payload,
            }
            RECEIVED_EVENTS.append(event_record)

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"received": True, "verified": sig_valid}).encode("utf-8"))
            print(f"--> [WEBHOOK RECEIVED] Event: {event_name} | Verified: {sig_valid}")

        # ── 2. SAVE CONFIG ──
        elif self.path == "/api/config":
            try:
                data = json.loads(raw_body.decode("utf-8"))
                CONFIG.update(data)
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"status": "ok"}).encode("utf-8"))
            except Exception:
                self.send_response(400)
                self.end_headers()

        # ── 3. CLEAR EVENTS ──
        elif self.path == "/api/clear-events":
            RECEIVED_EVENTS.clear()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"status": "cleared"}).encode("utf-8"))

        # ── 4. SIMULATE LOCAL TEST WEBHOOK ──
        elif self.path == "/api/test-webhook-simulate":
            test_payload = {
                "id": f"evt_sim_{int(time.time())}",
                "event": "post.ready",
                "api_version": "2026-10",
                "livemode": True,
                "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "data": {
                    "post_id": "post_simulated_9821",
                    "status": "pending_approval",
                    "caption": "Simulated Webhook: Announcing Q4 EPC Milestone 2026!",
                    "channels": ["linkedin", "twitter"],
                }
            }
            secret = CONFIG.get("webhook_secret", "").strip() or "whsec_mock"
            raw_bytes = json.dumps(test_payload).encode("utf-8")
            ts = str(int(time.time()))
            to_sign = f"t={ts}.".encode("utf-8") + raw_bytes
            digest = hmac.new(secret.encode("utf-8"), to_sign, hashlib.sha256).hexdigest()

            RECEIVED_EVENTS.append({
                "id": len(RECEIVED_EVENTS) + 1,
                "time": time.strftime("%Y-%m-%d %H:%M:%S"),
                "event": "post.ready",
                "sig_valid": bool(CONFIG.get("webhook_secret")),
                "sig_header": True,
                "payload": test_payload,
            })
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"simulated": True}).encode("utf-8"))

        # ── 5. PROXY RUNNER (Supports both GET and POST with URL parameters) ──
        elif self.path == "/api/proxy-run":
            try:
                data = json.loads(raw_body.decode("utf-8")) if raw_body else {}
            except Exception:
                data = {}

            api_base = (data.get("api_base") or CONFIG.get("api_base") or "http://127.0.0.1:8000").rstrip("/")
            if "api.outreach.aivhub.com" in api_base:
                api_base = api_base.replace("api.outreach.aivhub.com", "outreach.aivhub.com")
            api_key = (data.get("api_key") or CONFIG.get("api_key") or "").strip()
            if data.get("webhook_secret"):
                CONFIG["webhook_secret"] = data.get("webhook_secret").strip()
            CONFIG["api_base"] = api_base
            CONFIG["api_key"] = api_key

            method = "POST"
            endpoint = "/v1/run"
            post_data = raw_body

            if isinstance(data, dict) and ("method" in data or "endpoint" in data):
                method = data.get("method", "POST").upper()
                endpoint = data.get("endpoint", "/v1/run")
                if not endpoint.startswith("/"):
                    endpoint = "/" + endpoint
                if method == "GET":
                    post_data = None
                else:
                    body_val = data.get("body")
                    if isinstance(body_val, (dict, list)):
                        post_data = json.dumps(body_val).encode("utf-8")
                    elif isinstance(body_val, str) and body_val.strip():
                        post_data = body_val.strip().encode("utf-8")
                    else:
                        post_data = b"{}"

            target_url = f"{api_base}{endpoint}"

            req = urllib.request.Request(
                target_url,
                data=post_data,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                    "User-Agent": "Acme-CRM-Client/1.0",
                },
                method=method,
            )

            ssl_ctx = None
            if target_url.startswith("https://"):
                try:
                    import ssl
                    ssl_ctx = ssl.create_default_context()
                except Exception:
                    ssl_ctx = None

            try:
                urlopen_args = {"timeout": 35}
                if ssl_ctx:
                    urlopen_args["context"] = ssl_ctx
                try:
                    resp_obj = urllib.request.urlopen(req, **urlopen_args)
                except Exception as ssl_err:
                    if "CERTIFICATE_VERIFY_FAILED" in str(ssl_err) or "certificate verify failed" in str(ssl_err):
                        import ssl
                        urlopen_args["context"] = ssl._create_unverified_context()
                        resp_obj = urllib.request.urlopen(req, **urlopen_args)
                    else:
                        raise ssl_err

                with resp_obj as resp:
                    resp_data = resp.read()
                    self.send_response(resp.status)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(resp_data)
            except urllib.error.HTTPError as e:
                err_data = e.read()
                self.send_response(e.code)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(err_data)
            except Exception as e:
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode("utf-8"))

        else:
            self.send_response(404)
            self.end_headers()


def run():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    server_address = (HOST, PORT)
    httpd = http.server.ThreadingHTTPServer(server_address, ClientHandler)
    httpd.daemon_threads = True
    print("=" * 70, flush=True)
    print("  [ACME CRM] - OUTREACH API & WEBHOOK CLIENT APPLICATION", flush=True)
    print("=" * 70, flush=True)
    print(f"  Web Dashboard:   http://localhost:{PORT}", flush=True)
    print(f"  Webhook URL:     http://localhost:{PORT}/webhook", flush=True)
    print(f"  Target Server:   {CONFIG['api_base']}", flush=True)
    print("=" * 70, flush=True)
    print("  Ready! Open http://localhost:8001 in your browser to begin testing.", flush=True)
    print("=" * 70, flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\\nStopping client application.", flush=True)
        httpd.server_close()


if __name__ == "__main__":
    run()
