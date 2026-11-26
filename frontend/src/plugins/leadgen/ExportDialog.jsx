import React, { useEffect, useMemo, useRef, useState } from "react";
import { Download, X } from "lucide-react";
import { C, FONT_BODY } from "../../tokens";
import { api } from "../../api/apiClient";
import { saveBlob } from "./importMatchLogic";

// Administrators only: the server checks, this screen just does not offer it to anyone else.
// The file is made on the server, which leaves out the values we may not hand over. The dialog says what was left out before and after.

export const FIELD_LABELS = {
  registration_number: "Company number", address: "Address", postcode: "Postcode", region: "Region", industry: "Industry",
  contact_name: "Contact name", contact_title: "Contact job title", website: "Website", phone: "Phone", email: "Email",
  title: "Job title",
};
export const FIELDS = {
  companies: ["registration_number", "address", "postcode", "region", "industry", "contact_name", "contact_title", "website", "phone", "email"],
  people: ["title", "email", "phone"],
};
export const FORMAT_WORDS = {
  wide: "One row for each company, with a column for each detail.",
  long: "One row for each detail, with where it came from and the phone check result.",
};
const WITHHELD_WORD = { phone: ["phone number", "phone numbers"], website: ["website", "websites"], email: ["email", "emails"] };

export const rowsWord = (n) => `${Number(n || 0).toLocaleString("en-GB")} ${n === 1 ? "row" : "rows"}`;
export const successText = (rows, left) => `Exported ${Number(rows || 0).toLocaleString("en-GB")} ${rows === 1 ? "row" : "rows"}. ${Number(left || 0).toLocaleString("en-GB")} ${left === 1 ? "value was" : "values were"} left out.`;

// "Left out: 3 phone numbers, 1 website", only the fields that lost something.
export function withheldLine(fields) {
  const bits = Object.keys(WITHHELD_WORD)
    .filter((k) => (fields || {})[k] > 0)
    .map((k) => `${fields[k].toLocaleString("en-GB")} ${WITHHELD_WORD[k][fields[k] === 1 ? 0 : 1]}`);
  return bits.length ? `Left out of the file: ${bits.join(", ")}.` : "";
}

// The file name the server chose, else a plain one.
export function fileNameFrom(headers, fallback = "export.csv") {
  const raw = headers && typeof headers.get === "function" ? headers.get("Content-Disposition") : "";
  if (!raw) return fallback;
  const star = /filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i.exec(raw);
  if (star) { try { return decodeURIComponent(star[1].trim().replace(/^"|"$/g, "")) || fallback; } catch { /* fall through to the plain name */ } }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(raw);
  return (plain && plain[1].trim()) || fallback;
}

export const countFrom = (headers, name) => {
  const n = Number(headers && typeof headers.get === "function" ? headers.get(name) : 0);
  return Number.isFinite(n) ? n : 0;
};

// The server's own sentence for 400, 404 and 422; a fallback when there is none.
export function exportError(e) {
  const generic = e && e.status && e.message === `Request failed with status ${e.status}`;
  if (e && e.message && !generic) return e.message;
  const fallback = { 400: "That export isn't possible. Pick a smaller list.", 404: "We couldn't find that list or those companies.", 422: "Something in that request wasn't valid. Check the details and try again." };
  return fallback[e && e.status] || "Couldn't make the file. Try again.";
}

const FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
const small = { fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate, lineHeight: 1.5 };
const body = { fontFamily: FONT_BODY, fontSize: 13.5, color: C.textInk, lineHeight: 1.5 };

