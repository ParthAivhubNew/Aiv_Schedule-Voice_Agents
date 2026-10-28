/*! Outreach embed loader. Put Outreach screens inside your own software.
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
/* global window, document, URL, console, getComputedStyle, MutationObserver, setTimeout, clearTimeout */
(function (global) {
  "use strict";
  var script = document.currentScript;
  var DEFAULT_HOST = script && script.src ? new URL(script.src).origin : "";
  var COMPONENTS = { leads: 1, campaigns: 1, mail: 1, voice: 1, social: 1, connect: 1 };

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

  var TITLES = { leads: "Leads", campaigns: "Email campaigns", mail: "Mail", voice: "Voice", social: "Social", connect: "Connect your account" };

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
    } else if (d.type === "connected") { if (o.onConnected) o.onConnected({ linkId: d.linkId, externalId: d.externalId, mode: d.mode }); }
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
    if (!COMPONENTS[component]) throw new Error("Outreach: unknown screen '" + component + "'. Use leads, campaigns, mail, voice or social.");
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
})(window);
