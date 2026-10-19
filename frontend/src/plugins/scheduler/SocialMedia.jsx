import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Film, Image as ImageIcon, Link2, Search, Trash2, Upload, X } from "lucide-react";
import { api } from "../../api/apiClient";
import { C, FONT_BODY, FONT_DISPLAY, HUB_PAPER } from "../../tokens";
import { useEscapeLayer } from "./escapeLayers";

// The media library: every picture and video the company uploaded or the AI drew, ready to reuse.
// MediaLibraryPage manages it; MediaPicker lets the post editor pick files from it (in order).

const page = { flex: 1, overflowY: "auto", padding: "22px 28px 48px", background: HUB_PAPER, fontFamily: FONT_BODY };
const card = { background: "#fff", border: `1px solid ${C.border}`, borderRadius: 14, padding: 16 };
const muted = { fontSize: 12.5, color: C.slate, lineHeight: 1.5 };
const btn = {
  display: "inline-flex", alignItems: "center", gap: 6, height: 34, padding: "0 12px", borderRadius: 8,
  border: `1px solid ${C.border}`, background: "#fff", color: C.ink, fontWeight: 600, fontSize: 12.5, cursor: "pointer", fontFamily: FONT_BODY,
};
const primary = { ...btn, background: C.ink, color: "#fff", borderColor: C.ink };
const input = { height: 34, borderRadius: 8, border: `1px solid ${C.border}`, padding: "0 10px", fontFamily: FONT_BODY, fontSize: 13, boxSizing: "border-box", background: "#fff", minWidth: 0 };
// Visually hidden but read by screen readers.
export const srOnly = { position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap", border: 0 };
export const ACCEPT = "image/png,image/jpeg,image/webp,video/mp4,video/quicktime";

export const lengthLabel = (s) => (s == null ? "" : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`);
const sizeLabel = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

function useLibrary(kind = "") {
  const [data, setData] = useState({ items: [], tags: [], limits: { imageMb: 8, videoMb: 200 } });
  const [state, setState] = useState("loading");
  const [q, setQ] = useState("");
  const [tag, setTag] = useState("");
  const load = useCallback(() => {
    api.getMediaLibrary({ kind, q, tag })
      .then((d) => { setData(d); setState("ok"); })
      .catch(() => setState("error"));
  }, [kind, q, tag]);
  useEffect(() => {
    const t = window.setTimeout(load, q ? 250 : 0);
    return () => window.clearTimeout(t);
  }, [load, q]);
  return { ...data, state, q, setQ, tag, setTag, reload: load };
}

// Upload button + drop target. Calls onAdded(items) with what the server kept.
function useUploader({ onAdded, showToast }) {
  const [busy, setBusy] = useState(false);
  const upload = async (files) => {
    const list = Array.from(files || []);
    if (!list.length) return;
    setBusy(true);
    try {
      const res = await api.uploadMedia(list);
      (res.errors || []).forEach((e) => showToast && showToast(`${e.name}: ${e.error}`));
      if (res.items && res.items.length) onAdded(res.items);
    } catch (e) {
      showToast && showToast(e.message || "Upload failed.");
    } finally {
      setBusy(false);
    }
  };
  return { busy, upload };
}

export function MediaThumb({ item, size = "100%", height, onClick, selected, order, badge }) {
  const video = item.kind === "video";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected === undefined ? undefined : !!selected}
      aria-label={(video ? "Video " : "Picture ") + (item.name || item.alt || "")}
      style={{
        position: "relative", width: size, height: height || "auto", aspectRatio: height ? undefined : "1 / 1", padding: 0,
        border: `2px solid ${selected ? C.teal : "transparent"}`, borderRadius: 10, overflow: "hidden", background: "#0f1115",
        cursor: onClick ? "pointer" : "default", display: "block",
      }}
    >
      {video
        ? <video src={item.url} muted playsInline preload="metadata" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        : <img src={item.url} alt={item.alt || ""} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
      {video ? (
        <span style={{ position: "absolute", left: 6, bottom: 6, background: "rgba(0,0,0,0.72)", color: "#fff", fontSize: 10.5, fontWeight: 700, borderRadius: 6, padding: "2px 6px", display: "inline-flex", alignItems: "center", gap: 4 }}>
          <Film size={11} /> {lengthLabel(item.duration) || "Video"}
        </span>
      ) : null}
      {order ? (
        <span style={{ position: "absolute", right: 6, top: 6, width: 22, height: 22, borderRadius: 99, background: C.teal, color: "#fff", fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>{order}</span>
      ) : null}
      {badge ? (
        <span style={{ position: "absolute", left: 6, top: 6, background: "rgba(255,255,255,0.92)", color: C.ink, fontSize: 10, fontWeight: 700, borderRadius: 6, padding: "2px 6px" }}>{badge}</span>
      ) : null}
    </button>
  );
}

function Toolbar({ lib, kind, setKind, uploader, onImported, showToast, compact }) {
  const fileRef = useRef(null);
  const [link, setLink] = useState("");
  const [linkBusy, setLinkBusy] = useState(false);
  const addLink = async () => {
    if (!link.trim()) return;
    setLinkBusy(true);
    try {
      const res = await api.importMediaUrl(link.trim());
      setLink("");
      onImported([res.item]);
    } catch (e) {
      showToast && showToast(e.message || "Could not add that link.");
    } finally {
      setLinkBusy(false);
    }
  };
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
      <label style={{ position: "relative", flex: "1 1 200px", minWidth: 0 }}>
        <span style={srOnly}>Search the library</span>
        <Search size={14} color={C.slate} style={{ position: "absolute", left: 10, top: 10 }} aria-hidden="true" />
        <input value={lib.q} onChange={(e) => lib.setQ(e.target.value)} placeholder="Search names, alt text and tags" style={{ ...input, width: "100%", paddingLeft: 30 }} />
      </label>
      {setKind ? (
        <div role="group" aria-label="Show" style={{ display: "flex", gap: 4 }}>
          {[["", "All"], ["image", "Pictures"], ["video", "Videos"]].map(([id, label]) => (
            <button key={id || "all"} type="button" onClick={() => setKind(id)} aria-pressed={kind === id}
              style={{ ...btn, height: 34, background: kind === id ? C.ink : "#fff", color: kind === id ? "#fff" : C.ink, borderColor: kind === id ? C.ink : C.border }}>{label}</button>
          ))}
        </div>
      ) : null}
      <input ref={fileRef} type="file" multiple accept={ACCEPT} style={{ display: "none" }} onChange={(e) => { uploader.upload(e.target.files); e.target.value = ""; }} />
      <button type="button" style={primary} disabled={uploader.busy} onClick={() => fileRef.current && fileRef.current.click()}>
        <Upload size={14} /> {uploader.busy ? "Uploading…" : "Upload"}
      </button>
      {!compact ? (
        <form onSubmit={(e) => { e.preventDefault(); addLink(); }} style={{ display: "flex", gap: 6, flex: "1 1 260px", minWidth: 0 }}>
          <label style={{ flex: 1, minWidth: 0 }}>
            <span style={srOnly}>Link to a picture or video</span>
            <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Or paste a link to a picture or video" style={{ ...input, width: "100%" }} />
          </label>
          <button type="submit" style={btn} disabled={linkBusy || !link.trim()}><Link2 size={14} /> {linkBusy ? "Adding…" : "Add"}</button>
        </form>
      ) : null}
    </div>
  );
}

function DropZone({ onFiles, children }) {
  const [over, setOver] = useState(false);
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); onFiles(e.dataTransfer.files); }}
      style={{ borderRadius: 14, outline: over ? `2px dashed ${C.teal}` : "none", outlineOffset: 4 }}
    >
      {children}
    </div>
  );
}

function Details({ item, onSaved, onDeleted, onClose, showToast }) {
  const [name, setName] = useState(item.name || "");
  const [alt, setAlt] = useState(item.alt || "");
  const [tags, setTags] = useState((item.tags || []).join(", "));
  const [busy, setBusy] = useState(false);
  useEffect(() => { setName(item.name || ""); setAlt(item.alt || ""); setTags((item.tags || []).join(", ")); }, [item.id, item.name, item.alt, item.tags]);
  const save = async () => {
    setBusy(true);
    try {
      const res = await api.editMedia(item.id, { name, alt, tags });
      onSaved(res.item);
      showToast && showToast("Saved.");
    } catch (e) {
      showToast && showToast(e.message || "Could not save.");
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    const msg = item.usedBy
      ? `${item.usedBy} post${item.usedBy === 1 ? "" : "s"} not yet published use this. Delete it from the library anyway? Those posts keep their copy.`
      : "Delete this from the library? Published posts are not affected.";
    if (!window.confirm(msg)) return;
    setBusy(true);
    try {
      await api.deleteMedia(item.id, !!item.usedBy);
      onDeleted(item.id);
    } catch (e) {
      showToast && showToast(e.message || "Could not delete.");
    } finally {
      setBusy(false);
    }
  };
  const label = { fontSize: 11, fontWeight: 700, color: C.slate, display: "block", marginTop: 10 };
  return (
    <aside style={{ ...card, display: "flex", flexDirection: "column", gap: 4 }} aria-label="File details">
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 14, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name || (item.kind === "video" ? "Video" : "Picture")}</div>
        <button type="button" onClick={onClose} aria-label="Close details" style={{ border: "none", background: "none", cursor: "pointer", color: C.slate, padding: 4 }}><X size={15} /></button>
      </div>
      {item.kind === "video"
        ? <video src={item.url} controls playsInline style={{ width: "100%", borderRadius: 10, background: "#0f1115", maxHeight: 280 }} />
        : <img src={item.url} alt={item.alt || ""} style={{ width: "100%", borderRadius: 10, background: "#0f1115", maxHeight: 280, objectFit: "contain" }} />}
      <div style={{ ...muted, fontSize: 12 }}>
        {[item.width && item.height ? `${item.width} × ${item.height}` : "", item.duration != null ? lengthLabel(item.duration) : "", item.size ? sizeLabel(item.size) : "",
          item.source === "ai" ? "Drawn by the AI" : "Uploaded"].filter(Boolean).join(" · ")}
      </div>
      <div style={{ fontSize: 12, color: item.usedBy ? C.teal : C.slate }}>
        {item.usedBy ? `Used by ${item.usedBy} post${item.usedBy === 1 ? "" : "s"} not yet published` : "Not used by any upcoming post"}
      </div>
      <label style={label}>Name<input style={{ ...input, width: "100%", marginTop: 3 }} value={name} maxLength={200} onChange={(e) => setName(e.target.value)} /></label>
      <label style={label}>Description for screen readers (alt text)
        <textarea style={{ ...input, width: "100%", height: 64, padding: 8, marginTop: 3, resize: "vertical" }} value={alt} maxLength={1000} onChange={(e) => setAlt(e.target.value)}
          placeholder="What the picture shows. Used in every post you add it to." />
      </label>
      <label style={label}>Tags<input style={{ ...input, width: "100%", marginTop: 3 }} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="team, product, event" /></label>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button type="button" style={primary} disabled={busy} onClick={save}><Check size={14} /> Save</button>
        <button type="button" style={{ ...btn, color: "#B42318", borderColor: "#F3D1CD" }} disabled={busy} onClick={remove}><Trash2 size={14} /> Delete</button>
      </div>
    </aside>
  );
}

export function MediaLibraryPage({ showToast }) {
  const [kind, setKind] = useState("");
  const lib = useLibrary(kind);
  const [openId, setOpenId] = useState("");
  const [videoOpen, setVideoOpen] = useState(false);
  const uploader = useUploader({ onAdded: () => lib.reload(), showToast });
  const open = lib.items.find((m) => m.id === openId);
  return (
    <div style={page}>
      <div style={{ maxWidth: 1100, margin: "0 auto", display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ flex: "1 1 600px", minWidth: 0 }}>
            <Toolbar lib={lib} kind={kind} setKind={setKind} uploader={uploader} onImported={() => lib.reload()} showToast={showToast} />
          </div>
          <button type="button" style={{ ...primary, background: C.teal, borderColor: C.teal }} onClick={() => setVideoOpen(true)}>
            <Film size={14} /> Make a video with AI
          </button>
        </div>
        <VideoMaker open={videoOpen} onClose={() => { setVideoOpen(false); lib.reload(); }} onDone={() => lib.reload()} showToast={showToast} />
        {lib.tags.length ? (
          <div role="group" aria-label="Filter by tag" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {lib.tags.map((t) => (
              <button key={t} type="button" aria-pressed={lib.tag === t} onClick={() => lib.setTag(lib.tag === t ? "" : t)}
                style={{ ...btn, height: 28, fontSize: 11.5, borderRadius: 99, background: lib.tag === t ? C.tealSoft || "#E4F5F2" : "#fff", borderColor: lib.tag === t ? C.teal : C.border }}>#{t}</button>
            ))}
          </div>
        ) : null}
        <div style={{ ...muted, fontSize: 12 }}>
          Pictures up to {lib.limits.imageMb} MB (PNG, JPG, WebP) and videos up to {lib.limits.videoMb} MB (MP4, MOV). Pictures the AI draws are kept here too. Drop files anywhere on this page to upload them.
        </div>
        <DropZone onFiles={uploader.upload}>
          <div style={{ display: "grid", gridTemplateColumns: open ? "minmax(0, 1fr) minmax(260px, 340px)" : "1fr", gap: 16, alignItems: "start" }} className="media-layout">
            {lib.state === "loading" ? <div style={muted}>Loading the library…</div> : lib.state === "error" ? (
              <div style={card}>Could not load the library. <button type="button" style={btn} onClick={lib.reload}>Try again</button></div>
            ) : !lib.items.length ? (
              <div style={{ ...card, textAlign: "center", padding: 36, borderStyle: "dashed" }}>
                <ImageIcon size={22} color={C.slate} />
                <div style={{ fontWeight: 700, marginTop: 8 }}>{lib.q || lib.tag || kind ? "Nothing matches." : "No pictures or videos yet."}</div>
                <div style={{ ...muted, marginTop: 4 }}>{lib.q || lib.tag || kind ? "Try another search." : "Upload some, or they appear here when the AI draws a picture for a post."}</div>
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 10 }}>
                {lib.items.map((m) => (
                  <div key={m.id} style={{ minWidth: 0 }}>
                    <MediaThumb item={m} selected={openId === m.id} onClick={() => setOpenId(openId === m.id ? "" : m.id)}
                      badge={m.usedBy ? `In ${m.usedBy} post${m.usedBy === 1 ? "" : "s"}` : m.source === "ai" ? "AI" : ""} />
                    <div style={{ fontSize: 11.5, color: C.ink, marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={m.name}>{m.name || (m.kind === "video" ? "Video" : "Picture")}</div>
                  </div>
                ))}
              </div>
            )}
            {open ? (
              <Details item={open} showToast={showToast} onClose={() => setOpenId("")}
                onSaved={() => lib.reload()} onDeleted={() => { setOpenId(""); lib.reload(); }} />
            ) : null}
          </div>
        </DropZone>
      </div>
      <style>{"@media (max-width: 760px) { .media-layout { grid-template-columns: 1fr !important; } }"}</style>
    </div>
  );
}

// Pick files for a post, in order. `max` caps how many; `current` are already in the post.
export function MediaPicker({ open, onClose, onPick, max = 20, current = [], showToast, title = "Add pictures or videos" }) {
  const lib = useLibrary("");
  const [picked, setPicked] = useState([]);
  const uploader = useUploader({ onAdded: (items) => { lib.reload(); setPicked((p) => [...p, ...items.map((i) => i.id)].slice(0, room)); }, showToast });
  const room = Math.max(0, max - current.length);
  // Fresh picks and files each time it opens (not while the user types in search).
  const reloadRef = useRef(lib.reload);
  reloadRef.current = lib.reload;
  useEffect(() => { if (open) { setPicked([]); reloadRef.current(); } }, [open]);
  useEscapeLayer(open, 4, onClose);
  if (!open || typeof document === "undefined") return null;
  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= room ? p : [...p, id]));
  const chosen = picked.map((id) => lib.items.find((m) => m.id === id)).filter(Boolean);
  return createPortal(
    <div role="presentation" onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 2100, background: "rgba(18,20,28,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}
        style={{ width: "min(900px, 100%)", maxHeight: "min(720px, 100%)", background: "#fff", borderRadius: 16, display: "flex", flexDirection: "column", overflow: "hidden", fontFamily: FONT_BODY, boxShadow: "0 24px 64px rgba(0,0,0,0.25)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "14px 16px", borderBottom: `1px solid ${C.border}` }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, flex: 1 }}>{title}</div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ border: "none", background: "none", cursor: "pointer", color: C.slate, padding: 4 }}><X size={16} /></button>
        </div>
        <div style={{ padding: "12px 16px", borderBottom: `1px solid ${C.border}` }}>
          <Toolbar lib={lib} uploader={uploader} onImported={(items) => { lib.reload(); setPicked((p) => [...p, ...items.map((i) => i.id)].slice(0, room)); }} showToast={showToast} compact />
        </div>
        <DropZone onFiles={uploader.upload}>
          <div style={{ padding: 16, overflowY: "auto", maxHeight: "50vh" }}>
            {lib.state === "loading" ? <div style={muted}>Loading…</div> : !lib.items.length ? (
              <div style={{ ...muted, textAlign: "center", padding: 24 }}>Nothing in the library yet. Upload pictures or videos above, or drop them here.</div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 10 }}>
                {lib.items.map((m) => (
                  <MediaThumb key={m.id} item={m} onClick={() => toggle(m.id)} selected={picked.includes(m.id)}
                    order={picked.includes(m.id) ? current.length + picked.indexOf(m.id) + 1 : 0} />
                ))}
              </div>
            )}
          </div>
        </DropZone>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderTop: `1px solid ${C.border}`, flexWrap: "wrap" }}>
          <div style={{ ...muted, flex: 1, minWidth: 180 }}>
            {room ? `Pick up to ${room}. They are added in the order you pick them.` : "This post already holds the most files it can."}
          </div>
          <button type="button" style={btn} onClick={onClose}>Cancel</button>
          <button type="button" style={primary} disabled={!chosen.length} onClick={() => { onPick(chosen); onClose(); }}>
            <Check size={14} /> Add {chosen.length || ""}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const SHAPES = [["9:16", "Tall", "Reels, Stories, Shorts"], ["16:9", "Wide", "LinkedIn, X, Facebook"], ["1:1", "Square", "Feeds"]];

// Make a short clip with the video AI. It takes a few minutes; the window can be closed and the clip
// still lands in the media library (and on the post, when made from one).
export function VideoMaker({ open, onClose, postId, defaultPrompt = "", onDone, showToast }) {
  const [info, setInfo] = useState(null);
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [shape, setShape] = useState("9:16");
  const [seconds, setSeconds] = useState(5);
  const [job, setJob] = useState(null);
  const [busy, setBusy] = useState(false);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  useEscapeLayer(open, 4, onClose);
  useEffect(() => {
    if (!open) return;
    setPrompt(defaultPrompt);
    api.getVideos(postId || "").then((d) => {
      setInfo(d);
      const live = (d.jobs || []).find((j) => j.state === "queued" || j.state === "making");
      setJob(live || null);
    }).catch(() => setInfo({ available: false, jobs: [] }));
  }, [open, postId, defaultPrompt]);
  useEffect(() => {
    if (!job || (job.state !== "queued" && job.state !== "making")) return undefined;
    const t = window.setInterval(() => {
      api.getVideo(job.id).then((d) => {
        setJob(d.job);
        if (d.job.state === "done" && doneRef.current) doneRef.current(d.job);
      }).catch(() => {});
    }, 6000);
    return () => window.clearInterval(t);
  }, [job]);
  if (!open || typeof document === "undefined") return null;
  const start = async () => {
    setBusy(true);
    try {
      const r = await api.makeVideo({ prompt, shape, seconds, postId: postId || undefined });
      setJob(r.job);
    } catch (e) {
      if (showToast) showToast(e.message || "The clip could not be started.");
    } finally {
      setBusy(false);
    }
  };
  const making = job && (job.state === "queued" || job.state === "making");
  const label = { display: "block", fontSize: 11.5, fontWeight: 700, color: C.slate, marginTop: 12 };
  return createPortal(
    <div role="presentation" onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 2100, background: "rgba(18,20,28,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div role="dialog" aria-modal="true" aria-label="Make a video with AI" onClick={(e) => e.stopPropagation()}
        style={{ width: "min(560px, 100%)", maxHeight: "100%", overflowY: "auto", background: "#fff", borderRadius: 16, fontFamily: FONT_BODY, boxShadow: "0 24px 64px rgba(0,0,0,0.25)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "14px 16px", borderBottom: `1px solid ${C.border}` }}>
          <Film size={16} color={C.teal} aria-hidden="true" />
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, flex: 1 }}>Make a video with AI</div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ border: "none", background: "none", cursor: "pointer", color: C.slate, padding: 4 }}><X size={16} /></button>
        </div>
        <div style={{ padding: 16 }}>
          {!info ? <div style={muted}>Loading…</div> : !info.available ? (
            <div style={{ ...muted, color: C.ink }}>Video making is not set up for your account yet. Ask Outreach support to switch it on.</div>
          ) : job && job.state === "done" ? (
            <div>
              <video src={job.url} controls playsInline style={{ width: "100%", maxHeight: 360, borderRadius: 10, background: "#0f1115" }} />
              <div style={{ ...muted, marginTop: 8 }}>{postId ? "Added to this post and saved in your media library." : "Saved in your media library."}</div>
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button type="button" style={primary} onClick={onClose}>Done</button>
                <button type="button" style={btn} onClick={() => setJob(null)}>Make another</button>
              </div>
            </div>
          ) : making ? (
            <div aria-live="polite">
              <div style={{ fontWeight: 700, fontSize: 14 }}>Making your clip…</div>
              <div style={{ ...muted, marginTop: 4 }}>
                This usually takes 1 to 5 minutes. You can close this window: the clip is saved in your media library{postId ? " and added to the post" : ""} when it is ready.
              </div>
              <div style={{ height: 6, borderRadius: 99, background: HUB_PAPER, overflow: "hidden", marginTop: 12 }}>
                <div className="video-bar" style={{ height: "100%", width: "40%", borderRadius: 99, background: C.teal }} />
              </div>
              <div style={{ ...muted, fontSize: 12, marginTop: 8 }}>“{job.prompt}”</div>
              <style>{"@keyframes vbar{0%{transform:translateX(-100%)}100%{transform:translateX(250%)}} .video-bar{animation:vbar 1.6s ease-in-out infinite} @media (prefers-reduced-motion: reduce){.video-bar{animation:none;width:100%!important;opacity:.5}}"}</style>
            </div>
          ) : (
            <>
              {job && job.state === "failed" ? <div role="alert" style={{ fontSize: 12.5, color: C.red, marginBottom: 8 }}>{job.error}</div> : null}
              <label style={{ ...label, marginTop: 0 }}>What should the clip show?
                <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={1500}
                  placeholder="e.g. A barista pouring latte art in a sunny café, slow motion, close up"
                  style={{ display: "block", width: "100%", boxSizing: "border-box", minHeight: 96, marginTop: 4, borderRadius: 8, border: `1px solid ${C.border}`, padding: 8, fontFamily: FONT_BODY, fontSize: 13, resize: "vertical" }} />
              </label>
              <div style={{ ...muted, fontSize: 11.5, marginTop: 4 }}>Describe the scene, movement and mood. AI clips rarely get on-screen text right, so put words in the caption instead.</div>
              <fieldset style={{ border: "none", padding: 0, margin: "12px 0 0" }}>
                <legend style={{ fontSize: 11.5, fontWeight: 700, color: C.slate }}>Shape</legend>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, marginTop: 6 }}>
                  {SHAPES.map(([id, name, use]) => (
                    <button key={id} type="button" aria-pressed={shape === id} onClick={() => setShape(id)}
                      style={{ border: `1.5px solid ${shape === id ? C.teal : C.border}`, background: shape === id ? (C.tealSoft || "#E4F5F2") : "#fff", borderRadius: 10, padding: "8px 6px", cursor: "pointer", fontFamily: FONT_BODY, textAlign: "center" }}>
                      <div style={{ fontWeight: 700, fontSize: 12.5, color: C.ink }}>{name}</div>
                      <div style={{ fontSize: 11, color: C.slate }}>{use}</div>
                    </button>
                  ))}
                </div>
              </fieldset>
              <fieldset style={{ border: "none", padding: 0, margin: "12px 0 0" }}>
                <legend style={{ fontSize: 11.5, fontWeight: 700, color: C.slate }}>Length</legend>
                <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                  {(info.lengths || [5, 8]).map((s) => (
                    <button key={s} type="button" aria-pressed={seconds === s} onClick={() => setSeconds(s)}
                      style={{ ...btn, background: seconds === s ? C.ink : "#fff", color: seconds === s ? "#fff" : C.ink, borderColor: seconds === s ? C.ink : C.border }}>About {s} seconds</button>
                  ))}
                </div>
              </fieldset>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
                <div style={{ ...muted, flex: 1, minWidth: 180 }}>{info.credits} credits per clip, charged only if it is made.</div>
                <button type="button" style={btn} onClick={onClose}>Cancel</button>
                <button type="button" style={{ ...primary, background: C.teal, borderColor: C.teal }} disabled={busy || prompt.trim().length < 10} onClick={start}>
                  <Film size={14} /> {busy ? "Starting…" : "Make the clip"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
