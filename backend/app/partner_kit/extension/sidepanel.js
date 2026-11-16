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
  const loading = document.getElementById("loading");
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
    loading.hidden = true;
    connectBox.hidden = false;
    connectText.textContent = "Sign in once to use " + (LABELS[current] || "Outreach") + " from this browser.";
    connectError.textContent = message || "";
  }

  function open(screen) {
    connectBox.hidden = true;
    frame.hidden = false;
    loading.hidden = false;
    frame.src = host + "/embed/" + screen + "?client_id=" + encodeURIComponent(cfg.clientId) + "&ext=1";
  }

  async function choose(screen) {
    current = screen;
    for (const b of document.querySelectorAll("#tabs button")) b.setAttribute("aria-selected", String(b.dataset.screen === screen));
    frame.removeAttribute("src");
    loading.hidden = true;
    if (!(await tokenFor(screen))) {
      try { await signIn(screen, false); } catch (e) { return showConnect(""); } // not remembered yet: ask for a click
    }
    open(screen);
  }

  frame.addEventListener("load", () => { if (frame.getAttribute("src")) loading.hidden = true; });

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


  // The company behind this page, from what Outreach already holds (free, nothing searched on the web). It reads and saves through
  // the same /v1/run the partner pages use, with the Leads sign-in; the page's text is only ever shown with textContent.
  // One "api" pass covers every action the card uses: looking the company up, saving it, journeys and calls.
  const cardScreen = (cfg.screens || []).length ? "api" : "";
  const card = document.getElementById("company");
  let cardSeq = 0;
  let cardPage = null;

  async function run(action, data, id, plugin) {
    const token = await tokenFor(cardScreen);
    if (!token) throw Object.assign(new Error("Sign in to see this company."), { signin: true });
    const res = await fetch(host + "/api/v1/run", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({ plugin: plugin || "leads", action, id, data }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 401) { delete tokens[cardScreen]; throw Object.assign(new Error("Sign in to see this company."), { signin: true }); }
    if (!res.ok) throw new Error((body.error && body.error.message) || body.message || "Outreach answered " + res.status + ".");
    return body;
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  const pageForm = document.getElementById("page-form");
  function fill(...kids) { card.replaceChildren(...kids); card.hidden = false; }
  function note(text, ...extra) { const box = el("div", "co-note"); box.append(el("p", "", text), ...extra); fill(box); }

  async function lookupCompany(p, name) {
    if (!cardScreen) return;
    cardPage = p;
    const mine = ++cardSeq;
    pageForm.hidden = false;
    fill(el("div", "co-note co-wait", "Looking this company up"));
    const domain = (() => { try { return new URL(p.url).hostname; } catch (e) { return ""; } })();
    try {
      if (!(await tokenFor(cardScreen))) { try { await signIn(cardScreen, false); } catch (e) { /* asked for below */ } }
      const out = await run("company.lookup", { domain, name: name || "" });
      if (mine !== cardSeq) return;
      showMatches(out.matches || [], out.matched_by, 0);
    } catch (e) {
      if (mine !== cardSeq) return;
      if (e.signin) {
        const b = el("button", "co-primary", "Sign in");
        b.type = "button";
        b.addEventListener("click", async () => { try { await signIn(cardScreen, true); lookupCompany(p, name); } catch (err) { note(err.message || "Could not sign in."); } });
        note("Sign in to see who is behind this page.", b);
      } else {
        const b = el("button", "co-quiet", "Try again");
        b.type = "button";
        b.addEventListener("click", () => lookupCompany(p, name));
        note(e.message || "Could not look this company up.", b);
      }
    }
  }

  function fact(label, value, href) {
    if (!value) return null;
    const row = el("div", "co-fact");
    row.append(el("dt", "", label));
    const dd = el("dd");
    if (href) { const a = el("a", "", value); a.href = href; a.target = "_blank"; a.rel = "noopener noreferrer"; dd.append(a); } else dd.append(value);
    const copy = el("button", "co-copy", "Copy");
    copy.type = "button";
    copy.setAttribute("aria-label", "Copy " + label.toLowerCase());
    copy.addEventListener("click", () => navigator.clipboard.writeText(value).then(() => { copy.textContent = "Copied"; setTimeout(() => { copy.textContent = "Copy"; }, 1500); }).catch(() => {}));
    row.append(dd, copy);
    return row;
  }

  function showMatches(matches, by, i) {
    if (!matches.length) {
      const b = el("button", "co-quiet", "Search in Leads");
      b.type = "button";
      b.addEventListener("click", () => openFind(pageName.value.trim() || (cardPage && companyOf(cardPage)) || ""));
      return note("Outreach has no record of this company yet. Check the name above, or search for it in Leads.", b);
    }
    const m = matches[i];
    pageForm.hidden = true;
    const head = el("div", "co-head");
    head.append(el("strong", "co-name", m.name));
    if (m.status) head.append(el("span", "co-status", m.status));
    const meta = [m.industry, m.address].filter(Boolean).join(" · ");
    const facts = el("dl", "co-facts");
    const site = m.website || m.domain || "";
    for (const f of [
      fact("Phone", m.phone, m.phone ? "tel:" + m.phone.replace(/\s+/g, "") : ""),
      fact("Email", m.email, m.email ? "mailto:" + m.email : ""),
      fact("Website", site, /^https?:\/\//i.test(site) ? site : (site ? "https://" + site : "")),
    ]) if (f) facts.append(f);
    const kids = [head];
    if (meta) kids.push(el("p", "co-meta", meta));
    if (facts.childElementCount) kids.push(facts);
    if (m.people && m.people.length) {
      const ul = el("ul", "co-people");
      for (const x of m.people) { const li = el("li"); li.append(el("span", "", x.name)); if (x.role) li.append(el("small", "", x.role)); ul.append(li); }
      kids.push(el("h2", "co-h", "People on record"), ul);
    }
    const actions = el("div", "co-actions");
    const save = el("button", "co-primary", m.saved ? "In your leads" : "Save as lead");
    save.type = "button";
    save.disabled = !!m.saved;
    save.addEventListener("click", async () => {
      save.disabled = true; save.textContent = "Saving";
      try {
        const out = await run("lead.add", { leads: [{ name: m.name, website: site, phone: m.phone || "", email: m.email || "", industry: m.industry || "" }] });
        const rows = out.data || [];
        const row = rows.find((x) => String(x.name || "").toLowerCase() === m.name.toLowerCase()) || rows[0];
        m.saved = { id: row ? row.id : "", stage: "" };
        showMatches(matches, by, i);
      } catch (e) { save.disabled = false; save.textContent = "Save as lead"; save.after(el("p", "co-err", e.message || "Could not save.")); }
    });
    const open = el("button", "co-quiet", "Open in Leads");
    open.type = "button";
    open.addEventListener("click", () => openFind(m.name));
    const slot = el("div", "co-slot");
    const toggle = (btn, build) => btn.addEventListener("click", () => {
      if (btn.getAttribute("aria-expanded") === "true") { btn.setAttribute("aria-expanded", "false"); slot.replaceChildren(); return; }
      for (const b of actions.querySelectorAll("[aria-expanded]")) b.setAttribute("aria-expanded", "false");
      btn.setAttribute("aria-expanded", "true");
      slot.replaceChildren(build(m));
    });
    const journey = el("button", "co-quiet", "Add to journey");
    journey.type = "button";
    journey.setAttribute("aria-expanded", "false");
    toggle(journey, journeyPanel);
    actions.append(save, journey);
    if (m.phone) {
      const call = el("button", "co-quiet", "Call");
      call.type = "button";
      call.setAttribute("aria-expanded", "false");
      toggle(call, callPanel);
      actions.append(call);
    }
    actions.append(open);
    kids.push(actions, slot);
    if (m.saved && m.saved.id) kids.push(listPicker(m.saved.id));
    const foot = el("div", "co-foot");
    foot.append(el("span", "", by === "name" ? "Matched by name. Check it is the right company." : "Matched by this page's web address."));
    if (matches.length > 1) {
      const next = el("button", "co-quiet", "Not this one? " + (matches.length - 1) + " more");
      next.type = "button";
      next.addEventListener("click", () => showMatches(matches, by, (i + 1) % matches.length));
      foot.append(next);
    }
    const other = el("button", "co-quiet", "Search another name");
    other.type = "button";
    other.addEventListener("click", () => { pageForm.hidden = false; pageName.focus(); });
    foot.append(other);
    kids.push(foot);
    fill(...kids);
  }


  const WHY = { invalid: "That email address does not look right.", duplicate: "Already in this journey.", do_not_email: "This address is on your do-not-email list.",
    in_another_journey: "Already in another running journey.", no_contact: "There is no email address to use.", problem: "This company cannot be added right now.", email_bad: "That address cannot receive email." };

  function field(placeholder, value, type) {
    const i = el("input");
    i.type = type || "text";
    i.placeholder = placeholder;
    i.setAttribute("aria-label", placeholder);
    i.value = value || "";
    return i;
  }

  function journeyPanel(m) {
    const box = el("div", "co-panel");
    const sel = el("select");
    sel.setAttribute("aria-label", "Journey");
    const email = field("Email to use", m.email, "email");
    const go = el("button", "co-primary", "Add");
    go.type = "button";
    go.disabled = true;
    const msg = el("p", "co-msg", "Loading your journeys");
    msg.setAttribute("role", "status");
    box.append(sel, email, go, msg);
    const status = {};
    run("journey.list", {}).then((out) => {
      const list = out.journeys || [];
      if (!list.length) { msg.textContent = "You have no journeys yet. Make one in Leads, then add people here."; sel.hidden = true; email.hidden = true; go.hidden = true; return; }
      for (const j of list) { const o = el("option", "", j.name + (j.status === "running" ? "" : " (" + j.status + ")")); o.value = j.id; sel.append(o); status[j.id] = j.status; }
      go.disabled = false;
      msg.textContent = "";
    }).catch((e) => { msg.textContent = e.message || "Could not load your journeys."; sel.hidden = true; email.hidden = true; go.hidden = true; });
    go.addEventListener("click", async () => {
      go.disabled = true;
      msg.textContent = "Adding";
      try {
        const out = await run("journey.add", { people: [{ email: email.value.trim(), company: m.name, lead_id: (m.saved && m.saved.id) || "" }] }, sel.value);
        if (out.added) msg.textContent = status[sel.value] === "running" ? "Added. It starts with the journey's next step." : "Added. It starts when you start the journey.";
        else { const why = Object.keys(out.skipped || {}).find((k) => out.skipped[k]); msg.textContent = WHY[why] || "Nobody was added."; go.disabled = false; }
      } catch (e) { msg.textContent = e.message || "Could not add."; go.disabled = false; }
    });
    return box;
  }

  function callPanel(m) {
    const box = el("div", "co-panel");
    box.append(el("p", "co-msg", "The AI assistant will call " + m.phone + " now. This is a real call and uses voice minutes."));
    const goal = field("What should the call achieve? (optional)", "");
    goal.maxLength = 300;
    const go = el("button", "co-primary", "Start call");
    go.type = "button";
    const msg = el("p", "co-msg");
    msg.setAttribute("role", "status");
    box.append(goal, go, msg);
    go.addEventListener("click", async () => {
      go.disabled = true;
      msg.textContent = "Starting the call";
      try {
        await run("call.start", { to: m.phone, lead_name: m.name, goal: goal.value.trim() || undefined, lead_id: (m.saved && m.saved.id) || undefined }, undefined, "voice");
        msg.textContent = "The call has started. Follow it in Voice.";
      } catch (e) { msg.textContent = e.message || "Could not start the call."; go.disabled = false; }
    });
    return box;
  }

  function listPicker(leadId) {
    const box = el("div", "co-list");
    const sel = el("select");
    sel.setAttribute("aria-label", "List to add to");
    const add = el("button", "co-quiet", "Add to list");
    add.type = "button";
    add.disabled = true;
    box.append(sel, add);
    run("list.list", {}).then((out) => {
      const lists = out.lists || [];
      if (!lists.length) { box.hidden = true; return; }
      for (const l of lists) { const o = el("option", "", l.name || "Untitled list"); o.value = l.id; sel.append(o); }
      add.disabled = false;
    }).catch(() => { box.hidden = true; });
    add.addEventListener("click", async () => {
      add.disabled = true;
      try { await run("list.edit", { add: [leadId] }, sel.value); add.textContent = "Added"; } catch (e) { add.disabled = false; add.textContent = "Could not add. Try again"; }
    });
    return box;
  }

  function openFind(company) {
    if (!company) return;
    if ((current === "leadgen" || current === "leads") && !frame.hidden && frame.contentWindow) frame.contentWindow.postMessage({ source: "outreach-loader", type: "find", company }, host);
    else { pendingFind = company; choose((cfg.screens || []).includes("leads") && !(cfg.screens || []).includes("leadgen") ? "leads" : "leadgen"); }
  }

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
    if (!p || !p.url) { pageBox.hidden = true; card.hidden = true; return; }
    pageBox.hidden = false;
    const domain = (() => { try { return new URL(p.url).hostname.replace(/^www\./, ""); } catch (e) { return p.url; } })();
    document.getElementById("page-domain").textContent = domain;
    document.getElementById("page-line").textContent = p.title || p.url;
    document.getElementById("page-avatar").textContent = (domain[0] || "?");
    pageName.value = companyOf(p);
    lookupCompany(p, pageName.value);
  }
  document.getElementById("page-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const company = pageName.value.trim();
    if (!company) return;
    if (cardPage) lookupCompany(cardPage, company);
    if ((current === "leadgen" || current === "leads") && !frame.hidden && frame.contentWindow) frame.contentWindow.postMessage({ source: "outreach-loader", type: "find", company }, host);
    else { pendingFind = company; choose((cfg.screens || []).includes("leads") && !(cfg.screens || []).includes("leadgen") ? "leads" : "leadgen"); }
  });
  document.getElementById("page-clear").addEventListener("click", () => { pageBox.hidden = true; card.hidden = true; cardSeq += 1; chrome.storage.session.set({ page: null }).catch(() => {}); });
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
