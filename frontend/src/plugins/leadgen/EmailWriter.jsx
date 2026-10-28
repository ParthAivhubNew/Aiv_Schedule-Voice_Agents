import React, { useEffect, useState } from "react";
import { Spinner } from "../../app/Loader";
import { Sparkles } from "lucide-react";
import { api } from "../../api/apiClient";
import { announceCreditsChanged } from "./CreditsChip";
import { C, FONT_BODY } from "../../tokens";
import { askText } from "./Dialogs";
import { SearchStatus } from "./SearchStatus";

// Smart email writing. The AI is given two things only: what the user told us about their own business
// ("About your business") and what we hold about each company, every fact labelled with where it came from.
// The server checks every email and line against those facts, so a made-up number, name or claim is flagged
// or dropped. Nothing here sends anything: the person reads and edits first.

const text = { fontFamily: FONT_BODY };
const muted = { ...text, fontSize: 13, color: C.slate, lineHeight: 1.5 };
const label = { ...text, fontSize: 12.5, fontWeight: 600, color: C.textInk, display: "grid", gap: 4 };

export const ALLOWED_FIELDS = ["first_name", "firstname", "last_name", "lastname", "company", "personal_line", "personalline"];

// Merge fields the sender can't fill in (a typo like {{frist_name}} would otherwise go out as a blank).
export function unknownFields(...parts) {
  const bad = new Set();
  for (const part of parts) {
    for (const m of String(part || "").matchAll(/\{\{\s*([A-Za-z_]+)\s*\}\}/g)) {
      if (!ALLOWED_FIELDS.includes(m[1].toLowerCase())) bad.add(m[0]);
    }
  }
  return [...bad];
}

const BLANK = { company: "", website: "", sells: "", audience: "", offer: "", tone: "", sender_name: "", sender_title: "", proof: [] };

