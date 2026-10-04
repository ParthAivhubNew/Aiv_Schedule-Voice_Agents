import React, { useState, useEffect } from "react";
import { Lock, Sparkles } from "lucide-react";
import { api } from "../api/apiClient";
import { SubscriptionPage } from "../team/SubscriptionPage";
import { BILLING_CHANGED } from "../hub/BillingReturnBanner";
import { C, FONT_DISPLAY, FONT_BODY } from "../tokens";

const RETRY_MS = [1500, 4000, 10000];

/**
 * Hook to check if the current organisation has an active paid plan for a given wallet.
 */
export function usePluginAccess(wallet) {
  const [loading, setLoading] = useState(true);
  const [hasPlan, setHasPlan] = useState(false);
  const [billingData, setBillingData] = useState(null);

  const check = async (attempt = 0) => {
    try {
      const res = await api.getBillingAccess();
      setBillingData(res);
      const activeMap = res?.has_active_plan || {};
      setHasPlan(Boolean(activeMap[wallet]));
      setLoading(false);
    } catch (_) {
      // A failed check (a network blip, the server restarting) is not "no plan": try again a
      // few times, still loading meanwhile, before failing closed.
      if (attempt < RETRY_MS.length) {
        setTimeout(() => check(attempt + 1), RETRY_MS[attempt]);
        return;
      }
      setHasPlan(false);
      setLoading(false);
    }
  };

  useEffect(() => {
    check();
    // Look again when a payment changes the plan (SubscriptionPage says so after a checkout).
    const again = () => check();
    window.addEventListener(BILLING_CHANGED, again);
    return () => window.removeEventListener(BILLING_CHANGED, again);
  }, [wallet]);

  return { loading, hasPlan, billingData, refresh: check };
}

/**
 * Wraps plugin shells. If the wallet does not have an active plan:
 * - Tab clicks to locked tabs are intercepted with a notification.
 * - Deep-linked or default views render SubscriptionPage in the main content pane.
 */
export function PluginAccessGate({
  wallet,
  currentTab,
  onNavigateTab,
  children,
  pluginName = "this plugin",
}) {
  const { loading, hasPlan } = usePluginAccess(wallet);
  const [showToast, setShowToast] = useState(false);

  // If loading or org has active plan, render normally
  if (loading || hasPlan) {
    return typeof children === "function" ? children({ isLocked: false, hasPlan: true }) : children;
  }

  // Not subscribed: Subscription tab is always unlocked
  const isSubscriptionTab = currentTab === "subscription";

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      {/* Banner / Prompt if trying to access locked tabs */}
      {showToast && (
        <div
          style={{
            position: "fixed",
            bottom: 24,
            right: 24,
            zIndex: 9999,
            background: C.ink,
            color: "#fff",
            padding: "12px 18px",
            borderRadius: 10,
            boxShadow: "0 10px 25px rgba(0,0,0,0.3)",
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontFamily: FONT_BODY,
            fontSize: 13,
            border: `1px solid ${C.inkLine}`,
            animation: "fadeIn 0.2s ease-out",
          }}
        >
          <Lock size={16} color="#FBBF24" />
          <span>Subscribe to an active plan to unlock {pluginName}.</span>
          <button
            onClick={() => {
              setShowToast(false);
              if (onNavigateTab) onNavigateTab("subscription");
            }}
            style={{
              marginLeft: 8,
              background: "#8B5CF6",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              padding: "4px 10px",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            View Plans
          </button>
        </div>
      )}

      {isSubscriptionTab ? (
        typeof children === "function" ? children({ isLocked: true, hasPlan: false }) : children
      ) : (
        // Deep-link interceptor: render Subscription page in place of the locked view
        <div style={{ display: "flex", height: "100%", width: "100%", overflow: "hidden" }}>
          {typeof children === "function" ? (
            children({
              isLocked: true,
              hasPlan: false,
              lockedContent: (
                <div style={{ height: "100%", overflowY: "auto", background: "#FAFBFD" }}>
                  <div
                    style={{
                      background: "linear-gradient(135deg, rgba(139,92,246,0.08), rgba(59,130,246,0.04))",
                      borderBottom: `1px solid ${C.border}`,
                      padding: "18px 28px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: 8,
                          background: "#8B5CF6",
                          color: "#fff",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Lock size={16} />
                      </div>
                      <div>
                        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, color: C.ink }}>
                          Subscription Required
                        </div>
                        <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate }}>
                          Choose a plan or buy a top-up below to unlock all {pluginName} features.
                        </div>
                      </div>
                    </div>
                  </div>
                  <SubscriptionPage wallet={wallet} />
                </div>
              ),
            })
          ) : (
            <div style={{ flex: 1, height: "100%", overflowY: "auto" }}>
              <SubscriptionPage wallet={wallet} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
