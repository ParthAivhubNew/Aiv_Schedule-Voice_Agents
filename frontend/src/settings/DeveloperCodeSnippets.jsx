import React, { useState } from "react";
import { Copy, Check } from "lucide-react";
import { C, FONT_MONO } from "../tokens";

export const SUPPORTED_LANGS = [
  { id: "curl", label: "cURL" },
  { id: "node", label: "Node.js" },
  { id: "python", label: "Python" },
  { id: "react", label: "React" },
  { id: "java", label: "Java" },
  { id: "php", label: "PHP" },
  { id: "go", label: "Go" },
];

export const WEBHOOK_LANGS = [
  { id: "node", label: "Node.js (Express)" },
  { id: "python", label: "Python (FastAPI)" },
  { id: "java", label: "Java (Spring)" },
  { id: "php", label: "PHP" },
  { id: "go", label: "Go" },
];

/**
 * Reusable Code Snippet Container with language switcher and 1-click copy button.
 * Uses <pre> with strict whitespace preservation so indentation is never collapsed.
 */
export function MultiLangCodeBlock({
  snippets = {},
  availableLangs = SUPPORTED_LANGS,
  defaultLang = "curl",
  title = "",
}) {
  const [selectedLang, setSelectedLang] = useState(defaultLang);
  const [copied, setCopied] = useState(false);

  const activeSnippet = snippets[selectedLang] || snippets[defaultLang] || Object.values(snippets)[0] || "";

  const handleCopy = () => {
    navigator.clipboard.writeText(activeSnippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      style={{
        borderRadius: 12,
        backgroundColor: "#0F172A",
        border: "1px solid #1E293B",
        overflow: "hidden",
        marginBottom: 16,
      }}
    >
      {/* Code Header Bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 12px",
          backgroundColor: "#1E293B",
          borderBottom: "1px solid #334155",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {title && (
            <span style={{ fontSize: 11, fontWeight: 700, color: "#94A3B8", marginRight: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              {title}
            </span>
          )}
          {availableLangs.map((lang) => {
            if (!snippets[lang.id]) return null;
            const isActive = selectedLang === lang.id;
            return (
              <button
                key={lang.id}
                onClick={() => setSelectedLang(lang.id)}
                style={{
                  background: isActive ? "#334155" : "transparent",
                  color: isActive ? "#38BDF8" : "#94A3B8",
                  border: isActive ? "1px solid #475569" : "1px solid transparent",
                  borderRadius: 6,
                  padding: "3px 8px",
                  fontSize: 11.5,
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
              >
                {lang.label}
              </button>
            );
          })}
        </div>

        <button
          onClick={handleCopy}
          style={{
            background: copied ? "#065F46" : "#334155",
            color: copied ? "#34D399" : "#F8FAFC",
            border: "none",
            borderRadius: 6,
            padding: "4px 10px",
            fontSize: 11.5,
            fontWeight: 600,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 5,
            transition: "all 0.15s ease",
          }}
        >
          {copied ? <Check size={12} color="#34D399" /> : <Copy size={12} />}
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>

      {/* Code Body with strictly preserved newlines */}
      <div style={{ padding: 14, overflowX: "auto" }}>
        <pre
          style={{
            margin: 0,
            fontFamily: FONT_MONO,
            fontSize: 12,
            lineHeight: 1.6,
            color: "#E2E8F0",
            whiteSpace: "pre",
            tabSize: 2,
          }}
        >
          {activeSnippet}
        </pre>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Dynamic Multi-Language Client Generators
// ─────────────────────────────────────────────────────────────────────────────

export function getVoiceCallSnippets(apiKey = "sk_live_YOUR_KEY") {
  const token = apiKey || "sk_live_YOUR_KEY";
  return {
    curl: `curl -X POST "https://api.outreach.aivhub.com/v1/voice/calls" \\
  -H "Authorization: Bearer ${token}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "to": "+919876543210",
    "lead_name": "Ramesh Patel",
    "variables": {
      "tender_name": "NHAI Bridge Construction",
      "rfp_number": "RFP-2026-NHAI-402",
      "budget": "$2.4M"
    }
  }'`,

    node: `// Modern Node.js (v18+) with Fetch
const response = await fetch("https://api.outreach.aivhub.com/v1/voice/calls", {
  method: "POST",
  headers: {
    "Authorization": "Bearer ${token}",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    to: "+919876543210",
    lead_name: "Ramesh Patel",
    variables: {
      tender_name: "NHAI Bridge Construction",
      rfp_number: "RFP-2026-NHAI-402",
      budget: "$2.4M"
    }
  })
});

const data = await response.json();
console.log("Call Dispatched. Call ID:", data.call_id);`,

    python: `# Python 3 with Requests
import requests

url = "https://api.outreach.aivhub.com/v1/voice/calls"
headers = {
    "Authorization": "Bearer ${token}",
    "Content-Type": "application/json"
}
payload = {
    "to": "+919876543210",
    "lead_name": "Ramesh Patel",
    "variables": {
        "tender_name": "NHAI Bridge Construction",
        "rfp_number": "RFP-2026-NHAI-402",
        "budget": "$2.4M"
    }
}

response = requests.post(url, headers=headers, json=payload)
data = response.json()
print("Call Dispatched. Call ID:", data.get("call_id"))`,

    react: `// React Component or Custom Hook
import React, { useState } from "react";

export function TenderCallTrigger({ clientPhone, clientName, tenderName }) {
  const [loading, setLoading] = useState(false);
  const [callId, setCallId] = useState(null);

  const dispatchCall = async () => {
    setLoading(true);
    try {
      const res = await fetch("https://api.outreach.aivhub.com/v1/voice/calls", {
        method: "POST",
        headers: {
          "Authorization": "Bearer ${token}",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          to: clientPhone,
          lead_name: clientName,
          variables: { tender_name: tenderName }
        })
      });
      const result = await res.json();
      setCallId(result.call_id);
    } catch (err) {
      console.error("Call dispatch failed:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button onClick={dispatchCall} disabled={loading}>
      {loading ? "Calling..." : "Call with AI Assistant"}
    </button>
  );
}`,

    java: `// Java 11+ with HttpClient
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

public class OutreachCallService {
    public static void main(String[] args) throws Exception {
        HttpClient client = HttpClient.newHttpClient();
        String json = """
            {
              "to": "+919876543210",
              "lead_name": "Ramesh Patel",
              "variables": {
                "tender_name": "NHAI Bridge Construction",
                "budget": "$2.4M"
              }
            }
            """;

        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create("https://api.outreach.aivhub.com/v1/voice/calls"))
            .header("Authorization", "Bearer ${token}")
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(json))
            .build();

        HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
        System.out.println("Response Status: " + response.statusCode());
        System.out.println("Response Body: " + response.body());
    }
}`,

    php: `<?php
// PHP cURL
$curl = curl_init();

$payload = [
    "to" => "+919876543210",
    "lead_name" => "Ramesh Patel",
    "variables" => [
        "tender_name" => "NHAI Bridge Construction",
        "budget" => "$2.4M"
    ]
];

curl_setopt_array($curl, [
    CURLOPT_URL => "https://api.outreach.aivhub.com/v1/voice/calls",
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => json_encode($payload),
    CURLOPT_HTTPHEADER => [
        "Authorization: Bearer ${token}",
        "Content-Type: application/json"
    ],
]);

$response = curl_exec($curl);
curl_close($curl);
echo $response;
?>`,

    go: `package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

func main() {
	url := "https://api.outreach.aivhub.com/v1/voice/calls"

	payload := map[string]interface{}{
		"to":        "+919876543210",
		"lead_name": "Ramesh Patel",
		"variables": map[string]string{
			"tender_name": "NHAI Bridge Construction",
			"budget":      "$2.4M",
		},
	}
	body, _ := json.Marshal(payload)

	req, _ := http.NewRequest("POST", url, bytes.NewBuffer(body))
	req.Header.Set("Authorization", "Bearer ${token}")
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		panic(err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	fmt.Println("Response:", string(respBody))
}`,
  };
}

export function getCallStatusSnippets(apiKey = "sk_live_YOUR_KEY", callId = "call_sample_9841") {
  const token = apiKey || "sk_live_YOUR_KEY";
  const cid = callId || "call_sample_9841";

  return {
    curl: `curl -X GET "https://api.outreach.aivhub.com/v1/voice/calls/${cid}" \\
  -H "Authorization: Bearer ${token}"`,

    node: `const res = await fetch("https://api.outreach.aivhub.com/v1/voice/calls/${cid}", {
  headers: {
    "Authorization": "Bearer ${token}"
  }
});
const data = await res.json();
console.log("Call Status:", data.status);
console.log("Sentiment:", data.sentiment);
console.log("Transcript:", data.transcript);`,

    python: `import requests

url = "https://api.outreach.aivhub.com/v1/voice/calls/${cid}"
headers = {"Authorization": "Bearer ${token}"}

response = requests.get(url, headers=headers)
call_info = response.json()
print("Sentiment:", call_info.get("sentiment"))
print("Summary:", call_info.get("summary"))`,

    react: `const pollCallStatus = async (callId) => {
  const res = await fetch(\`https://api.outreach.aivhub.com/v1/voice/calls/\${callId}\`, {
    headers: { "Authorization": "Bearer ${token}" }
  });
  return await res.json();
};`,

    java: `HttpRequest request = HttpRequest.newBuilder()
    .uri(URI.create("https://api.outreach.aivhub.com/v1/voice/calls/${cid}"))
    .header("Authorization", "Bearer ${token}")
    .GET()
    .build();

HttpResponse<String> response = HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.ofString());
System.out.println(response.body());`,

    php: `$ch = curl_init("https://api.outreach.aivhub.com/v1/voice/calls/${cid}");
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_HTTPHEADER, ["Authorization: Bearer ${token}"]);
$response = curl_exec($ch);
curl_close($ch);
echo $response;`,

    go: `req, _ := http.NewRequest("GET", "https://api.outreach.aivhub.com/v1/voice/calls/${cid}", nil)
req.Header.Set("Authorization", "Bearer ${token}")
resp, _ := (&http.Client{}).Do(req)
body, _ := io.ReadAll(resp.Body)
fmt.Println(string(body))`,
  };
}

export function getWebhookVerificationSnippets(secret = "whsec_YOUR_SECRET") {
  const whsec = secret || "whsec_YOUR_SECRET";

  return {
    node: `// Node.js (Express) Webhook Signature Verification
const crypto = require("crypto");
const express = require("express");
const app = express();

const WEBHOOK_SECRET = process.env.OUTREACH_WEBHOOK_SECRET || "${whsec}";

// Use express.raw() to capture unmodified bytes required for HMAC validation
app.post("/api/webhooks/outreach", express.raw({ type: "application/json" }), (req, res) => {
  const sigHeader = req.headers["x-outreach-signature"];
  if (!sigHeader) {
    return res.status(401).send("Missing X-Outreach-Signature header");
  }

  const [tPart, v1Part] = sigHeader.split(",");
  const timestamp = tPart.split("=")[1];
  const signature = v1Part.split("=")[1];

  // Recompute HMAC-SHA256: toSign = "t={timestamp}.{raw_bytes}"
  const toSign = \`t=\${timestamp}.\` + req.body.toString("utf8");
  const expected = crypto
    .createHmac("sha256", WEBHOOK_SECRET)
    .update(toSign)
    .digest("hex");

  // Constant-time comparison prevents timing attacks
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return res.status(401).send("Invalid signature");
  }

  const payload = JSON.parse(req.body.toString("utf8"));
  if (payload.event === "call.completed") {
    const { call_id, sentiment, summary, duration, transcript } = payload.data;
    console.log(\`Tender Follow-up Call \${call_id} Completed. Sentiment: \${sentiment}\`);
    // Update tender record in your CRM database
  }

  res.status(200).json({ received: true });
});`,

    python: `# Python (FastAPI) Webhook Signature Verification
import hmac
import hashlib
from fastapi import FastAPI, Request, HTTPException, Header

app = FastAPI()
WEBHOOK_SECRET = "${whsec}"

@app.post("/api/webhooks/outreach")
async def handle_outreach_webhook(
    request: Request,
    x_outreach_signature: str = Header(None)
):
    if not x_outreach_signature:
        raise HTTPException(status_code=401, detail="Missing signature header")

    raw_body = await request.body()
    parts = dict(p.split("=") for p in x_outreach_signature.split(","))
    timestamp = parts.get("t")
    signature = parts.get("v1")

    # Recompute HMAC-SHA256
    to_sign = f"t={timestamp}.".encode("utf-8") + raw_body
    expected = hmac.new(WEBHOOK_SECRET.encode("utf-8"), to_sign, hashlib.sha256).hexdigest()

    if not hmac.compare_digest(signature, expected):
        raise HTTPException(status_code=401, detail="Invalid signature")

    event = await request.json()
    if event.get("event") == "call.completed":
        data = event.get("data", {})
        print(f"Call {data.get('call_id')} completed! Sentiment: {data.get('sentiment')}")
        # Sync with your database

    return {"received": True}`,

    java: `// Java (Spring Boot) Webhook Signature Verification
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.web.bind.annotation.*;
import org.springframework.http.ResponseEntity;
import org.springframework.http.HttpStatus;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;

@RestController
public class OutreachWebhookController {
    private static final String SECRET = "${whsec}";

    @PostMapping("/api/webhooks/outreach")
    public ResponseEntity<String> handleWebhook(
        @RequestBody String rawBody,
        @RequestHeader("X-Outreach-Signature") String sigHeader
    ) {
        try {
            String[] parts = sigHeader.split(",");
            String timestamp = parts[0].split("=")[1];
            String signature = parts[1].split("=")[1];

            String toSign = "t=" + timestamp + "." + rawBody;
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(SECRET.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            String expected = HexFormat.of().formatHex(mac.doFinal(toSign.getBytes(StandardCharsets.UTF_8)));

            if (!MessageDigest.isEqual(signature.getBytes(), expected.getBytes())) {
                return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body("Invalid signature");
            }

            // Signature verified successfully
            return ResponseEntity.ok("{\\"received\\": true}");
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(e.getMessage());
        }
    }
}`,

    php: `<?php
// PHP Webhook Signature Verification
$secret = "${whsec}";
$sigHeader = $_SERVER['HTTP_X_OUTREACH_SIGNATURE'] ?? '';

if (!$sigHeader) {
    http_response_code(401);
    exit("Missing X-Outreach-Signature");
}

parse_str(str_replace(',', '&', $sigHeader), $parts);
$timestamp = $parts['t'] ?? '';
$signature = $parts['v1'] ?? '';

$rawBody = file_get_contents('php://input');
$toSign = "t=" . $timestamp . "." . $rawBody;
$expected = hash_hmac('sha256', $toSign, $secret);

if (!hash_equals($signature, $expected)) {
    http_response_code(401);
    exit("Invalid webhook signature");
}

$event = json_decode($rawBody, true);
if ($event['event'] === 'call.completed') {
    $callData = $event['data'];
    // Update database with call result
}

http_response_code(200);
echo json_encode(["received" => true]);
?>`,

    go: `package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"strings"
)

const webhookSecret = "${whsec}"

func webhookHandler(w http.ResponseWriter, r *http.Request) {
	sigHeader := r.Header.Get("X-Outreach-Signature")
	if sigHeader == "" {
		http.Error(w, "Missing signature", http.StatusUnauthorized)
		return
	}

	parts := strings.Split(sigHeader, ",")
	timestamp := strings.Split(parts[0], "=")[1]
	signature := strings.Split(parts[1], "=")[1]

	rawBody, _ := io.ReadAll(r.Body)
	toSign := fmt.Sprintf("t=%s.%s", timestamp, string(rawBody))

	mac := hmac.New(sha256.New, []byte(webhookSecret))
	mac.Write([]byte(toSign))
	expected := hex.EncodeToString(mac.Sum(nil))

	if !hmac.Equal([]byte(signature), []byte(expected)) {
		http.Error(w, "Invalid signature", http.StatusUnauthorized)
		return
	}

	w.WriteHeader(http.StatusOK)
	w.Write([]byte(\`{"received": true}\`))
}`,
  };
}

export function generatePlaygroundSnippet(lang, method, path, apiKey, jsonBody) {
  const token = apiKey || "sk_live_YOUR_KEY";
  const fullUrl = `https://api.outreach.aivhub.com${path}`;
  const bodyStr = jsonBody ? jsonBody.trim() : "";

  if (lang === "curl") {
    if (method === "GET") {
      return `curl -X GET "${fullUrl}" \\\n  -H "Authorization: Bearer ${token}"`;
    }
    return `curl -X POST "${fullUrl}" \\\n  -H "Authorization: Bearer ${token}" \\\n  -H "Content-Type: application/json" \\\n  -d '${bodyStr.replace(/'/g, "'\\''")}'`;
  }

  if (lang === "node") {
    if (method === "GET") {
      return `const response = await fetch("${fullUrl}", {\n  headers: {\n    "Authorization": "Bearer ${token}"\n  }\n});\nconst data = await response.json();\nconsole.log(data);`;
    }
    return `const response = await fetch("${fullUrl}", {\n  method: "POST",\n  headers: {\n    "Authorization": "Bearer ${token}",\n    "Content-Type": "application/json"\n  },\n  body: JSON.stringify(${bodyStr || "{}"})\n});\nconst data = await response.json();\nconsole.log(data);`;
  }

  if (lang === "python") {
    if (method === "GET") {
      return `import requests\n\nurl = "${fullUrl}"\nheaders = {"Authorization": "Bearer ${token}"}\n\nresponse = requests.get(url, headers=headers)\nprint(response.json())`;
    }
    return `import requests\n\nurl = "${fullUrl}"\nheaders = {\n    "Authorization": "Bearer ${token}",\n    "Content-Type": "application/json"\n}\npayload = ${bodyStr || "{}"}\n\nresponse = requests.post(url, headers=headers, json=payload)\nprint(response.json())`;
  }

  if (lang === "react") {
    if (method === "GET") {
      return `// React / Frontend Hook
const fetchData = async () => {\n  const res = await fetch("${fullUrl}", {\n    headers: { "Authorization": "Bearer ${token}" }\n  });\n  const data = await res.json();\n  return data;\n};`;
    }
    return `// React / Frontend Component Handler
const handleSubmit = async () => {\n  const res = await fetch("${fullUrl}", {\n    method: "POST",\n    headers: {\n      "Authorization": "Bearer ${token}",\n      "Content-Type": "application/json"\n    },\n    body: JSON.stringify(${bodyStr || "{}"})\n  });\n  const data = await res.json();\n  console.log("Result:", data);\n};`;
  }

  if (lang === "java") {
    if (method === "GET") {
      return `HttpRequest request = HttpRequest.newBuilder()\n    .uri(URI.create("${fullUrl}"))\n    .header("Authorization", "Bearer ${token}")\n    .GET()\n    .build();\nHttpResponse<String> response = HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.ofString());\nSystem.out.println(response.body());`;
    }
    return `String json = """\n${bodyStr}\n""";\nHttpRequest request = HttpRequest.newBuilder()\n    .uri(URI.create("${fullUrl}"))\n    .header("Authorization", "Bearer ${token}")\n    .header("Content-Type", "application/json")\n    .POST(HttpRequest.BodyPublishers.ofString(json))\n    .build();\nHttpResponse<String> response = HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.ofString());\nSystem.out.println(response.body());`;
  }

  if (lang === "php") {
    if (method === "GET") {
      return `$ch = curl_init("${fullUrl}");\ncurl_setopt($ch, CURLOPT_RETURNTRANSFER, true);\ncurl_setopt($ch, CURLOPT_HTTPHEADER, ["Authorization: Bearer ${token}"]);\n$response = curl_exec($ch);\ncurl_close($ch);\necho $response;`;
    }
    return `$ch = curl_init("${fullUrl}");\n$payload = json_decode('${bodyStr.replace(/'/g, "\\'")}', true);\ncurl_setopt_array($ch, [\n    CURLOPT_RETURNTRANSFER => true,\n    CURLOPT_POST => true,\n    CURLOPT_POSTFIELDS => json_encode($payload),\n    CURLOPT_HTTPHEADER => [\n        "Authorization: Bearer ${token}",\n        "Content-Type: application/json"\n    ]\n]);\n$response = curl_exec($ch);\ncurl_close($ch);\necho $response;`;
  }

  if (lang === "go") {
    if (method === "GET") {
      return `req, _ := http.NewRequest("GET", "${fullUrl}", nil)\nreq.Header.Set("Authorization", "Bearer ${token}")\nresp, _ := (&http.Client{}).Do(req)\nbody, _ := io.ReadAll(resp.Body)\nfmt.Println(string(body))`;
    }
    return `body := []byte(\`${bodyStr}\`)\nreq, _ := http.NewRequest("POST", "${fullUrl}", bytes.NewBuffer(body))\nreq.Header.Set("Authorization", "Bearer ${token}")\nreq.Header.Set("Content-Type", "application/json")\nresp, _ := (&http.Client{}).Do(req)\nresBody, _ := io.ReadAll(resp.Body)\nfmt.Println(string(resBody))`;
  }

  return "";
}

export function getLeadsSnippets(apiKey = "sk_live_YOUR_KEY") {
  const token = apiKey || "sk_live_YOUR_KEY";
  return {
    curl: `curl -X POST "https://api.outreach.aivhub.com/v1/leads" \\
  -H "Authorization: Bearer ${token}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "Sarah Jenkins",
    "email": "sarah.j@contractingltd.com",
    "phone": "+14155552671",
    "company": "Jenkins Infrastructure Corp",
    "source": "Tender Portal CRM"
  }'`,

    node: `const response = await fetch("https://api.outreach.aivhub.com/v1/leads", {
  method: "POST",
  headers: {
    "Authorization": "Bearer ${token}",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    name: "Sarah Jenkins",
    email: "sarah.j@contractingltd.com",
    phone: "+14155552671",
    company: "Jenkins Infrastructure Corp",
    source: "Tender Portal CRM"
  })
});

const data = await response.json();
console.log("Lead Enriched & Created:", data);`,

    python: `import requests

url = "https://api.outreach.aivhub.com/v1/leads"
headers = {
    "Authorization": "Bearer ${token}",
    "Content-Type": "application/json"
}
payload = {
    "name": "Sarah Jenkins",
    "email": "sarah.j@contractingltd.com",
    "phone": "+14155552671",
    "company": "Jenkins Infrastructure Corp",
    "source": "Tender Portal CRM"
}

response = requests.post(url, headers=headers, json=payload)
print("Lead Created:", response.json())`,

    react: `const addLead = async (leadData) => {
  const res = await fetch("https://api.outreach.aivhub.com/v1/leads", {
    method: "POST",
    headers: {
      "Authorization": "Bearer ${token}",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(leadData)
  });
  return await res.json();
};`,

    java: `String json = """
    {
      "name": "Sarah Jenkins",
      "email": "sarah.j@contractingltd.com",
      "phone": "+14155552671",
      "company": "Jenkins Infrastructure Corp",
      "source": "Tender Portal CRM"
    }
    """;

HttpRequest request = HttpRequest.newBuilder()
    .uri(URI.create("https://api.outreach.aivhub.com/v1/leads"))
    .header("Authorization", "Bearer ${token}")
    .header("Content-Type", "application/json")
    .POST(HttpRequest.BodyPublishers.ofString(json))
    .build();

HttpResponse<String> response = HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.ofString());
System.out.println(response.body());`,

    php: `$ch = curl_init("https://api.outreach.aivhub.com/v1/leads");
$payload = [
    "name" => "Sarah Jenkins",
    "email" => "sarah.j@contractingltd.com",
    "phone" => "+14155552671",
    "company" => "Jenkins Infrastructure Corp"
];

curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => json_encode($payload),
    CURLOPT_HTTPHEADER => [
        "Authorization: Bearer ${token}",
        "Content-Type: application/json"
    ]
]);

$response = curl_exec($ch);
curl_close($ch);
echo $response;`,

    go: `package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

func main() {
	payload := map[string]string{
		"name":    "Sarah Jenkins",
		"email":   "sarah.j@contractingltd.com",
		"phone":   "+14155552671",
		"company": "Jenkins Infrastructure Corp",
	}
	body, _ := json.Marshal(payload)

	req, _ := http.NewRequest("POST", "https://api.outreach.aivhub.com/v1/leads", bytes.NewBuffer(body))
	req.Header.Set("Authorization", "Bearer ${token}")
	req.Header.Set("Content-Type", "application/json")

	resp, _ := (&http.Client{}).Do(req)
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	fmt.Println(string(respBody))
}`,
  };
}

export function getSocialPostSnippets(apiKey = "sk_live_YOUR_KEY") {
  const token = apiKey || "sk_live_YOUR_KEY";
  return {
    curl: `curl -X POST "https://api.outreach.aivhub.com/v1/social/posts" \\
  -H "Authorization: Bearer ${token}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "topic": "Awarded NHAI Smart Highway EPC Contract for FY2026",
    "platforms": ["linkedin", "twitter"],
    "tone": "professional"
  }'`,

    node: `const response = await fetch("https://api.outreach.aivhub.com/v1/social/posts", {
  method: "POST",
  headers: {
    "Authorization": "Bearer ${token}",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    topic: "Awarded NHAI Smart Highway EPC Contract for FY2026",
    platforms: ["linkedin", "twitter"],
    tone: "professional"
  })
});

const data = await response.json();
console.log("Post Scheduled:", data);`,

    python: `import requests

url = "https://api.outreach.aivhub.com/v1/social/posts"
headers = {
    "Authorization": "Bearer ${token}",
    "Content-Type": "application/json"
}
payload = {
    "topic": "Awarded NHAI Smart Highway EPC Contract for FY2026",
    "platforms": ["linkedin", "twitter"],
    "tone": "professional"
}

response = requests.post(url, headers=headers, json=payload)
print("Post Scheduled:", response.json())`,

    react: `const scheduleSocialPost = async (postData) => {
  const res = await fetch("https://api.outreach.aivhub.com/v1/social/posts", {
    method: "POST",
    headers: {
      "Authorization": "Bearer ${token}",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(postData)
  });
  return await res.json();
};`,

    java: `String json = """
    {
      "topic": "Awarded NHAI Smart Highway EPC Contract for FY2026",
      "platforms": ["linkedin", "twitter"],
      "tone": "professional"
    }
    """;

HttpRequest request = HttpRequest.newBuilder()
    .uri(URI.create("https://api.outreach.aivhub.com/v1/social/posts"))
    .header("Authorization", "Bearer ${token}")
    .header("Content-Type", "application/json")
    .POST(HttpRequest.BodyPublishers.ofString(json))
    .build();

HttpResponse<String> response = HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.ofString());
System.out.println(response.body());`,

    php: `$ch = curl_init("https://api.outreach.aivhub.com/v1/social/posts");
$payload = [
    "topic" => "Awarded NHAI Smart Highway EPC Contract for FY2026",
    "platforms" => ["linkedin", "twitter"],
    "tone" => "professional"
];

curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => json_encode($payload),
    CURLOPT_HTTPHEADER => [
        "Authorization: Bearer ${token}",
        "Content-Type: application/json"
    ]
]);

$response = curl_exec($ch);
curl_close($ch);
echo $response;`,

    go: `package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

func main() {
	payload := map[string]interface{}{
		"topic":     "Awarded NHAI Smart Highway EPC Contract for FY2026",
		"platforms": []string{"linkedin", "twitter"},
		"tone":      "professional",
	}
	body, _ := json.Marshal(payload)

	req, _ := http.NewRequest("POST", "https://api.outreach.aivhub.com/v1/social/posts", bytes.NewBuffer(body))
	req.Header.Set("Authorization", "Bearer ${token}")
	req.Header.Set("Content-Type", "application/json")

	resp, _ := (&http.Client{}).Do(req)
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	fmt.Println(string(respBody))
}`,
  };
}

export function getWalletsSnippets(apiKey = "sk_live_YOUR_KEY") {
  const token = apiKey || "sk_live_YOUR_KEY";
  return {
    curl: `curl -X GET "https://api.outreach.aivhub.com/v1/wallets" \\
  -H "Authorization: Bearer ${token}"`,

    node: `const res = await fetch("https://api.outreach.aivhub.com/v1/wallets", {
  headers: { "Authorization": "Bearer ${token}" }
});
const wallet = await res.json();
console.log("Voice Minutes Remaining:", wallet.voice_minutes);
console.log("Leads Credits:", wallet.lead_credits);`,

    python: `import requests

res = requests.get(
    "https://api.outreach.aivhub.com/v1/wallets",
    headers={"Authorization": "Bearer ${token}"}
)
wallet = res.json()
print(f"Voice Balance: {wallet.get('voice_minutes')} mins")`,

    react: `const useWalletBalance = async () => {
  const res = await fetch("https://api.outreach.aivhub.com/v1/wallets", {
    headers: { "Authorization": "Bearer ${token}" }
  });
  return await res.json();
};`,

    java: `HttpRequest request = HttpRequest.newBuilder()
    .uri(URI.create("https://api.outreach.aivhub.com/v1/wallets"))
    .header("Authorization", "Bearer ${token}")
    .GET()
    .build();

HttpResponse<String> response = HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.ofString());
System.out.println(response.body());`,

    php: `$ch = curl_init("https://api.outreach.aivhub.com/v1/wallets");
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_HTTPHEADER, ["Authorization: Bearer ${token}"]);
$response = curl_exec($ch);
curl_close($ch);
echo $response;`,

    go: `req, _ := http.NewRequest("GET", "https://api.outreach.aivhub.com/v1/wallets", nil)
req.Header.Set("Authorization", "Bearer ${token}")
resp, _ := (&http.Client{}).Do(req)
defer resp.Body.Close()
body, _ := io.ReadAll(resp.Body)
fmt.Println(string(body))`,
  };
}
