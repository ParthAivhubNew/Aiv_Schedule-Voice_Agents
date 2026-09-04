import React, { useState } from "react";
import { C, FONT_BODY } from "../tokens";
import { TopBar } from "../components/TopBar";
import { Badge, FitScore } from "../components/Badges";

export function ProspectsView({ notifications, setNotifications, prospects = [] }) {
  const [query, setQuery] = useState("");

  const filtered = prospects.filter((p) =>
    !query || p.name.toLowerCase().includes(query.toLowerCase()) || p.sector.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div style={{ flex: 1, overflowY: "auto", background: C.paper }}>
      <TopBar
        title="Prospects"
        subtitle="Canonical master directory of all researched, contacted, and qualified UK companies."
        notifications={notifications}
        setNotifications={setNotifications}
      />

      <div style={{ padding: 32 }}>
        <div style={{ marginBottom: 20 }}>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search master directory by name, sector, or region..."
            style={{ width: "100%", maxWidth: 440, height: 40, padding: "0 14px", borderRadius: 10, fontSize: 13 }}
          />
        </div>

        <div style={{ background: "#FFFFFF", borderRadius: 18, border: `1px solid ${C.border}`, overflow: "hidden", boxShadow: C.shadowCard }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontFamily: FONT_BODY, fontSize: 13 }}>
            <thead>
              <tr style={{ background: C.paperSoft, borderBottom: `1px solid ${C.border}`, color: C.slate, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                <th style={{ padding: "14px 18px" }}>Company</th>
                <th style={{ padding: "14px 18px" }}>Sector & Region</th>
                <th style={{ padding: "14px 18px" }}>Contact Person</th>
                <th style={{ padding: "14px 18px" }}>Fit Score</th>
                <th style={{ padding: "14px 18px" }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} style={{ borderBottom: `1px solid ${C.borderLight}` }}>
                  <td style={{ padding: "16px 18px" }}>
                    <div style={{ fontWeight: 600, color: C.ink }}>{p.name}</div>
                    <div style={{ fontSize: 11.5, color: C.slate }}>{p.phone}</div>
                  </td>
                  <td style={{ padding: "16px 18px", color: C.slate }}>
                    {p.sector} · {p.region}
                  </td>
                  <td style={{ padding: "16px 18px", color: C.textInk }}>
                    {p.contact || "—"}
                  </td>
                  <td style={{ padding: "16px 18px" }}>
                    <FitScore value={p.fit || 80} />
                  </td>
                  <td style={{ padding: "16px 18px" }}>
                    <Badge status={p.status} small />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
