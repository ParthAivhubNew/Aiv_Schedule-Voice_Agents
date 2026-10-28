import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader, Spinner } from "../../app/Loader";
import {
  Archive, ArrowLeft, Ban, Bold, MessageSquare, Forward, FileText, Inbox, Italic, Link2, List, Mail, MailOpen, Paperclip, PenSquare,
  RefreshCw, Reply, ReplyAll, Search, Send, ShieldAlert, Star, Trash2, Underline, X,
} from "lucide-react";
import { api } from "../../api/apiClient";
import { DoNotEmailView, RepliesList, SentList } from "./OutreachViews";
import { C, FONT_BODY, FONT_DISPLAY } from "../../tokens";

const FOLDERS = [
  ["inbox", "Inbox", Inbox], ["sent", "Sent", Send], ["drafts", "Drafts", FileText],
  ["archive", "Archive", Archive], ["spam", "Spam", ShieldAlert], ["trash", "Trash", Trash2],
];

const CAMPAIGN_VIEWS = [["c_replies", "Replies", MessageSquare], ["c_sent", "Sent by campaigns", Send], ["c_dnc", "Do not email", Ban]];

const CSS = `
.ml{display:grid;grid-template-columns:200px 350px minmax(0,1fr);height:calc(100vh - 150px);min-height:460px;background:#fff;border:1px solid ${C.border};border-radius:12px;overflow:hidden}
.ml-rail{border-right:1px solid ${C.border};padding:12px;display:flex;flex-direction:column;gap:4px;overflow-y:auto;background:${C.paperSoft}}
.ml-list{border-right:1px solid ${C.border};display:flex;flex-direction:column;min-width:0;min-height:0}
.ml-read{display:flex;flex-direction:column;min-width:0;min-height:0}
.ml-folder{all:unset;cursor:pointer;display:flex;align-items:center;gap:9px;padding:8px 10px;border-radius:8px;font:500 13.5px ${FONT_BODY};color:${C.slate};box-sizing:border-box}
.ml-folder:hover{background:#fff}
.ml-folder.on{background:#fff;color:var(--ui-accent);font-weight:600;box-shadow:0 1px 3px rgba(18,20,28,.08)}
.ml-row{all:unset;cursor:pointer;display:flex;gap:10px;padding:10px 12px;border-bottom:1px solid ${C.borderLight};box-sizing:border-box;flex:1;min-width:0}
.ml-row:hover{background:${C.paperSoft}}
.ml-row.on{background:var(--ui-accent-soft)}
.ml-chip{all:unset;cursor:pointer;padding:3px 10px;border-radius:999px;border:1px solid ${C.border};font:500 12px ${FONT_BODY};color:${C.slate}}
.ml-chip.on{background:var(--ui-accent-soft);border-color:var(--ui-accent);color:var(--ui-accent-ink)}
.ml-wide{grid-column:2 / -1;min-width:0;min-height:0;overflow-y:auto;padding:16px 20px}
.ml-group{font:700 10.5px ${FONT_BODY};text-transform:uppercase;letter-spacing:.05em;color:${C.slate};margin:14px 10px 4px}
.ml-ibtn{all:unset;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;min-width:32px;height:32px;padding:0 8px;box-sizing:border-box;border-radius:8px;color:${C.slate};font:500 12.5px ${FONT_BODY}}
.ml-ibtn:hover{background:${C.paperSoft};color:${C.ink}}
.ml-ibtn[disabled]{opacity:.4;cursor:default}
.ml-back{display:none}
@keyframes ml-spin{to{transform:rotate(360deg)}}
@media (max-width:900px){
  .ml{grid-template-columns:1fr;height:calc(100dvh - 170px)}
  .ml>*{display:none}
  .ml[data-pane="list"]>.ml-wide{display:block}
  .ml[data-pane="folders"]>.ml-rail,.ml[data-pane="list"]>.ml-list,.ml[data-pane="read"]>.ml-read{display:flex}
  .ml-back{display:inline-flex}
}
`;

const small = { fontFamily: FONT_BODY, fontSize: 12, color: C.slate };
const inputStyle = { width: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13, background: "#fff", color: C.ink };

