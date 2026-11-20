import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  X, Headset, Send, Upload, FileText, Trash2, AlertCircle,
  ChevronRight, Clock, CheckCircle2, XCircle, MessageSquare,
} from "lucide-react";
import { C } from "../tokens";
import { OPEN_EVENT, setSupportOpen } from "./openSupport";
import { createTicket, listTickets, SupportNotConnectedError } from "./supportApi";

const CATEGORIES = ["Bug", "Question", "Billing", "Idea"];
const SUBJECT_MAX = 150;
const DETAIL_MIN = 10;
const MAX_FILES = 5;
const MAX_FILE_MB = 10;
const ALLOWED_EXTS = ".png,.jpg,.jpeg,.gif,.webp,.pdf,.txt,.csv,.log,.zip";
const ALLOWED_LABEL = "PNG, JPG, GIF, WebP, PDF, TXT, CSV, LOG, ZIP";

// --- Ticket list row (shown when listTickets returns data) ---
export function TicketRow({ ticket, onOpen }) {
  const statusIcon = ticket.status === "open"
    ? <Clock size={14} style={{ color: C.amber }} />
    : ticket.status === "closed"
      ? <CheckCircle2 size={14} style={{ color: C.green }} />
      : <AlertCircle size={14} style={{ color: C.slate }} />;
  return (
    <button
      type="button"
      onClick={() => onOpen(ticket.id)}
      style={{
        all: "unset", boxSizing: "border-box", width: "100%", display: "flex",
        alignItems: "center", gap: 10, padding: "12px 14px", cursor: "pointer",
        borderBottom: `1px solid ${C.border}`, minHeight: 44,
      }}
    >
      {statusIcon}
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 13, fontWeight: 500, color: C.textInk, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {ticket.subject}
        </span>
        <span style={{ display: "block", fontSize: 12, color: C.slate, marginTop: 2 }}>
          {ticket.category} · {ticket.date}
        </span>
      </span>
      <ChevronRight size={16} style={{ color: C.slateLight, flexShrink: 0 }} />
    </button>
  );
}

