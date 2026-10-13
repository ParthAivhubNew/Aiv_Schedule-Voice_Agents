import React, { useMemo, useState } from "react";
import { Phone, Users, Megaphone, Wallet, Search, Copy, Check, Send, AlertCircle } from "lucide-react";
import { C, FONT_DISPLAY, FONT_MONO } from "../tokens";
import { API_BASE, ENDPOINTS, RUN_ACTIONS, endpointKey, pluginAction, defaultData } from "./developerCatalog";
import { buildSnippet } from "./developerSnippets";

// "Build and test a request": pick an area, pick a step, fill in the details, send it as POST /v1/run, copy the code.
// The steps come from the same catalogue as the Documentation tab, so the two never disagree.

const AREAS = [
  { id: "voice", name: "Phone calls and meetings", short: "Call people with an AI agent, book meetings", color: "#3457D5", icon: Phone },
  { id: "leads", name: "Leads and email", short: "Find companies, run email campaigns", color: "#0C8C7D", icon: Users },
  { id: "social", name: "Social posts", short: "Write, approve and schedule posts", color: "#C2410C", icon: Megaphone },
  { id: "account", name: "Account", short: "Your balance and setup", color: "#6D4BD8", icon: Wallet },
];

const PERMISSION = {
  "voice:calls": "Phone calls and meetings",
  "calendar:book": "Phone calls and meetings",
  "leads:search": "Leads and email campaigns",
  "email:write": "Leads and email campaigns",
  "email:approve": "Leads and email campaigns",
  "social:write": "Social posts",
  "social:approve": "Social posts",
  "any key": "Balance and setup (read only)",
};

const LANGS = [
  ["curl", "cURL"],
  ["node", "Node.js"],
  ["python", "Python"],
  ["php", "PHP"],
  ["go", "Go"],
  ["java", "Java"],
];

const STEPS = ENDPOINTS.filter((ep) => RUN_ACTIONS[endpointKey({ method: ep.method, path: ep.path.split("?")[0] })]).map((ep) => ({
  ...pluginAction(ep),
  ep,
  title: ep.title,
  summary: ep.summary,
  needsId: Boolean(ep.pathParam),
  isRead: ep.method === "GET",
  permission: PERMISSION[ep.scope] || ep.scope,
}));

const stepId = (s) => `${s.plugin}.${s.action}`;

