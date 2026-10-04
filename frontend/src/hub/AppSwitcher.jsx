import React from "react";
import { Home } from "lucide-react";
import { APPS } from "./apps";

// At the top of every app's sidebar: Home, and the other apps of the suite one click away.
// `onHome` is the app's own way back to Home (it may ask about unsaved changes first).
export function AppSwitcher({ current, onHome }) {
  return (
    <div role="navigation" aria-label="Outreach apps" className="ui-switcher">
      <button type="button" title="Home: all your apps" onClick={onHome} className="ui-switcher-btn ui-switcher-btn--home">
        <Home size={15} /> Home
      </button>
      {APPS.map((app) => {
        const here = app.id === current;
        const Icon = app.icon;
        return (
          <button key={app.id} type="button" title={here ? `${app.name} (you are here)` : `Go to ${app.name}`} aria-label={app.name} aria-current={here ? "page" : undefined}
            onClick={() => !here && window.__aivhub_switch_plugin?.(app.id)}
            className="ui-switcher-btn">
            <Icon size={15} />
          </button>
        );
      })}
    </div>
  );
}
