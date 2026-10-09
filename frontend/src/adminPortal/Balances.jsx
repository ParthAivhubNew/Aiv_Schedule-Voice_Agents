import React, { useCallback, useEffect, useState } from "react";
import { RefreshCw, Save, ShieldAlert, Wallet, Receipt } from "lucide-react";
import { C, FONT_DISPLAY, FONT_MONO } from "../tokens";
import { adminApi } from "./adminApi";
import { EmailFinderReport } from "./EmailFinderReport";
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
        <div style={{ fontSize: 12.5, color: C.slate, marginTop: -8, marginBottom: 12 }}>
          Polled every 6 hours. Runway is how fast each is actually depleting, from what really happened — not a guess.
          Headroom (where shown) is that balance minus what we still owe customers in credits they've already bought.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
          {Object.entries(pollable).map(([id, p]) => <BalanceCard key={id} p={p} />)}
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
      <EmailFinderReport canEdit={canEdit} />
      <ModelPricing />
    </div>
  );
}

// ── Live provider cards: one shape for every pollable provider, whatever its unit ──
function BalanceCard({ p }) {
  const tone = { ok: "green", low: "amber", critical: "red", error: "red", not_configured: "amber" }[p.status] || "amber";
  const label = { ok: "Healthy", low: "Low", critical: "CRITICAL", not_configured: "Not set up" }[p.status] || (p.error || "Offline");
  const connected = p.status === "ok" || p.status === "low" || p.status === "critical";
  const fmtRemaining = (n) => (p.unit === "usd" ? `$${Number(n || 0).toFixed(2)}` : `${Number(n || 0).toLocaleString()} ${p.unit || ""}`);
  return (
    <div style={{ ...card, display: "grid", gap: 10, border: `1px solid ${C.border}` }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontWeight: 700, fontSize: 14.5, color: C.ink }}>{p.name}</div>
        <Pill tone={tone}>{label}</Pill>
      </div>
      {connected ? (
        <>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em" }}>Remaining</div>
            <div style={{ fontFamily: FONT_DISPLAY, fontSize: 24, fontWeight: 700, color: C.ink, marginTop: 2 }}>{fmtRemaining(p.remaining)}</div>
          </div>
          <div style={{ fontSize: 12, color: C.slate, display: "grid", gap: 3, borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
            <div>Runway: <b style={{ color: C.ink }}>{p.runwayDays != null ? `${p.runwayDays} day(s)` : "not enough history yet"}</b></div>
            {p.headroomUsd != null && <div>Headroom after customer liability: <b style={{ color: C.ink }}>${Number(p.headroomUsd).toFixed(2)}</b></div>}
            {p.recommendedTopupUsd ? <div>Recommended top-up: <b style={{ color: C.ink }}>${Number(p.recommendedTopupUsd).toFixed(2)}</b> (~2 weeks)</div> : null}
          </div>
        </>
      ) : (
        <div style={{ fontSize: 12.5, color: C.slate }}>{p.error || "—"}</div>
      )}
    </div>
  );
}

// ── Section 4: Model Pricing -- every provider/model real usage has ever touched, auto-detected ──
function ModelPricing() {
  const [data, err, reload] = useLoad(adminApi.modelPricing);
  const [msg, run] = useAction(reload);
  const [drafts, setDrafts] = useState({});

  const items = data?.items || [];
  const draftOf = (it) => ({ priceIn: it.priceIn, priceOut: it.priceOut, ...(drafts[it.id] || {}) });
  const set = (id, field, value) => setDrafts((d) => ({ ...d, [id]: { ...d[id], [field]: value } }));
  const save = (it) => {
    const d = draftOf(it);
    run(() => adminApi.saveModelPrice(it.id, parseFloat(d.priceIn) || 0, parseFloat(d.priceOut) || 0), "Saved.");
  };

  return (
    <div>
      <div style={{ ...heading, display: "flex", alignItems: "center", gap: 8 }}>
        <Receipt size={16} color="#2563EB" /> Model Pricing
      </div>
      <div style={{ fontSize: 12.5, color: C.slate, marginTop: 2, marginBottom: 12 }}>
        Every provider/model real AI calls have actually used, found automatically -- nothing here is a fixed list.
        A new model shows up the first time it's called, waiting for a price. $ per 1K tokens (LLM in/out separately),
        per call (image, email finders, lookups), per minute (speech-to-text) or per 1K characters (text-to-speech).
      </div>
      <Note error={err}>{err}</Note>
      <Note error={msg.error}>{msg.text}</Note>
      {items.length === 0 ? (
        <div style={{ ...card, color: C.slate, fontSize: 13 }}>No AI usage recorded yet.</div>
      ) : (
        <div style={{ ...card, padding: 0, overflow: "hidden", border: `1px solid ${C.border}` }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, textAlign: "left" }}>
              <thead>
                <tr style={{ background: "#F9FAFB", borderBottom: `1px solid ${C.border}`, color: C.slate, fontWeight: 600, fontSize: 12 }}>
                  <th style={{ padding: "10px 16px" }}>Provider</th>
                  <th style={{ padding: "10px 16px" }}>Model</th>
                  <th style={{ padding: "10px 16px" }}>Kind</th>
                  <th style={{ padding: "10px 16px" }}>Price in / unit</th>
                  <th style={{ padding: "10px 16px" }}>Price out (LLM)</th>
                  <th style={{ padding: "10px 16px" }}>Status</th>
                  <th style={{ padding: "10px 16px" }} />
                </tr>
              </thead>
              <tbody>
                {items.map((it) => {
                  const d = draftOf(it);
                  return (
                    <tr key={it.id} style={{ borderBottom: `1px solid ${C.border}`, background: it.confirmed ? "#fff" : "#FFFBEB" }}>
                      <td style={{ padding: "10px 16px", fontWeight: 600 }}>{it.provider}</td>
                      <td style={{ padding: "10px 16px", fontFamily: FONT_MONO, fontSize: 12 }}>{it.model || "—"}</td>
                      <td style={{ padding: "10px 16px" }}>{it.kind}</td>
                      <td style={{ padding: "10px 16px" }}>
                        <input type="number" step="0.0001" value={d.priceIn} onChange={(e) => set(it.id, "priceIn", e.target.value)} style={{ ...input, width: 110 }} />
                      </td>
                      <td style={{ padding: "10px 16px" }}>
                        {it.kind === "llm" ? (
                          <input type="number" step="0.0001" value={d.priceOut} onChange={(e) => set(it.id, "priceOut", e.target.value)} style={{ ...input, width: 110 }} />
                        ) : <span style={{ color: C.slate }}>—</span>}
                      </td>
                      <td style={{ padding: "10px 16px" }}>
                        {it.confirmed ? <Pill tone="green">Priced</Pill> : <Pill tone="amber">Needs a price</Pill>}
                      </td>
                      <td style={{ padding: "10px 16px" }}>
                        <button type="button" style={btn(false)} onClick={() => save(it)}>Save</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
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