const asDate = (iso) => (iso ? new Date(/Z|[+-]\d\d:\d\d$/.test(iso) ? iso : `${iso}Z`) : null);
function shortWhen(iso) {
  const d = asDate(iso);
  if (!d) return "";
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString([], now.getFullYear() === d.getFullYear() ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });
}
const fullWhen = (iso) => { const d = asDate(iso); return d ? d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : ""; };
const who = (p) => (p && (p.name || p.email)) || "";
const esc = (s) => String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const size = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

// An email's own HTML, shown in a locked frame: no scripts, and pictures from the web only when asked for.
function Body({ msg, images }) {
  if (!msg.body_html) return <div style={{ whiteSpace: "pre-wrap", fontFamily: FONT_BODY, fontSize: 13.5, color: C.ink, overflowWrap: "anywhere" }}>{msg.body_text}</div>;
  const policy = `default-src 'none'; style-src 'unsafe-inline'; img-src data: ${images ? "https: http:" : ""}`;
  const doc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="${policy}"><base target="_blank"><style>body{margin:0;font:14px/1.5 system-ui,sans-serif;color:#12141c;overflow-wrap:anywhere}img{max-width:100%;height:auto}blockquote{margin:8px 0 8px 4px;padding-left:10px;border-left:3px solid #ddd;color:#555}</style>${msg.body_html}`;
  return <Frame doc={doc} />;
}

function Frame({ doc }) {
  const ref = useRef(null);
  const fit = () => {
    try { const d = ref.current.contentDocument; ref.current.style.height = `${Math.min(d.documentElement.scrollHeight + 4, 4000)}px`; } catch (_) { /* a locked frame can refuse */ }
  };
  return <iframe ref={ref} title="Email" sandbox="allow-same-origin allow-popups" srcDoc={doc} onLoad={fit} style={{ width: "100%", border: "none", minHeight: 40, display: "block" }} />;
}

async function save(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ── Writing ─────────────────────────────────────────────────────────────────
function Compose({ boxes, start, onClose, onSent, onDraftSaved }) {
  const [form, setForm] = useState(() => ({
    mailbox_id: start.mailbox_id || boxes[0]?.id || "", from_address: "", to: start.to || "", cc: start.cc || "", bcc: "",
    subject: start.subject || "", in_reply_to_id: start.in_reply_to_id || "", draft_id: start.draft_id || "",
  }));
  const [showCc, setShowCc] = useState(Boolean(start.cc));
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const editor = useRef(null);
  const dirty = useRef(false);
  const box = boxes.find((b) => b.id === form.mailbox_id);

  useEffect(() => {
    const sig = start.draft_id || start.in_reply_to_id ? "" : (box?.signature ? `<br><br>${esc(box.signature).replace(/\n/g, "<br>")}` : "");
    if (editor.current) editor.current.innerHTML = (start.html || "") + sig;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const body = () => editor.current?.innerHTML || "";
  const payload = () => ({ ...form, body_html: body() });
  const set = (k) => (e) => { dirty.current = true; setForm((f) => ({ ...f, [k]: e.target.value })); };

  const saveDraft = useCallback(async () => {
    if (!form.mailbox_id) return;
    try {
      const r = await api.mailSaveDraft({ ...payload(), id: form.draft_id });
      setForm((f) => ({ ...f, draft_id: r.message.id }));
      setSaved("Saved as draft");
      onDraftSaved && onDraftSaved();
    } catch (_) { setSaved(""); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form]);

  useEffect(() => {
    if (!dirty.current) return undefined;
    const t = setTimeout(saveDraft, 2500);
    return () => clearTimeout(t);
  }, [form, saveDraft]);

  const send = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await api.mailSend(payload(), files);
      onSent(r.message);
    } catch (e) { setError(e.message || "Could not send."); setBusy(false); }
  };
  const discard = async () => {
    if (form.draft_id) { try { await api.mailActions([form.draft_id], "delete_forever"); } catch (_) { /* nothing to remove */ } }
    onClose(Boolean(form.draft_id));
  };
  const cmd = (name, arg) => { editor.current?.focus(); document.execCommand(name, false, arg); dirty.current = true; setSaved(""); };
  const link = () => { const u = window.prompt("Link address (https://…)"); if (u && /^https?:\/\//i.test(u)) cmd("createLink", u); };
  const addFiles = (e) => { setFiles((f) => [...f, ...Array.from(e.target.files || [])].slice(0, 10)); e.target.value = ""; };
  const row = { display: "flex", alignItems: "center", gap: 8, borderBottom: `1px solid ${C.borderLight}`, padding: "4px 0" };

  return (
    <div role="presentation" style={{ position: "fixed", inset: 0, zIndex: 130, background: "rgba(18,20,28,.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}>
      <div role="dialog" aria-label="Write an email" style={{ background: "#fff", borderRadius: 14, width: "100%", maxWidth: 720, maxHeight: "calc(100dvh - 24px)", display: "flex", flexDirection: "column", boxShadow: "0 24px 70px rgba(0,0,0,.25)" }}>
        <div style={{ display: "flex", alignItems: "center", padding: "12px 16px", borderBottom: `1px solid ${C.border}` }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, flex: 1, color: C.ink }}>{start.in_reply_to_id ? "Reply" : "New email"}</div>
          <button type="button" className="ml-ibtn" aria-label="Close" onClick={() => onClose(Boolean(form.draft_id))}><X size={18} /></button>
        </div>
        <div style={{ padding: "8px 16px", overflowY: "auto", flex: 1, minHeight: 0 }}>
          <div style={row}>
            <span style={{ ...small, width: 44 }}>From</span>
            <select value={form.from_address || form.mailbox_id} aria-label="From" style={{ ...inputStyle, border: "none", padding: "6px 0" }}
              onChange={(e) => { dirty.current = true; const v = e.target.value; const b = boxes.find((x) => x.id === v); setForm((f) => (b ? { ...f, mailbox_id: b.id, from_address: "" } : { ...f, from_address: v })); }}>
              {boxes.map((b) => (
                <optgroup key={b.id} label={b.email}>
                  <option value={b.id}>{b.name ? `${b.name} <${b.email}>` : b.email}</option>
                  {(b.aliases || []).map((a) => <option key={a.address} value={a.address}>{a.name ? `${a.name} <${a.address}>` : a.address}</option>)}
                </optgroup>
              ))}
            </select>
          </div>
          <div style={row}>
            <span style={{ ...small, width: 44 }}>To</span>
            <input aria-label="To" value={form.to} onChange={set("to")} placeholder="name@company.com, another@company.com" style={{ ...inputStyle, border: "none", padding: "6px 0" }} />
            {!showCc ? <button type="button" className="ml-chip" style={{ whiteSpace: "nowrap" }} onClick={() => setShowCc(true)}>Cc / Bcc</button> : null}
          </div>
          {showCc ? (
            <>
              <div style={row}><span style={{ ...small, width: 44 }}>Cc</span><input aria-label="Cc" value={form.cc} onChange={set("cc")} style={{ ...inputStyle, border: "none", padding: "6px 0" }} /></div>
              <div style={row}><span style={{ ...small, width: 44 }}>Bcc</span><input aria-label="Bcc" value={form.bcc} onChange={set("bcc")} style={{ ...inputStyle, border: "none", padding: "6px 0" }} /></div>
            </>
          ) : null}
          <div style={row}>
            <span style={{ ...small, width: 44 }}>Subject</span>
            <input aria-label="Subject" value={form.subject} onChange={set("subject")} style={{ ...inputStyle, border: "none", padding: "6px 0" }} />
          </div>
          <div style={{ display: "flex", gap: 2, padding: "8px 0 4px" }}>
            <button type="button" className="ml-ibtn" aria-label="Bold" onClick={() => cmd("bold")}><Bold size={15} /></button>
            <button type="button" className="ml-ibtn" aria-label="Italic" onClick={() => cmd("italic")}><Italic size={15} /></button>
            <button type="button" className="ml-ibtn" aria-label="Underline" onClick={() => cmd("underline")}><Underline size={15} /></button>
            <button type="button" className="ml-ibtn" aria-label="Bulleted list" onClick={() => cmd("insertUnorderedList")}><List size={15} /></button>
            <button type="button" className="ml-ibtn" aria-label="Link" onClick={link}><Link2 size={15} /></button>
          </div>
          <div ref={editor} contentEditable suppressContentEditableWarning role="textbox" aria-label="Message" aria-multiline="true"
            onInput={() => { dirty.current = true; setSaved(""); setForm((f) => ({ ...f })); }}
            style={{ minHeight: 200, outline: "none", fontFamily: FONT_BODY, fontSize: 14, lineHeight: 1.5, color: C.ink, overflowWrap: "anywhere", padding: "6px 0" }} />
          {files.length ? (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", paddingTop: 8 }}>
              {files.map((f, i) => (
                <span key={`${f.name}${i}`} className="ml-chip on" style={{ display: "inline-flex", gap: 6, alignItems: "center", cursor: "default" }}>
                  <Paperclip size={12} /> {f.name} · {size(f.size)}
                  <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles((x) => x.filter((_, j) => j !== i))} style={{ all: "unset", cursor: "pointer", display: "flex" }}><X size={12} /></button>
                </span>
              ))}
            </div>
          ) : null}
        </div>
        {error ? <div role="alert" style={{ padding: "8px 16px", background: "#fdecea", color: "#b3261e", fontFamily: FONT_BODY, fontSize: 12.5 }}>{error}</div> : null}
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", borderTop: `1px solid ${C.border}`, flexWrap: "wrap" }}>
          <button type="button" className="ui-btn ui-btn--primary" disabled={busy || !form.to.trim()} onClick={send}>{busy ? "Sending…" : "Send"}</button>
          <label className="ml-ibtn" style={{ cursor: "pointer" }} title="Attach files"><Paperclip size={16} /> Attach<input type="file" multiple hidden onChange={addFiles} /></label>
          <span style={{ ...small, flex: 1 }}>{saved}</span>
          <button type="button" className="ml-ibtn" onClick={discard}><Trash2 size={15} /> Discard</button>
        </div>
      </div>
    </div>
  );
}

// ── The screen ──────────────────────────────────────────────────────────────
export function MailView({ operator, outreach, start }) {
  const [boxes, setBoxes] = useState(null);
  const [counts, setCounts] = useState({});
  const [folder, setFolder] = useState(start?.sub === "sent" ? "c_sent" : start?.sub === "suppression" ? "c_dnc" : start?.sub === "replies" ? "c_replies" : "inbox");
  const [boxId, setBoxId] = useState(start?.mailboxId || "");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState({ unread: false, starred: false, attachments: false });
  const [data, setData] = useState({ threads: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState(() => new Set());
  const [open, setOpen] = useState("");
  const [thread, setThread] = useState(null);
  const [images, setImages] = useState(false);
  const [compose, setCompose] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [note, setNote] = useState("");
  const [pane, setPane] = useState("list");
  const alive = useRef(true);

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { const t = setTimeout(() => setQuery(q.trim()), 300); return () => clearTimeout(t); }, [q]);

  const flash = (text) => { setNote(text); setTimeout(() => alive.current && setNote(""), 3500); };
  const loadCounts = useCallback(() => api.mailCounts(boxId).then((r) => alive.current && setCounts(r.folders)).catch(() => {}), [boxId]);
  const loadList = useCallback(() => {
    if (folder.startsWith("c_")) { setLoading(false); return Promise.resolve(); }
    return api.mailMessages({ folder, mailbox_id: boxId, q: query, ...filter })
      .then((r) => { if (alive.current) { setData(r); setLoading(false); } })
      .catch(() => alive.current && setLoading(false));
  }, [folder, boxId, query, filter]);
  const loadBoxes = useCallback(() => api.mailMailboxes().then((r) => alive.current && setBoxes(r.mailboxes)).catch(() => alive.current && setBoxes([])), []);

  const sync = useCallback(async (force) => {
    setSyncing(true);
    try {
      const r = await api.mailSync(boxId, force);
      if (r.errors?.length) flash(`Could not read ${r.errors[0].mailbox}: ${r.errors[0].error}`);
      else if (force) flash(r.added ? `${r.added} new email${r.added === 1 ? "" : "s"}` : "You are up to date");
      await Promise.all([loadList(), loadCounts(), loadBoxes()]);
    } catch (e) { force && flash(e.message || "Could not check for mail."); } finally { alive.current && setSyncing(false); }
  }, [boxId, loadList, loadCounts, loadBoxes]);

  useEffect(() => { loadBoxes(); }, [loadBoxes]);
  useEffect(() => { setLoading(true); loadList(); loadCounts(); setPicked(new Set()); }, [loadList, loadCounts]);
  useEffect(() => {
    sync(false);
    const t = setInterval(() => sync(false), 60000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boxId]);

  const openThread = async (t) => {
    setOpen(t.thread_key);
    setPane("read");
    setImages(false);
    try {
      const r = await api.mailThread(t.thread_key, folder);
      if (!alive.current) return;
      setThread(r.messages);
      const unread = r.messages.filter((m) => !m.is_read).map((m) => m.id);
      if (unread.length) {
        await api.mailActions(unread, "read");
        loadList(); loadCounts(); loadBoxes();
      }
    } catch (e) { flash(e.message || "Could not open it."); setThread([]); }
  };

  const act = async (ids, action, done) => {
    if (!ids.length) return;
    try {
      await api.mailActions(ids, action);
      setPicked(new Set());
      if (done) flash(done);
      if (["archive", "trash", "spam", "inbox", "delete_forever"].includes(action) && thread?.some((m) => ids.includes(m.id))) { setOpen(""); setThread(null); setPane("list"); }
      else if (thread && thread.some((m) => ids.includes(m.id))) openThread({ thread_key: open });
      await Promise.all([loadList(), loadCounts()]);
    } catch (e) { flash(e.message || "That did not work."); }
  };

  const last = thread?.[thread.length - 1];
  const reply = (all) => {
    if (!last) return;
    const mine = new Set((boxes || []).map((b) => b.email.toLowerCase()));
    const sender = last.folder === "sent" ? (last.to[0]?.email || "") : last.from.email;
    const others = all ? [...last.to, ...(last.cc || [])].map((p) => p.email).filter((e) => !mine.has(e) && e !== sender) : [];
    const quoted = `<br><br><blockquote style="margin:0 0 0 4px;padding-left:10px;border-left:3px solid #ccc;color:#555">On ${esc(fullWhen(last.sent_at))}, ${esc(who(last.from))} wrote:<br>${esc(last.body_text).replace(/\n/g, "<br>")}</blockquote>`;
    setCompose({ mailbox_id: last.mailbox_id, to: sender, cc: others.join(", "), subject: /^re:/i.test(last.subject) ? last.subject : `Re: ${last.subject}`, in_reply_to_id: last.id, html: quoted });
  };
  const forward = () => {
    if (!last) return;
    const quoted = `<br><br>---------- Forwarded message ----------<br>From: ${esc(who(last.from))} &lt;${esc(last.from.email)}&gt;<br>Date: ${esc(fullWhen(last.sent_at))}<br>Subject: ${esc(last.subject)}<br><br>${esc(last.body_text).replace(/\n/g, "<br>")}`;
    setCompose({ mailbox_id: last.mailbox_id, subject: /^fwd?:/i.test(last.subject) ? last.subject : `Fwd: ${last.subject}`, html: quoted });
  };
  const editDraft = (m) => setCompose({ mailbox_id: m.mailbox_id, to: m.to.map((p) => p.email).join(", "), cc: (m.cc || []).map((p) => p.email).join(", "), subject: m.subject, html: m.body_html || esc(m.body_text).replace(/\n/g, "<br>"), draft_id: m.id, in_reply_to_id: "" });

  const togglePick = (id) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allPicked = data.threads.length > 0 && data.threads.every((t) => picked.has(t.id));
  const chosen = useMemo(() => Array.from(picked), [picked]);
  const inTrash = folder === "trash";
  const wide = folder.startsWith("c_");
  const current = boxes?.find((b) => b.id === boxId);

  if (boxes && !boxes.length) {
    return (
      <div className="ui-card" style={{ padding: 28, textAlign: "center", maxWidth: 520, margin: "40px auto" }}>
        <Mail size={28} color={C.slate} />
        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17, margin: "10px 0 4px", color: C.ink }}>No mailbox connected yet</div>
        <div style={{ ...small, fontSize: 13.5 }}>Connect your email account under Email accounts (the switch above) and your mail will show up here. {operator?.is_admin ? "" : "You see the mailboxes you connected."}</div>
      </div>
    );
  }

  return (
    <div>
      <style>{CSS}</style>
      <div className="ml" data-pane={pane}>
        <nav className="ml-rail" aria-label="Folders">
          <button type="button" className="ui-btn ui-btn--primary" style={{ marginBottom: 8 }} onClick={() => setCompose({ mailbox_id: boxId || boxes?.[0]?.id })} disabled={!boxes?.length}>
            <PenSquare size={15} /> Write
          </button>
          {FOLDERS.map(([id, label, Icon]) => {
            const c = counts[id] || {};
            const n = id === "drafts" ? c.total : c.unread;
            return (
              <button key={id} type="button" className={`ml-folder${folder === id ? " on" : ""}`} aria-current={folder === id} onClick={() => { setFolder(id); setOpen(""); setThread(null); setPane("list"); }}>
                <Icon size={16} /> <span style={{ flex: 1 }}>{label}</span>{n ? <span style={{ ...small, fontWeight: 700, color: id === "inbox" ? "var(--ui-accent)" : C.slate }}>{n}</span> : null}
              </button>
            );
          })}
          <div className="ml-group">Campaigns</div>
          {CAMPAIGN_VIEWS.map(([id, label, Icon]) => (
            <button key={id} type="button" className={`ml-folder${folder === id ? " on" : ""}`} aria-current={folder === id} onClick={() => { setFolder(id); setOpen(""); setThread(null); setPane("list"); }}>
              <Icon size={16} /> <span style={{ flex: 1 }}>{label}</span>
            </button>
          ))}
          <div style={{ ...small, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", fontSize: 10.5, margin: "14px 10px 4px" }}>Mailbox</div>
          <button type="button" className={`ml-folder${!boxId ? " on" : ""}`} onClick={() => setBoxId("")}><Mail size={16} /> <span style={{ flex: 1 }}>All mailboxes</span></button>
          {(boxes || []).map((b) => (
            <button key={b.id} type="button" className={`ml-folder${boxId === b.id ? " on" : ""}`} onClick={() => setBoxId(b.id)} title={b.email}>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.email}</span>{b.unread ? <span style={{ ...small, fontWeight: 700 }}>{b.unread}</span> : null}
            </button>
          ))}
        </nav>

        {wide ? (
          <section className="ml-wide" aria-label={CAMPAIGN_VIEWS.find(([id]) => id === folder)[1]}>
            {folder === "c_replies" ? <RepliesList /> : folder === "c_sent" ? <SentList outreach={outreach} initialMailbox={boxId} key={boxId || "all"} /> : <DoNotEmailView />}
          </section>
        ) : (<>
        <section className="ml-list" aria-label="Messages">
          <div style={{ padding: 10, borderBottom: `1px solid ${C.border}`, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <button type="button" className="ml-ibtn ml-back" aria-label="Folders" onClick={() => setPane("folders")}><ArrowLeft size={16} /></button>
              <div style={{ position: "relative", flex: 1 }}>
                <Search size={14} color={C.slate} style={{ position: "absolute", left: 10, top: 10 }} />
                <input aria-label="Search mail" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search mail" style={{ ...inputStyle, paddingLeft: 30 }} />
              </div>
              <button type="button" className="ml-ibtn" aria-label="Check for new mail" title={current?.synced_at ? `Last checked ${fullWhen(current.synced_at)}` : "Check for new mail"} onClick={() => sync(true)} disabled={syncing}>
                {syncing ? <Spinner size={15} /> : <RefreshCw size={15} />}
              </button>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {[["unread", "Unread"], ["starred", "Starred"], ["attachments", "Has attachment"]].map(([k, label]) => (
                <button key={k} type="button" className={`ml-chip${filter[k] ? " on" : ""}`} aria-pressed={filter[k]} onClick={() => setFilter((f) => ({ ...f, [k]: !f[k] }))}>{label}</button>
              ))}
            </div>
            {chosen.length ? (
              <div style={{ display: "flex", gap: 2, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ ...small, marginRight: 4 }}>{chosen.length} selected</span>
                {inTrash ? (
                  <>
                    <button type="button" className="ml-ibtn" onClick={() => act(chosen, "inbox", "Moved to Inbox")}><Inbox size={15} /> Restore</button>
                    <button type="button" className="ml-ibtn" style={{ color: C.red }} onClick={() => { if (window.confirm(`Delete ${chosen.length} for good? This cannot be undone.`)) act(chosen, "delete_forever", "Deleted for good"); }}><Trash2 size={15} /> Delete forever</button>
                  </>
                ) : (
                  <>
                    <button type="button" className="ml-ibtn" onClick={() => act(chosen, "archive", "Archived")}><Archive size={15} /> Archive</button>
                    <button type="button" className="ml-ibtn" onClick={() => act(chosen, "trash", "Moved to Trash")}><Trash2 size={15} /> Delete</button>
                    <button type="button" className="ml-ibtn" onClick={() => act(chosen, "read")}><MailOpen size={15} /> Read</button>
                    <button type="button" className="ml-ibtn" onClick={() => act(chosen, "unread")}><Mail size={15} /> Unread</button>
                    {folder !== "spam" ? <button type="button" className="ml-ibtn" onClick={() => act(chosen, "spam", "Moved to Spam")}><ShieldAlert size={15} /> Spam</button> : null}
                  </>
                )}
              </div>
            ) : (
              <label style={{ ...small, display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
                <input type="checkbox" checked={allPicked} onChange={() => setPicked(allPicked ? new Set() : new Set(data.threads.map((t) => t.id)))} /> Select all
                <span style={{ marginLeft: "auto" }}>{data.total} conversation{data.total === 1 ? "" : "s"}</span>
              </label>
            )}
          </div>
          <div style={{ overflowY: "auto", flex: 1, minHeight: 0 }}>
            {loading || !boxes ? <Loader compact label="Loading" /> : !data.threads.length ? (
              <div style={{ ...small, padding: 20, fontSize: 13.5 }}>{query || filter.unread || filter.starred || filter.attachments ? "Nothing matches." : inTrash ? "Trash is empty." : folder === "inbox" ? "Your inbox is empty." : "Nothing here yet."}</div>
            ) : data.threads.map((t) => (
              <div key={t.id} style={{ display: "flex", alignItems: "stretch" }}>
                <input type="checkbox" aria-label={`Select ${t.subject || "email"}`} checked={picked.has(t.id)} onChange={() => togglePick(t.id)} style={{ margin: "14px 0 0 10px" }} />
                <button type="button" className={`ml-row${open === t.thread_key ? " on" : ""}`} onClick={() => (folder === "drafts" ? api.mailMessage(t.id).then((r) => editDraft(r.message)).catch(() => {}) : openThread(t))}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", gap: 6, alignItems: "baseline" }}>
                      <span style={{ fontFamily: FONT_BODY, fontSize: 13.5, fontWeight: t.unread_count ? 700 : 500, color: C.ink, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {folder === "sent" || folder === "drafts" ? `To: ${who(t.to[0]) || "(no one)"}` : who(t.from)}{t.count > 1 ? <span style={{ ...small, marginLeft: 6 }}>{t.count}</span> : null}
                      </span>
                      <span style={small}>{shortWhen(t.sent_at)}</span>
                    </div>
                    <div style={{ fontFamily: FONT_BODY, fontSize: 13, fontWeight: t.unread_count ? 600 : 400, color: C.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.subject || "(no subject)"}</div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <span style={{ ...small, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.snippet}</span>
                      {t.has_attachments ? <Paperclip size={13} color={C.slate} aria-label="Has attachment" /> : null}
                      {t.is_starred ? <Star size={13} color="#d9a400" fill="#d9a400" aria-label="Starred" /> : null}
                      {t.unread_count ? <span aria-label="Unread" style={{ width: 8, height: 8, borderRadius: 999, background: "var(--ui-accent)" }} /> : null}
                    </div>
                  </div>
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="ml-read" aria-label="Conversation">
          {!thread ? (
            <div style={{ ...small, margin: "auto", textAlign: "center", padding: 24, fontSize: 13.5 }}>
              <Mail size={26} color={C.slate} style={{ opacity: 0.6 }} /><div style={{ marginTop: 8 }}>Pick a conversation to read it.</div>
            </div>
          ) : (
            <>
              <div style={{ padding: "10px 14px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
                <button type="button" className="ml-ibtn ml-back" aria-label="Back to list" onClick={() => setPane("list")}><ArrowLeft size={16} /></button>
                <button type="button" className="ml-ibtn" onClick={() => reply(false)}><Reply size={15} /> Reply</button>
                <button type="button" className="ml-ibtn" onClick={() => reply(true)}><ReplyAll size={15} /> Reply all</button>
                <button type="button" className="ml-ibtn" onClick={forward}><Forward size={15} /> Forward</button>
                <span style={{ flex: 1 }} />
                {last ? <button type="button" className="ml-ibtn" aria-label={last.is_starred ? "Remove star" : "Star"} onClick={() => act([last.id], last.is_starred ? "unstar" : "star")}><Star size={15} fill={last.is_starred ? "#d9a400" : "none"} color={last.is_starred ? "#d9a400" : undefined} /></button> : null}
                {inTrash ? (
                  <>
                    <button type="button" className="ml-ibtn" onClick={() => act(thread.map((m) => m.id), "inbox", "Moved to Inbox")}><Inbox size={15} /> Restore</button>
                    <button type="button" className="ml-ibtn" style={{ color: C.red }} onClick={() => { if (window.confirm("Delete this conversation for good? This cannot be undone.")) act(thread.map((m) => m.id), "delete_forever", "Deleted for good"); }}><Trash2 size={15} /> Delete forever</button>
                  </>
                ) : (
                  <>
                    <button type="button" className="ml-ibtn" aria-label="Archive" title="Archive" onClick={() => act(thread.map((m) => m.id), "archive", "Archived")}><Archive size={15} /></button>
                    <button type="button" className="ml-ibtn" aria-label="Mark unread" title="Mark unread" onClick={() => act(thread.map((m) => m.id), "unread")}><Mail size={15} /></button>
                    <button type="button" className="ml-ibtn" aria-label="Spam" title="Spam" onClick={() => act(thread.map((m) => m.id), "spam", "Moved to Spam")}><ShieldAlert size={15} /></button>
                    <button type="button" className="ml-ibtn" aria-label="Delete" title="Delete" onClick={() => act(thread.map((m) => m.id), "trash", "Moved to Trash")}><Trash2 size={15} /></button>
                  </>
                )}
              </div>
              <div style={{ overflowY: "auto", flex: 1, minHeight: 0, padding: "14px 18px" }}>
                <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 700, color: C.ink, margin: "0 0 12px", overflowWrap: "anywhere" }}>{last?.subject || "(no subject)"}</h2>
                {thread.some((m) => m.body_html) ? (
                  <label style={{ ...small, display: "flex", gap: 6, alignItems: "center", marginBottom: 10 }}>
                    <input type="checkbox" checked={images} onChange={(e) => setImages(e.target.checked)} /> Show pictures from the web
                  </label>
                ) : null}
                {thread.map((m, i) => <Message key={m.id} m={m} images={images} startOpen={i === thread.length - 1} />)}
              </div>
            </>
          )}
        </section>
        </>)}
      </div>
      {note ? <div role="status" className="app-toast" style={{ position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", background: C.ink, color: "#fff", padding: "9px 16px", borderRadius: 10, fontFamily: FONT_BODY, fontSize: 13, zIndex: 140 }}>{note}</div> : null}
      {compose ? (
        <Compose boxes={boxes || []} start={compose}
          onClose={() => { setCompose(null); loadList(); loadCounts(); }}
          onDraftSaved={() => { loadCounts(); if (folder === "drafts") loadList(); }}
          onSent={() => { setCompose(null); flash("Sent"); loadList(); loadCounts(); if (open) openThread({ thread_key: open }); }} />
      ) : null}
    </div>
  );
}

function Message({ m, images, startOpen }) {
  const [openIt, setOpenIt] = useState(startOpen);
  const [busy, setBusy] = useState("");
  const download = async (a) => {
    setBusy(a.name);
    try { save(await api.mailAttachment(m.id, a.index), a.name); } catch (_) { /* the file may have been too large to keep */ } finally { setBusy(""); }
  };
  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, marginBottom: 10, overflow: "hidden" }}>
      <button type="button" onClick={() => setOpenIt((o) => !o)} style={{ all: "unset", cursor: "pointer", display: "flex", gap: 10, alignItems: "baseline", padding: "10px 14px", width: "100%", boxSizing: "border-box", background: openIt ? C.paperSoft : "#fff" }}>
        <span style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: 13.5, color: C.ink }}>{who(m.from)}</span>
        {openIt ? <span style={{ ...small, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>to {m.to.map(who).join(", ")}</span> : <span style={{ ...small, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.snippet}</span>}
        <span style={small}>{fullWhen(m.sent_at)}</span>
      </button>
      {openIt ? (
        <div style={{ padding: "6px 14px 14px" }}>
          {m.cc?.length ? <div style={{ ...small, marginBottom: 6 }}>Cc: {m.cc.map(who).join(", ")}</div> : null}
          <Body msg={m} images={images} />
          {m.attachments?.length ? (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12 }}>
              {m.attachments.map((a) => (
                <button key={a.index} type="button" className="ml-chip" disabled={!a.available || busy === a.name} onClick={() => download(a)} title={a.available ? "Download" : "Too large to keep here"} style={{ display: "inline-flex", gap: 6, alignItems: "center", opacity: a.available ? 1 : 0.5 }}>
                  <Paperclip size={12} /> {a.name} · {size(a.size)}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
