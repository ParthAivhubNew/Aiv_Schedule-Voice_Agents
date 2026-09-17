import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import {
  Calendar,
  FileText,
  Headphones,
  History,
  LayoutGrid,
  List,
  LogOut,
  MapPin,
  Phone,
  PhoneCall,
  PhoneOff,
  Plug,
  Radio,
  Send,
  Sparkles,
  Upload,
  Video,
  Plus,
  Pencil,
  Trash2,
  Copy,
  RotateCcw,
  Check,
  X,
  Users,
} from "lucide-react";
import { AppChrome } from "../components/AppChrome";
import { NotificationBell } from "../components/TopBar";
import { api } from "../api/apiClient";
import { AudioStreamPlayer } from "../api/audioStreamPlayer";
import { C, FONT_BODY, FONT_DISPLAY, FONT_MONO, getActiveAiCredentials, meetingTimeLabel } from "../tokens";
import { setCallingEdition } from "./callingEdition";

const PAGES = [
  { id: "list", label: "List", icon: List },
  { id: "live", label: "Live", icon: Radio },
  { id: "booked", label: "Booked", icon: Calendar },
  { id: "logs", label: "Logs", icon: FileText },
  { id: "schedule", label: "Schedule", icon: PhoneCall },
  { id: "ai", label: "AI config", icon: Plug },
  { id: "company", label: "Company", icon: Users },
];

const EXTRA_SLOTS = ["Phone", "Email", "Website", "LinkedIn", "Contact"];
const SIMPLE_PAGES = new Set(PAGES.map((p) => p.id));

function callingPageId(raw) {
  const id = String(raw || "");
  if (id === "setup") return "company";
  return SIMPLE_PAGES.has(id) ? id : "";
}
const ALERT_KEY = "aivhub_meeting_alerted";
const LS_CHAT = "aivhub_calling_v1_chat";
const LS_THREADS = "aivhub_calling_v1_threads";
const LS_LISTS = "aivhub_calling_saved_lists";
const LS_NOTES = "aivhub_calling_v1_notes";
const WELCOME = {
  id: "c0",
  who: "ai",
  text: "Write what you need: find missing on the list, look up a company, or draft who to call. I fill empty cells from public search only — no invented numbers. Pause or Stop anytime during Find missing.",
};

function isChatJunk(m) {
  const t = String((m && m.text) || "").trim();
  return /^(Searching\s+\d+\/\d+|Batch done\b|Looking\s+\d+\/\d+|Find missing (finished|for)\b)/i.test(t);
}

function cleanChat(list) {
  const arr = (Array.isArray(list) ? list : []).filter((m) => m && m.text && !isChatJunk(m));
  return arr.length ? arr : [WELCOME];
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

function writeJson(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (_) {}
}

function digitsInPhone(raw) {
  return String(raw || "").replace(/\D/g, "");
}

function looksLikeUrl(v) {
  const s = String(v || "").trim();
  if (!s) return false;
  return /^https?:\/\//i.test(s) || /^www\./i.test(s) || (/^[a-z0-9.-]+\.[a-z]{2,}/i.test(s) && !/\s/.test(s));
}

function normalizeWebsite(v) {
  const s = String(v || "").trim();
  if (!s || /public web search/i.test(s)) return "";
  if (/^https?:\/\//i.test(s)) return s;
  if (/^www\./i.test(s) || (/^[a-z0-9.-]+\.[a-z]{2,}/i.test(s) && !/\s/.test(s))) return "https://" + s.replace(/^\/+/, "");
  return "";
}

function junkCompanyHeader(h) {
  const s = String(h || "");
  return /^(urn|id|ref|#)$/i.test(s.trim()) || /sic|sector|tps|ctps|employee|postcode|address|telephone|phone|web |website|contact |forename|surname|title|position/i.test(s);
}

function headerToField(h) {
  const s = String(h || "");
  if (/web\s*address|website|web\s*site|homepage|\burl\b/i.test(s) && !/linkedin/i.test(s)) return "website";
  if (/telephone|phone|mobile|\btel\b/i.test(s)) return "phone";
  if (/e-?mail/i.test(s)) return "email";
  if (/linkedin/i.test(s)) return "linkedin";
  if (/forename|first.?name|given.?name|surname|last.?name|family.?name/i.test(s)) return "contact";
  if (/business\s*name|company\s*name|trading|organisation|organization/i.test(s)) return "company";
  if (/^contact$/i.test(s) || /contact person|full.?name/i.test(s)) return "contact";
  if (/^company$|^business$/i.test(s)) return "company";
  return "";
}

function pickHeader(headers, re) {
  return (headers || []).find((h) => re.test(String(h || ""))) || "";
}

function parseSpreadsheetFile(file, onDone, onError) {
  const ext = String(file.name || "").split(".").pop().toLowerCase();
  if (ext === "csv") {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        onDone({ headers: results.meta.fields || [], records: results.data || [] });
      },
      error: (err) => onError(err.message || "Could not read CSV file"),
    });
    return;
  }
  if (ext === "xlsx" || ext === "xls") {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const records = XLSX.utils.sheet_to_json(sheet, { defval: "" });
        const headers = records.length ? Object.keys(records[0]) : [];
        onDone({ headers, records });
      } catch (_) {
        onError("Could not read spreadsheet — check the file isn't corrupted");
      }
    };
    reader.onerror = () => onError("Could not read file");
    reader.readAsArrayBuffer(file);
    return;
  }
  onError("Unsupported file type — upload a .csv, .xlsx, or .xls file");
}

function extraHeaders(fileHeaders) {
  const mapped = new Set((fileHeaders || []).map((h) => headerToField(h)).filter(Boolean));
  return EXTRA_SLOTS.filter((slot) => {
    const key = slot.toLowerCase() === "contact" ? "contact" : slot.toLowerCase();
    return !mapped.has(key);
  });
}

function rowFromRecord(headers, rec, i) {
  const nameH = pickHeader(headers, /business\s*name|company\s*name|trading name|organisation|organization/)
    || (headers || []).find((h) => /^(company|business)$/i.test(String(h || "").trim()))
    || (headers || []).find((h) => !junkCompanyHeader(h) && headerToField(h) === "company")
    || "";
  const phoneH = pickHeader(headers, /telephone|phone|mobile|\btel\b/) || "";
  const emailH = pickHeader(headers, /e-?mail/) || "";
  const webH = pickHeader(headers, /web\s*address|website|web\s*site|homepage|\burl\b/) || "";
  const liH = pickHeader(headers, /linkedin/) || "";
  const firstH = pickHeader(headers, /forename|first.?name|given.?name/) || "";
  const lastH = pickHeader(headers, /surname|last.?name|family.?name/) || "";
  const personH = pickHeader(headers, /^contact$|contact person|full.?name/) || "";
  const townH = pickHeader(headers, /^town$|^city$|locality/) || "";
  const postH = pickHeader(headers, /postcode|zip/) || "";
  const addrH = pickHeader(headers, /address line 1|^address$/) || "";
  const sectorH = pickHeader(headers, /sic desc|sector desc|industry/) || "";
  const company = String((nameH && rec[nameH]) || "").trim();
  const first = String((firstH && rec[firstH]) || "").trim();
  const last = String((lastH && rec[lastH]) || "").trim();
  const contact = [first, last].filter(Boolean).join(" ") || String((personH && rec[personH]) || "").trim();
  const website = normalizeWebsite((webH && rec[webH]) || "");
  return {
    id: "row_" + i,
    company,
    contact,
    name: company || contact || `Row ${i + 1}`,
    phone: String((phoneH && rec[phoneH]) || "").trim(),
    email: String((emailH && rec[emailH]) || "").trim(),
    website,
    linkedin: String((liH && rec[liH]) || "").trim(),
    town: String((townH && rec[townH]) || "").trim(),
    postcode: String((postH && rec[postH]) || "").trim(),
    address: String((addrH && rec[addrH]) || "").trim(),
    sector: String((sectorH && rec[sectorH]) || "").trim(),
    cells: rec,
    aiFields: {},
    callTimes: 0,
    lastOutcome: "",
  };
}

function missingKeys(r) {
  const miss = [];
  if (!String(r.phone || "").trim()) miss.push("phone");
  if (!String(r.email || "").trim()) miss.push("email");
  if (!String(r.website || "").trim()) miss.push("website");
  if (!String(r.linkedin || "").trim()) miss.push("linkedin");
  if (!String(r.contact || "").trim()) miss.push("contact");
  if (!String(r.company || "").trim()) miss.push("company");
  return miss;
}

