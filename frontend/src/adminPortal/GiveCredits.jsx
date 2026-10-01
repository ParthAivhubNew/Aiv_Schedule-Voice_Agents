import React, { useEffect, useRef, useState } from "react";
import { Gift, X } from "lucide-react";
import { C, FONT_DISPLAY } from "../tokens";
import { adminApi } from "./adminApi";
import { Note, Pill, Table, btn, cell, fmt, input, mono, money, when } from "./ui";

const LABELS = [
  ["given", "Given (no payment)", "Not counted as revenue."],
  ["offline", "Offline payment", "Paid outside Stripe: bank transfer, cash, invoice."],
  ["paid", "Paid", "Paid some other way you can point to, e.g. a payment link."],
];
const EMPTY = { wallet: "voice", amount: "", label: "given", reason: "", paymentRef: "", paid: "", currency: "gbp", days: "" };
const labelTone = (l) => (l === "given" ? "amber" : "green");

// Giving credits takes three confirmations: the details, a summary to approve, then retyping the
// amount (or the staff member's password). The server holds the request between the steps and
// writes a permanent record; everyone concerned is emailed.
export function GiveCredits({ client, onDone }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState("form");
  const [form, setForm] = useState(EMPTY);
  const [preview, setPreview] = useState(null);
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const retypeRef = useRef(null);

  useEffect(() => { if (step === "retype") retypeRef.current?.focus(); }, [step]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const reset = () => { setStep("form"); setForm(EMPTY); setPreview(null); setConfirm(""); setError(""); setDone(null); };
  const close = () => {
    if (preview && step !== "done") adminApi.cancelAward(preview.id).catch(() => {});
    setOpen(false);
    reset();
  };
  const call = async (fn) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  };
  const set = (patch) => setForm({ ...form, ...patch });
  const paid = form.label !== "given";

  const toSummary = () => call(async () => {
    if (!(Number(form.amount) > 0)) throw new Error("Enter how many credits to give.");
    setPreview(await adminApi.previewAward(client.id, {
      wallet: form.wallet, amount: Number(form.amount), label: form.label, reason: form.reason,
      paymentRef: paid ? form.paymentRef : "", paidCents: paid ? Math.round(Number(form.paid) * 100) : 0,
      currency: paid ? form.currency : "", expiresInDays: form.days ? Number(form.days) : 0,
    }));
    setStep("summary");
  });
  const approve = () => call(async () => {
    try {
      setDone(await adminApi.approveAward(preview.id, confirm));
      setStep("done");
      onDone?.();
    } catch (err) {
      setConfirm("");
      if (/cancelled|expired/i.test(err.message)) { setPreview(null); setStep("form"); }
      throw err;
    }
  });

  return (
    <>
      <button type="button" style={btn(true)} onClick={() => setOpen(true)}><Gift size={13} /> Give credits</button>
      {open && (
        <div role="presentation" onClick={close} style={{ position: "fixed", inset: 0, background: "rgba(18,20,28,0.45)", zIndex: 50,
          display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "8vh 16px", overflowY: "auto" }}>
          <div role="dialog" aria-modal="true" aria-label="Give credits" onClick={(e) => e.stopPropagation()}
            style={{ background: "#fff", borderRadius: 16, padding: 20, width: "100%", maxWidth: 480, boxShadow: "0 20px 50px rgba(0,0,0,0.25)", display: "grid", gap: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17 }}>Give credits to {client.name}</div>
              <button type="button" aria-label="Close" style={{ ...btn(false), padding: 6 }} onClick={close}><X size={14} /></button>
            </div>
            <div style={{ fontSize: 11.5, color: C.slate }}>Step {{ form: 1, summary: 2, retype: 3, done: 3 }[step]} of 3</div>

            {step === "form" && (
              <>
                <label style={{ display: "grid", gap: 4, fontSize: 12.5, fontWeight: 600 }}>Wallet
                  <select value={form.wallet} onChange={(e) => set({ wallet: e.target.value })} style={input}>
                    {client.wallets.map((w) => <option key={w.key} value={w.key}>{w.label} (now {fmt(w.balance)})</option>)}
                  </select>
                </label>
                <label style={{ display: "grid", gap: 4, fontSize: 12.5, fontWeight: 600 }}>Credits to give
                  <input type="number" min="1" inputMode="numeric" value={form.amount} onChange={(e) => set({ amount: e.target.value })} style={input} />
                </label>
                <fieldset style={{ border: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
                  <legend style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}>How was it paid for?</legend>
                  {LABELS.map(([k, name, hint]) => (
                    <label key={k} style={{ display: "flex", gap: 8, fontSize: 12.5, alignItems: "flex-start" }}>
                      <input type="radio" name="award-label" checked={form.label === k} onChange={() => set({ label: k })} />
                      <span><b>{name}</b> <span style={{ color: C.slate }}>{hint}</span></span>
                    </label>
                  ))}
                </fieldset>
                {paid && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 110px 90px", gap: 8 }}>
                    <input aria-label="Payment reference" placeholder="Payment reference" value={form.paymentRef} onChange={(e) => set({ paymentRef: e.target.value })} style={input} />
                    <input aria-label="Amount paid" type="number" min="0" step="0.01" placeholder="Paid" value={form.paid} onChange={(e) => set({ paid: e.target.value })} style={input} />
                    <select aria-label="Currency" value={form.currency} onChange={(e) => set({ currency: e.target.value })} style={input}>
                      {["gbp", "usd", "eur", "inr"].map((c) => <option key={c} value={c}>{c.toUpperCase()}</option>)}
                    </select>
                  </div>
                )}
                <label style={{ display: "grid", gap: 4, fontSize: 12.5, fontWeight: 600 }}>Reason (kept for good, and sent to staff)
                  <textarea rows={2} value={form.reason} onChange={(e) => set({ reason: e.target.value })} style={{ ...input, resize: "vertical" }} />
                </label>
                <label style={{ display: "grid", gap: 4, fontSize: 12.5, fontWeight: 600 }}>Expire after (days, empty = never)
                  <input type="number" min="0" value={form.days} onChange={(e) => set({ days: e.target.value })} style={input} />
                </label>
                <Note error>{error}</Note>
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button type="button" style={btn(false)} onClick={close}>Cancel</button>
                  <button type="button" style={btn(true, busy)} disabled={busy} onClick={toSummary}>Continue</button>
                </div>
              </>
            )}

            {step === "summary" && preview && (
              <>
                <div style={{ background: C.amberSoft, borderRadius: 12, padding: 14, fontSize: 13.5, lineHeight: 1.5 }}>
                  <b>{preview.staffName}</b> is giving <b>{fmt(preview.amount)}</b> {client.wallets.find((w) => w.key === preview.wallet)?.label} credits to <b>{preview.orgName}</b>.
                  <div style={{ ...mono, fontSize: 15, margin: "8px 0" }}>Balance {fmt(preview.before)} → {fmt(preview.after)}</div>
                  <div><Pill tone={labelTone(preview.label)}>{preview.labelText}</Pill>{preview.label !== "given" && <> {money(preview.paidCents, preview.currency)} · ref {preview.paymentRef}</>}</div>
                  <div style={{ marginTop: 6, color: C.slate }}>Reason: {preview.reason}</div>
                  {preview.expiresInDays > 0 && <div style={{ color: C.slate }}>Expires after {preview.expiresInDays} days.</div>}
                </div>
                <div style={{ fontSize: 12, color: C.slate }}>This is recorded for good and emailed to the owner, every staff admin, you, and {client.name}'s admins.</div>
                <Note error>{error}</Note>
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button type="button" style={btn(false)} onClick={close}>Cancel</button>
                  <button type="button" style={btn(true)} onClick={() => setStep("retype")}>Approve</button>
                </div>
              </>
            )}

            {step === "retype" && preview && (
              <form onSubmit={(e) => { e.preventDefault(); approve(); }} style={{ display: "grid", gap: 10 }}>
                <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
                  <span>To confirm, type the number of credits (<b>{fmt(preview.amount)}</b>) or your password.</span>
                  <input ref={retypeRef} type="password" autoComplete="off" value={confirm} onChange={(e) => setConfirm(e.target.value)} style={input} />
                </label>
                <Note error>{error}</Note>
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button type="button" style={btn(false)} onClick={close}>Cancel</button>
                  <button type="submit" style={btn(true, busy || !confirm)} disabled={busy || !confirm}>Give {fmt(preview.amount)} credits</button>
                </div>
              </form>
            )}

            {step === "done" && done && (
              <>
                <Note>Done. {fmt(done.amount)} credits given; {done.walletName} balance is now {fmt(done.after)}. Record <span style={mono}>{done.id}</span>.</Note>
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button type="button" style={btn(true)} onClick={close}>Close</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// The permanent record of credits staff gave.
export function AwardsTable({ rows, showClient }) {
  const head = ["When", ...(showClient ? ["Client"] : []), "App", "Credits", "Label", "Paid", "Reason", "By", "Balance"];
  return (
    <Table head={head} minWidth={900}>
      {rows.length === 0 && <tr><td colSpan={head.length} style={{ ...cell, color: C.slate }}>None.</td></tr>}
      {rows.map((a) => (
        <tr key={a.id}>
          <td style={cell}>{when(a.at)}<div style={{ ...mono, color: C.slateLight }}>{a.id}</div></td>
          {showClient && <td style={cell}>{a.orgName}</td>}
          <td style={cell}>{a.walletName}</td>
          <td style={{ ...cell, ...mono }}>+{fmt(a.amount)}</td>
          <td style={cell}><Pill tone={labelTone(a.label)}>{a.labelText}</Pill></td>
          <td style={cell}>{a.label === "given" ? "—" : <>{money(a.paidCents, a.currency)}<div style={{ ...mono, color: C.slate }}>{a.paymentRef}</div></>}</td>
          <td style={{ ...cell, maxWidth: 260, overflowWrap: "anywhere" }}>{a.reason}</td>
          <td style={cell}>{a.staffName}<div style={{ fontSize: 11, color: C.slate }}>retyped {a.confirmedWith}</div></td>
          <td style={{ ...cell, ...mono }}>{fmt(a.before)} → {fmt(a.after)}</td>
        </tr>
      ))}
    </Table>
  );
}
