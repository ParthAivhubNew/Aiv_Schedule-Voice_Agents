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
/* global window, document, URL, console */
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
    return a && typeof a === "object" ? a : undefined;
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

  Screen.prototype._build = function (parent, height) {
    if (this.frame) return;
    var f = el("iframe", "border:0;width:100%;height:" + height + ";display:block;background:transparent;", {
      src: this._src(), title: "Outreach " + this.component, allow: "clipboard-write; microphone",
    });
    f.setAttribute("referrerpolicy", "origin");
    parent.appendChild(f);
    this.frame = f;
    this.container = parent;
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
      var msg = { type: "init", appearance: cleanAppearance(o.appearance) };
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
    if (d.type === "ready") this._init();
    else if (d.type === "ready-ui") { this.ready = true; if (o.onReady) o.onReady(d); }
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
    var panel = el("div", "position:relative;background:#fff;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.3);" +
      (drawer ? "height:100%;width:" + (opts.width || "min(560px,100vw)") + ";"
              : "width:" + (opts.width || "min(1100px,100%)") + ";height:" + (opts.height || "min(760px,100%)") + ";border-radius:12px;"));
    var close = el("button", "position:absolute;top:8px;right:8px;z-index:2;width:32px;height:32px;border:0;border-radius:16px;background:rgba(15,23,42,.08);cursor:pointer;font:20px/1 system-ui;color:#111;",
      { type: "button", "aria-label": "Close" });
    close.textContent = "×";
    close.onclick = function () { self.close(); };
    panel.appendChild(close);
    overlay.appendChild(panel);
    overlay.addEventListener("mousedown", function (e) { if (e.target === overlay) self.close(); });
    this._esc = function (e) { if (e.key === "Escape") self.close(); };
    document.addEventListener("keydown", this._esc);
    this._prevFocus = document.activeElement;
    document.body.appendChild(overlay);
    this.overlay = overlay;
    this._build(panel, "100%");
    close.focus();
    return this;
  };

  Screen.prototype.close = function () {
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
    if (opts && opts.appearance) { this.options.appearance = opts.appearance; this._send({ type: "appearance", appearance: cleanAppearance(opts.appearance) }); }
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
