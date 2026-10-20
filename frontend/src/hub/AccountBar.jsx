import { NotificationBell } from "../components/TopBar";
import { CreditsChip } from "../plugins/leadgen/CreditsChip";
import { UserProfileMenu } from "./PluginHub";

// What is left in this app's wallet, then notifications, then your profile menu: the same row at the top right of every app.
// `wallet` is the app's credits (leave it out for an app without any); each app gives its own and where "top up" goes.
export function AccountBar({ operator, notifications, setNotifications, onNavigate, menu, wallet, app, onOpenPlan }) {
  return (
    <div className="acct-bar" style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
      <style>{`@media (max-width: 480px) { .acct-bar { gap: 6px !important; } .hide-xs { display: none !important; } }`}</style>
      {wallet ? <span className="acct-credits phone-hide"><CreditsChip wallet={wallet} app={app} onOpen={operator?.is_admin ? onOpenPlan : undefined} /></span> : null}
      <NotificationBell notifications={notifications || []} setNotifications={setNotifications} onNavigate={onNavigate} />
      <UserProfileMenu operator={operator} compact {...menu} />
    </div>
  );
}
