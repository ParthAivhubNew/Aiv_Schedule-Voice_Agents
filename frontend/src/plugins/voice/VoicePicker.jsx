import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Search, Trash2 } from "lucide-react";
import { api } from "../../api/apiClient";
import { C, FONT_BODY, FONT_MONO } from "../../tokens";

// One voice library for the whole app. Every screen that shows or changes the call voice uses
// this store and <VoicePicker>, so a change in one place shows everywhere and nothing keeps
// its own copy of the voice.

export const VOICE_CHANGED_EVENT = "aivhub_voice_changed";

let store = { lib: null, error: "", loading: false };
const listeners = new Set();

function emit(next) {
  store = { ...store, ...next };
  listeners.forEach((fn) => fn(store));
}

async function refreshLibrary() {
  if (store.loading) return;
  emit({ loading: true });
  try {
    emit({ lib: await api.getVoiceLibrary(), error: "", loading: false });
  } catch (e) {
    emit({ error: e.message || "Could not load voices.", loading: false });
  }
}

// A change made here: update every picker and tell other screens (Line setup status, stack board).
function adopt(lib) {
  emit({ lib, error: "" });
  try {
    window.dispatchEvent(new Event(VOICE_CHANGED_EVENT));
  } catch (_) {
    // Non-browser test environments.
  }
  return lib;
}

export function announceVoiceChanged() {
  refreshLibrary();
  try {
    window.dispatchEvent(new Event(VOICE_CHANGED_EVENT));
  } catch (_) {
    // Non-browser test environments.
  }
}

export function useVoiceLibrary() {
  const [state, setState] = useState(store);
  useEffect(() => {
    listeners.add(setState);
    if (!store.lib) refreshLibrary();
    const onFocus = () => refreshLibrary();
    window.addEventListener("focus", onFocus);
    return () => {
      listeners.delete(setState);
      window.removeEventListener("focus", onFocus);
    };
  }, []);
  return {
    ...state,
    refresh: refreshLibrary,
    setActive: async (kind, ref) => adopt(await api.setCallVoice(kind, ref)),
    addVoice: async (payload) => adopt(await api.addLibraryVoice(payload)),
    removeVoice: async (id) => adopt(await api.removeLibraryVoice(id)),
  };
}

const PILL = {
  ok: { bg: "#ECFDF5", border: "#A7F3D0", color: "#065F46" },
  missing: { bg: "#FFFBEB", border: "#FDE68A", color: "#92400E" },
  engine_mismatch: { bg: "#FFFBEB", border: "#FDE68A", color: "#92400E" },
  key_missing: { bg: "#FEF2F2", border: "#FECACA", color: "#991B1B" },
  invalid: { bg: "#FEF2F2", border: "#FECACA", color: "#991B1B" },
};

// Yellow: nothing picked (or it doesn't fit the engine). Green: set. Red: its key is missing.
export function VoiceStatusPill({ active, compact }) {
  const a = active || { status: "missing" };
  const look = PILL[a.status] || PILL.missing;
  const text = a.status === "ok"
    ? (a.kind === "remote" ? a.label : "Call voice: " + (a.label || a.voiceId) + (a.providerName ? " · " + a.providerName : ""))
    : a.status === "missing"
      ? "Call voice: Not configured. Pick a voice."
      : (a.label ? a.label + ": " : "") + (a.reason || "Check the voice.");
  return (
    <div role="status" data-voice-status={a.status} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: compact ? "3px 9px" : "7px 11px", borderRadius: compact ? 99 : 8, background: look.bg, border: `1px solid ${look.border}`, color: look.color, fontSize: compact ? 11.5 : 12.5, fontWeight: 700, fontFamily: FONT_BODY, maxWidth: "100%" }}>
      {a.status === "ok" ? <CheckCircle2 size={compact ? 12 : 14} /> : <AlertTriangle size={compact ? 12 : 14} />}
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{text}</span>
    </div>
  );
}

