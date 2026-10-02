import React, { useCallback, useMemo, useState } from "react";
import { ArrowLeft, Ban, Check, Search } from "lucide-react";
import { C } from "../tokens";
import { adminApi } from "./adminApi";
import { AwardsTable, GiveCredits } from "./GiveCredits";
import { AivhubToggle, Note, PageTitle, Pill, Table, btn, card, cell, fmt, heading, input, mono, useAction, useLoad, when } from "./ui";


const WALLETS = ["voice", "leadgen", "email", "scheduler"];
const statusTone = (s) => (s === "suspended" ? "red" : s === "active" ? "green" : "slate");

export function Clients({ canEdit, openId, open }) {
  const [includeAivhub, setIncludeAivhub] = React.useState(() => {
    try {
      const saved = localStorage.getItem("admin_include_aivhub");
      return saved !== null ? saved === "true" : true;
    } catch (_) {
      return true;
    }
  });

  const onToggle = (val) => {
    setIncludeAivhub(val);
    try {
      localStorage.setItem("admin_include_aivhub", String(val));
    } catch (_) {}
  };

  const loadClients = useCallback(() => adminApi.clients(includeAivhub), [includeAivhub]);
  const [list, err, reload] = useLoad(loadClients, [loadClients]);
  const [find, setFind] = useState("");
  const shown = useMemo(() => {
    const t = find.trim().toLowerCase();
    return (list || []).filter((o) => !t || `${o.name} ${o.id}`.toLowerCase().includes(t));
  }, [list, find]);

  if (openId) return <ClientDetail id={openId} canEdit={canEdit} back={() => { open(""); reload(); }} />;
  return (
    <>
      <PageTitle
        title="Clients"
        sub={list ? `${list.length} organisation${list.length === 1 ? "" : "s"} (${includeAivhub ? "including Aivhub" : "clients only"})` : "Loading…"}
        right={
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <AivhubToggle value={includeAivhub} onChange={onToggle} />
            <label style={{ position: "relative" }}>
              <Search size={14} style={{ position: "absolute", left: 10, top: 10, color: C.slate }} />
              <input aria-label="Find a client" placeholder="Find a client" value={find} onChange={(e) => setFind(e.target.value)} style={{ ...input, paddingLeft: 30, width: 220 }} />
            </label>
          </div>
        }
      />
      <Note error>{err}</Note>
      <Table head={["Organisation", "Status", "Users", "Numbers", ...WALLETS, "Stop at zero", "Verification", "Subscription", "Joined"]} minWidth={1100}>
        {shown.map((o) => (
          <tr key={o.id} onClick={() => open(o.id)} style={{ cursor: "pointer" }}>
            <td style={cell}><b>{o.name}</b><div style={{ ...mono, color: C.slateLight }}>{o.id}</div></td>
            <td style={cell}><Pill tone={statusTone(o.status)}>{o.status}</Pill></td>
            <td style={cell}>{o.users}</td>
            <td style={cell}>{o.numbers}</td>
            {WALLETS.map((w) => <td key={w} style={{ ...cell, ...mono, color: (o.wallets?.[w] || 0) <= 0 ? C.red : C.textInk }}>{fmt(o.wallets?.[w])}</td>)}
            <td style={cell}>{o.enforce ? "Yes" : "No"}</td>
            <td style={cell}>{o.verification || "—"}</td>
            <td style={cell}>{o.subscription}</td>
            <td style={cell}>{when(o.createdAt)}</td>
          </tr>
        ))}
      </Table>
    </>
  );
}

