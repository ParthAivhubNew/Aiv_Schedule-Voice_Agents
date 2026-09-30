import React, { useCallback, useEffect, useState } from "react";
import { Coins, Plus } from "lucide-react";
import { C, FONT_BODY, FONT_DISPLAY, FONT_MONO } from "../tokens";
import { api } from "../api/apiClient";

const input = { padding: "8px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13, fontFamily: FONT_BODY, background: "#fff", boxSizing: "border-box" };
const btn = (primary) => ({
  display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 9, cursor: "pointer",
  border: primary ? "none" : `1px solid ${C.border}`, background: primary ? C.ink : "#fff", color: primary ? "#fff" : C.textInk,
  fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600,
});
const card = { border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 16px", background: "#fff" };
const heading = { fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 14, color: C.textInk, margin: "18px 0 8px" };
const fmt = (n) => Number(n || 0).toLocaleString();

// The organisation's credit balance, what used it, and (for OutReach staff) adding credits.
export function CreditsTab() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [lowAt, setLowAt] = useState("");

  const load = useCallback(async () => {
    try {
      const d = await api.getCredits();
      setData(d);
      setLowAt(String(d.lowAt));
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (error) return <div style={{ color: C.red, fontSize: 12.5 }}>{error}</div>;
  if (!data) return <div style={{ color: C.slate, fontSize: 13 }}>Loading…</div>;

  const saveLow = async () => {
    try {
      setData(await api.setCreditSettings({ lowAt: Number(lowAt) || 0 }));
    } catch (err) {
      setError(err.message);
    }
  };

  const low = data.enforce && data.balance <= data.lowAt;
  return (
    <div style={{ fontFamily: FONT_BODY }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
        <div style={card}>
          <div style={{ fontSize: 12, color: C.slate }}>Balance</div>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 28, color: low ? C.red : C.textInk }}>{fmt(data.balance)}</div>
          <div style={{ fontSize: 12, color: C.slate }}>{data.enforce ? "Calls and AI writing stop at zero" : "Tracking only: nothing is stopped"}</div>
        </div>
        {Object.entries(data.rates).map(([key, r]) => (
          <div key={key} style={card}>
            <div style={{ fontSize: 12, color: C.slate }}>{r.label}</div>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 20, color: C.textInk }}>{r.credits} <span style={{ fontSize: 12, fontWeight: 500, color: C.slate }}>credits / {r.unit}</span></div>
            <div style={{ fontSize: 12, color: C.slate }}>
              Last 30 days: {fmt(data.usage30d[key]?.quantity)} {r.unit}s, {fmt(data.usage30d[key]?.credits)} credits
            </div>
          </div>
        ))}
      </div>

      {data.enforce && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, fontSize: 13, color: C.textInk }}>
          <label htmlFor="credits-low">Email admins when the balance falls to</label>
          <input id="credits-low" type="number" min="0" value={lowAt} onChange={(e) => setLowAt(e.target.value)} style={{ ...input, width: 100 }} />
          <button type="button" style={btn(false)} onClick={saveLow}>Save</button>
        </div>
      )}

      <div style={heading}>History</div>
      {data.history.length === 0 ? (
        <div style={{ fontSize: 13, color: C.slate }}>Nothing yet.</div>
      ) : (
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
          {data.history.map((h) => (
            <div key={h.id} style={{ display: "grid", gridTemplateColumns: "150px 1fr 90px", gap: 10, padding: "7px 12px", borderTop: `1px solid ${C.border}`, fontSize: 12.5 }}>
              <span style={{ color: C.slate }}>{h.at ? new Date(h.at + "Z").toLocaleString() : ""}</span>
              <span style={{ color: C.textInk }}>{h.note || h.kind}{h.by ? ` · ${h.by}` : ""}</span>
              <span style={{ fontFamily: FONT_MONO, textAlign: "right", color: h.amount < 0 ? C.red : C.teal }}>{h.amount > 0 ? "+" : ""}{fmt(h.amount)}</span>
            </div>
          ))}
        </div>
      )}

      {data.isPlatformStaff && <PlatformCredits rates={data.rates} onChanged={load} />}
    </div>
  );
}

