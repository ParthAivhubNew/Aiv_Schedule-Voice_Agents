import React, { useState } from "react";
import { Ban, Shield, ShieldCheck, Users } from "lucide-react";
import { C } from "../../../tokens";
import { DataAccess } from "../DataAccess";
import { isAdminOperator } from "../importMatchLogic";
import { UserManagement } from "./UserManagement";
import { RoleManagement } from "./RoleManagement";
import { ExclusionRules } from "./ExclusionRules";
import { ADMIN_CSS, muted, text } from "./adminUi";

export const ADMIN_TABS = [
  { id: "users", label: "User management", icon: Users },
  { id: "roles", label: "Role management", icon: ShieldCheck },
  { id: "access", label: "Data access", icon: Shield },
  { id: "exclusions", label: "Exclusions", icon: Ban },
];
export const NOT_ADMIN_LINE = "Administration is for admins only. Ask an administrator for access.";

export function AdministrationBody({ operator, tab, onTab, children }) {
  if (!isAdminOperator(operator)) {
    return <div role="alert" style={{ ...text, ...muted, padding: "24px 0", color: C.textInk }}>{NOT_ADMIN_LINE}</div>;
  }
  return (
    <div style={{ display: "grid", gap: 16, width: "100%", minWidth: 0 }}>
      <style>{ADMIN_CSS}</style>
      <div className="adm-tabs" role="tablist" aria-label="Administration">
        {ADMIN_TABS.map((t) => (
          <button key={t.id} type="button" role="tab" id={`adm-tab-${t.id}`} aria-selected={tab === t.id} aria-controls="adm-panel" className="adm-tab" onClick={() => onTab(t.id)}>
            <t.icon size={14} aria-hidden="true" /> {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="adm-panel" aria-labelledby={`adm-tab-${tab}`}>{children}</div>
    </div>
  );
}

export function AdministrationView({ operator, initialTab = "users" }) {
  const [tab, setTab] = useState(initialTab);
  return (
    <AdministrationBody operator={operator} tab={tab} onTab={setTab}>
      {tab === "users" ? <UserManagement operator={operator} onOpenDataAccess={() => setTab("access")} /> : null}
      {tab === "roles" ? <RoleManagement /> : null}
      {tab === "access" ? <DataAccess /> : null}
      {tab === "exclusions" ? <ExclusionRules /> : null}
    </AdministrationBody>
  );
}
