import React, { useEffect, useRef, useState } from "react";
import { api } from "../api/apiClient";
import { getOpenList, LISTS_CHANGED, stageCallList } from "../utils/leadToVoice";
import { navigateHash } from "../utils/route";
import { C, FONT_BODY } from "../tokens";

const LABEL = { leadgen: "Leads", voice: "Voice" };

// When someone with both Leads and Voice switches from one to the other while a list is open, offer to
// bring that list along. `plugin` is the app now on screen.
export function ListHandoffPrompt({ plugin }) {
  const prev = useRef(plugin);
  const [offer, setOffer] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const onToast = (m) => { setNote(m); setTimeout(() => setNote(""), 4500); };

  useEffect(() => {
    const from = prev.current;
    prev.current = plugin;
    if (!from || from === plugin) return;
    if (!((from === "leadgen" && plugin === "voice") || (from === "voice" && plugin === "leadgen"))) return;
    const list = getOpenList(from);
    if (!list) return;
    let live = true;
    api.getBillingAccess().then((res) => {
      const plans = res?.has_active_plan || {};
      if (live && plans.leadgen && plans.voice) setOffer({ from, to: plugin, list });
    }).catch(() => {});
    return () => { live = false; };
  }, [plugin]);

  if (!offer) {
    return note ? <div role="status" style={{ position: "fixed", left: "50%", bottom: 24, transform: "translateX(-50%)", zIndex: 1000, background: C.ink, color: "#fff", padding: "10px 16px", borderRadius: 10, fontFamily: FONT_BODY, fontSize: 13, maxWidth: "calc(100vw - 32px)" }}>{note}</div> : null;
  }
  const { from, to, list } = offer;
  const close = () => setOffer(null);
  const bring = async () => {
    setBusy(true);
    try {
      if (from === "leadgen") {
        const staged = list.build();
        if (!staged.records.length) { onToast("None of these companies has a phone number yet."); return close(); }
        if (!stageCallList(staged)) { onToast("Couldn't pass the list to Voice."); return close(); }
        navigateHash("#/voice/list");
      } else {
        const ids = [...new Set(list.leadIds)];
        const saved = await api.saveLeadAccounts(list.newAccounts.slice(0, 2000), list.name);
        if (ids.length && saved?.list?.id) await api.updateLeadList(saved.list.id, { add: ids });
        window.dispatchEvent(new CustomEvent(LISTS_CHANGED));
        navigateHash("#/leadgen/lists");
        onToast(`${list.name} is now a list in Leads.`);
      }
      close();
    } catch (e) {
      onToast(e.message || "Couldn't bring the list across.");
    } finally {
      setBusy(false);
    }
  };
  const what = from === "voice" ? `${list.count.toLocaleString()} ${list.count === 1 ? "row" : "rows"}` : `${list.count.toLocaleString()} ${list.count === 1 ? "company" : "companies"}`;

  return (
    <div onClick={close} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(15,23,42,0.45)", display: "grid", placeItems: "center", padding: 16 }}>
      <div role="dialog" aria-modal="true" aria-label="Bring your list across" onClick={(e) => e.stopPropagation()}
        style={{ width: "min(440px, 100%)", background: "#fff", borderRadius: 14, padding: 22, display: "grid", gap: 12, fontFamily: FONT_BODY, color: C.ink, boxShadow: "0 20px 50px rgba(0,0,0,0.25)" }}>
        <strong style={{ fontSize: 17 }}>Bring "{list.name}" to {LABEL[to]}?</strong>
        <div style={{ fontSize: 14, color: C.slate, lineHeight: 1.5 }}>
          You had this list open in {LABEL[from]} ({what}). {from === "leadgen" ? "It opens on the Voice call list, ready to look over before calling." : "Its companies are saved to Leads, skipping any you already have, and grouped in a list of the same name."}
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button type="button" className="ui-btn ui-btn--ghost" onClick={close}>No, thanks</button>
          <button type="button" className="ui-btn ui-btn--primary" disabled={busy} onClick={bring}>{busy ? "Working…" : `Bring it to ${LABEL[to]}`}</button>
        </div>
      </div>
    </div>
  );
}
