// Adds the /outreach-start address to your own Vite server (npm run dev and npm run preview).
// In vite.config.ts add:  import outreach from "./outreach-vite.mjs";   and put  outreach()  inside  plugins: [ ... ]
// Your web page asks it for a short-lived pass; it asks Outreach for one with your secret key and hands the pass back.
// The secret key is read from the .env file next to this one and never reaches the web page.
import fs from "node:fs";

const OUTREACH = "{{HOST}}/api/embed";

function secretKey() {
  if (process.env.OUTREACH_SECRET) return process.env.OUTREACH_SECRET;
  try {
    for (const line of fs.readFileSync(new URL("./.env", import.meta.url), "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*OUTREACH_SECRET\s*=\s*(.*?)\s*$/);
      if (m) return m[1].replace(/^["']|["']$/g, "");
    }
  } catch { /* no .env file: explained below */ }
  return "";
}

async function call(secret, path, body) {
  const res = await fetch(OUTREACH + path, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `Outreach answered ${res.status}`);
  return data;
}

async function handle(req, res, next) {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname !== "/outreach-start") return next();
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json");
  const secret = secretKey();
  if (!secret.startsWith("psk_")) {
    res.statusCode = 500;
    return res.end(JSON.stringify({ error: "The secret key is missing. Copy .env.example to .env and paste your secret key after OUTREACH_SECRET=" }));
  }
  try {
    // TESTING ONLY: one fixed test person. In your real app this is the id of whoever is signed in.
    const external_id = process.env.TEST_USER_ID || "test-user-1";
    const component = url.searchParams.get("component") || "leads";
    const info = await call(secret, "/connect-sessions", { external_id, component });
    if (!info.linked) return res.end(JSON.stringify({ connect_token: info.connect_token }));
    const pass = await call(secret, "/sessions", { external_id, component });
    res.end(JSON.stringify({ token: pass.token }));
  } catch (err) {
    console.error("Outreach said:", err.message);
    res.statusCode = 502;
    res.end(JSON.stringify({ error: err.message }));
  }
}

export default function outreach() {
  return {
    name: "outreach-start",
    configureServer(server) { server.middlewares.use(handle); },
    configurePreviewServer(server) { server.middlewares.use(handle); },
  };
}
