import React, { useEffect, useRef, useState } from "react";
import { Mail, RefreshCw, Upload, Save, RotateCcw } from "lucide-react";
import { api } from "../api/apiClient";
import { C, FONT_BODY, FONT_DISPLAY, FONT_MONO } from "../tokens";

/**
 * Live preview + bring-your-own HTML for meeting invite emails.
 * Tokens like {{company_name}} filled from Company Profile / calendar settings.
 */
export function MeetingInvitePreview({
  role: roleProp = "attendee",
  prospectName,
  date,
  time,
  compact = false,
  style,
}) {
  const [role, setRole] = useState(roleProp === "host" ? "host" : "attendee");
  const [panel, setPanel] = useState("preview"); // preview | byo
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [draftHtml, setDraftHtml] = useState("");
  const [saveMsg, setSaveMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [applyBoth, setApplyBoth] = useState(false);
  const fileRef = useRef(null);

  const load = async (nextRole = role) => {
    setLoading(true);
    setErr("");
    try {
      const q = new URLSearchParams({ role: nextRole });
      if (prospectName) q.set("prospect_name", prospectName);
      if (date) q.set("date", date);
      if (time) q.set("time", time);
      const res = await api.getCalcomInvitePreview(q.toString());
      setData(res);
      setDraftHtml(res.customHtml || "");
    } catch (e) {
      setErr(e?.message || "Could not load invite preview");
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(role);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, prospectName, date, time]);

  const onPickFile = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const name = (file.name || "").toLowerCase();
    if (!/\.(html?|txt)$/i.test(name) && file.type && !/text|html/i.test(file.type)) {
      setSaveMsg("Use .html, .htm, or .txt");
      setTimeout(() => setSaveMsg(""), 3000);
      e.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setDraftHtml(String(reader.result || ""));
      setPanel("byo");
      setSaveMsg(`Loaded ${file.name}`);
      setTimeout(() => setSaveMsg(""), 2500);
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const saveTemplate = async () => {
    setSaving(true);
    setSaveMsg("");
    try {
      await api.saveCalcomInviteTemplate({
        role: applyBoth ? "both" : role,
        html: draftHtml,
        clear: false,
      });
      setSaveMsg("Saved — used on next booking email");
      setTimeout(() => setSaveMsg(""), 3000);
      await load(role);
      setPanel("preview");
    } catch (e) {
      setSaveMsg(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const clearTemplate = async () => {
    setSaving(true);
    try {
      await api.saveCalcomInviteTemplate({
        role: applyBoth ? "both" : role,
        html: "",
        clear: true,
      });
      setDraftHtml("");
      setSaveMsg("Back to built-in invite");
      setTimeout(() => setSaveMsg(""), 3000);
      await load(role);
    } catch (e) {
      setSaveMsg(e?.message || "Clear failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        background: compact ? "transparent" : "#F1F5F9",
        borderRadius: 14,
        border: `1px solid ${C.border}`,
        overflow: "hidden",
        fontFamily: FONT_BODY,
        ...style,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
          padding: "12px 14px",
          background: "#fff",
          borderBottom: `1px solid ${C.border}`,
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: C.tealSoft || "#ECFDF5",
            color: C.teal || "#0F766E",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <Mail size={15} />
        </div>
        <div style={{ flex: 1, minWidth: 140 }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 14, color: C.ink }}>
            Email preview
          </div>
          <div style={{ fontSize: 11.5, color: C.slate, marginTop: 1 }}>
            {data?.hasCustom ? "Using your HTML" : "Built-in design"} · Company Profile fills tokens
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          {["preview", "byo"].map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPanel(p)}
              style={{
                height: 28,
                padding: "0 10px",
                borderRadius: 8,
                border: panel === p ? `1.5px solid ${C.ink}` : `1px solid ${C.border}`,
                background: panel === p ? C.ink : "#fff",
                color: panel === p ? "#fff" : C.slate,
                fontSize: 11,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              {p === "preview" ? "Preview" : "Your HTML"}
            </button>
          ))}
          {["attendee", "host"].map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRole(r)}
              style={{
                height: 28,
                padding: "0 10px",
                borderRadius: 8,
                border: role === r ? `1.5px solid ${C.teal || "#0F766E"}` : `1px solid ${C.border}`,
                background: role === r ? (C.tealSoft || "#ECFDF5") : "#fff",
                color: role === r ? (C.teal || "#0F766E") : C.slate,
                fontSize: 11,
                fontWeight: 700,
                cursor: "pointer",
                textTransform: "capitalize",
              }}
            >
              {r}
            </button>
          ))}
          <button
            type="button"
            onClick={() => load(role)}
            title="Refresh"
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              border: `1px solid ${C.border}`,
              background: "#fff",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: C.slate,
            }}
          >
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      {panel === "byo" ? (
        <div style={{ padding: 14, background: "#fff", display: "grid", gap: 10 }}>
          <div style={{ fontSize: 12, color: C.slate, lineHeight: 1.45 }}>
            Paste full email HTML, or upload <strong>.html / .htm / .txt</strong>.
            Tokens like <code style={{ fontSize: 11 }}>{"{{company_name}}"}</code>,{" "}
            <code style={{ fontSize: 11 }}>{"{{when}}"}</code>,{" "}
            <code style={{ fontSize: 11 }}>{"{{join_url_href}}"}</code> fill from Company Profile — don’t hardcode the brand.
          </div>
          <textarea
            value={draftHtml}
            onChange={(e) => setDraftHtml(e.target.value)}
            rows={compact ? 10 : 14}
            placeholder={'<!DOCTYPE html>\n<html>… use {{company_name}}, {{when}}, {{join_url_href}} …</html>'}
            style={{
              width: "100%",
              boxSizing: "border-box",
              fontFamily: FONT_MONO || "ui-monospace, Menlo, monospace",
              fontSize: 12,
              lineHeight: 1.45,
              padding: 12,
              borderRadius: 10,
              border: `1px solid ${C.border}`,
              resize: "vertical",
              color: C.ink,
              background: "#FAFBFC",
            }}
          />
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, color: C.ink, cursor: "pointer" }}>
            <input type="checkbox" checked={applyBoth} onChange={(e) => setApplyBoth(e.target.checked)} />
            Save same HTML for attendee + host
          </label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <input ref={fileRef} type="file" accept=".html,.htm,.txt,text/html,text/plain" hidden onChange={onPickFile} />
            <button
              type="button"
              onClick={() => fileRef.current && fileRef.current.click()}
              style={{
                height: 34,
                padding: "0 12px",
                borderRadius: 8,
                border: `1px solid ${C.border}`,
                background: "#fff",
                fontWeight: 700,
                fontSize: 12,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <Upload size={13} /> Upload file
            </button>
            <button
              type="button"
              disabled={saving || !draftHtml.trim()}
              onClick={saveTemplate}
              style={{
                height: 34,
                padding: "0 14px",
                borderRadius: 8,
                border: "none",
                background: C.ink,
                color: "#fff",
                fontWeight: 700,
                fontSize: 12,
                cursor: saving || !draftHtml.trim() ? "default" : "pointer",
                opacity: saving || !draftHtml.trim() ? 0.6 : 1,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <Save size={13} /> {saving ? "Saving…" : "Save HTML"}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={clearTemplate}
              style={{
                height: 34,
                padding: "0 12px",
                borderRadius: 8,
                border: `1px solid ${C.border}`,
                background: "#fff",
                fontWeight: 700,
                fontSize: 12,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                color: C.slate,
              }}
            >
              <RotateCcw size={13} /> Use built-in
            </button>
            {saveMsg ? <span style={{ fontSize: 12, color: C.teal || "#0F766E", fontWeight: 600 }}>{saveMsg}</span> : null}
          </div>
        </div>
      ) : (
        <>
          {data ? (
            <div style={{ padding: "10px 14px", background: "#fff", borderBottom: `1px solid ${C.border}`, fontSize: 12, color: C.slate, display: "grid", gap: 4 }}>
              <div>
                <span style={{ fontWeight: 700, color: C.ink }}>Subject:</span> {data.subject}
              </div>
              <div>
                <span style={{ fontWeight: 700, color: C.ink }}>From:</span> {data.from}
                {data.source === "custom" ? (
                  <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: "#0F766E", background: "#ECFDF5", padding: "2px 8px", borderRadius: 999 }}>
                    Custom HTML
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}

          <div style={{ padding: compact ? 8 : 16, background: "#E8EDF2", minHeight: compact ? 320 : 420 }}>
            {loading ? (
              <div style={{ textAlign: "center", color: C.slate, fontSize: 13, padding: 40 }}>Loading preview…</div>
            ) : err ? (
              <div style={{ textAlign: "center", color: "#B91C1C", fontSize: 13, padding: 40 }}>{err}</div>
            ) : data?.html ? (
              <iframe
                title="Meeting invite email preview"
                srcDoc={data.html}
                sandbox=""
                style={{
                  width: "100%",
                  height: compact ? 360 : 520,
                  border: "none",
                  borderRadius: 12,
                  background: "#E8EDF2",
                  display: "block",
                }}
              />
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
