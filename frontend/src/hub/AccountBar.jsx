import { NotificationBell } from "../components/TopBar";
import { UserProfileMenu } from "./PluginHub";

// Notifications, then your profile menu: the same row at the top right of every app. Credits live at the bottom of the left sidebar.
export function AccountBar({ operator, notifications, setNotifications, onNavigate, menu }) {
  return (
    <div className="acct-bar" style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
      <style>{`@media (max-width: 480px) { .acct-bar { gap: 6px !important; } .hide-xs { display: none !important; } }`}</style>
      <NotificationBell notifications={notifications || []} setNotifications={setNotifications} onNavigate={onNavigate} />
      <UserProfileMenu operator={operator} compact {...menu} />
    </div>
  );
}
