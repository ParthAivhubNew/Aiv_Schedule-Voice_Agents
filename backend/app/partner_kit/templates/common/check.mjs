// Checks, step by step, that your Outreach set-up works, and says what to fix.
// Run it from your project folder:   node check.mjs
// If your app runs on another address:   node check.mjs http://localhost:3000
import fs from "node:fs";

const HOST = "{{HOST}}";
const CLIENT_ID = "{{CLIENT_ID}}";
const APP = (process.argv[2] || process.env.APP_URL || "{{ORIGIN}}").replace(/\/+$/, "");

let failed = 0;
const pass = (message) => console.log(`  [ok]  ${message}`);
const fail = (message, fix) => { failed += 1; console.log(`  [X]   ${message}\n        Fix: ${fix}`); };

// The secret key comes from the .env file (or .env.local, as Next.js uses) in this folder, or from the environment.
for (const name of [".env", ".env.local"]) {
  try {
    for (const line of fs.readFileSync(new URL(`./${name}`, import.meta.url), "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* that file is not there: reported below if no key is found */ }
}

console.log(`\nChecking your Outreach set-up for ${APP}\n`);

// 0. The files sit in your project folder. Many unzip tools make a new folder named after the zip: then everything is one level too deep.
const here = (name) => fs.existsSync(new URL(`./${name}`, import.meta.url));
const above = (name) => fs.existsSync(new URL(`../${name}`, import.meta.url));
const MARKERS = ["package.json", "requirements.txt", "pyproject.toml", "composer.json", "index.php"];
if (!MARKERS.some(here) && MARKERS.some(above)) {
  fail("These files are in a sub-folder of your project, not in the project folder itself", "Move everything in this folder (including the hidden .env and .env.example) up one level, into the folder that holds " + (MARKERS.find(above)) + ". Then run this again from there.");
} else pass("The files are in your project folder");

// 0b. Vite only: vite.config must import this kit's file and use it. A wrong file name or a wrong import style is the usual slip.
const STACK = "{{STACK}}";
if (STACK === "vite") {
  const cfg = ["vite.config.ts", "vite.config.mts", "vite.config.js", "vite.config.mjs"].find(here);
  if (!cfg) fail("No vite.config file next to check.mjs", "Open the folder that holds your vite.config.ts and put this kit's files there.");
  else {
    const text = fs.readFileSync(new URL(`./${cfg}`, import.meta.url), "utf8");
    const right = /import\s+outreach\s+from\s+["']\.\/outreach-vite\.mjs["']/.test(text);
    if (right && /\boutreach\s*\(\s*\)/.test(text)) pass(`${cfg} uses outreach-vite.mjs`);
    else {
      const wrong = text.match(/import[^;\n]*from\s+["']\.\/(outreach[^"']*)["']/);
      fail(wrong && !right ? `${cfg} imports "./${wrong[1]}", which is not this kit's file` : `${cfg} does not use outreach-vite.mjs yet`,
        `Open ${cfg}. At the top, with the other imports, it needs exactly:  import outreach from "./outreach-vite.mjs";  and inside plugins: [ ... ] it needs:  outreach()  (no curly braces, small o).`);
    }
  }
}

// 1. Node
const major = Number(process.versions.node.split(".")[0]);
if (major >= 18) pass(`Node ${process.versions.node}`);
else fail(`Node ${process.versions.node} is too old`, "Install Node 18 or newer from nodejs.org, then run this again.");

// 2. The secret key is in place
const key = process.env.OUTREACH_SECRET || "";
if (key.startsWith("psk_")) pass(`Secret key found in .env (${key.startsWith("psk_test_") ? "test key" : "live key"})`);
else fail("No secret key in the .env file", "Copy the file .env.example to .env (.env.local for Next.js), then paste your secret key after OUTREACH_SECRET= (no quotes, no spaces).");

// 3. Outreach accepts it
if (key.startsWith("psk_")) {
  try {
    const res = await fetch(`${HOST}/api/embed/connect-sessions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ external_id: "starter-kit-check", component: "leads" }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) pass("Outreach accepts your secret key");
    else if (res.status === 401) fail("Outreach does not accept this secret key", "In Outreach open Admin APIs & Webhooks, then Partner programme, make a new secret key and paste it into .env. While you are in the sandbox the key starts with psk_test_.");
    else fail(`Outreach answered ${res.status}: ${data.detail || "no details"}`, "Read the message above. Terms not accepted: accept them in Partner programme. Integration paused: write to the Outreach team.");
  } catch (err) {
    fail(`Could not reach Outreach (${err.message})`, "Check this computer's internet connection and any firewall that blocks outgoing requests.");
  }
}

// 4. Outreach lets your page show its screens
try {
  const res = await fetch(`${HOST}/embed/leads?client_id=${CLIENT_ID}`, { method: "HEAD" });
  const rule = res.headers.get("content-security-policy") || "";
  const origin = new URL(APP).origin;
  if (rule.includes(origin)) pass(`Outreach allows ${origin} to show its screens`);
  else if (rule.includes("'none'")) fail("Outreach has no web address saved for you", "In Partner programme, step 2, add the address of your page, then run this again.");
  else fail(`${origin} is not in your list of web addresses (Outreach has: ${rule.replace("frame-ancestors", "").trim() || "none"})`, "In Partner programme, step 2, add it exactly as the browser bar shows it: with http:// or https://, the same www or no www, and the port number if there is one.");
} catch (err) {
  fail(`Could not check your web addresses (${err.message})`, "Check this computer's internet connection, then run this again.");
}

// 5. Your own app hands out a pass
try {
  const res = await fetch(`${APP}{{PASS}}?component=leads`, { cache: "no-store" });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* not JSON: explained below */ }
  if (data && (data.token || data.connect_token)) pass(`${APP}{{PASS}} returns a pass`);
  else if (data && data.error) fail(`${APP}{{PASS}} answered: ${data.error}`, "Fix what that message says, then run this again.");
  else if (/<html|<!doctype/i.test(text)) fail(`${APP}{{PASS}} returns a web page, not a pass`, "Your app is answering with its own home page, so the route is not added yet. Do STEP 3 in START-HERE.txt (Vite: add outreach() to vite.config; Node: add mountOutreach(app) before your catch-all route), then restart your app.");
  else fail(`${APP}{{PASS}} answered ${res.status} with ${text ? "text that is not a pass" : "nothing"}`, "The route is not answering. Do STEP 3 in START-HERE.txt, then stop your app and start it again.");
} catch (err) {
  fail(`Could not reach your app at ${APP} (${err.message})`, `Start your app, then run this again. If it runs on another address: node check.mjs http://that-address`);
}

console.log(failed
  ? `\n${failed} check${failed === 1 ? "" : "s"} failed. Fix the first [X] above, then run: node check.mjs\n`
  : `\nAll checks passed. Open ${APP}/outreach-test.html to see the Outreach screen.\n`);
process.exitCode = failed ? 1 : 0; // end naturally: calling process.exit() right after a fetch crashes Node on Windows
