import React, { useEffect, useMemo, useState } from "react";
import { C, FONT_BODY } from "../../tokens";
import { api } from "../../api/apiClient";
import { saveBlob } from "./importMatchLogic";
import { DialogActions, DialogFrame, FieldChecks, PreviewNotes, countFrom, exportError, fileNameFrom, successText } from "./ExportDialog";

// The update file for the person's Salesforce: only matched records, only the details that changed.

export const SF_FIELDS = ["phone", "website", "email"];
export const SF_FORMAT_WORDS = { long: "One row per change.", wide: "One row per record." };

const body = { fontFamily: FONT_BODY, fontSize: 13.5, color: C.textInk, lineHeight: 1.5 };
const small = { fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate, lineHeight: 1.5 };

export const sfCounts = (p) => `${Number(p.records || 0).toLocaleString("en-GB")} ${p.records === 1 ? "record" : "records"} to update, ${Number(p.rows || 0).toLocaleString("en-GB")} ${p.rows === 1 ? "row" : "rows"} in the file.`;
export const sfLabel = (preview) => ((preview && (preview.popup || "").trim()) ? "Download without Google data" : "Download update file");

export function SalesforceBody({ preview, error, fields, format, busy, message, onToggle, onFormat, onClose, onGo }) {
  const locked = busy || Boolean(message);
  return (
    <>
      <div role="status" aria-live="polite" style={body}>{preview ? sfCounts(preview) : error ? "" : "Counting the changes…"}</div>
      <FieldChecks legend="Details to update" names={SF_FIELDS} picked={fields} onToggle={onToggle} disabled={locked} />
      <div>
        <label htmlFor="sf-format" style={{ ...small, display: "block", fontWeight: 600, marginBottom: 4 }}>File layout</label>
        <select id="sf-format" className="ui-input" style={{ minHeight: 44, width: "100%" }} value={format} disabled={locked} onChange={(e) => onFormat(e.target.value)}>
          <option value="long">Long</option>
          <option value="wide">Wide</option>
        </select>
        <div style={{ ...small, marginTop: 4 }}>One row per change, or one row per record. {SF_FORMAT_WORDS[format]}</div>
      </div>
      {preview && !message ? <PreviewNotes preview={preview} /> : null}
      <DialogActions label={sfLabel(preview)} busyLabel="Making the file…" busy={busy} disabled={!preview || !fields.length || !preview.rows} onClose={onClose} onGo={onGo} message={message} error={error} />
    </>
  );
}

export function SalesforceDialog({ importId, onClose }) {
  const [fields, setFields] = useState(SF_FIELDS);
  const [format, setFormat] = useState("long");
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const fieldKey = fields.join(",");
  const req = useMemo(() => ({ format, fields }), [format, fieldKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let live = true;
    setError("");
    api.previewSalesforce(importId, req)
      .then((p) => { if (live) setPreview(p); })
      .catch((e) => { if (live) { setPreview(null); setError(exportError(e)); } });
    return () => { live = false; };
  }, [importId, req]);

  const toggle = (f) => setFields((cur) => (cur.includes(f) ? cur.filter((x) => x !== f) : SF_FIELDS.filter((n) => n === f || cur.includes(n))));
  const go = async () => {
    setBusy(true);
    setError("");
    try {
      const out = await api.downloadSalesforce(importId, req);
      saveBlob(out.blob, fileNameFrom(out.headers, "salesforce-update.csv"));
      setMessage(successText(countFrom(out.headers, "X-Export-Rows") || preview?.rows || 0, countFrom(out.headers, "X-Withheld-Count")));
    } catch (e) {
      setError(exportError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogFrame title="Download update file" onClose={onClose} busy={busy}>
      <SalesforceBody preview={preview} error={error} fields={fields} format={format} busy={busy} message={message} onToggle={toggle} onFormat={setFormat} onClose={onClose} onGo={go} />
    </DialogFrame>
  );
}
