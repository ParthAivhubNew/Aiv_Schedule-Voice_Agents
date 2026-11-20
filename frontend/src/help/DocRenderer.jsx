import React, { useState } from "react";
import { Check, Copy, Info, AlertTriangle, Lightbulb } from "lucide-react";
import { C } from "../tokens";

export function DocRenderer({ doc }) {
  if (!doc) return null;
  return (
    <article
      style={{
        maxWidth: 720,
        margin: "0 auto",
        padding: "32px 24px 64px",
        fontFamily: "'Inter', sans-serif",
        color: C.textInk,
        lineHeight: 1.65,
      }}
    >
      <header style={{ marginBottom: 32, paddingBottom: 24, borderBottom: `1px solid ${C.border}` }}>
        <h1 style={{ fontSize: 32, fontWeight: 700, letterSpacing: "-0.025em", color: C.ink, margin: "0 0 10px" }}>
          {doc.title}
        </h1>
        {doc.summary && (
          <p style={{ fontSize: 16, color: C.slate, margin: 0, lineHeight: 1.5 }}>
            {doc.summary}
          </p>
        )}
      </header>

      {(doc.sections || []).map((sec) => (
        <section key={sec.id} id={sec.id} style={{ marginBottom: 40, scrollMarginTop: 80 }}>
          {sec.heading && (
            <h2 style={{ fontSize: 21, fontWeight: 600, letterSpacing: "-0.015em", color: C.ink, margin: "0 0 16px" }}>
              {sec.heading}
            </h2>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {(sec.blocks || []).map((b, idx) => (
              <RenderBlock key={idx} block={b} />
            ))}
          </div>
        </section>
      ))}
    </article>
  );
}

function RenderBlock({ block }) {
  switch (block.type) {
    case "paragraph":
      return <p style={{ fontSize: 14.5, color: C.textInk, margin: 0, lineHeight: 1.65 }}>{block.text}</p>;

    case "callout": {
      const isTip = block.tone === "tip";
      const isWarning = block.tone === "warning";
      const toneColor = isTip ? C.teal : isWarning ? C.amber : C.cobalt;
      const toneBg = isTip ? C.tealSoft : isWarning ? C.amberSoft : C.cobaltSoft;
      const Icon = isTip ? Lightbulb : isWarning ? AlertTriangle : Info;

      return (
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
            padding: "14px 16px",
            borderRadius: 8,
            background: toneBg,
            border: `1px solid color-mix(in srgb, ${toneColor} 20%, transparent)`,
            margin: "4px 0",
          }}
        >
          <Icon size={18} color={toneColor} style={{ flexShrink: 0, marginTop: 2 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            {block.title && (
              <div style={{ fontSize: 13, fontWeight: 600, color: toneColor, marginBottom: 2 }}>
                {block.title}
              </div>
            )}
            <div style={{ fontSize: 13.5, color: C.textInk, lineHeight: 1.5 }}>{block.text}</div>
          </div>
        </div>
      );
    }

    case "steps":
      return (
        <ol style={{ margin: "4px 0", paddingLeft: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
          {(block.items || []).map((step, idx) => (
            <li key={idx} style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
              <span
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: "50%",
                  background: C.cobaltSoft,
                  color: C.cobalt,
                  fontSize: 12,
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  marginTop: 2,
                }}
              >
                {idx + 1}
              </span>
              <span style={{ flex: 1, fontSize: 14, color: C.textInk, lineHeight: 1.55 }}>
                {typeof step === "string" ? step : step.text}
              </span>
            </li>
          ))}
        </ol>
      );

    case "code":
      return <CodeBlock code={block.code} language={block.language} />;

    case "table":
      return (
        <div style={{ overflowX: "auto", margin: "6px 0", border: `1px solid ${C.border}`, borderRadius: 8 }}>
          <table className="ui-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            {block.headers && (
              <thead>
                <tr>
                  {block.headers.map((h, i) => (
                    <th key={i} style={{ background: C.paperSoft, color: C.slate, fontWeight: 600, padding: "10px 14px", textAlign: "left", borderBottom: `1px solid ${C.border}` }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {(block.rows || []).map((row, i) => (
                <tr key={i} style={{ borderBottom: i < block.rows.length - 1 ? `1px solid ${C.borderLight}` : "none" }}>
                  {row.map((cell, j) => (
                    <td key={j} style={{ padding: "10px 14px", color: C.textInk }}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case "tabs":
      return <TabsBlock tabs={block.tabs} />;

    default:
      return null;
  }
}

function CodeBlock({ code, language }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    try {
      navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch (_) {}
  };

  return (
    <div style={{ position: "relative", borderRadius: 8, overflow: "hidden", border: `1px solid ${C.border}`, background: "#1B1E29", margin: "6px 0" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 12px", background: "rgba(255,255,255,0.06)", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        <span style={{ fontSize: 11, fontWeight: 500, color: "#9BA3AF", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          {language || "code"}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="ui-icon-btn ui-icon-btn--sm"
          title="Copy code"
          aria-label="Copy code"
          style={{ color: copied ? C.green : "#C9CDD6" }}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      </div>
      <pre style={{ margin: 0, padding: 14, overflowX: "auto", fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: "#F0F2F5", lineHeight: 1.5 }}>
        <code>{code}</code>
      </pre>
    </div>
  );
}

function TabsBlock({ tabs }) {
  const [activeTab, setActiveTab] = useState(0);
  if (!tabs || !tabs.length) return null;

  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden", margin: "6px 0" }}>
      <div style={{ display: "flex", borderBottom: `1px solid ${C.border}`, background: C.paperSoft }}>
        {tabs.map((t, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setActiveTab(i)}
            style={{
              all: "unset",
              boxSizing: "border-box",
              padding: "9px 16px",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              color: activeTab === i ? C.cobalt : C.slate,
              borderBottom: activeTab === i ? `2px solid ${C.cobalt}` : "2px solid transparent",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        {(tabs[activeTab]?.blocks || []).map((b, idx) => (
          <RenderBlock key={idx} block={b} />
        ))}
      </div>
    </div>
  );
}
