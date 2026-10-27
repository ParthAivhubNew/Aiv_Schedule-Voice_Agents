import React, { useEffect, useState } from "react";
import { C } from "../tokens";
import { adminApi } from "./adminApi";
import { Note, Pill, btn, card, input, mono, useAction, useLoad } from "./ui";

const FIELDS = [
  ["controller", "Who is responsible", "The company name the notice speaks for, as registered."],
  ["address", "Postal address", "Where a person can write to you."],
  ["contact_email", "Contact email", "Where people send requests. The opt-out form works without it."],
  ["ico_number", "ICO registration number", "The number from your Information Commissioner's Office registration."],
  ["retention", "How long you keep it (optional)", "Leave blank for the standard wording: records are refreshed from their source and removed when the source drops them."],
];

// The public notice and opt-out page for the shared business data, and the list of people who opted out.
export function DataCompliance({ canEdit }) {
  const [data, err, reload] = useLoad(adminApi.complianceNotice);
  const [msg, run] = useAction(reload);
  const [draft, setDraft] = useState(null);
  const [search, setSearch] = useState("");
  const [list, setList] = useState({ total: 0, optOuts: [] });
  const [add, setAdd] = useState({ email: "", phone: "" });

  const loadList = (q = search) => adminApi.optOuts(q).then(setList, () => {});
  useEffect(() => { if (data) setDraft((d) => d || data.notice); }, [data]);
  useEffect(() => { adminApi.optOuts("").then(setList, () => {}); }, []);

  if (!data || !draft) return <Note error={err}>{err}</Note>;
  const missing = data.missing || [];

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ fontSize: 12.5, color: C.slate }}>
        Before you import data that can name people, publish the notice, offer an opt-out and keep the list below. The notice lists every
        active source with its credit, so the sources you add appear in it by themselves.
      </div>
      <Note error={msg.error}>{msg.text}</Note>

      <div style={{ ...card, display: "grid", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <div style={{ fontWeight: 700 }}>Privacy notice</div>
          {missing.length ? <Pill tone="amber">Not ready: add {missing.join(", ")}</Pill> : <Pill tone="green">Ready to publish</Pill>}
        </div>
        <div style={{ fontSize: 12.5 }}>
          Public pages: <a href={data.noticeUrl} target="_blank" rel="noreferrer">notice</a> · <a href={data.optOutUrl} target="_blank" rel="noreferrer">opt-out form</a>.
          Every cold email already links to the notice.
        </div>
        {FIELDS.map(([key, label, hint]) => (
          <label key={key} style={{ display: "grid", gap: 2, fontSize: 12.5, fontWeight: 600 }}>
            {label}
            <input aria-label={label} value={draft[key] || ""} disabled={!canEdit} style={input}
              onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />
            <span style={{ fontWeight: 400, color: C.slate, fontSize: 11.5 }}>{hint}</span>
          </label>
        ))}
        {canEdit && (
          <div><button type="button" style={btn(true)} onClick={() => run(() => adminApi.saveComplianceNotice(draft), "Notice saved.")}>Save notice</button></div>
        )}
      </div>

      <div style={{ ...card, display: "grid", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <div style={{ fontWeight: 700 }}>Opt-outs</div>
          <Pill>{list.total} {list.total === 1 ? "person" : "people"}</Pill>
        </div>
        <div style={{ fontSize: 12.5, color: C.slate }}>
          Everyone here is on the platform-wide do-not-email and do-not-call lists, their details are cleared from the shared records, and
          no later import puts them back. People opt out themselves on the public form, or you add them below (for example when they ask by phone).
        </div>
        <input aria-label="Search opt-outs" placeholder="Search by email or phone" value={search} style={input}
          onChange={(e) => { setSearch(e.target.value); loadList(e.target.value); }} />
        {list.optOuts.map((o) => (
          <div key={o.id} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12.5 }}>
            <span style={mono}>{o.email || "(phone only)"}</span>
            {o.phoneEnding && <span style={{ color: C.slate }}>phone ending {o.phoneEnding}</span>}
            <Pill>{o.source === "staff" ? "added by staff" : "opted out"}</Pill>
            <span style={{ color: C.slate }}>{o.createdAt ? new Date(o.createdAt).toLocaleDateString() : ""}</span>
            {canEdit && (
              <button type="button" style={{ ...btn(false), marginLeft: "auto" }}
                onClick={() => { if (window.confirm("Only remove this if the person asked to be added back. Their cleared details are not restored.")) run(() => adminApi.removeOptOut(o.id).then(() => loadList()), "Removed."); }}>Remove</button>
            )}
          </div>
        ))}
        {canEdit && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <input aria-label="Email to add" placeholder="Email" value={add.email} style={{ ...input, flex: "1 1 200px" }} onChange={(e) => setAdd({ ...add, email: e.target.value })} />
            <input aria-label="Phone to add" placeholder="Phone (optional)" value={add.phone} style={{ ...input, flex: "1 1 160px" }} onChange={(e) => setAdd({ ...add, phone: e.target.value })} />
            <button type="button" style={btn(true)}
              onClick={() => run(() => adminApi.addOptOut(add).then(() => { setAdd({ email: "", phone: "" }); return loadList(); }), "Added. Their details are being cleared in the background.")}>Add opt-out</button>
          </div>
        )}
      </div>
    </div>
  );
}
