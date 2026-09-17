import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  History,
  Image as ImageIcon,
  LayoutGrid,
  LogOut,
  MessageSquare,
  Pencil,
  Plus,
  Plug,
  Send,
  Settings2,
  Share2,
  Sparkles,
  Trash2,
  BookOpen,
  Globe,
  X,
} from "lucide-react";
import { AppChrome } from "../components/AppChrome";
import { api } from "../api/apiClient";
import {
  C,
  FONT_BODY,
  FONT_DISPLAY,
  HUB_PAPER,
  getActiveAiCredentials,
  resolveImageCredentials,
} from "../tokens";
import { isClassicRevertPhrase, setSchedulerEdition } from "./schedulerEdition";
import { coerceChatText, humanizeAiReply, looksLikeJunkDump } from "./chatClean";

const LS_POSTS = "aivhub_social_v2_posts";
const LS_PLAN = "aivhub_social_v2_plan";
const LS_CHAT = "aivhub_social_v2_chat";
const LS_THREADS = "aivhub_social_v2_threads";
const LS_PINS = "aivhub_social_v2_pins";
const LS_CHAT_W = "aivhub_social_v2_chat_w";

const WELCOME = {
  id: "c0",
  who: "ai",
  text: "Write the thought for the post (what it should be about). Pin the date. I draft from your company profile + that plan — not a stock angle.",
};

const CHANNELS = [
  { id: "linkedin", label: "LinkedIn", color: "#0A66C2", soft: "#E8F1FA", mark: "in" },
  { id: "x", label: "X", color: "#111827", soft: "#EFEFEF", mark: "X" },
  { id: "facebook", label: "Facebook", color: "#1877F2", soft: "#E7F0FE", mark: "f" },
  { id: "instagram", label: "Instagram", color: "#E4405F", soft: "#FDECEE", mark: "Ig" },
  { id: "threads", label: "Threads", color: "#000000", soft: "#F4F4F5", mark: "@" },
];

function companyPayload(profile) {
  if (!profile) return {};
  const bits = [profile.pitch, profile.industry, profile.website, profile.social].filter(Boolean);
  return {
    companyName: profile.name || "",
    companyPitch: profile.pitch || "",
    companyContext: bits.join("\n"),
  };
}

function MiniChat({ messages, emptyHint, hint, busyLabel, value, onChange, onSubmit, disabled, placeholder }) {
  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 10, marginBottom: 10, background: HUB_PAPER }}>
      {hint ? <div style={{ fontSize: 12, color: C.slate, marginBottom: 8 }}>{hint}</div> : null}
      <div style={{ maxHeight: 160, overflowY: "auto", marginBottom: 8 }}>
        {!(messages || []).length ? (
          <div style={{ fontSize: 12, color: C.slateLight }}>{emptyHint}</div>
        ) : (messages || []).map((m) => (
          <div key={m.id} style={{ marginBottom: 6, display: "flex", justifyContent: m.who === "user" ? "flex-end" : "flex-start" }}>
            <div style={{
              maxWidth: "90%",
              padding: "6px 9px",
              borderRadius: 8,
              background: m.who === "user" ? C.ink : "#fff",
              color: m.who === "user" ? "#fff" : C.textInk,
              fontSize: 12,
              lineHeight: 1.4,
              border: m.who === "user" ? "none" : `1px solid ${C.border}`,
            }}>
              {m.text}
            </div>
          </div>
        ))}
        {busyLabel ? <div style={{ fontSize: 12, color: C.teal }}>{busyLabel}</div> : null}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); onSubmit(); }} style={{ display: "flex", gap: 6 }}>
        <input
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          style={{ flex: 1, height: 36, borderRadius: 8, border: `1px solid ${C.border}`, padding: "0 10px", fontFamily: FONT_BODY, fontSize: 13 }}
        />
        <button type="submit" disabled={disabled || !(value || "").trim()} style={{ ...priBtn, height: 36, background: C.teal }}>
          <Send size={14} /> Apply
        </button>
      </form>
    </div>
  );
}

function groupPostsByDateChannel(list) {
  const byDate = {};
  (list || []).forEach((p) => {
    const d = p.date || "undated";
    if (!byDate[d]) byDate[d] = {};
    const ch = String(p.channel || "linkedin").toLowerCase();
    if (!byDate[d][ch]) byDate[d][ch] = [];
    byDate[d][ch].push(p);
  });
  const dates = Object.keys(byDate).sort();
  return dates.map((date) => {
    const channels = CHANNELS
      .map((c) => ({ ...c, posts: byDate[date][c.id] || [] }))
      .filter((c) => c.posts.length);
    const extras = Object.keys(byDate[date]).filter((id) => !CHANNELS.some((c) => c.id === id));
    extras.forEach((id) => {
      channels.push({ id, label: id, color: C.ink, soft: HUB_PAPER, mark: id.slice(0, 2), posts: byDate[date][id] });
    });
    const count = channels.reduce((n, c) => n + c.posts.length, 0);
    return { date, channels, count };
  });
}

function ApprovalsBoard({
  waitingList,
  doneList,
  expandedId,
  setExpandedId,
  statusColor,
  statusLabel,
  imageBusy,
  imageNote,
  setImageNote,
  sendImageChat,
  regenImage,
  applyImageToBatch,
  copyBusy,
  copyNote,
  setCopyNote,
  sendCopyChat,
  fillPackages,
  chatThisPost,
  approveOne,
  publishing,
  revertTouched,
}) {
  const waitingGroups = useMemo(() => groupPostsByDateChannel(waitingList), [waitingList]);
  const doneGroups = useMemo(() => groupPostsByDateChannel(doneList), [doneList]);
  const dimmed = !!expandedId;

  const renderPostRow = (p, isDone) => {
    const open = expandedId === p.id;
    const ch = CHANNELS.find((c) => c.id === String(p.channel || "").toLowerCase()) || { color: C.ink, soft: HUB_PAPER };
    return (
      <div
        key={p.id}
        id={"appr_" + p.id}
        style={{
          position: "relative",
          marginBottom: open ? 12 : 6,
          marginLeft: 12,
          zIndex: open ? 5 : 1,
          opacity: dimmed && !open ? 0.38 : 1,
          transform: open ? "scale(1.01)" : "scale(1)",
          transition: "opacity 0.18s ease, transform 0.18s ease",
          pointerEvents: dimmed && !open ? "none" : "auto",
        }}
      >
        {!open ? (
          <button
            type="button"
            onClick={() => setExpandedId(p.id)}
            style={{
              width: "100%",
              textAlign: "left",
              border: `1px solid ${C.border}`,
              borderRadius: 10,
              background: "#fff",
              padding: "8px 10px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 10,
              fontFamily: FONT_BODY,
            }}
          >
            <div style={{ width: 44, height: 44, borderRadius: 8, overflow: "hidden", background: ch.soft, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
              {p.imageUrl ? (
                <img src={p.imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <span style={{ fontSize: 10, color: C.slate }}>{p.enriching ? "…" : "—"}</span>
              )}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: C.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {p.headline || "Draft post"}
              </div>
              <div style={{ fontSize: 11, color: C.slate, marginTop: 2 }}>
                {p.time || "09:00"} · {statusLabel(p.status)}
              </div>
            </div>
            <span style={{ fontSize: 10, fontWeight: 700, color: statusColor(p.status), flexShrink: 0 }}>{statusLabel(p.status)}</span>
          </button>
        ) : (
          <div style={{
            background: "#fff",
            border: `2px solid ${C.teal}`,
            borderRadius: 14,
            padding: 16,
            boxShadow: "0 16px 40px rgba(18,20,28,0.18)",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 10, alignItems: "flex-start" }}>
              <div>
                <div style={{ fontSize: 12, color: C.slate }}>
                  {dayLabel(p.date)} · {p.time} · {p.channel}
                  {p.batchId && !p.uniqueForChannel ? " · shared image set" : ""}
                </div>
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, color: C.ink, marginTop: 2 }}>
                  {isDone ? (p.headline || "Post") : "Edit & approve"}
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: statusColor(p.status) }}>{statusLabel(p.status)}</span>
                <button type="button" onClick={() => setExpandedId("")} style={{ border: "none", background: "transparent", cursor: "pointer", padding: 4 }} title="Collapse">
                  <X size={16} color={C.slate} />
                </button>
              </div>
            </div>
            {isDone ? (
              <>
                {p.imageUrl ? <img src={p.imageUrl} alt="" style={{ width: "100%", borderRadius: 12, marginBottom: 8, maxHeight: 220, objectFit: "cover" }} /> : null}
                <div style={{ fontSize: 13, color: C.slate, whiteSpace: "pre-wrap" }}>{p.caption}</div>
              </>
            ) : (
              <>
                {p.imageUrl ? (
                  <img src={p.imageUrl} alt="" style={{ width: "100%", borderRadius: 12, marginBottom: 8, maxHeight: 220, objectFit: "cover" }} />
                ) : (
                  <div style={{ height: 100, borderRadius: 12, background: C.paperSoft, display: "flex", alignItems: "center", justifyContent: "center", color: C.slate, marginBottom: 8, fontSize: 13 }}>
                    {p.enriching || imageBusy === p.id ? "Generating visual…" : "No image yet"}
                  </div>
                )}
                <MiniChat
                  messages={p.imageChat}
                  hint="Image chat — same visual on every channel in this set unless you ask for a different one."
                  emptyHint="e.g. “Spreadsheet on the left monitor, no fake dashboard UI.”"
                  busyLabel={imageBusy === p.id ? "Redrawing…" : ""}
                  value={imageNote[p.id] || ""}
                  onChange={(v) => setImageNote((m) => ({ ...m, [p.id]: v }))}
                  onSubmit={() => sendImageChat(p)}
                  disabled={imageBusy === p.id}
                  placeholder="Describe the image change…"
                />
                <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
                  <button type="button" onClick={() => regenImage(p)} disabled={imageBusy === p.id} style={secBtn}>
                    <ImageIcon size={14} /> {imageBusy === p.id ? "Generating…" : (p.imageUrl ? "Regenerate image" : "Generate image")}
                  </button>
                  {p.imageUrl && p.batchId && !p.uniqueForChannel ? (
                    <button type="button" onClick={() => applyImageToBatch(p)} style={secBtn}>
                      Use this image on all channels
                    </button>
                  ) : null}
                </div>
                <label style={labelStyle}>Headline</label>
                <input
                  value={p.headline || ""}
                  onChange={(e) => revertTouched(p.id, { headline: e.target.value })}
                  style={{ width: "100%", boxSizing: "border-box", height: 36, borderRadius: 10, border: `1px solid ${C.border}`, padding: "0 10px", fontFamily: FONT_BODY, fontSize: 13, marginBottom: 10 }}
                />
                <label style={labelStyle}>Post copy</label>
                <textarea
                  value={p.caption || ""}
                  onChange={(e) => revertTouched(p.id, { caption: e.target.value })}
                  rows={5}
                  style={{ width: "100%", borderRadius: 10, border: `1px solid ${C.border}`, padding: 10, fontFamily: FONT_BODY, fontSize: 13, resize: "vertical", boxSizing: "border-box", marginBottom: 10 }}
                />
                <MiniChat
                  messages={p.copyChat}
                  hint="Post text chat — changes headline, hook, body, and hashtags. Image stays unless you use the chat above."
                  emptyHint="e.g. “Shorter headline. Softer CTA.”"
                  busyLabel={copyBusy === p.id || p.enriching ? "Rewriting…" : ""}
                  value={copyNote[p.id] || ""}
                  onChange={(v) => setCopyNote((m) => ({ ...m, [p.id]: v }))}
                  onSubmit={() => sendCopyChat(p)}
                  disabled={copyBusy === p.id || p.enriching}
                  placeholder="Change headline, hook, body, or hashtags…"
                />
                <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
                  <button type="button" onClick={() => fillPackages([p], { skipImage: true })} disabled={p.enriching} style={secBtn}>
                    <Sparkles size={14} /> Rewrite caption
                  </button>
                  <button type="button" onClick={() => chatThisPost(p)} style={secBtn}>
                    <MessageSquare size={14} /> Chat in Plan AI
                  </button>
                  <button type="button" disabled={!!publishing} onClick={() => approveOne(p)} style={priBtn}>
                    <Check size={14} /> {publishing === p.id ? "Posting…" : "Approve & post"}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderGroups = (groups, isDone) => groups.map((g) => (
    <div key={(isDone ? "d_" : "w_") + g.date} style={{ marginBottom: 18 }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "8px 10px",
        background: HUB_PAPER,
        borderRadius: 8,
        marginBottom: 8,
        border: `1px solid ${C.border}`,
      }}>
        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 14, color: C.ink }}>
          {g.date === "undated" ? "No date" : dayLabel(g.date)}
        </div>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.slate }}>
          {g.count} post{g.count === 1 ? "" : "s"} · {g.channels.length} channel{g.channels.length === 1 ? "" : "s"}
        </div>
      </div>
      {g.channels.map((ch) => (
        <div key={g.date + "_" + ch.id} style={{ marginBottom: 10 }}>
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "4px 4px 6px 4px",
            borderBottom: `1px solid ${C.border}`,
            marginBottom: 8,
          }}>
            <div style={{ width: 22, height: 22, borderRadius: 6, background: ch.soft, color: ch.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800 }}>
              {ch.mark}
            </div>
            <div style={{ fontWeight: 700, fontSize: 12.5, color: C.ink, flex: 1 }}>{ch.label}</div>
            <div style={{ fontSize: 11, color: C.slate }}>{ch.posts.length}</div>
          </div>
          {ch.posts.map((p) => renderPostRow(p, isDone))}
        </div>
      ))}
    </div>
  ));

  return (
    <div style={{
      background: "#fff",
      border: `1px solid ${C.border}`,
      borderRadius: 16,
      padding: 18,
      boxShadow: "0 2px 10px rgba(18,20,28,0.04)",
      minHeight: 280,
    }}>
      <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, color: C.ink, marginBottom: 4 }}>
        Posts by scheduled date
      </div>
      <div style={{ fontSize: 12.5, color: C.slate, marginBottom: 16, lineHeight: 1.45 }}>
        Dates nest channels; channels nest posts. Click a row to enlarge and edit. Approve lives in the enlarged card.
      </div>

      {!waitingGroups.length && !doneGroups.length ? (
        <div style={{ padding: 24, color: C.slate, fontSize: 13, border: `1px dashed ${C.border}`, borderRadius: 12 }}>
          No posts yet. Generate a draft first.
        </div>
      ) : null}

      {waitingGroups.length ? (
        <>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", color: C.slateLight, marginBottom: 8 }}>WAITING</div>
          {renderGroups(waitingGroups, false)}
        </>
      ) : doneGroups.length ? (
        <div style={{ padding: "12px 14px", borderRadius: 10, background: HUB_PAPER, color: C.slate, fontSize: 13, marginBottom: 14 }}>
          No drafts waiting.
        </div>
      ) : null}

      {doneGroups.length ? (
        <>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", color: C.slateLight, margin: "12px 0 8px" }}>
            ALREADY HANDLED
          </div>
          {renderGroups(doneGroups, true)}
        </>
      ) : null}
    </div>
  );
}