const MODE_TEXT = {
  native: "speaks with its own voices",
  tts: "speaks through a text-to-speech plugin",
  either: "speaks with its own voices or a text-to-speech plugin",
  remote: "the voice is set on the assistant at the provider",
};

function statusNote(v) {
  if (v.status === "key_missing") return v.reason;
  if (v.status === "engine_mismatch") return v.reason;
  return "";
}

// variant "full": Line setup / Connections. variant "compact": a single dropdown for Calling,
// Company profile and other places that only need to show and switch the voice.
export function VoicePicker({ variant = "full" }) {
  const { lib, error, setActive, addVoice, removeVoice } = useVoiceLibrary();
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState({ ok: true, text: "" });
  const [form, setForm] = useState({ provider: "", voiceId: "", label: "", useForCalls: true });
  const [browse, setBrowse] = useState({ provider: "", items: null, filter: "", error: "" });

  const providers = useMemo(() => (lib && lib.providers) || [], [lib]);
  useEffect(() => {
    if (!form.provider && providers.length) {
      const first = providers.find((p) => p.connected) || providers[0];
      setForm((f) => ({ ...f, provider: first.provider }));
    }
  }, [providers, form.provider]);

  const run = async (key, fn, okText) => {
    setBusy(key);
    setMsg({ ok: true, text: "" });
    try {
      await fn();
      if (okText) setMsg({ ok: true, text: okText });
      return true;
    } catch (e) {
      setMsg({ ok: false, text: e.message || "That did not work." });
      return false;
    } finally {
      setBusy("");
    }
  };

  const grouped = useMemo(() => {
    const out = {};
    ((lib && lib.voices) || []).forEach((v) => {
      (out[v.provider] = out[v.provider] || []).push(v);
    });
    return out;
  }, [lib]);

  if (!lib) {
    return <div style={{ fontSize: 12.5, color: error ? C.red : C.slate }}>{error || "Loading voices…"}</div>;
  }
  const active = lib.active || { status: "missing" };
  const remote = lib.mode === "remote";
  const canBuiltin = (lib.builtins || []).length > 0;
  const canPlugin = lib.mode === "tts" || lib.mode === "either";

  if (variant === "compact") {
    const value = active.kind === "builtin" ? "builtin:" + active.voiceId : active.kind === "library" && active.id ? "library:" + active.id : "";
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6, fontFamily: FONT_BODY }}>
        {remote ? null : (
          <select
            aria-label="Call voice"
            value={value}
            disabled={!!busy}
            onChange={(e) => {
              const [kind, ...rest] = e.target.value.split(":");
              if (kind) run("pick", () => setActive(kind, rest.join(":")), "");
            }}
            style={{ width: "100%", boxSizing: "border-box", height: 38, padding: "0 10px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13, background: "#fff", color: C.ink }}
          >
            <option value="">{value ? "" : "Pick a call voice…"}</option>
            {canBuiltin ? (
              <optgroup label={lib.engineLabel + " voices"}>
                {lib.builtins.map((b) => <option key={b.voiceId} value={"builtin:" + b.voiceId}>{b.label}</option>)}
              </optgroup>
            ) : null}
            {Object.keys(grouped).map((prov) => (
              <optgroup key={prov} label={grouped[prov][0].providerName}>
                {grouped[prov].map((v) => (
                  <option key={v.id} value={"library:" + v.id} disabled={v.status !== "ok"}>
                    {v.label}{v.status !== "ok" ? " — " + statusNote(v) : ""}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        )}
        <VoiceStatusPill active={active} compact />
        {msg.text && !msg.ok ? <div style={{ fontSize: 12, color: C.red }}>{msg.text}</div> : null}
      </div>
    );
  }

  const openBrowse = async (provider) => {
    setBrowse({ provider, items: null, filter: "", error: "" });
    try {
      const res = await api.getVoiceCatalog(provider);
      setBrowse({ provider, items: res.voices || [], filter: "", error: "" });
    } catch (e) {
      setBrowse({ provider, items: [], filter: "", error: e.message || "Could not list voices." });
    }
  };
  const browseItems = (browse.items || []).filter((v) => !browse.filter || (v.label + " " + v.voiceId).toLowerCase().includes(browse.filter.toLowerCase()));
  const saved = new Set(((lib && lib.voices) || []).map((v) => v.provider + "|" + v.voiceId));

  return (
    <div style={{ fontFamily: FONT_BODY, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ fontSize: 12.5, color: C.slate }}>
          Engine: <b style={{ color: C.ink }}>{lib.engineLabel}</b> · {MODE_TEXT[lib.mode] || ""}
        </div>
        <VoiceStatusPill active={active} />
      </div>

      {remote ? null : (
        <>
          {canBuiltin ? (
            <div>
              <div style={sectionLabel}>{lib.engineLabel} voices</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {lib.builtins.map((b) => (
                  <button
                    key={b.voiceId}
                    type="button"
                    aria-pressed={b.active}
                    disabled={!!busy}
                    onClick={() => run("b_" + b.voiceId, () => setActive("builtin", b.voiceId), "Call voice set to " + b.label + ".")}
                    style={{ ...chip, borderColor: b.active ? C.teal : C.border, background: b.active ? "#EAF5F3" : "#fff", color: b.active ? C.teal : C.ink }}
                  >
                    {b.active ? <CheckCircle2 size={12} /> : null} {b.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {canPlugin || Object.keys(grouped).length ? (
            <div>
              <div style={sectionLabel}>Saved voices</div>
              {!Object.keys(grouped).length ? (
                <div style={{ fontSize: 12.5, color: C.slate }}>No voices saved yet. Add one below{providers.length ? "" : " after connecting a text-to-speech provider in Connections"}.</div>
              ) : null}
              {Object.keys(grouped).map((prov) => (
                <div key={prov} style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: C.slate, margin: "4px 0" }}>{grouped[prov][0].providerName}</div>
                  {grouped[prov].map((v) => (
                    <div key={v.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", border: `1px solid ${v.active ? C.teal : C.border}`, borderRadius: 9, marginBottom: 5, background: v.active ? "#F3FAF8" : "#fff" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>{v.label}</div>
                        <div style={{ fontSize: 11, color: C.slate, fontFamily: FONT_MONO, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.voiceId}</div>
                        {statusNote(v) ? <div style={{ fontSize: 11.5, color: v.status === "key_missing" ? C.red : "#92400E", marginTop: 2 }}>{statusNote(v)}</div> : null}
                      </div>
                      {v.active ? (
                        <span style={{ fontSize: 11.5, fontWeight: 700, color: C.teal }}>In use</span>
                      ) : (
                        <button type="button" disabled={!!busy || v.status !== "ok"} onClick={() => run("u_" + v.id, () => setActive("library", v.id), "Call voice set to " + v.label + ".")} style={smallBtn}>
                          Use
                        </button>
                      )}
                      <button type="button" title="Remove voice" aria-label={"Remove " + v.label} disabled={!!busy || v.active} onClick={() => run("r_" + v.id, () => removeVoice(v.id), "Removed " + v.label + ".")} style={{ ...smallBtn, color: C.red, padding: "0 8px" }}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ) : null}

          {providers.length ? (
            <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 10, background: "#FAFAF9" }}>
              <div style={sectionLabel}>Add a voice</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <select aria-label="Voice provider" value={form.provider} onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value }))} style={{ ...input, width: 170 }}>
                  {providers.map((p) => <option key={p.provider} value={p.provider}>{p.name}{p.connected ? "" : " (key missing)"}</option>)}
                </select>
                <input aria-label="Voice ID" value={form.voiceId} onChange={(e) => setForm((f) => ({ ...f, voiceId: e.target.value }))} placeholder="Voice ID from the provider" style={{ ...input, flex: "2 1 200px", fontFamily: FONT_MONO, fontSize: 12 }} />
                <input aria-label="Voice name" value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} placeholder="Name (e.g. Sarah, British)" style={{ ...input, flex: "1 1 140px" }} />
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
                <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5, color: C.ink }}>
                  <input type="checkbox" checked={form.useForCalls} onChange={(e) => setForm((f) => ({ ...f, useForCalls: e.target.checked }))} />
                  Use for calls
                </label>
                <button
                  type="button"
                  disabled={!!busy || !form.voiceId.trim()}
                  onClick={async () => {
                    const ok = await run("add", () => addVoice({ provider: form.provider, voiceId: form.voiceId.trim(), label: form.label.trim(), useForCalls: form.useForCalls }), form.useForCalls ? "Saved and set as the call voice." : "Saved.");
                    if (ok) setForm((f) => ({ ...f, voiceId: "", label: "" }));
                  }}
                  style={{ ...smallBtn, background: C.ink, color: "#fff", borderColor: C.ink }}
                >
                  {busy === "add" ? "Saving…" : "Add voice"}
                </button>
                {(providers.find((p) => p.provider === form.provider) || {}).canBrowse ? (
                  <button type="button" onClick={() => openBrowse(form.provider)} style={smallBtn}>
                    <Search size={13} /> Browse {(providers.find((p) => p.provider === form.provider) || {}).name} voices
                  </button>
                ) : null}
              </div>
              {browse.provider ? (
                <div style={{ marginTop: 10 }}>
                  {browse.items === null ? <div style={{ fontSize: 12, color: C.slate }}>Loading voices…</div> : null}
                  {browse.error ? <div style={{ fontSize: 12, color: C.red }}>{browse.error}</div> : null}
                  {browse.items && browse.items.length ? (
                    <>
                      <input aria-label="Filter voices" value={browse.filter} onChange={(e) => setBrowse((b) => ({ ...b, filter: e.target.value }))} placeholder="Filter by name" style={{ ...input, marginBottom: 6 }} />
                      <div style={{ maxHeight: 220, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
                        {browseItems.slice(0, 200).map((v) => {
                          const have = saved.has(browse.provider + "|" + v.voiceId);
                          return (
                            <div key={v.voiceId} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, padding: "4px 6px", borderBottom: `1px solid ${C.border}` }}>
                              <span style={{ flex: 1, minWidth: 0 }}>{v.label} <span style={{ color: C.slate, fontFamily: FONT_MONO, fontSize: 11 }}>{v.voiceId}</span></span>
                              <button type="button" disabled={have || !!busy} onClick={() => run("imp_" + v.voiceId, () => addVoice({ provider: browse.provider, voiceId: v.voiceId, label: v.label, origin: "imported", meta: v.meta }), "Added " + v.label + ".")} style={smallBtn}>
                                {have ? "Saved" : "Add"}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : canPlugin ? (
            <div style={{ fontSize: 12.5, color: C.slate }}>Connect a text-to-speech provider (Cartesia, ElevenLabs, Telnyx, Deepgram…) in Connections to add your own voices.</div>
          ) : null}
        </>
      )}

      {msg.text ? <div style={{ fontSize: 12.5, color: msg.ok ? "#059669" : C.red }}>{msg.text}</div> : null}
    </div>
  );
}

const sectionLabel = { fontSize: 11.5, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 };
const chip = { display: "inline-flex", alignItems: "center", gap: 5, height: 32, padding: "0 12px", borderRadius: 99, border: `1px solid ${C.border}`, fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: FONT_BODY, background: "#fff" };
const smallBtn = { display: "inline-flex", alignItems: "center", gap: 5, height: 30, padding: "0 12px", borderRadius: 8, border: `1px solid ${C.border}`, background: "#fff", color: C.ink, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: FONT_BODY };
const input = { height: 34, padding: "0 10px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13, background: "#fff", boxSizing: "border-box", color: C.ink, width: "100%" };
