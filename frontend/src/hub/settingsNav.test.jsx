import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { settingsNavItem } from "./settingsNav";

const Icon = () => null;

describe("the shared menu (plan 13)", () => {
  it("makes one Settings entry that opens its first page and shows as current while any of its pages is open", () => {
    const open = vi.fn();
    const item = settingsNavItem([null, { id: "connectors", label: "Connectors", icon: Icon, onClick: open }, { id: "theme", label: "Theme", icon: Icon, active: true, onClick: () => {} }]);
    expect(item).toMatchObject({ id: "settings", label: "Settings", active: true });
    expect(item.children.map((c) => c.id)).toEqual(["connectors", "theme"]);
    item.onClick();
    expect(open).toHaveBeenCalled();
    expect(settingsNavItem([])).toBe(null);
    expect(settingsNavItem(null)).toBe(null);
  });

  it("leaves out a group's label when there is only one group", () => {
    const shell = readFileSync(new URL("./PluginShell.jsx", import.meta.url), "utf8");
    expect(shell).toContain('{shown.length > 1 ? <div className="ui-nav-label">{group.label}</div> : null}');
  });
});