// "About your business": the only things the AI may say about the sender.
export function ProfileBox({ onReady, onManage, page = false, compact = false }) {
  const [saved, setSaved] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [proof, setProof] = useState("");
  const [open, setOpen] = useState(page);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const apply = (r) => {
    setSaved(r);
    setForm({ ...BLANK, ...r.edit });
    setProof((r.edit.proof || []).join("\n"));
    onReady?.(!r.missing.length);
  };
  useEffect(() => {
    api.emailGetWritingProfile().then((r) => { apply(r); setOpen(page || Boolean(r.missing.length)); }).catch((e) => setError(e.message || "Couldn't load your business details."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      apply(await api.emailSaveWritingProfile({ ...form, proof: proof.split("\n").map((p) => p.trim()).filter(Boolean) }));
      setOpen(false);
    } catch (e) {
      setError(e.message || "Couldn't save.");
    } finally {
      setBusy(false);
    }
  };
  if (!saved) return error ? <div role="alert" style={{ ...muted, color: C.red }}>{error}</div> : null;
  const ready = !saved.missing.length;
  const locked = saved.can_edit === false;
  return (
    <div className="ui-card" style={{ padding: 12, display: "grid", gap: 10, borderColor: ready ? undefined : C.amber }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {page ? null : <strong style={{ ...text, fontSize: 13.5, color: C.ink }} title="The same company profile your other Outreach tools use">About your business</strong>}
        {!ready || (!open && !page) ? (
          <span style={{ ...muted, fontSize: 12.5, flex: "1 1 240px" }}>
            {ready ? `${saved.profile.company} is set up. The AI will write from it.` : `The AI writes only from what it knows about your business. Still needed: ${saved.missing.join(", ")}.`}
          </span>
        ) : null}
        {page ? null : <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" title="What the AI is allowed to say about your business" onClick={() => setOpen(!open)}>{open ? "Close" : locked ? "View" : ready ? "Edit" : "Fill in"}</button>}
        {onManage && !page ? <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" title="Open the About your business page in the menu" onClick={onManage}>Open full page</button> : null}
      </div>
      {open && compact ? (
        // The three things the AI cannot write without; everything else is one click away
        <div style={{ display: "grid", gap: 10 }}>
          <label style={label}>Your company name<input className="ui-input" value={form.company} onChange={set("company")} maxLength={120} /></label>
          <label style={label} title="The name the emails are signed with">Who the emails are from (the name at the bottom)<input className="ui-input" value={form.sender_name} onChange={set("sender_name")} maxLength={80} placeholder="For example Priya Shah" /></label>
          <label style={label} title="Plain words. The AI cannot say more about you than this">What your business does
            <textarea className="ui-input" rows={2} value={form.sells} onChange={set("sells")} maxLength={700} style={{ height: "auto", padding: "8px 10px" }} placeholder="For example Bookkeeping and year-end accounts for small shops and cafes" /></label>
          <details>
            <summary style={{ ...muted, cursor: "pointer" }}>More details that help the AI (optional)</summary>
            <div style={{ display: "grid", gap: 10, marginTop: 8 }}>
              <label style={label}>Website<input className="ui-input" value={form.website} onChange={set("website")} maxLength={200} placeholder="https://" /></label>
              <label style={label}>Your job title<input className="ui-input" value={form.sender_title} onChange={set("sender_title")} maxLength={80} placeholder="For example Founder" /></label>
              <label style={label}>Who it is for<input className="ui-input" value={form.audience} onChange={set("audience")} maxLength={400} placeholder="For example Owner-run shops with fewer than 10 staff" /></label>
              <label style={label} title="The only results, numbers or customers the AI may quote. Leave empty and it quotes none">True things it may quote, one per line
                <textarea className="ui-input" rows={3} value={proof} onChange={(e) => setProof(e.target.value)} style={{ height: "auto", padding: "8px 10px" }} placeholder="We have looked after 40 local shops since 2015" /></label>
              <label style={label}>What to offer them<input className="ui-input" value={form.offer} onChange={set("offer")} maxLength={300} placeholder="For example a free 15-minute review of their books" /></label>
              <label style={label}>Tone<input className="ui-input" value={form.tone} onChange={set("tone")} maxLength={60} placeholder="Friendly and direct" /></label>
            </div>
          </details>
          {locked ? <div role="status" style={{ ...muted, fontSize: 12.5, color: C.amber }}>Only an admin can change this. Ask an admin to update it.</div> : null}
          {error ? <div role="alert" style={{ ...muted, color: C.red }}>{error}</div> : null}
          {locked ? null : <div><button type="button" className="ui-btn ui-btn--primary ui-btn--sm" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button></div>}
        </div>
      ) : open ? (
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12, alignItems: "end" }}>
            <label style={label} title="Your company's trading name">Company name (required)<input className="ui-input" value={form.company} onChange={set("company")} maxLength={120} /></label>
            <label style={label} title="Optional">Website<input className="ui-input" value={form.website} onChange={set("website")} maxLength={200} placeholder="https://" /></label>
            <label style={label} title="The name the emails are signed with">Sign-off name (required)<input className="ui-input" value={form.sender_name} onChange={set("sender_name")} maxLength={80} placeholder="For example Priya Shah" /></label>
            <label style={label} title="Optional, shown under the name">Sign-off job title<input className="ui-input" value={form.sender_title} onChange={set("sender_title")} maxLength={80} placeholder="For example Founder" /></label>
          </div>
          {locked ? <div role="status" style={{ ...muted, fontSize: 12.5, color: C.amber }}>Only an admin can change this, because every tool reads it. Ask an admin to update it.</div> : null}
          <div style={{ ...muted, fontSize: 12 }}>This is your company profile, shared with your other Outreach tools: change it here and it changes there.{saved.services ? ` Your ${saved.services} saved service${saved.services === 1 ? " is" : "s are"} included automatically.` : ""}</div>
          <label style={label} title="Plain words. The AI cannot say more about you than this">What your business does (required)
            <textarea className="ui-input" rows={3} value={form.sells} onChange={set("sells")} maxLength={700} style={{ height: "auto", padding: "8px 10px" }} placeholder="For example Bookkeeping and year-end accounts for small shops and cafes" /></label>
          <label style={label} title="Who you help. Helps the AI aim the email">Who it is for<input className="ui-input" value={form.audience} onChange={set("audience")} maxLength={400} placeholder="For example Owner-run shops with fewer than 10 staff" /></label>
          <label style={label} title="The only results, numbers or customers the AI may quote. Leave empty and it quotes none">Proof it may quote, one per line (only true things)
            <textarea className="ui-input" rows={3} value={proof} onChange={(e) => setProof(e.target.value)} style={{ height: "auto", padding: "8px 10px" }} placeholder="We have looked after 40 local shops since 2015" /></label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12, alignItems: "end" }}>
            <label style={label} title="What you offer the reader as the next step">What to offer them<input className="ui-input" value={form.offer} onChange={set("offer")} maxLength={300} placeholder="For example a free 15-minute review of their books" /></label>
            <label style={label} title="For example friendly, formal, direct">Tone<input className="ui-input" value={form.tone} onChange={set("tone")} maxLength={60} placeholder="Friendly and direct" /></label>
          </div>
          {error ? <div role="alert" style={{ ...muted, color: C.red }}>{error}</div> : null}
          {locked ? null : (
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" disabled={busy} title="Save what the AI may say about your business" onClick={save}>{busy ? "Saving…" : "Save"}</button>
              <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" title="Put back what was last saved" onClick={() => { apply(saved); setError(""); }}>Reset</button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

// "Write with AI" for the whole sequence.
export function SequenceWriter({ accountIds, personalise, setPersonalise, ready, onWritten }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [instruction, setInstruction] = useState("");
  const run = React.useRef(0);
  const write = async () => {
    setBusy(true);
    setError("");
    const mine = ++run.current;
    try {
      const r = await api.emailAiSequence({ account_ids: accountIds, personalise, instruction });
      if (mine !== run.current) return;
      onWritten(r.steps || []);
    } catch (e) {
      if (mine === run.current) setError(e.message || "Couldn't write the emails.");
    } finally {
      if (mine === run.current) setBusy(false);
    }
  };
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" className="ui-btn ui-btn--primary" disabled={busy || !ready} onClick={write}
          title={ready ? "Write the whole sequence from your business details and what this list has in common" : "Fill in About your business first"}>
          {busy ? <Spinner size={14} /> : <Sparkles size={14} />} Write the emails with AI
        </button>
        <label style={{ ...muted, display: "inline-flex", gap: 6, alignItems: "center" }} title="Adds an opening line about each company, built from facts we hold about it. You review every line before sending">
          <input type="checkbox" checked={personalise} onChange={(e) => setPersonalise(e.target.checked)} /> Open each email with a line about that company
        </label>
      </div>
      <input className="ui-input" value={instruction} onChange={(e) => setInstruction(e.target.value)} maxLength={400} aria-label="Anything the AI should know"
        title="Optional. For example: mention we are local, keep it very short, ask about their busiest month" placeholder="Anything to add? For example: keep it very short (optional)" />
      {busy ? <SearchStatus title="Writing your emails" detail="Using only what you told us about your business and what this list has in common. Every email is then checked against those facts." onCancel={() => { run.current += 1; setBusy(false); }} /> : null}
      {error ? <div role="alert" style={{ ...muted, color: C.red }}>{error}</div> : null}
    </div>
  );
}

// Per-email changes: shorter, softer, more formal, clearer, or the person's own instruction.
export function RefineBar({ email, ready, onChange }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const go = async (action, instruction = "") => {
    setBusy(action);
    setError("");
    try {
      const r = await api.emailAiRefine({ subject: email.subject, body: email.body, action, instruction });
      onChange(r);
    } catch (e) {
      setError(e.message || "Couldn't change it.");
    } finally {
      setBusy("");
    }
  };
  const btn = (action, labelText, tip) => (
    <button key={action} type="button" className="ui-btn ui-btn--ghost ui-btn--sm" disabled={Boolean(busy) || !ready || !email.body.trim()} title={tip} onClick={() => go(action)}>
      {busy === action ? "…" : labelText}
    </button>
  );
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ ...muted, fontSize: 12 }}>Improve with AI:</span>
        {btn("shorter", "Shorter", "Cut it to the point")}
        {btn("softer", "Softer ask", "Make the ask lower pressure")}
        {btn("formal", "More formal", "A more measured tone")}
        {btn("clearer", "Clearer", "Make it clearer without adding anything new")}
        <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" disabled={Boolean(busy) || !ready || !email.body.trim()} title="Tell the AI what to change"
          onClick={async () => { const ins = await askText({ title: "How should this email change?", label: "Your instruction", multiline: true, confirm: "Change it", maxLength: 400 }); if (ins) go("custom", ins); }}>
          {busy === "custom" ? "…" : "Your own…"}
        </button>
      </div>
      {error ? <div role="alert" style={{ ...muted, fontSize: 12, color: C.red }}>{error}</div> : null}
    </div>
  );
}

// What the AI-written text still gets wrong, or confirmation that it passed the fact check.
export function CheckNote({ email, aiWritten }) {
  const bad = unknownFields(email.subject, email.body);
  const flagged = aiWritten ? email.warnings || [] : [];
  if (bad.length) {
    return <div role="alert" style={{ ...muted, fontSize: 12.5, color: C.red }}>This uses {bad.join(", ")}, which can't be filled in and would go out blank. Use {"{{first_name}}"}, {"{{last_name}}"}, {"{{company}}"} or {"{{personal_line}}"}.</div>;
  }
  if (flagged.length) {
    return <div role="alert" style={{ ...muted, fontSize: 12.5, color: C.red }}>Check before sending: this email contains {flagged.join("; ")}. Edit or remove it, or ask the AI to change it.</div>;
  }
  return aiWritten ? <div style={{ ...muted, fontSize: 12.5, color: C.green }}>Checked: nothing here goes beyond what you told us and what the list holds.</div> : null;
}

// Opening lines per company: written from the facts we hold, shown with those facts, editable, and charged only when written.
export function PersonalLines({ leads, lines, setLines, ready }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState({}); // account id -> { facts, reason }
  const [error, setError] = useState("");
  const ids = leads.map((l) => l.account_id).filter(Boolean);
  const run = React.useRef(0);
  const write = async () => {
    setBusy(true);
    setError("");
    const mine = ++run.current;
    const nextLines = { ...lines };
    const nextInfo = { ...result };
    try {
      for (let i = 0; i < ids.length; i += 100) {
        if (mine !== run.current) return;
        const r = await api.emailAiPersonalise(ids.slice(i, i + 100));
        for (const l of r.lines) {
          if (l.line) nextLines[l.account_id] = l.line;
          nextInfo[l.account_id] = { facts: l.facts, reason: l.reason };
        }
        setLines({ ...nextLines });
        setResult({ ...nextInfo });
        announceCreditsChanged();
      }
    } catch (e) {
      if (mine === run.current) setError(e.message || "Couldn't write the opening lines.");
    } finally {
      if (mine === run.current) setBusy(false);
    }
  };
  const written = ids.filter((id) => (lines[id] || "").trim()).length;
  const names = Object.fromEntries(leads.map((l) => [l.account_id, l.company]));
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ ...text, fontSize: 13.5, fontWeight: 600, color: C.ink }}>Opening lines about each company</div>
      <div style={muted}>Each line is built only from facts we hold about that company, and you can see which. If we hold nothing solid, the email simply opens without one. You are charged only for lines actually written: 1 credit per 5.</div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" className="ui-btn ui-btn--secondary" disabled={busy || !ready || !ids.length} onClick={write}
          title={ready ? "Write an opening line for each company from the facts we hold" : "Fill in About your business first"}>
          {busy ? <Spinner size={14} /> : <Sparkles size={14} />} {written ? "Write the missing lines" : `Write lines for ${ids.length.toLocaleString()} companies`}
        </button>
        {written ? <span style={muted}>{written.toLocaleString()} of {ids.length.toLocaleString()} have a line.</span> : null}
        {written ? <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" title="Remove every written line" onClick={() => { setLines({}); setResult({}); }}>Clear all</button> : null}
      </div>
      {busy ? <SearchStatus title="Writing opening lines" detail="Reading what we hold about each company and writing one sentence from it. Lines that go beyond the facts are dropped." onCancel={() => { run.current += 1; setBusy(false); }} cancelLabel="Stop and keep what's written" /> : null}
      {error ? <div role="alert" style={{ ...muted, color: C.red }}>{error}</div> : null}
      {Object.keys(result).length ? (
        <div style={{ display: "grid", gap: 6, maxHeight: 360, overflowY: "auto" }} className="ui-scroll">
          {ids.filter((id) => result[id]).map((id) => (
            <div key={id} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 10px", display: "grid", gap: 4 }}>
              <div style={{ ...text, fontSize: 12.5, fontWeight: 600, color: C.ink }}>{names[id]}</div>
              {(lines[id] || result[id].facts.length) ? (
                <>
                  <input className="ui-input" value={lines[id] || ""} aria-label={`Opening line for ${names[id]}`} maxLength={400} title="Edit it if you like. Leave it empty to open without a line"
                    onChange={(e) => setLines({ ...lines, [id]: e.target.value })} />
                  <div style={{ ...muted, fontSize: 12 }}>
                    Based on: {result[id].facts.map((f) => `${f.text} (${f.source}${f.verified ? "" : ", not verified"})`).join(" · ") || "your own edit"}
                  </div>
                </>
              ) : <div style={{ ...muted, fontSize: 12 }}>No line: {result[id].reason || "nothing solid to say."}</div>}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