// OutReach staff only: every organisation's balance, adding credits, enforcement, rate card.
function PlatformCredits({ rates, onChanged }) {
  const [orgs, setOrgs] = useState([]);
  const [grant, setGrant] = useState({ org_id: "", amount: "", note: "" });
  const [rateDraft, setRateDraft] = useState(() => Object.fromEntries(Object.entries(rates).map(([k, r]) => [k, String(r.credits)])));
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    try {
      setOrgs(await api.getPlatformOrgs());
    } catch (err) {
      setMsg(err.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const doGrant = async () => {
    const amount = Number(grant.amount);
    if (!grant.org_id || !amount) return setMsg("Pick an organisation and an amount.");
    try {
      await api.grantCredits(grant.org_id, amount, grant.note);
      setGrant({ org_id: grant.org_id, amount: "", note: "" });
      setMsg("Credits added.");
      load();
      onChanged();
    } catch (err) {
      setMsg(err.message);
    }
  };

  const toggle = async (o) => {
    try {
      await api.setOrgCreditEnforce(o.id, !o.enforce);
      load();
      onChanged();
    } catch (err) {
      setMsg(err.message);
    }
  };

  const saveRates = async () => {
    try {
      await api.setCreditRates(Object.fromEntries(Object.entries(rateDraft).map(([k, v]) => [k, Number(v) || 0])));
      setMsg("Rates saved.");
      onChanged();
    } catch (err) {
      setMsg(err.message);
    }
  };

  return (
    <div style={{ marginTop: 22, paddingTop: 6, borderTop: `1px dashed ${C.border}` }}>
      <div style={{ ...heading, display: "flex", alignItems: "center", gap: 6 }}><Coins size={15} /> All organisations (OutReach staff)</div>
      {msg && <div style={{ fontSize: 12.5, color: C.slate, marginBottom: 8 }}>{msg}</div>}
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden", marginBottom: 12 }}>
        {orgs.map((o) => (
          <div key={o.id} style={{ display: "grid", gridTemplateColumns: "1fr 110px 170px", gap: 10, alignItems: "center", padding: "7px 12px", borderTop: `1px solid ${C.border}`, fontSize: 12.5 }}>
            <span>{o.name} <span style={{ color: C.slateLight, fontFamily: FONT_MONO, fontSize: 11 }}>{o.id}</span></span>
            <span style={{ fontFamily: FONT_MONO, textAlign: "right" }}>{fmt(o.balance)}</span>
            <label style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end", cursor: "pointer" }}>
              <input type="checkbox" checked={o.enforce} onChange={() => toggle(o)} /> Stop at zero
            </label>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <select aria-label="Organisation" value={grant.org_id} onChange={(e) => setGrant({ ...grant, org_id: e.target.value })} style={input}>
          <option value="">Organisation…</option>
          {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <input aria-label="Credits" type="number" placeholder="Credits (negative removes)" value={grant.amount} onChange={(e) => setGrant({ ...grant, amount: e.target.value })} style={{ ...input, width: 190 }} />
        <input aria-label="Note" placeholder="Note" value={grant.note} onChange={(e) => setGrant({ ...grant, note: e.target.value })} style={{ ...input, flex: 1, minWidth: 140 }} />
        <button type="button" style={btn(true)} onClick={doGrant}><Plus size={13} /> Add credits</button>
      </div>
      <div style={heading}>Rate card</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
        {Object.entries(rates).map(([k, r]) => (
          <label key={k} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
            {r.label}
            <input type="number" min="0" value={rateDraft[k] ?? ""} onChange={(e) => setRateDraft({ ...rateDraft, [k]: e.target.value })} style={{ ...input, width: 80 }} />
          </label>
        ))}
        <button type="button" style={btn(false)} onClick={saveRates}>Save rates</button>
      </div>
    </div>
  );
}
