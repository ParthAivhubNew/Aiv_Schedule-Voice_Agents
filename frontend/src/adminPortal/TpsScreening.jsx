import React, { useState } from "react";
import { C } from "../tokens";
import { adminApi } from "./adminApi";
import { Note, Pill, btn, card, input, useAction, useLoad, when } from "./ui";

// The key for the TPS and CTPS screening service (Provero). Staff save it here once; after that users can check their numbers (Leads lists,
// Voice call lists) and the checks are charged in credits by the rate card ("TPS/CTPS check"). The key is never shown again, only its last four characters.
export function TpsScreening({ canEdit }) {
  const [data, err, reload] = useLoad(adminApi.tpsScreening);
  const [msg, run] = useAction(reload);
  const [key, setKey] = useState("");

  if (!data) return <Note error>{err || "Loading…"}</Note>;

  const save = async (e) => {
    e.preventDefault();
    const done = await run(() => adminApi.saveTpsScreening(key.trim()), "Key saved. Press Test to check it works.");
    if (done) setKey("");
  };

  return (
    <div style={{ ...card, display: "grid", gap: 10 }}>
      <div style={{ fontSize: 12.5, color: C.slate }}>
        Checks whether a UK phone number is on the TPS or CTPS register before it is called. One check is made per number, then the answer is kept for 28 days,
        so repeat checks in that time are free and are not charged. Users are charged by the rate card (Credit rates: "TPS/CTPS check", starting at 2 credits per 5 numbers).
        {" "}{data.priceNote}
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {data.configured ? <Pill tone="green">Key saved · …{data.tail}</Pill> : <Pill tone="amber">No key yet: users cannot check numbers</Pill>}
        {data.configured && data.savedAt ? <span style={{ fontSize: 12, color: C.slate }}>saved {when(data.savedAt)}</span> : null}
        {data.configured ? <span style={{ fontSize: 12, color: C.slate }}>Checks this month: <b>{data.checksThisMonth.toLocaleString()}</b></span> : null}
      </div>

      {data.lastError === "balance" ? <Note error>The screening account has no balance. Users' checks are failing until it is topped up on the vendor's site.</Note> : null}
      {data.lastError === "key" ? <Note error>The saved key was refused. Save a new one.</Note> : null}
      {data.lastTest ? (
        <div style={{ fontSize: 12.5 }}>
          Last test: <Pill tone={data.lastTest.ok ? "green" : "red"}>{data.lastTest.ok ? "Worked" : "Failed"}</Pill> {data.lastTest.message} <span style={{ color: C.slate }}>({when(data.lastTest.at)})</span>
        </div>
      ) : null}

      {canEdit ? (
        <form onSubmit={save} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
          <label style={{ fontSize: 11.5, color: C.slate, display: "grid", gap: 3, flex: "1 1 260px" }}>{data.configured ? "Replace the key" : "API key"}
            <input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Paste the key from the screening account" style={{ ...input, width: "100%" }} />
          </label>
          <button type="submit" style={btn(true)} disabled={key.trim().length < 10}>Save key</button>
          <button type="button" style={btn(false)} disabled={!data.configured}
            title="Makes one real check of a number reserved for test use. It uses one check from the balance."
            onClick={() => run(adminApi.testTpsScreening, "Test finished.")}>Test the key</button>
          {data.configured ? (
            <button type="button" style={btn(false)} onClick={() => { if (window.confirm("Remove the key? Users will not be able to check numbers until a new one is saved.")) run(adminApi.clearTpsScreening, "Key removed."); }}>Remove</button>
          ) : null}
        </form>
      ) : null}
      <Note error={msg.error}>{msg.text}</Note>
    </div>
  );
}
