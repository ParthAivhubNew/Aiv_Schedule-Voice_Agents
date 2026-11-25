import React from "react";
import { ShieldAlert } from "lucide-react";
import { Banner } from "../../app/ui";
import { noticeLines } from "./accessLogic";

// A status line for results that were narrowed or refused by the account's data access. The icon and the words carry it, not colour.
export function AccessNotice({ message, style }) {
  const lines = noticeLines(message);
  return (
    <div role="status" aria-live="polite">
      {lines.length ? (
        <div style={style}>
          <Banner tone="warn" icon={ShieldAlert} role="none">{lines.map((l, i) => <span key={i} style={{ display: "block" }}>{l}</span>)}</Banner>
        </div>
      ) : null}
    </div>
  );
}
