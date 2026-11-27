import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { settingsGroups, settingsHashForConnections, settingsHashForTeam, settingsSection } from "./settingsPages";

const ids = (groups) => groups.flatMap((g) => g.items.map((it) => it.id));
const read = (f) => readFileSync(new URL(f, import.meta.url), "utf8");

// Plan 13, step 4: one Settings page for the whole company.
describe("the Settings page's sections", () => {
  it("shows the company owner everything, in groups", () => {
    const g = settingsGroups({ is_admin: true, role: "Admin" }, { installable: true });
    expect(g.map((x) => x.label)).toEqual(["Your account", "People", "Company", "Working together", "Developers", "Apps"]);
    expect(ids(g)).toEqual(["profile", "contact", "notifications", "security", "install", "users", "roles", "rules", "numbers", "credits",
      "follow-ups", "your-rules", "do-not-contact", "data", "calendar", "api", "leads", "voice", "social"]);
  });

  it("shows someone without admin rights only their own account, their credit use and the shared rules", () => {
    const g = settingsGroups({ role: "User", permissions: { team: "none" } });
    expect(g.map((x) => x.label)).toEqual(["Your account", "Company", "Working together", "Apps"]);
    expect(ids(g)).not.toEqual(expect.arrayContaining(["users"]));
    expect(ids(g)).toContain("usage");
    expect(ids(g)).not.toContain("credits");
    expect(ids(g)).not.toContain("api");
    expect(ids(g)).not.toContain("install");
  });

  it("opens the section the address names, or the first one", () => {
    const g = settingsGroups({ is_admin: true });
    expect(settingsSection(g, "#/settings/roles").id).toBe("roles");
    expect(settingsSection(g, "#/settings").id).toBe("profile");
    expect(settingsSection(g, "#/settings/nope").id).toBe("profile");
    // A section this person can't open falls back too, as do the rows that only take you somewhere.
    expect(settingsSection(settingsGroups({ role: "User" }), "#/settings/users").id).toBe("profile");
    expect(settingsSection(g, "#/settings/leads").id).toBe("profile");
  });

  it("sends the old windows' tabs to their sections", () => {
    expect(settingsHashForTeam("rules")).toBe("#/settings/rules");
    expect(settingsHashForTeam("myusage")).toBe("#/settings/usage");
    expect(settingsHashForTeam(undefined)).toBe("#/settings/users");
    expect(settingsHashForConnections("block")).toBe("#/settings/do-not-contact");
    expect(settingsHashForConnections("")).toBe("#/settings/follow-ups");
  });
});

describe("one door to Settings", () => {
  it("cuts the profile menu to profile, Settings, help and Sign out", () => {
    const src = read("./PluginHub.jsx");
    for (const gone of ["Users & roles", "Calendar & meetings", "Admin APIs", "title=\"Connections\"", "Install the app"]) expect(src).not.toContain(gone);
    expect(src).toContain('title="Settings"');
  });

  it("opens a page, not a window, for what the old windows held", () => {
    const app = read("../App.jsx");
    expect(app).toContain('"settings"]');
    expect(app).toContain("<SettingsPage");
    expect(app).not.toMatch(/<TeamModal|<ProfilePage|<ConnectionsSettingsModal|<DeveloperApiKeysModal/);
    expect(app).toContain("settingsHashForTeam(");
    expect(app).toContain("settingsHashForConnections(");
  });
});
