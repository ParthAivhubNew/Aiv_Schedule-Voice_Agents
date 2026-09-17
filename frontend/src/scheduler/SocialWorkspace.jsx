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

const WELCOME = {
  id: "c0",
  who: "ai",
  text: "Write the thought for the post (what it should be about). Pin the date. I draft from your company profile + that plan — not a stock angle.",
};

const CHANNELS = [
  { id: "linkedin", label: "LinkedIn" },
  { id: "x", label: "X" },
  { id: "facebook", label: "Facebook" },
  { id: "instagram", label: "Instagram" },
  { id: "threads", label: "Threads" },
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

function assembleCaption(pkg, fallback) {
  if (!pkg) return fallback || "";
  const hook = stripAiSlop(pkg.hook || "");
  const body = stripAiSlop(pkg.copy || pkg.linkedin_copy || "");
  let text = body;
  if (hook && body && !body.toLowerCase().startsWith(hook.slice(0, 40).toLowerCase())) {
    text = hook + "\n\n" + body;
  } else if (!body) text = hook;
  const tags = Array.isArray(pkg.hashtags) ? pkg.hashtags : [];
  const tagLine = tags.map((t) => (String(t).startsWith("#") ? t : "#" + t)).slice(0, 6).join(" ");
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

function looksLikeSlopPost(p) {
  const t = `${(p && p.headline) || ""} ${(p && p.caption) || ""}`;
  return /ERP dump|NetSuite export tab|Ops teams still close the week in spreadsheets|Friday close still lives|Scattered data in/i.test(t);
}

export function SocialWorkspace({
  operator,
  onBackToHub,
  onLogout,
  profile,
  commonAi,
  onOpenCommonAi,
  onUseClassic,
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
  const [gearOpen, setGearOpen] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [connecting, setConnecting] = useState("");
  const [publishing, setPublishing] = useState("");
  const now = new Date();
  const [cal, setCal] = useState({ year: now.getFullYear(), month: now.getMonth() });
  const chatEnd = useRef(null);
  const inputRef = useRef(null);
  const datePickRef = useRef(null);
  const enriching = useRef(new Set());
  const [focusDate, setFocusDate] = useState("");
  const [focusPostId, setFocusPostId] = useState("");
  const [imageBusy, setImageBusy] = useState("");
  const [imageNote, setImageNote] = useState({});
  const [hoverMsg, setHoverMsg] = useState("");

  const showToast = (msg) => {
    setToast(msg);
    window.setTimeout(() => setToast(""), 3200);
  };

  useEffect(() => { writeJson(LS_POSTS, posts); }, [posts]);
  useEffect(() => { writeJson(LS_PLAN, plan); }, [plan]);
  useEffect(() => { writeJson(LS_CHAT, chat); }, [chat]);
  useEffect(() => { writeJson(LS_THREADS, threads); }, [threads]);
  useEffect(() => { writeJson(LS_PINS, pinnedDates); }, [pinnedDates]);
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

  const refreshAccounts = useCallback(() => {
    api.getSocialAccounts()
      .then((data) => { if (Array.isArray(data)) setAccounts(data); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshAccounts();
    const onMsg = (e) => {
      const d = e && e.data;
      if (!d || d.type !== "aivhub-social-oauth") return;
      refreshAccounts();
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
    api.createPost({
      id: np.id,
      title: np.headline,
      copy: np.caption,
      channels: np.channels || [np.channel],
      status: np.status === "draft" ? "awaiting_approval" : np.status === "posted" ? "published" : np.status,
      slotDateMs: parseIsoDate(np.date),
      time: np.time,
      theme: np.headline,
      imageUrl: np.imageUrl,
      imagePrompt: np.imagePrompt,
    }).catch(() => {});
  };

  const applyPlan = (incoming, replaceAll) => {
    if (!incoming || !Array.isArray(incoming.posts) || !incoming.posts.length) return [];
    const pinFallback = pinnedDates[pinnedDates.length - 1] || dateDraft || isoDate(Date.now());
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
    fillPackages(toFill);
    if (nextPosts[0]) {
      setSelectedId(nextPosts[0].id);
      setApprovalOpen(true);
    }
    return nextPosts;
  };

  const fillPackages = (items) => {
    const creds = getActiveAiCredentials(commonAi, "scheduler", "postWriter");
    const img = resolveImageCredentials(commonAi);
    (items || []).forEach((item, idx) => {
      const seed = typeof item === "string" ? null : item;
      const id = typeof item === "string" ? item : item && item.id;
      if (!id || enriching.current.has(id)) return;
      enriching.current.add(id);
      setPosts((ps) => ps.map((p) => (p.id === id ? { ...p, enriching: true } : p)));
      window.setTimeout(async () => {
        let p = seed;
        if (!p) {
          try { p = JSON.parse(localStorage.getItem(LS_POSTS) || "[]").find((row) => row.id === id); } catch (_) {}
        }
        if (!p) {
          enriching.current.delete(id);
          setPosts((ps) => ps.map((row) => (row.id === id ? { ...row, enriching: false } : row)));
          return;
        }
        try {
          const hadCopy = (p.caption || "").trim().length >= 60;
          const res = await api.generateSocialPackage({
            topic: p.plan || p.headline,
            existingCopy: p.caption || "",
            linkedinDirective: (commonAi && commonAi.channelDirectives && commonAi.channelDirectives.linkedin) || "",
            style: img.imageStyle || "modern_saas",
            aspect_ratio: (p.channel === "linkedin" ? "4:5" : (img.imageAspectRatio || "16:9")),
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
          setPosts((rows) => rows.map((row) => {
            if (row.id !== id) return row;
            const src = pkg && pkg.generationSource;
            const assembled = assembleCaption(pkg, row.caption);
            const caption = (src === "llm" && assembled)
              ? assembled
              : (hadCopy ? row.caption : (assembled || row.caption || ""));
            const next = {
              ...row,
              enriching: false,
              caption,
              headline: (pkg && (pkg.postTitle || pkg.hook)) || row.headline,
              hook: (pkg && pkg.hook) || row.hook,
              hashtags: (pkg && pkg.hashtags) || row.hashtags,
              imageConcept: (pkg && (pkg.imageConcept || pkg.image_concept)) || row.imageConcept,
              imageHeadline: (pkg && (pkg.imageHeadline || pkg.image_headline)) || row.imageHeadline,
              imageUrl: (pkg && pkg.imageUrl) || row.imageUrl,
              imagePrompt: (pkg && (pkg.imagePrompt || pkg.image_prompt)) || row.imagePrompt,
            };
            persistPost(next);
            return next;
          }));
        } catch (_) {
          setPosts((rows) => rows.map((row) => (row.id === id ? { ...row, enriching: false } : row)));
        } finally {
          enriching.current.delete(id);
        }
      }, 150 * idx);
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
        setPosts((ps) => ps.map((row) => (row.id === p.id ? next : row)));
        persistPost(next);
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
    const userTurn = { id: "im_" + Date.now(), who: "user", text };
    const nextChat = [...(p.imageChat || []), userTurn];
    const seeded = { ...p, imageChat: nextChat, status: p.status === "posted" ? "posted" : "draft" };
    setPosts((ps) => ps.map((row) => (row.id === p.id ? seeded : row)));
    await regenImage(seeded, text);
  };

  const revertTouched = (id, patch) => {
    setPosts((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch, status: p.status === "posted" ? "posted" : "draft" } : p)));
  };

  const approveOne = async (p) => {
    if (!p || p.status === "posted" || publishing) return;
    const ch = String(p.channel || "linkedin").toLowerCase();
    if (!connected.some((a) => String(a.platform || "").toLowerCase() === ch)) {
      setGearOpen(true);
      showToast("Connect " + ch + " first.");
      return;
    }
    setPublishing(p.id);
    try {
      const nowMs = Date.now();
      const due = parseIsoDate(p.date);
      const [hh, mm] = String(p.time || "09:00").split(":");
      const dueMs = new Date(due).setHours(parseInt(hh, 10) || 9, parseInt(mm, 10) || 0, 0, 0);
      if (dueMs > nowMs + 60000) {
        await api.updatePostStatus(p.id, "scheduled", p.caption, p.imageUrl, p.imagePrompt);
        setPosts((ps) => ps.map((row) => (row.id === p.id ? { ...row, status: "scheduled" } : row)));
        showToast("Approved. Scheduled " + dayLabel(p.date) + " " + (p.time || "09:00") + ".");
        return;
      }
      persistPost({ ...p, status: "approved" });
      const res = await api.publishPost(p.id, {
        title: p.headline,
        copy: p.caption,
        channels: p.channels || [p.channel],
        imageUrl: p.imageUrl,
      });
      const ok = res && (res.status === "ok" || res.ok || (res.publishResults || []).some((r) => r.ok));
      setPosts((ps) => ps.map((row) => (row.id === p.id ? { ...row, status: ok ? "posted" : row.status, publishResults: res && res.publishResults } : row)));
      showToast(ok ? "Posted." : "Publish failed. Check Accounts.");
    } catch (e) {
      showToast("Publish failed: " + (e.message || "error"));
    } finally {
      setPublishing("");
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
      if (typeof el.showPicker === "function") el.showPicker();
      else el.click();
    } catch (_) {
      el.click();
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
    const channels = activeChannels();
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
          status: "draft",
          enriching: true,
        });
      });
    });
    setTopicDraft("");
    setDraft("");
    setFocusPostId(created[0].id);
    setSelectedId(created[0].id);
    setApprovalOpen(true);
    setPosts((ps) => [...ps, ...created]);
    created.forEach(persistPost);
    fillPackages(created);
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
          ? ("Drafting " + created.length + " posts (" + dates.length + " day" + (dates.length === 1 ? "" : "s") + " × " + channels.length + " channel" + (channels.length === 1 ? "" : "s") + "). Open Approvals to edit image or copy, then approve.")
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
    const pinList = pinnedDates.length ? pinnedDates.join(", ") : "";
    const chList = activeChannels().join(", ");
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
      channels: activeChannels(),
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
      selectedChannels: activeChannels(),
      focusPostId: focusPostId || "",
      ...companyPayload(profile),
    }).then((res) => {
      setTyping(false);
      const incoming = (res && res.plan) || extractPlanFromText(res && res.reply) || extractPlanFromText(text);
      const created = (incoming && Array.isArray(incoming.posts) && incoming.posts.length)
        ? applyPlan(incoming, true)
        : [];
      const spoken = humanizeAiReply((res && res.reply) || "", created.length > 0);
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
    if (id) setSelectedId(id);
    setApprovalOpen(true);
  };

  const approveAllDrafts = async () => {
    const list = posts.filter((p) => p.status === "draft" || !p.status);
    for (const p of list) {
      await approveOne(p);
    }
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

  const connectOauth = async (plat) => {
    setConnecting(plat);
    try {
      const res = await api.startSocialOauth(plat, window.location.origin);
      if (!res?.authUrl) {
        showToast(res?.error || "Save app credentials in classic Accounts first, or paste a token there.");
        return;
      }
      const popup = window.open(res.authUrl, "aivhub-oauth-" + plat, "width=620,height=780");
      if (!popup) window.location.href = res.authUrl;
    } catch (e) {
      showToast(e.message || "Connect failed");
    } finally {
      setConnecting("");
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
        <div style={{ flex: 1 }} />

        <button
          type="button"
          onClick={() => setGearOpen(true)}
          style={{ display: "flex", alignItems: "center", gap: 8, margin: "8px 4px 4px", padding: "8px 10px", borderRadius: 8, border: "none", background: "transparent", color: "#C8CCD6", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
        >
          <Settings2 size={14} /> Accounts & AI
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

          <div style={{ width: 380, flex: "0 0 380px", minWidth: 300, borderLeft: `1px solid ${C.border}`, background: "#fff", display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden", position: "relative" }}>
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
                  tabIndex={-1}
                  aria-hidden="true"
                  style={{ position: "fixed", left: -9999, width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
                />
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
      </div>

      {approvalOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(18,20,28,0.4)", zIndex: 60, display: "flex", justifyContent: "center", padding: 24 }} onClick={() => setApprovalOpen(false)}>
          <div style={{ width: 760, maxWidth: "100%", height: "100%", background: "#fff", borderRadius: 16, display: "flex", flexDirection: "column", overflow: "hidden" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ padding: "16px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 10 }}>
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
              <button type="button" onClick={() => setApprovalOpen(false)} style={{ border: "none", background: "transparent", cursor: "pointer" }}><X size={18} /></button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: 18, background: HUB_PAPER }}>
              {reviewList.length === 0 ? (
                <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, padding: 24, color: C.slate }}>
                  No posts yet. Generate a draft first.
                </div>
              ) : reviewList.map((p) => (
                <div key={p.id} id={"appr_" + p.id} style={{ background: "#fff", border: `1px solid ${selectedId === p.id ? C.teal : C.border}`, borderRadius: 14, padding: 16, marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
                    <div>
                      <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16 }}>{p.headline}</div>
                      <div style={{ fontSize: 12, color: C.slate, marginTop: 3 }}>
                        {dayLabel(p.date)} · {p.time} · {p.channel} · {statusLabel(p.status)}
                      </div>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: statusColor(p.status) }}>{statusLabel(p.status)}</span>
                  </div>
                  {p.imageUrl ? (
                    <img src={p.imageUrl} alt="" style={{ width: "100%", borderRadius: 12, marginBottom: 8, maxHeight: 200, objectFit: "cover" }} />
                  ) : (
                    <div style={{ height: 100, borderRadius: 12, background: C.paperSoft, display: "flex", alignItems: "center", justifyContent: "center", color: C.slate, marginBottom: 8, fontSize: 13 }}>
                      {p.enriching || imageBusy === p.id ? "Generating visual…" : "No image yet"}
                    </div>
                  )}
                  {p.status === "posted" ? (
                    <div style={{ fontSize: 13, color: C.slate, whiteSpace: "pre-wrap" }}>{p.caption}</div>
                  ) : (
                    <>
                      <label style={labelStyle}>Image chat</label>
                      <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 10, marginBottom: 10, background: HUB_PAPER }}>
                        <div style={{ fontSize: 12, color: C.slate, marginBottom: 8 }}>
                          Tell the visual what to change. AI redraws from that note.
                        </div>
                        <div style={{ maxHeight: 140, overflowY: "auto", marginBottom: 8 }}>
                          {(p.imageChat || []).length === 0 ? (
                            <div style={{ fontSize: 12, color: C.slateLight }}>e.g. “Spreadsheet on the left monitor, no fake dashboard UI.”</div>
                          ) : (p.imageChat || []).map((m) => (
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
                          {imageBusy === p.id ? <div style={{ fontSize: 12, color: C.teal }}>Redrawing…</div> : null}
                        </div>
                        <form
                          onSubmit={(e) => { e.preventDefault(); sendImageChat(p); }}
                          style={{ display: "flex", gap: 6 }}
                        >
                          <input
                            value={imageNote[p.id] || ""}
                            onChange={(e) => setImageNote((m) => ({ ...m, [p.id]: e.target.value }))}
                            placeholder="Describe the change…"
                            disabled={imageBusy === p.id}
                            style={{ flex: 1, height: 36, borderRadius: 8, border: `1px solid ${C.border}`, padding: "0 10px", fontFamily: FONT_BODY, fontSize: 13 }}
                          />
                          <button type="submit" disabled={imageBusy === p.id || !(imageNote[p.id] || "").trim()} style={{ ...priBtn, height: 36, background: C.teal }}>
                            <Send size={14} /> Apply
                          </button>
                        </form>
                      </div>
                      <label style={labelStyle}>Image prompt</label>
                      <textarea
                        value={p.imagePrompt || ""}
                        onChange={(e) => revertTouched(p.id, { imagePrompt: e.target.value })}
                        rows={2}
                        style={{ width: "100%", borderRadius: 10, border: `1px solid ${C.border}`, padding: 10, fontFamily: FONT_BODY, fontSize: 13, resize: "vertical", boxSizing: "border-box", marginBottom: 8 }}
                      />
                      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                        <button type="button" onClick={() => regenImage(p)} disabled={imageBusy === p.id} style={secBtn}>
                          <ImageIcon size={14} /> {imageBusy === p.id ? "Generating…" : (p.imageUrl ? "Regenerate image" : "Generate image")}
                        </button>
                        <button type="button" onClick={() => chatThisPost(p)} style={secBtn}>
                          <MessageSquare size={14} /> Chat this post
                        </button>
                      </div>
                      <label style={labelStyle}>Post copy</label>
                      <textarea
                        value={p.caption || ""}
                        onChange={(e) => revertTouched(p.id, { caption: e.target.value })}
                        rows={6}
                        style={{ width: "100%", borderRadius: 10, border: `1px solid ${C.border}`, padding: 10, fontFamily: FONT_BODY, fontSize: 13, resize: "vertical", boxSizing: "border-box" }}
                      />
                      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                        <button type="button" onClick={() => fillPackages([p])} style={secBtn}>Rewrite caption</button>
                        <button type="button" disabled={!!publishing} onClick={() => approveOne(p)} style={priBtn}>
                          <Check size={14} /> {publishing === p.id ? "Posting…" : "Approve & post"}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {gearOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(18,20,28,0.35)", zIndex: 50, display: "flex", justifyContent: "flex-end" }} onClick={() => setGearOpen(false)}>
          <div style={{ width: 400, height: "100%", background: "#fff", padding: 22, overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18 }}>Accounts & AI</div>
              <button type="button" onClick={() => setGearOpen(false)} style={{ border: "none", background: "transparent", cursor: "pointer" }}><X size={18} /></button>
            </div>
            <div style={{ fontSize: 12, color: C.slate, marginBottom: 12 }}>Connect a channel before Approve & post.</div>
            {(connected.length ? connected : [{ id: "none", platform: "none" }]).map((a) => (
              a.platform === "none" ? (
                <div key="none" style={{ fontSize: 13, color: C.slate, marginBottom: 12 }}>No accounts connected yet.</div>
              ) : (
                <div key={a.id} style={{ padding: "10px 12px", border: `1px solid ${C.border}`, borderRadius: 10, marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                  <Plug size={14} color={C.teal} />
                  <span style={{ fontWeight: 700, fontSize: 13, textTransform: "capitalize" }}>{a.platform}</span>
                  <span style={{ fontSize: 12, color: C.slate }}>{a.handle || a.label || ""}</span>
                </div>
              )
            ))}
            <div style={{ fontSize: 12, fontWeight: 700, color: C.slateLight, margin: "16px 0 8px" }}>CONNECT</div>
            {CHANNELS.map((ch) => (
              <button
                key={ch.id}
                type="button"
                onClick={() => connectOauth(ch.id)}
                disabled={connecting === ch.id}
                style={{ ...secBtn, width: "100%", justifyContent: "center", marginBottom: 6 }}
              >
                {connecting === ch.id ? "Opening…" : "Connect " + ch.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => { if (onOpenCommonAi) onOpenCommonAi(); }}
              style={{ ...secBtn, width: "100%", justifyContent: "center", marginTop: 12 }}
            >
              <Settings2 size={14} /> AI keys
            </button>
            <button
              type="button"
              onClick={() => { setSchedulerEdition("classic"); if (onUseClassic) onUseClassic(); }}
              style={{ ...secBtn, width: "100%", justifyContent: "center", marginTop: 8, color: C.slate }}
            >
              Use classic scheduler
            </button>
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
