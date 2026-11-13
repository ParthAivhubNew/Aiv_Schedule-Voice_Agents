import React from "react";

// The assistant writes light markdown (**bold**, "- " lists, "1." lists, blank lines between paragraphs). Shown as it was meant,
// not as stars and dashes. Only these few marks are read; anything else stays plain text, so nothing can inject markup.
export function inline(text) {
  const out = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`/g;
  let last = 0;
  let m;
  let n = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(m[1] ? <strong key={n++}>{m[1]}</strong> : <code key={n++} style={{ background: "var(--ui-sunken,#F1F3F8)", borderRadius: 4, padding: "1px 5px", fontSize: "0.92em" }}>{m[2]}</code>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function blocks(text) {
  const lines = String(text || "").replace(/\r/g, "").split("\n");
  const out = [];
  let cur = null;
  const flush = () => { if (cur) { out.push(cur); cur = null; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const number = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (!line.trim()) { flush(); continue; }
    if (bullet || number) {
      const kind = bullet ? "ul" : "ol";
      if (!cur || cur.kind !== kind) { flush(); cur = { kind, items: [] }; }
      cur.items.push((bullet || number)[1]);
    } else {
      if (!cur || cur.kind !== "p") { flush(); cur = { kind: "p", items: [] }; }
      cur.items.push(line);
    }
  }
  flush();
  return out;
}

export function RichText({ text }) {
  const parts = blocks(text);
  if (!parts.length) return null;
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {parts.map((b, i) => {
        if (b.kind === "p") return <p key={i} style={{ margin: 0 }}>{b.items.map((l, j) => <React.Fragment key={j}>{j ? <br /> : null}{inline(l)}</React.Fragment>)}</p>;
        const Tag = b.kind;
        return <Tag key={i} style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 4 }}>{b.items.map((l, j) => <li key={j}>{inline(l)}</li>)}</Tag>;
      })}
    </div>
  );
}
