"""Standalone Mock Client Application & Webhook Receiver for Outreach API
Run with:
    python client_test_app.py

Then open in your browser:
    http://localhost:8001

Features:
- Tests POST /v1/run API calls (Voice, Leads, Social, Account)
- Live Webhook Listener on http://localhost:8001/webhook
- Validates HMAC-SHA256 signatures with your Webhook Secret (whsec_...)
- Real-time event log and payload inspector in the web browser
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
    "api_base": "http://127.0.0.1:8000",
    "api_key": "sk_live_93e75e613f08776abe08ca245e491934766e84be",
    "webhook_secret": "",
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
      --bg: #0F172A;
      --card-bg: #1E293B;
      --card-border: #334155;
      --text: #F8FAFC;
      --slate: #94A3B8;
      --cobalt: #3B82F6;
      --green: #10B981;
      --purple: #8B5CF6;
      --amber: #F59E0B;
      --red: #EF4444;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: 'Inter', -apple-system, sans-serif;
      padding: 24px;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--card-border);
      flex-wrap: wrap;
      gap: 12px;
    }
    h1 { margin: 0; font-size: 22px; font-weight: 800; display: flex; align-items: center; gap: 10px; }
    .badge {
      font-size: 11px;
      padding: 3px 8px;
      border-radius: 99px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .badge-live { background: #064E3B; color: #6EE7B7; border: 1px solid #059669; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
    @media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 18px;
    }
    h2 { margin: 0 0 12px; font-size: 15px; font-weight: 700; color: #E2E8F0; }
    label { display: block; font-size: 12px; font-weight: 600; color: var(--slate); margin-bottom: 4px; }
    input, select, textarea {
      width: 100%;
      background: #0B1120;
      border: 1px solid var(--card-border);
      color: var(--text);
      padding: 8px 12px;
      border-radius: 8px;
      font-size: 13px;
      margin-bottom: 12px;
      outline: none;
      font-family: inherit;
    }
    input:focus, textarea:focus { border-color: var(--cobalt); }
    button {
      padding: 8px 16px;
      border-radius: 8px;
      border: none;
      font-weight: 600;
      font-size: 13px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s ease;
    }
    .btn-primary { background: var(--cobalt); color: #fff; }
    .btn-primary:hover { background: #2563EB; }
    .btn-voice { background: #059669; color: #fff; }
    .btn-leads { background: #2563EB; color: #fff; }
    .btn-social { background: #7C3AED; color: #fff; }
    .btn-account { background: #D97706; color: #fff; }
    .btn-secondary { background: #334155; color: #E2E8F0; }
    pre {
      margin: 0;
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      background: #0B1120;
      padding: 12px;
      border-radius: 8px;
      overflow-x: auto;
      line-height: 1.5;
    }
    .webhook-item {
      background: #0B1120;
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 10px;
    }
    .webhook-meta {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
      flex-wrap: wrap;
      gap: 6px;
    }
    .sig-verified { color: #34D399; font-weight: 700; font-size: 11px; }
    .sig-invalid { color: #F87171; font-weight: 700; font-size: 11px; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div>
        <h1>🏢 Acme CRM Client App <span class="badge badge-live">External Client Simulator</span></h1>
        <div style="font-size: 13px; color: var(--slate); margin-top: 4px;">
          Simulates an external client application sending requests to <code>POST /v1/run</code> and receiving signed webhooks.
        </div>
      </div>
      <div style="text-align: right;">
        <div style="font-size: 11px; color: var(--slate);">REGISTER THIS WEBHOOK URL IN OUTREACH:</div>
        <code style="font-family: monospace; font-size: 13px; color: #38BDF8;">http://localhost:8001/webhook</code>
      </div>
    </header>

    <div class="grid">
      <!-- LEFT COLUMN: CLIENT CONFIG & DISPATCHER TEST -->
      <div>
        <div class="card" style="margin-bottom: 20px;">
          <h2>1. Client Credentials & Target Server</h2>
          
          <label>Target Server Environment</label>
          <div style="display: flex; gap: 8px; margin-bottom: 10px;">
            <button type="button" class="btn-secondary" style="font-size: 11.5px; padding: 5px 10px;" onclick="setServer('local')">
              🏠 Localhost (127.0.0.1:8000)
            </button>
            <button type="button" class="btn-secondary" style="font-size: 11.5px; padding: 5px 10px; border-color: #38BDF8; color: #38BDF8;" onclick="setServer('live')">
              ☁️ Live Cloud (api.outreach.aivhub.com)
            </button>
          </div>

          <label>Outreach API Base URL</label>
          <input type="text" id="apiBase" value="http://127.0.0.1:8000" placeholder="e.g. http://127.0.0.1:8000 or https://api.outreach.aivhub.com">

          <label>API Secret Key (Bearer sk_...)</label>
          <input type="text" id="apiKey" value="sk_test_mock_developer_key" placeholder="Paste your API key here (e.g. sk_live_93e75e61...)">

          <label>Webhook Signing Secret (whsec_... from Webhooks tab)</label>
          <input type="text" id="whSecret" placeholder="Paste webhook secret to verify HMAC-SHA256 signature">

          <button class="btn-primary" style="width: 100%; justify-content: center;" onclick="saveConfig()">💾 Save Client Credentials</button>
        </div>

        <div class="card">
          <h2>2. Send API Command (POST /v1/run)</h2>
          <div style="margin-bottom: 8px; font-size: 11px; font-weight: 700; color: var(--slate); text-transform: uppercase;">Action Presets</div>
          <div style="display: flex; gap: 6px; margin-bottom: 12px; flex-wrap: wrap;">
            <button class="btn-voice" onclick="prepareVoice()">📞 Voice Call</button>
            <button class="btn-leads" onclick="prepareLeads()">👥 Lead Search</button>
            <button class="btn-social" onclick="prepareSocialCreate()">📢 Post Create</button>
            <button class="btn-social" onclick="prepareSocialList()">📋 Post List</button>
            <button class="btn-social" onclick="prepareSocialGenerate()">✨ AI Generate</button>
            <button class="btn-account" onclick="prepareAccount()">💳 Balance</button>
          </div>

          <label>Request JSON Body</label>
          <textarea id="requestBody" rows="10" style="font-family: 'JetBrains Mono', monospace; font-size: 12px;"></textarea>

          <button class="btn-primary" style="width: 100%; justify-content: center; padding: 10px;" onclick="dispatchRun()">🚀 Send to POST /v1/run</button>

          <h2 style="margin-top: 18px;">Response from Server</h2>
          <pre id="responseOutput">// Server reply will appear here...</pre>
        </div>
      </div>

      <!-- RIGHT COLUMN: REAL-TIME WEBHOOK INBOX -->
      <div>
        <div class="card" style="height: 100%;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
            <h2>3. Live Webhook Inbox (<span id="eventCount">0</span> events received)</h2>
            <button class="btn-secondary" style="padding: 4px 10px; font-size: 11px;" onclick="clearEvents()">Clear Log</button>
          </div>

          <p style="font-size: 12.5px; color: var(--slate); margin: 0 0 14px;">
            Incoming HTTP POST events from Outreach are automatically verified with HMAC-SHA256 and displayed below in real time.
          </p>

          <div id="eventsContainer" style="max-height: 650px; overflow-y: auto;">
            <div style="padding: 24px; text-align: center; color: var(--slate); font-size: 13px;">
              Waiting for incoming webhooks on <code>http://localhost:8001/webhook</code>...
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <script>
    function setServer(env) {
      const baseInput = document.getElementById("apiBase");
      if (env === 'live') {
        baseInput.value = "https://api.outreach.aivhub.com";
      } else {
        baseInput.value = "http://127.0.0.1:8000";
      }
    }

    // Default payloads
    const PAYLOADS = {
      voice: {
        plugin: "voice",
        action: "call.start",
        data: {
          to: "+447911123456",
          lead_name: "Sarah Jenkins",
          goal: "Schedule a 15-minute product demonstration",
          instructions: "Be polite, friendly, and brief."
        }
      },
      leads: {
        plugin: "leads",
        action: "search.start",
        data: {
          query: "Civil engineering contractors in London",
          limit: 10
        }
      },
      socialCreate: {
        plugin: "social",
        action: "post.create",
        data: {
          prompt: "Announce our newly awarded NHAI Smart Highway EPC contract 2026 with sustainable focus",
          channels: ["linkedin"]
        }
      },
      socialList: {
        plugin: "social",
        action: "post.list",
        data: {}
      },
      socialGenerate: {
        plugin: "social",
        action: "post.create",
        data: {
          prompt: "Q3 2026 AI Infrastructure and Enterprise Voice Growth in India and UK",
          channels: ["linkedin"],
          image: {
            mode: "ai",
            instruction: "Modern glass office and AI technology dashboard"
          }
        }
      },
      account: {
        plugin: "account",
        action: "wallet",
        data: {}
      }
    };

    function prepareVoice() { document.getElementById("requestBody").value = JSON.stringify(PAYLOADS.voice, null, 2); }
    function prepareLeads() { document.getElementById("requestBody").value = JSON.stringify(PAYLOADS.leads, null, 2); }
    function prepareSocialCreate() { document.getElementById("requestBody").value = JSON.stringify(PAYLOADS.socialCreate, null, 2); }
    function prepareSocialList() { document.getElementById("requestBody").value = JSON.stringify(PAYLOADS.socialList, null, 2); }
    function prepareSocialGenerate() { document.getElementById("requestBody").value = JSON.stringify(PAYLOADS.socialGenerate, null, 2); }
    function prepareAccount() { document.getElementById("requestBody").value = JSON.stringify(PAYLOADS.account, null, 2); }

    // Init with social create
    prepareSocialCreate();

    async function saveConfig() {
      const cfg = {
        api_base: document.getElementById("apiBase").value.trim(),
        api_key: document.getElementById("apiKey").value.trim(),
        webhook_secret: document.getElementById("whSecret").value.trim()
      };
      await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cfg)
      });
      alert("Credentials saved in test client!");
    }

    async function dispatchRun() {
      const btn = event.target;
      btn.innerText = "Dispatching...";
      const out = document.getElementById("responseOutput");
      out.innerText = "Sending request to master dispatcher...";

      try {
        const body = document.getElementById("requestBody").value;
        const res = await fetch("/api/proxy-run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: body
        });
        const json = await res.json();
        out.innerText = JSON.stringify(json, null, 2);
      } catch (err) {
        out.innerText = "Error: " + err.message;
      } finally {
        btn.innerText = "🚀 Send to POST /v1/run";
      }
    }

    async function pollEvents() {
      try {
        const res = await fetch("/api/events");
        const events = await res.json();
        document.getElementById("eventCount").innerText = events.length;

        const cont = document.getElementById("eventsContainer");
        if (events.length === 0) {
          cont.innerHTML = '<div style="padding: 24px; text-align: center; color: var(--slate); font-size: 13px;">Waiting for incoming webhooks on <code>http://localhost:8001/webhook</code>...</div>';
          return;
        }

        cont.innerHTML = events.slice().reverse().map((ev) => {
          const sigBadge = ev.sig_valid
            ? '<span class="sig-verified">HMAC SIGNATURE VERIFIED ✅</span>'
            : (ev.sig_header ? '<span class="sig-invalid">SIGNATURE MISMATCH ❌</span>' : '<span style="color:#94A3B8;">NO SIGNATURE (TEST)</span>');

          return `
            <div class="webhook-item">
              <div class="webhook-meta">
                <span style="font-weight: 700; color: #38BDF8; font-family: monospace;">${ev.event || "webhook.event"}</span>
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

    // Auto poll every 1.5s
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
                except Exception as e:
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

            # Return 200 OK immediately as required by webhooks
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
            except Exception as e:
                self.send_response(400)
                self.end_headers()

        # ── 3. CLEAR EVENTS ──
        elif self.path == "/api/clear-events":
            RECEIVED_EVENTS.clear()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"status": "cleared"}).encode("utf-8"))

        # ── 4. PROXY DISPATCHER RUN (Sends POST /v1/run to target Outreach API) ──
        elif self.path == "/api/proxy-run":
            api_base = CONFIG.get("api_base", "http://127.0.0.1:8000").rstrip("/")
            api_key = CONFIG.get("api_key", "").strip()
            target_url = f"{api_base}/v1/run"

            req = urllib.request.Request(
                target_url,
                data=raw_body,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                    "User-Agent": "Acme-CRM-Client/1.0",
                },
                method="POST",
            )

            ssl_ctx = None
            if target_url.startswith("https://"):
                try:
                    import ssl
                    ssl_ctx = ssl.create_default_context()
                except Exception:
                    ssl_ctx = None

            try:
                urlopen_args = {"timeout": 30}
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
        print("\nStopping client application.", flush=True)
        httpd.server_close()


if __name__ == "__main__":
    run()
