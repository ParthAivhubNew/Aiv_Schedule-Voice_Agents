import React, { useState } from "react";
import { api } from "../../api/apiClient";
import { C, FONT_BODY } from "../../tokens";

// Where each key is saved. Google Places has no entry: only the platform holds that one.
export const OWN_KEY_TARGET = { key_openai: "openai", key_deepseek: "deepseek", key_tavily: "tavily", key_apollo: "apollo" };

const text = { fontFamily: FONT_BODY };

// Lets an organisation check, replace or remove its own key. The key is tested before it is saved and is never shown again.
export function OwnKeyForm({ connector, source, onChanged }) {
  const target = OWN_KEY_TARGET[connector.id];
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState(null); // { ok, text }
  if (!target) return null;

  const run = async (kind, fn, okText) => {
    setBusy(kind);
    setNote(null);
    try {
      const res = await fn();
      setNote({ ok: true, text: (kind === "test" && res?.details) || okText });
      if (kind !== "test") {
        setValue("");
        onChanged?.();
      }
    } catch (e) {
      setNote({ ok: false, text: e?.message || "That did not work. Try again." });
    } finally {
      setBusy("");
    }
  };

  const save = () => run("save", () => api.saveOwnKey(target, { api_key: value.trim() }), "Key checked and saved. It is used from now on.");
  const test = () => run("test", () => api.testOwnKey(target, { api_key: value.trim() }), "The key works.");
  const remove = () => run("remove", () => api.removeOwnKey(target), "Your key is removed.");

  const btn = (primary) => ({ ...text, minHeight: 36, padding: "0 14px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: busy ? "wait" : "pointer", border: `1px solid ${primary ? C.teal : C.border}`, background: primary ? C.teal : C.onAccent, color: primary ? C.onAccent : C.textInk, opacity: busy ? 0.7 : 1 });
  const has = value.trim().length > 0;

  return (
    <div style={{ ...text, display: "grid", gap: 10, padding: 14, border: `1px solid ${C.border}`, borderRadius: 10, background: C.surface }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>{source === "own" ? "Your own key" : "Use your own key instead"}</div>
      <label style={{ display: "grid", gap: 4, fontSize: 12, fontWeight: 600, color: C.slate }}>
        {source === "own" ? "Paste a new key to replace it" : "API key"}
        <input type="password" className="ui-input" autoComplete="off" spellCheck={false} value={value} onChange={(e) => setValue(e.target.value)}
          placeholder={source === "own" ? "•••••••• saved. Leave blank to keep it" : "Paste your key"} style={{ fontSize: 13, height: 38 }} />
      </label>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" style={btn(true)} disabled={!has || !!busy} onClick={save}>{busy === "save" ? "Checking…" : "Test and save"}</button>
        {source === "own" || has ? <button type="button" style={btn(false)} disabled={!!busy} onClick={test}>{busy === "test" ? "Testing…" : source === "own" && !has ? "Test saved key" : "Test only"}</button> : null}
        {source === "own" ? <button type="button" style={{ ...btn(false), color: C.red }} disabled={!!busy} onClick={remove}>{busy === "remove" ? "Removing…" : "Remove my key"}</button> : null}
      </div>
      {note ? <div role="status" aria-live="polite" style={{ fontSize: 12.5, fontWeight: 600, color: note.ok ? C.successInk : C.red }}>{note.text}</div> : null}
      <div style={{ fontSize: 12, color: C.slate }}>The key is tested first, kept sealed and never shown again.{source === "own" ? " Removing it goes back to the platform's key." : ""}</div>
    </div>
  );
}