const parseData = (text) => {
  try {
    const v = JSON.parse((text || "").trim() || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
};

const box = { border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, backgroundColor: "#fff" };
const heading = { fontSize: 12.5, fontWeight: 700, color: C.textInk, marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 };
const codeBox = { margin: 0, backgroundColor: "#0F172A", color: "#E2E8F0", borderRadius: 10, padding: 12, fontFamily: FONT_MONO, fontSize: 11.5, lineHeight: 1.5, overflow: "auto", maxHeight: 260, whiteSpace: "pre" };
const smallBtn = { background: "#fff", border: `1px solid ${C.border}`, borderRadius: 6, padding: "3px 9px", fontSize: 11, fontWeight: 600, cursor: "pointer", color: C.textInk, display: "inline-flex", alignItems: "center", gap: 4 };

export function BuildTestPanel({ apiKey, onApiKeyChange }) {
  const [area, setArea] = useState("voice");
  const [search, setSearch] = useState("");
  const [cur, setCur] = useState(STEPS[0]);
  const [idValue, setIdValue] = useState("");
  const [dataText, setDataText] = useState(defaultData(STEPS[0].ep));
  const [jsonMode, setJsonMode] = useState(false);
  const [lang, setLang] = useState("curl");
  const [sending, setSending] = useState(false);
  const [response, setResponse] = useState(null);
  const [copied, setCopied] = useState("");

  const keyIsMasked = Boolean(apiKey) && apiKey.includes("...");
  const keyReady = Boolean(apiKey.trim()) && !keyIsMasked;
  const isTest = apiKey.trim().startsWith("sk_test_");

  const pick = (step) => {
    setCur(step);
    setArea(step.plugin);
    setIdValue("");
    setDataText(defaultData(step.ep));
    setJsonMode(false);
    setResponse(null);
  };

  const data = useMemo(() => parseData(dataText), [dataText]);
  const dataValid = useMemo(() => {
    try {
      JSON.parse((dataText || "").trim() || "{}");
      return true;
    } catch {
      return false;
    }
  }, [dataText]);

  const request = useMemo(() => {
    const r = { plugin: cur.plugin, action: cur.action };
    if (cur.needsId) r.id = idValue.trim() || cur.ep.pathParam.example;
    if (Object.keys(data).length) r.data = data;
    return r;
  }, [cur, idValue, data]);
  const requestText = JSON.stringify(request, null, 2);

  const fields = Object.entries(data).filter(([, v]) => typeof v === "string" || typeof v === "number");
  const hasComplex = Object.values(data).some((v) => v !== null && typeof v === "object");

  const visibleSteps = search.trim()
    ? STEPS.filter((s) => `${s.title} ${s.action} ${s.summary} ${s.plugin}`.toLowerCase().includes(search.trim().toLowerCase()))
    : STEPS.filter((s) => s.plugin === area);

  const setField = (key, value) => {
    const original = data[key];
    const next = { ...data, [key]: typeof original === "number" && value !== "" && !Number.isNaN(Number(value)) ? Number(value) : value };
    setDataText(JSON.stringify(next, null, 2));
  };

  const copy = (text, which) => {
    navigator.clipboard.writeText(text);
    setCopied(which);
    setTimeout(() => setCopied(""), 1800);
  };

  const send = async () => {
    if (!keyReady) {
      setResponse({ status: 401, statusText: "Key needed", ok: false, durationMs: 0, data: { error: { code: "key_needed", message: "Paste your full secret key above (it starts with sk_test_ or sk_live_). Saved keys only show their first letters, which cannot be used." } } });
      return;
    }
    if (!dataValid) return;
    setSending(true);
    setResponse(null);
    const started = performance.now();
    try {
      const res = await fetch("/v1/run", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey.trim()}` },
        body: requestText,
      });
      let body;
      try {
        body = await res.json();
      } catch {
        body = "(not JSON: the answer may be a file, such as a recording)";
      }
      setResponse({ status: res.status, statusText: res.statusText, ok: res.ok, durationMs: Math.round(performance.now() - started), data: body });
    } catch (err) {
      setResponse({ status: 0, statusText: "Network error", ok: false, durationMs: Math.round(performance.now() - started), data: { error: { code: "network_error", message: err.message || "Could not reach the API." } } });
    } finally {
      setSending(false);
    }
  };

  const area_ = AREAS.find((a) => a.id === cur.plugin) || AREAS[0];
  const code = buildSnippet(lang, "POST", "/v1/run", apiKey.trim() && !keyIsMasked ? apiKey.trim() : isTest || !apiKey ? "sk_test_YOUR_KEY" : "sk_live_YOUR_KEY", requestText);
  const readLink = cur.isRead
    ? `${API_BASE}/v1/run?plugin=${cur.plugin}&action=${cur.action}${cur.needsId ? "&id=" + (idValue.trim() || cur.ep.pathParam.example) : ""}`
    : "";

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <h3 style={{ fontFamily: FONT_DISPLAY, fontSize: 16, margin: 0, color: C.textInk, fontWeight: 700 }}>Build and test a request</h3>
        <p style={{ margin: "3px 0 0", fontSize: 12.5, color: C.slate }}>
          Choose an area, then a step. We build the request for you; send it and copy the code. Every step goes to the same address:{" "}
          <code style={{ color: C.cobalt, fontFamily: FONT_MONO }}>POST {API_BASE}/v1/run</code>
        </p>
      </div>

      {/* The shape of every request */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
        {[["plugin", "the area"], ["action", "the step"], ["id", "the thing you work on (some steps)"], ["data", "the details"]].map(([k, d]) => (
          <span key={k} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: "4px 9px", fontSize: 12, background: "#F8FAFC" }}>
            <code style={{ color: C.cobalt, fontWeight: 700, fontFamily: FONT_MONO }}>{k}</code> <span style={{ color: C.slate }}>{d}</span>
          </span>
        ))}
      </div>

      {/* Key */}
      <div style={{ ...box, backgroundColor: "#F8FAFC", marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <label style={{ fontSize: 12, fontWeight: 700, color: C.textInk }}>Your key</label>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              padding: "2px 8px",
              borderRadius: 99,
              backgroundColor: !apiKey ? "#F1F5F9" : isTest ? "#FEF3C7" : "#ECFDF5",
              color: !apiKey ? C.slate : isTest ? "#B45309" : "#059669",
            }}
          >
            {!apiKey ? "No key yet" : isTest ? "TEST: nothing real happens" : "LIVE: real calls and credits"}
          </span>
        </div>
        <input
          type="text"
          value={apiKey}
          onChange={(e) => onApiKeyChange(e.target.value)}
          placeholder="Paste your full secret key (sk_test_… or sk_live_…)"
          style={{ width: "100%", height: 36, borderRadius: 8, border: `1px solid ${keyIsMasked ? "#F59E0B" : C.border}`, padding: "0 10px", fontSize: 12, fontFamily: FONT_MONO, boxSizing: "border-box", outline: "none" }}
        />
        <div style={{ fontSize: 11.5, color: keyIsMasked ? "#B45309" : C.slateLight, marginTop: 4 }}>
          {keyIsMasked ? "That is only the start of a saved key. Paste the full secret, shown once when you created it." : "No key yet? Make one in the Active Keys tab. A test key is free."}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,250px) minmax(0,1fr)", gap: 16 }}>
        {/* Left: areas and steps */}
        <aside>
          <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>
            {AREAS.map((a) => {
              const on = area === a.id && !search.trim();
              const Icon = a.icon;
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => {
                    setSearch("");
                    pick(STEPS.find((s) => s.plugin === a.id));
                  }}
                  style={{ display: "flex", gap: 9, alignItems: "center", textAlign: "left", padding: "8px 10px", borderRadius: 10, cursor: "pointer", border: `1px solid ${on ? a.color : C.border}`, background: on ? `${a.color}14` : "#fff" }}
                >
                  <span style={{ flex: "none", width: 30, height: 30, borderRadius: 8, display: "grid", placeItems: "center", background: `${a.color}22`, color: a.color }}>
                    <Icon size={15} />
                  </span>
                  <span>
                    <span style={{ display: "block", fontSize: 12.5, fontWeight: 700, color: C.textInk }}>{a.name}</span>
                    <span style={{ display: "block", fontSize: 11, color: C.slate }}>{a.short}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <div style={{ position: "relative", marginBottom: 6 }}>
            <Search size={13} color={C.slateLight} style={{ position: "absolute", left: 9, top: 11 }} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search steps, e.g. book, post"
              style={{ width: "100%", height: 34, borderRadius: 8, border: `1px solid ${C.border}`, padding: "0 10px 0 28px", fontSize: 12, boxSizing: "border-box", outline: "none" }}
            />
          </div>
          <div style={{ display: "grid", gap: 2, maxHeight: 300, overflowY: "auto" }}>
            {visibleSteps.length === 0 && <div style={{ fontSize: 12, color: C.slate, padding: 8 }}>Nothing matches.</div>}
            {visibleSteps.map((s) => {
              const on = stepId(s) === stepId(cur);
              return (
                <button
                  key={stepId(s)}
                  type="button"
                  onClick={() => pick(s)}
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6, textAlign: "left", padding: "7px 9px", borderRadius: 8, cursor: "pointer", border: `1px solid ${on ? C.cobalt : "transparent"}`, background: on ? C.cobaltSoft : "none" }}
                >
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: C.textInk }}>{s.title}</span>
                  <span style={{ fontSize: 10.5, color: C.slate, fontFamily: FONT_MONO }}>{s.action}</span>
                </button>
              );
            })}
          </div>
        </aside>

        {/* Right: the chosen step */}
        <main style={{ minWidth: 0 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginBottom: 4 }}>
            <h4 style={{ margin: 0, fontFamily: FONT_DISPLAY, fontSize: 16, color: C.textInk }}>{cur.title}</h4>
            <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 99, background: cur.isRead ? "#F1F5F9" : C.cobaltSoft, color: cur.isRead ? C.slate : C.cobalt }}>
              {cur.isRead ? "Only reads" : "Makes a change"}
            </span>
            <span style={{ fontSize: 11, fontFamily: FONT_MONO, padding: "2px 8px", borderRadius: 99, background: `${area_.color}18`, color: area_.color }}>
              {cur.plugin} · {cur.action}
            </span>
          </div>
          <p style={{ margin: "0 0 8px", fontSize: 12.5, color: C.slate }}>{cur.summary}</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
            {[
              ["Needs permission", cur.permission],
              ["Cost", cur.isRead ? "Free" : "May use credits"],
              [null, cur.needsId ? "Works on one item: needs an id" : "No id needed"],
            ].map(([label, value], i) => (
              <span key={i} style={{ background: "#F1F5F9", borderRadius: 6, padding: "3px 9px", fontSize: 11.5, color: C.slate }}>
                {label ? `${label}: ` : ""}
                <b style={{ color: C.textInk }}>{value}</b>
              </span>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
            {/* 1. details */}
            <div style={box}>
              <div style={heading}>
                <span>1. Fill in the details</span>
                {Object.keys(data).length > 0 && (
                  <span style={{ display: "inline-flex", border: `1px solid ${C.border}`, borderRadius: 7, overflow: "hidden" }}>
                    {[["Form", false], ["JSON", true]].map(([label, mode]) => (
                      <button key={label} type="button" onClick={() => setJsonMode(mode)} style={{ border: 0, padding: "3px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer", background: jsonMode === mode ? C.cobalt : "#fff", color: jsonMode === mode ? "#fff" : C.slate }}>
                        {label}
                      </button>
                    ))}
                  </span>
                )}
              </div>
              <div style={{ display: "grid", gap: 10 }}>
                {cur.needsId && (
                  <label style={{ display: "grid", gap: 3, fontSize: 12, fontWeight: 600, color: C.textInk }}>
                    id <span style={{ fontWeight: 400, color: C.slate }}>The thing you are working on. It came back when you created it.</span>
                    <input value={idValue} onChange={(e) => setIdValue(e.target.value)} placeholder={cur.ep.pathParam.example} style={{ height: 34, borderRadius: 8, border: `1px solid ${C.border}`, padding: "0 10px", fontSize: 12, fontFamily: FONT_MONO, outline: "none" }} />
                  </label>
                )}
                {jsonMode ? (
                  <label style={{ display: "grid", gap: 3, fontSize: 12, fontWeight: 600, color: C.textInk }}>
                    data (JSON)
                    <textarea value={dataText} onChange={(e) => setDataText(e.target.value)} rows={9} spellCheck={false} style={{ borderRadius: 8, border: `1px solid ${dataValid ? C.border : "#DC2626"}`, padding: 8, fontSize: 11.5, fontFamily: FONT_MONO, outline: "none", resize: "vertical" }} />
                    {!dataValid && <span style={{ color: "#DC2626", fontWeight: 400 }}>That is not valid JSON yet.</span>}
                  </label>
                ) : fields.length > 0 ? (
                  <>
                    {fields.map(([k, v]) => (
                      <label key={k} style={{ display: "grid", gap: 3, fontSize: 12, fontWeight: 600, color: C.textInk }}>
                        {k}
                        <input value={String(v)} onChange={(e) => setField(k, e.target.value)} style={{ height: 34, borderRadius: 8, border: `1px solid ${C.border}`, padding: "0 10px", fontSize: 12, outline: "none" }} />
                      </label>
                    ))}
                    {hasComplex && <div style={{ fontSize: 11.5, color: C.slate }}>More options are available in the JSON view.</div>}
                  </>
                ) : Object.keys(data).length ? (
                  <div style={{ fontSize: 12, color: C.slate }}>This step takes more complex details. Use the JSON view.</div>
                ) : (
                  <div style={{ fontSize: 12, color: C.slate }}>This step needs no extra details.</div>
                )}
              </div>
              <button
                type="button"
                onClick={send}
                disabled={sending || !dataValid}
                style={{ marginTop: 12, display: "inline-flex", alignItems: "center", gap: 6, background: C.cobalt, color: "#fff", border: 0, borderRadius: 8, padding: "8px 14px", fontSize: 12.5, fontWeight: 700, cursor: sending || !dataValid ? "not-allowed" : "pointer", opacity: sending || !dataValid ? 0.6 : 1 }}
              >
                <Send size={13} /> {sending ? "Sending…" : isTest || !apiKey ? "Send as test request" : "Send live request"}
              </button>
            </div>

            {/* 2 + 3. what is sent, what comes back */}
            <div style={box}>
              <div style={heading}>
                <span>2. What gets sent</span>
                <button type="button" style={smallBtn} onClick={() => copy(requestText, "body")}>
                  {copied === "body" ? <Check size={11} color={C.teal} /> : <Copy size={11} />} {copied === "body" ? "Copied" : "Copy"}
                </button>
              </div>
              <pre style={{ ...codeBox, maxHeight: 200 }}>{requestText}</pre>

              <div style={{ ...heading, marginTop: 12 }}>
                <span>3. What comes back</span>
                {response && (
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: response.ok ? "#059669" : "#DC2626" }}>
                    {response.status || "ERR"} {response.statusText} · {response.durationMs} ms
                  </span>
                )}
              </div>
              <pre style={{ ...codeBox, minHeight: 70, maxHeight: 240, color: response ? "#E2E8F0" : "#94A3B8" }}>
                {response ? (typeof response.data === "string" ? response.data : JSON.stringify(response.data, null, 2)) : "Press the send button to see the answer."}
              </pre>
              {response && response.status === 402 && (
                <div style={{ marginTop: 8, display: "flex", gap: 6, fontSize: 11.5, color: "#B45309" }}>
                  <AlertCircle size={13} style={{ flex: "none", marginTop: 1 }} /> Your key works, but the account needs an active plan or more credits for this step.
                </div>
              )}
            </div>
          </div>

          {/* 4. code */}
          <div style={{ ...box, marginTop: 12 }}>
            <div style={heading}>
              <span>4. Copy the code</span>
              <span style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                {LANGS.map(([id, label]) => (
                  <button key={id} type="button" onClick={() => setLang(id)} style={{ ...smallBtn, background: lang === id ? C.cobaltSoft : "#fff", borderColor: lang === id ? C.cobalt : C.border, color: lang === id ? C.cobalt : C.slate }}>
                    {label}
                  </button>
                ))}
                <button type="button" style={smallBtn} onClick={() => copy(code, "code")}>
                  {copied === "code" ? <Check size={11} color={C.teal} /> : <Copy size={11} />} {copied === "code" ? "Copied" : "Copy code"}
                </button>
              </span>
            </div>
            <pre style={codeBox}>{code}</pre>
            {readLink && (
              <div style={{ fontSize: 11.5, color: C.slate, marginTop: 8, wordBreak: "break-all" }}>
                Because this step only reads, it can also be opened as a link: <code style={{ fontFamily: FONT_MONO }}>{readLink}</code>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
