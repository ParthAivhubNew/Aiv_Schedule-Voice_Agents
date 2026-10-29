// Adds Outreach to your existing Node (Express) server. In your server file add these two lines:
//
//     import outreach from "./outreach-express.mjs";
//     app.use(outreach());
//
// Put them BEFORE any catch-all route such as app.get("*", ...). While testing that is all. Before real users, tell it who is signed in:
//
//     app.use(outreach({ getUserId: (req) => String(req.user.id), requireLogin }));
//
// getUserId returns your own id for the signed-in person. requireLogin is whatever you already use to make sure someone is signed in.
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

export default function outreach({ getUserId = () => "test-user-1", requireLogin = (req, res, next) => next() } = {}) {
  if (!String(process.env.OUTREACH_SECRET || "").startsWith("psk_")) {
    console.error("Outreach: the secret key is missing. Copy .env.example to .env and paste your secret key after OUTREACH_SECRET=");
  }
  return (req, res, next) => {
    if (req.method !== "GET" || req.path !== "/outreach-start") return next();
    requireLogin(req, res, async (err) => {
      if (err) return next(err);
      res.set("Cache-Control", "no-store");
      try {
        const external_id = String(getUserId(req));
        const component = String(req.query.component || "leads");
        const info = await call("/connect-sessions", { external_id, component });
        if (!info.linked) return res.json({ connect_token: info.connect_token });
        const pass = await call("/sessions", { external_id, component });
        res.json({ token: pass.token });
      } catch (e) {
        console.error("Outreach said:", e.message);
        res.status(502).json({ error: e.message });
      }
    });
  };
}
