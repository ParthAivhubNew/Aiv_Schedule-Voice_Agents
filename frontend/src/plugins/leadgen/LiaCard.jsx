import { useEffect, useState } from "react";
import { api } from "../../api/apiClient";
import { C, FONT_BODY, FONT_DISPLAY } from "../../tokens";
import { LIA_FIELDS, liaStatus } from "./liaText";

// The customer's legitimate interests assessment: the four short answers a regulator asks for before you email
// companies. Prefilled in plain words, edited here, downloaded as text. We keep it; we do not judge it.
const text = { fontFamily: FONT_BODY };
const muted = { ...text, fontSize: 13, color: C.slate, lineHeight: 1.5 };

export function LiaCard() {
  const [doc, setDoc] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  useEffect(() => { api.getLia().then(setDoc).catch(() => setNote("We couldn't load this. Reload the page to try again.")); }, []);
  if (!doc) return note ? <div role="alert" style={{ ...muted, color: C.red }}>{note}</div> : null;
  const set = (k) => (e) => { setDoc((d) => ({ ...d, [k]: e.target.value })); setNote(""); };
  const save = async () => {
    setBusy(true);
    try { setDoc(await api.saveLia(Object.fromEntries(LIA_FIELDS.map(([k]) => [k, doc[k]])))); setNote("Saved."); }
    catch (e) { setNote(e.message || "Couldn't save it."); }
    finally { setBusy(false); }
  };
  const download = async () => {
    try {
      const url = URL.createObjectURL(await api.getLiaFile());
      const a = document.createElement("a");
      a.href = url; a.download = "legitimate-interests-assessment.txt"; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) { setNote(e.message || "Couldn't download it."); }
  };
  return (
    <section className="ui-card" aria-label="Legitimate interests assessment" style={{ padding: 16, display: "grid", gap: 10, marginTop: 14 }}>
      <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 15, fontWeight: 600, color: C.ink, margin: 0 }}>LIA: why you may email these companies</h2>
      <div style={muted}>A short record of why contacting them is fair. It starts with our suggested wording. Change it to fit how you work, then save. {liaStatus(doc)}</div>
      {LIA_FIELDS.map(([k, title]) => (
        <label key={k} style={{ ...text, fontSize: 12.5, fontWeight: 600, color: C.ink, display: "grid", gap: 4 }}>{title}
          <textarea className="ui-input" rows={3} value={doc[k] || ""} onChange={set(k)} maxLength={4000} style={{ height: "auto", padding: "8px 10px", fontWeight: 400 }} />
        </label>
      ))}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button>
        <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={download}>Download as text</button>
        {note ? <span role="status" style={muted}>{note}</span> : null}
      </div>
    </section>
  );
}
