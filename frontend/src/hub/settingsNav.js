import { Settings } from "lucide-react";

// One "Settings" entry at the bottom of an app's menu (plan 13). Clicking it opens the first setup page, and while any of them is
// open the menu shows the setup pages in place of the everyday work (SidebarMenu), with a way back. `children` is kept for that list.
export function settingsNavItem(items) {
  const subs = (items || []).filter(Boolean);
  if (!subs.length) return null;
  return { id: "settings", label: "Settings", icon: Settings, title: "Set up this app: accounts, company details, automations and your plan",
    active: subs.some((s) => s.active), children: subs, onClick: () => subs[0].onClick() };
}
