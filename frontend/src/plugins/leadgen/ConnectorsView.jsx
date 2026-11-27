import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, RefreshCw, Search, X, XCircle } from "lucide-react";
import { api } from "../../api/apiClient";
import { openSupport } from "../../hub/openSupport";
import { C, FONT_BODY, FONT_DISPLAY } from "../../tokens";
import { ConnectorPricing } from "./ConnectorPricing";
import { Pill } from "../../app/ui";
import {
  AirtableLogo, AwsS3Logo, BigQueryLogo, CompaniesHouseLogo, CqcLogo, CsvLogo, CustomLlmLogo, DirectorMatchLogo, DossierAiLogo, DynamicsLogo,
  ExperianLogo, FsaLogo, GoogleCloudLogo, HubspotLogo, InboundIntentLogo, MarketLocationLogo, OrdnanceSurveyLogo, PipedriveLogo, PostgresLogo,
  SalesforceLogo, SnowflakeLogo, TpsLogo, WebCrawlerLogo, ZohoLogo, letterLogo,
} from "./ConnectorLogos";
import { byGroup, countLine, filterConnectors, kindLabels, shortDate, summary, TONE_COLOURS, toneOf } from "./connectorsLogic";

// The Leads Connectors screen (plan 10, Phase 3). Everything on it comes from GET /leadgen/connectors: each connector's status, counts
// and whether it can be tested. Nothing is kept in the browser, and the Test button shows the server's real result, failures included.

const text = { fontFamily: FONT_BODY };
const head = { fontFamily: FONT_DISPLAY };

const LOGOS = {
  companies_house: CompaniesHouseLogo, fsa: FsaLogo, cqc: CqcLogo, tps: TpsLogo, postcode: OrdnanceSurveyLogo, charity: letterLogo("CC"),
  gpg: letterLogo("GP"), register: letterLogo("R"), experian: ExperianLogo, market_location: MarketLocationLogo, licensed: letterLogo("BD"),
  scrape: WebCrawlerLogo, research: DossierAiLogo, email: letterLogo("@"), phone: letterLogo("#"), web: WebCrawlerLogo, custom_ai: CustomLlmLogo,
  people: DirectorMatchLogo, google: GoogleCloudLogo, csv: CsvLogo, form: InboundIntentLogo, salesforce: SalesforceLogo, hubspot: HubspotLogo,
  dynamics365: DynamicsLogo, zoho_crm: ZohoLogo, pipedrive: PipedriveLogo, bigquery: BigQueryLogo, postgres: PostgresLogo, snowflake: SnowflakeLogo,
  s3_lake: AwsS3Logo, airtable: AirtableLogo,
};
const BLANK_LOGO = letterLogo("·");
export const Logo = ({ name, size = 32 }) => {
  const L = LOGOS[name] || BLANK_LOGO;
  return <L size={size} />;
};

export function StatusPill({ c }) {
  return <Pill tone={toneOf(c.status)}>{c.statusLabel}</Pill>; // good, warn, bad, muted or soon: the shared Pill's tones
}

function Card({ c, onOpen }) {
  const t = TONE_COLOURS[toneOf(c.status)];
  const counts = countLine(c);
  return (
    <button type="button" onClick={() => onOpen(c.id)} className="connector-card" aria-label={`${c.name}: ${c.statusLabel}`}
      style={{ ...text, textAlign: "left", background: C.surface, border: `1px solid ${c.status === "connected" ? t.border : C.border}`, borderRadius: 8,
        padding: "12px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, cursor: "pointer", minHeight: 72,
        boxShadow: "0 1px 2px rgba(0,0,0,0.03)" }}>
      <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        <span style={{ flexShrink: 0, display: "flex" }}><Logo name={c.logo} /></span>
        <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
          <span style={{ ...head, fontSize: 13, fontWeight: 600, color: C.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={c.name}>{c.name}</span>
          <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            <StatusPill c={c} />
            {counts ? <span style={{ fontSize: 11, color: C.slate, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={counts}>{counts}</span> : null}
          </span>
        </span>
      </span>
      <ArrowRight size={14} aria-hidden="true" style={{ color: C.slateLight, flexShrink: 0 }} />
    </button>
  );
}

function Fact({ label, value }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 11.5, color: C.slate, fontWeight: 600 }}>{label}</span>
      <span style={{ fontSize: 14, color: C.ink, fontWeight: 600 }}>{value}</span>
    </div>
  );
}

export function TestResult({ result }) {
  if (!result) return null;
  const tone = result.ok ? TONE_COLOURS.good : result.refused ? TONE_COLOURS.muted : TONE_COLOURS.bad;
  const Icon = result.ok ? CheckCircle2 : result.refused ? AlertTriangle : XCircle;
  return (
    <div role="status" style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, lineHeight: 1.45, padding: "10px 12px", borderRadius: 8, background: tone.bg, color: tone.ink }}>
      <Icon size={16} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
      <span>{result.detail}</span>
    </div>
  );
}