function serializeForGaps(list) {
  return (list || []).map((r) => ({
    id: r.id,
    name: r.company || r.name || "",
    company: r.company || r.name || "",
    contact: r.contact || "",
    phone: r.phone || "",
    email: r.email || "",
    source: normalizeWebsite(r.website),
    website: normalizeWebsite(r.website),
    domain: normalizeWebsite(r.website),
    linkedin: looksLikeUrl(r.linkedin) ? r.linkedin : "",
    town: r.town || "",
    postcode: r.postcode || "",
    address: r.address || "",
    sector: r.sector || "",
  }));
}

function fillHasValue(fill) {
  if (!fill) return false;
  return Boolean(fill.phone || fill.email || fill.contact || fill.website || fill.source || fill.linkedin || fill.company);
}

function applyFill(r, fill) {
  if (!fill) return r;
  if (fill.status && fill.status !== "proposed" && !fillHasValue(fill)) return r;
  const next = { ...r, cells: { ...(r.cells || {}) }, aiFields: { ...(r.aiFields || {}) } };
  const take = (key, val) => {
    const cleaned = key === "website" ? normalizeWebsite(val) : val;
    if (!cleaned || String(next[key] || "").trim()) return;
    next[key] = cleaned;
    next.aiFields[key] = true;
    Object.keys(next.cells).forEach((h) => {
      if (headerToField(h) === key && !String(next.cells[h] || "").trim()) next.cells[h] = cleaned;
    });
  };
  take("phone", fill.phone);
  take("email", fill.email);
  take("contact", fill.contact);
  take("website", fill.website || fill.source);
  take("linkedin", fill.linkedin);
  if (!String(r.company || "").trim() && fill.company) {
    next.company = fill.company;
    next.name = fill.company;
    take("company", fill.company);
  }
  return next;
}

function cellHi(r, fieldKey) {
  return !!(r.aiFields && fieldKey && r.aiFields[fieldKey]);
}

function cellValue(r, h) {
  const raw = r.cells && r.cells[h];
  if (String(raw || "").trim()) return String(raw);
  const key = headerToField(h);
  return key ? String(r[key] || "") : "";
}

function extraValue(r, slot) {
  const key = slot.toLowerCase() === "contact" ? "contact" : slot.toLowerCase();
  return String(r[key] || "");
}

function liveActive(c) {
  const st = String(c.state || c.status || "").toLowerCase();
  return !c.ended && st !== "ended" && st !== "failed" && st !== "canceled";
}

function formatKind(m) {
  const fmt = String(m.format || "video");
  if (fmt === "phone") return { label: "Phone call", Icon: Phone, where: m.dialIn || m.phone || "Dial-in" };
  if (fmt === "in_person") return { label: "In person", Icon: MapPin, where: m.address || "Address TBD" };
  return { label: "Video call", Icon: Video, where: m.platform || "Video", link: m.videoLink || m.videoCallUrl || "" };
}

function loadAlerted() {
  try {
    return JSON.parse(localStorage.getItem(ALERT_KEY) || "[]");
  } catch (_) {
    return [];
  }
}

function saveAlerted(ids) {
  try { localStorage.setItem(ALERT_KEY, JSON.stringify(ids.slice(-200))); } catch (_) {}
}

function meetingDue(m) {
  const t = String(m.time || "").trim();
  const hm = t.match(/^(\d{1,2}):(\d{2})/);
  if (!hm) return false;
  const now = new Date();
  const due = new Date();
  due.setHours(Number(hm[1]), Number(hm[2]), 0, 0);
  const dateStr = String(m.date || m.prospectDate || "");
  if (dateStr && !/today/i.test(dateStr)) {
    const parsed = Date.parse(dateStr);
    if (!Number.isNaN(parsed)) {
      const d = new Date(parsed);
      due.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
    }
  }
  const diff = due.getTime() - now.getTime();
  return diff <= 60 * 1000 && diff > -15 * 60 * 1000;
}

function navBtn(active) {
  return {
    display: "flex",
    alignItems: "center",
    gap: 10,
    margin: "2px 4px",
    padding: "10px 12px",
    borderRadius: 10,
    border: "none",
    background: active ? "linear-gradient(135deg, #0C8C7D 0%, #0A6B60 100%)" : "transparent",
    color: "#fff",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
    textAlign: "left",
    boxShadow: active ? "0 6px 16px rgba(12,140,125,0.28)" : "none",
  };
}

function fieldStyle() {
  return {
    width: "100%",
    height: 40,
    borderRadius: 10,
    border: `1px solid ${C.border}`,
    padding: "0 12px",
    fontFamily: FONT_BODY,
    fontSize: 13,
    background: "#fff",
  };
}

function card() {
  return {
    background: "#fff",
    border: `1px solid ${C.border}`,
    borderRadius: 16,
    padding: 18,
    boxShadow: "0 8px 28px rgba(18,20,28,0.06)",
  };
}

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
  opacity: 0.75,
};

