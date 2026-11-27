import React, { useState } from "react";
import { api } from "../../api/apiClient";
import { C, FONT_BODY } from "../../tokens";

const text = { fontFamily: FONT_BODY };

// What each data connector asks for. "secret" fields are never shown again after saving.
export const DATA_PROVIDER_FORMS = {
  experian: {
    title: "Connect your Experian account",
    note: "Use the details from your Experian developer account. The portal password changes every 90 days, so come back here to update it.",
    fields: [
      { key: "environment", label: "Environment", select: [["sandbox", "Sandbox (test data)"], ["live", "Live"]] },
      { key: "username", label: "Portal username" },
      { key: "password", label: "Portal password", secret: true },
      { key: "client_id", label: "Client ID" },
      { key: "client_secret", label: "Client secret", secret: true },
    ],
    consent: "My Experian contract allows its data to be used in other software.",
  },
  market_location: {
    title: "Connect your Market Location account",
    note: "Market Location gives API access by agreement. Ask your account manager for the address and key. We save them sealed but cannot test them.",
    fields: [
      { key: "base_url", label: "API address (https://…)" },
      { key: "api_key", label: "API key", secret: true },
    ],
  },
};

// The Bring Your Own AI cards. The key is tested, then saved sealed.
export const BYO_AI_IDS = new Set(["custom_rest_llm", "azure_ai_gateway", "aws_bedrock_gateway", "google_vertex_ai", "private_vllm", "custom_reasoner"]);

const field = { display: "grid", gap: 4, fontSize: 12, fontWeight: 600, color: C.slate };
const btn = (primary, busy) => ({ ...text, minHeight: 36, padding: "0 14px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: busy ? "wait" : "pointer", border: `1px solid ${primary ? "#0C8C7D" : C.border}`, background: primary ? "#0C8C7D" : "#fff", color: primary ? "#fff" : C.textInk, opacity: busy ? 0.7 : 1 });
const box = { ...text, display: "grid", gap: 10, padding: 14, border: `1px solid ${C.border}`, borderRadius: 10, background: "#fff" };

function Note({ note }) {
  return note ? <div role="status" aria-live="polite" style={{ fontSize: 12.5, fontWeight: 600, color: note.ok ? "#166534" : C.red }}>{note.text}</div> : null;
}

// Experian and Market Location: the organisation's own account details.
export function DataProviderForm({ id, status, onChanged }) {
  const spec = DATA_PROVIDER_FORMS[id];
  const [vals, setVals] = useState(() => ({ environment: "sandbox", ...(status?.fields || {}) }));
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState(null);
  if (!spec) return null;
  const connected = !!status?.connected;
  const set = (k, v) => setVals((x) => ({ ...x, [k]: v }));
  const needsConsent = !!spec.consent && !agreed && !connected;

  const save = async () => {
    setBusy("save");
    setNote(null);
    try {
      const res = await api.saveDataProvider(id, { fields: vals });
      setNote({ ok: true, text: res?.details || "Saved." });
      setVals((x) => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, spec.fields.find((f) => f.key === k)?.secret ? "" : v])));
      onChanged?.();
    } catch (e) {
      setNote({ ok: false, text: e?.message || "That did not work. Try again." });
    } finally {
      setBusy("");
    }
  };
  const remove = async () => {
    setBusy("remove");
    setNote(null);
    try {
      await api.removeDataProvider(id);
      setNote({ ok: true, text: "Disconnected." });
      onChanged?.();
    } catch (e) {
      setNote({ ok: false, text: e?.message || "That did not work." });
    } finally {
      setBusy("");
    }
  };

  return (
    <div style={box}>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>{connected ? "Your account is connected" : spec.title}</div>
      <div style={{ fontSize: 12.5, color: C.slate }}>
        {connected ? `${status.verified ? "Checked with the vendor." : "Saved, not tested."} Fill in a field only to change it.` : spec.note}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 10 }}>
        {spec.fields.map((f) => (
          <label key={f.key} style={field}>
            {f.label}
            {f.select ? (
              <select className="ui-input" value={vals[f.key] || ""} onChange={(e) => set(f.key, e.target.value)} style={{ height: 38, fontSize: 13 }}>
                {f.select.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            ) : (
              <input type={f.secret ? "password" : "text"} className="ui-input" autoComplete="off" spellCheck={false} value={vals[f.key] || ""}
                onChange={(e) => set(f.key, e.target.value)} placeholder={connected && f.secret ? "•••••••• saved" : ""} style={{ height: 38, fontSize: 13 }} />
            )}
          </label>
        ))}
      </div>
      {spec.consent && !connected ? (
        <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12.5, color: C.textInk }}>
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} style={{ marginTop: 2 }} /> {spec.consent}
        </label>
      ) : null}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" style={btn(true, !!busy)} disabled={!!busy || needsConsent} onClick={save}>{busy === "save" ? "Checking…" : connected ? "Save changes" : "Connect"}</button>
        {connected ? <button type="button" style={{ ...btn(false, !!busy), color: C.red }} disabled={!!busy} onClick={remove}>{busy === "remove" ? "Removing…" : "Disconnect"}</button> : null}
      </div>
      <Note note={note} />
    </div>
  );
}

