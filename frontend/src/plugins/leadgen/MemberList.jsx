import React, { useCallback, useEffect, useRef, useState } from "react";
import { Upload, Trash2 } from "lucide-react";
import { CardsSkeleton } from "../../app/Loader";
import { C, FONT_BODY } from "../../tokens";
import { clearMemberList, getMemberList, uploadMemberList } from "../../brand/brandApi";
import { askConfirm } from "./Dialogs";

const text = { fontFamily: FONT_BODY };
const muted = { ...text, fontSize: 13, color: C.slate, lineHeight: 1.5 };

// What an upload came to, in plain words.
export function uploadSummary(r) {
  if (!r) return "";
  const parts = [`${(r.added || 0).toLocaleString()} added`, `${(r.alreadyThere || 0).toLocaleString()} already there`, `${(r.rejected || 0).toLocaleString()} rejected`];
  return `${parts.join(", ")}. The list now holds ${(r.count || 0).toLocaleString()}.`;
}

// The organisation's own list of members (company numbers). Companies on it never appear as prospects.
export function MemberList({ toast }) {
  const [data, setData] = useState(null);
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const input = useRef(null);

  const load = useCallback(async () => {
    try {
      setData(await getMemberList());
    } catch (e) {
      setData({ count: 0, sample: [] });
      setError(e.message || "Couldn't load the member list.");
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (data === null) return <CardsSkeleton count={2} label="Loading the member list" />;

  const upload = async (file) => {
    if (!file) return;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const r = await uploadMemberList(file, replace);
      setResult(r);
      toast?.("Member list updated.");
      await load();
    } catch (e) {
      setError(e.message || "That file could not be read.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  const clear = async () => {
    const ok = await askConfirm({
      title: "Clear the member list?",
      body: `All ${data.count.toLocaleString()} companies are taken off the list, so they can appear as prospects again.`,
      confirm: "Clear the list", danger: true,
    });
    if (!ok) return;
    setBusy(true);
    setError("");
    try {
      await clearMemberList();
      setResult(null);
      toast?.("Member list cleared.");
      await load();
    } catch (e) {
      setError(e.message || "Couldn't clear the list.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 720 }}>
      <div className="ui-card" style={{ padding: 18 }}>
        <div style={{ ...text, fontSize: 22, fontWeight: 600, color: C.textInk }}>{data.count.toLocaleString()} {data.count === 1 ? "company" : "companies"}</div>
        <div style={muted}>Companies on this list never appear as prospects. Upload a CSV with a column of company numbers; a header such as &ldquo;company number&rdquo; is optional.</div>
        {data.sample?.length ? (
          <ul aria-label="A sample of the list" style={{ margin: "12px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
            {data.sample.map((m) => (
              <li key={m.number} style={{ ...text, fontSize: 13, color: C.textInk }}><span style={{ fontVariantNumeric: "tabular-nums" }}>{m.number}</span>{m.label ? <span style={{ color: C.slate }}> · {m.label}</span> : null}</li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="ui-card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ ...text, fontWeight: 600, fontSize: 14, color: C.textInk }}>Upload a list</div>
        <label style={{ ...muted, display: "flex", alignItems: "center", gap: 8 }} title="Off: the numbers are added to the list. On: the list is swapped for this file">
          <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} /> Replace the whole list
        </label>
        <input ref={input} type="file" accept=".csv,.json,text/csv,application/json" hidden onChange={(e) => upload(e.target.files?.[0])} />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="ui-btn ui-btn--primary" disabled={busy} onClick={() => input.current?.click()}><Upload size={15} /> {busy ? "Working…" : "Choose a CSV"}</button>
          <button type="button" className="ui-btn ui-btn--secondary" disabled={busy || !data.count} onClick={clear} title="Take every company off the list"><Trash2 size={15} /> Clear the list</button>
        </div>
        {result ? <div role="status" style={{ ...text, fontSize: 13, color: C.textInk }}>{uploadSummary(result)}</div> : null}
        {error ? <div role="alert" style={{ ...text, fontSize: 13, color: C.red }}>{error}</div> : null}
      </div>
    </div>
  );
}