export function CallingWorkspace({
  operator,
  onBackToHub,
  onLogout,
  profile,
  setProfile,
  onUseClassic,
  commonAi,
  aiKeysPanel,
  onOpenCommonAi,
  companyPanel,
}) {
  const [page, setPage] = useState(() => {
    try {
      const hash = window.location.hash.replace(/^#\/?/, "");
      const parts = hash.split("/");
      if (parts[0] === "voice") {
        const next = callingPageId(parts[1]);
        if (next) return next;
      }
    } catch (_) {}
    return "list";
  });
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);
  const [concurrency, setConcurrency] = useState(1);
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState("");
  const [liveCalls, setLiveCalls] = useState([]);
  const [meetings, setMeetings] = useState([]);
  const [logs, setLogs] = useState([]);
  const [schedule, setSchedule] = useState([]);
  const [listeningId, setListeningId] = useState(null);
  const [takenId, setTakenId] = useState(null);
  const [endingId, setEndingId] = useState(null);
  const [voiceName, setVoiceName] = useState("rex");
  const [direct, setDirect] = useState({ phone: "", name: "" });
  const [plan, setPlan] = useState({ day: "", time: "10:00", prospect: "", phone: "", kind: "phone" });
  const [chat, setChat] = useState(() => {
    const saved = readJson(LS_CHAT, null);
    return cleanChat(saved);
  });
  const [threads, setThreads] = useState(() => readJson(LS_THREADS, []) || []);
  const [savedLists, setSavedLists] = useState(() => readJson(LS_LISTS, []) || []);
  const [histOpen, setHistOpen] = useState(false);
  const [hoverMsg, setHoverMsg] = useState("");
  const [editingId, setEditingId] = useState("");
  const [editText, setEditText] = useState("");
  const [copiedId, setCopiedId] = useState("");
  const [chatHint, setChatHint] = useState("");
  const [findProgress, setFindProgress] = useState(null);
  const [chatInput, setChatInput] = useState("");
  const [notifications, setNotifications] = useState(() => {
    const saved = readJson(LS_NOTES, []);
    return Array.isArray(saved) ? saved : [];
  });
  const [draft, setDraft] = useState({
    name: (profile && profile.name) || "",
    pitch: (profile && profile.pitch) || "",
    website: (profile && profile.website) || "",
    callerId: (profile && profile.callerId) || "",
    timezone: (profile && profile.timezone) || "Europe/London",
  });
  const fileRef = useRef(null);
  const playerRef = useRef(null);
  const lookupStop = useRef(false);
  const lookupAbortRef = useRef(null);
  const seenMeetings = useRef(new Set());
  const meetingsPrimed = useRef(false);
  const chatEnd = useRef(null);
  const chatHintTimer = useRef(null);
  const copiedTimer = useRef(null);
  const extras = useMemo(() => extraHeaders(headers), [headers]);

  const pushNote = (text, type) => {
    setNotifications((ns) => [{ id: "n_" + Date.now(), text, time: "just now", unread: true, type: type || "info" }, ...ns]);
  };

  useEffect(() => {
    try {
      const target = `#/voice/${page}`;
      if (window.location.hash !== target) window.history.replaceState(null, "", target);
    } catch (_) {}
  }, [page]);

  useEffect(() => {
    const onHash = () => {
      try {
        const hash = window.location.hash.replace(/^#\/?/, "");
        const parts = hash.split("/");
        if (parts[0] === "voice") {
          const next = callingPageId(parts[1]);
          if (next) setPage(next);
        }
      } catch (_) {}
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    setDraft({
      name: (profile && profile.name) || "",
      pitch: (profile && profile.pitch) || "",
      website: (profile && profile.website) || "",
      callerId: (profile && profile.callerId) || "",
      timezone: (profile && profile.timezone) || "Europe/London",
    });
  }, [profile]);

  useEffect(() => {
    api.getTelephonyHub().then((res) => {
      const vid = res?.voice?.voice_id;
      if (vid) setVoiceName(vid);
    }).catch(() => {});
    api.getNotifications().then((n) => {
      if (!Array.isArray(n) || !n.length) return;
      setNotifications((prev) => {
        const seen = new Set(prev.map((x) => x && x.id));
        const extra = n
          .filter((x) => x && x.id && !seen.has(x.id))
          .map((x) => ({ ...x, unread: x.unread !== false }));
        return extra.length ? [...extra, ...prev] : prev;
      });
    }).catch(() => {});
  }, []);

  const showToast = (t) => {
    setToast(t);
    window.setTimeout(() => setToast(""), 2800);
  };

  const showChatHint = (t) => {
    setChatHint(t);
    if (chatHintTimer.current) window.clearTimeout(chatHintTimer.current);
    chatHintTimer.current = window.setTimeout(() => setChatHint(""), 1800);
  };

  const refreshLive = useCallback(async () => {
    try {
      const data = await api.getLiveCalls();
      setLiveCalls(Array.isArray(data) ? data : data?.calls || []);
    } catch (_) {}
  }, []);

  const refreshMeetings = useCallback(async () => {
    try {
      const data = await api.getMeetings();
      const list = Array.isArray(data) ? data : data?.meetings || [];
      setMeetings(list);
      return list;
    } catch (_) {
      return [];
    }
  }, []);

  const refreshLogs = useCallback(async () => {
    try {
      const data = await api.getCallLogs();
      setLogs(Array.isArray(data) ? data : []);
    } catch (_) {}
  }, []);

  const refreshSchedule = useCallback(async () => {
    try {
      const data = await api.getSchedule();
      setSchedule(Array.isArray(data) ? data : []);
    } catch (_) {}
  }, []);

  useEffect(() => {
    refreshLive();
    refreshMeetings();
    refreshLogs();
    refreshSchedule();
    const t = window.setInterval(() => {
      refreshLive();
      refreshMeetings();
      if (page === "logs") refreshLogs();
      if (page === "schedule") refreshSchedule();
    }, 4000);
    return () => window.clearInterval(t);
  }, [page, refreshLive, refreshMeetings, refreshLogs, refreshSchedule]);

  useEffect(() => {
    const known = seenMeetings.current;
    if (!meetingsPrimed.current) {
      meetings.forEach((m) => m.id && known.add(m.id));
      meetingsPrimed.current = true;
      return;
    }
    meetings.forEach((m) => {
      if (!m.id || known.has(m.id)) return;
      known.add(m.id);
      const kind = formatKind(m);
      pushNote(`Added to schedule: ${m.prospect || "Meeting"} · ${kind.label}${kind.where ? " · " + kind.where : ""}`, "success");
    });
  }, [meetings]);

  useEffect(() => {
    const tick = () => {
      const alerted = loadAlerted();
      const next = [...alerted];
      meetings.forEach((m) => {
        if (!m.id || alerted.includes(m.id)) return;
        if (!meetingDue(m)) return;
        const kind = formatKind(m);
        pushNote(`Meeting now: ${m.prospect || "Meeting"} · ${kind.label} · ${kind.link || kind.where}`, "success");
        next.push(m.id);
      });
      if (next.length !== alerted.length) saveAlerted(next);
    };
    tick();
    const t = window.setInterval(tick, 20000);
    return () => window.clearInterval(t);
  }, [meetings]);

  useEffect(() => {
    return () => {
      if (playerRef.current) {
        try { playerRef.current.stopListening(); } catch (_) {}
        playerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (chatEnd.current) chatEnd.current.scrollIntoView({ behavior: "smooth" });
  }, [chat]);

  useEffect(() => { writeJson(LS_CHAT, chat); }, [chat]);
  useEffect(() => { writeJson(LS_THREADS, threads); }, [threads]);
  useEffect(() => { writeJson(LS_LISTS, savedLists); }, [savedLists]);
  useEffect(() => { writeJson(LS_NOTES, notifications); }, [notifications]);

  const abortFind = (hard) => {
    lookupStop.current = true;
    if (hard && lookupAbortRef.current) {
      try { lookupAbortRef.current.abort(); } catch (_) {}
    }
  };

  const archiveChat = () => {
    const userBits = chat.filter((m) => m.who === "user" && m.text);
    if (!userBits.length) return;
    const title = String(userBits[0].text || "").split("\n")[0].slice(0, 52);
    setThreads((ts) => [{ id: "t_" + Date.now(), title: title || "Chat", updatedAt: Date.now(), messages: chat }, ...ts].slice(0, 40));
  };

  const newChat = () => {
    archiveChat();
    setChat([WELCOME]);
    setHistOpen(false);
    setEditingId("");
    setHoverMsg("");
    setEditText("");
  };

  const tallyRow = (r, logRows) => {
    const d = digitsInPhone(r.phone);
    const names = [r.company, r.contact, r.name].map((x) => String(x || "").toLowerCase()).filter((n) => n.length > 3);
    const hits = (logRows || []).filter((l) => {
      const blob = `${l.canonicalName || ""} ${l.listedAs || ""} ${l.personListedAs || ""} ${l.mission || ""}`.toLowerCase();
      if (d && d.length >= 7 && blob.replace(/\D/g, "").includes(d.slice(-7))) return true;
      return names.some((n) => blob.includes(n.slice(0, 28)));
    });
    return { callTimes: hits.length, lastOutcome: hits[0] ? String(hits[0].outcome || "") : (r.lastOutcome || "") };
  };

  const saveList = () => {
    if (!rows.length) {
      showToast("Nothing to save.");
      return;
    }
    const item = {
      id: "list_" + Date.now(),
      name: fileName || "Untitled list",
      savedAt: new Date().toISOString(),
      headers,
      rows,
    };
    setSavedLists((prev) => [item, ...prev].slice(0, 20));
    showToast(`Saved ${rows.length} rows with call marks.`);
  };

  const loadList = (id) => {
    const item = savedLists.find((s) => s.id === id);
    if (!item) return;
    setFileName(item.name);
    setHeaders(item.headers || []);
    setRows(item.rows || []);
    showToast("Loaded " + item.name);
  };

  useEffect(() => {
    if (!logs.length || !rows.length) return;
    setRows((prev) => prev.map((r) => {
      const t = tallyRow(r, logs);
      if (t.callTimes === (r.callTimes || 0) && t.lastOutcome === (r.lastOutcome || "")) return r;
      return { ...r, ...t };
    }));
  }, [logs]);

  const mergeFills = (fills) => {
    if (!fills || !fills.length) return 0;
    let n = 0;
    setRows((prev) => prev.map((r) => {
      const fill = fills.find((f) => String(f.rowId || f.id) === String(r.id));
      if (!fill) return r;
      const next = applyFill(r, fill);
      if (next !== r) n += 1;
      return next;
    }));
    return n;
  };

  const onFile = (file) => {
    if (!file) return;
    parseSpreadsheetFile(
      file,
      ({ headers: hs, records }) => {
        setFileName(file.name);
        setHeaders(hs);
        setRows((records || []).map((rec, i) => rowFromRecord(hs, rec, i)));
        showToast(`${records.length} rows from file. Empty extra columns stay blank until Find missing.`);
      },
      (err) => showToast(err)
    );
  };

  const findMissing = async () => {
    const pool = rows.filter((r) => missingKeys(r).length && (r.company || r.contact || r.name));
    if (!pool.length) {
      showToast("Nothing missing on rows that have a name.");
      return;
    }
    lookupStop.current = false;
    setBusy("find");
    setFindProgress({ done: 0, total: pool.length, filled: 0, note: "Using company, town, person, and website from the file." });
    const CHUNK = 4;
    let proposed = 0;
    let empty = 0;
    try {
      for (let i = 0; i < pool.length; i += CHUNK) {
        if (lookupStop.current) break;
        const slice = pool.slice(i, i + CHUNK);
        const done = Math.min(i + slice.length, pool.length);
        setFindProgress({ done, total: pool.length, filled: proposed, note: slice.map((r) => r.company || r.name).filter(Boolean).join(" · ") });
        const controller = new AbortController();
        lookupAbortRef.current = controller;
        let res;
        try {
          res = await api.fillContactGaps(
            { contacts: serializeForGaps(slice), max_rows: CHUNK },
            { signal: controller.signal }
          );
        } catch (e) {
          if (lookupStop.current || (e && (e.name === "AbortError" || /aborted/i.test(e.message || "")))) break;
          throw e;
        }
        if (lookupStop.current) break;
        const fills = (res && res.fills) || [];
        const got = fills.filter((f) => f.status === "proposed" || fillHasValue(f)).length;
        proposed += got;
        empty += fills.filter((f) => f.status === "unenrichable").length;
        mergeFills(fills);
        setFindProgress({ done, total: pool.length, filled: proposed, note: `${got} of ${slice.length} filled this batch.` });
      }
      const stopped = lookupStop.current;
      const msg = stopped
        ? `Stopped. ${proposed} fill${proposed === 1 ? "" : "s"} applied so far.`
        : `Find missing finished. ${proposed} fill${proposed === 1 ? "" : "s"} from web search${empty ? `, ${empty} with no public phone/email/site` : ""}.`;
      setFindProgress({ done: pool.length, total: pool.length, filled: proposed, note: msg });
    } catch (e) {
      const err = e.message || "Find missing failed";
      if (!/aborted/i.test(err)) {
        showToast(err);
      }
    } finally {
      lookupAbortRef.current = null;
      setBusy("");
      window.setTimeout(() => setFindProgress((p) => (p && p.done === p.total ? null : p)), 8000);
    }
  };

  const sendChat = async (evt, override) => {
    if (evt && evt.preventDefault) evt.preventDefault();
    const text = String((override && override.text) || chatInput || "").trim();
    if (!text || busy === "chat" || busy === "find") return;
    if (!override) setChatInput("");
    setEditingId("");
    setHoverMsg("");
    const userMsg = { id: "c_" + Date.now(), who: "user", text };
    const replaceId = override && override.replaceFromId;
    const replaceIdx = replaceId ? chat.findIndex((m) => m.id === replaceId) : -1;
    const historySource = replaceIdx >= 0 ? chat.slice(0, replaceIdx) : chat;
    setChat((c) => {
      if (replaceId) {
        const idx = c.findIndex((m) => m.id === replaceId);
        const head = idx >= 0 ? c.slice(0, idx) : c;
        return [...head, userMsg];
      }
      return [...c, userMsg];
    });
    if (/\bfind missing\b|\bfill (the )?gaps\b|\blook up (the )?list\b/i.test(text)) {
      await findMissing();
      return;
    }
    setBusy("chat");
    try {
      const creds = getActiveAiCredentials(commonAi, "voice");
      const res = await api.copilotChat({
        message: text,
        history: [...historySource, userMsg].map((m) => ({ sender: m.who === "ai" ? "ai" : "user", text: m.text })),
        plugin: "voice",
        apiKey: creds.apiKey,
        provider: creds.provider,
        model: creds.model,
        baseUrl: creds.baseUrl,
        contacts: serializeForGaps(rows),
      });
      if (res && res.fills && res.fills.length) mergeFills(res.fills);
      if (res && res.leads && res.leads.length) {
        setRows((prev) => {
          const start = prev.length;
          const added = res.leads.map((lead, i) => ({
            id: "lead_" + Date.now() + "_" + i,
            company: lead.company || lead.name || "",
            contact: lead.contact || lead.person || "",
            name: lead.company || lead.name || `Lead ${start + i + 1}`,
            phone: lead.phone || "",
            email: lead.email || "",
            website: lead.website || lead.domain || "",
            linkedin: lead.linkedin || "",
            cells: {},
          }));
          if (!headers.length) setHeaders(["Company", "Contact", "Phone", "Email", "Website"]);
          return [...prev, ...added.map((r) => ({
            ...r,
            cells: { Company: r.company, Contact: r.contact, Phone: r.phone, Email: r.email, Website: r.website },
          }))];
        });
      }
      setChat((c) => [...c, { id: "c_" + Date.now(), who: "ai", text: (res && res.reply) || "Looked at that." }]);
    } catch (e) {
      setChat((c) => [...c, { id: "c_" + Date.now(), who: "ai", text: e.message || "Chat failed. Set keys in AI config." }]);
    } finally {
      setBusy("");
    }
  };

  const deleteMsg = (id) => {
    setChat((cs) => cs.filter((m) => m.id !== id));
    if (editingId === id) {
      setEditingId("");
      setEditText("");
    }
  };

  const saveEdit = (id) => {
    const next = editText.trim();
    if (!next) return;
    setChat((cs) => cs.map((m) => (m.id === id ? { ...m, text: next } : m)));
    setEditingId("");
    setEditText("");
  };

  const copyMsg = async (text, id) => {
    try {
      await navigator.clipboard.writeText(String(text || ""));
      setCopiedId(id || "");
      showChatHint("Copied");
      if (copiedTimer.current) window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopiedId(""), 1400);
    } catch (_) {
      showChatHint("Could not copy");
    }
  };

  const resendMsg = (m) => {
    const text = String((m && m.text) || "").trim();
    if (!text) return;
    sendChat(null, { text, replaceFromId: m.who === "user" ? m.id : undefined });
  };

  const startCalls = async () => {
    const prospects = rows
      .filter((r) => digitsInPhone(r.phone).length >= 7)
      .map((r) => ({
        to_number: r.phone,
        phone: r.phone,
        prospect_name: r.contact || r.name,
        name: r.company || r.name,
        contact: r.contact || r.name,
        website: r.website || "",
      }));
    if (!prospects.length) {
      showToast("No dialable phone numbers on this list.");
      return;
    }
    const cap = Math.max(1, Math.min(Number(concurrency) || 1, 5));
    if (!window.confirm(`Call ${prospects.length} contact${prospects.length === 1 ? "" : "s"} that already have a phone? Concurrent lines = ${cap} (not ${prospects.length}). Extra numbers wait for a free line.`)) {
      return;
    }
    setBusy("dial");
    try {
      const res = await api.dialOutboundBatch({
        prospects,
        concurrency: cap,
        mission_title: fileName ? `List — ${fileName}` : `Outbound list — ${prospects.length} contacts`,
        from_number: (profile && profile.callerId) || undefined,
        timezone: (profile && profile.timezone) || "Europe/London",
      });
      showToast(res.message || `Live outbound started for ${res.total} contacts.`);
      setPage("live");
      await refreshLive();
    } catch (e) {
      showToast(e.message || "Dial failed");
    } finally {
      setBusy("");
    }
  };

  const directCall = async () => {
    const phone = direct.phone.trim();
    if (digitsInPhone(phone).length < 7) {
      showToast("Enter a real phone number.");
      return;
    }
    setBusy("direct");
    try {
      await api.dialOutbound({
        to_number: phone,
        from_number: (profile && profile.callerId) || undefined,
        prospect_name: direct.name.trim() || undefined,
        mission_title: direct.name.trim() ? `Direct — ${direct.name.trim()}` : "Direct Client Outreach",
      });
      pushNote(`Outbound to ${phone}`, "success");
      setPage("live");
      await refreshLive();
    } catch (e) {
      showToast(e.message || "Direct dial failed");
    } finally {
      setBusy("");
    }
  };

  const stopListen = async (id) => {
    if (playerRef.current) {
      try { playerRef.current.stopListening(); } catch (_) {}
      playerRef.current = null;
    }
    setListeningId(null);
    setTakenId(null);
    if (id) {
      try { await api.toggleListen(id); } catch (_) {}
    }
  };

  const toggleListen = async (id) => {
    if (listeningId === id) {
      await stopListen(id);
      return;
    }
    if (playerRef.current) await stopListen(listeningId);
    const player = new AudioStreamPlayer(id, (status) => {
      if (!status.listening) {
        setListeningId(null);
        setTakenId(null);
      }
    }, () => {});
    player.startListening();
    playerRef.current = player;
    setListeningId(id);
    try { await api.toggleListen(id); } catch (_) {}
  };

  const toggleTakeover = async (id) => {
    if (takenId === id) {
      if (playerRef.current) {
        try { playerRef.current.stopMicrophone(); } catch (_) {}
      }
      setTakenId(null);
      try { await api.toggleTakeover(id); } catch (_) {}
      return;
    }
    if (listeningId !== id) await toggleListen(id);
    if (playerRef.current) {
      const ok = await playerRef.current.startMicrophone();
      if (!ok) {
        showToast("Microphone permission is required to speak on the call.");
        return;
      }
      setTakenId(id);
      try { await api.toggleTakeover(id); } catch (_) {}
    }
  };

  const endCall = async (id) => {
    try {
      await api.endLiveCall(id);
      if (listeningId === id) await stopListen(id);
      setEndingId(null);
      await refreshLive();
      await refreshLogs();
      pushNote("Call ended — saved to Logs.", "info");
    } catch (e) {
      showToast(e.message || "End failed");
    }
  };

  const bookMeeting = async (id) => {
    try {
      const res = await api.confirmBooking(id);
      showToast(res.message || "Meeting booked.");
      pushNote(res.message || "Meeting booked — added to Booked and Schedule.", "success");
      await refreshLive();
      await refreshMeetings();
      await refreshSchedule();
      await refreshLogs();
      setPage("booked");
    } catch (e) {
      showToast(e.message || "Book failed");
    }
  };

  const saveSetup = async () => {
    setBusy("save");
    try {
      if (!companyPanel) {
        const next = { ...(profile || {}), ...draft };
        await api.updateProfile(next);
        if (setProfile) setProfile(next);
      }
      await api.selectVoice({ voice_id: voiceName, label: voiceName === "rex" ? "Rex (Sam / male)" : voiceName, provider: "xai" });
      showToast(companyPanel ? "Voice saved." : "Setup saved.");
    } catch (e) {
      showToast(e.message || "Save failed");
    } finally {
      setBusy("");
    }
  };

  const savePlan = async () => {
    if (!plan.prospect.trim() || !plan.day.trim() || !plan.time.trim()) {
      showToast("Need name, day, and time.");
      return;
    }
    setBusy("plan");
    try {
      const kindLabel = plan.kind === "phone" ? "Phone callback" : plan.kind === "in_person" ? "In person" : "Video meeting";
      await api.createScheduleItem({
        day: plan.day.trim(),
        time: plan.time.trim(),
        prospect: plan.prospect.trim(),
        mission: plan.phone.trim() ? `${kindLabel} · ${plan.phone.trim()}` : kindLabel,
        window: `${profile?.weekdayStart || "09:00"}–${profile?.weekdayEnd || "17:30"}`,
        status: "queued",
        honored_quote: plan.phone.trim() || undefined,
      });
      pushNote(`Scheduled ${plan.kind === "phone" ? "call" : "meeting"} with ${plan.prospect} · ${plan.day} ${plan.time}`, "success");
      setPlan({ day: "", time: "10:00", prospect: "", phone: "", kind: "phone" });
      await refreshSchedule();
    } catch (e) {
      showToast(e.message || "Schedule failed");
    } finally {
      setBusy("");
    }
  };

  const activeLive = liveCalls.filter(liveActive);
  const dialable = rows.filter((r) => digitsInPhone(r.phone).length >= 7).length;
  const titles = {
    list: ["Today's list", "Upload, chat, or dial one number. Find missing uses the same search AI as classic."],
    live: ["Live calls", "Listen, take over, book from their words, or end. Transcript stays on the card."],
    booked: ["Booked", "Where, what kind, join URL. Bell fires when added and when time hits."],
    logs: ["Call logs", "Saved when a call ends or a meeting books. Same backend as classic."],
    schedule: ["Schedule a call", "Park a callback or meeting without an Excel list."],
    ai: ["AI config", "Keys for chat and Find missing. Voice model lives here."],
    company: ["Company profile", "Same profile classic uses on calls: identity, knowledge, services, FAQ."],
  };

  return (
    <div style={{ display: "flex", height: "100vh", background: "linear-gradient(180deg, #F3F1EB 0%, #EFEDE8 100%)", fontFamily: FONT_BODY }}>
      <AppChrome />
      <div style={{ width: 232, minWidth: 232, background: "linear-gradient(180deg, #12141C 0%, #1B1E29 100%)", height: "100vh", display: "flex", flexDirection: "column", padding: "18px 12px", boxSizing: "border-box" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 8px 16px" }}>
          <div style={{ width: 32, height: 32, borderRadius: 10, background: "linear-gradient(135deg, #0C8C7D, #3457D5)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 8px 18px rgba(12,140,125,0.35)" }}>
            <PhoneCall size={15} color="#fff" />
          </div>
          <div>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, color: "#fff" }}>Calling</div>
            <div style={{ fontSize: 10, color: "#8B90A0", fontWeight: 600, letterSpacing: "0.06em" }}>VOICE WORKSPACE</div>
          </div>
        </div>
        <button type="button" onClick={onBackToHub} style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 4px 12px", padding: "8px 10px", borderRadius: 8, border: `1px solid ${C.inkLine}`, background: "transparent", color: "#C8CCD6", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
          <LayoutGrid size={14} /> All plugins
        </button>
        {PAGES.map((p) => {
          const Icon = p.icon;
          return (
            <button key={p.id} type="button" onClick={() => setPage(p.id)} style={navBtn(page === p.id)}>
              <Icon size={15} />
              <span style={{ flex: 1 }}>{p.label}</span>
              {p.id === "live" && activeLive.length ? (
                <span style={{ minWidth: 18, height: 18, borderRadius: 99, background: "#fff", color: C.teal, fontSize: 10, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 5px" }}>
                  {activeLive.length}
                </span>
              ) : null}
            </button>
          );
        })}
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={() => {
            setCallingEdition("classic");
            try { window.history.replaceState(null, "", "#/voice/tasks"); } catch (_) {}
            if (onUseClassic) onUseClassic();
          }}
          style={{ display: "flex", alignItems: "center", gap: 8, margin: "8px 4px 4px", padding: "8px 10px", borderRadius: 8, border: "none", background: "transparent", color: "#C8CCD6", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
        >
          <History size={14} /> Use classic calling
        </button>
        <button type="button" onClick={onLogout} style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 4px", padding: "8px 10px", borderRadius: 8, border: "none", background: "transparent", color: "#8B90A0", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
          <LogOut size={14} /> Log out
        </button>
      </div>

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" }}>
        <style>{`
          .calling-scroll {
            overflow: auto;
            scrollbar-gutter: stable;
            scrollbar-width: thin;
            scrollbar-color: #3457D5 #E4E1D9;
          }
          .calling-scroll::-webkit-scrollbar { width: 12px; height: 12px; }
          .calling-scroll::-webkit-scrollbar-thumb {
            background: #3457D5;
            border-radius: 99px;
            border: 3px solid #F6F5F2;
          }
          .calling-scroll::-webkit-scrollbar-track { background: #E4E1D9; border-radius: 99px; }
        `}</style>
        <div style={{ padding: "16px 28px", borderBottom: `1px solid ${C.border}`, background: "rgba(255,255,255,0.9)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 22, color: C.textInk }}>{titles[page][0]}</div>
            <div style={{ fontSize: 13, color: C.slate, marginTop: 4 }}>{titles[page][1]}</div>
          </div>
          <NotificationBell notifications={notifications} setNotifications={setNotifications} />
        </div>

        {toast ? (
          <div style={{
            position: "absolute",
            top: 18,
            right: 84,
            zIndex: 40,
            padding: "7px 12px",
            borderRadius: 8,
            background: C.ink,
            color: "#fff",
            fontSize: 12,
            fontWeight: 600,
            boxShadow: "0 10px 28px rgba(18,20,28,0.18)",
            maxWidth: 260,
            pointerEvents: "none",
          }}>{toast}</div>
        ) : null}

        <div style={{ flex: 1, minHeight: 0, overflow: page === "list" ? "hidden" : "auto", padding: "18px 28px 28px", display: page === "list" ? "flex" : undefined, flexDirection: page === "list" ? "column" : undefined }}>
          {page === "list" && (
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 380px", gap: 16, flex: 1, minHeight: 0 }}>
              <div style={{ display: "flex", flexDirection: "column", minHeight: 0, minWidth: 0 }}>
                <div style={{ ...card(), marginBottom: 12, flexShrink: 0 }}>
                  <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, marginBottom: 10 }}>Call anyone</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <input value={direct.phone} onChange={(e) => setDirect((d) => ({ ...d, phone: e.target.value }))} placeholder="Phone" style={{ ...fieldStyle(), flex: 1, minWidth: 160 }} />
                    <input value={direct.name} onChange={(e) => setDirect((d) => ({ ...d, name: e.target.value }))} placeholder="Name (optional)" style={{ ...fieldStyle(), flex: 1, minWidth: 140 }} />
                    <button type="button" disabled={busy === "direct"} onClick={directCall} style={{ height: 40, padding: "0 16px", borderRadius: 10, border: "none", background: C.gradientTeal, color: "#fff", fontWeight: 700, cursor: "pointer" }}>
                      {busy === "direct" ? "Calling…" : "Call now"}
                    </button>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 8, flexShrink: 0 }}>
                  <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" hidden onChange={(e) => onFile(e.target.files && e.target.files[0])} />
                  <button type="button" onClick={() => fileRef.current && fileRef.current.click()} style={{ height: 40, padding: "0 14px", borderRadius: 10, border: `1px solid ${C.border}`, background: "#fff", fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
                    <Upload size={14} /> {fileName || "Upload CSV / Excel"}
                  </button>
                  <button type="button" disabled={!rows.length} onClick={saveList} style={{ height: 40, padding: "0 14px", borderRadius: 10, border: `1px solid ${C.border}`, background: "#fff", fontWeight: 700, cursor: rows.length ? "pointer" : "default" }}>
                    Save list
                  </button>
                  {savedLists.length ? (
                    <select defaultValue="" onChange={(e) => { if (e.target.value) loadList(e.target.value); e.target.value = ""; }} style={{ ...fieldStyle(), width: 180, height: 40 }}>
                      <option value="">Open saved list…</option>
                      {savedLists.map((s) => (
                        <option key={s.id} value={s.id}>{s.name} ({(s.rows || []).length})</option>
                      ))}
                    </select>
                  ) : null}
                  <label style={{ fontSize: 13, color: C.slate, display: "flex", alignItems: "center", gap: 8, fontWeight: 600 }}>
                    Concurrent lines
                    <select value={concurrency} onChange={(e) => setConcurrency(Number(e.target.value))} style={{ ...fieldStyle(), width: 72, height: 36 }}>
                      {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </label>
                  <button type="button" disabled={!rows.length || busy === "find"} onClick={findMissing} style={{ height: 40, padding: "0 14px", borderRadius: 10, border: "none", background: C.cobaltSoft, color: C.cobaltDeep, fontWeight: 700, cursor: rows.length ? "pointer" : "default" }}>
                    {busy === "find" ? (findProgress ? `Looking ${findProgress.done}/${findProgress.total}` : "Looking…") : "Find missing"}
                  </button>
                  {busy === "find" ? (
                    <>
                      <button type="button" onClick={() => abortFind(false)} style={{ height: 40, padding: "0 12px", borderRadius: 10, border: `1px solid ${C.border}`, background: "#fff", cursor: "pointer", fontWeight: 700 }}>Pause</button>
                      <button type="button" onClick={() => abortFind(true)} style={{ height: 40, padding: "0 12px", borderRadius: 10, border: "none", background: C.redSoft, color: C.red, cursor: "pointer", fontWeight: 700 }}>Stop</button>
                    </>
                  ) : null}
                  {dialable > 0 ? (
                    <button type="button" disabled={busy === "dial"} onClick={startCalls} title={`${dialable} of ${rows.length} rows have a dialable number. Concurrent lines is the dropdown, not this count.`} style={{ height: 40, padding: "0 16px", borderRadius: 10, border: "none", background: C.ink, color: "#fff", fontWeight: 700, cursor: "pointer" }}>
                      {busy === "dial" ? "Placing…" : `Call ${dialable} with phones`}
                    </button>
                  ) : null}
                </div>
                <div style={{ fontSize: 12, color: C.slateLight, marginBottom: 10, flexShrink: 0 }}>
                  {rows.length ? `${rows.length} rows · ${dialable} have a phone. Concurrent 1–5. Find missing uses Business Name + town + person + website from the file, then fills empty Email/LinkedIn/phone. Highlighted cells = newly found.` : "Cap 5 concurrent. Quality band, not a guarantee."}
                </div>

                {!rows.length ? (
                  <div style={{ ...card(), padding: 48, textAlign: "center", color: C.slate, flex: 1 }}>
                    No file yet. Call anyone above, ask chat to find a company, or upload a list.
                  </div>
                ) : (
                  <div className="calling-scroll" style={{ ...card(), padding: 0, flex: 1, minHeight: 180 }}>
                    <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12.5 }}>
                      <thead>
                        <tr>
                          {headers.map((h) => (
                            <th key={h} style={{ textAlign: "left", padding: "12px 14px", borderBottom: `1px solid ${C.border}`, color: C.slate, fontWeight: 700, whiteSpace: "nowrap", background: C.paperSoft, position: "sticky", top: 0, zIndex: 1 }}>{h}</th>
                          ))}
                          {extras.map((h) => (
                            <th key={"x_" + h} style={{ textAlign: "left", padding: "12px 14px", borderBottom: `1px solid ${C.border}`, color: C.slateLight, fontWeight: 700, whiteSpace: "nowrap", background: C.paperSoft, position: "sticky", top: 0, zIndex: 1 }}>{h}</th>
                          ))}
                          <th style={{ textAlign: "left", padding: "12px 14px", borderBottom: `1px solid ${C.border}`, color: C.slate, fontWeight: 700, whiteSpace: "nowrap", background: C.paperSoft, position: "sticky", top: 0, zIndex: 1 }}>Calls</th>
                          <th style={{ textAlign: "left", padding: "12px 14px", borderBottom: `1px solid ${C.border}`, color: C.slate, fontWeight: 700, whiteSpace: "nowrap", background: C.paperSoft, position: "sticky", top: 0, zIndex: 1 }}>Last verdict</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r) => (
                          <tr key={r.id}>
                            {headers.map((h) => {
                              const hi = cellHi(r, headerToField(h));
                              return (
                                <td key={h} style={{ padding: "10px 14px", borderBottom: `1px solid ${C.borderLight}`, color: C.textInk, background: hi ? C.tealSoft : undefined, fontWeight: hi ? 700 : 400 }}>{cellValue(r, h)}</td>
                              );
                            })}
                            {extras.map((h) => {
                              const key = h.toLowerCase() === "contact" ? "contact" : h.toLowerCase();
                              const hi = cellHi(r, key);
                              return (
                                <td key={"x_" + h} style={{ padding: "10px 14px", borderBottom: `1px solid ${C.borderLight}`, color: extraValue(r, h) ? C.textInk : C.slateLight, background: hi ? C.tealSoft : undefined, fontWeight: hi ? 700 : 400 }}>
                                  {extraValue(r, h)}
                                </td>
                              );
                            })}
                            <td style={{ padding: "10px 14px", borderBottom: `1px solid ${C.borderLight}`, fontWeight: 700 }}>{r.callTimes || 0}</td>
                            <td style={{ padding: "10px 14px", borderBottom: `1px solid ${C.borderLight}`, color: r.lastOutcome ? C.textInk : C.slateLight }}>{r.lastOutcome || "not called"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div style={{ ...card(), display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexShrink: 0 }}>
                  <Sparkles size={16} color={C.teal} />
                  <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, flex: 1 }}>List AI</div>
                  <button type="button" title="Chat history" onClick={() => setHistOpen((v) => !v)} style={{ height: 30, width: 30, borderRadius: 8, border: `1px solid ${C.border}`, background: histOpen ? C.ink : "#fff", color: histOpen ? "#fff" : C.slate, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <History size={14} />
                  </button>
                  <button type="button" title="New chat" onClick={newChat} style={{ height: 30, width: 30, borderRadius: 8, border: `1px solid ${C.border}`, background: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Plus size={14} />
                  </button>
                </div>
                {findProgress ? (
                  <div style={{ flexShrink: 0, marginBottom: 8, padding: "6px 8px", borderRadius: 8, background: C.paperSoft, border: `1px solid ${C.border}` }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: C.slate }}>{findProgress.done}/{findProgress.total} · {findProgress.filled} filled</div>
                    <div style={{ height: 3, background: "#fff", borderRadius: 99, marginTop: 5, overflow: "hidden" }}>
                      <div style={{ width: `${Math.round((findProgress.done / Math.max(findProgress.total, 1)) * 100)}%`, height: "100%", background: C.teal }} />
                    </div>
                  </div>
                ) : null}
                {histOpen ? (
                  <div className="calling-scroll" style={{ flex: 1, overflow: "auto", marginBottom: 10 }}>
                    {!(threads || []).length ? <div style={{ fontSize: 12, color: C.slateLight }}>No saved chats yet.</div> : threads.map((t) => (
                      <div key={t.id} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                        <button type="button" onClick={() => { archiveChat(); setChat(cleanChat(t.messages)); setHistOpen(false); setEditingId(""); setHoverMsg(""); }} style={{ flex: 1, textAlign: "left", border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 10px", background: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>{t.title}</button>
                        <button type="button" onClick={() => setThreads((ts) => ts.filter((x) => x.id !== t.id))} style={{ border: "none", background: "transparent", color: C.slate, cursor: "pointer" }}>×</button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="calling-scroll" style={{ flex: 1, overflowY: "scroll", minHeight: 0, marginBottom: 10, paddingTop: 16, paddingLeft: 4, paddingRight: 4 }}>
                    {chat.filter((m) => m && m.text && !isChatJunk(m)).map((m) => {
                      const mine = m.who === "user";
                      const editing = editingId === m.id;
                      const showActs = hoverMsg === m.id || copiedId === m.id;
                      const wrapCols = 38;
                      const lineGuess = String(editText || "").split("\n").reduce((n, line) => n + Math.max(1, Math.ceil((line.length || 1) / wrapCols)), 0);
                      const editRows = Math.min(12, Math.max(4, lineGuess + 1));
                      return (
                        <div
                          key={m.id}
                          onMouseEnter={() => setHoverMsg(m.id)}
                          onMouseLeave={() => setHoverMsg("")}
                          style={{ marginBottom: 12, display: "flex", flexDirection: "column", alignItems: mine ? "flex-end" : "flex-start", width: "100%" }}
                        >
                          {editing ? (
                            <div style={{
                              width: "100%",
                              boxSizing: "border-box",
                              background: "#fff",
                              border: `1px solid ${C.ink}`,
                              borderRadius: 14,
                              padding: "10px 12px 10px",
                              boxShadow: "0 10px 28px rgba(18,20,28,0.08)",
                            }}>
                              <textarea
                                autoFocus
                                value={editText}
                                onChange={(e) => setEditText(e.target.value)}
                                rows={editRows}
                                onKeyDown={(e) => {
                                  if (e.key === "Escape") {
                                    setEditingId("");
                                    setEditText("");
                                  }
                                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                                    e.preventDefault();
                                    if (mine) sendChat(null, { text: editText, replaceFromId: m.id });
                                    else saveEdit(m.id);
                                  }
                                }}
                                style={{
                                  width: "100%",
                                  border: "none",
                                  outline: "none",
                                  resize: "none",
                                  minHeight: 72,
                                  fontFamily: FONT_BODY,
                                  fontSize: 13,
                                  lineHeight: 1.5,
                                  color: C.textInk,
                                  background: "transparent",
                                  padding: 0,
                                  boxSizing: "border-box",
                                  overflow: "hidden",
                                }}
                              />
                              <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 10 }}>
                                <button
                                  type="button"
                                  onClick={() => { setEditingId(""); setEditText(""); }}
                                  style={{ height: 30, padding: "0 10px", borderRadius: 8, border: `1px solid ${C.border}`, background: "#fff", color: C.slate, fontSize: 12, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}
                                >
                                  <X size={12} /> Cancel
                                </button>
                                {mine ? (
                                  <button
                                    type="button"
                                    onClick={() => sendChat(null, { text: editText, replaceFromId: m.id })}
                                    style={{ height: 30, padding: "0 10px", borderRadius: 8, border: `1px solid ${C.border}`, background: "#fff", color: C.textInk, fontSize: 12, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}
                                  >
                                    <RotateCcw size={12} /> Resend
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  onClick={() => saveEdit(m.id)}
                                  style={{ height: 30, padding: "0 12px", borderRadius: 8, border: "none", background: C.ink, color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}
                                >
                                  <Check size={12} /> Save
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div style={{ maxWidth: "92%" }}>
                              <div style={{
                                padding: "8px 12px",
                                borderRadius: mine ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
                                background: mine ? C.ink : C.paperSoft,
                                color: mine ? "#fff" : C.textInk,
                                fontSize: 12.5,
                                lineHeight: 1.45,
                                whiteSpace: "pre-wrap",
                                overflowWrap: "anywhere",
                                wordBreak: "break-word",
                              }}>
                                {m.text}
                              </div>
                              {showActs ? (
                                <div style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 1,
                                  marginTop: 4,
                                  background: "#fff",
                                  border: `1px solid ${C.border}`,
                                  borderRadius: 8,
                                  padding: 2,
                                  boxShadow: "0 4px 12px rgba(18,20,28,0.10)",
                                  width: "fit-content",
                                }}>
                                  <button type="button" title="Edit" onClick={() => { setEditingId(m.id); setEditText(String(m.text || "")); }} style={{ ...iconMini, color: C.slate }}>
                                    <Pencil size={12} />
                                  </button>
                                  <button type="button" title="Delete" onClick={() => deleteMsg(m.id)} style={{ ...iconMini, color: C.slate }}>
                                    <Trash2 size={12} />
                                  </button>
                                  <button type="button" title="Copy" onClick={() => copyMsg(m.text, m.id)} style={{ ...iconMini, color: copiedId === m.id ? C.teal : C.slate, opacity: 1, minWidth: copiedId === m.id ? 58 : 26, fontSize: 10, fontWeight: 800, gap: 3 }}>
                                    {copiedId === m.id ? <><Check size={12} /> Copied</> : <Copy size={12} />}
                                  </button>
                                  <button type="button" title="Resend" onClick={() => resendMsg(m)} style={{ ...iconMini, color: C.slate }}>
                                    <RotateCcw size={12} />
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {busy === "chat" ? <div style={{ fontSize: 12, color: C.teal, fontWeight: 700 }}>Thinking…</div> : null}
                    <div ref={chatEnd} />
                  </div>
                )}
                <form onSubmit={(e) => { e.preventDefault(); sendChat(e); }} style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <input value={chatInput} onChange={(e) => setChatInput(e.target.value)} placeholder="Ask, name a company, or say find missing…" disabled={busy === "chat" || busy === "find"} style={{ ...fieldStyle(), flex: 1 }} />
                  <button type="submit" disabled={busy === "chat" || busy === "find" || !chatInput.trim()} style={{ height: 40, width: 44, border: "none", borderRadius: 10, background: C.teal, color: "#fff", cursor: "pointer" }}>
                    <Send size={14} />
                  </button>
                </form>
                {chatHint ? (
                  <div style={{ fontSize: 11, color: C.slate, fontWeight: 700, marginTop: 6, flexShrink: 0 }}>{chatHint}</div>
                ) : null}
              </div>
            </div>
          )}

          {page === "live" && (
            <div style={{ display: "grid", gap: 12 }}>
              {!activeLive.length ? (
                <div style={{ ...card(), padding: 48, textAlign: "center", color: C.slate }}>No live PSTN calls. Use Call now or a list.</div>
              ) : activeLive.map((c) => {
                const id = c.id || c.call_sid;
                const name = c.prospect || c.prospect_name || c.contact || c.name || "Unknown";
                const st = c.state || c.status || "calling";
                const lines = c.transcript || [];
                return (
                  <div key={id} style={{ ...card(), borderColor: takenId === id ? C.red : listeningId === id ? C.teal : C.border, borderWidth: 1.5 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
                      <div>
                        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18 }}>{name}</div>
                        <div style={{ fontSize: 12, color: C.slate, marginTop: 4 }}>{st} · {c.duration || ""} · {c.mission || ""}</div>
                      </div>
                      {takenId === id ? <span style={{ color: C.red, fontWeight: 800, fontSize: 11 }}>HUMAN DRIVING</span> : null}
                    </div>
                    <div style={{ background: C.paper, borderRadius: 10, padding: 10, marginTop: 12, maxHeight: 120, overflowY: "auto", fontFamily: FONT_MONO, fontSize: 11.5 }}>
                      {lines.length ? lines.map((line, i) => (
                        <div key={i} style={{ color: String(line).startsWith("AI") ? C.cobaltDeep : C.textInk, marginBottom: 4 }}>{typeof line === "string" ? line : `${line.who}: ${line.text}`}</div>
                      )) : <div style={{ color: C.slateLight }}>Waiting for speech…</div>}
                    </div>
                    {endingId === id ? (
                      <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center", background: C.redSoft, padding: 10, borderRadius: 10 }}>
                        <span style={{ flex: 1, fontSize: 13, color: C.red }}>End this call?</span>
                        <button type="button" onClick={() => setEndingId(null)} style={{ height: 32, padding: "0 10px", borderRadius: 8, border: `1px solid ${C.border}`, background: "#fff", cursor: "pointer" }}>Cancel</button>
                        <button type="button" onClick={() => endCall(id)} style={{ height: 32, padding: "0 10px", borderRadius: 8, border: "none", background: C.red, color: "#fff", cursor: "pointer", fontWeight: 700 }}>Confirm</button>
                      </div>
                    ) : (
                      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                        <button type="button" onClick={() => toggleListen(id)} style={{ height: 38, padding: "0 12px", borderRadius: 9, border: `1px solid ${C.border}`, background: listeningId === id ? C.tealSoft : "#fff", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontWeight: 700 }}>
                          <Headphones size={14} /> {listeningId === id ? "Stop listen" : "Listen"}
                        </button>
                        <button type="button" onClick={() => toggleTakeover(id)} style={{ height: 38, padding: "0 12px", borderRadius: 9, border: `1px solid ${C.border}`, background: takenId === id ? C.redSoft : "#fff", cursor: "pointer", fontWeight: 700 }}>
                          {takenId === id ? "Hand back to AI" : "Take over"}
                        </button>
                        <button type="button" onClick={() => bookMeeting(id)} style={{ height: 38, padding: "0 12px", borderRadius: 9, border: "none", background: C.green, color: "#fff", cursor: "pointer", fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
                          <Calendar size={14} /> Confirm meeting
                        </button>
                        <button type="button" onClick={() => setEndingId(id)} style={{ height: 38, padding: "0 12px", borderRadius: 9, border: "none", background: C.redSoft, color: C.red, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontWeight: 700 }}>
                          <PhoneOff size={14} /> End
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {page === "booked" && (
            <div style={{ display: "grid", gap: 12 }}>
              {!meetings.length ? (
                <div style={{ ...card(), padding: 48, textAlign: "center", color: C.slate }}>No bookings yet.</div>
              ) : meetings.map((m) => {
                const kind = formatKind(m);
                const Icon = kind.Icon;
                const when = meetingTimeLabel(m) || [m.date, m.time].filter(Boolean).join(" ");
                const join = kind.link;
                return (
                  <div key={m.id} style={card()}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17 }}>{m.prospect || m.attendee || "Meeting"}</div>
                      <span style={{ fontSize: 11, fontWeight: 800, color: C.teal, background: C.tealSoft, padding: "4px 8px", borderRadius: 999 }}>{m.status || "upcoming"}</span>
                    </div>
                    <div style={{ marginTop: 10, fontSize: 13, color: C.textInk, display: "grid", gap: 6 }}>
                      <div><Calendar size={13} style={{ verticalAlign: "middle" }} /> {when}</div>
                      <div><Icon size={13} style={{ verticalAlign: "middle" }} /> {kind.label} · {kind.where}</div>
                      {m.channel ? <div style={{ color: C.slate }}>Channel: {m.channel}</div> : null}
                      {m.host || m.attendee ? <div style={{ color: C.slate }}>{[m.host, m.attendee].filter(Boolean).join(" · ")}</div> : null}
                    </div>
                    {join ? (
                      <a href={/^https?:/i.test(join) ? join : "https://" + join} target="_blank" rel="noreferrer" style={{ display: "inline-block", marginTop: 12, color: C.cobalt, fontWeight: 700, fontSize: 13 }}>{join}</a>
                    ) : (
                      <div style={{ marginTop: 10, fontSize: 12, color: C.slateLight }}>No join URL yet.</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {page === "logs" && (
            <div style={{ display: "grid", gap: 10 }}>
              {!logs.length ? (
                <div style={{ ...card(), padding: 48, textAlign: "center", color: C.slate }}>No logs yet. Ended calls land here.</div>
              ) : logs.map((l) => (
                <div key={l.id} style={card()}>
                  <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700 }}>{l.canonicalName || l.listedAs || "Call"}</div>
                  <div style={{ fontSize: 12, color: C.slate, marginTop: 4 }}>{l.outcome || ""} · {l.duration || ""} · {l.startedAt || ""}</div>
                  <div style={{ marginTop: 8, fontFamily: FONT_MONO, fontSize: 11.5, color: C.textInk, maxHeight: 90, overflow: "auto" }}>
                    {(l.transcript || []).slice(0, 8).map((t, i) => (
                      <div key={i}>{typeof t === "string" ? t : `${t.who}: ${t.text}`}</div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {page === "schedule" && (
            <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 420px) 1fr", gap: 16 }}>
              <div style={card()}>
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, marginBottom: 12 }}>Park a call or meeting</div>
                <label style={{ fontSize: 12, fontWeight: 700, color: C.slate, display: "block", marginBottom: 10 }}>
                  Who
                  <input value={plan.prospect} onChange={(e) => setPlan((p) => ({ ...p, prospect: e.target.value }))} style={{ ...fieldStyle(), marginTop: 6 }} />
                </label>
                <label style={{ fontSize: 12, fontWeight: 700, color: C.slate, display: "block", marginBottom: 10 }}>
                  Phone (if calling)
                  <input value={plan.phone} onChange={(e) => setPlan((p) => ({ ...p, phone: e.target.value }))} style={{ ...fieldStyle(), marginTop: 6 }} />
                </label>
                <label style={{ fontSize: 12, fontWeight: 700, color: C.slate, display: "block", marginBottom: 10 }}>
                  Day
                  <input value={plan.day} onChange={(e) => setPlan((p) => ({ ...p, day: e.target.value }))} placeholder="Thu 18 Sep" style={{ ...fieldStyle(), marginTop: 6 }} />
                </label>
                <label style={{ fontSize: 12, fontWeight: 700, color: C.slate, display: "block", marginBottom: 10 }}>
                  Time
                  <input value={plan.time} onChange={(e) => setPlan((p) => ({ ...p, time: e.target.value }))} style={{ ...fieldStyle(), marginTop: 6 }} />
                </label>
                <label style={{ fontSize: 12, fontWeight: 700, color: C.slate, display: "block", marginBottom: 14 }}>
                  Kind
                  <select value={plan.kind} onChange={(e) => setPlan((p) => ({ ...p, kind: e.target.value }))} style={{ ...fieldStyle(), marginTop: 6 }}>
                    <option value="phone">Phone callback</option>
                    <option value="video">Video meeting</option>
                    <option value="in_person">In person</option>
                  </select>
                </label>
                <button type="button" disabled={busy === "plan"} onClick={savePlan} style={{ height: 40, border: "none", borderRadius: 10, background: C.ink, color: "#fff", fontWeight: 700, cursor: "pointer", width: "100%" }}>
                  {busy === "plan" ? "Saving…" : "Add to schedule"}
                </button>
              </div>
              <div style={{ display: "grid", gap: 10 }}>
                {!schedule.length ? (
                  <div style={{ ...card(), color: C.slate }}>Nothing queued.</div>
                ) : schedule.map((s) => (
                  <div key={s.id} style={card()}>
                    <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700 }}>{s.prospect}</div>
                    <div style={{ fontSize: 13, color: C.slate, marginTop: 4 }}>{s.day} {s.time} · {s.mission} · {s.status}</div>
                    {digitsInPhone(s.honoredQuote || s.mission || "").length >= 7 ? (
                      <button type="button" onClick={() => {
                        const raw = String(s.honoredQuote || s.mission || "");
                        const m = raw.match(/(\+?\d[\d\s().-]{6,}\d)/);
                        setDirect({ phone: (m && m[1]) || "", name: s.prospect });
                        setPage("list");
                      }} style={{ marginTop: 10, height: 34, padding: "0 12px", borderRadius: 8, border: "none", background: C.teal, color: "#fff", fontWeight: 700, cursor: "pointer" }}>Call this</button>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          )}

          {page === "ai" && (
            <div>
              {aiKeysPanel || (
                <div style={card()}>
                  <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, marginBottom: 8 }}>Open platform AI keys</div>
                  <div style={{ color: C.slate, fontSize: 13, marginBottom: 12 }}>Chat and Find missing use the Voice AI keys. Paste them in the common config.</div>
                  <button type="button" onClick={() => onOpenCommonAi && onOpenCommonAi()} style={{ height: 40, padding: "0 16px", border: "none", borderRadius: 10, background: C.ink, color: "#fff", fontWeight: 700, cursor: "pointer" }}>Open AI config</button>
                </div>
              )}
            </div>
          )}

          {page === "company" && (
            <div style={{ display: "grid", gap: 14 }}>
              <div style={{ ...card(), maxWidth: 520 }}>
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, marginBottom: 6 }}>Call voice</div>
                <div style={{ fontSize: 12, color: C.slate, marginBottom: 10 }}>Spoken name and pitch come from Company profile below. This only picks the voice.</div>
                <label style={{ fontSize: 12, fontWeight: 700, color: C.slate }}>
                  Voice
                  <select value={voiceName} onChange={(e) => setVoiceName(e.target.value)} style={{ ...fieldStyle(), marginTop: 6 }}>
                    <option value="rex">Rex — Sam (male)</option>
                    <option value="leo">Leo (male)</option>
                    <option value="ara">Ara (female)</option>
                    <option value="eve">Eve (female)</option>
                  </select>
                </label>
                <button type="button" disabled={busy === "save"} onClick={saveSetup} style={{ height: 42, border: "none", borderRadius: 10, background: C.ink, color: "#fff", fontWeight: 700, cursor: "pointer", width: 180, marginTop: 12 }}>
                  {busy === "save" ? "Saving…" : "Save voice"}
                </button>
              </div>
              {companyPanel || (
                <div style={{ ...card(), maxWidth: 520, display: "grid", gap: 12 }}>
                  {[
                    ["name", "Company name", "Saved company profile. Agent uses this on calls."],
                    ["pitch", "Pitch", draft.name ? `On calls, say “${draft.name}” as one word.` : "What you sell. Uses the saved Company Profile."],
                    ["website", "Website", "From Company Profile."],
                    ["callerId", "Caller ID", "Number shown to the prospect."],
                    ["timezone", "Timezone", "Call windows and meetings use this zone."],
                  ].map(([k, label, hint]) => (
                    <label key={k} style={{ fontSize: 12, fontWeight: 700, color: C.slate }}>
                      {label}
                      {k === "pitch" ? (
                        <textarea value={draft[k] || ""} onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))} rows={4} style={{ ...fieldStyle(), height: "auto", padding: 10, marginTop: 6, resize: "vertical" }} />
                      ) : (
                        <input value={draft[k] || ""} onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))} style={{ ...fieldStyle(), marginTop: 6 }} />
                      )}
                      <div style={{ fontWeight: 500, color: C.slateLight, marginTop: 4, fontSize: 11.5 }}>{hint}</div>
                    </label>
                  ))}
                  <button type="button" disabled={busy === "save"} onClick={saveSetup} style={{ height: 42, border: "none", borderRadius: 10, background: C.ink, color: "#fff", fontWeight: 700, cursor: "pointer", width: 160 }}>
                    {busy === "save" ? "Saving…" : "Save"}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
