import React, { useEffect, useState } from "react";
import { MapPin, X } from "lucide-react";
import { C, FONT_BODY } from "../../tokens";
import { api } from "../../api/apiClient";
import { getOrgPolicy } from "../../brand/brandApi";
import { announceCreditsChanged } from "./CreditsChip";

// Details read live from Google when the person asks. They live in this component's state only: closing the card drops them.

export const IDLE_LINE = "Shown live from Google. Uses 1 credit the first time you open it each day.";
export const NOT_FOUND = "Google has nothing for this company.";

const STATUS_WORD = { OPERATIONAL: "Open", CLOSED_TEMPORARILY: "Temporarily closed", CLOSED_PERMANENTLY: "Permanently closed" };
export const statusWord = (s) => STATUS_WORD[String(s || "").toUpperCase()] || "";

// Hidden when the organisation's policy lists Google. Until the policy has loaded, nothing shows.
export const googleAllowed = (policy) => Boolean(policy) && !(policy.restrictedSources || []).some((s) => /^google/i.test(String(s)));

const FALLBACK = {
  402: "Not enough credits to show this. Add credits, then try again.",
  403: "Google details are not available for this organisation.",
  404: "We couldn't find that company.",
  429: "You have opened a lot of Google details this hour. Try again later.",
};

// The server's own sentence wins; the fallback only covers a reply with no message.
export function googleError(e) {
  const generic = e && e.status && e.message === `Request failed with status ${e.status}`;
  if (e && e.message && !generic) return e.message;
  return FALLBACK[e && e.status] || "Couldn't load the Google details. Try again.";
}

const text = { fontFamily: FONT_BODY };
const muted = { ...text, fontSize: 12.5, color: C.slate, lineHeight: 1.5 };
const link = { color: C.cobalt, overflowWrap: "anywhere" };
const withScheme = (u) => (/^https?:/i.test(u) ? u : `https://${u}`);

function Row({ label, children }) {
  if (!children) return null;
  return (
    <div style={{ display: "flex", gap: 10, ...text, fontSize: 13, padding: "4px 0" }}>
      <span style={{ width: 84, flexShrink: 0, color: C.slate }}>{label}</span>
      <span style={{ minWidth: 0, overflowWrap: "anywhere", color: C.textInk }}>{children}</span>
    </div>
  );
}

export function GoogleCard({ result, onClose }) {
  const d = result.details;
  const status = d ? statusWord(d.business_status) : "";
  const rating = d && d.rating != null
    ? `${d.rating} out of 5${d.rating_count != null ? ` (${Number(d.rating_count).toLocaleString("en-GB")} ${d.rating_count === 1 ? "review" : "reviews"})` : ""}`
    : "";
  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, background: "#fff", display: "grid", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <MapPin size={15} aria-hidden="true" color={C.slate} />
        <strong style={{ ...text, fontSize: 13.5, color: C.ink, flex: 1 }}>From Google</strong>
        <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" style={{ minHeight: 44, minWidth: 44 }} onClick={onClose} aria-label="Close the Google details"><X size={15} aria-hidden="true" /></button>
      </div>
      {!result.found || !d ? <div style={{ ...text, fontSize: 13, color: C.textInk }}>{NOT_FOUND}</div> : (
        <div>
          <Row label="Name">{d.name}</Row>
          <Row label="Address">{d.address}</Row>
          <Row label="Phone">{d.phone ? <a href={`tel:${String(d.phone).replace(/\s+/g, "")}`} style={link}>{d.phone}</a> : ""}</Row>
          <Row label="Website">{d.website ? <a href={withScheme(d.website)} target="_blank" rel="noreferrer" style={link}>{d.website}</a> : ""}</Row>
          <Row label="Rating">{rating}</Row>
          <Row label="Status">{status}</Row>
          {(d.hours || []).length ? (
            <Row label="Hours"><ul style={{ margin: 0, padding: 0, listStyle: "none" }}>{d.hours.map((h) => <li key={h}>{h}</li>)}</ul></Row>
          ) : null}
          {d.maps_url ? <div style={{ paddingTop: 4 }}><a href={d.maps_url} target="_blank" rel="noreferrer" style={{ ...link, ...text, fontSize: 13, display: "inline-flex", alignItems: "center", minHeight: 44 }}>Open in Google Maps</a></div> : null}
        </div>
      )}
      {result.note ? <div style={muted}>{result.note}</div> : null}
      <div style={{ ...muted, fontSize: 12 }}>{result.attribution || "Google"}</div>
    </div>
  );
}

// The drawing, apart from the loading, so each state can be shown on its own.
export function GoogleViewBody({ policy, phase, result, error, onShow, onClose }) {
  if (!googleAllowed(policy)) return null;
  return (
    <div style={{ display: "grid", gap: 8 }} aria-label="Google details">
      {phase !== "done" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
          <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" style={{ minHeight: 44 }} disabled={phase === "loading"} onClick={onShow}>
            <MapPin size={14} aria-hidden="true" /> {phase === "loading" ? "Asking Google…" : "Show Google details"}
          </button>
          <div style={muted}>{IDLE_LINE}</div>
        </div>
      ) : null}
      <div role="status" aria-live="polite">{error ? <div style={{ ...text, fontSize: 13, color: C.red }}>{error}</div> : null}</div>
      {phase === "done" && result ? <GoogleCard result={result} onClose={onClose} /> : null}
    </div>
  );
}

export function GoogleView({ companyId }) {
  const [policy, setPolicy] = useState(null);
  const [phase, setPhase] = useState("idle"); // idle | loading | done
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    getOrgPolicy().then((p) => { if (live) setPolicy(p || {}); }).catch(() => {}); // no answer: stay hidden
    return () => { live = false; };
  }, []);
  useEffect(() => { setPhase("idle"); setResult(null); setError(""); }, [companyId]);

  const show = async () => {
    setPhase("loading");
    setError("");
    try {
      const r = await api.getGoogleView(companyId);
      setResult(r);
      setPhase("done");
      if (r && r.credits_charged > 0) announceCreditsChanged();
    } catch (e) {
      setError(googleError(e));
      setPhase("idle");
    }
  };
  const close = () => { setResult(null); setPhase("idle"); };
  return <GoogleViewBody policy={policy} phase={phase} result={result} error={error} onShow={show} onClose={close} />;
}