export function ConnectorDetail({ c, kinds, canTest, onClose, initialResult = null }) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState(initialResult);
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const runTest = async () => {
    setTesting(true);
    setResult(null);
    try {
      setResult(await api.testConnector(c.id));
    } catch (err) {
      setResult({ ok: false, detail: err?.message || "The check couldn't be run. Try again later." });
    } finally {
      setTesting(false);
    }
  };
  const gives = kindLabels(c, kinds);
  const num = (n) => (typeof n === "number" ? n.toLocaleString("en-GB") : null);
  const showPricing = c.pricing && (c.status === "coming_soon" || c.group === "keys");
  return (
    <div role="dialog" aria-modal="true" aria-label={c.name} onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ ...text, background: C.surface, borderRadius: 14, width: "min(640px, 100%)", maxHeight: "90vh", overflowY: "auto", padding: 22, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
            <Logo name={c.logo} size={40} />
            <div style={{ minWidth: 0 }}>
              <h2 style={{ ...head, margin: 0, fontSize: 18, color: C.ink }}>{c.name}</h2>
              <div style={{ marginTop: 4 }}><StatusPill c={c} /></div>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="ui-btn ui-btn--ghost ui-btn--sm" style={{ minHeight: 36 }}><X size={16} /></button>
        </div>
        <p style={{ margin: 0, fontSize: 13.5, color: C.textInk, lineHeight: 1.5 }}>{c.desc}</p>
        {c.statusText ? <div style={{ fontSize: 13, color: C.textInk, background: C.neutralBg, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 12px", lineHeight: 1.5 }}>{c.statusText}</div> : null}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12 }}>
          <Fact label="Records" value={num(c.records)} />
          <Fact label="Your companies using it" value={c.leads ? num(c.leads) : null} />
          <Fact label="Look-ups, last 30 days" value={typeof c.uses30d === "number" ? num(c.uses30d) : null} />
          <Fact label="Last updated" value={shortDate(c.lastSyncedAt)} />
        </div>
        {gives.length ? (
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 6 }}>{c.status === "coming_soon" ? "It would give you" : "It gives you"}</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {gives.map((g) => <span key={g} style={{ fontSize: 12, fontWeight: 600, padding: "3px 10px", borderRadius: 999, background: C.neutralSoft, color: C.textInk }}>{g}</span>)}
            </div>
          </div>
        ) : null}
        {c.testable ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {canTest ? (
              <div>
                <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" style={{ minHeight: 36 }} onClick={runTest} disabled={testing}>
                  <RefreshCw size={14} aria-hidden="true" /> {testing ? "Checking…" : "Test connection"}
                </button>
              </div>
            ) : <div style={{ fontSize: 12.5, color: C.slate }}>An account admin can test this connection.</div>}
            <TestResult result={result} />
          </div>
        ) : null}
        {c.askable ? (
          <div>
            <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" style={{ minHeight: 36 }} onClick={() => openSupport()}>
              {c.status === "coming_soon" ? "Ask for it" : "Ask to switch this on"}
            </button>
          </div>
        ) : null}
        {showPricing ? <ConnectorPricing id={c.pricing} /> : null}
      </div>
    </div>
  );
}

