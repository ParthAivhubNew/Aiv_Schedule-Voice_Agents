import React, { useState } from "react";
import { X, UploadCloud, FileSpreadsheet, Check, AlertTriangle, ArrowRight, ArrowLeft, Radio, Phone, Sparkles } from "lucide-react";
import { C, FONT_BODY, FONT_DISPLAY, FONT_MONO } from "../tokens";
import { api } from "../api/apiClient";

export function NewMissionModal({ onClose, onCreate, registry = [] }) {
  const [tab, setTab] = useState("discover"); // "discover" or "upload"
  const [title, setTitle] = useState("");
  const [sector, setSector] = useState("Logistics");
  const [region, setRegion] = useState("Manchester");
  const [prompt, setPrompt] = useState("Find mid-market logistics companies in Greater Manchester with 20-200 vehicles.");
  
  // File upload state
  const [file, setFile] = useState(null);
  const [parsing, setParsing] = useState(false);
  const [parseResult, setParseResult] = useState(null);
  const [filter, setFilter] = useState("all"); // "all", "issues", "clean"
  
  // Scheduling & Concurrency state
  const [concurrency, setConcurrency] = useState(5);
  const [callWindow, setCallWindow] = useState("09:00–17:30");
  const [defaultChannel, setDefaultChannel] = useState("voice");

  const handleFileUpload = async (e) => {
    const uploadedFile = e.target.files[0];
    if (!uploadedFile) return;
    setFile(uploadedFile);
    setParsing(true);

    const formData = new FormData();
    formData.append("file", uploadedFile);

    try {
      const data = await api.parseSpreadsheet(formData);
      setParseResult(data);
      if (!title) setTitle(`Outreach — ${uploadedFile.name.replace(/\.[^/.]+$/, "")}`);
    } catch (err) {
      alert("Error parsing file: " + err.message);
    } finally {
      setParsing(false);
    }
  };

  const handleToggleRow = (rowId) => {
    if (!parseResult) return;
    setParseResult({
      ...parseResult,
      rows: parseResult.rows.map((r) => (r.id === rowId ? { ...r, checked: !r.checked } : r)),
    });
  };

  const handleSubmit = async () => {
    let finalTitle = title.trim();
    if (!finalTitle) {
      finalTitle = tab === "discover" ? `${sector} companies — ${region}` : `Provided contact list (${parseResult?.rows?.length || 0} leads)`;
    }

    let prospectsData = [];
    if (tab === "upload" && parseResult) {
      prospectsData = parseResult.rows
        .filter((r) => r.checked)
        .map((r) => ({
          name: r.name,
          phone: r.phone,
          website: r.website,
          contact: r.contact,
          channel: r.channel || defaultChannel,
          sector: sector,
          region: region,
        }));
    }

    const payload = {
      title: finalTitle,
      sector,
      region,
      source: tab === "discover" ? "discover" : "manual",
      prompt: tab === "discover" ? prompt : null,
      concurrency,
      call_window: callWindow,
      default_channel: defaultChannel,
      prospects: prospectsData,
    };

    try {
      await onCreate(payload);
      onClose();
    } catch (err) {
      alert("Failed to launch mission: " + err.message);
    }
  };

  const cleanCount = parseResult?.rows?.filter((r) => r.issues.length === 0).length || 0;
  const issuesCount = parseResult?.rows?.filter((r) => r.issues.length > 0).length || 0;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(13,15,23,0.6)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: 20,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 720,
          maxHeight: "90vh",
          background: "#fff",
          borderRadius: 22,
          border: `1px solid ${C.border}`,
          boxShadow: "0 28px 70px rgba(13,15,23,0.25)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{ padding: "20px 26px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18.5, color: C.ink }}>
              Launch New Outreach Mission
            </div>
            <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate, marginTop: 2 }}>
              Configure autonomous AI voice & multi-channel prospecting campaign.
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ width: 32, height: 32, borderRadius: 8, border: "none", background: C.paperSoft, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            <X size={16} color={C.ink} />
          </button>
        </div>

        {/* Tab Selector */}
        <div style={{ display: "flex", borderBottom: `1px solid ${C.border}`, background: C.paperSoft, padding: "4px 8px" }}>
          <button
            onClick={() => setTab("discover")}
            style={{
              flex: 1,
              padding: "10px 0",
              borderRadius: 9,
              border: "none",
              background: tab === "discover" ? "#fff" : "transparent",
              color: tab === "discover" ? C.cobalt : C.slate,
              fontFamily: FONT_BODY,
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              boxShadow: tab === "discover" ? "0 2px 8px rgba(0,0,0,0.06)" : "none",
            }}
          >
            <Sparkles size={15} color={tab === "discover" ? C.cobalt : C.slate} /> AI Business Discovery
          </button>
          <button
            onClick={() => setTab("upload")}
            style={{
              flex: 1,
              padding: "10px 0",
              borderRadius: 9,
              border: "none",
              background: tab === "upload" ? "#fff" : "transparent",
              color: tab === "upload" ? C.cobalt : C.slate,
              fontFamily: FONT_BODY,
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              boxShadow: tab === "upload" ? "0 2px 8px rgba(0,0,0,0.06)" : "none",
            }}
          >
            <FileSpreadsheet size={15} color={tab === "upload" ? C.cobalt : C.slate} /> Upload Contact List (CSV / Excel)
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: 26 }}>
          {tab === "discover" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, color: C.textInk, marginBottom: 6 }}>
                  Discovery Prompt
                </label>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={3}
                  style={{ width: "100%", padding: 12, borderRadius: 10, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13 }}
                  placeholder="Describe your ideal target business profile and region..."
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <div>
                  <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, color: C.textInk, marginBottom: 6 }}>
                    Sector
                  </label>
                  <input
                    type="text"
                    value={sector}
                    onChange={(e) => setSector(e.target.value)}
                    style={{ width: "100%", height: 38, padding: "0 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13 }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, color: C.textInk, marginBottom: 6 }}>
                    Region
                  </label>
                  <input
                    type="text"
                    value={region}
                    onChange={(e) => setRegion(e.target.value)}
                    style={{ width: "100%", height: 38, padding: "0 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13 }}
                  />
                </div>
              </div>
            </div>
          ) : (
            <div>
              {!parseResult ? (
                <div
                  style={{
                    border: `2px dashed ${C.border}`,
                    borderRadius: 16,
                    padding: "40px 20px",
                    textAlign: "center",
                    background: C.paperSoft,
                  }}
                >
                  <UploadCloud size={38} color={C.cobalt} style={{ margin: "0 auto 12px" }} />
                  <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16.5, color: C.ink, marginBottom: 4 }}>
                    Choose a spreadsheet to import
                  </div>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate, marginBottom: 18 }}>
                    Supports .CSV, .XLSX, and .XLS files. Auto-detects company name, phone, and contact person.
                  </div>
                  <input
                    type="file"
                    accept=".csv,.xlsx,.xls"
                    onChange={handleFileUpload}
                    id="file-upload-input"
                    style={{ display: "none" }}
                  />
                  <label
                    htmlFor="file-upload-input"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      height: 40,
                      padding: "0 20px",
                      borderRadius: 10,
                      background: C.gradientPrimary,
                      color: "#fff",
                      fontFamily: FONT_BODY,
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: "pointer",
                      boxShadow: C.glowPrimary,
                    }}
                  >
                    Select File
                  </label>
                  {parsing && <div style={{ marginTop: 12, fontSize: 12, color: C.cobalt }}>Parsing file...</div>}
                </div>
              ) : (
                <div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                    <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.slate }}>
                      Parsed <b>{parseResult.totalRows}</b> contacts from <i>{parseResult.filename}</i>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        onClick={() => setFilter("all")}
                        style={{
                          padding: "4px 10px",
                          borderRadius: 6,
                          border: `1px solid ${C.border}`,
                          background: filter === "all" ? C.ink : "#fff",
                          color: filter === "all" ? "#fff" : C.slate,
                          fontSize: 11.5,
                          cursor: "pointer",
                        }}
                      >
                        All ({parseResult.rows.length})
                      </button>
                      <button
                        onClick={() => setFilter("clean")}
                        style={{
                          padding: "4px 10px",
                          borderRadius: 6,
                          border: `1px solid ${C.border}`,
                          background: filter === "clean" ? C.teal : "#fff",
                          color: filter === "clean" ? "#fff" : C.teal,
                          fontSize: 11.5,
                          cursor: "pointer",
                        }}
                      >
                        Clean ({cleanCount})
                      </button>
                      <button
                        onClick={() => setFilter("issues")}
                        style={{
                          padding: "4px 10px",
                          borderRadius: 6,
                          border: `1px solid ${C.border}`,
                          background: filter === "issues" ? C.amber : "#fff",
                          color: filter === "issues" ? "#fff" : C.amber,
                          fontSize: 11.5,
                          cursor: "pointer",
                        }}
                      >
                        Flagged ({issuesCount})
                      </button>
                    </div>
                  </div>

                  <div style={{ maxHeight: 200, overflowY: "auto", border: `1px solid ${C.border}`, borderRadius: 10 }}>
                    {parseResult.rows
                      .filter((r) => (filter === "all" ? true : filter === "clean" ? r.issues.length === 0 : r.issues.length > 0))
                      .map((row) => (
                        <div
                          key={row.id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            padding: "8px 12px",
                            borderBottom: `1px solid ${C.border}`,
                            background: row.issues.length > 0 ? C.amberSoft : "#fff",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <input
                              type="checkbox"
                              checked={row.checked}
                              onChange={() => handleToggleRow(row.id)}
                            />
                            <div>
                              <span style={{ fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, color: C.ink }}>
                                {row.name || "Missing Name"}
                              </span>
                              <span style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.slate, marginLeft: 8 }}>
                                {row.phone || "No phone"}
                              </span>
                            </div>
                          </div>
                          {row.issues.length > 0 && (
                            <span style={{ fontSize: 10.5, color: C.amber, fontWeight: 600 }}>
                              {row.issues.join(", ")}
                            </span>
                          )}
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Concurrency & Pacing */}
          <div style={{ marginTop: 22, paddingTop: 18, borderTop: `1px solid ${C.border}` }}>
            <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 700, color: C.ink, marginBottom: 10 }}>
              Calling Pacing & Compliance
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div>
                <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 11.5, color: C.slate, marginBottom: 4 }}>
                  Concurrent Calling Lines
                </label>
                <select
                  value={concurrency}
                  onChange={(e) => setConcurrency(Number(e.target.value))}
                  style={{ width: "100%", height: 38, padding: "0 10px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13 }}
                >
                  <option value={1}>1 line (sequential)</option>
                  <option value={5}>5 lines (recommended)</option>
                  <option value={10}>10 lines (high throughput)</option>
                  <option value={20}>20 lines (enterprise max)</option>
                </select>
              </div>

              <div>
                <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 11.5, color: C.slate, marginBottom: 4 }}>
                  UK PECR Window
                </label>
                <select
                  value={callWindow}
                  onChange={(e) => setCallWindow(e.target.value)}
                  style={{ width: "100%", height: 38, padding: "0 10px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13 }}
                >
                  <option value="09:00–17:30">09:00–17:30 (Respectful Office Hours)</option>
                  <option value="08:00–21:00">08:00–21:00 (Full PECR Legal Window)</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: "16px 26px", borderTop: `1px solid ${C.border}`, background: C.paperSoft, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <button
            onClick={onClose}
            style={{ padding: "8px 16px", borderRadius: 9, border: `1px solid ${C.border}`, background: "#fff", color: C.slate, fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, cursor: "pointer" }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 22px",
              borderRadius: 10,
              border: "none",
              background: C.gradientPrimary,
              color: "#fff",
              fontFamily: FONT_BODY,
              fontSize: 13.5,
              fontWeight: 600,
              cursor: "pointer",
              boxShadow: C.glowPrimary,
            }}
          >
            Launch Outreach <ArrowRight size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
