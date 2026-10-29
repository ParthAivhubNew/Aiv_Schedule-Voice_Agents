// Adds Outreach to your existing Node (Express) server. In your server file add these two lines:
//
//     import { mountOutreach } from "./outreach-routes.mjs";
//     mountOutreach(app, (req) => String(req.user.id), requireLogin);
//
// The first argument is your Express app. The second says who is signed in (your own user id). The third is whatever you
// already use to make sure someone is signed in; leave it out while testing. Put the two lines BEFORE any catch-all route
// such as app.get("*", ...).
import fs from "node:fs";

try {
  for (const line of fs.readFileSync(new URL("./.env", import.meta.url), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch { /* no .env file: the key has to be in the environment */ }

const OUTREACH = "{{HOST}}/api/embed";

async function call(path, body) {
  const res = await fetch(OUTREACH + path, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OUTREACH_SECRET}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `Outreach answered ${res.status}`);
  return data;
}

export function mountOutreach(app, getUserId = () => "test-user-1", requireLogin = (req, res, next) => next()) {
  if (!String(process.env.OUTREACH_SECRET || "").startsWith("psk_")) {
    console.error("Outreach: the secret key is missing. Copy .env.example to .env and paste your secret key after OUTREACH_SECRET=");
  }
  app.get("/outreach-start", requireLogin, async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const external_id = String(getUserId(req));
      const component = String(req.query.component || "leads");
      const info = await call("/connect-sessions", { external_id, component });
      if (!info.linked) return res.json({ connect_token: info.connect_token });
      const pass = await call("/sessions", { external_id, component });
      res.json({ token: pass.token });
    } catch (err) {
      console.error("Outreach said:", err.message);
      res.status(502).json({ error: err.message });
    }
  });
}
