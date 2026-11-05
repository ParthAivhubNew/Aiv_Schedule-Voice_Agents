/*! Outreach embed loader. Put Outreach screens inside your own software.
 *
 * The easy way (no JavaScript to write, nothing on your server): one script tag, then a tag wherever a screen should show.
 *
 *   <script src="https://YOUR-OUTREACH-HOST/embed.js" data-key="pk_..." data-accent="#0a7"></script>
 *   <div data-outreach="leads"></div>                                         // a panel inside your page
 *   <button data-outreach="leads" data-mode="popup">Open Leads</button>       // a popup (also: drawer, page)
 *
 * The person clicks "Connect Outreach" once, signs in, and the screen opens. Your page never sees a password. You choose where
 * the sign-in shows with data-login (on the script tag for every screen, or on one [data-outreach] tag):
 *   data-login="popup"   a small Outreach window (the default)
 *   data-login="inline"  inside your page, in the place of the screen (in a popup or side panel, inside that)
 *   data-login="page"    the whole window goes to Outreach and comes back to the same page
 * The button text is yours: data-connect-label="Open lead finder" (on the script tag for every screen, or on one [data-outreach] tag).
 *   To use your own button instead, call Outreach.open("leadgen", { mode: "popup" }) from its click handler.
 * workspace: Leads, Voice and Social in one screen behind one sign-in, with a tab for each. data-tabs="leads,voice" shows only those tabs.
 * Screens: leadgen (every page of the Leads app), voice, social, or a smaller slice of Leads: leads, campaigns, mail.
 * account: users, phone numbers, plans and API keys for an admin. Outreach switches it on per partner; the admin signs in with their password each time.
 *
 * Look, set right on the tag (on the script tag for every screen, or on one [data-outreach] tag for that screen):
 *   data-accent="#0a7"  data-bg="#fff"  data-text="#111"  data-surface="#fafafa"  data-danger="#c00"
 *   data-sidebar="#123"  data-sidebar-text="#fff"  data-radius="8"  data-font="system|inter|serif|rounded|mono"
 *   data-name="Acme"  data-logo="https://.../logo.png"  data-appearance="auto" (copy the colours of your page)
 *
 * Your own data and actions, from your own code (the person connects once, with a click, then these just work):
 *   await Outreach.import(records, { list: "My CRM leads" })   // put your contacts or companies into their account
 *   await Outreach.run("leads", "list.list")                    // any action of any plugin: voice, leads, social, whatsapp, mail, account
 *   await Outreach.run("voice", "call.start", { to: "+4420..." })
 *   Outreach.find("Acme Ltd")                                   // open Leads with that company searched
 *   <div data-outreach="leadgen" data-find="Acme Ltd"></div>    // the same, as a tag
 * Every action is listed in the API guide. While your integration is in test mode the actions are simulated and save nothing.
 *
 * Already have a server that signs your users in? Add data-pass="/outreach-start" (the address on YOUR server that hands out a
 * pass, see the guide) and people are connected without a click.
 *
 * The longer way, with full control:
 *
 *   <script src="https://YOUR-OUTREACH-HOST/embed.js"></script>
 *   const outreach = Outreach("pk_...");
 *   outreach.create("leads", { token, appearance }).mount("#box");                       // inline
 *   outreach.create("campaigns", { token }).open({ mode: "modal" });                      // popup
 *   outreach.create("voice", { token }).open({ mode: "drawer", side: "right" });          // side panel
 *   outreach.redirect("mail", { token });                                                  // full page
 *   outreach.connect({ connectToken, onConnected }).open({ mode: "modal" });               // link a user's account
 *
 * `token` (or `getToken`, a function returning a token or a promise of one) comes from your server: see the guide.
 * The secret key never goes in a web page.
 */
