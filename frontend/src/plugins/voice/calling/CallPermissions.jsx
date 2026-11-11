import React, { useCallback, useEffect, useState } from "react";
import { C, FONT_BODY, FONT_DISPLAY } from "../../../tokens";
import { api } from "../../../api/apiClient";
import { notice } from "../../../utils/notice";
import { METHOD_OPTIONS, permissionMissing, screeningPill } from "./callPermissionLogic";

// Permission to call a number with AI-voiced calls. Without it the AI caller does not dial that number. The wording the person
// agreed to is stored word for word with who recorded it, so it can be shown if anyone asks.

const text = { fontFamily: FONT_BODY };
const small = { ...text, fontSize: 12.5, color: C.slate, lineHeight: 1.5 };
const field = { ...text, fontSize: 13, padding: "8px 10px", minHeight: 40, border: `1px solid ${C.border}`, borderRadius: 8, width: "100%", boxSizing: "border-box", background: "#fff", color: C.ink };
const card = { background: "#fff", border: `1px solid ${C.border}`, borderRadius: 14, padding: 18, marginTop: 16, display: "grid", gap: 12, minWidth: 0 };
const TONES = { red: ["#FDECEC", "#B42318"], green: ["#E7F6EC", "#166534"], amber: ["#FEF3E2", "#92400E"] };

function Pill({ tone, children }) {
  const [bg, fg] = TONES[tone] || TONES.amber;
  return <span style={{ ...text, fontSize: 12, fontWeight: 600, padding: "3px 9px", borderRadius: 999, background: bg, color: fg, whiteSpace: "nowrap" }}>{children}</span>;
}

const blank = { number: "", company: "", person: "", product: "", method: "verbal_recorded", evidence_ref: "", confirmed: false };

export function CallPermissions({ ask }) {
  const [f, setF] = useState(blank);
  const [rows, setRows] = useState(null);
  const [wording, setWording] = useState("");
  const [screening, setScreening] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  const load = useCallback(async () => {
    try { setRows((await api.callPermissions()).permissions || []); } catch (_) { setRows([]); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (ask && (ask.number || ask.company)) setF((x) => ({ ...x, number: ask.number || x.number, company: ask.company || x.company })); }, [ask]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      api.callPermissionWording({ company: f.company, number: f.number, product: f.product }).then((r) => setWording(r.wording || "")).catch(() => {});
    }, 300);
    return () => window.clearTimeout(t);
  }, [f.company, f.number, f.product]);

  const lookup = async () => {
    if (String(f.number).replace(/\D/g, "").length < 8) { setScreening(null); return; }
    try { setScreening((await api.callPermissionFor(f.number)).screening); } catch (_) { setScreening(null); }
  };

  const missing = permissionMissing(f);
  const save = async () => {
    setBusy("save");
    setError("");
    try {
      const { confirmed, ...body } = f;
      await api.callPermissionRecord(body);
      notice("Saved. The AI caller may call that number.");
      setF(blank);
      setScreening(null);
      await load();
    } catch (e) {
      setError(e.message || "That didn't save. Try again.");
    } finally {
      setBusy("");
    }
  };
  const withdraw = async (id) => {
    setBusy(id);
    try {
      await api.callPermissionWithdraw(id, "Withdrawn in the app");
      notice("Withdrawn. The AI caller will not call that number.");
      await load();
    } catch (e) {
      notice(e.message || "Couldn't withdraw it. Try again.");
    } finally {
      setBusy("");
    }
  };

  const pill = screeningPill(screening);
  return (
    <section id="call-permissions" aria-label="Permission for AI calls" style={card}>
      <div>
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 16, fontWeight: 600, color: C.ink }}>Permission for AI calls</div>
        <div style={small}>The AI caller only dials numbers where the person agreed to automated calls. Calls you make yourself from the phone do not need this, but check TPS first.</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
        <label style={{ ...small, display: "grid", gap: 4 }}>Phone number
          <input style={field} value={f.number} inputMode="tel" onChange={(e) => set({ number: e.target.value })} onBlur={lookup} placeholder="+44 7700 900123" />
        </label>
        <label style={{ ...small, display: "grid", gap: 4 }}>Company they agreed to hear from
          <input style={field} value={f.company} maxLength={200} onChange={(e) => set({ company: e.target.value })} />
        </label>
        <label style={{ ...small, display: "grid", gap: 4 }}>Person (optional)
          <input style={field} value={f.person} maxLength={200} onChange={(e) => set({ person: e.target.value })} />
        </label>
        <label style={{ ...small, display: "grid", gap: 4 }}>What the calls are about
          <input style={field} value={f.product} maxLength={200} onChange={(e) => set({ product: e.target.value })} placeholder="our bookkeeping service" />
        </label>
        <label style={{ ...small, display: "grid", gap: 4 }}>How they agreed
          <select style={field} value={f.method} onChange={(e) => set({ method: e.target.value })}>
            {METHOD_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label style={{ ...small, display: "grid", gap: 4 }}>Where the proof is kept (optional)
          <input style={field} value={f.evidence_ref} maxLength={1000} onChange={(e) => set({ evidence_ref: e.target.value })} placeholder="Call recording 3 Nov, 14:05" />
        </label>
      </div>
      {screening !== null ? <div><Pill tone={pill.tone}>{pill.text}</Pill></div> : null}
      <div style={{ ...small, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 12px", background: "#FAFAFB", color: C.ink }}>
        <strong style={{ fontWeight: 600 }}>What they agree to</strong><br />{wording || "Fill in the company to see the wording."}
      </div>
      <label style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: "pointer", ...text, fontSize: 13, color: C.ink }}>
        <input type="checkbox" checked={f.confirmed} onChange={(e) => set({ confirmed: e.target.checked })} style={{ marginTop: 3 }} />
        <span>This person agreed to that wording, and I can show how if asked.</span>
      </label>
      {error ? <div role="alert" style={{ ...small, color: C.red }}>{error}</div> : null}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" style={{ minHeight: 40 }} disabled={busy === "save" || Boolean(missing)} title={missing || "Save this permission"} onClick={save}>{busy === "save" ? "Saving…" : "Save permission"}</button>
        {missing && (f.number || f.company) ? <span style={small}>{missing}</span> : null}
      </div>

      {rows && rows.length ? (
        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ ...text, fontSize: 13, fontWeight: 600, color: C.ink }}>Recorded permissions</div>
          {rows.map((r) => (
            <div key={r.id} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 10px" }}>
              <div style={{ ...small, flex: "1 1 240px", minWidth: 0, overflowWrap: "anywhere", color: C.ink }}>
                <strong style={{ fontWeight: 600 }}>{r.number}</strong>{r.person_name ? `, ${r.person_name}` : ""} for {r.company_name}
                <br />{r.method_label}, {r.collected_at ? new Date(r.collected_at).toLocaleDateString("en-GB") : ""}{r.recorded_by ? `, recorded by ${r.recorded_by}` : ""}
              </div>
              {r.active ? <Pill tone="green">Active</Pill> : <Pill tone="amber">Withdrawn {r.withdrawn_at ? new Date(r.withdrawn_at).toLocaleDateString("en-GB") : ""}</Pill>}
              {r.active ? <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" style={{ minHeight: 40 }} disabled={busy === r.id} onClick={() => withdraw(r.id)}>{busy === r.id ? "Withdrawing…" : "Withdraw"}</button> : null}
            </div>
          ))}
        </div>
      ) : rows ? <div style={small}>No permissions recorded yet.</div> : null}
    </section>
  );
}