function ClientDetail({ id, canEdit, back }) {
  const load = useCallback(() => adminApi.client(id), [id]);
  const [c, err, reload] = useLoad(load, [load]);
  const [msg, run] = useAction(reload);
  const loadAwardList = useCallback(() => adminApi.awards({ orgId: id }), [id]);
  const [awards, awardsErr, loadAwards] = useLoad(loadAwardList, [loadAwardList]);
  const [temp, setTemp] = useState(null);
  const [existing, setExisting] = useState("");

  if (!c) return <><button type="button" style={btn(false)} onClick={back}><ArrowLeft size={13} /> Clients</button><Note error>{err}</Note></>;
  const suspended = c.status === "suspended";
  return (
    <>
      <button type="button" style={{ ...btn(false), marginBottom: 12 }} onClick={back}><ArrowLeft size={13} /> Clients</button>
      <PageTitle title={c.name} sub={<span style={mono}>{c.id} · joined {when(c.createdAt)}</span>}
        right={canEdit && (
          <button type="button" style={{ ...btn(!suspended), background: suspended ? C.teal : C.red, color: "#fff", border: "none" }}
            onClick={() => {
              const next = suspended ? "active" : "suspended";
              if (!suspended && !window.confirm(`Suspend ${c.name}? Everyone in it is signed out and cannot sign in until you reactivate it.`)) return;
              run(() => adminApi.setClientStatus(c.id, next), next === "suspended" ? "Suspended. Everyone in it was signed out." : "Active again.");
            }}>
            {suspended ? <Check size={13} /> : <Ban size={13} />} {suspended ? "Reactivate" : "Suspend"}
          </button>
        )} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Pill tone={statusTone(c.status)}>{c.status}</Pill>
        {c.subscription && <Pill tone="blue">Subscription: {c.subscription.status}{c.subscription.renewsAt ? ` · renews ${when(c.subscription.renewsAt)}` : ""}</Pill>}
        {c.telnyx && <Pill tone={c.telnyx.status === "ready" ? "green" : "amber"}>Telnyx {c.telnyx.mode}: {c.telnyx.status}</Pill>}
      </div>
      {c.telnyx?.error && <Note error>Telnyx: {c.telnyx.error}</Note>}
      <Note error={msg.error}>{msg.text}</Note>

      <div style={heading}>Credits</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
        {c.wallets.map((w) => (
          <div key={w.key} style={card}>
            <div style={{ fontSize: 12, color: C.slate, fontWeight: 600 }}>{w.label}</div>
            <div style={{ fontWeight: 700, fontSize: 20, color: w.empty ? C.red : C.textInk }}>{fmt(w.balance)}</div>
            {w.nextExpiry && <div style={{ fontSize: 11.5, color: C.slate }}>{fmt(w.nextExpiry.amount)} expire {when(w.nextExpiry.at)}</div>}
          </div>
        ))}
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, margin: "10px 0" }}>
        <input type="checkbox" checked={c.enforce} disabled={!canEdit} onChange={() => run(() => adminApi.setEnforce(c.id, !c.enforce), "Saved.")} />
        Stop each app when its credits reach zero
      </label>
      {canEdit && <GiveCredits client={c} onDone={() => { reload(); loadAwards(); }} />}

      <div style={heading}>Credits given by staff</div>
      <AwardsTable rows={awards || []} />
      <Note error>{awardsErr}</Note>

      <div style={heading}>Phone numbers</div>
      <Table head={["Number", "Status", "Provider", "Capabilities", "WhatsApp"]}>
        {c.numbers.length === 0 && <tr><td colSpan={5} style={{ ...cell, color: C.slate }}>None yet.</td></tr>}
        {c.numbers.map((n) => {
          const wa = n.capabilities.includes("whatsapp");
          const asked = n.capabilities.includes("whatsapp_requested");
          return (
            <tr key={n.id}>
              <td style={{ ...cell, ...mono }}>{n.e164}</td>
              <td style={cell}>{n.status}</td>
              <td style={cell}>{n.provider}</td>
              <td style={cell}>{n.capabilities.join(", ") || "—"}</td>
              <td style={cell}>
                {asked && <Pill tone="amber">Requested</Pill>}{" "}
                {canEdit && (
                  <button type="button" style={btn(false)} onClick={() => run(() => adminApi.setWhatsapp(c.id, n.id, !wa), wa ? "WhatsApp switched off." : "WhatsApp is live. The client was told.")}>
                    {wa ? "Switch off" : "Switch on"}
                  </button>
                )}
                {!canEdit && (wa ? "On" : "Off")}
              </td>
            </tr>
          );
        })}
      </Table>

      {canEdit && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
          <input aria-label="Number already on our Telnyx account" placeholder="+447700900123" value={existing}
            onChange={(e) => setExisting(e.target.value)} style={{ ...input, width: 200 }} />
          <button type="button" style={btn(false)} disabled={!existing.trim()}
            onClick={() => run(async () => {
              const r = await adminApi.attachNumber(c.id, existing.trim());
              setExisting("");
              return r;
            }, "Number added. It shows on their Numbers page and its calls reach this company.")}>
            Add a number we already own
          </button>
        </div>
      )}

      <div style={heading}>Business verification</div>
      <Table head={["Submitted", "Status", "Type", "Documents", "Reason"]}>
        {c.verifications.length === 0 && <tr><td colSpan={5} style={{ ...cell, color: C.slate }}>Not submitted.</td></tr>}
        {c.verifications.map((v) => (
          <tr key={v.id}>
            <td style={cell}>{when(v.at)}</td>
            <td style={cell}><Pill tone={v.status === "approved" ? "green" : /reject|unapproved|fail/.test(v.status) ? "red" : "amber"}>{v.status}</Pill></td>
            <td style={cell}>{v.entityType}</td>
            <td style={cell}>{v.documents.join(", ")}</td>
            <td style={cell}>{v.reason || "—"}</td>
          </tr>
        ))}
      </Table>

      <div style={heading}>Users</div>
      {temp && (
        <div style={{ ...card, marginBottom: 10 }}>
          Temporary password for <b>@{temp.username}</b>: <span style={{ ...mono, fontSize: 14 }}>{temp.temporaryPassword}</span>
          <div style={{ fontSize: 12, color: C.slate }}>Shown once. Give it to them privately; they choose their own at the next sign-in.</div>
        </div>
      )}
      <Table head={["Name", "Email", "Role", "Active", "Last sign-in", ""]}>
        {c.users.map((u) => (
          <tr key={u.id}>
            <td style={cell}>{u.name}<div style={{ ...mono, color: C.slateLight }}>@{u.username}</div></td>
            <td style={cell}>{u.email || "—"}</td>
            <td style={cell}>{u.role}</td>
            <td style={cell}>{u.active ? "Yes" : "No"}</td>
            <td style={cell}>{when(u.lastLoginAt)}</td>
            <td style={cell}>
              {canEdit && (
                <button type="button" style={btn(false)} onClick={() => {
                  if (!window.confirm(`Reset @${u.username}'s password? They are signed out everywhere.`)) return;
                  run(async () => setTemp(await adminApi.resetUserPassword(c.id, u.id)), "Password reset.");
                }}>Reset password</button>
              )}
            </td>
          </tr>
        ))}
      </Table>

      <div style={heading}>Number orders</div>
      <Table head={["Number", "Status", "Monthly cost", "When", "Error"]}>
        {c.orders.length === 0 && <tr><td colSpan={5} style={{ ...cell, color: C.slate }}>None.</td></tr>}
        {c.orders.map((o, i) => (
          <tr key={i}>
            <td style={{ ...cell, ...mono }}>{o.phoneNumber}</td>
            <td style={cell}>{o.status}</td>
            <td style={cell}>{o.monthlyCost || "—"}</td>
            <td style={cell}>{when(o.at)}</td>
            <td style={{ ...cell, color: C.red }}>{o.error || ""}</td>
          </tr>
        ))}
      </Table>

      <div style={heading}>Credit history</div>
      <Table head={["When", "App", "What", "Amount"]}>
        {c.history.length === 0 && <tr><td colSpan={4} style={{ ...cell, color: C.slate }}>Nothing yet.</td></tr>}
        {c.history.map((h) => (
          <tr key={h.id}>
            <td style={cell}>{when(h.at)}</td>
            <td style={cell}>{h.wallet}</td>
            <td style={cell}>{h.note || h.kind}{h.by ? ` · ${h.by}` : ""}</td>
            <td style={{ ...cell, ...mono, color: h.amount < 0 ? C.red : C.teal }}>{h.amount > 0 ? "+" : ""}{fmt(h.amount)}</td>
          </tr>
        ))}
      </Table>
    </>
  );
}