// --- Ticket thread view (shown when a ticket is selected) ---
export function TicketThread({ ticket, onBack, onReply, onClose }) {
  const [reply, setReply] = useState("");
  const statusColor = ticket.status === "open" ? C.amber : ticket.status === "closed" ? C.green : C.slate;
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", borderBottom: `1px solid ${C.border}` }}>
        <button type="button" onClick={onBack} className="ui-icon-btn" aria-label="Back to tickets">
          <ChevronRight size={18} style={{ transform: "rotate(180deg)" }} />
        </button>
        <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: C.textInk, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {ticket.subject}
        </span>
        <span style={{ fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 999, color: statusColor, background: `color-mix(in srgb, ${statusColor} 12%, #fff)` }}>
          {ticket.status}
        </span>
      </div>
      <div className="ui-scroll" style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        {(ticket.messages || []).map((m, i) => (
          <div key={i} style={{ padding: "10px 14px", borderRadius: 8, background: m.from === "you" ? C.cobaltSoft : C.paperSoft, maxWidth: "88%", alignSelf: m.from === "you" ? "flex-end" : "flex-start" }}>
            <div style={{ fontSize: 11, fontWeight: 500, color: C.slate, marginBottom: 4 }}>{m.from === "you" ? "You" : "Support"} · {m.date}</div>
            <div style={{ fontSize: 13, color: C.textInk, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{m.text}</div>
          </div>
        ))}
      </div>
      {ticket.status !== "closed" && (
        <div style={{ padding: "10px 16px", borderTop: `1px solid ${C.border}`, display: "flex", gap: 8 }}>
          <input
            className="ui-input"
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="Write a reply"
            aria-label="Reply"
            style={{ flex: 1 }}
          />
          <button
            type="button"
            className="ui-btn ui-btn--primary"
            disabled={!reply.trim()}
            onClick={() => { if (onReply) onReply(reply.trim()); setReply(""); }}
          >
            <Send size={14} />
          </button>
          {onClose && (
            <button type="button" className="ui-btn ui-btn--ghost" onClick={onClose}>
              <XCircle size={14} /> Close
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// --- The Support panel itself ---
export function SupportHub() {
  const [open, setOpen] = useState(false);
  const [ctx, setCtx] = useState({});
  const [tab, setTab] = useState("form"); // "form" | "tickets"
  const panelRef = useRef(null);
  const openerRef = useRef(null);

  // Form state
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [category, setCategory] = useState("");
  const [subject, setSubject] = useState("");
  const [details, setDetails] = useState("");
  const [files, setFiles] = useState([]);
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Tickets state
  const [tickets, setTickets] = useState(null);
  const [selectedTicket, setSelectedTicket] = useState(null);

  // Open/close
  useEffect(() => {
    const handler = (e) => {
      openerRef.current = document.activeElement;
      setCtx(e.detail || {});
      setOpen(true);
      setNotice("");
    };
    window.addEventListener(OPEN_EVENT, handler);
    return () => window.removeEventListener(OPEN_EVENT, handler);
  }, []);

  useEffect(() => {
    setSupportOpen(open);
    if (open) {
      // Try to load tickets
      listTickets().then((list) => setTickets(list)).catch(() => setTickets(null));
      // Focus the panel
      const timer = setTimeout(() => { if (panelRef.current) panelRef.current.focus(); }, 60);
      return () => clearTimeout(timer);
    }
  }, [open]);

  const close = useCallback(() => {
    setOpen(false);
    setSupportOpen(false);
    if (openerRef.current && typeof openerRef.current.focus === "function") {
      try { openerRef.current.focus(); } catch (_) {}
    }
  }, []);

  // Esc to close
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, close]);

  // Validation
  const validate = () => {
    const errs = {};
    if (!name.trim()) errs.name = "Your name is required.";
    if (!email.trim()) errs.email = "Email is required.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errs.email = "Enter a valid email address.";
    if (!category) errs.category = "Pick a category.";
    if (!subject.trim()) errs.subject = "Subject is required.";
    if (details.trim().length < DETAIL_MIN) errs.details = `At least ${DETAIL_MIN} characters.`;
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    setNotice("");
    try {
      await createTicket({ name: name.trim(), email: email.trim(), category, subject: subject.trim(), details: details.trim(), plugin: ctx.plugin, screen: ctx.screen }, files);
      // If it somehow succeeds in a future version, still never show a success message in this phase.
      setNotice("Support tickets are not switched on yet. Nothing was sent.");
    } catch (err) {
      if (err && err.notConnected) {
        setNotice("Support tickets are not switched on yet. Nothing was sent.");
      } else {
        setNotice(err?.message || "Something went wrong. Try again later.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  // File handling
  const addFiles = (incoming) => {
    const next = [...files];
    for (const f of incoming) {
      if (next.length >= MAX_FILES) break;
      if (f.size > MAX_FILE_MB * 1024 * 1024) continue;
      if (!next.some((x) => x.name === f.name && x.size === f.size)) next.push(f);
    }
    setFiles(next);
  };
  const removeFile = (idx) => setFiles((prev) => prev.filter((_, i) => i !== idx));

  const fileInputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  if (!open) return null;

  return (
    <>
      <style>{POPUP_CSS}</style>
      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="false"
        aria-label="Support"
        tabIndex={-1}
        data-testid="support-panel"
        className="sh-pop"
        style={{
          position: "fixed", right: 24, bottom: 92, zIndex: 1000,
          width: "min(400px, calc(100vw - 32px))", height: "min(640px, calc(100vh - 116px))", background: "#fff",
          display: "flex", flexDirection: "column", overflow: "hidden",
          borderRadius: 16, border: `1px solid ${C.border}`,
          boxShadow: "0 18px 48px rgba(15, 23, 42, 0.22), 0 2px 8px rgba(15, 23, 42, 0.08)",
          animation: "sh-rise 0.2s ease-out backwards",
          outline: "none",
        }}
      >
        {/* Header */}
        <div style={{ background: C.gradientPrimary, padding: "16px 16px 14px 18px", flexShrink: 0, display: "flex", alignItems: "center", gap: 12 }}>
          <span aria-hidden="true" style={{ width: 40, height: 40, borderRadius: 12, background: "rgba(255,255,255,0.18)", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Headset size={22} color="#fff" />
          </span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#fff", lineHeight: 1.2 }}>Support</div>
            <div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.82)", marginTop: 3 }}>Tell us what went wrong</div>
          </div>
          <button type="button" onClick={close} aria-label="Close support"
            style={{ all: "unset", cursor: "pointer", width: 34, height: 34, borderRadius: "50%", background: "rgba(255,255,255,0.16)", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#fff", flexShrink: 0 }}>
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
          {[
            { id: "form", label: "Report issue" },
            { id: "tickets", label: "My tickets" },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => { setTab(t.id); setSelectedTicket(null); }}
              aria-selected={tab === t.id}
              style={{
                flex: 1, padding: "10px 0", border: "none", background: "none",
                fontSize: 13, fontWeight: 600, cursor: "pointer", minHeight: 44,
                color: tab === t.id ? C.cobalt : C.slate,
                borderBottom: tab === t.id ? `2px solid ${C.cobalt}` : "2px solid transparent",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="ui-scroll" style={{ flex: 1, overflowY: "auto" }}>
          {tab === "form" && (
            <form onSubmit={handleSubmit} noValidate style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Name */}
              <Field label="Your name" error={errors.name}>
                <input
                  className="ui-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  aria-label="Your name"
                  style={{ width: "100%" }}
                />
              </Field>

              {/* Email */}
              <Field label="Email" error={errors.email}>
                <input
                  className="ui-input"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  aria-label="Email"
                  style={{ width: "100%" }}
                />
              </Field>

              {/* Category */}
              <Field label="Category" error={errors.category}>
                <select
                  className="ui-input"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  aria-label="Category"
                  style={{ width: "100%" }}
                >
                  <option value="">Choose one</option>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>

              {/* Subject */}
              <Field label="Subject" error={errors.subject}>
                <div style={{ position: "relative" }}>
                  <input
                    className="ui-input"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value.slice(0, SUBJECT_MAX))}
                    maxLength={SUBJECT_MAX}
                    aria-label="Subject"
                    style={{ width: "100%", paddingRight: 48 }}
                  />
                  <span data-testid="subject-counter" aria-live="polite" style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 11, color: subject.length > SUBJECT_MAX - 10 ? C.amber : C.slateLight }}>
                    {subject.length}/{SUBJECT_MAX}
                  </span>
                </div>
              </Field>

              {/* Details */}
              <Field label="Problem details" error={errors.details} hint="What happened, what you expected, any error message">
                <div style={{ position: "relative" }}>
                  <textarea
                    className="ui-input"
                    value={details}
                    onChange={(e) => setDetails(e.target.value)}
                    rows={4}
                    aria-label="Problem details"
                    style={{ width: "100%", minHeight: 80, resize: "vertical", padding: "8px 10px" }}
                  />
                  <span data-testid="details-counter" aria-live="polite" style={{ position: "absolute", right: 10, bottom: 8, fontSize: 11, color: details.trim().length < DETAIL_MIN ? C.amber : C.slateLight }}>
                    {details.trim().length} characters
                  </span>
                </div>
              </Field>

              {/* Files */}
              <Field label="Attach files">
                <div
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(Array.from(e.dataTransfer.files)); }}
                  onClick={() => fileInputRef.current?.click()}
                  role="button"
                  tabIndex={0}
                  aria-label="Drop files here or click to browse"
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click(); }}
                  style={{
                    border: `1.5px dashed ${dragOver ? C.cobalt : C.border}`,
                    borderRadius: 8, padding: "14px 16px", textAlign: "center",
                    cursor: "pointer", background: dragOver ? C.cobaltSoft : "transparent",
                    transition: "border-color 0.12s, background 0.12s",
                    minHeight: 44, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4,
                  }}
                >
                  <Upload size={18} color={C.slateLight} />
                  <span style={{ fontSize: 12, color: C.slate }}>{files.length}/{MAX_FILES} files</span>
                  <span style={{ fontSize: 11, color: C.slateLight }}>{ALLOWED_LABEL} · up to {MAX_FILE_MB} MB each</span>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept={ALLOWED_EXTS}
                  style={{ display: "none" }}
                  onChange={(e) => { addFiles(Array.from(e.target.files)); e.target.value = ""; }}
                />
                {files.length > 0 && (
                  <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                    {files.map((f, i) => (
                      <div key={`${f.name}-${f.size}`} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 8px", background: C.paperSoft, borderRadius: 6, fontSize: 12, color: C.textInk }}>
                        <FileText size={14} color={C.slate} />
                        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                        <span style={{ color: C.slateLight, flexShrink: 0 }}>{(f.size / 1024).toFixed(0)} KB</span>
                        <button type="button" onClick={(e) => { e.stopPropagation(); removeFile(i); }} className="ui-icon-btn ui-icon-btn--sm" aria-label={`Remove ${f.name}`}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </Field>

              {/* Notice */}
              {notice && (
                <div
                  role="status"
                  aria-live="polite"
                  data-testid="support-notice"
                  style={{
                    padding: "12px 14px", borderRadius: 8, fontSize: 13, lineHeight: 1.5,
                    color: C.amber, background: C.amberSoft, border: `1px solid color-mix(in srgb, ${C.amber} 25%, transparent)`,
                    display: "flex", alignItems: "flex-start", gap: 8,
                  }}
                >
                  <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                  <span>{notice}</span>
                </div>
              )}

              {/* Submit */}
              <button
                type="submit"
                className="ui-btn ui-btn--primary"
                disabled={submitting}
                data-testid="support-submit"
                style={{ width: "100%", height: 40, fontSize: 14, minHeight: 44 }}
              >
                <Send size={15} /> Submit ticket
              </button>
            </form>
          )}

          {tab === "tickets" && !selectedTicket && (
            <div>
              {tickets && tickets.length > 0 ? (
                tickets.map((t) => <TicketRow key={t.id} ticket={t} onOpen={(id) => setSelectedTicket(tickets.find((x) => x.id === id))} />)
              ) : (
                <div data-testid="tickets-empty" style={{ padding: "48px 24px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
                  <MessageSquare size={36} color={C.slateLight} />
                  <p style={{ fontSize: 14, color: C.slate, margin: 0 }}>Tickets you send will appear here.</p>
                  <button type="button" className="ui-btn ui-btn--secondary" onClick={() => setTab("form")} style={{ minHeight: 44 }}>
                    Report an issue
                  </button>
                </div>
              )}
            </div>
          )}

          {tab === "tickets" && selectedTicket && (
            <TicketThread
              ticket={selectedTicket}
              onBack={() => setSelectedTicket(null)}
              onReply={(text) => {/* will call replyToTicket when backend is ready */}}
              onClose={() => {/* will call closeTicket when backend is ready */}}
            />
          )}
        </div>

        {/* Footer link to docs */}
        <div style={{ padding: "10px 20px", borderTop: `1px solid ${C.border}`, fontSize: 12.5, color: C.slate, flexShrink: 0 }}>
          Still stuck?{" "}
          <a href={`/help/${ctx.plugin || ""}`} target="_blank" rel="noreferrer" style={{ color: C.cobalt, fontWeight: 500, textDecoration: "none" }}>
            Read the documentation
          </a>
        </div>
      </div>
      <button type="button" className="sh-fab" onClick={close} aria-label="Close support" title="Close support"
        style={{ position: "fixed", right: 24, bottom: 24, zIndex: 1001, width: 52, height: 52, borderRadius: "50%", border: "none", cursor: "pointer", background: C.gradientPrimary, color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", boxShadow: "0 8px 24px rgba(52, 87, 213, 0.4)" }}>
        <X size={22} />
      </button>
    </>
  );
}

// The popup sits in the lower right corner with a round button under it. On a phone it takes the whole screen.
const POPUP_CSS = `
@keyframes sh-rise{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
@media (max-width:640px){
  .sh-pop{right:0!important;bottom:0!important;top:0!important;left:0!important;width:100%!important;height:100%!important;border-radius:0!important;border:0!important}
  .sh-fab{display:none!important}
}
@media (prefers-reduced-motion:reduce){.sh-pop{animation:none!important}}
`;

// --- Small field wrapper ---
function Field({ label, error, hint, children }) {
  return (
    <div>
      <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: C.textInk, marginBottom: 5 }}>
        {label}
      </label>
      {children}
      {hint && !error && <div style={{ fontSize: 11.5, color: C.slateLight, marginTop: 3 }}>{hint}</div>}
      {error && <div role="alert" style={{ fontSize: 12, color: C.red, marginTop: 3 }}>{error}</div>}
    </div>
  );
}
