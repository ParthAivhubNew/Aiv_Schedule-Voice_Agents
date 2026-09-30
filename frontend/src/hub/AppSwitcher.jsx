import React from "react";
import { Home } from "lucide-react";
import { C, NAV_TEXT } from "../tokens";
import { APPS } from "./apps";

const cell = { height: 30, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 7, border: "none", flex: "0 0 auto" };

// At the top of every app's sidebar: Home, and the other apps of the suite one click away.
// `onHome` is the app's own way back to Home (it may ask about unsaved changes first).
export function AppSwitcher({ current, onHome }) {
  return (
    <div role="navigation" aria-label="OutReach apps" style={{ display: "flex", alignItems: "center", gap: 2, margin: "0 4px 14px", padding: 4, borderRadius: 10, border: `1px solid ${C.inkLine}`, background: "rgba(255,255,255,0.03)" }}>
      <button type="button" title="Home: all your apps" onClick={onHome}
        style={{ ...cell, gap: 5, padding: "0 6px", background: "transparent", color: "#C8CCD6", ...NAV_TEXT, cursor: "pointer" }}>
        <Home size={14} /> Home
      </button>
      {APPS.map((app) => {
        const here = app.id === current;
        const Icon = app.icon;
        return (
          <button key={app.id} type="button" title={here ? `${app.name} (you are here)` : `Go to ${app.name}`} aria-label={app.name} aria-current={here ? "page" : undefined}
            onClick={() => !here && window.__aivhub_switch_plugin?.(app.id)}
            style={{ ...cell, width: 27, cursor: here ? "default" : "pointer", background: here ? app.accent : "transparent", color: here ? "#fff" : "#9AA0AE" }}>
            <Icon size={14} />
          </button>
        );
      })}
    </div>
  );
}