// The frame shared by the export and Salesforce dialogs: focus kept inside, Escape closes, a tap outside closes.
export function DialogFrame({ title, onClose, busy = false, children }) {
  const box = useRef(null);
  useEffect(() => {
    const before = document.activeElement;
    box.current?.querySelector(FOCUSABLE)?.focus();
    return () => { if (before && before.focus) before.focus(); };
  }, []);
  const keys = (e) => {
    if (e.key === "Escape" && !busy) { onClose(); return; }
    if (e.key !== "Tab") return;
    const items = [...box.current.querySelectorAll(FOCUSABLE)];
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  return (
    <div onClick={busy ? undefined : onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,18,28,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div ref={box} role="dialog" aria-modal="true" aria-label={title} onKeyDown={keys} onClick={(e) => e.stopPropagation()} className="ui-card"
        style={{ width: "100%", maxWidth: 520, maxHeight: "90vh", overflowY: "auto", background: C.surface, borderRadius: 12, padding: 20, display: "flex", flexDirection: "column", gap: 14, boxSizing: "border-box" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <h2 style={{ margin: 0, flex: 1, fontFamily: FONT_BODY, fontSize: 16, fontWeight: 700, color: C.ink }}>{title}</h2>
          <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" style={{ minHeight: 44, minWidth: 44 }} onClick={onClose} disabled={busy} aria-label="Close"><X size={18} aria-hidden="true" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function FormatField({ id, value, onChange, disabled }) {
  return (
    <div>
      <label htmlFor={id} style={{ ...small, display: "block", fontWeight: 600, marginBottom: 4 }}>File layout</label>
      <select id={id} className="ui-input" style={{ minHeight: 44, width: "100%" }} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        <option value="wide">Wide</option>
        <option value="long">Long</option>
      </select>
      <div style={{ ...small, marginTop: 4 }}>{FORMAT_WORDS[value]}</div>
    </div>
  );
}

export function FieldChecks({ legend, names, picked, onToggle, disabled }) {
  return (
    <fieldset style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
      <legend style={{ ...small, fontWeight: 600, padding: 0, marginBottom: 2 }}>{legend}</legend>
      <div style={{ display: "flex", flexWrap: "wrap", columnGap: 12 }}>
        {names.map((f) => (
          <label key={f} style={{ ...body, display: "inline-flex", alignItems: "center", gap: 8, minHeight: 44, minWidth: 140 }}>
            <input type="checkbox" checked={picked.includes(f)} disabled={disabled} onChange={() => onToggle(f)} style={{ width: 18, height: 18 }} />
            {FIELD_LABELS[f] || f}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

// What the server said about the file, in one place: the rights notice, the phone screening note and what would be left out.
export function PreviewNotes({ preview }) {
  const line = withheldLine(preview.withheld_fields);
  const popup = (preview.popup || "").trim();
  const screening = (preview.screening_note || "").trim();
  const unscreened = Number(preview.unscreened_phones || 0);
  const listed = Number(preview.listed_phones || 0);
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {popup ? <div role="note" style={{ ...body, background: C.warningBg, border: "1px solid #F0D9A0", borderRadius: 8, padding: "10px 12px", whiteSpace: "pre-line" }}>{popup}</div> : null}
      {screening ? <div role="note" style={{ ...body, background: C.paper, border: `1px solid ${C.borderLight}`, borderRadius: 8, padding: "10px 12px" }}>{screening}</div> : null}
      {unscreened || listed ? (
        <div style={small}>
          {unscreened ? `${unscreened.toLocaleString("en-GB")} ${unscreened === 1 ? "phone number has" : "phone numbers have"} not been through the TPS and CTPS check.` : ""}
          {unscreened && listed ? " " : ""}
          {listed ? `${listed.toLocaleString("en-GB")} ${listed === 1 ? "is" : "are"} on a register.` : ""}
        </div>
      ) : null}
      {line ? <div style={body}>{line}</div> : null}
    </div>
  );
}

// The buttons and the message line: Cancel, and the download, with a live region for the result.
export function DialogActions({ label, busyLabel, busy, disabled, onClose, onGo, message, error }) {
  return (
    <>
      <div role="status" aria-live="polite" style={{ minHeight: 0 }}>
        {message ? <div style={{ ...body, color: C.green }}>{message}</div> : null}
        {error ? <div role="alert" style={{ ...body, color: C.red }}>{error}</div> : null}
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
        <button type="button" className="ui-btn ui-btn--ghost" style={{ minHeight: 44 }} onClick={onClose} disabled={busy}>{message ? "Close" : "Cancel"}</button>
        {message ? null : (
          <button type="button" className="ui-btn ui-btn--primary" style={{ minHeight: 44 }} onClick={onGo} disabled={busy || disabled}>
            <Download size={15} aria-hidden="true" /> {busy ? busyLabel : label}
          </button>
        )}
      </div>
    </>
  );
}

export const primaryLabel = (preview) => ((preview && (preview.popup || "").trim()) ? "Export without Google data" : "Export");

// The drawing alone, so each state can be shown without a server.
export function ExportBody({ kind, preview, error, fields, format, busy, message, onToggle, onFormat, onClose, onGo }) {
  return (
    <>
      <div role="status" aria-live="polite" style={body}>{preview ? rowsWord(preview.rows) : error ? "" : "Counting the rows…"}</div>
      <FieldChecks legend="What to include" names={FIELDS[kind] || FIELDS.companies} picked={fields} onToggle={onToggle} disabled={busy || Boolean(message)} />
      <FormatField id="export-format" value={format} onChange={onFormat} disabled={busy || Boolean(message)} />
      {preview && !message ? <PreviewNotes preview={preview} /> : null}
      <DialogActions label={primaryLabel(preview)} busyLabel="Making the file…" busy={busy} disabled={!preview || !fields.length || !preview.rows} onClose={onClose} onGo={onGo} message={message} error={error} />
    </>
  );
}

// scope: { list_id } or { ids }. kind: "companies" | "people".
export function ExportDialog({ kind = "companies", scope, onClose }) {
  const names = FIELDS[kind] || FIELDS.companies;
  const [fields, setFields] = useState(names);
  const [format, setFormat] = useState("wide");
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const scopeKey = JSON.stringify(scope || {});
  const fieldKey = fields.join(",");
  const body_ = useMemo(() => ({ kind, scope, fields }), [kind, scopeKey, fieldKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let live = true;
    setError("");
    api.previewExport(body_)
      .then((p) => { if (live) setPreview(p); })
      .catch((e) => { if (live) { setPreview(null); setError(exportError(e)); } });
    return () => { live = false; };
  }, [body_]);

  const toggle = (f) => setFields((cur) => (cur.includes(f) ? cur.filter((x) => x !== f) : names.filter((n) => n === f || cur.includes(n))));
  const go = async () => {
    setBusy(true);
    setError("");
    try {
      const out = await api.downloadExport({ ...body_, format });
      saveBlob(out.blob, fileNameFrom(out.headers));
      setMessage(successText(countFrom(out.headers, "X-Export-Rows") || preview?.rows || 0, countFrom(out.headers, "X-Withheld-Count")));
    } catch (e) {
      setError(exportError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogFrame title={kind === "people" ? "Export people" : "Export companies"} onClose={onClose} busy={busy}>
      <ExportBody kind={kind} preview={preview} error={error} fields={fields} format={format} busy={busy} message={message} onToggle={toggle} onFormat={setFormat} onClose={onClose} onGo={go} />
    </DialogFrame>
  );
}
