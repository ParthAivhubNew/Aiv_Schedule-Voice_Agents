import React, { useCallback, useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle, RefreshCw, Save, ShieldAlert, Wallet, ExternalLink, Info, Receipt } from "lucide-react";
import { C, FONT_DISPLAY, FONT_BODY, FONT_MONO } from "../tokens";
import { adminApi } from "./adminApi";
import { Note, PageTitle, Pill, btn, card, cell, heading, input, useAction, useLoad } from "./ui";

export function Balances({ canEdit }) {
  const [data, err, reload] = useLoad(adminApi.platformBalances);
  const [msg, run] = useAction(reload);
  const [checklist, setChecklist] = useState([]);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    if (data?.checklist) {
      setChecklist(data.checklist);
    }
  }, [data]);

  if (!data) {
    return (
      <>
        <PageTitle title="Platform Balances" />
        <Note error>{err || "Loading platform balances…"}</Note>
      </>
    );
  }

  const { pollable = {} } = data;
  const telnyx = pollable.telnyx || {};
  const deepseek = pollable.deepseek || {};

  const handleToggleAlert = (id) => {
    if (!canEdit) return;
    setChecklist((prev) =>
      prev.map((item) => (item.id === id ? { ...item, alert_configured: !item.alert_configured } : item))
    );
    setSaveSuccess(false);
  };

  const handleUpdateField = (id, field, value) => {
    if (!canEdit) return;
    setChecklist((prev) =>
      prev.map((item) => (item.id === id ? { ...item, [field]: value } : item))
    );
    setSaveSuccess(false);
  };

  const handleSaveChecklist = async () => {
    setSaving(true);
    setSaveSuccess(false);
    try {
      await run(() => adminApi.saveBalanceChecklist(checklist));
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (_) {
      // error handled by useAction
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ maxWidth: 1040, display: "grid", gap: 24 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 22, color: C.ink, margin: 0 }}>
            Platform Account Balances
          </h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: C.slate }}>
            Live funds on main company provider accounts and spend-alert monitoring checklist.
          </p>
        </div>
        <button
          type="button"
          onClick={reload}
          style={{ ...btn(false), display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}
        >
          <RefreshCw size={14} /> Refresh Balances
        </button>
      </div>

      {msg && <Note error={msg.error}>{msg.text}</Note>}

      {/* ── Section 1: Live Polled Balances ── */}
      <div>
        <div style={{ ...heading, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
          <Wallet size={16} color="#8B5CF6" /> Live Account Balances
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
          {/* Telnyx Card */}
          <div style={{ ...card, display: "grid", gap: 12, border: `1px solid ${C.border}` }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontWeight: 700, fontSize: 15, color: C.ink }}>Telnyx Telephony</div>
              {telnyx.status === "ok" ? (
                parseFloat(telnyx.available_credit || 0) < 20 ? (
                  <Pill tone="amber">Low Balance</Pill>
                ) : (
                  <Pill tone="green">Live Connected</Pill>
                )
              ) : (
                <Pill tone="red">{telnyx.error || "Offline"}</Pill>
              )}
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                Available Credit
              </div>
              <div style={{ fontFamily: FONT_DISPLAY, fontSize: 28, fontWeight: 700, color: C.ink, marginTop: 2 }}>
                {telnyx.status === "ok" ? `$${parseFloat(telnyx.available_credit || 0).toFixed(2)} ${telnyx.currency || "USD"}` : "—"}
              </div>
            </div>
            <div style={{ fontSize: 12, color: C.slate, borderTop: `1px solid ${C.border}`, paddingTop: 8, display: "flex", justifyContent: "space-between" }}>
              <span>Total Account Balance:</span>
              <span style={{ fontWeight: 600, color: C.ink }}>
                {telnyx.status === "ok" ? `$${parseFloat(telnyx.balance || 0).toFixed(2)}` : "—"}
              </span>
            </div>
          </div>

          {/* DeepSeek Card */}
          <div style={{ ...card, display: "grid", gap: 12, border: `1px solid ${C.border}` }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontWeight: 700, fontSize: 15, color: C.ink }}>DeepSeek LLM</div>
              {deepseek.status === "ok" ? (
                parseFloat(deepseek.total_balance || 0) < 10 ? (
                  <Pill tone="amber">Low Balance</Pill>
                ) : (
                  <Pill tone="green">Live Connected</Pill>
                )
              ) : (
                <Pill tone={deepseek.status === "not_configured" ? "amber" : "red"}>
                  {deepseek.error || "Offline"}
                </Pill>
              )}
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                Total Balance
              </div>
              <div style={{ fontFamily: FONT_DISPLAY, fontSize: 28, fontWeight: 700, color: C.ink, marginTop: 2 }}>
                {deepseek.status === "ok" ? `$${parseFloat(deepseek.total_balance || 0).toFixed(2)} ${deepseek.currency || "USD"}` : "—"}
              </div>
            </div>
            <div style={{ fontSize: 12, color: C.slate, borderTop: `1px solid ${C.border}`, paddingTop: 8, display: "flex", justifyContent: "space-between" }}>
              <span>Topped-up: ${parseFloat(deepseek.topped_up_balance || 0).toFixed(2)}</span>
              <span>Granted: ${parseFloat(deepseek.granted_balance || 0).toFixed(2)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Section 2: Non-pollable Providers Spend-Alert Checklist ── */}
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
          <div>
            <div style={{ ...heading, display: "flex", alignItems: "center", gap: 8 }}>
              <ShieldAlert size={16} color="#F59E0B" /> Spend Alerts Checklist (Non-Pollable Providers)
            </div>
            <div style={{ fontSize: 12.5, color: C.slate, marginTop: 2 }}>
              Providers without a public balance API. Configure spend alerts in each provider dashboard to prevent unexpected service stops.
            </div>
          </div>
          {canEdit && (
            <button
              type="button"
              onClick={handleSaveChecklist}
              disabled={saving}
              style={{
                ...btn(true, saving),
                background: saveSuccess ? "#10B981" : "#8B5CF6",
                color: "#fff",
                border: "none",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              <Save size={14} /> {saving ? "Saving…" : saveSuccess ? "Saved!" : "Save Changes"}
            </button>
          )}
        </div>

        <div style={{ ...card, padding: 0, overflow: "hidden", border: `1px solid ${C.border}` }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, textAlign: "left" }}>
              <thead>
                <tr style={{ background: "#F9FAFB", borderBottom: `1px solid ${C.border}`, color: C.slate, fontWeight: 600, fontSize: 12 }}>
                  <th style={{ padding: "10px 16px", width: 40 }}>Status</th>
                  <th style={{ padding: "10px 16px" }}>Provider</th>
                  <th style={{ padding: "10px 16px", width: 140 }}>Alert Threshold</th>
                  <th style={{ padding: "10px 16px" }}>Notes / Configuration Instructions</th>
                </tr>
              </thead>
              <tbody>
                {checklist.map((item) => (
                  <tr key={item.id} style={{ borderBottom: `1px solid ${C.border}`, background: item.alert_configured ? "#fff" : "#FFFBEB" }}>
                    <td style={{ padding: "12px 16px", textAlign: "center" }}>
                      <input
                        type="checkbox"
                        aria-label={`Toggle alert for ${item.name}`}
                        checked={Boolean(item.alert_configured)}
                        disabled={!canEdit}
                        onChange={() => handleToggleAlert(item.id)}
                        style={{ width: 16, height: 16, cursor: canEdit ? "pointer" : "default", accentColor: "#10B981" }}
                      />
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <div style={{ fontWeight: 600, color: C.ink }}>{item.name}</div>
                      <div style={{ fontSize: 11, color: item.alert_configured ? "#10B981" : "#D97706" }}>
                        {item.alert_configured ? "✓ Dashboard alert active" : "⚠ Alert not verified"}
                      </div>
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <input
                        type="text"
                        value={item.threshold || ""}
                        disabled={!canEdit}
                        onChange={(e) => handleUpdateField(item.id, "threshold", e.target.value)}
                        placeholder="$20 / month"
                        style={{ ...input, width: "100%", boxSizing: "border-box", fontSize: 12.5 }}
                      />
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <input
                        type="text"
                        value={item.notes || ""}
                        disabled={!canEdit}
                        onChange={(e) => handleUpdateField(item.id, "notes", e.target.value)}
                        placeholder="Dashboard alert location notes..."
                        style={{ ...input, width: "100%", boxSizing: "border-box", fontSize: 12.5 }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <VendorSpend />
    </div>
  );
}

// ── Section 3: Leadgen data-provider spend estimate ─────────────────────────
// Real $ already spent this month at each data provider (exact for the email finders, which log
// every attempt; a call-count estimate for Tavily/Telnyx lookup, which don't). No auto top-up —
// this just tells staff roughly how much to keep funded in each provider's own account.
function VendorSpend() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      setData(await adminApi.vendorCosts(month));
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  }, [month]);
  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        <div>
          <div style={{ ...heading, display: "flex", alignItems: "center", gap: 8 }}>
            <Receipt size={16} color="#2563EB" /> Data provider spend (Leadgen)
          </div>
          <div style={{ fontSize: 12.5, color: C.slate, marginTop: 2 }}>
            What this month's lead research has actually cost at each provider, so each account can be funded to cover it. Not automatic — fund these by hand on the provider's own site.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="month" aria-label="Month" value={month} onChange={(e) => setMonth(e.target.value)} style={input} />
          <button type="button" style={btn(false, busy)} disabled={busy} onClick={load}><RefreshCw size={13} /> Refresh</button>
        </div>
      </div>
      <Note error>{error}</Note>
      {data && (
        <div style={{ ...card, padding: 0, overflow: "hidden", border: `1px solid ${C.border}` }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, textAlign: "left" }}>
              <thead>
                <tr style={{ background: "#F9FAFB", borderBottom: `1px solid ${C.border}`, color: C.slate, fontWeight: 600, fontSize: 12 }}>
                  <th style={{ padding: "10px 16px" }}>Provider</th>
                  <th style={{ padding: "10px 16px", textAlign: "right" }}>Calls this month</th>
                  <th style={{ padding: "10px 16px", textAlign: "right" }}>Est. spend (USD)</th>
                  <th style={{ padding: "10px 16px" }}>Basis</th>
                </tr>
              </thead>
              <tbody>
                {data.providers.length === 0 && (
                  <tr><td colSpan={4} style={{ ...cell, color: C.slate }}>No provider usage this month.</td></tr>
                )}
                {data.providers.map((p) => (
                  <tr key={p.provider} style={{ borderBottom: `1px solid ${C.border}` }}>
                    <td style={{ padding: "12px 16px", fontWeight: 600, color: C.ink }}>{p.label}</td>
                    <td style={{ padding: "12px 16px", textAlign: "right", fontFamily: FONT_MONO }}>{p.calls}</td>
                    <td style={{ padding: "12px 16px", textAlign: "right", fontFamily: FONT_MONO, fontWeight: 600 }}>${p.costUsd.toFixed(2)}</td>
                    <td style={{ padding: "12px 16px", fontSize: 11.5, color: C.slate }}>{p.exact ? "Exact (logged per call)" : "Estimated (call count × known price)"}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td style={{ padding: "12px 16px", fontWeight: 700, color: C.ink }}>Total</td>
                  <td />
                  <td style={{ padding: "12px 16px", textAlign: "right", fontFamily: FONT_MONO, fontWeight: 700 }}>${data.totalUsd.toFixed(2)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
