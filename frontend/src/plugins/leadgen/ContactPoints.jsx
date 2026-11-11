import React, { useEffect, useState } from "react";
import { C } from "../../tokens";
import { api } from "../../api/apiClient";
import { Pill, card } from "../../adminPortal/ui";

// "Everything we know" about how to reach a company: every website, phone, email and social page any source gave us, one line each, with where it came
// from. A phone, email or website the register holds stays hidden until it is opened above (free, once), as it does in the results.

const KIND_TITLE = { website: "Websites", phone: "Phones", email: "Emails", linkedin: "LinkedIn", facebook: "Facebook", x: "X", instagram: "Instagram", youtube: "YouTube", tiktok: "TikTok" };
const KIND_ORDER = Object.keys(KIND_TITLE);
// Where a value came from, in words a person knows. Suppliers are never named.
const SOURCE_WORD = { record: "Register", register: "Register", web: "Web search", linkedin: "Page search", social: "Page search", research: "Research", apollo: "Deep web search", google_places: "Deep web search" };

const href = (p) => (p.kind === "phone" ? `tel:${p.value.replace(/\s+/g, "")}` : p.kind === "email" ? `mailto:${p.value}` : /^https?:/i.test(p.value) ? p.value : `https://${p.value}`);

export function ContactPoints({ id, stamp = "" }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    api.getContactPoints(id).then((r) => { if (live) { setData(r); setError(""); } }).catch((e) => { if (live) setError(e.message || "Couldn't load this."); });
    return () => { live = false; };
  }, [id, stamp]);
  if (error) return null;
  if (!data) return null;
  const by = {};
  for (const p of data.points || []) (by[p.kind] = by[p.kind] || []).push(p);
  const kinds = KIND_ORDER.filter((k) => by[k]);
  if (!kinds.length && !(data.shared_with || []).length) return null;
  return (
    <div style={{ ...card, display: "grid", gap: 10, padding: 14 }} aria-label="Everything we know about reaching this company">
      <strong style={{ fontSize: 13.5 }}>Everything we know</strong>
      {kinds.map((k) => (
        <div key={k} style={{ display: "grid", gap: 3 }}>
          <div style={{ fontSize: 12, color: C.slate, fontWeight: 600 }}>{KIND_TITLE[k]}</div>
          {by[k].map((p) => (
            <div key={p.id} style={{ display: "flex", gap: 6, alignItems: "baseline", flexWrap: "wrap", fontSize: 13, lineHeight: 1.45 }}>
              {p.hidden
                ? <span style={{ color: C.slate }}>We hold this. Use Reveal above.</span>
                : <a href={href(p)} target={p.kind === "phone" || p.kind === "email" ? undefined : "_blank"} rel="noreferrer" style={{ color: C.cobalt, overflowWrap: "anywhere", minWidth: 0 }}>{p.value}</a>}
              {p.owner ? <span style={{ color: C.slate, fontSize: 12 }}>· {p.owner}</span> : null}
              <span title={p.confidence === "picked" ? "Someone chose this from the suggestions" : p.confidence === "register" ? "Published by a register" : "Found by a search"}>
                <Pill tone={p.confidence === "register" || p.confidence === "picked" ? "green" : "slate"}>{p.confidence === "picked" ? "You chose it" : SOURCE_WORD[p.source] || "Found"}</Pill>
              </span>
            </div>
          ))}
        </div>
      ))}
      {(data.shared_with || []).length ? (
        <div role="note" style={{ fontSize: 12.5, color: C.amber, background: C.amberSoft, borderRadius: 8, padding: "8px 10px", lineHeight: 1.45 }}>
          Possible duplicate record. Another company record holds the same {data.shared_with.map((s) => (s.kind === "phone" ? "phone number" : s.kind === "email" ? "email" : `${KIND_TITLE[s.kind]} page`)).filter((v, i, a) => a.indexOf(v) === i).join(" and ")}:{" "}
          {data.shared_with.flatMap((s) => s.records).filter((r, i, a) => a.findIndex((x) => x.id === r.id) === i).slice(0, 3).map((r) => `${r.name}${r.postcode ? ` (${r.postcode})` : ""}`).join(", ")}.
        </div>
      ) : null}
    </div>
  );
}
