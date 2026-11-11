import React, { useEffect, useRef, useState } from "react";
import { api } from "../../api/apiClient";
import { C, FONT_BODY } from "../../tokens";
import { askConfirm } from "./Dialogs";

// "How did these contacts agree to hear from you?" Asked once for an import or a list. The answer is kept word for word with who
// gave it and when. Opted in, existing customers and an enquiry let sole traders be emailed; "Not sure" is fine and changes nothing.
export const CONSENT_OPTIONS = [
  ["opted_in", "They opted in", "For example, they ticked a box or signed up to hear from you"],
  ["existing_customer", "They are existing customers", "They bought from you, or talked to you about buying"],
  ["enquiry", "They made an enquiry", "They contacted you first"],
  ["not_sure", "Not sure", "Sole traders among them get a call, letter or LinkedIn task instead of an email"],
];

const text = { fontFamily: FONT_BODY };
const small = { ...text, fontSize: 12.5, color: C.slate, lineHeight: 1.5 };
const field = { ...text, fontSize: 13, padding: "7px 10px", border: `1px solid ${C.border}`, borderRadius: 6, width: "100%", boxSizing: "border-box", background: "#fff", color: C.ink };

// Pure, so it can be tested: what is still missing before the answer can be saved, in words.
export function consentMissing(f) {
  if (!f.basis) return "Pick how they agreed to hear from you.";
  if (f.basis === "not_sure") return "";
  if (!String(f.source || "").trim()) return "Say where they agreed.";
  if (!f.agreed_on) return "Give the date they agreed.";
  if (!f.confirmed) return "Tick the box to confirm.";
  return "";
}

export function ConsentDeclaration({ leadIds = [], listId = "", scope = "import", count = 0, onDone, onClose }) {
  const [f, setF] = useState({ basis: "", source: "", agreed_on: "", confirmed: false, proof_ref: "" });
  const [proof, setProof] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const fileRef = useRef(null);
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  const missing = consentMissing(f);
  const today = new Date().toISOString().slice(0, 10);

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      let file = { file: "", name: "" };
      if (proof && f.basis !== "not_sure") file = await api.consentProof(proof);
      const r = await api.consentDeclare({ ...f, lead_ids: leadIds, list_id: listId, scope, proof_file: file.file, proof_name: file.name });
      const n = r.declaration?.count || 0;
      const msg = f.basis === "not_sure" ? "Saved. Sole traders among them are reached another way, not by email."
        : `Saved for ${n.toLocaleString()} ${n === 1 ? "contact" : "contacts"}. They can be emailed, sole traders included.`;
      setDone(msg);
      onDone?.(r.declaration, msg);
    } catch (e) {
      setError(e.message || "That didn't save. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (done) return <div role="status" style={{ ...small, color: C.ink }}>{done}</div>;
  return (
    <>
    <fieldset style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 14, margin: 0, display: "grid", gap: 10, minWidth: 0 }}>
      <legend style={{ ...text, fontSize: 14, fontWeight: 600, color: C.ink, padding: "0 4px" }}>How did these contacts agree to hear from you?</legend>
      <div style={small}>{count ? `${count.toLocaleString()} ${count === 1 ? "contact" : "contacts"}. ` : ""}Companies on the register get email either way. This decides whether sole traders can be emailed too.</div>
      <div role="radiogroup" aria-label="How they agreed" style={{ display: "grid", gap: 6 }}>
        {CONSENT_OPTIONS.map(([v, label, hint]) => (
          <label key={v} style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: "pointer", ...text, fontSize: 13, color: C.ink }}>
            <input type="radio" name={`consent-${listId || "import"}`} value={v} checked={f.basis === v} onChange={() => set({ basis: v })} style={{ marginTop: 3 }} />
            <span><strong style={{ fontWeight: 600 }}>{label}</strong><br /><span style={small}>{hint}</span></span>
          </label>
        ))}
      </div>
      {f.basis && f.basis !== "not_sure" ? (
        <div style={{ display: "grid", gap: 8 }}>
          <label style={{ ...small, display: "grid", gap: 4 }}>Where did they agree?
            <input style={field} value={f.source} maxLength={500} onChange={(e) => set({ source: e.target.value })} placeholder="The newsletter sign-up form on our website" />
          </label>
          <label style={{ ...small, display: "grid", gap: 4, maxWidth: 220 }}>When? (the date, or the most recent one)
            <input type="date" style={field} max={today} value={f.agreed_on} onChange={(e) => set({ agreed_on: e.target.value })} />
          </label>
          <div style={{ display: "grid", gap: 4 }}>
            <span style={small}>Proof, if you have it (optional): a file, or where it is kept</span>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input ref={fileRef} type="file" hidden accept=".pdf,.png,.jpg,.jpeg,.csv,.txt,.eml,.xlsx,.docx" onChange={(e) => setProof(e.target.files && e.target.files[0])} />
              <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => fileRef.current && fileRef.current.click()}>{proof ? "Change file" : "Add a file"}</button>
              {proof ? <span style={small}>{proof.name}</span> : null}
            </div>
            <input aria-label="Where the proof is kept" style={field} value={f.proof_ref} maxLength={500} onChange={(e) => set({ proof_ref: e.target.value })} placeholder="Or: exported from our mailing list on 3 March" />
          </div>
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: "pointer", ...text, fontSize: 13, color: C.ink }}>
            <input type="checkbox" checked={f.confirmed} onChange={(e) => set({ confirmed: e.target.checked })} style={{ marginTop: 3 }} />
            <span>I confirm these contacts agreed to hear from us in this way, and I can show proof if asked.</span>
          </label>
        </div>
      ) : null}
      {error ? <div role="alert" style={{ ...small, color: C.red }}>{error}</div> : null}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" disabled={busy || Boolean(missing)} title={missing || "Save this answer"} onClick={save}>{busy ? "Saving…" : "Save answer"}</button>
        {onClose ? <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={onClose}>Not now</button> : null}
        {missing && f.basis ? <span style={small}>{missing}</span> : null}
      </div>
    </fieldset>
    {listId ? <ConsentHistory listId={listId} /> : null}
    </>
  );
}

