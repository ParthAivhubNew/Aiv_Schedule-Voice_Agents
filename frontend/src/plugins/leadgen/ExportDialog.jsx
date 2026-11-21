import React, { useMemo, useState } from "react";
import { AlertCircle, Download, FileSpreadsheet, ShieldCheck, X } from "lucide-react";
import { C, FONT_BODY } from "../../tokens";
import { saveBlob } from "./importMatchLogic";

export const GOOGLE_WITHHELD_NOTICE =
  "Some of this data came from Google's API. Google's rules don't allow us to let you download it. " +
  "You can see it and use it inside Outreach, but it is left out of the file.";

// Checks if a field originates from Google Places / API
export function isGoogleSourced(lead, field) {
  if (!lead) return false;
  if (lead.source === "google_places") return true;
  const sources = lead.field_sources || {};
  if (sources[field] === "google_places") return true;
  // Also check dossier citations if present
  const research = lead.research?.sources || [];
  if (research.some((s) => String(s.source_type || "").toLowerCase().includes("google_places"))) {
    // If not confirmed by the company's own site or registry, it is restricted Google data
    if (sources[field] !== "website" && sources[field] !== "register") {
      return true;
    }
  }
  return false;
}

// Cleans rows so that Google-sourced contacts are strictly stopped from downloading
export function sanitizeExportRows(accounts) {
  let withheldCount = 0;
  const rows = (accounts || []).map((a) => {
    const googlePhone = isGoogleSourced(a, "phone");
    const googleEmail = isGoogleSourced(a, "email");
    const googleWebsite = isGoogleSourced(a, "website");

    if (googlePhone) withheldCount += 1;
    if (googleEmail) withheldCount += 1;
    if (googleWebsite) withheldCount += 1;

    return {
      "Company Name": a.name || "",
      "Company Number": a.registration_number || a.company_number || "",
      "Contact Name": a.contact_name || "",
      "Contact Title": a.contact_title || "",
      "Phone": googlePhone ? "" : (a.phone || ""),
      "Email": googleEmail ? "" : (a.email || ""),
      "Website": googleWebsite ? "" : (a.website || ""),
      "Address": a.address || a.street || "",
      "Postcode": a.postcode || "",
      "Industry": a.industry || a.sic_text || "",
      "Stage": a.stage || "new",
      "Source": a.source || "Outreach",
      "Google Data Withheld": (googlePhone || googleEmail || googleWebsite) ? "Yes" : "No",
    };
  });

  return { rows, withheldCount };
}

// Converts array of row objects into valid CSV
export function exportToCsvString(rows) {
  if (!rows || !rows.length) return "";
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.map((h) => `"${String(h).replace(/"/g, '""')}"`).join(","),
    ...rows.map((r) =>
      headers
        .map((h) => {
          const val = r[h] == null ? "" : String(r[h]);
          return `"${val.replace(/"/g, '""')}"`;
        })
        .join(",")
    ),
  ];
  return lines.join("\r\n");
}

export function ExportDialog({ open, onClose, accounts = [], onToast }) {
  const [busy, setBusy] = useState(false);

  const { rows, withheldCount } = useMemo(() => sanitizeExportRows(accounts), [accounts]);

  if (!open) return null;

  const handleExport = () => {
    setBusy(true);
    try {
      const csvContent = exportToCsvString(rows);
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const filename = `outreach-companies-${new Date().toISOString().slice(0, 10)}.csv`;
      saveBlob(blob, filename);

      const msg = withheldCount > 0
        ? `Exported ${rows.length} companies. ${withheldCount} restricted Google values safely withheld.`
        : `Exported ${rows.length} companies to CSV.`;
      onToast?.(msg);
      onClose();
    } catch (e) {
      onToast?.(e.message || "Export failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-dialog-title"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.45)",
        backdropFilter: "blur(2px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        className="ui-card"
        style={{
          width: "100%",
          maxWidth: 520,
          background: "#fff",
          borderRadius: 12,
          padding: 24,
          boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
          fontFamily: FONT_BODY,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 8,
                background: C.cobaltSoft,
                color: C.cobalt,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <FileSpreadsheet size={20} />
            </div>
            <div>
              <h2 id="export-dialog-title" style={{ margin: 0, fontSize: 16, fontWeight: 700, color: C.ink }}>
                Export companies to CSV
              </h2>
              <div style={{ fontSize: 12.5, color: C.slate }}>
                {accounts.length.toLocaleString()} {accounts.length === 1 ? "record" : "records"} ready to download
              </div>
            </div>
          </div>
          <button
            type="button"
            className="ui-btn ui-btn--ghost ui-btn--sm"
            onClick={onClose}
            aria-label="Close export dialog"
            style={{ padding: 4 }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Google Data Policy Alert */}
        <div
          role="note"
          style={{
            padding: "12px 14px",
            background: "#FFFBEB",
            border: "1px solid #FDE68A",
            borderRadius: 8,
            display: "flex",
            gap: 10,
            alignItems: "flex-start",
          }}
        >
          <AlertCircle size={18} color="#D97706" style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 12.5, color: "#92400E", lineHeight: 1.45 }}>
            <strong>Google Data Policy:</strong> {GOOGLE_WITHHELD_NOTICE}
            {withheldCount > 0 ? (
              <div style={{ marginTop: 4, fontWeight: 600 }}>
                {withheldCount} Google-sourced {withheldCount === 1 ? "field will" : "fields will"} be withheld from the file.
              </div>
            ) : null}
          </div>
        </div>

        {/* Breakdown of what's included */}
        <div style={{ fontSize: 13, color: C.textInk, lineHeight: 1.5, display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontWeight: 600, color: C.ink, marginBottom: 2 }}>Included in this download:</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <ShieldCheck size={14} color="#16A34A" /> Company names, numbers, verified addresses & postcodes
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <ShieldCheck size={14} color="#16A34A" /> Direct contacts & verified websites from registry filings
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <ShieldCheck size={14} color="#16A34A" /> Activity status and stage progression
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
          <button type="button" className="ui-btn ui-btn--ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="ui-btn ui-btn--primary"
            onClick={handleExport}
            disabled={busy || !accounts.length}
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            <Download size={15} />
            {busy ? "Preparing file…" : `Download CSV (${accounts.length.toLocaleString()})`}
          </button>
        </div>
      </div>
    </div>
  );
}
