import React, { useCallback, useEffect, useRef, useState } from "react";
import { C } from "../tokens";
import { adminApi } from "./adminApi";
import { Note, Pill, btn, cell, input, mono, th } from "./ui";

const sizeLabel = (n) => (n >= 1 << 30 ? `${(n / (1 << 30)).toFixed(1)} GB` : n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const ACCEPT = ".csv,.tsv,.txt,.json,.jsonl,.ndjson,.zip";

// A bulk source's files and a dry-run of its mapping. Upload a downloaded register file (CSV, TSV,
// JSON, JSON-lines or a ZIP of those), press Preview to see exactly what the first rows would become
// -- the columns the file really has, any mapped column that isn't there, and each row's search
// fields -- and only then start the import. Previewing writes nothing.
export function DataSourceFiles({ source, canEdit, onChanged }) {
  const [files, setFiles] = useState(null);
  const [folders, setFolders] = useState({ uploadFolder: "", importRoot: "" });
  const [progress, setProgress] = useState(null);
  const [msg, setMsg] = useState({ text: "", error: false });
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const picker = useRef(null);

  const load = useCallback(async () => {
    try {
      const r = await adminApi.dataSourceFiles(source.id);
      setFiles(r.files);
      setFolders({ uploadFolder: r.uploadFolder, importRoot: r.importRoot });
    } catch (e) {
      setMsg({ text: e.message, error: true });
    }
  }, [source.id]);
  useEffect(() => { load(); }, [load]);

  const upload = async (list) => {
    for (const file of Array.from(list || [])) {
      setMsg({ text: "", error: false });
      setProgress({ name: file.name, pct: 0 });
      try {
        await adminApi.uploadDataSourceFile(source.id, file, (pct) => setProgress({ name: file.name, pct }));
        setMsg({ text: `${file.name} uploaded.`, error: false });
      } catch (e) {
        setMsg({ text: e.message, error: true });
        break;
      }
    }
    setProgress(null);
    if (picker.current) picker.current.value = "";
    setPreview(null);
    await load();
    if (onChanged) onChanged();
  };

  const remove = async (name) => {
    if (!window.confirm(`Delete ${name} from the server? Records already imported from it stay.`)) return;
    try {
      await adminApi.deleteDataSourceFile(source.id, name);
      setPreview(null);
      await load();
    } catch (e) {
      setMsg({ text: e.message, error: true });
    }
  };

  const runPreview = async () => {
    setBusy(true);
    setMsg({ text: "", error: false });
    try {
      setPreview(await adminApi.previewDataSource(source.id));
    } catch (e) {
      setMsg({ text: e.message, error: true });
    } finally {
      setBusy(false);
    }
  };

  const unmatched = Object.entries(preview?.unmatched || {});
  return (
    <div style={{ display: "grid", gap: 8, marginTop: 4, borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
      <div style={{ fontSize: 11.5, color: C.slate }}>
        Upload a downloaded file (CSV, TSV, JSON, JSON-lines, or a ZIP of those), or put files in <span style={mono}>{folders.uploadFolder || "the server's imports folder"}</span> on the server
        for very large ones. Then Preview to check the mapping, and Start import.
      </div>
      <Note error={msg.error}>{msg.text}</Note>
      {files && files.length === 0 && <div style={{ fontSize: 12, color: C.slate }}>No files uploaded yet.</div>}
      {(files || []).map((f) => (
        <div key={f.name} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
          <span style={mono}>{f.name}</span><span style={{ color: C.slate }}>{sizeLabel(f.size)}</span>
          {canEdit && <button type="button" style={{ ...btn(false), fontSize: 11, padding: "1px 8px" }} onClick={() => remove(f.name)}>Delete</button>}
        </div>
      ))}
      {canEdit && (
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <input ref={picker} type="file" accept={ACCEPT} multiple style={{ ...input, padding: 4 }} aria-label="Choose files to upload"
            disabled={!!progress} onChange={(e) => upload(e.target.files)} />
          {progress && <span style={{ fontSize: 12, color: C.slate }}>Uploading {progress.name}… {Math.round(progress.pct * 100)}%</span>}
          <button type="button" style={btn(false)} disabled={busy || !!progress} onClick={runPreview}>{busy ? "Reading…" : "Preview mapping"}</button>
        </div>
      )}
      {preview && !preview.ok && <Note error>{preview.error}</Note>}
      {preview && preview.ok && (
        <div style={{ display: "grid", gap: 6 }}>
          {preview.note && <Note error>{preview.note}</Note>}
          {preview.columns?.length > 0 && (
            <div style={{ fontSize: 11.5, color: C.slate }}>Columns in the file: <span style={mono}>{preview.columns.join(" · ")}</span></div>
          )}
          {unmatched.length > 0 && (
            <div style={{ fontSize: 12, color: "#b45309" }}>
              Mapped columns not found in this file (those fields will be empty):{" "}
              {unmatched.map(([field, cols]) => <span key={field}><Pill tone="amber">{field}: {cols.join(", ")}</Pill> </span>)}
              <div style={{ color: C.slate, marginTop: 2 }}>Fix the names in bulk_field_map (Edit, Config) so they match the columns above.</div>
            </div>
          )}
          {preview.rows.length > 0 && (
            <div style={{ overflowX: "auto", border: `1px solid ${C.border}`, borderRadius: 8 }}>
              <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 640 }}>
                <thead><tr>{["name", "registration_number", "industry", "region", "postcode", "status", "phone", "website"].map((h) => <th key={h} style={th}>{h.replace("_", " ")}</th>)}<th style={th}>search fields derived</th></tr></thead>
                <tbody>
                  {preview.rows.map((r, i) => (
                    <tr key={i}>
                      {["name", "registration_number", "industry", "region", "postcode", "status", "phone", "website"].map((k) => <td key={k} style={cell}>{r.mapped[k] || r.derived[k] || ""}</td>)}
                      <td style={{ ...cell, ...mono }}>{Object.entries(r.derived).map(([k, v]) => `${k}=${v}`).join("  ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div style={{ fontSize: 11.5, color: C.slate }}>This was only a preview of the first rows. Nothing was saved.</div>
        </div>
      )}
    </div>
  );
}
