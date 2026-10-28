// The Outreach helper: a tiny program that runs on YOUR server, next to your app.
// Your web page asks it for a short-lived pass; it asks Outreach for one using your secret key and hands it back.
// The secret key stays in the .env file here and never reaches the web page.
import fs from "node:fs";
import http from "node:http";

try {
  for (const line of fs.readFileSync(new URL("./.env", import.meta.url), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch { /* no .env file: the key has to be in the environment */ }

const SECRET = process.env.OUTREACH_SECRET || "";
const PORT = Number(process.env.PORT || 3000);
const OUTREACH = "{{HOST}}/api/embed";

if (!SECRET.startsWith("psk_")) {
  console.error("\nThe secret key is missing.\nCopy the file .env.example to .env and paste your secret key after OUTREACH_SECRET=\n");
  process.exit(1);
}

async function call(path, body) {
  const res = await fetch(OUTREACH + path, {
    method: "POST",
    headers: { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `Outreach answered ${res.status}`);
  return data;
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://helper");
  res.setHeader("Cache-Control", "no-store");
  if (url.pathname === "/") {
    res.setHeader("Content-Type", "text/plain");
    return res.end("The Outreach helper is running.\n");
  }
  if (url.pathname !== "/outreach-start") {
    res.statusCode = 404;
    return res.end("not found");
  }
  res.setHeader("Content-Type", "application/json");
  try {
    // TESTING ONLY: one fixed test person. In your real app this is the id of whoever is signed in.
    const external_id = process.env.TEST_USER_ID || "test-user-1";
    const component = url.searchParams.get("component") || "leads";
    const info = await call("/connect-sessions", { external_id, component });
    if (!info.linked) return res.end(JSON.stringify({ connect_token: info.connect_token }));
    const pass = await call("/sessions", { external_id, component });
    res.end(JSON.stringify({ token: pass.token }));
  } catch (err) {
    console.error("Outreach said:", err.message);
    res.statusCode = 502;
    res.end(JSON.stringify({ error: err.message }));
  }
}).listen(PORT, "127.0.0.1", () => console.log(`The Outreach helper is running on http://127.0.0.1:${PORT}`));