// Answers already given, newest first, each with a way to take it back. Withdrawing is one click and needs no approval from us:
// the contacts it covered stop counting as having agreed, so sole traders among them are reached another way.
export function ConsentHistory({ listId = "", onChanged }) {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const load = async () => {
    try {
      const r = await api.consentOptions();
      setRows((r.declarations || []).filter((d) => d.basis !== "not_sure" && (!listId || d.list_id === listId)));
    } catch (_) {
      setRows([]);
    }
  };
  useEffect(() => { load(); }, [listId]);
  if (!rows || !rows.length) return null;

  const withdraw = async (d) => {
    const ok = await askConfirm({ title: "Withdraw this answer?", body: `${d.count.toLocaleString()} ${d.count === 1 ? "contact stops" : "contacts stop"} counting as having agreed. Sole traders among them are reached another way, not by email.`, confirm: "Withdraw", danger: true });
    if (!ok) return;
    setBusy(d.id);
    setError("");
    try {
      await api.consentWithdraw(d.id);
      await load();
      onChanged?.();
    } catch (e) {
      setError(e.message || "That didn't work. Try again.");
    } finally {
      setBusy("");
    }
  };

  return (
    <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
      <div style={{ ...text, fontSize: 13, fontWeight: 600, color: C.ink }}>Answers you gave before</div>
      {rows.map((d) => (
        <div key={d.id} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 10px", background: "#fff" }}>
          <div style={{ ...small, flex: "1 1 220px", minWidth: 0, overflowWrap: "anywhere", color: C.ink }}>
            <strong style={{ fontWeight: 600 }}>{d.basis_text}</strong>, {d.count.toLocaleString()} {d.count === 1 ? "contact" : "contacts"}
            <br />{d.source ? `${d.source}. ` : ""}{d.agreed_on ? `Agreed ${d.agreed_on}.` : ""}
            {d.revoked_at ? <><br /><span style={{ color: C.slate }}>Withdrawn on {new Date(d.revoked_at).toLocaleDateString("en-GB")}.</span></> : null}
          </div>
          {d.revoked_at ? null : <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" style={{ minHeight: 40 }} disabled={busy === d.id} onClick={() => withdraw(d)}>{busy === d.id ? "Withdrawing…" : "Withdraw"}</button>}
        </div>
      ))}
      {error ? <div role="alert" style={{ ...small, color: C.red }}>{error}</div> : null}
    </div>
  );
}
