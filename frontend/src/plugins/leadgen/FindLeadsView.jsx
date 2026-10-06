import React, { useState } from "react";
import { FileSpreadsheet, Search, Sparkles } from "lucide-react";
import { ScoutView, ImportView } from "./AccountsViews";
import { CopilotView } from "./CopilotView";

// Three different METHODS of getting a company into the saved-accounts list (ask AI, search,
// upload a file) -- not three different destinations. Folds the old standalone AI Lead Copilot,
// AI Lead Scout and Import tabs into one, as inner tabs.
const SUB_TABS = [
  ["copilot", "AI Lead Copilot", Sparkles],
  ["scout", "AI Lead Scout", Search],
  ["import", "Import", FileSpreadsheet],
];

export function FindLeadsView({ store, onGo }) {
  const [sub, setSub] = useState("copilot");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {SUB_TABS.map(([id, label, Icon]) => (
          <button key={id} type="button" onClick={() => setSub(id)}
            className={`ui-btn ui-btn--sm ${sub === id ? "ui-btn--primary" : "ui-btn--ghost"}`}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>
      {sub === "copilot" && <CopilotView store={store} />}
      {sub === "scout" && <ScoutView store={store} />}
      {sub === "import" && <ImportView store={store} onGo={onGo} />}
    </div>
  );
}