// Bring Your Own AI: address, key and model. Tested, then saved sealed.
export function ByoAiForm({ connector, onSaved, onRemoved }) {
  const [vals, setVals] = useState({ base_url: "", api_key: "", model: "" });
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState(null);
  const connected = connector.status === "connected";
  const set = (k, v) => setVals((x) => ({ ...x, [k]: v }));

  const save = async () => {
    setBusy("save");
    setNote(null);
    try {
      const res = await api.saveOwnByo(connector.id, { api_key: vals.api_key.trim(), base_url: vals.base_url.trim(), model: vals.model.trim() });
      setNote({ ok: true, text: res?.details || "Checked and saved." });
      setVals((x) => ({ ...x, api_key: "" }));
      onSaved?.();
    } catch (e) {
      setNote({ ok: false, text: e?.message || "That did not work. Try again." });
    } finally {
      setBusy("");
    }
  };
  const remove = async () => {
    setBusy("remove");
    setNote(null);
    try {
      await api.removeOwnByo(connector.id);
      setNote({ ok: true, text: "Your key is removed." });
      onRemoved?.();
    } catch (e) {
      setNote({ ok: false, text: e?.message || "That did not work." });
    } finally {
      setBusy("");
    }
  };

  return (
    <div style={box}>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>{connected ? "Your connection" : "Connect your own AI"}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 10 }}>
        <label style={field}>Endpoint address
          <input className="ui-input" value={vals.base_url} onChange={(e) => set("base_url", e.target.value)} placeholder="https://…" style={{ height: 38, fontSize: 13 }} />
        </label>
        <label style={field}>Model or deployment name
          <input className="ui-input" value={vals.model} onChange={(e) => set("model", e.target.value)} style={{ height: 38, fontSize: 13 }} />
        </label>
        <label style={field}>API key
          <input type="password" className="ui-input" autoComplete="off" spellCheck={false} value={vals.api_key} onChange={(e) => set("api_key", e.target.value)} placeholder={connected ? "•••••••• saved" : ""} style={{ height: 38, fontSize: 13 }} />
        </label>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" style={btn(true, !!busy)} disabled={!!busy || !vals.base_url.trim() || (!connected && !vals.api_key.trim())} onClick={save}>{busy === "save" ? "Checking…" : "Test and save"}</button>
        {connected ? <button type="button" style={{ ...btn(false, !!busy), color: C.red }} disabled={!!busy} onClick={remove}>{busy === "remove" ? "Removing…" : "Remove"}</button> : null}
      </div>
      <Note note={note} />
      <div style={{ fontSize: 12, color: C.slate }}>The key is tested first, kept sealed and never shown again.</div>
    </div>
  );
}
