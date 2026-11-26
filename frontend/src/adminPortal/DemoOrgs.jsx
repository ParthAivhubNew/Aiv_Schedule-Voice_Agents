import React, { useState } from "react";
import { C } from "../tokens";
import { adminApi } from "./adminApi";
import { Note, PageTitle, Pill, Table, btn, card, cell, input, useLoad } from "./ui";

// Demo organisations for sales (plan 12, B7): a real company with an end date. Its admin gets an invite link, shown here once and e-mailed
// when you tick it, never a password. A demo is suspended the day after it ends (everyone in it is signed out); extend it before then.

export function DemoOrgs() {
  const [data, err, reload] = useLoad(adminApi.demoOrgs);
  const [brands] = useLoad(adminApi.brands);
  const [form, setForm] = useState({ company: "", adminName: "", adminEmail: "", days: 14, brandId: "", standardRules: false, emailInvite: true, sampleData: true });
  const [made, setMade] = useState(null);
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const create = async () => {
    setBusy(true);
    setProblem("");
    setMade(null);
    try {
      const out = await adminApi.createDemoOrg({ ...form, days: Number(form.days) });
      setMade({ ...out, sampleAsked: form.sampleData });
      set({ company: "", adminName: "", adminEmail: "" });
      reload();
    } catch (e) {
      setProblem(e.message);
    }
    setBusy(false);
  };
  const act = async (fn) => {
    setProblem("");
    try {
      const out = await fn();
      if (out?.inviteLink) setMade({ ...out, again: true });
      reload();
    } catch (e) {
      setProblem(e.message);
    }
  };

  const brandList = brands?.brands || brands || [];
  const demos = data?.demos || [];
  return (
    <>
      <PageTitle title="Demo organisations" sub="A real company for a sales demo, with an end date. Its admin joins through an invite link, never a password." />
      <Note error={!!err}>{err}</Note>
      <div style={{ ...card, display: "grid", gap: 10, maxWidth: 640 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
          <label style={{ display: "grid", gap: 4, fontSize: 12.5 }}>Company<input style={input} value={form.company} onChange={(e) => set({ company: e.target.value })} /></label>
          <label style={{ display: "grid", gap: 4, fontSize: 12.5 }}>Admin's name<input style={input} value={form.adminName} onChange={(e) => set({ adminName: e.target.value })} /></label>
          <label style={{ display: "grid", gap: 4, fontSize: 12.5 }}>Admin's e-mail<input style={input} type="email" value={form.adminEmail} onChange={(e) => set({ adminEmail: e.target.value })} /></label>
          <label style={{ display: "grid", gap: 4, fontSize: 12.5 }}>Days it runs<input style={input} type="number" min={1} max={data?.maxDays || 90} value={form.days} onChange={(e) => set({ days: e.target.value })} /></label>
          <label style={{ display: "grid", gap: 4, fontSize: 12.5 }}>Brand
            <select style={input} value={form.brandId} onChange={(e) => set({ brandId: e.target.value })}>
              <option value="">No brand</option>
              {(Array.isArray(brandList) ? brandList : []).map((b) => <option key={b.id} value={b.id}>{b.displayName || b.name}</option>)}
            </select>
          </label>
        </div>
        <label style={{ display: "flex", gap: 8, fontSize: 12.5 }}><input type="checkbox" checked={form.standardRules} onChange={(e) => set({ standardRules: e.target.checked })} /> Start with the Standard B2B exclusions (as a filter they can switch off)</label>
        <label style={{ display: "flex", gap: 8, fontSize: 12.5 }}><input type="checkbox" checked={form.sampleData} onChange={(e) => set({ sampleData: e.target.checked })} /> Start with a sample list of up to 25 real companies from the register (accountants and bookkeepers, found by the demo's own search, so its rules apply)</label>
        <label style={{ display: "flex", gap: 8, fontSize: 12.5 }}><input type="checkbox" checked={form.emailInvite} onChange={(e) => set({ emailInvite: e.target.checked })} /> E-mail the invite to the admin</label>
        <div style={{ fontSize: 12, color: C.slate }}>It starts with no credits, like a new sign-up. Give credits on Clients if the demo needs paid look-ups.</div>
        <div><button type="button" style={btn(true, busy)} disabled={busy} onClick={create}>{busy ? "Creating…" : "Create demo organisation"}</button></div>
        <Note error>{problem}</Note>
        {made ? (
          <div role="status" style={{ fontSize: 12.5, lineHeight: 1.5, background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 10, padding: 12, overflowWrap: "anywhere" }}>
            {made.again ? "A new invite link" : `Created. It ends on ${made.endsOn}.`}{" "}
            {!made.again && made.sampleSaved ? `It starts with a list, "${made.sampleList}", of ${made.sampleSaved} compan${made.sampleSaved === 1 ? "y" : "ies"}. ` : ""}
            {!made.again && made.sampleAsked && !made.sampleSaved ? "No company matched the sample search, so it starts with no list. " : ""}
            {made.emailed ? "The invite was e-mailed." : "Send this invite link to the admin."} It works once, for {made.inviteDays} days:
            <div style={{ fontFamily: "monospace", marginTop: 6 }}>{made.inviteLink}</div>
          </div>
        ) : null}
      </div>
      <Table head={["Company", "Admin", "Ends", "Status", ""]}>
        {demos.map((d) => (
          <tr key={d.orgId}>
            <td style={cell}>{d.name}</td>
            <td style={cell}>{d.adminEmail}</td>
            <td style={cell}>{d.endsOn} {d.daysLeft >= 0 ? `(${d.daysLeft} day${d.daysLeft === 1 ? "" : "s"} left)` : ""}</td>
            <td style={cell}><Pill tone={d.status === "active" ? "green" : "red"}>{d.endedAt ? "Ended" : d.status}</Pill></td>
            <td style={{ ...cell, whiteSpace: "nowrap" }}>
              <button type="button" style={btn(false)} onClick={() => act(() => adminApi.extendDemoOrg(d.orgId, 14))}>Extend 14 days</button>{" "}
              <button type="button" style={btn(false)} onClick={() => act(() => adminApi.reinviteDemoOrg(d.orgId))}>New invite link</button>
            </td>
          </tr>
        ))}
        {!demos.length ? <tr><td style={{ ...cell, color: C.slate }} colSpan={5}>No demo organisations yet.</td></tr> : null}
      </Table>
    </>
  );
}