/* global window, document, URL, console, getComputedStyle, MutationObserver, setTimeout, clearTimeout, fetch, Promise */
(function (global) {
  "use strict";
  var script = document.currentScript;
  var DEFAULT_HOST = script && script.src ? new URL(script.src).origin : "";
  var COMPONENTS = { leads: 1, leadgen: 1, campaigns: 1, mail: 1, voice: 1, social: 1, workspace: 1, account: 1, connect: 1 };

  function el(tag, css, attrs) {
    var e = document.createElement(tag);
    if (css) e.style.cssText = css;
    if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }
  function resolve(v) {
    try { return Promise.resolve(typeof v === "function" ? v() : v); } catch (err) { return Promise.reject(err); }
  }
  function cleanAppearance(a) {
    return a && typeof a === "object" && a !== null && !a.auto ? a : undefined;
  }

  // ── Matching the look of the page that shows the screen ───────────────────────────────────────────────
  // appearance: "auto" (or { auto: true, ... }) reads the host page's own colours and sends them to the screen:
  //   primary:  "--css-variable" or "css selector" to take the button colour from (else common names such as --primary, --brand)
  //   danger:   "--css-variable" for the error colour
  //   sidebar:  "css selector" of your own side menu to match (else the first <nav>/<aside> with a solid colour)
  //   variables: anything you set yourself wins over what was read
  // Only light pages can be matched: the screens have no dark theme yet, so a dark page keeps the screen's own light
  // background and text and only borrows the button colour, corners, font and sidebar.
  var PRIMARY_VARS = ["--primary", "--brand", "--accent", "--color-primary", "--primary-color", "--brand-color", "--accent-color", "--bs-primary", "--theme-color"];
  var DANGER_VARS = ["--danger", "--error", "--destructive", "--color-danger", "--color-error", "--bs-danger"];
  var probe = null;
  function toRgb(c) {
    if (!c) return null;
    try {
      probe = probe || document.createElement("canvas").getContext("2d", { willReadFrequently: true });
      probe.canvas.width = probe.canvas.height = 1;
      probe.fillStyle = "#010203";
      probe.fillStyle = c;
      probe.clearRect(0, 0, 1, 1);
      probe.fillRect(0, 0, 1, 1);
      var d = probe.getImageData(0, 0, 1, 1).data;
      if (d[3] < 128) return null;
      if (d[0] === 1 && d[1] === 2 && d[2] === 3 && String(c).replace(/\s/g, "").toLowerCase() !== "#010203") return null;
      return [d[0], d[1], d[2]];
    } catch { return null; }
  }
  function hex(rgb) { return rgb ? "#" + rgb.map(function (x) { return ("0" + x.toString(16)).slice(-2); }).join("") : ""; }
  function light(rgb) { return (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255; }
  function grey(rgb) { return Math.max(rgb[0], rgb[1], rgb[2]) - Math.min(rgb[0], rgb[1], rgb[2]) < 28; }
  function cssVar(name) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name);
    v = v ? v.trim() : "";
    if (!v) return "";
    if (/^[\d.]+\s+[\d.]+%\s+[\d.]+%$/.test(v)) return "hsl(" + v.replace(/\s+/g, ",") + ")"; // "262 83% 58%", as shadcn writes it
    if (/^\d+\s+\d+\s+\d+$/.test(v)) return "rgb(" + v.replace(/\s+/g, ",") + ")";
    return v;
  }
  function brand(el) {
    var cs = getComputedStyle(el);
    var c = toRgb(cs.backgroundColor);
    if (c && !grey(c)) return c;
    c = toRgb(cs.color);
    return c && !grey(c) ? c : null;
  }
  function visible(el) { var r = el.getBoundingClientRect(); return r.width > 20 && r.height > 12 && getComputedStyle(el).visibility !== "hidden"; }
  function firstBrand(selector) {
    var list = document.querySelectorAll(selector);
    for (var i = 0; i < list.length && i < 60; i++) {
      if (!visible(list[i])) continue;
      var c = toRgb(getComputedStyle(list[i]).backgroundColor);
      if (c && !grey(c) && light(c) < 0.9) return list[i];
    }
    return null;
  }
  function fontKey() {
    var first = (getComputedStyle(document.body).fontFamily || "").split(",")[0].replace(/["']/g, "").trim().toLowerCase();
    if (/^(inter)$/.test(first)) return "inter";
    if (/(georgia|times|garamond|merriweather|playfair|lora|serif$)/.test(first) && !/sans/.test(first)) return "serif";
    if (/(mono|courier|consolas|menlo|code)/.test(first)) return "mono";
    if (/(nunito|quicksand|rounded|comfortaa|varela)/.test(first)) return "rounded";
    return "system";
  }
  function hostLook(opts) {
    var o = opts && typeof opts === "object" ? opts : {}, v = {}, el = null, c = null;
    try {
      if (typeof o.primary === "string" && o.primary) {
        if (o.primary.indexOf("--") === 0) c = toRgb(cssVar(o.primary));
        else { el = document.querySelector(o.primary); c = el ? brand(el) : null; }
      }
      for (var i = 0; !c && i < PRIMARY_VARS.length; i++) c = toRgb(cssVar(PRIMARY_VARS[i]));
      if (!c) { el = firstBrand('button, [type="submit"], .btn, .button, [class*="primary"]'); c = el ? toRgb(getComputedStyle(el).backgroundColor) : null; }
      if (!c) { el = document.querySelector("a[href]"); c = el ? brand(el) : null; }
      if (c) v.colorPrimary = hex(c);
      var shape = el || firstBrand('button, [type="submit"], .btn, input[type="text"], input');
      var radius = shape ? getComputedStyle(shape).borderTopLeftRadius : "";
      if (radius && radius.indexOf("%") < 0 && !isNaN(parseFloat(radius))) v.borderRadius = Math.max(0, Math.min(24, Math.round(parseFloat(radius))));
      var cs = getComputedStyle(document.body), bg = toRgb(cs.backgroundColor) || toRgb(getComputedStyle(document.documentElement).backgroundColor) || [255, 255, 255];
      if (light(bg) >= 0.5) {
        v.colorBackground = hex(bg);
        var text = toRgb(cs.color);
        if (text && light(text) < 0.5) v.colorText = hex(text);
      }
      v.fontFamily = fontKey();
      var d = null;
      if (typeof o.danger === "string" && o.danger.indexOf("--") === 0) d = toRgb(cssVar(o.danger));
      for (var j = 0; !d && j < DANGER_VARS.length; j++) d = toRgb(cssVar(DANGER_VARS[j]));
      if (d) v.colorDanger = hex(d);
      var side = typeof o.sidebar === "string" && o.sidebar ? document.querySelector(o.sidebar) : null;
      if (!side) {
        var cand = document.querySelectorAll("aside, nav, [class*='sidebar'], [class*='side-nav'], [class*='sidenav']");
        for (var k = 0; k < cand.length && k < 12 && !side; k++) {
          var r = cand[k].getBoundingClientRect();
          if (r.width > 120 && r.width < 420 && r.height > 300 && toRgb(getComputedStyle(cand[k]).backgroundColor)) side = cand[k];
        }
      }
      if (side) {
        var sc = getComputedStyle(side), sb = toRgb(sc.backgroundColor), st = toRgb(sc.color);
        if (sb) { v.colorSidebar = hex(sb); if (st && Math.abs(light(st) - light(sb)) > 0.35) v.colorSidebarText = hex(st); }
      }
    } catch { /* a page we cannot read just keeps the screen own look */ }
    return { variables: v };
  }
  // What to send for a screen's `appearance` option: its own values, or the page's (with the screen's own laid on top).
  function lookFor(a) {
    if (a === "auto" || (a && typeof a === "object" && a.auto)) {
      var read = hostLook(a === "auto" ? {} : a.auto), mine = a && typeof a === "object" && a.variables && typeof a.variables === "object" ? a.variables : {};
      var out = {};
      for (var k in read.variables) out[k] = read.variables[k];
      for (var m in mine) out[m] = mine[m];
      return { variables: out };
    }
    return cleanAppearance(a);
  }

  function Screen(client, component, options) {
    this.client = client;
    this.component = component;
    this.options = options || {};
    this.frame = null;
    this.overlay = null;
    this.container = null;
    this.ready = false;
    var self = this;
    this._onMessage = function (ev) { self._message(ev); };
    window.addEventListener("message", this._onMessage);
  }

  Screen.prototype._src = function () {
    return this.client.host + "/embed/" + this.component + "?client_id=" + encodeURIComponent(this.client.clientId);
  };

  var TITLES = { leads: "Leads", leadgen: "Leads", campaigns: "Email campaigns", mail: "Mail", voice: "Voice", social: "Social", workspace: "Outreach", account: "Account", connect: "Connect your account" };

  Screen.prototype._build = function (parent, height) {
    if (this.frame) return;
    // In a popup or side panel the frame fills what is left under the header bar (height "fill"); inline it has its own height.
    var size = height === "fill" ? "flex:1 1 auto;min-height:0;height:0;" : "height:" + height + ";";
    var f = el("iframe", "border:0;width:100%;" + size + "display:block;background:transparent;", {
      src: this._src(), title: "Outreach " + this.component, allow: "clipboard-write; microphone",
    });
    f.setAttribute("referrerpolicy", "origin");
    parent.appendChild(f);
    this.frame = f;
    this.container = parent;
    // A screen the browser refused to frame (this page's address is not in the partner's list) never answers, and looks blank.
    var self = this;
    clearTimeout(this._wait);
    this._wait = setTimeout(function () {
      if (self.frame && !self.heard) self._fail("The Outreach screen did not open. Check that this page's address is in the web address list under Partner programme, exactly as it shows in the browser bar, and that Outreach(...) was given your publishable key (pk_...). The browser console shows a 'Refused to frame' message when the address is the problem.");
    }, 12000);
  };

  Screen.prototype._send = function (msg) {
    if (!this.frame || !this.frame.contentWindow) return;
    msg.source = "outreach-loader";
    this.frame.contentWindow.postMessage(msg, this.client.host);
  };

  Screen.prototype._init = function () {
    var o = this.options, self = this;
    var field = this.component === "connect" ? "connectToken" : "token";
    var source = this.component === "connect" ? (o.getConnectToken || o.connectToken) : (o.getToken || o.token);
    if (!source) { this._fail("Pass a " + (field === "token" ? "token or getToken" : "connectToken or getConnectToken") + " from your server."); return; }
    resolve(source).then(function (t) {
      var msg = { type: "init", appearance: lookFor(o.appearance) };
      if (typeof o.tabs === "string") msg.tabs = o.tabs.slice(0, 60); // workspace only: which tabs to show
      msg[field] = t;
      self._send(msg);
    }, function (err) { self._fail(err && err.message ? err.message : "Could not get a token from your server."); });
  };

  Screen.prototype._fail = function (message) {
    if (this.options.onError) this.options.onError({ message: message });
    else if (global.console) console.error("[Outreach] " + message);
  };

  Screen.prototype._message = function (ev) {
    if (!this.frame || ev.source !== this.frame.contentWindow || ev.origin !== this.client.host) return;
    var d = ev.data;
    if (!d || d.source !== "outreach-embed") return;
    var o = this.options, self = this;
    this.heard = true;
    clearTimeout(this._wait);
    if (d.type === "ready") this._init();
    else if (d.type === "ready-ui") { this.ready = true; this._watch(); if (o.onReady) o.onReady(d); }
    else if (d.type === "token-needed") {
      resolve(o.getToken || o.token).then(function (t) { self._send({ type: "token", token: t }); }, function () {});
    } else if (d.type === "connected") { if (o.onConnected) o.onConnected({ linkId: d.linkId, externalId: d.externalId, mode: d.mode, code: d.code }); }
    else if (d.type === "session-ended") { if (o.onSessionEnded) o.onSessionEnded(d); }
    else if (d.type === "error") this._fail(d.message || "Something went wrong.");
    else if (d.type === "event") { if (o.onEvent) o.onEvent({ name: d.name, data: d.data }); }
  };

  // Inline: the screen sits inside your element.
  Screen.prototype.mount = function (target) {
    var node = typeof target === "string" ? document.querySelector(target) : target;
    if (!node) { this._fail("mount: no element matches " + target); return this; }
    this._build(node, this.options.height || "640px");
    return this;
  };

  // Popup or side panel over your page.
  Screen.prototype.open = function (opts) {
    opts = opts || {};
    if (this.overlay) return this;
    var self = this, drawer = opts.mode === "drawer", right = opts.side !== "left";
    var overlay = el("div", "position:fixed;inset:0;z-index:2147483000;background:rgba(15,23,42,.45);display:flex;" +
      (drawer ? "justify-content:" + (right ? "flex-end" : "flex-start") + ";" : "align-items:center;justify-content:center;padding:3vh 3vw;"),
      { role: "dialog", "aria-modal": "true", "aria-label": "Outreach " + this.component });
    var panel = el("div", "position:relative;display:flex;flex-direction:column;background:#fff;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.3);" +
      (drawer ? "height:100%;width:" + (opts.width || "min(560px,100vw)") + ";"
              : "width:" + (opts.width || "min(1100px,100%)") + ";height:" + (opts.height || "min(760px,100%)") + ";border-radius:12px;"));
    // Its own bar, so the close button never sits on top of the screen's header (notifications, tabs, account menu).
    var bar = el("div", "flex:0 0 44px;display:flex;align-items:center;gap:8px;padding:0 8px 0 16px;background:#fff;border-bottom:1px solid #E3E6EB;font:600 13px/1 system-ui,-apple-system,'Segoe UI',sans-serif;color:#111827;");
    var title = el("span", "flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;");
    title.textContent = this.options.title || TITLES[this.component] || "Outreach";
    var close = el("button", "flex:0 0 auto;width:32px;height:32px;border:0;border-radius:8px;background:transparent;cursor:pointer;font:22px/1 system-ui;color:#4B5563;",
      { type: "button", "aria-label": "Close" });
    close.textContent = "\u00d7"; // an escape, so a page without a UTF-8 charset still shows a cross
    close.onmouseenter = function () { close.style.background = "#F1F3F6"; };
    close.onmouseleave = function () { close.style.background = "transparent"; };
    close.onclick = function () { self.close(); };
    bar.appendChild(title);
    bar.appendChild(close);
    panel.appendChild(bar);
    overlay.appendChild(panel);
    overlay.addEventListener("mousedown", function (e) { if (e.target === overlay) self.close(); });
    this._esc = function (e) { if (e.key === "Escape") self.close(); };
    document.addEventListener("keydown", this._esc);
    this._prevFocus = document.activeElement;
    document.body.appendChild(overlay);
    this.overlay = overlay;
    this._build(panel, "fill");
    close.focus();
    return this;
  };

  // With appearance "auto", keep following the page: its theme class or colour scheme changes, we send the new look.
  Screen.prototype._unwatch = function () {};
  Screen.prototype._watch = function () {
    var a = this.options.appearance, self = this;
    this._unwatch();
    if (!(a === "auto" || (a && typeof a === "object" && a.auto))) return;
    var timer = null, last = JSON.stringify(lookFor(a));
    function check() {
      clearTimeout(timer);
      timer = setTimeout(function () {
        var now = lookFor(self.options.appearance), text = JSON.stringify(now);
        if (text !== last) { last = text; self._send({ type: "appearance", appearance: now }); }
      }, 250);
    }
    var mo = typeof MutationObserver !== "undefined" ? new MutationObserver(check) : null;
    if (mo) {
      var watch = { attributes: true, attributeFilter: ["class", "style", "data-theme", "data-bs-theme", "data-mode"] };
      mo.observe(document.documentElement, watch);
      mo.observe(document.body, watch);
    }
    var mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
    if (mq && mq.addEventListener) mq.addEventListener("change", check);
    this._unwatch = function () {
      clearTimeout(timer);
      if (mo) mo.disconnect();
      if (mq && mq.removeEventListener) mq.removeEventListener("change", check);
      self._unwatch = function () {};
    };
  };

  Screen.prototype.close = function () {
    clearTimeout(this._wait);
    this.heard = false;
    this._unwatch();
    if (this.overlay) {
      document.removeEventListener("keydown", this._esc);
      this.overlay.remove();
      this.overlay = null;
      if (this._prevFocus && this._prevFocus.focus) this._prevFocus.focus();
    } else if (this.frame) {
      this.frame.remove();
    }
    this.frame = null;
    this.ready = false;
    if (this.options.onClose) this.options.onClose();
    return this;
  };

  // Change the look without reloading the screen.
  Screen.prototype.update = function (opts) {
    if (opts && opts.appearance) { this.options.appearance = opts.appearance; this._send({ type: "appearance", appearance: lookFor(opts.appearance) }); this._watch(); }
    return this;
  };

  Screen.prototype.destroy = function () {
    window.removeEventListener("message", this._onMessage);
    this.close();
  };

  function Client(clientId, config) {
    if (!clientId || String(clientId).indexOf("pk_") !== 0) throw new Error("Outreach: pass your publishable key (pk_...).");
    this.clientId = clientId;
    this.host = ((config && config.host) || DEFAULT_HOST).replace(/\/+$/, "");
    if (!this.host) throw new Error("Outreach: load embed.js from your Outreach host, or pass { host }.");
  }
  Client.prototype.create = function (component, options) {
    if (!COMPONENTS[component]) throw new Error("Outreach: unknown screen '" + component + "'. Use workspace, leadgen, leads, campaigns, mail, voice, social or account.");
    return new Screen(this, component, options);
  };
  // Links one of your users to an Outreach account. `connectToken` comes from your server.
  Client.prototype.connect = function (options) { return new Screen(this, "connect", options); };
  // A full page: the screen replaces your page (or opens in a new tab with { newTab: true }).
  Client.prototype.redirect = function (component, options) {
    options = options || {};
    if (!COMPONENTS[component]) throw new Error("Outreach: unknown screen '" + component + "'.");
    var self = this;
    return resolve(options.getToken || options.token).then(function (t) {
      var frag = "token=" + encodeURIComponent(t);
      if (options.appearance) frag += "&appearance=" + encodeURIComponent(JSON.stringify(options.appearance));
      var url = self.host + "/embed/" + component + "?client_id=" + encodeURIComponent(self.clientId) + "#" + frag;
      if (options.newTab) window.open(url, "_blank", "noopener"); else window.location.assign(url);
    });
  };

  global.Outreach = function (clientId, config) { return new Client(clientId, config); };

  // ── One-tag mode ─────────────────────────────────────────────────────────────────────────────────────────
  // <script src=".../embed.js" data-key="pk_..." data-pass="/outreach-start"> turns every [data-outreach] tag into a screen.
  var tag = { client: null, pass: "", appearance: undefined, script: script };
  if (script && script.getAttribute && script.getAttribute("data-key")) {
    try {
      tag.client = new Client(script.getAttribute("data-key"), { host: script.getAttribute("data-host") || undefined });
      tag.pass = script.getAttribute("data-pass") || "";
    } catch (err) { if (global.console) console.error("[Outreach] " + err.message); }
  }

  // Ask the partner's own server for a pass. Says in plain words what is wrong when the answer is not one.
  function getPass(passUrl, component) {
    var url = passUrl + (passUrl.indexOf("?") < 0 ? "?" : "&") + "component=" + encodeURIComponent(component);
    return fetch(url, { cache: "no-store", credentials: "same-origin" }).then(function (r) {
      return r.text().then(function (text) {
        var d = null;
        try { d = JSON.parse(text); } catch (e) { /* not JSON: explained below */ }
        if (d && (d.token || d.connect_token)) return d;
        var why = d && d.error ? d.error
          : /<html|<!doctype/i.test(text) ? "your app answered with its own web page, so the pass route is not added yet (see STEP 3 in START-HERE.txt)"
          : "it answered " + r.status + (text ? " with text that is not a pass" : " with nothing");
        throw new Error(passUrl + ": " + why);
      });
    });
  }

  function say(node, message) {
    if (global.console) console.error("[Outreach] " + message);
    if (!node) return;
    var note = node.querySelector ? node.querySelector("[data-outreach-note]") : null;
    if (!note) {
      note = el("div", "margin:8px 0;padding:10px 12px;border:1px solid #E5B4B4;border-radius:8px;background:#FDF2F2;color:#8A1F1F;font:13px/1.4 system-ui,-apple-system,'Segoe UI',sans-serif;", { role: "alert", "data-outreach-note": "1" });
      if (/^(div|section|main|aside)$/i.test(node.tagName)) node.appendChild(note); else node.parentNode.insertBefore(note, node.nextSibling);
    }
    note.textContent = "Outreach could not open this screen. " + message;
  }

  // ── The look, from data-* attributes ───────────────────────────────────────────────────────────────────────
  var LOOK_ATTRS = { accent: "colorPrimary", bg: "colorBackground", surface: "colorSurface", text: "colorText", danger: "colorDanger",
    sidebar: "colorSidebar", "sidebar-text": "colorSidebarText", radius: "borderRadius", font: "fontFamily", name: "brandName", logo: "logoUrl" };
  function readLook(node, into) {
    if (!node || !node.getAttribute) return;
    for (var a in LOOK_ATTRS) {
      var v = node.getAttribute("data-" + a);
      if (v === null || v === "") continue;
      into[LOOK_ATTRS[a]] = a === "radius" ? Number(v) : v;
    }
  }
  // What a screen is given as `appearance`: the script tag's look, then the screen's own tag on top. The Outreach side checks every value.
  function tagLook(node) {
    var vars = {};
    readLook(tag.script, vars);
    readLook(node, vars);
    var auto = (node && node.getAttribute && node.getAttribute("data-appearance")) || (tag.script && tag.script.getAttribute("data-appearance"));
    if (auto === "auto") return { auto: {}, variables: vars };
    for (var k in vars) return { variables: vars };
    return undefined;
  }

  // ── Connecting from the page alone: one click, a small Outreach window, then the screen ─────────────────────
  var sessions = {};
  function runApi(client, action, data) {
    var body = { plugin: "auth", action: action, data: Object.assign({ client_id: client.clientId }, data) };
    return fetch(client.host + "/api/v1/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) {
          if (!r.ok) {
            var m = (d && d.error && d.error.message) || (d && d.message) || (d && typeof d.detail === "string" ? d.detail : "");
            throw new Error(m || "Outreach answered " + r.status + ".");
          }
          return d;
        });
      });
  }
  function save(client, component, d) {
    sessions[client.clientId + ":" + component] = { token: d.token, expires: (d.expires_at || 0) * 1000 };
  }
  function currentToken(client, component) {
    var s = sessions[client.clientId + ":" + component];
    if (!s) return Promise.reject(new Error("Not connected."));
    if (s.expires - Date.now() > 60000) return Promise.resolve(s.token);
    return runApi(client, "refresh", { token: s.token }).then(function (d) { save(client, component, d); return d.token; });
  }
  var BTN = "cursor:pointer;border:0;border-radius:8px;padding:10px 16px;background:#2f5be0;color:#fff;font:600 14px/1 system-ui,-apple-system,'Segoe UI',sans-serif;";

  // The window must open from the click itself or the browser blocks it, so it opens first and is pointed at Outreach after.
  function openPopup(client, component, say, done) {
    var win = window.open("", "outreach-connect", "width=460,height=700,menubar=no,toolbar=no");
    if (!win) { say("Your browser blocked the sign-in window. Allow pop-ups for this site and click again."); return; }
    var finished = false, watch = null;
    function stop() { finished = true; clearInterval(watch); window.removeEventListener("message", onMsg); }
    function onMsg(ev) {
      if (ev.origin !== client.host || ev.source !== win) return;
      var d = ev.data;
      if (!d || d.source !== "outreach-popup" || d.type !== "code" || typeof d.code !== "string") return;
      stop();
      runApi(client, "exchange", { code: d.code }).then(function (out) { save(client, component, out); done(out); },
        function (err) { say(err.message); });
    }
    window.addEventListener("message", onMsg);
    watch = setInterval(function () { if (win.closed && !finished) { stop(); say("The sign-in window was closed. Click Connect to try again."); } }, 600);
    runApi(client, "connect", { component: component }).then(function (d) {
      win.location.href = client.host + "/embed/connect?state=" + encodeURIComponent(d.state);
    }, function (err) { stop(); try { win.close(); } catch (e) { /* already closed */ } say(err.message); });
  }

  // The sign-in screen inside your page: it takes the place of the screen (or opens over the page when the screen itself is a popup).
  function connectInline(client, component, node, mode, say, done) {
    runApi(client, "connect", { component: component }).then(function (d) {
      var link = client.connect({
        connectToken: d.state, height: "560px",
        onError: function (e) { say(e.message); },
        onConnected: function (info) {
          if (!info.code) return;
          runApi(client, "exchange", { code: info.code }).then(function (out) { save(client, component, out); link.destroy(); done(out); },
            function (err) { say(err.message); });
        },
      });
      if (mode === "inline") link.mount(node); else link.open({ mode: mode === "drawer" ? "drawer" : "modal", side: "right" });
    }, function (err) { say(err.message); });
  }

  // The whole window goes to Outreach and comes back to this page with a one-time code in the address (taken below, on load).
  function connectPage(client, component, say) {
    runApi(client, "connect", { component: component, return_url: window.location.href.split("#")[0] }).then(function (d) {
      window.location.assign(client.host + "/embed/connect?state=" + encodeURIComponent(d.state));
    }, function (err) { say(err.message); });
  }

  function showByPopup(node, component, opts, client) {
    var mode = opts.mode || "inline", look = opts.appearance || tagLook(node);
    var find = opts.find || (node && node.getAttribute && node.getAttribute("data-find")) || "", screen = null;
    var screenOptions = {
      height: opts.height, appearance: look,
      tabs: opts.tabs || (node && node.getAttribute && node.getAttribute("data-tabs")) || "",
      onReady: function () { if (find && screen) screen._send({ type: "find", company: String(find).slice(0, 120) }); },
      getToken: function () { return currentToken(client, component); },
      onError: function (e) { say(node, e.message); },
    };
    function launch() {
      if (mode === "page") return client.redirect(component, { getToken: screenOptions.getToken, appearance: look, newTab: !!opts.newTab });
      screen = client.create(component, screenOptions);
      if (mode === "popup" || mode === "modal") screen.open({ mode: "modal" });
      else if (mode === "drawer") screen.open({ mode: "drawer", side: opts.side || "right" });
      else screen.mount(node);
      return screen;
    }
    var have = sessions[client.clientId + ":" + component];
    if (have && have.expires - Date.now() > 60000) return Promise.resolve(launch());
    return new Promise(function (resolve) {
      var btn = null;
      var tell = function (m) { say(node, m); };
      var login = (node && node.getAttribute && node.getAttribute("data-login")) || (tag.script && tag.script.getAttribute("data-login")) || "popup";
      var after = function () { if (btn && btn.parentNode) btn.remove(); resolve(launch()); };
      var connect = function () {
        if (login === "page") connectPage(client, component, tell);
        else if (login === "inline") { if (btn && btn.parentNode) btn.remove(); connectInline(client, component, node, mode, tell, after); }
        else openPopup(client, component, tell, after);
      };
      // A screen opened from your own button is already a click: connect right away. An inline panel gets its own button.
      if (mode !== "inline") { connect(); return; }
      btn = el("button", BTN, { type: "button" });
      btn.textContent = ((node && node.getAttribute && node.getAttribute("data-connect-label")) || (tag.script && tag.script.getAttribute("data-connect-label")) || "Connect Outreach").slice(0, 80);
      btn.onclick = connect;
      node.appendChild(btn);
    });
  }

  // Show one screen. node: where it goes (inline) or what was clicked. opts: { mode, height, side, newTab, appearance }.
  // mode: "inline" (default), "popup", "drawer" or "page". Returns a promise of the screen.
  function show(node, component, opts) {
    opts = opts || {};
    var client = opts.client || tag.client, passUrl = opts.pass || tag.pass, mode = opts.mode || "inline";
    if (!client) { say(node, 'Add data-key="pk_..." to the embed.js script tag.'); return Promise.resolve(null); }
    if (!COMPONENTS[component] || component === "connect") { say(node, "Unknown screen '" + component + "'. Use workspace, leadgen, leads, campaigns, mail, voice, social or account."); return Promise.resolve(null); }
    if (node && node.querySelector) { var old = node.querySelector("[data-outreach-note]"); if (old) old.remove(); }
    if (!passUrl) return showByPopup(node, component, opts, client);
    return getPass(passUrl, component).then(function (d) {
      if (d.connect_token) {
        // This person has no linked Outreach account yet: link one, then show the screen they asked for.
        return new Promise(function (resolve) {
          var link = client.connect({
            connectToken: d.connect_token,
            onConnected: function () { link.close(); resolve(show(node, component, opts)); },
            onError: function (e) { say(node, e.message); resolve(null); },
          });
          link.open({ mode: "modal" });
        });
      }
      var first = d.token;
      var screenOptions = {
        height: opts.height,
        appearance: opts.appearance || tagLook(node),
        tabs: opts.tabs || (node && node.getAttribute && node.getAttribute("data-tabs")) || "",
        // The first pass is the one just fetched; later ones (after it runs out) are fetched fresh.
        getToken: function () {
          if (first) { var t = first; first = null; return Promise.resolve(t); }
          return getPass(passUrl, component).then(function (x) {
            if (!x.token) throw new Error("Your server did not return a token.");
            return x.token;
          });
        },
        onError: function (e) { say(node, e.message); },
      };
      if (mode === "page") return client.redirect(component, { getToken: screenOptions.getToken, appearance: screenOptions.appearance, newTab: !!opts.newTab });
      var screen = client.create(component, screenOptions);
      if (mode === "popup" || mode === "modal") screen.open({ mode: "modal" });
      else if (mode === "drawer") screen.open({ mode: "drawer", side: opts.side || "right" });
      else screen.mount(node);
      return screen;
    }).catch(function (err) { say(node, err && err.message ? err.message : "Something went wrong."); return null; });
  }

  // Turn every [data-outreach] tag that has not been set up yet into a screen (inline) or a button that opens one.
  function scan(root) {
    if (!tag.client) return;
    var nodes = (root || document).querySelectorAll("[data-outreach]");
    for (var i = 0; i < nodes.length; i++) {
      (function (node) {
        if (node.__outreachReady) return;
        node.__outreachReady = true;
        var component = node.getAttribute("data-outreach"), mode = node.getAttribute("data-mode") || "inline";
        var opts = { mode: mode, height: node.getAttribute("data-height") || undefined, side: node.getAttribute("data-side") || undefined, newTab: node.hasAttribute("data-new-tab") };
        if (mode === "inline") show(node, component, opts);
        else node.addEventListener("click", function (e) { e.preventDefault(); show(node, component, opts); });
      })(nodes[i]);
    }
  }

  // ── Your data and actions from your own code ────────────────────────────────────────────────────────────
  var API_PASS = "api"; // one sign-in covers the actions of every plugin
  // A pass for one screen's actions: the one already held, or a sign-in (a window can only open from a click, so call this from a click).
  function pass(client, component) {
    var have = sessions[client.clientId + ":" + component];
    if (have && have.expires - Date.now() > 60000) return Promise.resolve(have.token);
    if (have) return currentToken(client, component);
    return new Promise(function (resolve, reject) {
      openPopup(client, component, function (m) { reject(new Error(m)); }, function () { currentToken(client, component).then(resolve, reject); });
    });
  }
  function clientOf(opts) {
    var c = (opts && opts.client) || tag.client;
    if (!c) throw new Error('Outreach: add data-key="pk_..." to the embed.js script tag.');
    return c;
  }
  // Outreach.run("leads", "list.list", { ... }, { id: "..." }) -> the answer, or an Error that says what is wrong.
  function run(plugin, action, data, opts) {
    opts = opts || {};
    var client;
    try { client = clientOf(opts); } catch (e) { return Promise.reject(e); }
    var component = opts.screen || API_PASS;
    return pass(client, component).then(function (token) {
      var body = { plugin: plugin, action: action, data: data || {} };
      if (opts.id) body.id = opts.id;
      return fetch(client.host + "/api/v1/run", { method: "POST", cache: "no-store", body: JSON.stringify(body),
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token } }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) {
          if (!r.ok) {
            var e = new Error((d && d.error && d.error.message) || (d && d.message) || "Outreach answered " + r.status + ".");
            e.status = r.status; e.code = (d && d.error && d.error.code) || (d && d.code) || "";
            throw e;
          }
          return d;
        });
      });
    });
  }
  // Outreach.import(records, { list: "Name" }): your contacts or companies into the person's account (and into a list, if you name one).
  // Each record: { name (required), email, phone, website, contact_name, contact_title, industry, region, notes }.
  function importRecords(records, opts) {
    opts = opts || {};
    var rows = (records || []).filter(function (r) { return r && String(r.name || "").trim(); });
    if (!rows.length) return Promise.reject(new Error("Outreach.import: send records with a name."));
    var chunks = [];
    for (var i = 0; i < rows.length; i += 500) chunks.push(rows.slice(i, i + 500));
    var ids = [], added = 0, skipped = 0, simulated = false;
    return chunks.reduce(function (chain, part) {
      return chain.then(function () {
        return run("leads", "lead.add", { leads: part }, opts).then(function (d) {
          added += d.added || 0; skipped += d.skipped || 0;
          (d.data || []).forEach(function (a) { if (a && a.id) { ids.push(a.id); if (/^lead_test_/.test(a.id)) simulated = true; } });
        });
      });
    }, Promise.resolve()).then(function () {
      if (!opts.list || !ids.length || simulated) return { added: added, skipped: skipped, list: null, simulated: simulated };
      return run("leads", "list.create", { name: String(opts.list).slice(0, 80), ids: ids }, opts).then(function (l) {
        return { added: added, skipped: skipped, list: l, simulated: false };
      });
    });
  }
  function openScreen(component, opts) {
    opts = opts || {};
    return show(null, component, Object.assign({ mode: "popup" }, opts));
  }

  global.Outreach.run = run;
  global.Outreach.import = importRecords;
  global.Outreach.connect = function (component, opts) { return pass(clientOf(opts), component || API_PASS).then(function () { return { connected: true }; }); };
  global.Outreach.open = openScreen;
  global.Outreach.find = function (company, opts) { return openScreen("leadgen", Object.assign({}, opts || {}, { find: company })); };
  global.Outreach.show = show;
  global.Outreach.scan = scan;
  // Back from a whole-window sign-in: trade the code in the address for a token before the screens are set up.
  var back = Promise.resolve();
  var returned = /[#&]outreach_code=([^&]+)/.exec(window.location.hash || "");
  if (returned && tag.client) {
    var oneTime = decodeURIComponent(returned[1]);
    try { window.history.replaceState(null, "", window.location.pathname + window.location.search); } catch (e) { /* the code stays in the bar, but works once */ }
    back = runApi(tag.client, "exchange", { code: oneTime }).then(function (out) { save(tag.client, out.component, out); }, function () { /* a stale code: the Connect button shows */ });
  }
  if (tag.client && typeof document !== "undefined") {
    var go = function () {
      back.then(scan);
      // Tags a framework adds later (React, Vue, ...) are picked up as they appear.
      if (typeof MutationObserver !== "undefined") {
        var timer = null;
        new MutationObserver(function () { clearTimeout(timer); timer = setTimeout(function () { scan(); }, 50); }).observe(document.body, { childList: true, subtree: true });
      }
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", go); else go();
  }
})(window);
