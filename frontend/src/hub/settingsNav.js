import { Settings } from "lucide-react";

// One "Settings" entry at the bottom of an app's menu: the app's setup pages sit in the panel it opens beside the menu (under it on
// touch screens), and clicking it opens the first one. It shows as current while any of them is open (plan 13).
export function settingsNavItem(items) {
  const subs = (items || []).filter(Boolean);
  if (!subs.length) return null;
  return { id: "settings", label: "Settings", icon: Settings, title: "Set up this app: accounts, company details, automations and your plan",
    active: subs.some((s) => s.active), children: subs, onClick: () => subs[0].onClick() };
}