export function ConnectorsView({ initialData = null }) {
  const [data, setData] = useState(initialData);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(!initialData);
  const [group, setGroup] = useState("all");
  const [kind, setKind] = useState("all");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await api.getConnectors());
    } catch (err) {
      setError(err?.message || "The connectors couldn't be loaded. Try again.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (!initialData) load();
  }, [initialData, load]);

  const list = useMemo(() => data?.connectors || [], [data]);
  const shown = useMemo(() => filterConnectors(list, { group, kind, query }), [list, group, kind, query]);
  const groups = useMemo(() => byGroup(shown, data?.groups), [shown, data]);
  const totals = summary(list);
  const open = list.find((c) => c.id === openId) || null;
  const close = useCallback(() => setOpenId(null), []);
  const pill = (id, label) => (
    <button key={id} type="button" onClick={() => setGroup(id)} aria-pressed={group === id}
      style={{ ...text, fontSize: 12.5, fontWeight: 600, padding: "6px 12px", borderRadius: 999, cursor: "pointer", minHeight: 32,
        border: `1px solid ${group === id ? C.ink : C.border}`, background: group === id ? C.ink : C.surface, color: group === id ? C.onAccent : C.textInk }}>
      {label}
    </button>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, minHeight: "100%", ...text }}>
      <div className="ui-card" style={{ padding: "20px 24px", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <h1 style={{ ...head, fontSize: 22, fontWeight: 700, color: C.ink, margin: 0 }}>Data sources</h1>
          <p style={{ fontSize: 13, color: C.slate, margin: "4px 0 0" }}>Where your leads' data comes from, and what's switched on for your account.</p>
        </div>
        {data ? (
          <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", fontSize: 12.5, padding: "10px 14px", background: C.neutralBg, borderRadius: 8, border: `1px solid ${C.borderLight}` }}>
            <span style={{ color: TONE_COLOURS.good.ink, fontWeight: 600 }}>{totals.connected} connected</span>
            {totals.attention ? <span style={{ color: TONE_COLOURS.warn.ink, fontWeight: 600 }}>{totals.attention} need a look</span> : null}
            <span style={{ color: C.slate }}>{totals.soon} coming soon</span>
            <span style={{ color: C.slateLight, marginLeft: "auto" }}>{data.countsAt ? `Counts from ${shortDate(data.countsAt)}` : "Record counts are being worked out"}</span>
          </div>
        ) : null}
      </div>

      {loading && !data ? <div role="status" style={{ fontSize: 13, color: C.slate, padding: 12 }}>Loading connectors…</div> : null}
      {error ? (
        <div role="alert" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 13, padding: "12px 14px", borderRadius: 8,
          background: TONE_COLOURS.bad.bg, color: TONE_COLOURS.bad.ink }}>
          <span>{error}</span>
          <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={load}>Try again</button>
        </div>
      ) : null}

      {data ? (
        <>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {pill("all", "All")}
              {(data.groups || []).map((g) => pill(g.id, g.label))}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <label style={{ fontSize: 12.5, color: C.slate, display: "flex", alignItems: "center", gap: 6 }}>
                Data they provide
                <select value={kind} onChange={(e) => setKind(e.target.value)} style={{ ...text, fontSize: 13, minHeight: 34, borderRadius: 8, border: `1px solid ${C.border}`, padding: "0 8px" }}>
                  <option value="all">Any</option>
                  {(data.kinds || []).map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
                </select>
              </label>
              <span style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
                <Search size={14} aria-hidden="true" style={{ position: "absolute", left: 10, color: C.slateLight }} />
                <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search connectors" aria-label="Search connectors"
                  style={{ ...text, fontSize: 13, minHeight: 34, borderRadius: 8, border: `1px solid ${C.border}`, padding: "0 10px 0 30px", width: 200, maxWidth: "100%" }} />
              </span>
            </div>
          </div>
          {groups.length ? groups.map((g) => (
            <section key={g.id} aria-label={g.label}>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: C.slate, margin: "2px 0 8px" }}>{g.label}</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(max(215px, calc((100% - 48px) / 5)), 1fr))", gap: 12 }}>
                {g.items.map((c) => <Card key={c.id} c={c} onOpen={setOpenId} />)}
              </div>
            </section>
          )) : (
            <div style={{ fontSize: 13, color: C.slate, padding: "24px 12px", textAlign: "center", border: `1px dashed ${C.border}`, borderRadius: 10 }}>
              No connector matches. Clear the search or pick another filter.
            </div>
          )}
        </>
      ) : null}

      {open ? <ConnectorDetail c={open} kinds={data?.kinds} canTest={Boolean(data?.canTest)} onClose={close} /> : null}
    </div>
  );
}

export default ConnectorsView;