function assembleCaption(pkg, fallback) {
  if (!pkg) return fallback || "";
  const hook = stripAiSlop(pkg.hook || "");
  const body = stripAiSlop(pkg.copy || pkg.linkedin_copy || "");
  let text = body;
  if (hook && body && !body.toLowerCase().startsWith(hook.slice(0, 40).toLowerCase())) {
    text = hook + "\n\n" + body;
  } else if (!body) text = hook;
  text = String(text || "").replace(/(?:\s*#\w+)+\s*$/g, "").trim();
  const tags = Array.isArray(pkg.hashtags) ? pkg.hashtags : [];
  const tagLine = tags.map((t) => (String(t).startsWith("#") ? t : "#" + t)).slice(0, 30).join(" ");
  if (tagLine && text && !text.includes(tagLine)) text = String(text).trim() + "\n\n" + tagLine;
  return (text || fallback || "").trim();
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (_) {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (_) {}
}

function isoDate(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseIsoDate(s) {
  const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return Date.now();
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
}

function monthLabel(year, month) {
  return new Date(year, month, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

function buildMonthCells(year, month) {
  const first = new Date(year, month, 1);
  const daysIn = new Date(year, month + 1, 0).getDate();
  const pad = (first.getDay() + 6) % 7;
  const cells = [];
  for (let i = 0; i < pad; i++) cells.push(null);
  for (let d = 1; d <= daysIn; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function channelsNamedInText(text) {
  const t = String(text || "").toLowerCase();
  const hits = [];
  CHANNELS.forEach((c) => {
    if (c.id === "x") {
      if (/(^|[^a-z0-9])(x|twitter)([^a-z0-9]|$)/i.test(t)) hits.push(c.id);
      return;
    }
    if (t.includes(c.id) || t.includes(c.label.toLowerCase())) hits.push(c.id);
  });
  return hits;
}

function normPlan(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 180);
}

function sameTaskDrafts(posts, dates, channels, topic) {
  const fp = normPlan(topic);
  const dateSet = new Set(dates || []);
  const chSet = new Set(channels || []);
  return (posts || []).filter((p) => {
    if (!p || p.status === "posted") return false;
    if (dateSet.size && !dateSet.has(p.date)) return false;
    if (chSet.size && !chSet.has(p.channel)) return false;
    const other = normPlan(p.plan);
    if (!fp || !other) return false;
    if (other === fp) return true;
    const n = Math.min(fp.length, other.length);
    if (n < 40) return false;
    return fp.includes(other.slice(0, 80)) || other.includes(fp.slice(0, 80));
  });
}

function copyChatReply(before, after, src) {
  if (src && src !== "llm") {
    return "Writer did not return a new draft. Check post-writer keys, then send the note again.";
  }
  const sameCaption = String(before.caption || "").trim() === String(after.caption || "").trim();
  const sameHeadline = String(before.headline || "").trim() === String(after.headline || "").trim();
  const countTags = (s) => (String(s || "").match(/#[A-Za-z0-9_]+/g) || []).length;
  const beforeTags = countTags(before.caption);
  const afterTags = countTags(after.caption);
  if (sameCaption && sameHeadline) {
    return "Nothing changed in headline or caption. Say exactly what to change — e.g. “put 15 hashtags at the end”.";
  }
  const bits = [];
  if (!sameHeadline) bits.push("headline now: “" + String(after.headline || "").slice(0, 72) + "”");
  if (afterTags !== beforeTags) bits.push(afterTags + " hashtags");
  else if (!sameCaption) bits.push("caption rewritten");
  return bits.length ? ("Updated: " + bits.join(". ") + ".") : "Updated the post from that note.";
}

function reuseAskText(existing, dates, channels) {
  const day = [...new Set((dates || []).map(dayLabel))].join(", ");
  const ch = (channels || []).map((id) => (CHANNELS.find((c) => c.id === id) || { label: id }).label).join(", ");
  return (
    "Already have " + existing.length + " draft" + (existing.length === 1 ? "" : "s")
    + " for " + day + " on " + ch
    + ". Open Approvals to edit those, or Generate / Send again only if you want a new set."
  );
}

function wantsPerChannelDiff(text) {
  const t = String(text || "").toLowerCase();
  if (!t.trim()) return false;
  if (/(each|every|per)\s+(channel|platform|network)|adapt per channel|channel-specific|different (for )?each|unique (for )?each/.test(t)) return true;
  if (/(different|unique|separate|own)\s+(image|caption|copy|visual|version|post)/.test(t)) return true;
  if (/(linkedin|instagram|facebook|threads|\bx\b|twitter).{0,48}(different|unique|own|separate)|(different|unique|own|separate).{0,48}(linkedin|instagram|facebook|threads|\bx\b|twitter)/.test(t)) return true;
  return false;
}

function companyName(profile) {
  return (profile && (profile.name || profile.company)) || "your company";
}

function mapStatus(s) {
  if (s === "published") return "posted";
  if (s === "awaiting_approval") return "draft";
  if (s === "approved" || s === "scheduled" || s === "draft" || s === "posted") return s;
  return "draft";
}

function newPostId() {
  return "v2_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

function extractPlanFromText(text) {
  const raw = coerceChatText(text);
  const fence = raw.match(/```(?:plan|json)\s*([\s\S]*?)```/i);
  let blob = fence ? fence[1].trim() : "";
  if (!blob) {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start && /"posts"\s*:/.test(raw.slice(start, end + 1))) {
      blob = raw.slice(start, end + 1);
    }
  }
  if (!blob) return null;
  try {
    const data = JSON.parse(blob);
    if (data && Array.isArray(data.posts) && data.posts.length) return data;
  } catch (_) {}
  return null;
}

function stripAiSlop(text) {
  let t = String(text || "");
  t = t.replace(/Not because they[\s\S]*?(?:—|–|--)\s*because[^.!\n]*[.!]?/gi, "");
  t = t.replace(/The fix isn['’]t another[^.!\n]*[.!]?\s*It['’]s[^.!\n]*[.!]?/gi, "");
  t = t.replace(/Scattered data in\.\s*Real-time decisions out\.?/gi, "");
  t = t.replace(/The floor already moved\.?\s*The pack did not\.?/gi, "");
  t = t.replace(/That hour is not[^.!\n]*[.!]?\s*It is[^.!\n]*[.!]?/gi, "");
  t = t.replace(/\n{3,}/g, "\n\n").trim();
  return t;
}

function dayLabel(iso) {
  try {
    return new Date(parseIsoDate(iso)).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  } catch (_) {
    return iso;
  }
}

function cleanSavedChat(rows) {
  if (!Array.isArray(rows)) return [];
  const cleaned = rows
    .map((m) => {
      if (!m) return null;
      if (looksLikeJunkDump(m.text)) return null;
      if (m.kind === "pin") return null;
      const text = m.who === "ai" ? humanizeAiReply(coerceChatText(m.text), false) : coerceChatText(m.text);
      if (!text || looksLikeJunkDump(text)) return null;
      if (/real scene|draft onto this date|file, meeting, or system/i.test(text)) return null;
      if (m.who === "ai" && /Applied to your calendar|Post summary|Caption:\*\*|under your \d+ limit/i.test(text)) {
        return { ...m, text: "Draft is on the calendar. Open it in Review to change image or copy, then approve." };
      }
      return { ...m, text };
    })
    .filter(Boolean);
  return cleaned.length ? cleaned : null;
}

class SimpleBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { err: null };
  }
  static getDerivedStateFromError(err) {
    return { err };
  }
  componentDidCatch(err) {
    console.warn("SocialWorkspace crashed:", err);
  }
  render() {
    if (this.state.err) {
      return (
        <div style={{ padding: 32, fontFamily: FONT_BODY, color: C.ink }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 20, marginBottom: 8 }}>Simple workspace hit an error</div>
          <div style={{ color: C.slate, marginBottom: 16 }}>{String(this.state.err.message || this.state.err)}</div>
          <button
            type="button"
            onClick={this.props.onRevert}
            style={{ height: 40, padding: "0 16px", border: "none", borderRadius: 10, background: C.ink, color: "#fff", fontWeight: 600, cursor: "pointer" }}
          >
            Use classic scheduler
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function defaultPublicApiUrl() {
  try {
    const o = window.location.origin || "";
    if (o && !o.includes("localhost") && !o.includes("127.0.0.1")) return o.replace(/\/$/, "");
  } catch (_) {}
  return "";
}

function SimpleCompanyKnowledge({ profile, setProfile, knowledgeSources, setKnowledgeSources, showToast }) {
  const [draft, setDraft] = useState({
    name: (profile && profile.name) || "",
    pitch: (profile && profile.pitch) || "",
    industry: (profile && profile.industry) || "",
    website: (profile && profile.website) || "",
    social: (profile && profile.social) || "",
    tone: (profile && profile.tone) || "",
  });
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newSrc, setNewSrc] = useState({ name: "", value: "" });
  const sources = Array.isArray(knowledgeSources) ? knowledgeSources : [];

  useEffect(() => {
    setDraft({
      name: (profile && profile.name) || "",
      pitch: (profile && profile.pitch) || "",
      industry: (profile && profile.industry) || "",
      website: (profile && profile.website) || "",
      social: (profile && profile.social) || "",
      tone: (profile && profile.tone) || "",
    });
  }, [profile]);

  useEffect(() => {
    api.getSources()
      .then((s) => { if (Array.isArray(s) && setKnowledgeSources) setKnowledgeSources(s); })
      .catch(() => {});
  }, [setKnowledgeSources]);

  const setField = (k, v) => setDraft((d) => ({ ...d, [k]: v }));

  const saveProfile = async () => {
    const next = { ...(profile || {}), ...draft };
    if (setProfile) setProfile(next);
    try { localStorage.setItem("aivhub_company_profile", JSON.stringify(next)); } catch (_) {}
    setSaving(true);
    try {
      await api.updateProfile(next);
      showToast("Company knowledge saved. Posts use this profile.");
    } catch (e) {
      showToast(e.message || "Saved locally only.");
    } finally {
      setSaving(false);
    }
  };

  const addSource = async () => {
    if (!newSrc.name.trim() || !newSrc.value.trim()) {
      showToast("Source title and URL/notes required.");
      return;
    }
    const item = { id: "k_" + Date.now(), name: newSrc.name.trim(), type: "Website URL", value: newSrc.value.trim(), status: "crawling", synced: "just now", chunkCount: 0 };
    if (setKnowledgeSources) {
      setKnowledgeSources((xs) => {
        const next = [item, ...(xs || [])];
        try { localStorage.setItem("aivhub_sources", JSON.stringify(next)); } catch (_) {}
        return next;
      });
    }
    setNewSrc({ name: "", value: "" });
    setAdding(false);
    try {
      await api.addSource(item);
      showToast("Indexing “" + item.name + "”.");
      window.setTimeout(async () => {
        try {
          const fresh = await api.getSources();
          if (Array.isArray(fresh) && setKnowledgeSources) setKnowledgeSources(fresh);
        } catch (_) {}
      }, 3500);
    } catch (e) {
      showToast(e.message || "Could not add source.");
    }
  };

  const removeSource = async (id) => {
    if (setKnowledgeSources) {
      setKnowledgeSources((xs) => {
        const next = (xs || []).filter((s) => s.id !== id);
        try { localStorage.setItem("aivhub_sources", JSON.stringify(next)); } catch (_) {}
        return next;
      });
    }
    try { await api.deleteSource(id); } catch (_) {}
  };

  const field = (label, key, extra) => (
    <div style={{ marginBottom: extra && extra.textarea ? 12 : 10 }}>
      <label style={labelStyle}>{label}</label>
      {extra && extra.textarea ? (
        <textarea
          value={draft[key] || ""}
          onChange={(e) => setField(key, e.target.value)}
          rows={3}
          placeholder={extra.placeholder || ""}
          style={{ width: "100%", boxSizing: "border-box", padding: 10, borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13, fontFamily: FONT_BODY, resize: "vertical" }}
        />
      ) : (
        <input
          value={draft[key] || ""}
          onChange={(e) => setField(key, e.target.value)}
          placeholder={(extra && extra.placeholder) || ""}
          style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13, fontFamily: FONT_BODY }}
        />
      )}
    </div>
  );

  return (
    <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 16, padding: 20, marginBottom: 22 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <BookOpen size={16} color={C.teal} />
        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16 }}>Company knowledge</div>
      </div>
      <div style={{ fontSize: 12.5, color: C.slate, lineHeight: 1.45, marginBottom: 14 }}>
        Same identity and RAG sources as Voice. Plan AI writes from this, not a stock angle.
      </div>
      {field("Company name", "name", { placeholder: "AIVHub" })}
      {field("Pitch", "pitch", { textarea: true, placeholder: "What you actually sell, in one short paragraph." })}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {field("Industry", "industry", { placeholder: "Business intelligence" })}
        {field("Website", "website", { placeholder: "https://aivhub.com" })}
      </div>
      {field("LinkedIn / social", "social", { placeholder: "linkedin.com/company/…" })}
      {field("Tone", "tone", { placeholder: "Professional, concise, no slogans" })}
      <button type="button" onClick={saveProfile} disabled={saving} style={{ ...priBtn, background: C.teal, height: 38, marginBottom: 18 }}>
        {saving ? "Saving…" : "Save company knowledge"}
      </button>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>Knowledge sources ({sources.length})</div>
        {!adding ? (
          <button type="button" onClick={() => setAdding(true)} style={{ ...secBtn, height: 32 }}>
            <Plus size={13} /> Add source
          </button>
        ) : null}
      </div>
      {adding ? (
        <div style={{ background: HUB_PAPER, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, marginBottom: 10 }}>
          <input
            value={newSrc.name}
            onChange={(e) => setNewSrc((s) => ({ ...s, name: e.target.value }))}
            placeholder="Source title"
            style={{ width: "100%", boxSizing: "border-box", marginBottom: 8, padding: "8px 10px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13, fontFamily: FONT_BODY }}
          />
          <input
            value={newSrc.value}
            onChange={(e) => setNewSrc((s) => ({ ...s, value: e.target.value }))}
            placeholder="https://… or notes to index"
            style={{ width: "100%", boxSizing: "border-box", marginBottom: 8, padding: "8px 10px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13, fontFamily: FONT_BODY }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={addSource} style={{ ...priBtn, height: 32, background: C.teal }}>Index</button>
            <button type="button" onClick={() => setAdding(false)} style={{ ...secBtn, height: 32 }}>Cancel</button>
          </div>
        </div>
      ) : null}
      {sources.length ? sources.map((s) => (
        <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderTop: `1px solid ${C.border}` }}>
          <Globe size={14} color={C.teal} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{s.name}</div>
            <div style={{ fontSize: 12, color: C.slate, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.value || s.type}</div>
          </div>
          <button type="button" onClick={() => removeSource(s.id)} style={{ ...secBtn, height: 30, width: 30, padding: 0, justifyContent: "center" }} title="Remove">
            <Trash2 size={13} />
          </button>
        </div>
      )) : (
        <div style={{ fontSize: 12.5, color: C.slate }}>No sources yet. Add the company site so posts ground in real pages.</div>
      )}
    </div>
  );
}

function SimpleAccountsPage({
  accounts,
  connecting,
  onConnect,
  onDisconnect,
  showToast,
  aiKeysPanel,
  profile,
  setProfile,
  knowledgeSources,
  setKnowledgeSources,
}) {
  const [oauthApps, setOauthApps] = useState([]);
  const [setupPlat, setSetupPlat] = useState("linkedin");
  const [setupForm, setSetupForm] = useState({ clientId: "", clientSecret: "", configId: "" });
  const [publicBaseUrl, setPublicBaseUrl] = useState(defaultPublicApiUrl);
  const [savingApp, setSavingApp] = useState(false);

  const loadApps = useCallback(() => {
    api.getSocialOauthApps()
      .then((data) => setOauthApps(data.apps || []))
      .catch(() => {});
  }, []);

  useEffect(() => { loadApps(); }, [loadApps]);

  const appFor = (plat) => oauthApps.find((a) => a.platform === plat) || {};
  const chFor = (id) => CHANNELS.find((c) => c.id === id) || { id, label: id, color: C.ink, soft: HUB_PAPER, mark: id.slice(0, 2) };

  const resolvedPublicBase = () => {
    const typed = (publicBaseUrl || "").trim().replace(/\/$/, "");
    if (typed) return typed;
    const savedCb = appFor(setupPlat).callbackUrl || "";
    const saved = String(savedCb).replace(/\/api\/scheduler\/oauth\/[^/]+\/callback.*$/, "");
    if (saved && !saved.includes("127.0.0.1") && !saved.includes("localhost")) return saved;
    try {
      const o = (window.location.origin || "").replace(/\/$/, "");
      if (o && !o.includes("localhost") && !o.includes("127.0.0.1")) return o;
    } catch (_) {}
    return "http://127.0.0.1:8000";
  };

  const callbackFor = (plat) => `${resolvedPublicBase()}/api/scheduler/oauth/${plat}/callback`;
  const setupApp = appFor(setupPlat);
  const setupLabel = chFor(setupPlat).label;

  const saveApp = async () => {
    if (!setupForm.clientId.trim() || !setupForm.clientSecret.trim()) {
      showToast("Client ID and Client Secret required.");
      return;
    }
    const base = resolvedPublicBase();
    if (!/^https?:\/\//i.test(base)) {
      showToast("Public API URL must start with https:// or http://");
      return;
    }
    setSavingApp(true);
    try {
      await api.saveSocialOauthApp({
        platform: setupPlat,
        clientId: setupForm.clientId.trim(),
        clientSecret: setupForm.clientSecret.trim(),
        configId: setupForm.configId.trim(),
        redirectUri: `${base}/api/scheduler/oauth/${setupPlat}/callback`,
      });
      setSetupForm({ clientId: "", clientSecret: "", configId: "" });
      setPublicBaseUrl(base);
      loadApps();
      showToast(setupLabel + " app saved. Register the callback URL, then Connect.");
    } catch (e) {
      showToast(e.message || "Could not save app");
    } finally {
      setSavingApp(false);
    }
  };

  const displayName = (a) => {
    const h = String((a && a.handle) || "").trim();
    const lab = String((a && a.label) || "").replace(/^(LinkedIn|X|Facebook|Instagram|Threads)\s*[·•-]\s*/i, "").trim();
    return h || lab;
  };

  const accountsFor = (id) => (accounts || []).filter((a) => String(a.platform || "").toLowerCase() === id);
  const statusLabel = (a) => {
    if (!a) return "";
    if (a.status === "connected") return "Live";
    if (a.status === "expired") return "Needs reconnect";
    if (a.status === "error") return a.lastError ? "Error" : "Needs reconnect";
    return a.status || "Saved";
  };

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "22px 28px 48px", background: HUB_PAPER }}>
      <div style={{ maxWidth: 980, margin: "0 auto" }}>
        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 22, color: C.ink, marginBottom: 4 }}>Accounts & AI</div>
        <div style={{ fontSize: 13, color: C.slate, marginBottom: 20, lineHeight: 1.45 }}>
          Connect posting accounts here. Admin pastes Client ID + Secret once per network, then anyone clicks Connect and logs in. Account names update from the network on each login.
        </div>

        <SimpleCompanyKnowledge
          profile={profile}
          setProfile={setProfile}
          knowledgeSources={knowledgeSources}
          setKnowledgeSources={setKnowledgeSources}
          showToast={showToast}
        />

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12, marginBottom: 22 }}>
          {CHANNELS.map((ch) => {
            const app = appFor(ch.id);
            const rows = accountsFor(ch.id);
            const liveCount = rows.filter((a) => a.status === "connected").length;
            const hasAny = rows.length > 0;
            return (
              <div key={ch.id} style={{ background: "#fff", border: `1px solid ${liveCount ? C.teal : hasAny ? "#F59E0B" : C.border}`, borderRadius: 14, padding: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: hasAny ? 12 : 10 }}>
                  <div style={{ width: 34, height: 34, borderRadius: 9, background: ch.soft, color: ch.color, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 12 }}>
                    {ch.mark}
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{ch.label}</div>
                    <div style={{ fontSize: 11, color: liveCount ? C.teal : hasAny ? "#B45309" : C.slate }}>
                      {liveCount
                        ? liveCount + " connected"
                        : hasAny
                          ? "Needs reconnect"
                          : app.configured ? "Ready to connect" : "App not set up"}
                    </div>
                  </div>
                </div>
                {hasAny ? (
                  <>
                    {rows.map((acc) => {
                      const live = acc.status === "connected";
                      return (
                        <div key={acc.id} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12.5, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {displayName(acc) || ch.label}
                            </div>
                            <div style={{ fontSize: 10.5, color: live ? C.teal : "#B45309" }}>{statusLabel(acc)}</div>
                          </div>
                          {!live ? (
                            <button
                              type="button"
                              onClick={() => onConnect(ch.id)}
                              disabled={connecting === ch.id}
                              style={{ ...priBtn, height: 30, padding: "0 10px", fontSize: 11, background: ch.color }}
                            >
                              {connecting === ch.id ? "…" : "Reconnect"}
                            </button>
                          ) : null}
                          <button type="button" onClick={() => onDisconnect(acc.id)} style={{ ...secBtn, height: 30, padding: "0 10px", fontSize: 11 }}>
                            Disconnect
                          </button>
                        </div>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => onConnect(ch.id)}
                      disabled={connecting === ch.id}
                      style={{ ...priBtn, width: "100%", justifyContent: "center", background: ch.color }}
                    >
                      {connecting === ch.id ? "Opening…" : "Add account"}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => onConnect(ch.id)}
                    disabled={connecting === ch.id}
                    style={{ ...priBtn, width: "100%", justifyContent: "center", background: ch.color }}
                  >
                    {connecting === ch.id ? "Opening…" : "Connect " + ch.label}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 16, padding: 20, marginBottom: 22 }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, marginBottom: 6 }}>OAuth app (admin, once)</div>
          <div style={{ fontSize: 12.5, color: C.slate, lineHeight: 1.45, marginBottom: 14 }}>
            Paste Client ID + Secret from the platform developer portal. Operators then only click Connect.
          </div>
          <label style={labelStyle}>Public API URL (no path)</label>
          <input
            value={publicBaseUrl}
            onChange={(e) => setPublicBaseUrl(e.target.value)}
            placeholder="https://app.aivhub.com"
            style={{ width: "100%", boxSizing: "border-box", marginBottom: 12, padding: "8px 10px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13, fontFamily: FONT_BODY }}
          />
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
            {CHANNELS.map((ch) => (
              <button
                key={ch.id}
                type="button"
                onClick={() => setSetupPlat(ch.id)}
                style={{ padding: "6px 10px", borderRadius: 8, border: "none", background: setupPlat === ch.id ? C.ink : HUB_PAPER, color: setupPlat === ch.id ? "#fff" : C.ink, fontSize: 12, fontWeight: 700, cursor: "pointer" }}
              >
                {ch.label}{appFor(ch.id).configured ? " ✓" : ""}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 12, color: C.slate, marginBottom: 8 }}>
            Callback URL to register on {setupLabel}:
            {(setupPlat === "facebook" || setupPlat === "instagram" ? ["facebook", "instagram"] : [setupPlat]).map((p) => (
              <code key={p} style={{ display: "block", marginTop: 4, padding: "8px 10px", background: HUB_PAPER, borderRadius: 8, color: C.ink, wordBreak: "break-all" }}>
                {callbackFor(p)}
              </code>
            ))}
          </div>
          {(setupPlat === "facebook" || setupPlat === "instagram") ? (
            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>Facebook Login for Business — Configuration ID</label>
              <input
                value={setupForm.configId}
                onChange={(e) => setSetupForm((f) => ({ ...f, configId: e.target.value }))}
                placeholder={setupApp.hasConfigId ? "saved — paste to replace" : "From Facebook Login for Business → Configurations"}
                style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13, fontFamily: FONT_BODY }}
              />
              <div style={{ fontSize: 12, color: C.slate, marginTop: 8, lineHeight: 1.45 }}>
                If Facebook shows “Login is currently unavailable for this app”: turn on Facebook Login for Business, paste the matching Configuration ID, add this callback URL, and add your Facebook user as Admin/Tester while the app is in Development. That wrench popup is Meta, not AIVHub logout. Saved pages below stay until you Reconnect or Remove.
              </div>
            </div>
          ) : null}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8, alignItems: "end" }}>
            <div>
              <label style={labelStyle}>Client ID</label>
              <input
                value={setupForm.clientId}
                onChange={(e) => setSetupForm((f) => ({ ...f, clientId: e.target.value }))}
                placeholder={setupApp.clientIdHint || "client id"}
                style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13, fontFamily: FONT_BODY }}
              />
            </div>
            <div>
              <label style={labelStyle}>Client secret</label>
              <input
                type="password"
                value={setupForm.clientSecret}
                onChange={(e) => setSetupForm((f) => ({ ...f, clientSecret: e.target.value }))}
                placeholder={setupApp.hasSecret ? "•••• saved" : "secret"}
                style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13, fontFamily: FONT_BODY }}
              />
            </div>
            <button type="button" onClick={saveApp} disabled={savingApp} style={{ ...priBtn, height: 38, background: C.teal, whiteSpace: "nowrap" }}>
              {savingApp ? "Saving…" : "Save app"}
            </button>
          </div>
        </div>

        {aiKeysPanel ? (
          <div style={{ marginTop: 8 }}>
            {aiKeysPanel}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function looksLikeSlopPost(p) {
  const t = `${(p && p.headline) || ""} ${(p && p.caption) || ""}`;
  return /ERP dump|NetSuite export tab|Ops teams still close the week in spreadsheets|Friday close still lives|Scattered data in/i.test(t);
}

export function SocialWorkspace({
  operator,
  onBackToHub,
  onLogout,
  profile,
  setProfile,
  knowledgeSources,
  setKnowledgeSources,
  commonAi,
  onOpenCommonAi,
  onUseClassic,
  aiKeysPanel,
}) {
  const [posts, setPosts] = useState(() => {
    const saved = readJson(LS_POSTS, []);
    if (!Array.isArray(saved)) return [];
    return saved.filter((p) => p && (p.status === "posted" || !looksLikeSlopPost(p)));
  });
  const [plan, setPlan] = useState(() => readJson(LS_PLAN, { rangeLabel: "", channels: ["linkedin"] }));
  const [chat, setChat] = useState(() => {
    const saved = cleanSavedChat(readJson(LS_CHAT, null));
    if (Array.isArray(saved) && saved.length) return saved;
    return [WELCOME];
  });
  const [threads, setThreads] = useState(() => {
    const saved = readJson(LS_THREADS, []);
    return Array.isArray(saved) ? saved : [];
  });
  const [histOpen, setHistOpen] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [editText, setEditText] = useState("");
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [expandedApprovalId, setExpandedApprovalId] = useState("");
  const [pinnedDates, setPinnedDates] = useState(() => {
    const saved = readJson(LS_PINS, []);
    return Array.isArray(saved) ? saved.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)) : [];
  });
  const [draft, setDraft] = useState("");
  const [topicDraft, setTopicDraft] = useState("");
  const [dateDraft, setDateDraft] = useState(isoDate(Date.now()));
  const [channelDrafts, setChannelDrafts] = useState(["linkedin"]);
  const [typing, setTyping] = useState(false);
  const [toast, setToast] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [page, setPage] = useState("plan");
  const [accounts, setAccounts] = useState([]);
  const [connecting, setConnecting] = useState("");
  const [publishing, setPublishing] = useState("");
  const now = new Date();
  const [cal, setCal] = useState({ year: now.getFullYear(), month: now.getMonth() });
  const chatEnd = useRef(null);
  const inputRef = useRef(null);
  const datePickRef = useRef(null);
  const enriching = useRef(new Set());
  const repeatGenerate = useRef("");
  const chatDrag = useRef(null);
  const [chatW, setChatW] = useState(() => {
    const n = Number(readJson(LS_CHAT_W, 380));
    return Number.isFinite(n) ? Math.min(720, Math.max(280, n)) : 380;
  });
  const [focusDate, setFocusDate] = useState("");
  const [focusPostId, setFocusPostId] = useState("");
  const [imageBusy, setImageBusy] = useState("");
  const [imageNote, setImageNote] = useState({});
  const [copyBusy, setCopyBusy] = useState("");
  const [copyNote, setCopyNote] = useState({});
  const [hoverMsg, setHoverMsg] = useState("");

  const showToast = (msg) => {
    setToast(msg);
    window.setTimeout(() => setToast(""), 3200);
  };

  const startChatResize = (e) => {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    chatDrag.current = { startX: e.clientX, startW: chatW };
    const move = (ev) => {
      if (!chatDrag.current) return;
      const max = Math.max(320, (window.innerWidth || 1200) - 280);
      const next = chatDrag.current.startW + (chatDrag.current.startX - ev.clientX);
      setChatW(Math.min(720, Math.min(max, Math.max(280, next))));
    };
    const up = () => {
      chatDrag.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  useEffect(() => { writeJson(LS_POSTS, posts); }, [posts]);
  useEffect(() => { writeJson(LS_PLAN, plan); }, [plan]);
  useEffect(() => { writeJson(LS_CHAT, chat); }, [chat]);
  useEffect(() => { writeJson(LS_THREADS, threads); }, [threads]);
  useEffect(() => { writeJson(LS_PINS, pinnedDates); }, [pinnedDates]);
  useEffect(() => { writeJson(LS_CHAT_W, chatW); }, [chatW]);
  useEffect(() => {
    setChat((cs) => {
      const next = cleanSavedChat(cs);
      if (Array.isArray(next) && next.length) return next;
      return [WELCOME];
    });
  }, []);
  useEffect(() => {
    if (chatEnd.current) chatEnd.current.scrollIntoView({ behavior: "smooth" });
  }, [chat, typing]);

  const refreshAccounts = useCallback((syncNames = false) => {
    api.getSocialAccounts(syncNames)
      .then((data) => { if (Array.isArray(data)) setAccounts(data); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshAccounts(true);
    const onMsg = (e) => {
      const d = e && e.data;
      if (!d || d.type !== "aivhub-social-oauth") return;
      refreshAccounts(true);
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [refreshAccounts]);

  useEffect(() => {
    api.getPosts()
      .then((data) => {
        if (!Array.isArray(data)) return;
        const v2 = data.filter((p) => String(p.id || "").startsWith("v2_"));
        if (!v2.length) return;
        setPosts((prev) => {
          const byId = {};
          prev.forEach((p) => { byId[p.id] = p; });
          v2.forEach((p) => {
            byId[p.id] = {
              ...byId[p.id],
              id: p.id,
              date: p.date || (p.dateMs ? isoDate(p.dateMs) : isoDate(p.slotDateMs || Date.now())),
              time: p.time || "09:00",
              channel: (p.channels && p.channels[0]) || "linkedin",
              channels: p.channels || ["linkedin"],
              headline: p.topicHeadline || p.title || p.headline || "Post",
              caption: p.copy || p.linkedinCopy || p.caption || "",
              imageUrl: p.imageUrl || "",
              imagePrompt: p.imagePrompt || "",
              status: mapStatus(p.status),
            };
          });
          return Object.values(byId);
        });
      })
      .catch(() => {});
  }, []);

  const connected = useMemo(
    () => (accounts || []).filter((a) => a.status === "connected"),
    [accounts]
  );

  const selected = posts.find((p) => p.id === selectedId) || null;
  const drafts = posts.filter((p) => p.status === "draft" || !p.status);
  const approved = posts.filter((p) => p.status === "approved");
  const readyToSend = posts.filter((p) => p.status === "approved" || p.status === "scheduled");
  const planReady = posts.length > 0 && drafts.length === 0 && approved.length > 0;
  const channelsNeeded = [...new Set(posts.map((p) => p.channel).filter(Boolean))];
  const missingAccounts = channelsNeeded.filter(
    (ch) => !connected.some((a) => String(a.platform || "").toLowerCase() === ch)
  );

  const cells = useMemo(() => buildMonthCells(cal.year, cal.month), [cal.year, cal.month]);
  const postsByDay = useMemo(() => {
    const map = {};
    posts.forEach((p) => {
      const k = p.date;
      if (!k) return;
      if (!map[k]) map[k] = [];
      map[k].push(p);
    });
    return map;
  }, [posts]);

  const persistPost = (np) => {
    return api.createPost({
      id: np.id,
      title: np.headline,
      copy: np.caption,
      channels: np.channels || [np.channel],
      status: np.status === "draft" ? "awaiting_approval" : np.status === "posted" ? "published" : np.status === "scheduled" ? "scheduled" : np.status,
      slotDateMs: parseIsoDate(np.date),
      time: np.time,
      theme: np.headline,
      imageUrl: np.imageUrl,
      imagePrompt: np.imagePrompt,
    }).catch(() => null);
  };

  const syncBatchImage = (batchId, imageUrl, imagePrompt, exceptId) => {
    if (!batchId || !imageUrl) return;
    setPosts((ps) => ps.map((row) => {
      if (row.id === exceptId) return row;
      if (row.batchId !== batchId || row.uniqueForChannel || row.status === "posted") return row;
      if (row.imageUrl === imageUrl) return row;
      const shared = { ...row, imageUrl, imagePrompt: imagePrompt || row.imagePrompt };
      persistPost(shared);
      return shared;
    }));
  };

  const applyPlan = (incoming, replaceAll, share = true) => {
    if (!incoming || !Array.isArray(incoming.posts) || !incoming.posts.length) return [];
    const pinFallback = pinnedDates[pinnedDates.length - 1] || dateDraft || isoDate(Date.now());
    const stamp = "b_" + Date.now();
    const nextPosts = incoming.posts.map((raw) => {
      const channel = String(raw.channel || (incoming.channels && incoming.channels[0]) || (channelDrafts[0]) || "linkedin").toLowerCase();
      return {
        id: raw.id && String(raw.id).startsWith("v2_") ? raw.id : newPostId(),
        date: raw.date || pinFallback,
        time: raw.time || "09:00",
        channel,
        channels: raw.channels || [channel],
        headline: raw.headline || raw.title || "Draft post",
        plan: raw.plan || raw.headline || raw.caption || "",
        caption: stripAiSlop(raw.caption || raw.captionDraft || raw.copy || ""),
        imagePrompt: raw.imagePrompt || raw.image_prompt || raw.headline || "",
        imageUrl: raw.imageUrl || "",
        batchId: raw.batchId || incoming.batchId || stamp,
        uniqueForChannel: !share,
        status: "draft",
        enriching: false,
      };
    });
    setPosts((prev) => {
      const fullSwap = replaceAll && !pinnedDates.length && nextPosts.length >= 3;
      if (fullSwap) return nextPosts;
      const byId = {};
      prev.forEach((p) => { byId[p.id] = p; });
      nextPosts.forEach((np) => {
        const ex = byId[np.id];
        if (ex && ex.status === "posted") {
          byId[np.id] = ex;
          return;
        }
        byId[np.id] = ex ? {
          ...ex,
          ...np,
          caption: np.caption || ex.caption,
          imageUrl: np.imageUrl || ex.imageUrl,
          status: "draft",
        } : np;
      });
      return Object.values(byId);
    });
    setPlan({
      rangeLabel: incoming.rangeLabel || incoming.label || monthLabel(cal.year, cal.month),
      channels: incoming.channels || [...new Set(nextPosts.map((p) => p.channel))],
    });
    if (nextPosts[0] && nextPosts[0].date) {
      const d = new Date(parseIsoDate(nextPosts[0].date));
      setCal({ year: d.getFullYear(), month: d.getMonth() });
      setDateDraft(nextPosts[0].date);
    }
    nextPosts.forEach(persistPost);
    const toFill = nextPosts.filter((p) => !p.imageUrl || (p.caption || "").trim().length < 60);
    fillPackages(toFill, { share });
    if (nextPosts[0]) {
      setSelectedId(nextPosts[0].id);
      setApprovalOpen(true);
    }
    return nextPosts;
  };

  const fillPackages = (items, opts = {}) => {
    const skipImage = !!opts.skipImage;
    const revisionNote = String(opts.revisionNote || "").trim();
    const shareOpt = opts.share !== false;
    const creds = getActiveAiCredentials(commonAi, "scheduler", "postWriter");
    const img = resolveImageCredentials(commonAi);
    const seeds = (items || []).map((item) => (typeof item === "string" ? { id: item } : item)).filter((p) => p && p.id);
    if (!seeds.length) return;
    const groups = [];
    const used = new Set();
    seeds.forEach((p) => {
      if (used.has(p.id)) return;
      const mates = p.batchId && !p.uniqueForChannel
        ? seeds.filter((q) => q.batchId && q.batchId === p.batchId && !q.uniqueForChannel)
        : [p];
      mates.forEach((m) => used.add(m.id));
      groups.push(mates);
    });
    groups.forEach((group, gIdx) => {
      const lead = group[0];
      const ids = group.map((g) => g.id);
      if (ids.some((id) => enriching.current.has(id))) return;
      ids.forEach((id) => enriching.current.add(id));
      setPosts((ps) => ps.map((p) => (ids.includes(p.id) ? { ...p, enriching: true } : p)));
      window.setTimeout(async () => {
        let p = lead.id && !lead.plan ? null : lead;
        if (!p || !p.plan) {
          try { p = JSON.parse(localStorage.getItem(LS_POSTS) || "[]").find((row) => row.id === lead.id) || lead; } catch (_) { p = lead; }
        }
        if (!p) {
          ids.forEach((id) => enriching.current.delete(id));
          setPosts((ps) => ps.map((row) => (ids.includes(row.id) ? { ...row, enriching: false } : row)));
          return;
        }
        try {
          const res = await api.generateSocialPackage({
            topic: p.plan || p.headline,
            existingCopy: [p.headline, p.caption].filter(Boolean).join("\n\n"),
            existingHeadline: p.headline || "",
            revisionNote,
            skipImage,
            linkedinDirective: (commonAi && commonAi.channelDirectives && commonAi.channelDirectives.linkedin) || "",
            style: img.imageStyle || "modern_saas",
            aspect_ratio: "4:5",
            adaptPerChannel: false,
            apiKey: creds.apiKey,
            provider: creds.provider,
            model: creds.model,
            baseUrl: creds.baseUrl,
            image_provider: img.imageProvider,
            imageApiKey: img.imageApiKey,
            image_model: img.imageModel,
            image_base_url: img.imageBaseUrl,
            ...companyPayload(profile),
          });
          const pkg = res && res.package;
          const share = shareOpt && !p.uniqueForChannel;
          const src = pkg ? pkg.generationSource : (revisionNote ? "missing" : "");
          const sharedImageUrl = skipImage ? null : ((pkg && pkg.imageUrl) || null);
          const sharedImagePrompt = skipImage ? null : ((pkg && (pkg.imagePrompt || pkg.image_prompt)) || null);
          setPosts((rows) => {
            const nextRows = rows.map((row) => {
              const hit = ids.includes(row.id) || (share && p.batchId && row.batchId === p.batchId && !row.uniqueForChannel && row.status !== "posted");
              if (!hit) return row;
              const usePkg = !revisionNote || src === "llm";
              const assembled = usePkg ? assembleCaption(pkg, row.caption) : "";
              const caption = (usePkg && assembled) ? assembled : (row.caption || "");
              const nextHeadline = (usePkg && pkg && (pkg.postTitle || pkg.hook)) ? (pkg.postTitle || pkg.hook) : row.headline;
              const next = {
                ...row,
                enriching: false,
                caption,
                headline: nextHeadline,
                hook: (usePkg && pkg && pkg.hook) || row.hook,
                hashtags: (usePkg && pkg && pkg.hashtags) || row.hashtags,
                imageConcept: (pkg && (pkg.imageConcept || pkg.image_concept)) || row.imageConcept,
                imageHeadline: (pkg && (pkg.imageHeadline || pkg.image_headline)) || row.imageHeadline,
                imageUrl: skipImage ? row.imageUrl : (sharedImageUrl || row.imageUrl),
                imagePrompt: skipImage ? row.imagePrompt : (sharedImagePrompt || row.imagePrompt),
                copyChat: revisionNote
                  ? [...(row.copyChat || []), { id: "cpa_" + Date.now() + "_" + row.id, who: "ai", text: copyChatReply(row, { caption, headline: nextHeadline }, src) }]
                  : (row.copyChat || []),
              };
              persistPost(next);
              return next;
            });
            return nextRows;
          });
          if (share && p.batchId && sharedImageUrl) {
            window.setTimeout(() => syncBatchImage(p.batchId, sharedImageUrl, sharedImagePrompt), 0);
          }
        } catch (e) {
          setPosts((rows) => rows.map((row) => {
            if (!ids.includes(row.id)) return row;
            const fail = {
              ...row,
              enriching: false,
              copyChat: revisionNote
                ? [...(row.copyChat || []), { id: "cpx_" + Date.now() + "_" + row.id, who: "ai", text: "Could not update caption: " + (e.message || "writer failed") }]
                : (row.copyChat || []),
            };
            persistPost(fail);
            return fail;
          }));
        } finally {
          ids.forEach((id) => enriching.current.delete(id));
          setCopyBusy((cur) => (ids.includes(cur) ? "" : cur));
        }
      }, 80 * gIdx);
    });
  };

  const unpinDate = (key, e) => {
    if (e) {
      if (e.preventDefault) e.preventDefault();
      if (e.stopPropagation) e.stopPropagation();
    }
    if (!key) return;
    setFocusPostId("");
    setPinnedDates((prev) => {
      if (!prev.includes(key)) return prev;
      const next = prev.filter((d) => d !== key);
      setDateDraft(next[next.length - 1] || isoDate(Date.now()));
      setFocusDate((fd) => (fd === key ? (next[next.length - 1] || "") : fd));
      showToast("Unpinned " + dayLabel(key));
      return next;
    });
  };

  const pinDay = (key) => {
    if (!key) return;
    setFocusPostId("");
    setPinnedDates((prev) => {
      if (prev.includes(key)) {
        const next = prev.filter((d) => d !== key);
        setDateDraft(next[next.length - 1] || isoDate(Date.now()));
        setFocusDate((fd) => (fd === key ? (next[next.length - 1] || "") : fd));
        showToast("Unpinned " + dayLabel(key));
        return next;
      }
      setDateDraft(key);
      const d = new Date(parseIsoDate(key));
      setCal({ year: d.getFullYear(), month: d.getMonth() });
      showToast("Pinned " + dayLabel(key) + ". Write the post plan, then Generate.");
      return [...prev, key];
    });
    setChat((cs) => (cs || []).filter((m) => m && m.kind !== "pin" && !looksLikeJunkDump(m.text)));
  };

  const unpinDay = (key, e) => unpinDate(key, e);

  const chatThisPost = (p) => {
    if (!p) return;
    setFocusPostId(p.id);
    setApprovalOpen(false);
    setChat((cs) => [...cs, {
      id: "focus_" + p.id + "_" + Date.now(),
      who: "ai",
      text: "Editing " + dayLabel(p.date) + " · " + p.channel + ". Say what to change in the caption, or describe a new image.",
    }]);
    window.setTimeout(() => { if (inputRef.current) inputRef.current.focus(); }, 40);
  };

  const regenImage = async (p, note) => {
    if (!p || imageBusy) return;
    setImageBusy(p.id);
    const img = resolveImageCredentials(commonAi);
    const change = String(note || "").trim();
    const prompt = [
      (p.imagePrompt || p.caption || p.headline || "").trim(),
      change ? ("Change requested: " + change + ". Keep the same people and place. No fake UI text, no invented logos.") : "",
    ].filter(Boolean).join(" ");
    try {
      const res = await api.generateImage({
        prompt,
        title: p.headline,
        theme: p.headline,
        style: img.imageStyle || "editorial",
        aspect_ratio: img.imageAspectRatio || "16:9",
        provider: img.imageProvider,
        image_provider: img.imageProvider,
        api_key: img.imageApiKey,
        imageApiKey: img.imageApiKey,
        model: img.imageModel,
        image_model: img.imageModel,
        base_url: img.imageBaseUrl,
        image_base_url: img.imageBaseUrl,
      });
      if (res && res.imageUrl) {
        const aiTurn = change
          ? { id: "ima_" + Date.now(), who: "ai", text: "Updated the image from that note." }
          : null;
        const next = {
          ...p,
          imageUrl: res.imageUrl,
          imagePrompt: res.imagePrompt || res.prompt || prompt,
          imageChat: aiTurn ? [...(p.imageChat || []), aiTurn] : (p.imageChat || []),
        };
        setPosts((ps) => ps.map((row) => {
          if (row.id === p.id) return next;
          if (!p.uniqueForChannel && !wantsPerChannelDiff(change) && p.batchId && row.batchId === p.batchId && !row.uniqueForChannel && row.status !== "posted") {
            const shared = { ...row, imageUrl: next.imageUrl, imagePrompt: next.imagePrompt };
            persistPost(shared);
            return shared;
          }
          return row;
        }));
        persistPost(next);
        if (p.batchId && !p.uniqueForChannel && !wantsPerChannelDiff(change)) {
          syncBatchImage(p.batchId, next.imageUrl, next.imagePrompt, p.id);
        }
      } else {
        showToast((res && res.warning) || "Image generation failed.");
      }
    } catch (e) {
      showToast(e.message || "Image generation failed.");
    } finally {
      setImageBusy("");
    }
  };

  const sendImageChat = async (p) => {
    const text = String((imageNote && imageNote[p.id]) || "").trim();
    if (!text || !p || imageBusy === p.id) return;
    setImageNote((m) => ({ ...m, [p.id]: "" }));
    const split = wantsPerChannelDiff(text);
    const userTurn = { id: "im_" + Date.now(), who: "user", text };
    const nextChat = [...(p.imageChat || []), userTurn];
    const seeded = { ...p, imageChat: nextChat, uniqueForChannel: p.uniqueForChannel || split, status: p.status === "posted" ? "posted" : "draft" };
    setPosts((ps) => ps.map((row) => (row.id === p.id ? seeded : row)));
    await regenImage(seeded, text);
  };

  const sendCopyChat = (p) => {
    const text = String((copyNote && copyNote[p.id]) || "").trim();
    if (!text || !p || copyBusy === p.id || p.enriching) return;
    setCopyNote((m) => ({ ...m, [p.id]: "" }));
    const split = wantsPerChannelDiff(text);
    const userTurn = { id: "cp_" + Date.now(), who: "user", text };
    const nextChat = [...(p.copyChat || []), userTurn];
    const seeded = { ...p, copyChat: nextChat, uniqueForChannel: p.uniqueForChannel || split, status: p.status === "posted" ? "posted" : "draft" };
    setCopyBusy(p.id);
    setPosts((ps) => ps.map((row) => (row.id === p.id ? seeded : row)));
    fillPackages([seeded], { skipImage: true, revisionNote: text, share: !split && !p.uniqueForChannel });
  };

  const revertTouched = (id, patch) => {
    setPosts((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch, status: p.status === "posted" ? "posted" : "draft" } : p)));
  };

  const approveOne = async (p, opts = {}) => {
    if (!p || p.status === "posted") return { ok: false, reason: "posted" };
    if (!opts.batch && publishing) return { ok: false, reason: "busy" };
    const ch = String(p.channel || "linkedin").toLowerCase();
    if (!connected.some((a) => String(a.platform || "").toLowerCase() === ch)) {
      if (!opts.quiet) {
        setPage("accounts");
        showToast("Connect " + ch + " first.");
      }
      return { ok: false, reason: "connect", channel: ch };
    }
    if (!opts.batch) setPublishing(p.id);
    try {
      await persistPost({ ...p, status: p.status || "draft" });
      const nowMs = Date.now();
      const due = parseIsoDate(p.date);
      const [hh, mm] = String(p.time || "09:00").split(":");
      const dueMs = new Date(due).setHours(parseInt(hh, 10) || 9, parseInt(mm, 10) || 0, 0, 0);
      if (dueMs > nowMs + 60000) {
        await api.updatePostStatus(p.id, "scheduled", p.caption, p.imageUrl, p.imagePrompt);
        setPosts((ps) => ps.map((row) => (row.id === p.id ? { ...row, status: "scheduled" } : row)));
        if (!opts.quiet) showToast("Approved. Scheduled " + dayLabel(p.date) + " " + (p.time || "09:00") + ".");
        return { ok: true, status: "scheduled" };
      }
      await persistPost({ ...p, status: "approved" });
      const res = await api.publishPost(p.id, {
        title: p.headline,
        copy: p.caption,
        channels: p.channels || [p.channel],
        imageUrl: p.imageUrl,
      });
      const ok = res && (res.status === "ok" || res.ok || (res.publishResults || []).some((r) => r.ok));
      setPosts((ps) => ps.map((row) => (row.id === p.id ? { ...row, status: ok ? "posted" : row.status, publishResults: res && res.publishResults } : row)));
      if (!opts.quiet) showToast(ok ? "Posted." : "Publish failed. Check Accounts.");
      return { ok, status: ok ? "posted" : "draft", reason: ok ? undefined : "publish" };
    } catch (e) {
      if (!opts.quiet) showToast("Publish failed: " + (e.message || "error"));
      return { ok: false, reason: "error", message: e.message };
    } finally {
      if (!opts.batch) setPublishing("");
    }
  };

  const approveAllDrafts = async () => {
    const list = posts.filter((p) => p.status === "draft" || !p.status);
    if (!list.length) return;
    setPublishing("all");
    const missing = [];
    let okCount = 0;
    let failCount = 0;
    for (const p of list) {
      const res = await approveOne(p, { batch: true, quiet: true });
      if (res && res.ok) okCount += 1;
      else if (res && res.reason === "connect") {
        if (!missing.includes(res.channel)) missing.push(res.channel);
      } else failCount += 1;
    }
    setPublishing("");
    if (missing.length) {
      setPage("accounts");
      showToast("Approved " + okCount + ". Connect " + missing.join(", ") + " for the rest.");
    } else if (failCount) {
      showToast("Approved " + okCount + ". " + failCount + " failed — check Accounts or try again.");
    } else {
      showToast(okCount + " draft" + (okCount === 1 ? "" : "s") + " approved.");
    }
  };

  const activeChannels = () => (channelDrafts.length ? channelDrafts.slice() : ["linkedin"]);

  const toggleChannel = (id) => {
    setChannelDrafts((prev) => {
      const has = prev.includes(id);
      if (has) {
        const next = prev.filter((x) => x !== id);
        return next.length ? next : prev;
      }
      return [...prev, id];
    });
  };

  const addComposerDate = (iso) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return;
    setDateDraft(iso);
    setPinnedDates((prev) => (prev.includes(iso) ? prev : [...prev, iso]));
    const d = new Date(parseIsoDate(iso));
    setCal({ year: d.getFullYear(), month: d.getMonth() });
  };

  const openDatePicker = () => {
    const el = datePickRef.current;
    if (!el) return;
    try {
      el.focus();
      if (typeof el.showPicker === "function") {
        const p = el.showPicker();
        if (p && typeof p.catch === "function") p.catch(() => { try { el.click(); } catch (_) {} });
      } else {
        el.click();
      }
    } catch (_) {
      try { el.click(); } catch (__) {}
    }
  };

  const shiftIso = (n) => {
    const t = new Date();
    t.setHours(12, 0, 0, 0);
    t.setDate(t.getDate() + n);
    return isoDate(t.getTime());
  };

  const generateFromComposer = () => {
    if (typing) return;
    const typed = (topicDraft || draft).trim();
    if (isClassicRevertPhrase(typed)) {
      setSchedulerEdition("classic");
      if (onUseClassic) onUseClassic();
      return;
    }
    if (!typed) {
      showToast("Write the plan for this post first.");
      return;
    }
    const topic = typed;
    const dates = pinnedDates.length ? pinnedDates.slice() : [dateDraft || isoDate(Date.now())];
    const named = channelsNamedInText(topic);
    const channels = named.length ? named : activeChannels();
    const reuseKey = dates.slice().sort().join(",") + "|" + channels.slice().sort().join(",") + "|" + normPlan(topic);
    const existing = sameTaskDrafts(posts, dates, channels, topic);
    if (existing.length && repeatGenerate.current !== reuseKey) {
      repeatGenerate.current = reuseKey;
      setSelectedId(existing[0].id);
      setApprovalOpen(true);
      const chLabel = channels.map((id) => (CHANNELS.find((c) => c.id === id) || { label: id }).label).join(", ");
      setChat((cs) => [
        ...cs,
        { id: "u_" + Date.now(), who: "user", text: topic + "\n" + dates.map(dayLabel).join(", ") + " · " + chLabel },
        { id: "a_" + Date.now(), who: "ai", kind: "draft", postId: existing[0].id, text: reuseAskText(existing, dates, channels) },
      ]);
      return;
    }
    repeatGenerate.current = "";
    const batchId = "b_" + Date.now();
    const perChannel = wantsPerChannelDiff(topic);
    const created = [];
    dates.forEach((date) => {
      channels.forEach((channel) => {
        created.push({
          id: newPostId() + String(created.length),
          date,
          time: "09:00",
          channel,
          channels: [channel],
          headline: topic.slice(0, 140),
          plan: topic,
          caption: "",
          imagePrompt: topic,
          imageUrl: "",
          batchId,
          uniqueForChannel: perChannel,
          status: "draft",
          enriching: true,
        });
      });
    });
    setTopicDraft("");
    setDraft("");
    setFocusPostId(created[0].id);
    setSelectedId(created[0].id);
    setExpandedApprovalId(created[0].id);
    setApprovalOpen(true);
    setPosts((ps) => [...ps, ...created]);
    created.forEach(persistPost);
    fillPackages(created, { share: !perChannel });
    const d = new Date(parseIsoDate(created[0].date));
    setCal({ year: d.getFullYear(), month: d.getMonth() });
    setPlan({
      rangeLabel: monthLabel(d.getFullYear(), d.getMonth()),
      channels,
    });
    const chLabel = channels.map((id) => (CHANNELS.find((c) => c.id === id) || { label: id }).label).join(", ");
    setChat((cs) => [
      ...cs,
      { id: "u_" + Date.now(), who: "user", text: topic + "\n" + [...new Set(created.map((p) => dayLabel(p.date)))].join(", ") + " · " + chLabel },
      {
        id: "a_" + Date.now(),
        who: "ai",
        kind: "draft",
        postId: created[0].id,
        text: created.length > 1
          ? (perChannel
            ? ("Drafting a different caption + image for each of " + created.length + " slots, because you asked for per-channel versions.")
            : ("Drafting one caption + one image for " + created.length + " slots (" + dates.length + " day" + (dates.length === 1 ? "" : "s") + " × " + channels.length + " channel" + (channels.length === 1 ? "" : "s") + ")."))
          : ("Drafting for " + dayLabel(created[0].date) + " on " + chLabel + ". Open Approvals to edit image or copy, then approve."),
      },
    ]);
  };

  const sendChat = (e, override) => {
    if (e && e.preventDefault) e.preventDefault();
    const text = ((override && override.text) || draft || topicDraft).trim();
    if (!text || typing) return;
    if (isClassicRevertPhrase(text)) {
      setDraft("");
      setSchedulerEdition("classic");
      if (onUseClassic) onUseClassic();
      return;
    }
    setDraft("");
    setTopicDraft("");
    const namedSend = channelsNamedInText(text);
    const selectedSend = namedSend.length ? namedSend : activeChannels();
    const pinList = pinnedDates.length ? pinnedDates.join(", ") : "";
    const chList = selectedSend.join(", ");
    let sendText = text;
    if (override && override.reshare) sendText = text;
    else if (focusPostId) sendText = "Revise post " + focusPostId + ": " + text;
    else if (pinList && !/\d{4}-\d{2}-\d{2}/.test(text)) sendText = "For " + pinList + " on " + chList + " only: " + text;
    const userMsg = { id: "u_" + Date.now(), who: "user", text };
    setChat((cs) => {
      if (override && override.replaceFromId) {
        const idx = cs.findIndex((m) => m.id === override.replaceFromId);
        const head = idx >= 0 ? cs.slice(0, idx) : cs;
        return [...head, userMsg];
      }
      return [...cs, userMsg];
    });
    setTyping(true);
    setEditingId("");

    const creds = getActiveAiCredentials(commonAi, "scheduler", "postWriter");
    const baseHistory = (override && override.replaceFromId)
      ? chat.filter((_, i, arr) => {
        const idx = arr.findIndex((x) => x.id === override.replaceFromId);
        return idx < 0 || i < idx;
      })
      : chat;
    const history = [...baseHistory, userMsg]
      .filter((m) => m && m.text && !looksLikeJunkDump(m.text) && m.kind !== "draft" && m.kind !== "pin")
      .slice(-12)
      .map((m) => ({
        role: m.who === "user" ? "user" : "assistant",
        content: coerceChatText(m.text).slice(0, 800),
      }));
    const currentPlan = {
      rangeLabel: plan.rangeLabel,
      channels: selectedSend,
      pinnedDates,
      posts: posts.map((p) => ({
        id: p.id,
        date: p.date,
        time: p.time,
        channel: p.channel,
        headline: p.headline,
        caption: p.caption,
        imagePrompt: p.imagePrompt,
        status: p.status,
      })),
    };

    api.chatPlan({
      text: sendText,
      messages: history.concat([{ role: "user", content: sendText }]).slice(-12),
      apiKey: creds.apiKey || "",
      provider: creds.provider || "openai",
      model: creds.model || "gpt-4o",
      baseUrl: creds.baseUrl || "",
      returnPlan: true,
      currentPlan,
      targetDate: pinnedDates.length === 1 ? pinnedDates[0] : "",
      pinnedDates,
      selectedChannels: selectedSend,
      focusPostId: focusPostId || "",
      ...companyPayload(profile),
    }).then((res) => {
      setTyping(false);
      let incoming = (res && res.plan) || extractPlanFromText(res && res.reply) || extractPlanFromText(text);
      if (incoming && Array.isArray(incoming.posts) && incoming.posts.length && namedSend.length) {
        const filtered = incoming.posts.filter((p) => namedSend.includes(String(p.channel || "").toLowerCase()));
        incoming = {
          ...incoming,
          channels: namedSend,
          posts: filtered.length
            ? filtered
            : namedSend.map((ch) => ({ ...(incoming.posts[0] || {}), channel: ch, id: undefined })),
        };
      }
      if (incoming && Array.isArray(incoming.posts) && incoming.posts.length) {
        const pinFallback = pinnedDates[pinnedDates.length - 1] || dateDraft || isoDate(Date.now());
        const dates = [...new Set(incoming.posts.map((p) => p.date || pinFallback))];
        const channels = namedSend.length ? namedSend : [...new Set(incoming.posts.map((p) => String(p.channel || "linkedin").toLowerCase()))];
        const reuseKey = dates.slice().sort().join(",") + "|" + channels.slice().sort().join(",") + "|" + normPlan(text);
        const existing = sameTaskDrafts(posts, dates, channels, text);
        if (existing.length && repeatGenerate.current !== reuseKey) {
          repeatGenerate.current = reuseKey;
          setSelectedId(existing[0].id);
          setApprovalOpen(true);
          setChat((cs) => [
            ...cs,
            { id: "a_" + Date.now(), who: "ai", kind: "draft", postId: existing[0].id, text: reuseAskText(existing, dates, channels) },
          ]);
          return;
        }
        repeatGenerate.current = "";
      }
      const created = (incoming && Array.isArray(incoming.posts) && incoming.posts.length)
        ? applyPlan(incoming, true, !wantsPerChannelDiff(text))
        : [];
      const spoken = created.length
        ? (created.length > 1 && !wantsPerChannelDiff(text)
          ? ("Same caption and image for " + created.length + " slots. Open Approvals to edit copy or image, or ask for a different version per channel.")
          : ("Draft is in Approvals. Edit image or caption there — that is the post that will go out, not this chat."))
        : humanizeAiReply((res && res.reply) || "", false);
      setChat((cs) => [
        ...cs,
        {
          id: "a_" + Date.now(),
          who: "ai",
          kind: created.length ? "draft" : "ai",
          postId: created[0] && created[0].id,
          text: spoken,
        },
      ]);
    }).catch((err) => {
      setTyping(false);
      setChat((cs) => [...cs, { id: "a_" + Date.now(), who: "ai", text: "Could not reach Plan AI: " + (err.message || "error") }]);
    });
  };

  const deleteMsg = (id) => {
    setChat((cs) => cs.filter((m) => m.id !== id));
    if (editingId === id) setEditingId("");
  };

  const saveEdit = (id) => {
    const next = editText.trim();
    if (!next) return;
    setChat((cs) => cs.map((m) => (m.id === id ? { ...m, text: next } : m)));
    setEditingId("");
  };

  const copyMsg = async (text) => {
    try {
      await navigator.clipboard.writeText(coerceChatText(text));
      showToast("Copied.");
    } catch (_) {
      showToast("Could not copy.");
    }
  };

  const reshareMsg = (m) => {
    const text = coerceChatText(m.text);
    if (!text) return;
    sendChat(null, { text, reshare: true });
  };

  const archiveCurrent = () => {
    const userBits = chat.filter((m) => m.who === "user" && m.text);
    if (!userBits.length) return;
    const title = coerceChatText(userBits[0].text).split("\n")[0].slice(0, 52);
    setThreads((ts) => [{ id: "t_" + Date.now(), title: title || "Chat", updatedAt: Date.now(), messages: chat }, ...ts].slice(0, 40));
  };

  const newChat = () => {
    archiveCurrent();
    setChat([WELCOME]);
    setHistOpen(false);
    setEditingId("");
  };

  const loadThread = (t) => {
    if (!t || !Array.isArray(t.messages)) return;
    archiveCurrent();
    setChat(t.messages);
    setHistOpen(false);
  };

  const deleteThread = (id) => {
    setThreads((ts) => ts.filter((t) => t.id !== id));
  };

  const openApprovals = (id) => {
    if (id) {
      setSelectedId(id);
      setExpandedApprovalId(id);
    }
    setApprovalOpen(true);
  };

  const cta = (() => {
    if (drafts.length) return { label: drafts.length + " in Approvals", disabled: false, action: () => openApprovals(selectedId), tone: "approve" };
    if (readyToSend.length) {
      return { label: publishing ? "Posting…" : "Post scheduled", disabled: !!publishing, action: () => openApprovals(readyToSend[0].id), tone: "go" };
    }
    return { label: "Generate a draft", disabled: true, action: null, tone: "idle" };
  })();

  const statusColor = (s) => {
    if (s === "posted") return C.teal;
    if (s === "approved" || s === "scheduled") return C.green;
    return C.amber;
  };

  const statusLabel = (s) => {
    if (s === "posted") return "Live";
    if (s === "scheduled") return "Scheduled";
    if (s === "approved") return "Approved";
    return "Review";
  };

  const reviewList = posts.slice().sort((a, b) => {
    const rank = (s) => (s === "posted" ? 2 : (s === "scheduled" || s === "approved" ? 1 : 0));
    const d = rank(a.status) - rank(b.status);
    if (d) return d;
    return String(a.date || "").localeCompare(String(b.date || ""));
  });
  const waitingList = reviewList.filter((p) => p.status === "draft" || !p.status);
  const doneList = reviewList.filter((p) => p.status && p.status !== "draft");

  const applyImageToBatch = (p) => {
    if (!p || !p.imageUrl || !p.batchId) {
      showToast("Generate an image on this draft first.");
      return;
    }
    syncBatchImage(p.batchId, p.imageUrl, p.imagePrompt, null);
    showToast("Same image applied to every channel in this set.");
  };

  const connectOauth = async (plat) => {
    setConnecting(plat);
    try {
      const res = await api.startSocialOauth(plat, window.location.origin);
      if (!res?.authUrl) {
        const err = res?.error || "";
        setPage("accounts");
        showToast(
          err.includes("not configured") || err.includes("Client ID")
            ? "Paste Client ID + Secret in OAuth app below, Save app, then Connect."
            : err || "Connect failed. Save Client ID + Secret first."
        );
        return;
      }
      const popup = window.open(res.authUrl, "aivhub-oauth-" + plat, "width=620,height=780");
      if (!popup) window.location.href = res.authUrl;
    } catch (e) {
      setPage("accounts");
      showToast(e.message || "Connect failed");
    } finally {
      setConnecting("");
    }
  };

  const disconnectAccount = async (id) => {
    try {
      await api.deleteSocialAccount(id);
      refreshAccounts();
    } catch (e) {
      showToast(e.message || "Remove failed");
    }
  };

  return (
    <div style={{ display: "flex", height: "100vh", background: C.paper, fontFamily: FONT_BODY }}>
      <AppChrome />
      <div style={{ width: 228, minWidth: 228, background: C.ink, height: "100vh", display: "flex", flexDirection: "column", padding: "18px 12px", boxSizing: "border-box" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 8px 12px" }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: C.teal, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <CalendarDays size={15} color="#fff" />
          </div>
          <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, color: "#fff" }}>Post scheduler</span>
        </div>
        <button
          type="button"
          onClick={onBackToHub}
          style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 4px 14px", padding: "8px 10px", borderRadius: 8, border: `1px solid ${C.inkLine}`, background: "transparent", color: "#C8CCD6", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
        >
          <LayoutGrid size={14} /> All plugins
        </button>

        <button
          type="button"
          onClick={() => { setPage("plan"); setApprovalOpen(false); }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            margin: "0 4px",
            padding: "10px 12px",
            borderRadius: 10,
            border: "none",
            background: page === "plan" && !approvalOpen ? "#1E2230" : "transparent",
            color: "#fff",
            fontSize: 13,
            fontWeight: 700,
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          <CalendarDays size={15} />
          <span>Calendar</span>
        </button>
        <button
          type="button"
          onClick={() => openApprovals()}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            margin: "0 4px",
            padding: "10px 12px",
            borderRadius: 10,
            border: "none",
            background: approvalOpen ? "#1E2230" : "transparent",
            color: "#fff",
            fontSize: 13,
            fontWeight: 700,
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          <Check size={15} />
          <span style={{ flex: 1 }}>Approvals</span>
          {drafts.length ? (
            <span style={{ minWidth: 18, height: 18, borderRadius: 99, background: C.amber, color: "#fff", fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 5px" }}>
              {drafts.length}
            </span>
          ) : null}
        </button>
        <button
          type="button"
          onClick={() => { setApprovalOpen(false); setPage("accounts"); }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            margin: "0 4px",
            padding: "10px 12px",
            borderRadius: 10,
            border: "none",
            background: page === "accounts" && !approvalOpen ? "#1E2230" : "transparent",
            color: "#fff",
            fontSize: 13,
            fontWeight: 700,
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          <Plug size={15} />
          <span>Accounts & AI</span>
        </button>
        <div style={{ flex: 1 }} />

        <button
          type="button"
          onClick={() => { setSchedulerEdition("classic"); if (onUseClassic) onUseClassic(); }}
          style={{ display: "flex", alignItems: "center", gap: 8, margin: "8px 4px 4px", padding: "8px 10px", borderRadius: 8, border: "none", background: "transparent", color: "#C8CCD6", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
        >
          <History size={14} /> Use classic scheduler
        </button>
        <button
          type="button"
          onClick={onLogout}
          style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 4px", padding: "8px 10px", borderRadius: 8, border: "none", background: "transparent", color: "#8B90A0", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
        >
          <LogOut size={14} /> Log out
        </button>
      </div>

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        {page === "accounts" ? (
          <SimpleAccountsPage
            accounts={accounts}
            connecting={connecting}
            onConnect={connectOauth}
            onDisconnect={disconnectAccount}
            showToast={showToast}
            aiKeysPanel={aiKeysPanel}
            profile={profile}
            setProfile={setProfile}
            knowledgeSources={knowledgeSources}
            setKnowledgeSources={setKnowledgeSources}
          />
        ) : (
        <>
        <div style={{ padding: "14px 20px", borderBottom: `1px solid ${C.border}`, background: "#fff", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 20, color: C.ink }}>
              {plan.rangeLabel || monthLabel(cal.year, cal.month)}
            </div>
            <div style={{ fontSize: 12.5, color: C.slate, marginTop: 2 }}>
              {companyName(profile)} · Pin dates · generate · Approvals window
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <button
              type="button"
              disabled={cta.disabled}
              onClick={() => cta.action && cta.action()}
              style={{
                height: 36,
                padding: "0 14px",
                borderRadius: 10,
                border: "none",
                background: cta.tone === "go" ? C.teal : cta.tone === "approve" ? C.ink : C.paperSoft,
                color: cta.tone === "idle" ? C.slate : "#fff",
                fontWeight: 700,
                fontSize: 13,
                cursor: cta.disabled ? "default" : "pointer",
                opacity: cta.disabled ? 0.7 : 1,
                whiteSpace: "nowrap",
              }}
            >
              {cta.label}
            </button>
          </div>
        </div>

        <div style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden" }}>
          <div style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: 18, background: HUB_PAPER, display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <button type="button" onClick={() => setCal((c) => (c.month === 0 ? { year: c.year - 1, month: 11 } : { year: c.year, month: c.month - 1 }))} style={navBtn}>
                <ChevronLeft size={16} />
              </button>
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, color: C.ink }}>{monthLabel(cal.year, cal.month)}</div>
              <button type="button" onClick={() => setCal((c) => (c.month === 11 ? { year: c.year + 1, month: 0 } : { year: c.year, month: c.month + 1 }))} style={navBtn}>
                <ChevronRight size={16} />
              </button>
            </div>
            {pinnedDates.length ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: C.slateLight }}>PINNED</span>
                {pinnedDates.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={(e) => unpinDate(d, e)}
                    style={{ ...secBtn, height: 28, fontSize: 11, background: C.tealSoft, borderColor: C.teal }}
                    title="Click to unpin"
                  >
                    {dayLabel(d)} <X size={11} />
                  </button>
                ))}
                <button type="button" onClick={() => { setPinnedDates([]); setFocusDate(""); setDateDraft(isoDate(Date.now())); }} style={{ ...secBtn, height: 28, fontSize: 11 }}>
                  Unpin all
                </button>
              </div>
            ) : (
              <div style={{ fontSize: 12, color: C.slate }}>Click a day to pin it. Click again to unpin. Several days can stay pinned at once.</div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6 }}>
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                <div key={d} style={{ fontSize: 11, fontWeight: 700, color: C.slateLight, textAlign: "center", padding: "4px 0" }}>{d}</div>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6 }}>
              {cells.map((day, i) => {
                if (!day) return <div key={"e" + i} />;
                const key = isoDate(day.getTime());
                const dayPosts = postsByDay[key] || [];
                const isToday = isoDate(Date.now()) === key;
                const pinned = pinnedDates.includes(key);
                return (
                  <div
                    key={key}
                    role="button"
                    tabIndex={0}
                    onClick={() => (pinned ? unpinDate(key) : pinDay(key))}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pinned ? unpinDate(key) : pinDay(key); } }}
                    style={{
                      minHeight: 84,
                      background: pinned ? C.tealSoft : "#fff",
                      border: `1px solid ${pinned ? C.teal : isToday ? C.teal : C.border}`,
                      borderRadius: 10,
                      padding: 8,
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.ink, marginBottom: 6, display: "flex", justifyContent: "space-between" }}>
                      <span>{day.getDate()}</span>
                      {pinned ? (
                        <button type="button" onClick={(e) => unpinDate(key, e)} style={{ fontSize: 9, fontWeight: 700, color: C.teal, border: "none", background: "transparent", cursor: "pointer" }}>
                          PINNED ×
                        </button>
                      ) : null}
                    </div>
                    {dayPosts.length === 0 ? (
                      <div style={{ fontSize: 10.5, color: C.slate, lineHeight: 1.35 }}>{pinned ? "Pinned" : "Pin this day"}</div>
                    ) : dayPosts.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={(e) => { e.stopPropagation(); openApprovals(p.id); }}
                        style={{
                          display: "block",
                          width: "100%",
                          textAlign: "left",
                          border: "none",
                          background: selectedId === p.id ? C.tealSoft : C.paperSoft,
                          borderRadius: 6,
                          padding: "5px 6px",
                          marginBottom: 4,
                          cursor: "pointer",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <span style={{ width: 6, height: 6, borderRadius: 99, background: statusColor(p.status) }} />
                          <span style={{ fontSize: 10, fontWeight: 700, color: C.slate }}>{p.time} · {p.channel}</span>
                        </div>
                        <div style={{ fontSize: 11.5, color: C.ink, fontWeight: 600, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {p.enriching ? "Writing…" : p.headline}
                        </div>
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>

            {drafts.length ? (
              <button type="button" onClick={() => openApprovals()} style={{ ...secBtn, justifyContent: "center", width: "100%" }}>
                Open Approvals ({drafts.length} draft{drafts.length === 1 ? "" : "s"})
              </button>
            ) : null}
          </div>

          <div
            style={{
              width: chatW,
              flex: `0 0 ${chatW}px`,
              minWidth: 280,
              borderLeft: `1px solid ${C.border}`,
              background: "#fff",
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
              overflow: "hidden",
              position: "relative",
            }}
          >
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize Plan AI"
              title="Drag to resize chat"
              onMouseDown={startChatResize}
              onDoubleClick={() => setChatW(380)}
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                bottom: 0,
                width: 8,
                cursor: "col-resize",
                zIndex: 6,
                background: "transparent",
              }}
            />
            <div style={{ padding: "12px 14px", borderBottom: `1px solid ${C.border}`, flexShrink: 0, display: "flex", alignItems: "center", gap: 8 }}>
              <Sparkles size={14} color={C.teal} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 14 }}>Plan AI</div>
                <div style={{ fontSize: 11, color: C.slate, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {pinnedDates.length ? pinnedDates.map(dayLabel).join(" · ") : "Pin a day, write the plan, generate."}
                </div>
              </div>
              <button type="button" onClick={() => setHistOpen((v) => !v)} title="Chat history" style={{ ...secBtn, height: 30, width: 30, padding: 0, justifyContent: "center", flexShrink: 0 }}>
                <History size={14} />
              </button>
              <button type="button" onClick={newChat} title="New chat" style={{ ...secBtn, height: 30, width: 30, padding: 0, justifyContent: "center", flexShrink: 0 }}>
                <Plus size={14} />
              </button>
            </div>
            {histOpen ? (
              <div style={{ position: "absolute", top: 52, left: 10, right: 10, zIndex: 8, background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, padding: 10, maxHeight: 220, overflowY: "auto", boxShadow: "0 8px 24px rgba(18,20,28,0.12)" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: C.slateLight, marginBottom: 6 }}>HISTORY</div>
                {threads.length === 0 ? (
                  <div style={{ fontSize: 12, color: C.slate }}>No saved chats yet.</div>
                ) : threads.map((t) => (
                  <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                    <button type="button" onClick={() => loadThread(t)} style={{ ...secBtn, flex: 1, height: 30, justifyContent: "flex-start", overflow: "hidden", minWidth: 0 }}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</span>
                    </button>
                    <button type="button" onClick={() => deleteThread(t.id)} style={{ ...secBtn, height: 30, width: 30, padding: 0, justifyContent: "center", flexShrink: 0 }} title="Delete chat">
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", padding: "18px 12px 12px", background: HUB_PAPER }}>
              {chat.filter((m) => m && m.text && m.kind !== "pin" && !looksLikeJunkDump(m.text)).map((m) => {
                const body = m.who === "ai" ? humanizeAiReply(m.text, !!m.postId) : coerceChatText(m.text);
                if (!body) return null;
                const mine = m.who === "user";
                const editing = editingId === m.id;
                const showActs = hoverMsg === m.id || editing;
                return (
                  <div
                    key={m.id}
                    onMouseEnter={() => setHoverMsg(m.id)}
                    onMouseLeave={() => setHoverMsg("")}
                    style={{ marginBottom: 10, display: "flex", flexDirection: "column", alignItems: mine ? "flex-end" : "flex-start", minWidth: 0, width: "100%" }}
                  >
                    <div style={{ position: "relative", maxWidth: "88%", minWidth: 0 }}>
                      <div style={{
                        minWidth: 0,
                        boxSizing: "border-box",
                        padding: "8px 12px",
                        borderRadius: mine ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
                        background: mine ? C.ink : "#fff",
                        color: mine ? "#fff" : C.textInk,
                        fontSize: 13,
                        lineHeight: 1.45,
                        whiteSpace: "pre-wrap",
                        overflowWrap: "anywhere",
                        wordBreak: "break-word",
                        border: mine ? "none" : `1px solid ${C.border}`,
                      }}>
                        {editing ? (
                          <div>
                            <textarea
                              value={editText}
                              onChange={(e) => setEditText(e.target.value)}
                              rows={3}
                              style={{ width: "100%", borderRadius: 8, border: `1px solid ${C.border}`, padding: 8, fontFamily: FONT_BODY, fontSize: 13, boxSizing: "border-box", color: C.ink, resize: "vertical" }}
                            />
                            <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                              <button type="button" onClick={() => saveEdit(m.id)} style={{ ...secBtn, height: 28, fontSize: 11 }}>Save</button>
                              {mine ? (
                                <button type="button" onClick={() => sendChat(null, { text: editText, replaceFromId: m.id })} style={{ ...secBtn, height: 28, fontSize: 11 }}>Resend</button>
                              ) : null}
                              <button type="button" onClick={() => setEditingId("")} style={{ ...secBtn, height: 28, fontSize: 11 }}>Cancel</button>
                            </div>
                          </div>
                        ) : body}
                      </div>
                      {showActs && !editing ? (
                        <div style={{
                          position: "absolute",
                          top: -12,
                          right: mine ? 4 : "auto",
                          left: mine ? "auto" : 4,
                          display: "flex",
                          gap: 1,
                          background: "#fff",
                          border: `1px solid ${C.border}`,
                          borderRadius: 8,
                          padding: 2,
                          boxShadow: "0 4px 12px rgba(18,20,28,0.10)",
                          zIndex: 3,
                        }}>
                          <button type="button" title="Edit" onClick={() => { setEditingId(m.id); setEditText(coerceChatText(m.text)); }} style={{ ...iconMini, color: C.slate }}>
                            <Pencil size={12} />
                          </button>
                          <button type="button" title="Delete" onClick={() => deleteMsg(m.id)} style={{ ...iconMini, color: C.slate }}>
                            <Trash2 size={12} />
                          </button>
                          <button type="button" title="Copy" onClick={() => copyMsg(m.text)} style={{ ...iconMini, color: C.slate }}>
                            <Copy size={12} />
                          </button>
                          <button type="button" title="Reshare" onClick={() => reshareMsg(m)} style={{ ...iconMini, color: C.slate }}>
                            <Share2 size={12} />
                          </button>
                        </div>
                      ) : null}
                    </div>
                    {m.postId && !editing ? (
                      <button type="button" onClick={() => openApprovals(m.postId)} style={{ ...secBtn, marginTop: 6, height: 28, fontSize: 11 }}>
                        Open in Approvals
                      </button>
                    ) : null}
                  </div>
                );
              })}
              {typing && (
                <div style={{ fontSize: 12, color: C.slate, display: "flex", gap: 6, alignItems: "center" }}>
                  <span style={{ width: 6, height: 6, borderRadius: 99, background: C.teal, animation: "pulseBar 1s infinite" }} />
                  Writing…
                </div>
              )}
              <div ref={chatEnd} />
            </div>
            <div style={{ flexShrink: 0, borderTop: `1px solid ${C.border}`, padding: 12, background: "#fff" }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", color: C.slateLight, marginBottom: 6 }}>DATES</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginBottom: 10 }}>
                <button type="button" onClick={() => addComposerDate(shiftIso(0))} style={{ ...chipBtn, background: pinnedDates.includes(isoDate(Date.now())) ? C.tealSoft : "#fff", borderColor: pinnedDates.includes(isoDate(Date.now())) ? C.teal : C.border }}>
                  Today
                </button>
                <button type="button" onClick={() => addComposerDate(shiftIso(1))} style={{ ...chipBtn, background: pinnedDates.includes(shiftIso(1)) ? C.tealSoft : "#fff", borderColor: pinnedDates.includes(shiftIso(1)) ? C.teal : C.border }}>
                  Tomorrow
                </button>
                {pinnedDates.map((d) => (
                  <span
                    key={d}
                    style={{ ...chipBtn, background: C.tealSoft, borderColor: C.teal, color: C.ink, cursor: "default" }}
                  >
                    {dayLabel(d)}
                    <button
                      type="button"
                      title="Unpin"
                      onClick={(e) => unpinDate(d, e)}
                      style={{ border: "none", background: "transparent", padding: 0, marginLeft: 2, cursor: "pointer", display: "inline-flex", color: C.ink }}
                    >
                      <X size={11} />
                    </button>
                  </span>
                ))}
                <span style={{ ...chipBtn, background: C.paperSoft, borderColor: C.border, color: C.slate, cursor: "default" }} title="Date used when nothing is pinned">
                  {dayLabel(dateDraft)}
                </span>
                <span style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
                  <button type="button" onClick={openDatePicker} style={chipBtn} title="Open calendar">
                    <CalendarDays size={12} /> Pick date
                  </button>
                  <input
                    ref={datePickRef}
                    type="date"
                    value={dateDraft}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v) addComposerDate(v);
                    }}
                    aria-label="Pick date"
                    style={{
                      position: "absolute",
                      inset: 0,
                      opacity: 0.011,
                      width: "100%",
                      height: "100%",
                      border: "none",
                      padding: 0,
                      margin: 0,
                      cursor: "pointer",
                      zIndex: 2,
                    }}
                  />
                </span>
              </div>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", color: C.slateLight, marginBottom: 6 }}>CHANNELS</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                {CHANNELS.map((ch) => {
                  const on = channelDrafts.includes(ch.id);
                  return (
                    <button
                      key={ch.id}
                      type="button"
                      onClick={() => toggleChannel(ch.id)}
                      style={{
                        ...chipBtn,
                        background: on ? C.ink : "#fff",
                        color: on ? "#fff" : C.ink,
                        borderColor: on ? C.ink : C.border,
                      }}
                    >
                      {ch.label}
                    </button>
                  );
                })}
              </div>
              <textarea
                ref={inputRef}
                value={topicDraft}
                onChange={(e) => setTopicDraft(e.target.value)}
                rows={2}
                placeholder="Ask Plan AI, or write the thought for this post…"
                style={{ width: "100%", borderRadius: 10, border: `1px solid ${C.border}`, padding: "8px 10px", fontFamily: FONT_BODY, fontSize: 13, resize: "none", boxSizing: "border-box", marginBottom: 8, display: "block", minHeight: 56, maxHeight: 96 }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    generateFromComposer();
                  }
                }}
              />
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  onClick={generateFromComposer}
                  disabled={typing || !topicDraft.trim()}
                  style={{ ...priBtn, flex: 1, justifyContent: "center", height: 36, background: C.teal }}
                >
                  <Sparkles size={14} /> Generate
                </button>
                <button
                  type="button"
                  disabled={typing || !topicDraft.trim()}
                  onClick={() => sendChat(null, { text: topicDraft })}
                  title="Send as chat"
                  style={{ width: 40, height: 36, borderRadius: 9, border: `1px solid ${C.border}`, background: "#fff", color: C.ink, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
                >
                  <Send size={15} />
                </button>
              </div>
            </div>
          </div>
        </div>
        </>
        )}
      </div>

      {approvalOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(18,20,28,0.4)", zIndex: 60, display: "flex", justifyContent: "center", padding: 24 }} onClick={() => { setApprovalOpen(false); setExpandedApprovalId(""); }}>
          <div style={{ width: 820, maxWidth: "100%", height: "100%", background: HUB_PAPER, borderRadius: 16, display: "flex", flexDirection: "column", overflow: "hidden" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ padding: "16px 20px", borderBottom: `1px solid ${C.border}`, background: "#fff", display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18 }}>Approvals</div>
                <div style={{ fontSize: 12.5, color: C.slate, marginTop: 2 }}>
                  {drafts.length ? drafts.length + " draft" + (drafts.length === 1 ? "" : "s") + " waiting" : "Nothing waiting"}
                </div>
              </div>
              {drafts.length > 1 ? (
                <button type="button" onClick={approveAllDrafts} disabled={!!publishing} style={priBtn}>
                  <Check size={14} /> Approve all drafts
                </button>
              ) : null}
              <button type="button" onClick={() => { setApprovalOpen(false); setExpandedApprovalId(""); }} style={{ border: "none", background: "transparent", cursor: "pointer" }}><X size={18} /></button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: 18 }}>
              <ApprovalsBoard
                waitingList={waitingList}
                doneList={doneList}
                expandedId={expandedApprovalId}
                setExpandedId={(id) => {
                  setExpandedApprovalId(id);
                  if (id) setSelectedId(id);
                }}
                statusColor={statusColor}
                statusLabel={statusLabel}
                imageBusy={imageBusy}
                imageNote={imageNote}
                setImageNote={setImageNote}
                sendImageChat={sendImageChat}
                regenImage={regenImage}
                applyImageToBatch={applyImageToBatch}
                copyBusy={copyBusy}
                copyNote={copyNote}
                setCopyNote={setCopyNote}
                sendCopyChat={sendCopyChat}
                fillPackages={fillPackages}
                chatThisPost={chatThisPost}
                approveOne={approveOne}
                publishing={publishing}
                revertTouched={revertTouched}
              />
            </div>
          </div>
        </div>
      )}

      {toast ? (
        <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: C.ink, color: "#fff", padding: "10px 16px", borderRadius: 10, fontSize: 13, zIndex: 80 }}>
          {toast}
        </div>
      ) : null}
    </div>
  );
}

const chipBtn = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  height: 28,
  padding: "0 9px",
  borderRadius: 999,
  border: `1px solid ${C.border}`,
  background: "#fff",
  color: C.ink,
  fontWeight: 600,
  fontSize: 11,
  cursor: "pointer",
  fontFamily: FONT_BODY,
};

const navBtn = {
  width: 32,
  height: 32,
  borderRadius: 8,
  border: `1px solid ${C.border}`,
  background: "#fff",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const labelStyle = { display: "block", fontSize: 11, fontWeight: 700, color: C.slateLight, marginBottom: 6, letterSpacing: "0.04em" };

const secBtn = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  height: 36,
  padding: "0 12px",
  borderRadius: 9,
  border: `1px solid ${C.border}`,
  background: "#fff",
  color: C.ink,
  fontWeight: 600,
  fontSize: 12.5,
  cursor: "pointer",
  fontFamily: FONT_BODY,
};

const iconMini = {
  width: 26,
  height: 26,
  borderRadius: 7,
  border: "1px solid transparent",
  background: "transparent",
  color: "inherit",
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  opacity: 0.7,
};

const priBtn = {
  ...secBtn,
  border: "none",
  background: C.ink,
  color: "#fff",
};

export function SocialWorkspaceGate(props) {
  const revert = () => {
    setSchedulerEdition("classic");
    if (props.onUseClassic) props.onUseClassic();
  };
  return (
    <SimpleBoundary onRevert={revert}>
      <SocialWorkspace {...props} onUseClassic={revert} />
    </SimpleBoundary>
  );
}
