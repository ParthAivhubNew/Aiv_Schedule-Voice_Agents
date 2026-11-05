// The Outreach side panel: the same screens a partner embeds, in the browser. Signing in uses Chrome's own sign-in window, so a
// password is only ever typed into Outreach. Switching screens signs in again without asking when Outreach remembers you.
(async function () {
  "use strict";
  const LABELS = { leadgen: "Leads", leads: "Leads", campaigns: "Campaigns", mail: "Mail", voice: "Voice", social: "Social" };
  const cfg = await (await fetch(chrome.runtime.getURL("config.json"))).json();
  const host = String(cfg.host || "").replace(/\/+$/, "");
  const frame = document.getElementById("frame");
  const connectBox = document.getElementById("connect");
  const connectText = document.getElementById("connect-text");
  const connectError = document.getElementById("connect-error");
  let current = "";
  const tokens = {}; // screen -> { token, expires }

  async function api(action, data) {
    const res = await fetch(host + "/api/v1/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plugin: "auth", action, data: { client_id: cfg.clientId, ...data } }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((body.error && body.error.message) || body.message || "Outreach answered " + res.status + ".");
    return body;
  }

  function keep(screen, d) {
    tokens[screen] = { token: d.token, expires: (d.expires_at || 0) * 1000 };
    chrome.storage.session.set({ ["t:" + screen]: tokens[screen] }).catch(() => {});
  }

  async function signIn(screen, interactive) {
    const start = await api("connect", { component: screen, return_url: chrome.identity.getRedirectURL("cb") });
    const done = await chrome.identity.launchWebAuthFlow({ url: host + "/embed/connect?state=" + encodeURIComponent(start.state), interactive });
    const hash = new URLSearchParams(new URL(done).hash.replace(/^#/, ""));
    const code = hash.get("outreach_code") || hash.get("code");
    if (!code) throw new Error("Sign-in did not finish.");
    keep(screen, await api("exchange", { code }));
  }

  async function tokenFor(screen) {
    const have = tokens[screen];
    if (!have) return "";
    if (have.expires - Date.now() > 60000) return have.token;
    try { keep(screen, await api("refresh", { token: have.token })); return tokens[screen].token; } catch (e) { delete tokens[screen]; return ""; }
  }

  function showConnect(message) {
    frame.hidden = true;
    connectBox.hidden = false;
    connectText.textContent = "Sign in to Outreach to use " + (LABELS[current] || "it") + " on this page.";
    connectError.textContent = message || "";
  }

  function open(screen) {
    connectBox.hidden = true;
    frame.hidden = false;
    frame.src = host + "/embed/" + screen + "?client_id=" + encodeURIComponent(cfg.clientId) + "&ext=1";
  }

  async function choose(screen) {
    current = screen;
    for (const b of document.querySelectorAll("#tabs button")) b.setAttribute("aria-selected", String(b.dataset.screen === screen));
    frame.removeAttribute("src");
    if (!(await tokenFor(screen))) {
      try { await signIn(screen, false); } catch (e) { return showConnect(""); } // not remembered yet: ask for a click
    }
    open(screen);
  }

  window.addEventListener("message", async (ev) => {
    if (ev.source !== frame.contentWindow || ev.origin !== host) return;
    const d = ev.data;
    if (!d || d.source !== "outreach-embed") return;
    const send = (msg) => frame.contentWindow.postMessage({ source: "outreach-loader", ...msg }, host);
    if (d.type === "ready") send({ type: "init", token: await tokenFor(current), appearance: cfg.look && Object.keys(cfg.look).length ? { variables: cfg.look } : undefined });
    else if (d.type === "ready-ui" && pendingFind) { send({ type: "find", company: pendingFind }); pendingFind = ""; }
    else if (d.type === "token-needed") send({ type: "token", token: await tokenFor(current) });
    else if (d.type === "session-ended") { delete tokens[current]; showConnect("Your session ended."); }
    else if (d.type === "error") showConnect(d.message || "Something went wrong.");
  });

  document.getElementById("connect-button").addEventListener("click", async () => {
    connectError.textContent = "";
    try { await signIn(current, true); open(current); } catch (e) { connectError.textContent = e.message || "Could not sign in."; }
  });

  // The page you were on when you clicked the toolbar button (read by background.js, only then), as a company to look up.
  let pendingFind = "";
  const pageBox = document.getElementById("page");
  const pageName = document.getElementById("page-name");
  function companyOf(p) {
    const parts = String(p.site || p.title || "").split(/\s+[|\u2013\u2014-]\s+/).map((x) => x.trim()).filter(Boolean);
    const host = (() => { try { return new URL(p.url).hostname.replace(/^www\./, ""); } catch (e) { return ""; } })();
    return (p.selection && p.selection.length <= 80 ? p.selection : p.site || parts[parts.length > 1 ? parts.length - 1 : 0] || host).slice(0, 120);
  }
  function showPage(p) {
    if (!p || !p.url) { pageBox.hidden = true; return; }
    pageBox.hidden = false;
    document.getElementById("page-line").textContent = "This page: " + (p.title || p.url);
    pageName.value = companyOf(p);
  }
  document.getElementById("page-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const company = pageName.value.trim();
    if (!company) return;
    if ((current === "leadgen" || current === "leads") && !frame.hidden && frame.contentWindow) frame.contentWindow.postMessage({ source: "outreach-loader", type: "find", company }, host);
    else { pendingFind = company; choose((cfg.screens || []).includes("leads") && !(cfg.screens || []).includes("leadgen") ? "leads" : "leadgen"); }
  });
  document.getElementById("page-clear").addEventListener("click", () => { pageBox.hidden = true; chrome.storage.session.set({ page: null }).catch(() => {}); });
  chrome.storage.onChanged.addListener((changes, area) => { if (area === "session" && changes.page) showPage(changes.page.newValue); });
  chrome.storage.session.get("page").then((v) => showPage(v && v.page)).catch(() => {});

  const tabs = document.getElementById("tabs");
  for (const screen of (cfg.screens || Object.keys(LABELS)).filter((s) => LABELS[s])) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = LABELS[screen];
    b.dataset.screen = screen;
    b.setAttribute("role", "tab");
    b.addEventListener("click", () => choose(screen));
    tabs.appendChild(b);
  }
  const stored = await chrome.storage.session.get(null).catch(() => ({}));
  for (const k of Object.keys(stored)) if (k.startsWith("t:")) tokens[k.slice(2)] = stored[k];
  choose((cfg.screens || ["leads"])[0]);
})();
