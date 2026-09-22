import React, { cloneElement, isValidElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  Search,
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
  AlertTriangle,
  Users,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  Bookmark,
} from "lucide-react";
import { AppChrome } from "../components/AppChrome";
import { NotificationBell } from "../components/TopBar";
import { api } from "../api/apiClient";
import { WebSocketClient } from "../api/wsClient";
import { AudioStreamPlayer } from "../api/audioStreamPlayer";
import { C, FONT_BODY, FONT_DISPLAY, FONT_MONO, getActiveAiCredentials, logDisplayName, meetingTimeLabel, prependNotification, dedupeNotifications, callingPageFromTarget, resolveNotificationTarget } from "../tokens";
import { setCallingEdition } from "./callingEdition";
import { CallingSchedule } from "./CallingSchedule";
import { LiveKitBrowserCallModal } from "../components/LiveKitBrowserCallModal";

const PAGES = [
  { id: "list", label: "List", icon: List },
  { id: "live", label: "Live", icon: Radio },
  { id: "logs", label: "Call history", icon: FileText },
  { id: "schedule", label: "Schedule", icon: PhoneCall },
  { id: "ai", label: "AI config", icon: Plug },
  { id: "company", label: "Company", icon: Users },
];

const EXTRA_SLOTS = ["Phone", "Email", "Website", "LinkedIn", "Contact"];
const DEFAULT_LIST_HEADERS = ["Company", "Contact", "Phone", "Email", "Website", "LinkedIn"];
const SIMPLE_PAGES = new Set(PAGES.map((p) => p.id));
const MAX_CONCURRENT = 2;

const COUNTRY_CODES = [
  { code: "+44", country: "UK", initials: "UK, GB, GBR", flag: "🇬🇧", name: "United Kingdom" },
  { code: "+1", country: "US", initials: "US, USA", flag: "🇺🇸", name: "United States" },
  { code: "+1", country: "CA", initials: "CA, CAN", flag: "🇨🇦", name: "Canada" },
  { code: "+91", country: "IN", initials: "IN, IND", flag: "🇮🇳", name: "India" },
  { code: "+61", country: "AU", initials: "AU, AUS", flag: "🇦🇺", name: "Australia" },
  { code: "+49", country: "DE", initials: "DE, DEU", flag: "🇩🇪", name: "Germany" },
  { code: "+33", country: "FR", initials: "FR, FRA", flag: "🇫🇷", name: "France" },
  { code: "+34", country: "ES", initials: "ES, ESP", flag: "🇪🇸", name: "Spain" },
  { code: "+39", country: "IT", initials: "IT, ITA", flag: "🇮🇹", name: "Italy" },
  { code: "+31", country: "NL", initials: "NL, NLD", flag: "🇳🇱", name: "Netherlands" },
  { code: "+41", country: "CH", initials: "CH, CHE", flag: "🇨🇭", name: "Switzerland" },
  { code: "+353", country: "IE", initials: "IE, IRL", flag: "🇮🇪", name: "Ireland" },
  { code: "+971", country: "AE", initials: "AE, UAE", flag: "🇦🇪", name: "United Arab Emirates" },
  { code: "+65", country: "SG", initials: "SG, SGP", flag: "🇸🇬", name: "Singapore" },
  { code: "+64", country: "NZ", initials: "NZ, NZL", flag: "🇳🇿", name: "New Zealand" },
  { code: "+27", country: "ZA", initials: "ZA, ZAF", flag: "🇿🇦", name: "South Africa" },
  { code: "+55", country: "BR", initials: "BR, BRA", flag: "🇧🇷", name: "Brazil" },
  { code: "+81", country: "JP", initials: "JP, JPN", flag: "🇯🇵", name: "Japan" },
  { code: "+86", country: "CN", initials: "CN, CHN", flag: "🇨🇳", name: "China" },
  { code: "+852", country: "HK", initials: "HK, HKG", flag: "🇭🇰", name: "Hong Kong" },
  { code: "+966", country: "SA", initials: "SA, SAU, KSA", flag: "🇸🇦", name: "Saudi Arabia" },
  { code: "+974", country: "QA", initials: "QA, QAT", flag: "🇶🇦", name: "Qatar" },
  { code: "+965", country: "KW", initials: "KW, KWT", flag: "🇰🇼", name: "Kuwait" },
  { code: "+46", country: "SE", initials: "SE, SWE", flag: "🇸🇪", name: "Sweden" },
  { code: "+47", country: "NO", initials: "NO, NOR", flag: "🇳🇴", name: "Norway" },
  { code: "+45", country: "DK", initials: "DK, DNK", flag: "🇩🇰", name: "Denmark" },
  { code: "+358", country: "FI", initials: "FI, FIN", flag: "🇫🇮", name: "Finland" },
  { code: "+48", country: "PL", initials: "PL, POL", flag: "🇵🇱", name: "Poland" },
  { code: "+351", country: "PT", initials: "PT, PRT", flag: "🇵🇹", name: "Portugal" },
  { code: "+32", country: "BE", initials: "BE, BEL", flag: "🇧🇪", name: "Belgium" },
  { code: "+43", country: "AT", initials: "AT, AUT", flag: "🇦🇹", name: "Austria" },
  { code: "+30", country: "GR", initials: "GR, GRC", flag: "🇬🇷", name: "Greece" },
  { code: "+90", country: "TR", initials: "TR, TUR", flag: "🇹🇷", name: "Turkey" },
  { code: "+52", country: "MX", initials: "MX, MEX", flag: "🇲🇽", name: "Mexico" },
  { code: "+54", country: "AR", initials: "AR, ARG", flag: "🇦🇷", name: "Argentina" },
  { code: "+56", country: "CL", initials: "CL, CHL", flag: "🇨🇱", name: "Chile" },
  { code: "+57", country: "CO", initials: "CO, COL", flag: "🇨🇴", name: "Colombia" },
  { code: "+60", country: "MY", initials: "MY, MYS", flag: "🇲🇾", name: "Malaysia" },
  { code: "+62", country: "ID", initials: "ID, IDN", flag: "🇮🇩", name: "Indonesia" },
  { code: "+63", country: "PH", initials: "PH, PHL", flag: "🇵🇭", name: "Philippines" },
  { code: "+66", country: "TH", initials: "TH, THA", flag: "🇹🇭", name: "Thailand" },
  { code: "+84", country: "VN", initials: "VN, VNM", flag: "🇻🇳", name: "Vietnam" },
  { code: "+82", country: "KR", initials: "KR, KOR", flag: "🇰🇷", name: "South Korea" },
  { code: "+972", country: "IL", initials: "IL, ISR", flag: "🇮🇱", name: "Israel" },
  { code: "+20", country: "EG", initials: "EG, EGY", flag: "🇪🇬", name: "Egypt" },
  { code: "+234", country: "NG", initials: "NG, NGA", flag: "🇳🇬", name: "Nigeria" },
  { code: "+254", country: "KE", initials: "KE, KEN", flag: "🇰🇪", name: "Kenya" },
  { code: "+92", country: "PK", initials: "PK, PAK", flag: "🇵🇰", name: "Pakistan" },
  { code: "+880", country: "BD", initials: "BD, BGD", flag: "🇧🇩", name: "Bangladesh" },
  { code: "+94", country: "LK", initials: "LK, LKA", flag: "🇱🇰", name: "Sri Lanka" },
  { code: "+380", country: "UA", initials: "UA, UKR", flag: "🇺🇦", name: "Ukraine" },
  { code: "+420", country: "CZ", initials: "CZ, CZE", flag: "🇨🇿", name: "Czechia" },
  { code: "+40", country: "RO", initials: "RO, ROU", flag: "🇷🇴", name: "Romania" },
  { code: "+36", country: "HU", initials: "HU, HUN", flag: "🇭🇺", name: "Hungary" },
];

function blankListRow(index = 0) {
  const cells = {};
  DEFAULT_LIST_HEADERS.forEach((h) => { cells[h] = ""; });
  return {
    id: "row_" + Date.now() + "_" + index + "_" + Math.random().toString(36).slice(2, 6),
    company: "",
    contact: "",
    name: `Row ${index + 1}`,
    phone: "",
    email: "",
    website: "",
    linkedin: "",
    town: "",
    postcode: "",
    address: "",
    sector: "",
    cells,
    aiFields: {},
    callTimes: 0,
    lastOutcome: "",
  };
}

function parseNewListName(text) {
  const s = String(text || "");
  const m = s.match(/\b(?:new|start|create|blank|clear)\s+(?:a\s+|the\s+)?list(?:\s+(?:called|named|titled|:)\s*|\s+)["']?([^"'.\n?!]{2,60})["']?/i);
  if (m && m[1]) {
    const name = m[1].trim().replace(/\s+/g, " ");
    if (!/^(from|with|and|for|please|now|here)$/i.test(name)) return name;
  }
  return "";
}

function isNewListCommand(text) {
  return /\b((new|start|create|blank)\s+(a\s+|the\s+)?list|clear\s+(the\s+)?list|start\s+(a\s+)?fresh\s+list)\b/i.test(String(text || ""));
}

function callingPageId(raw) {
  const id = String(raw || "");
  if (id === "setup") return "company";
  if (id === "booked" || id === "meetings") return "schedule";
  if (id === "calllog" || id === "history") return "logs";
  if (id === "tasks" || id === "prospects" || id === "contacts") return "list";
  return SIMPLE_PAGES.has(id) ? id : "";
}
const ALERT_KEY = "aivhub_meeting_alerted";
const LS_CHAT = "aivhub_calling_v1_chat";
const LS_THREADS = "aivhub_calling_v1_threads";
const LS_LISTS = "aivhub_calling_saved_lists";
const LS_NOTES = "aivhub_calling_v1_notes";
const LS_CONTACTS = "aivhub_calling_saved_contacts";
const WELCOME = {
  id: "c0",
  who: "ai",
  text: "Start a new list (say “new list” or use New list), add rows by hand, or ask me to find companies on the web. Find missing fills empty cells from public search — no invented numbers. Save list anytime.",
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

function coercePhoneCell(v) {
  if (v == null || v === "") return "";
  if (typeof v === "number" && Number.isFinite(v)) {
    // Excel stores long phones as numbers — avoid "4.47e+11"
    return String(Math.trunc(v));
  }
  let s = String(v).trim();
  if (/e[+-]?\d+$/i.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n)) s = String(Math.trunc(n));
  }
  return s;
}

function isPhoneHeader(h) {
  return /telephone|phone|mobile|\btel\b|cell\b|whatsapp|msisdn|dial/i.test(String(h || ""));
}

function phoneHeaders(headers) {
  return (headers || []).filter((h) => isPhoneHeader(h));
}

/** Prefer the phone column that actually has dialable values (not an empty "Telephone" before "Mobile Phone"). */
function pickBestPhoneHeader(headers, records) {
  const cands = phoneHeaders(headers);
  if (!cands.length) return "";
  let best = cands[0];
  let bestScore = -1;
  cands.forEach((h) => {
    let score = 0;
    (records || []).slice(0, 80).forEach((rec) => {
      if (digitsInPhone(coercePhoneCell(rec && rec[h])).length >= 7) score += 1;
    });
    if (score > bestScore) {
      bestScore = score;
      best = h;
    }
  });
  return best;
}

function extractPhoneFromRecord(headers, rec) {
  if (!rec) return "";
  const ordered = [];
  const bestH = pickBestPhoneHeader(headers, [rec]);
  if (bestH) ordered.push(bestH);
  phoneHeaders(headers).forEach((h) => { if (!ordered.includes(h)) ordered.push(h); });
  let best = "";
  ordered.forEach((h) => {
    const v = coercePhoneCell(rec[h]);
    const d = digitsInPhone(v);
    if (d.length >= 7 && d.length >= digitsInPhone(best).length) best = v;
  });
  if (best) return best;
  // Last resort: any cell that looks like an international / mobile number
  Object.keys(rec).forEach((h) => {
    if (headerToField(h) === "email" || headerToField(h) === "website" || headerToField(h) === "linkedin") return;
    const v = coercePhoneCell(rec[h]);
    const d = digitsInPhone(v);
    if (d.length >= 10 && d.length <= 15 && d.length >= digitsInPhone(best).length) best = v;
  });
  return best;
}

/** Live resolve — also fixes older rows where phone stayed empty while Mobile Phone cell had the number. */
function rowPhone(r) {
  if (!r) return "";
  const direct = coercePhoneCell(r.phone);
  if (digitsInPhone(direct).length >= 7) return direct;
  const cells = r.cells || {};
  let best = "";
  Object.keys(cells).forEach((h) => {
    if (!isPhoneHeader(h) && headerToField(h) !== "phone") return;
    const v = coercePhoneCell(cells[h]);
    if (digitsInPhone(v).length >= 7 && digitsInPhone(v).length >= digitsInPhone(best).length) best = v;
  });
  if (best) return best;
  Object.keys(cells).forEach((h) => {
    if (headerToField(h) === "email" || headerToField(h) === "website" || headerToField(h) === "linkedin") return;
    const v = coercePhoneCell(cells[h]);
    const d = digitsInPhone(v);
    if (d.length >= 10 && d.length <= 15 && d.length >= digitsInPhone(best).length) best = v;
  });
  return best;
}

function ensureRowPhone(r) {
  if (!r) return r;
  const p = rowPhone(r);
  if (!p || p === r.phone) return r;
  return { ...r, phone: p };
}

function intlDigits(raw) {
  let d = digitsInPhone(raw);
  if (!d) return "";
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("440") && d.length >= 13) d = "44" + d.slice(3);
  if (d.length === 11 && d.startsWith("0")) d = "44" + d.slice(1);
  else if (d.length === 10 && d.startsWith("7")) d = "44" + d;
  return d;
}

function outreachMessage(name, company, caller) {
  const first = String(name || "").trim().split(/\s+/)[0] || "there";
  const who = caller || company || "our team";
  const brand = company || "AIVHub";
  return `Hi ${first}, this is ${who} from ${brand}. Just reaching out — happy to chat when you have a moment.`;
}

function smsHref(phone, body) {
  const d = intlDigits(phone);
  if (!d) return "";
  return `sms:+${d}?body=${encodeURIComponent(body || "")}`;
}

function waHref(phone, body) {
  const d = intlDigits(phone);
  if (!d) return "";
  return `https://wa.me/${d}?text=${encodeURIComponent(body || "")}`;
}

function looksLikeUrl(v) {
  const s = String(v || "").trim();
  if (!s) return false;
  return /^https?:\/\//i.test(s) || /^www\./i.test(s) || (/^[a-z0-9.-]+\.[a-z]{2,}/i.test(s) && !/\s/.test(s));
}

function isJunkWebsite(v) {
  const s = String(v || "").trim().toLowerCase();
  if (!s) return true;
  return /bing\.com|google\.|duckduckgo|yahoo\.com\/search|yandex\.|baidu\.com|facebook\.com|twitter\.com|(^|[/.])x\.com([/.]|$)|instagram\.com|youtube\.com|youtu\.be|reddit\.com|wikipedia\.|linkedin\.com|schema\.org|w3\.org|microsoft\.com|office\.com/.test(s);
}

function normalizeWebsite(v) {
  const s = String(v || "").trim();
  if (!s || /public web search/i.test(s)) return "";
  if (isJunkWebsite(s)) return "";
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      const host = (u.hostname || "").replace(/^www\./i, "").toLowerCase();
      if (!host || isJunkWebsite(host) || isJunkWebsite(u.hostname)) return "";
      return `${u.protocol}//${u.hostname}`;
    } catch (_) {
      return "";
    }
  }
  if (/^www\./i.test(s) || (/^[a-z0-9.-]+\.[a-z]{2,}/i.test(s) && !/\s/.test(s))) {
    const cleaned = s.replace(/^\/+/, "").split(/[\/\s?]/)[0];
    if (isJunkWebsite(cleaned)) return "";
    return "https://" + cleaned;
  }
  return "";
}

function junkCompanyHeader(h) {
  const s = String(h || "");
  return /^(urn|id|ref|#)$/i.test(s.trim())
    || /sic|sector|tps|ctps|employee|postcode|address|telephone|phone|web |website|contact\s*name|forename|surname|title|position|email|linkedin/i.test(s);
}

function headerToField(h) {
  const s = String(h || "");
  if (/web\s*address|website|web\s*site|homepage|\burl\b/i.test(s) && !/linkedin/i.test(s)) return "website";
  if (/telephone|phone|mobile|\btel\b|cell\b/i.test(s)) return "phone";
  if (/e-?mail/i.test(s)) return "email";
  if (/linkedin/i.test(s)) return "linkedin";
  if (/forename|first.?name|given.?name|surname|last.?name|family.?name/i.test(s)) return "contact";
  if (/contact\s*name|prospect\s*name|full\s*name|person\s*name|^name$/i.test(s)) return "contact";
  if (/business\s*name|company\s*name|trading|organisation|organization/i.test(s)) return "company";
  if (/^contact$/i.test(s) || /contact person/i.test(s)) return "contact";
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
  const phoneH = pickBestPhoneHeader(headers, [rec]) || pickHeader(headers, /telephone|phone|mobile|\btel\b|cell\b/) || "";
  const emailH = pickHeader(headers, /e-?mail/) || "";
  const webH = pickHeader(headers, /web\s*address|website|web\s*site|homepage|\burl\b/) || "";
  const liH = pickHeader(headers, /linkedin/) || "";
  const firstH = pickHeader(headers, /forename|first.?name|given.?name/) || "";
  const lastH = pickHeader(headers, /surname|last.?name|family.?name/) || "";
  const personH = pickHeader(headers, /contact\s*name|prospect\s*name|full.?name|^contact$|contact person|^name$/i) || "";
  const townH = pickHeader(headers, /^town$|^city$|locality/) || "";
  const postH = pickHeader(headers, /postcode|zip/) || "";
  const addrH = pickHeader(headers, /address line 1|^address$/) || "";
  const sectorH = pickHeader(headers, /sic desc|sector desc|industry/) || "";
  let company = String((nameH && rec[nameH]) || "").trim();
  const first = String((firstH && rec[firstH]) || "").trim();
  const last = String((lastH && rec[lastH]) || "").trim();
  let contact = [first, last].filter(Boolean).join(" ") || String((personH && rec[personH]) || "").trim();
  // If spreadsheet only has a person column labeled oddly, keep it as contact — never as company.
  if (!contact && company && /^[A-Z][a-z]+(?:\s+[A-Z][a-z'’-]+){1,3}$/.test(company) && !/\b(ltd|limited|llc|inc|plc|gmbh|corp|company|group)\b/i.test(company)) {
    contact = company;
    company = "";
  }
  const website = normalizeWebsite((webH && rec[webH]) || "");
  const linkedinRaw = String((liH && rec[liH]) || "").trim();
  const linkedin = looksLikeUrl(linkedinRaw) || /linkedin\.com/i.test(linkedinRaw)
    ? (normalizeWebsite(linkedinRaw) || linkedinRaw)
    : linkedinRaw;
  const phone = extractPhoneFromRecord(headers, rec) || coercePhoneCell(phoneH && rec[phoneH]);
  return {
    id: "row_" + i,
    company,
    contact,
    name: company || contact || `Row ${i + 1}`,
    phone,
    email: String((emailH && rec[emailH]) || "").trim(),
    website,
    linkedin,
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

function emailLooksPlausible(email, person) {
  const em = String(email || "").trim().toLowerCase();
  if (!em || !em.includes("@")) return false;
  const [local, domain] = em.split("@");
  if (!local || !domain || !domain.includes(".")) return false;
  const free = /^(gmail|googlemail|yahoo|hotmail|outlook|live|icloud|me|aol|mail|protonmail|proton|gmx)\./i.test(domain)
    || /^(gmail|googlemail|yahoo|hotmail|outlook|live|icloud|me|aol|mail|protonmail|proton|gmx)\.com$/i.test(domain);
  if (!free) return true;
  const parts = String(person || "").toLowerCase().match(/[a-z]+/g) || [];
  const localC = local.replace(/[^a-z0-9]/g, "");
  if (parts.length >= 2) {
    const first = parts[0];
    const last = parts[parts.length - 1];
    if (first.length >= 2 && last.length >= 2 && localC.includes(first) && localC.includes(last)) return true;
  }
  return false;
}

function missingKeys(r) {
  const miss = [];
  if (digitsInPhone(rowPhone(r)).length < 7) miss.push("phone");
  if (!String(r.email || "").trim() || !emailLooksPlausible(r.email, r.contact || r.name)) miss.push("email");
  if (!String(r.website || "").trim() || isJunkWebsite(r.website)) miss.push("website");
  if (!String(r.linkedin || "").trim()) miss.push("linkedin");
  if (!String(r.contact || "").trim()) miss.push("contact");
  if (!String(r.company || "").trim()) miss.push("company");
  return miss;
}

function serializeForGaps(list) {
  return (list || []).map((r) => {
    const company = String(r.company || "").trim();
    const contact = String(r.contact || "").trim();
    const display = company || contact || String(r.name || "").trim();
    return {
      id: r.id,
      name: display,
      company: company || "",
      contact: contact || (company ? "" : display),
      phone: rowPhone(r) || r.phone || "",
      email: emailLooksPlausible(r.email, r.contact || r.name) ? (r.email || "") : "",
      source: normalizeWebsite(r.website),
      website: normalizeWebsite(r.website),
      domain: normalizeWebsite(r.website),
      linkedin: looksLikeUrl(r.linkedin) || /linkedin\.com/i.test(String(r.linkedin || ""))
        ? (normalizeWebsite(r.linkedin) || String(r.linkedin || "").trim())
        : "",
      town: r.town || "",
      postcode: r.postcode || "",
      address: r.address || "",
      sector: r.sector || "",
    };
  });
}

function fillHasValue(fill) {
  if (!fill) return false;
  return Boolean(fill.phone || fill.email || fill.contact || fill.website || fill.source || fill.linkedin || fill.company);
}

function applyFill(r, fill) {
  if (!fill) return r;
  if (fill.status && fill.status !== "proposed" && !fillHasValue(fill)) return r;
  const next = { ...r, cells: { ...(r.cells || {}) }, aiFields: { ...(r.aiFields || {}) } };
  if (isJunkWebsite(next.website)) {
    next.website = "";
    Object.keys(next.cells).forEach((h) => {
      if (headerToField(h) === "website") next.cells[h] = "";
    });
  }
  if (next.email && !emailLooksPlausible(next.email, next.contact || next.name || r.contact || r.name)) {
    next.email = "";
    Object.keys(next.cells).forEach((h) => {
      if (headerToField(h) === "email") next.cells[h] = "";
    });
  }
  const take = (key, val) => {
    let cleaned = val;
    if (key === "website" || key === "linkedin") cleaned = normalizeWebsite(val) || "";
    else if (key === "email") {
      cleaned = String(val || "").trim();
      if (cleaned && !emailLooksPlausible(cleaned, next.contact || next.name || r.contact || r.name)) cleaned = "";
    } else cleaned = String(val || "").trim();
    if (!cleaned) return;
    const existing = String(next[key] || "").trim();
    if (existing && !(key === "website" && isJunkWebsite(existing)) && !(key === "email" && !emailLooksPlausible(existing, next.contact || next.name))) return;
    next[key] = cleaned;
    next.aiFields[key] = true;
    Object.keys(next.cells).forEach((h) => {
      if (headerToField(h) === key && (
        !String(next.cells[h] || "").trim()
        || (key === "website" && isJunkWebsite(next.cells[h]))
        || (key === "email" && !emailLooksPlausible(next.cells[h], next.contact || next.name))
      )) {
        next.cells[h] = cleaned;
      }
    });
  };
  take("phone", fill.phone);
  take("email", fill.email);
  take("contact", fill.contact);
  take("website", fill.website || (isJunkWebsite(fill.source) ? "" : fill.source));
  take("linkedin", fill.linkedin);
  if (!String(r.company || "").trim() && fill.company) {
    next.company = fill.company;
    next.name = fill.company;
    next.aiFields.company = true;
    Object.keys(next.cells).forEach((h) => {
      if (headerToField(h) === "company" && !String(next.cells[h] || "").trim()) next.cells[h] = fill.company;
    });
  }
  if (!String(next.name || "").trim() || /^Row\s+\d+$/i.test(next.name)) {
    next.name = next.company || next.contact || next.name;
  }
  return next;
}

function cellHi(r, fieldKey) {
  return !!(r.aiFields && fieldKey && r.aiFields[fieldKey]);
}

function linkCell(value, kind) {
  const v = String(value || "").trim();
  if (!v) return null;
  let href = "";
  if (kind === "email" && v.includes("@")) href = `mailto:${v}`;
  else if (kind === "website" || kind === "linkedin") {
    href = /^https?:\/\//i.test(v) ? v : `https://${v.replace(/^\/+/, "")}`;
  }
  if (!href) return v;
  const label = v.replace(/^https?:\/\//i, "").replace(/\/$/, "");
  const shown = label.length > 48 ? `${label.slice(0, 46)}…` : label;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      title={v}
      style={{ color: C.cobalt, fontWeight: 700, textDecoration: "underline", wordBreak: "break-all" }}
    >
      {shown}
    </a>
  );
}

function cellValue(r, h) {
  const raw = r.cells && r.cells[h];
  const key = headerToField(h);
  const text = String(raw || "").trim() || (key ? String(r[key] || "") : "");
  if (!text) return "";
  if (key === "website" || key === "linkedin" || key === "email") {
    return linkCell(text, key) || text;
  }
  if (looksLikeUrl(text) && /web|site|url|linkedin/i.test(String(h || ""))) {
    return linkCell(text, /linkedin/i.test(String(h || "")) ? "linkedin" : "website") || text;
  }
  return text;
}

function extraValue(r, slot) {
  const key = slot.toLowerCase() === "contact" ? "contact" : slot.toLowerCase();
  const text = String(r[key] || "");
  if (!text) return "";
  if (key === "website" || key === "linkedin" || key === "email") {
    return linkCell(text, key) || text;
  }
  return text;
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
    background: active ? "linear-gradient(135deg, #3457D5 0%, #26409E 100%)" : "transparent",
    color: "#fff",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
    textAlign: "left",
    boxShadow: active ? "0 6px 16px rgba(52,87,213,0.32)" : "none",
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

function miniAct() {
  return {
    height: 28,
    padding: "0 8px",
    borderRadius: 7,
    border: `1px solid ${C.border}`,
    background: "#fff",
    fontSize: 11,
    fontWeight: 700,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    color: C.textInk,
    whiteSpace: "nowrap",
  };
}

function savedTwilioCreds() {
  try {
    const sid = (localStorage.getItem("aivhub_twilio_sid") || "").trim();
    const token = (localStorage.getItem("aivhub_twilio_token") || "").trim();
    return {
      account_sid: sid.startsWith("AC") && sid.length === 34 ? sid : undefined,
      api_key: token.length === 32 ? token : undefined,
    };
  } catch (_) {
    return {};
  }
}

function voiceSelectLabel(id) {
  if (id === "rex-uk") return "Rex UK — Sam (British, male)";
  if (id === "rex") return "Rex — Sam (male)";
  if (id === "leo") return "Leo (male)";
  if (id === "ara-uk") return "Ara UK (British, female)";
  if (id === "eve-uk") return "Eve UK (British, female)";
  if (id === "ara") return "Ara (female)";
  if (id === "eve") return "Eve (female)";
  return id;
}

function voiceAccentFor(id) {
  return String(id || "").includes("-uk") || String(id || "").includes("_uk") ? "british" : undefined;
}

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
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState("");
  const [liveCalls, setLiveCalls] = useState([]);
  const [meetings, setMeetings] = useState([]);
  const [logs, setLogs] = useState([]);
  const [schedule, setSchedule] = useState([]);
  const [scheduleFocus, setScheduleFocus] = useState(""); // "list" opens booked list inside Schedule
  const [companyDirty, setCompanyDirty] = useState(false);
  const [unsavedLeaveTarget, setUnsavedLeaveTarget] = useState(null);
  const [listeningId, setListeningId] = useState(null);
  const [takenId, setTakenId] = useState(null);
  const [endingId, setEndingId] = useState(null);
  const [voiceName, setVoiceName] = useState("ara-uk");
  const [direct, setDirect] = useState({ phone: "", name: "" });
  const [liveKitModalOpen, setLiveKitModalOpen] = useState(false);
  const [liveKitTarget, setLiveKitTarget] = useState({ name: "Browser Caller", phone: "Browser WebRTC", company: "" });
  const [logQuery, setLogQuery] = useState("");
  const [logOutcome, setLogOutcome] = useState("all");
  const [openLogId, setOpenLogId] = useState("");
  const [chat, setChat] = useState(() => {
    const saved = readJson(LS_CHAT, null);
    return cleanChat(saved);
  });
  const [threads, setThreads] = useState(() => readJson(LS_THREADS, []) || []);
  const [savedLists, setSavedLists] = useState(() => readJson(LS_LISTS, []) || []);
  const [savedContacts, setSavedContacts] = useState(() => readJson(LS_CONTACTS, []) || []);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
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
    return dedupeNotifications(Array.isArray(saved) ? saved : []);
  });
  const [draft, setDraft] = useState({
    name: (profile && profile.name) || "",
    pitch: (profile && profile.pitch) || "",
    website: (profile && profile.website) || "",
    callerId: (profile && profile.callerId) || "",
    timezone: (profile && profile.timezone) || "Europe/London",
  });
  const fileRef = useRef(null);
  const [countryCode, setCountryCode] = useState(() => {
    try {
      return localStorage.getItem("aivhub_dial_country_code") || "+44";
    } catch (_) {
      return "+44";
    }
  });
  const [countryMenuOpen, setCountryMenuOpen] = useState(false);
  const [countrySearch, setCountrySearch] = useState("");
  const countryDropdownRef = useRef(null);
  const countrySearchInputRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);
  const playerRef = useRef(null);
  const lookupStop = useRef(false);
  const lookupAbortRef = useRef(null);
  const seenMeetings = useRef(new Set());
  const meetingsPrimed = useRef(false);
  const chatEnd = useRef(null);
  const chatHintTimer = useRef(null);
  const copiedTimer = useRef(null);
  const extras = useMemo(() => extraHeaders(headers), [headers]);

  const activeCountryObj = useMemo(() => {
    return COUNTRY_CODES.find((c) => c.code === countryCode) || {
      code: countryCode,
      flag: "🌐",
      country: "",
      name: "",
    };
  }, [countryCode]);

  const filteredCountries = useMemo(() => {
    const q = countrySearch.trim().toLowerCase();
    if (!q) return COUNTRY_CODES;
    const cleanNum = q.replace(/^\+/, "").trim();

    return COUNTRY_CODES.map((c) => {
      let score = 0;
      const codeDigits = c.code.replace("+", "");
      const lowerCountry = c.country.toLowerCase();
      const lowerName = c.name.toLowerCase();
      const lowerInitials = (c.initials || "").toLowerCase();

      // 1. Exact initial match e.g. "uk" == "uk" or token in initials
      if (lowerCountry === q) {
        score += 1200;
      } else if (lowerInitials.split(/[,\s]+/).includes(q)) {
        score += 1000;
      }
      // 2. Exact phone prefix match e.g. "44" or "+44"
      if (cleanNum && codeDigits === cleanNum) {
        score += 900;
      }
      // 3. Country code starts with number
      if (cleanNum && codeDigits.startsWith(cleanNum)) {
        score += 800;
      }
      // 4. Initial starts with query
      if (lowerCountry.startsWith(q)) {
        score += 700;
      } else if (lowerInitials.split(/[,\s]+/).some((t) => t.startsWith(q))) {
        score += 650;
      }
      // 5. Name starts with query
      if (lowerName.startsWith(q)) {
        score += 600;
      }
      // 6. Name includes query
      else if (lowerName.includes(q)) {
        score += 400;
      }
      // 7. Initials includes query
      else if (lowerInitials.includes(q)) {
        score += 300;
      }

      return { ...c, _score: score };
    })
      .filter((c) => c._score > 0)
      .sort((a, b) => b._score - a._score);
  }, [countrySearch]);

  const selectCountry = (c) => {
    setCountryCode(c.code);
    try { localStorage.setItem("aivhub_dial_country_code", c.code); } catch (_) {}
    if (direct.phone && !direct.phone.startsWith("+")) {
      const clean = direct.phone.replace(/^0+/, "").trim();
      setDirect((d) => ({ ...d, phone: clean ? `${c.code} ${clean}` : "" }));
    }
    setCountryMenuOpen(false);
    setCountrySearch("");
  };

  useEffect(() => {
    if (countryMenuOpen && countrySearchInputRef.current) {
      const timer = window.setTimeout(() => {
        if (countrySearchInputRef.current) countrySearchInputRef.current.focus();
      }, 50);
      return () => window.clearTimeout(timer);
    }
  }, [countryMenuOpen]);

  useEffect(() => {
    if (!countryMenuOpen) return;
    const handleOutsideClick = (e) => {
      if (countryDropdownRef.current && !countryDropdownRef.current.contains(e.target)) {
        setCountryMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", handleOutsideClick);
    return () => window.removeEventListener("mousedown", handleOutsideClick);
  }, [countryMenuOpen]);

  const pushNote = (text, type, extra = {}) => {
    const base = { ...(extra || {}) };
    if (!base.targetView) {
      const r = resolveNotificationTarget({ text, ...base });
      base.targetView = r.targetView;
      if (r.targetExtra && Object.keys(r.targetExtra).length) base.targetExtra = r.targetExtra;
    }
    setNotifications((ns) => prependNotification(ns, text, type || "info", base));
  };

  const onNotificationNavigate = (noteOrView, maybeMeta) => {
    let page = "";
    let targetView = "";
    if (maybeMeta && maybeMeta.page) {
      page = maybeMeta.page;
      targetView = maybeMeta.targetView || "";
    } else if (typeof noteOrView === "object" && noteOrView) {
      const r = resolveNotificationTarget(noteOrView);
      targetView = r.targetView;
      page = callingPageFromTarget(r.targetView);
    } else if (typeof noteOrView === "string") {
      targetView = noteOrView;
      page = callingPageFromTarget(noteOrView);
    }
    if (targetView === "meetings" || targetView === "booked" || page === "booked") {
      setScheduleFocus("list");
      page = "schedule";
    }
    if (page && SIMPLE_PAGES.has(page)) goPage(page);
  };

  const goPage = (next) => {
    if (!next || next === page) return;
    if (page === "company" && companyDirty && next !== "company") {
      setUnsavedLeaveTarget({ type: "page", next });
      return;
    }
    setPage(next);
  };

  const handleLeaveConfirm = () => {
    const t = unsavedLeaveTarget;
    setCompanyDirty(false);
    setUnsavedLeaveTarget(null);
    if (!t) return;
    if (t.type === "page") setPage(t.next);
    else if (t.type === "hub") onBackToHub();
    else if (t.type === "classic") {
      setCallingEdition("classic");
      try { window.history.replaceState(null, "", "#/voice/list"); } catch (_) {}
      if (onUseClassic) onUseClassic();
    }
  };

  const handleSaveAndLeaveWorkspace = () => {
    const t = unsavedLeaveTarget;
    try {
      window.dispatchEvent(new CustomEvent("aivhub_save_company"));
    } catch (_) {}
    setCompanyDirty(false);
    setUnsavedLeaveTarget(null);
    if (!t) return;
    setTimeout(() => {
      if (t.type === "page") setPage(t.next);
      else if (t.type === "hub") onBackToHub();
      else if (t.type === "classic") {
        setCallingEdition("classic");
        try { window.history.replaceState(null, "", "#/voice/list"); } catch (_) {}
        if (onUseClassic) onUseClassic();
      }
    }, 200);
  };

  useEffect(() => {
    try {
      localStorage.setItem("aivhub_voice_view", page);
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
          const next = callingPageId(parts[1]) || "list";
          if (next) goPage(next);
        }
      } catch (_) {}
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [page, companyDirty]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onSwitchView = (e) => {
      if (e && e.detail) {
        const next = callingPageId(e.detail) || (e.detail === "list" ? "list" : "");
        if (next) goPage(next);
      }
    };
    window.addEventListener("aivhub_set_voice_view", onSwitchView);
    return () => window.removeEventListener("aivhub_set_voice_view", onSwitchView);
  }, [page, companyDirty]); // eslint-disable-line react-hooks/exhaustive-deps

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
      const vid = res?.voiceName || res?.voice?.voice_id;
      if (vid) setVoiceName(vid);
      const phone = (res?.phoneNumber || "").trim();
      if (phone && setProfile) {
        setProfile((p) => (p && p.callerId ? p : { ...(p || {}), callerId: phone }));
      }
    }).catch(() => {});
    // Push browser Twilio vault → server Connections so classic + new share one source of truth.
    const tw = savedTwilioCreds();
    if (tw.account_sid && tw.api_key) {
      api.testAndSaveConnection({
        layer: "Telephony",
        provider: "Twilio",
        api_key: tw.api_key,
        account_sid: tw.account_sid,
      }).catch(() => {});
    }
    api.getNotifications().then((n) => {
      if (!Array.isArray(n) || !n.length) return;
      setNotifications((prev) => {
        const seen = new Set(prev.map((x) => x && x.id));
        const seenText = new Set(prev.map((x) => String(x && x.text || "").trim().toLowerCase()));
        const extra = n
          .filter((x) => x && x.id && !seen.has(x.id))
          .filter((x) => {
            const t = String(x.text || "").trim().toLowerCase();
            if (!t || seenText.has(t)) return false;
            seenText.add(t);
            return true;
          })
          .map((x) => ({ ...x, unread: x.unread !== false }));
        return dedupeNotifications(extra.length ? [...extra, ...prev] : prev);
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

  const formatLiveDuration = useCallback((totalSecs) => {
    const secs = Math.max(0, Math.floor(Number(totalSecs) || 0));
    const mm = Math.floor(secs / 60);
    const ss = secs % 60;
    return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  }, []);

  const withLiveClock = useCallback((list, { bump = false } = {}) => {
    const now = Date.now();
    return (Array.isArray(list) ? list : []).map((c) => {
      if (!c || c.ended || ["ended", "failed", "canceled"].includes(String(c.state || "").toLowerCase())) return c;
      if (c.startedAt) {
        const startMs = new Date(c.startedAt).getTime();
        if (!Number.isNaN(startMs)) {
          return { ...c, duration: formatLiveDuration((now - startMs) / 1000) };
        }
      }
      if (!bump) return c;
      const currentDur = c.duration || "00:00";
      if (!String(currentDur).includes(":")) return c;
      const [mm, ss] = String(currentDur).split(":").map((n) => parseInt(n, 10) || 0);
      return { ...c, duration: formatLiveDuration(mm * 60 + ss + 1) };
    });
  }, [formatLiveDuration]);

  const refreshLive = useCallback(async () => {
    try {
      const data = await api.getLiveCalls();
      const list = Array.isArray(data) ? data : data?.calls || [];
      setLiveCalls(withLiveClock(list));
    } catch (_) {}
  }, [withLiveClock]);

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

    // Instant refresh when user switches back to the tab
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshLive();
        if (page === "meetings") refreshMeetings();
        if (page === "logs") refreshLogs();
        if (page === "schedule") refreshSchedule();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onVisibilityChange);

    // Fallback sync: WebSockets deliver instant updates for active calls/meetings.
    // Periodic background sync runs gently every 15s rather than spamming every 2s.
    const t = window.setInterval(() => {
      refreshLive();
      if (page === "meetings") refreshMeetings();
      if (page === "logs") refreshLogs();
      if (page === "schedule") refreshSchedule();
    }, 15000);

    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onVisibilityChange);
    };
  }, [page, refreshLive, refreshMeetings, refreshLogs, refreshSchedule]);

  // Instant live-board updates (don't wait for poll / dial HTTP return)
  useEffect(() => {
    let ws = null;
    const onEvt = (msg) => {
      if (!msg || !msg.type) return;
      const t = msg.type;
      if (["call_started", "call_created", "call_updated", "call_ended", "call_removed", "calls_cleared", "booking_confirmed"].includes(t)) {
        refreshLive();
      }
      if (["call_ended", "booking_confirmed"].includes(t)) {
        refreshLogs();
        refreshMeetings();
      }
      // Optimistic insert when WS payload already has enough to paint a card
      if ((t === "call_started" || t === "call_created") && msg.data) {
        const d = msg.data;
        const id = d.callId || d.id;
        if (!id) return;
        setLiveCalls((prev) => {
          if ((prev || []).some((c) => c.id === id || String(c.id || "").startsWith("pending_"))) {
            // Replace pending placeholder with real id when possible
            const withoutPending = (prev || []).filter((c) => !String(c.id || "").startsWith("pending_") || c.id === id);
            if (withoutPending.some((c) => c.id === id)) return withoutPending;
            return [
              {
                id,
                prospect: d.prospect || d.caller || "Outbound",
                mission: d.mission || "Direct Outbound Outreach",
                state: d.state || "calling",
                duration: d.duration || "00:00",
                channel: d.channel || "voice",
                ended: false,
                transcript: [],
                startedAt: new Date().toISOString(),
              },
              ...withoutPending,
            ];
          }
          return [
            {
              id,
              prospect: d.prospect || d.caller || "Outbound",
              mission: d.mission || "Direct Outbound Outreach",
              state: d.state || "calling",
              duration: d.duration || "00:00",
              channel: d.channel || "voice",
              ended: false,
              transcript: [],
              startedAt: new Date().toISOString(),
            },
            ...(prev || []),
          ];
        });
      }
    };
    try {
      ws = new WebSocketClient(null, onEvt);
    } catch (e) {
      console.warn("[CallingWorkspace] WS init:", e);
    }
    return () => {
      try { if (ws) ws.close(); } catch (_) {}
    };
  }, [refreshLive, refreshLogs, refreshMeetings]);

  // Live call clock: tick every second (API refresh alone was ~4s)
  useEffect(() => {
    const ticker = window.setInterval(() => {
      setLiveCalls((prev) => withLiveClock(prev, { bump: true }));
    }, 1000);
    return () => window.clearInterval(ticker);
  }, [withLiveClock]);

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
  useEffect(() => { writeJson(LS_CONTACTS, savedContacts); }, [savedContacts]);
  useEffect(() => { writeJson(LS_NOTES, dedupeNotifications(notifications)); }, [notifications]);

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
    const d = digitsInPhone(rowPhone(r));
    const names = [r.company, r.contact, r.name].map((x) => String(x || "").toLowerCase()).filter((n) => n.length > 3);
    const hits = (logRows || []).filter((l) => {
      const blob = `${logDisplayName(l)} ${l.canonicalName || ""} ${l.listedAs || ""} ${l.personListedAs || ""} ${l.mission || ""}`.toLowerCase();
      if (d && d.length >= 7 && blob.replace(/\D/g, "").includes(d.slice(-7))) return true;
      return names.some((n) => blob.includes(n.slice(0, 28)));
    });
    return { callTimes: hits.length, lastOutcome: hits[0] ? String(hits[0].outcome || "") : (r.lastOutcome || "") };
  };

  const saveList = () => {
    if (!rows.length) {
      showToast("Nothing to save — add a row or ask chat for leads first.");
      return;
    }
    const suggested = fileName || "Untitled list";
    let name = suggested;
    try {
      const typed = window.prompt("Name for this list", suggested);
      if (typed === null) return;
      name = String(typed || "").trim() || suggested;
    } catch (_) {}
    const item = {
      id: "list_" + Date.now(),
      name,
      savedAt: new Date().toISOString(),
      headers: headers.length ? headers : DEFAULT_LIST_HEADERS,
      rows,
    };
    setFileName(name);
    setSavedLists((prev) => [item, ...prev.filter((s) => s.name !== name)].slice(0, 20));
    showToast(`Saved “${name}” · ${rows.length} rows.`);
  };

  const newList = ({ name, confirm = true, silent = false } = {}) => {
    if (confirm && rows.length) {
      const ok = window.confirm("Start a blank list? Unsaved rows on the current list will be cleared from this view (saved lists stay).");
      if (!ok) return false;
    }
    const label = String(name || "").trim() || `List ${new Date().toLocaleDateString("en-GB")}`;
    setFileName(label);
    setHeaders([...DEFAULT_LIST_HEADERS]);
    setRows([]);
    setSelectedIds(new Set());
    if (fileRef.current) fileRef.current.value = "";
    if (!silent) showToast(`New list: ${label}`);
    return true;
  };

  const addRow = () => {
    if (!headers.length) setHeaders([...DEFAULT_LIST_HEADERS]);
    setRows((prev) => {
      const next = [...prev, blankListRow(prev.length)];
      return next;
    });
    showToast("Row added — type into the cells.");
  };

  const removeRow = (id) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
    setSelectedIds((prev) => {
      const n = new Set(prev);
      n.delete(id);
      return n;
    });
  };

  const patchRowField = (id, field, raw) => {
    const val = String(raw || "");
    setRows((prev) => prev.map((r) => {
      if (r.id !== id) return r;
      const next = { ...r, cells: { ...(r.cells || {}) }, aiFields: { ...(r.aiFields || {}) } };
      let cleaned = val;
      if (field === "website" || field === "linkedin") cleaned = normalizeWebsite(val) || val.trim();
      else if (field === "phone") cleaned = coercePhoneCell(val) || val.trim();
      else cleaned = val.trim();
      next[field] = cleaned;
      if (field === "company" || field === "contact") {
        next.name = (field === "company" ? cleaned : next.company) || (field === "contact" ? cleaned : next.contact) || next.name;
      }
      if (next.aiFields) delete next.aiFields[field];
      const hs = headers.length ? headers : DEFAULT_LIST_HEADERS;
      hs.forEach((h) => {
        if (headerToField(h) === field) next.cells[h] = cleaned;
      });
      // Keep canonical cell keys for manual lists
      const canon = { company: "Company", contact: "Contact", phone: "Phone", email: "Email", website: "Website", linkedin: "LinkedIn" };
      if (canon[field]) next.cells[canon[field]] = cleaned;
      return ensureRowPhone(next);
    }));
  };

  const upsertSavedContact = (entry) => {
    const phone = String(entry.phone || "").trim();
    const dig = digitsInPhone(phone);
    if (dig.length < 7) {
      showToast("Need a real phone to save.");
      return false;
    }
    const next = {
      id: entry.id || ("sc_" + Date.now() + "_" + dig.slice(-4)),
      phone,
      name: String(entry.name || entry.contact || "").trim(),
      company: String(entry.company || "").trim(),
      email: String(entry.email || "").trim(),
      savedAt: new Date().toISOString(),
      source: entry.source || "manual",
    };
    setSavedContacts((prev) => {
      const without = (prev || []).filter((c) => digitsInPhone(c.phone) !== dig);
      return [next, ...without].slice(0, 200);
    });
    return true;
  };

  const resolveDirectPhone = () => {
    let phone = (direct.phone || "").trim();
    if (!phone) return "";
    if (phone.startsWith("+")) return phone;
    const cleanDigits = phone.replace(/^0+/, "").replace(/\D/g, "");
    return cleanDigits ? `${countryCode}${cleanDigits}` : phone;
  };

  const saveDirectContact = () => {
    const fullPhone = resolveDirectPhone();
    if (!upsertSavedContact({
      phone: fullPhone || direct.phone,
      name: direct.name,
      source: "direct",
    })) return;
    showToast(`Saved ${direct.name.trim() || fullPhone || direct.phone.trim()}`);
  };

  const saveSelectedContacts = () => {
    const picks = rows.filter((r) => selectedIds.has(r.id) && digitsInPhone(rowPhone(r)).length >= 7);
    if (!picks.length) {
      showToast("Select rows with a phone first.");
      return;
    }
    picks.forEach((r) => upsertSavedContact({
      phone: rowPhone(r),
      name: r.contact || r.name || "",
      company: r.company || "",
      email: r.email || "",
      source: "list",
    }));
    showToast(`Saved ${picks.length} contact${picks.length === 1 ? "" : "s"}.`);
  };

  const removeSavedContact = (id) => {
    setSavedContacts((prev) => (prev || []).filter((c) => c.id !== id));
  };

  const loadSavedContact = (c) => {
    const raw = c.phone || "";
    setDirect({ phone: raw, name: c.name || c.company || "" });
    if (raw.startsWith("+")) {
      const match = [...COUNTRY_CODES].sort((a, b) => b.code.length - a.code.length).find((item) => raw.startsWith(item.code));
      if (match) {
        setCountryCode(match.code);
        try { localStorage.setItem("aivhub_dial_country_code", match.code); } catch (_) {}
      }
    }
    showToast("Loaded into Call anyone.");
  };

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllDialable = () => {
    setSelectedIds(new Set(rows.filter((r) => digitsInPhone(rowPhone(r)).length >= 7).map((r) => r.id)));
  };

  const clearSelection = () => setSelectedIds(new Set());

  const brandForMsg = () => (profile && (profile.name || profile.company)) || "AIVHub";
  const callerForMsg = () => (profile && profile.callerName) || "";

  const openChannel = (kind, phone, name, company) => {
    const dig = digitsInPhone(phone);
    if (dig.length < 7) {
      showToast("No usable phone on this row.");
      return;
    }
    const body = outreachMessage(name, company || brandForMsg(), callerForMsg());
    if (kind === "sms") {
      const href = smsHref(phone, body);
      if (href) window.open(href, "_blank");
      return;
    }
    if (kind === "whatsapp") {
      const href = waHref(phone, body);
      if (href) window.open(href, "_blank");
      return;
    }
  };

  const callOneRow = async (r) => {
    const phone = String(rowPhone(r) || "").trim();
    if (digitsInPhone(phone).length < 7) {
      showToast("No dialable phone.");
      return;
    }
    const prospectLabel = (r.contact || r.name || "").trim() || phone;
    const optimisticId = `pending_${Date.now()}`;
    setBusy("direct");
    goPage("live");
    setLiveCalls((prev) => [
      {
        id: optimisticId,
        prospect: prospectLabel,
        mission: (r.contact || r.company || r.name) ? `Direct — ${r.contact || r.company || r.name}` : "Direct Client Outreach",
        state: "calling",
        duration: "00:00",
        channel: "voice",
        ended: false,
        transcript: [],
        startedAt: new Date().toISOString(),
      },
      ...(prev || []).filter((c) => c.id !== optimisticId),
    ]);
    try {
      await api.dialOutbound({
        to_number: phone,
        from_number: (profile && profile.callerId) || undefined,
        prospect_name: (r.contact || r.name || "").trim() || undefined,
        mission_title: (r.contact || r.company || r.name)
          ? `Direct — ${r.contact || r.company || r.name}`
          : "Direct Client Outreach",
        ...savedTwilioCreds(),
      });
      pushNote(`Outbound to ${phone}`, "success");
      await refreshLive();
    } catch (e) {
      setLiveCalls((prev) => (prev || []).filter((c) => c.id !== optimisticId));
      showToast(e.message || "Direct dial failed");
    } finally {
      setBusy("");
    }
  };

  const loadList = (id) => {
    const item = savedLists.find((s) => s.id === id);
    if (!item) return;
    setFileName(item.name);
    setHeaders(item.headers || []);
    setRows((item.rows || []).map(ensureRowPhone));
    setSelectedIds(new Set());
    showToast("Loaded " + item.name);
  };

  useEffect(() => {
    setRows((prev) => {
      let changed = false;
      const next = prev.map((r) => {
        const healed = ensureRowPhone(r);
        if (healed !== r) changed = true;
        return healed;
      });
      return changed ? next : prev;
    });
  }, [rows.length, fileName]);

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
        setRows((records || []).map((rec, i) => rowFromRecord(hs, rec, i)).map(ensureRowPhone));
        setSelectedIds(new Set());
        showToast(`${records.length} rows from file. Tick who to call, or call all with phones.`);
      },
      (err) => showToast(err)
    );
  };

  const handleDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current += 1;
    if (e.dataTransfer && e.dataTransfer.types && Array.from(e.dataTransfer.types).includes("Files")) {
      setIsDragging(true);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    try { e.dataTransfer.dropEffect = "copy"; } catch (_) {}
    if (!isDragging) setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setIsDragging(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setIsDragging(false);
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
      const file = e.dataTransfer.files[0];
      const name = (file.name || "").toLowerCase();
      if (name.endsWith(".csv") || name.endsWith(".xlsx") || name.endsWith(".xls")) {
        onFile(file);
      } else {
        showToast("Please drop an Excel (.xlsx, .xls) or CSV file.");
      }
    }
  };

  const findMissing = async () => {
    // Heal rows loaded before Contact Name mapping fix
    const healed = rows.map((r) => {
      if (String(r.contact || "").trim()) return r;
      const cells = r.cells || {};
      for (const [h, v] of Object.entries(cells)) {
        const val = String(v || "").trim();
        if (!val) continue;
        if (headerToField(h) === "contact" || /contact\s*name|prospect\s*name|full\s*name|^name$/i.test(String(h || ""))) {
          return { ...r, contact: val, name: r.company || val || r.name };
        }
      }
      return r;
    });
    if (healed.some((r, i) => r !== rows[i])) setRows(healed);

    const pool = healed.filter((r) => missingKeys(r).length && (r.company || r.contact || r.name));
    if (!pool.length) {
      showToast("Nothing missing on rows that have a name.");
      return;
    }
    lookupStop.current = false;
    setBusy("find");
    setFindProgress({ done: 0, total: pool.length, filled: 0, note: "Using company, town, person, and website from the file." });
    const CHUNK = 3;
    let proposed = 0;
    let empty = 0;
    try {
      for (let i = 0; i < pool.length; i += CHUNK) {
        if (lookupStop.current) break;
        const slice = pool.slice(i, i + CHUNK);
        const done = Math.min(i + slice.length, pool.length);
        setFindProgress({ done, total: pool.length, filled: proposed, note: slice.map((r) => r.company || r.contact || r.name).filter(Boolean).join(" · ") });
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
    let startedFresh = false;
    if (isNewListCommand(text)) {
      const listName = parseNewListName(text);
      const onlyCommand = !/\b(find|search|discover|look up|get me|companies|leads|prospects|firms)\b/i.test(text);
      startedFresh = newList({ name: listName || undefined, confirm: rows.length > 0, silent: true });
      if (!startedFresh && onlyCommand) return;
      if (onlyCommand) {
        setChat((c) => [...c, {
          id: "c_" + Date.now(),
          who: "ai",
          text: `Blank list ready${listName ? ` (“${listName}”)` : ""}. Add rows by hand, or ask me to find companies / people and I’ll put them here. Say Save list when you want it kept.`,
        }]);
        return;
      }
    }
    setBusy("chat");
    try {
      const creds = getActiveAiCredentials(commonAi, "voice");
      const contactSnapshot = startedFresh ? [] : serializeForGaps(rows);
      const res = await api.copilotChat({
        message: text,
        history: [...historySource, userMsg].map((m) => ({ sender: m.who === "ai" ? "ai" : "user", text: m.text })),
        plugin: "voice",
        apiKey: creds.apiKey,
        provider: creds.provider,
        model: creds.model,
        baseUrl: creds.baseUrl,
        contacts: contactSnapshot,
      });
      if (res && res.fills && res.fills.length) mergeFills(res.fills);
      if (res && res.leads && res.leads.length) {
        setRows((prev) => {
          const base = startedFresh ? [] : prev;
          const start = base.length;
          if (!headers.length || startedFresh) setHeaders([...DEFAULT_LIST_HEADERS]);
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
            aiFields: {},
            callTimes: 0,
            lastOutcome: "",
          }));
          return [...base, ...added.map((r) => ({
            ...r,
            cells: { Company: r.company, Contact: r.contact, Phone: r.phone, Email: r.email, Website: r.website, LinkedIn: r.linkedin || "" },
          }))];
        });
        if (startedFresh && !fileName) setFileName(parseNewListName(text) || "AI list");
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
    const useSelected = selectedDialable >= 2;
    const pool = useSelected
      ? rows.filter((r) => selectedIds.has(r.id) && digitsInPhone(rowPhone(r)).length >= 7)
      : rows.filter((r) => digitsInPhone(rowPhone(r)).length >= 7);
    const prospects = pool.map((r) => {
      const phone = rowPhone(r);
      return {
        to_number: phone,
        phone,
        prospect_name: r.contact || "",
        name: r.company || r.name,
        contact: r.contact || "",
        company: r.company || "",
        website: r.website || "",
      };
    });
    if (!prospects.length) {
      showToast(useSelected ? "Select contacts with a phone first." : "No dialable phone numbers on this list.");
      return;
    }
    // 2+ selected → up to 2 at once. Whole list (or 0–1 selected) → 1 at a time.
    const cap = useSelected ? MAX_CONCURRENT : 1;
    const label = useSelected
      ? `Call ${prospects.length} selected · ${cap} at once?`
      : `Call all ${prospects.length} phones · 1 at a time?`;
    if (!window.confirm(label)) return;
    setBusy("dial");
    goPage("live");
    try {
      const res = await api.dialOutboundBatch({
        prospects,
        concurrency: cap,
        mission_title: fileName ? `List — ${fileName}` : `Outbound list — ${prospects.length} contacts`,
        from_number: (profile && profile.callerId) || undefined,
        timezone: (profile && profile.timezone) || "Europe/London",
        ...savedTwilioCreds(),
      });
      showToast(res.message || `Live outbound started for ${res.total} contacts.`);
      await refreshLive();
    } catch (e) {
      showToast(e.message || "Dial failed");
    } finally {
      setBusy("");
    }
  };

  const directCall = async () => {
    let phone = resolveDirectPhone();
    if (digitsInPhone(phone).length < 7) {
      showToast("Enter a real phone number.");
      return;
    }
    const prospectLabel = direct.name.trim() || phone;
    const optimisticId = `pending_${Date.now()}`;
    setBusy("direct");
    goPage("live");
    setLiveCalls((prev) => [
      {
        id: optimisticId,
        prospect: prospectLabel,
        mission: direct.name.trim() ? `Direct — ${direct.name.trim()}` : "Direct Client Outreach",
        state: "calling",
        duration: "00:00",
        channel: "voice",
        ended: false,
        transcript: [],
        startedAt: new Date().toISOString(),
      },
      ...(prev || []).filter((c) => c.id !== optimisticId),
    ]);
    try {
      await api.dialOutbound({
        to_number: phone,
        from_number: (profile && profile.callerId) || undefined,
        prospect_name: direct.name.trim() || undefined,
        mission_title: direct.name.trim() ? `Direct — ${direct.name.trim()}` : "Direct Client Outreach",
        ...savedTwilioCreds(),
      });
      pushNote(`Outbound to ${phone}`, "success");
      await refreshLive();
    } catch (e) {
      setLiveCalls((prev) => (prev || []).filter((c) => c.id !== optimisticId));
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
      pushNote(res.message || "Meeting booked — see Schedule → List view.", "success");
      await refreshLive();
      await refreshMeetings();
      await refreshSchedule();
      await refreshLogs();
      setScheduleFocus("list");
      goPage("schedule");
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
      await api.selectVoice({
        voice_id: voiceName,
        label: voiceSelectLabel(voiceName),
        provider: "xai",
        accent: voiceAccentFor(voiceName),
      });
      showToast(companyPanel ? "Voice saved." : "Setup saved.");
    } catch (e) {
      showToast(e.message || "Save failed");
    } finally {
      setBusy("");
    }
  };

  const activeLive = liveCalls.filter(liveActive);
  const dialable = rows.filter((r) => digitsInPhone(rowPhone(r)).length >= 7).length;
  const selectedDialable = rows.filter((r) => selectedIds.has(r.id) && digitsInPhone(rowPhone(r)).length >= 7).length;
  const allDialableSelected = dialable > 0 && selectedDialable === dialable;
  const filteredLogs = useMemo(() => {
    const q = logQuery.trim().toLowerCase();
    return (logs || []).filter((l) => {
      const outcome = String(l.outcome || "").toLowerCase();
      if (logOutcome !== "all" && outcome !== logOutcome) return false;
      if (!q) return true;
      const blob = `${logDisplayName(l)} ${l.canonicalName || ""} ${l.personListedAs || ""} ${l.mission || ""} ${l.outcome || ""}`.toLowerCase();
      return blob.includes(q);
    });
  }, [logs, logQuery, logOutcome]);
  const titles = {
    list: ["Today's list", "Upload Excel, tick who to call. Max 2 at once when several are selected."],
    live: ["Live calls", "Listen, take over, book from their words, or end. Transcript stays on the card."],
    logs: ["Call history", "Name from dial form. Search, filter, expand transcript."],
    schedule: ["Schedule", "Park a call on the left. Calendar for slots · List view for bookings."],
    ai: ["AI config", "Keys and secrets stay encrypted in the database."],
    company: ["Company profile", "Identity, knowledge, services, Call Script & Rules. Same record classic uses on calls."],
  };

  return (
    <div style={{ display: "flex", height: "100vh", background: "linear-gradient(180deg, #F3F1EB 0%, #EFEDE8 100%)", fontFamily: FONT_BODY }}>
      <AppChrome />
      <div style={{ width: 232, minWidth: 232, background: "linear-gradient(180deg, #12141C 0%, #1B1E29 100%)", height: "100vh", display: "flex", flexDirection: "column", padding: "18px 12px", boxSizing: "border-box" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 8px 16px" }}>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 32 32"
            width={32}
            height={32}
            style={{
              display: "block",
              flexShrink: 0,
            }}
          >
            <defs>
              <linearGradient id="aiv" x1="4" y1="2" x2="30" y2="32" gradientUnits="userSpaceOnUse">
                <stop stopColor="#3457D5"/>
                <stop offset="1" stopColor="#0C8C7D"/>
              </linearGradient>
            </defs>
            <rect width="32" height="32" rx="9" fill="url(#aiv)"/>
            <circle cx="11" cy="16" r="2.35" fill="#fff"/>
            <path d="M15.6 11.1c2.7 1.5 2.7 8.3 0 9.8" fill="none" stroke="#fff" strokeWidth="1.85" strokeLinecap="round"/>
            <path d="M19.4 8.4c4.3 2.5 4.3 12.7 0 15.2" fill="none" stroke="#fff" strokeWidth="1.85" strokeLinecap="round"/>
            <path d="M23.1 6.1c5.8 3.3 5.8 16.5 0 19.8" fill="none" stroke="#fff" strokeWidth="1.75" strokeLinecap="round"/>
          </svg>
          <div>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, color: "#fff" }}>Calling</div>
            <div style={{ fontSize: 9.5, color: "#8B90A0", fontWeight: 700, letterSpacing: "0.07em" }}>OUTREACH BY AIVHUB</div>
          </div>
        </div>
        <button type="button" onClick={() => {
          if (page === "company" && companyDirty) {
            setUnsavedLeaveTarget({ type: "hub" });
            return;
          }
          onBackToHub();
        }} style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 4px 12px", padding: "8px 10px", borderRadius: 8, border: `1px solid ${C.inkLine}`, background: "transparent", color: "#C8CCD6", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
          <LayoutGrid size={14} /> All plugins
        </button>
        {PAGES.map((p) => {
          const Icon = p.icon;
          return (
            <button key={p.id} type="button" onClick={() => goPage(p.id)} style={navBtn(page === p.id)}>
              <Icon size={15} />
              <span style={{ flex: 1 }}>{p.label}</span>
              {p.id === "live" && activeLive.length ? (
                <span style={{ minWidth: 18, height: 18, borderRadius: 99, background: "#fff", color: C.cobalt, fontSize: 10, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 5px" }}>
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
            if (page === "company" && companyDirty) {
              setUnsavedLeaveTarget({ type: "classic" });
              return;
            }
            setCallingEdition("classic");
            try { window.history.replaceState(null, "", "#/voice/list"); } catch (_) {}
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
        <div style={{ padding: "16px 28px", borderBottom: `1px solid ${C.border}`, background: "rgba(255,255,255,0.9)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, position: "relative", zIndex: 60, overflow: "visible" }}>
          <div>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 22, color: C.textInk }}>{titles[page][0]}</div>
            <div style={{ fontSize: 13, color: C.slate, marginTop: 4 }}>{titles[page][1]}</div>
          </div>
          <NotificationBell
            notifications={notifications}
            setNotifications={setNotifications}
            onNavigate={onNotificationNavigate}
          />
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
              <div
                onDragEnter={handleDragEnter}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                style={{ display: "flex", flexDirection: "column", minHeight: 0, minWidth: 0, position: "relative" }}
              >
                {isDragging && (
                  <div style={{
                    position: "absolute",
                    inset: 0,
                    background: "rgba(240, 246, 255, 0.95)",
                    border: `2px dashed ${C.cobalt}`,
                    borderRadius: 16,
                    zIndex: 150,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 12,
                    backdropFilter: "blur(2px)",
                    pointerEvents: "none",
                  }}>
                    <div style={{ width: 64, height: 64, borderRadius: 20, background: C.cobaltSoft, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid #C7D7FA" }}>
                      <Upload size={32} color={C.cobalt} />
                    </div>
                    <div style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 700, color: C.textInk }}>
                      Drop CSV or Excel file to upload
                    </div>
                    <div style={{ fontSize: 13, color: C.slate, maxWidth: 380, textAlign: "center", lineHeight: 1.45 }}>
                      Supports .xlsx, .xls, and .csv files. Contacts, phone numbers, and companies will be parsed automatically.
                    </div>
                  </div>
                )}
                <div style={{ ...card(), marginBottom: 12, flexShrink: 0 }}>
                  <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, marginBottom: 10 }}>Call anyone</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <div style={{
                      display: "flex",
                      alignItems: "center",
                      border: `1px solid ${C.border}`,
                      borderRadius: 10,
                      background: "#fff",
                      height: 40,
                      flex: 1,
                      minWidth: 200,
                      position: "relative",
                    }}>
                      <div ref={countryDropdownRef} style={{ height: "100%", position: "relative" }}>
                        <button
                          type="button"
                          onClick={() => {
                            setCountryMenuOpen((prev) => !prev);
                            setCountrySearch("");
                          }}
                          title={`Country code: ${activeCountryObj?.name || countryCode} (${activeCountryObj?.country || ""}). Click to search or change.`}
                          style={{
                            height: "100%",
                            border: "none",
                            borderRight: `1px solid ${C.borderLight}`,
                            borderTopLeftRadius: 9,
                            borderBottomLeftRadius: 9,
                            background: countryMenuOpen ? "#EEF2FF" : "#F8FAFC",
                            padding: "0 8px 0 10px",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 5,
                            fontFamily: FONT_BODY,
                            cursor: "pointer",
                            outline: "none",
                            userSelect: "none",
                            transition: "background 0.15s ease",
                          }}
                        >
                          <span style={{ fontSize: 14, lineHeight: 1 }}>{activeCountryObj?.flag || "🌐"}</span>
                          <span style={{ fontFamily: FONT_MONO, fontSize: 12, fontWeight: 700, color: C.cobaltDeep }}>
                            {countryCode}
                          </span>
                          <ChevronDown
                            size={11}
                            color={C.slate}
                            style={{
                              transform: countryMenuOpen ? "rotate(180deg)" : "none",
                              transition: "transform 0.15s ease",
                            }}
                          />
                        </button>

                        {countryMenuOpen && (
                          <div
                            style={{
                              position: "absolute",
                              top: "calc(100% + 6px)",
                              left: 0,
                              zIndex: 1000,
                              width: 310,
                              background: "#fff",
                              borderRadius: 12,
                              border: `1px solid ${C.border}`,
                              boxShadow: "0 14px 36px rgba(15,23,42,0.2)",
                              padding: "8px",
                              display: "flex",
                              flexDirection: "column",
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                                background: "#F8FAFC",
                                border: `1px solid ${C.borderLight}`,
                                borderRadius: 8,
                                padding: "6px 8px",
                                marginBottom: 6,
                              }}
                            >
                              <Search size={13} color={C.slate} style={{ flexShrink: 0 }} />
                              <input
                                ref={countrySearchInputRef}
                                value={countrySearch}
                                onChange={(e) => setCountrySearch(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    if (filteredCountries.length > 0) {
                                      selectCountry(filteredCountries[0]);
                                    }
                                  } else if (e.key === "Escape") {
                                    setCountryMenuOpen(false);
                                  }
                                }}
                                placeholder="Search initial (UK, US, IN) or number (44)..."
                                style={{
                                  border: "none",
                                  outline: "none",
                                  background: "transparent",
                                  fontSize: 12,
                                  fontFamily: FONT_BODY,
                                  width: "100%",
                                  color: C.textInk,
                                }}
                              />
                              {countrySearch ? (
                                <button
                                  type="button"
                                  onClick={() => setCountrySearch("")}
                                  style={{
                                    border: "none",
                                    background: "transparent",
                                    padding: 2,
                                    cursor: "pointer",
                                    display: "flex",
                                    alignItems: "center",
                                  }}
                                >
                                  <X size={12} color={C.slate} />
                                </button>
                              ) : null}
                            </div>

                            <div
                              style={{
                                maxHeight: 220,
                                overflowY: "auto",
                                display: "flex",
                                flexDirection: "column",
                                gap: 2,
                                scrollbarWidth: "thin",
                              }}
                            >
                              {filteredCountries.length === 0 ? (
                                <div style={{ padding: "12px 8px", textAlign: "center", fontSize: 12, color: C.slate }}>
                                  No countries matching "{countrySearch}"
                                </div>
                              ) : (
                                filteredCountries.map((c) => {
                                  const isSelected = c.code === countryCode && (c.country === activeCountryObj?.country || c.code !== "+1");
                                  return (
                                    <div
                                      key={`${c.country}_${c.code}`}
                                      onClick={() => selectCountry(c)}
                                      style={{
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "space-between",
                                        padding: "6px 8px",
                                        borderRadius: 6,
                                        cursor: "pointer",
                                        background: isSelected ? C.cobaltSoft : "transparent",
                                        transition: "background 0.1s ease",
                                      }}
                                      onMouseEnter={(e) => {
                                        if (!isSelected) e.currentTarget.style.background = "#F1F5F9";
                                      }}
                                      onMouseLeave={(e) => {
                                        if (!isSelected) e.currentTarget.style.background = "transparent";
                                      }}
                                    >
                                      <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                                        <span style={{ fontSize: 14 }}>{c.flag}</span>
                                        <span
                                          style={{
                                            fontSize: 12.5,
                                            fontWeight: isSelected ? 700 : 500,
                                            color: isSelected ? C.cobaltDeep : C.textInk,
                                            whiteSpace: "nowrap",
                                            overflow: "hidden",
                                            textOverflow: "ellipsis",
                                            maxWidth: 165,
                                          }}
                                        >
                                          {c.name}
                                        </span>
                                        <span
                                          style={{
                                            fontSize: 10,
                                            fontWeight: 800,
                                            padding: "1px 4px",
                                            borderRadius: 4,
                                            background: isSelected ? "#C7D7FA" : "#E2E8F0",
                                            color: isSelected ? C.cobaltDeep : "#475569",
                                            fontFamily: FONT_MONO,
                                          }}
                                        >
                                          {c.country}
                                        </span>
                                      </div>
                                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                        <span
                                          style={{
                                            fontFamily: FONT_MONO,
                                            fontSize: 12,
                                            fontWeight: 700,
                                            color: isSelected ? C.cobaltDeep : C.slate,
                                          }}
                                        >
                                          {c.code}
                                        </span>
                                        {isSelected ? <Check size={13} color={C.cobalt} /> : null}
                                      </div>
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                      <input
                        value={direct.phone}
                        onChange={(e) => {
                          const val = e.target.value;
                          setDirect((d) => ({ ...d, phone: val }));
                          if (val.startsWith("+")) {
                            const match = [...COUNTRY_CODES].sort((a, b) => b.code.length - a.code.length).find((c) => val.startsWith(c.code));
                            if (match && match.code !== countryCode) {
                              setCountryCode(match.code);
                              try { localStorage.setItem("aivhub_dial_country_code", match.code); } catch (_) {}
                            }
                          }
                        }}
                        placeholder="Phone"
                        style={{
                          border: "none",
                          padding: "0 10px",
                          height: "100%",
                          outline: "none",
                          fontFamily: FONT_BODY,
                          fontSize: 13,
                          flex: 1,
                          minWidth: 90,
                          background: "transparent",
                        }}
                      />
                    </div>
                    <input value={direct.name} onChange={(e) => setDirect((d) => ({ ...d, name: e.target.value }))} placeholder="Name (optional)" style={{ ...fieldStyle(), flex: 1, minWidth: 120 }} />
                    <button type="button" disabled={busy === "direct"} onClick={directCall} style={{ height: 40, padding: "0 14px", borderRadius: 10, border: "none", background: C.gradientPrimary, color: "#fff", fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, boxShadow: "0 6px 16px rgba(52,87,213,0.25)" }}>
                      <Phone size={14} /> {busy === "direct" ? "Calling…" : "Call"}
                    </button>
                    <button
                      type="button"
                      disabled={digitsInPhone(direct.phone).length < 7}
                      onClick={() => openChannel("sms", resolveDirectPhone() || direct.phone, direct.name, brandForMsg())}
                      style={{ height: 40, padding: "0 12px", borderRadius: 10, border: `1px solid ${C.border}`, background: "#fff", fontWeight: 700, cursor: digitsInPhone(direct.phone).length >= 7 ? "pointer" : "default", display: "inline-flex", alignItems: "center", gap: 6, opacity: digitsInPhone(direct.phone).length >= 7 ? 1 : 0.45 }}
                    >
                      <MessageSquare size={14} /> Text
                    </button>
                    <button
                      type="button"
                      disabled={digitsInPhone(direct.phone).length < 7}
                      onClick={() => openChannel("whatsapp", resolveDirectPhone() || direct.phone, direct.name, brandForMsg())}
                      style={{ height: 40, padding: "0 12px", borderRadius: 10, border: `1px solid ${C.border}`, background: "#fff", fontWeight: 700, cursor: digitsInPhone(direct.phone).length >= 7 ? "pointer" : "default", display: "inline-flex", alignItems: "center", gap: 6, opacity: digitsInPhone(direct.phone).length >= 7 ? 1 : 0.45 }}
                    >
                      WhatsApp
                    </button>
                    <button
                      type="button"
                      disabled={digitsInPhone(direct.phone).length < 7}
                      onClick={saveDirectContact}
                      style={{ height: 40, padding: "0 12px", borderRadius: 10, border: `1px solid ${C.border}`, background: "#fff", fontWeight: 700, cursor: digitsInPhone(direct.phone).length >= 7 ? "pointer" : "default", display: "inline-flex", alignItems: "center", gap: 6, opacity: digitsInPhone(direct.phone).length >= 7 ? 1 : 0.45 }}
                    >
                      <Bookmark size={14} /> Save
                    </button>
                  </div>
                  {savedContacts.length ? (
                    <div style={{ marginTop: 12, borderTop: `1px solid ${C.borderLight}`, paddingTop: 10 }}>
                      <div style={{ fontSize: 11, fontWeight: 800, color: C.slate, letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 8 }}>
                        Saved numbers ({savedContacts.length})
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 140, overflow: "auto" }}>
                        {savedContacts.slice(0, 12).map((c) => (
                          <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            <button type="button" onClick={() => loadSavedContact(c)} style={{ border: "none", background: "transparent", padding: 0, cursor: "pointer", textAlign: "left", flex: 1, minWidth: 120 }}>
                              <div style={{ fontWeight: 700, fontSize: 13, color: C.ink }}>{c.name || c.company || "Contact"}</div>
                              <div style={{ fontSize: 11, color: C.slate }}>{c.phone}{c.company && c.name ? ` · ${c.company}` : ""}</div>
                            </button>
                            <button type="button" onClick={() => callOneRow(c)} style={miniAct()}><Phone size={12} /> Call</button>
                            <button type="button" onClick={() => openChannel("sms", c.phone, c.name, c.company || brandForMsg())} style={miniAct()}><MessageSquare size={12} /> Text</button>
                            <button type="button" onClick={() => openChannel("whatsapp", c.phone, c.name, c.company || brandForMsg())} style={miniAct()}>WA</button>
                            <button type="button" onClick={() => removeSavedContact(c.id)} style={{ ...miniAct(), color: C.red }}>×</button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 8, flexShrink: 0 }}>
                  <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" hidden onChange={(e) => onFile(e.target.files && e.target.files[0])} />
                  <button type="button" onClick={() => newList({})} style={{ height: 40, padding: "0 14px", borderRadius: 10, border: `1px solid ${C.border}`, background: "#fff", fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
                    <Plus size={14} /> New list
                  </button>
                  <button type="button" onClick={addRow} style={{ height: 40, padding: "0 14px", borderRadius: 10, border: `1px solid ${C.border}`, background: "#fff", fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
                    <Pencil size={14} /> Add row
                  </button>
                  <button type="button" disabled={!rows.length} onClick={saveList} style={{ height: 40, padding: "0 14px", borderRadius: 10, border: `1px solid ${C.border}`, background: "#fff", fontWeight: 700, cursor: rows.length ? "pointer" : "default" }}>
                    Save list
                  </button>
                  <button
                    type="button"
                    disabled={!selectedDialable}
                    onClick={saveSelectedContacts}
                    style={{ height: 40, padding: "0 14px", borderRadius: 10, border: `1px solid ${C.border}`, background: "#fff", fontWeight: 700, cursor: selectedDialable ? "pointer" : "default", display: "inline-flex", alignItems: "center", gap: 6, opacity: selectedDialable ? 1 : 0.45 }}
                  >
                    <Bookmark size={14} /> Save selected
                  </button>
                  {savedLists.length ? (
                    <select defaultValue="" onChange={(e) => { if (e.target.value) loadList(e.target.value); e.target.value = ""; }} style={{ ...fieldStyle(), width: 180, height: 40 }}>
                      <option value="">Open saved list…</option>
                      {savedLists.map((s) => (
                        <option key={s.id} value={s.id}>{s.name} ({(s.rows || []).length})</option>
                      ))}
                    </select>
                  ) : null}
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
                    <button
                      type="button"
                      disabled={busy === "dial"}
                      onClick={startCalls}
                      title={selectedDialable >= 2
                        ? `Call ${selectedDialable} selected · up to ${MAX_CONCURRENT} at once`
                        : `Call all ${dialable} phones · 1 at a time`}
                      style={{ height: 40, padding: "0 16px", borderRadius: 10, border: "none", background: selectedDialable >= 2 ? C.gradientPrimary : C.ink, color: "#fff", fontWeight: 700, cursor: "pointer", boxShadow: selectedDialable >= 2 ? "0 6px 16px rgba(52,87,213,0.25)" : undefined }}
                    >
                      {busy === "dial"
                        ? "Placing…"
                        : selectedDialable >= 2
                          ? `Call selected (${selectedDialable}) · 2 at once`
                          : `Call all phones (${dialable}) · 1 at a time`}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => fileRef.current && fileRef.current.click()}
                    title="Upload CSV or Excel file (.csv, .xlsx, .xls) — or drag and drop anywhere onto this page"
                    style={{
                      marginLeft: "auto",
                      height: 40,
                      padding: "0 16px",
                      borderRadius: 10,
                      border: `1.5px solid ${isDragging ? C.cobalt : C.border}`,
                      background: isDragging ? C.cobaltSoft : "#fff",
                      color: isDragging ? C.cobaltDeep : C.textInk,
                      fontWeight: 700,
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
                      transition: "all 0.15s ease",
                    }}
                  >
                    <Upload size={14} color={isDragging ? C.cobalt : C.cobaltDeep} /> {fileName || "Upload CSV / Excel"}
                  </button>
                </div>
                <div style={{ fontSize: 12, color: C.slateLight, marginBottom: 10, flexShrink: 0 }}>
                  {rows.length
                    ? `${fileName ? `${fileName} · ` : ""}${rows.length} contacts · ${dialable} with phone${selectedDialable ? ` · ${selectedDialable} selected` : ""}. Edit cells or tick rows to dial.`
                    : "New list → Add row, or ask chat “new list” / find companies. Save list keeps it here."}
                </div>

                {!rows.length ? (
                  <div style={{ ...card(), padding: 40, textAlign: "center", color: C.slate, flex: 1, display: "grid", gap: 14, justifyContent: "center" }}>
                    <div>Blank slate. Build a list by hand or with List AI.</div>
                    <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
                      <button type="button" onClick={() => { newList({ confirm: false }); addRow(); }} style={{ height: 40, padding: "0 16px", borderRadius: 10, border: "none", background: C.ink, color: "#fff", fontWeight: 700, cursor: "pointer" }}>
                        New list + first row
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="calling-scroll" style={{ ...card(), padding: 0, flex: 1, minHeight: 180 }}>
                    <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12.5 }}>
                      <thead>
                        <tr>
                          <th style={{ textAlign: "left", padding: "12px 10px", borderBottom: `1px solid ${C.border}`, background: C.paperSoft, position: "sticky", top: 0, zIndex: 1, width: 44 }}>
                            <input
                              type="checkbox"
                              checked={allDialableSelected}
                              onChange={() => (allDialableSelected ? clearSelection() : selectAllDialable())}
                              title={allDialableSelected ? "Clear selection" : "Select all with phones"}
                              style={{ width: 16, height: 16, cursor: "pointer" }}
                            />
                          </th>
                          {headers.map((h) => (
                            <th key={h} style={{ textAlign: "left", padding: "12px 14px", borderBottom: `1px solid ${C.border}`, color: C.slate, fontWeight: 700, whiteSpace: "nowrap", background: C.paperSoft, position: "sticky", top: 0, zIndex: 1 }}>{h}</th>
                          ))}
                          {extras.map((h) => (
                            <th key={"x_" + h} style={{ textAlign: "left", padding: "12px 14px", borderBottom: `1px solid ${C.border}`, color: C.slateLight, fontWeight: 700, whiteSpace: "nowrap", background: C.paperSoft, position: "sticky", top: 0, zIndex: 1 }}>{h}</th>
                          ))}
                          <th style={{ textAlign: "left", padding: "12px 14px", borderBottom: `1px solid ${C.border}`, color: C.slate, fontWeight: 700, whiteSpace: "nowrap", background: C.paperSoft, position: "sticky", top: 0, zIndex: 1 }}>Reach</th>
                          <th style={{ textAlign: "left", padding: "12px 14px", borderBottom: `1px solid ${C.border}`, color: C.slate, fontWeight: 700, whiteSpace: "nowrap", background: C.paperSoft, position: "sticky", top: 0, zIndex: 1 }}>Calls</th>
                          <th style={{ textAlign: "left", padding: "12px 14px", borderBottom: `1px solid ${C.border}`, color: C.slate, fontWeight: 700, whiteSpace: "nowrap", background: C.paperSoft, position: "sticky", top: 0, zIndex: 1 }}>Last verdict</th>
                          <th style={{ textAlign: "left", padding: "12px 10px", borderBottom: `1px solid ${C.border}`, background: C.paperSoft, position: "sticky", top: 0, zIndex: 1, width: 44 }} />
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r) => {
                          const phone = rowPhone(r);
                          const canDial = digitsInPhone(phone).length >= 7;
                          const checked = selectedIds.has(r.id);
                          const editableFields = new Set(["company", "contact", "phone", "email", "website", "linkedin"]);
                          return (
                            <tr key={r.id} style={{ background: checked ? "rgba(12,140,125,0.06)" : undefined }}>
                              <td style={{ padding: "10px 10px", borderBottom: `1px solid ${C.borderLight}`, verticalAlign: "middle" }}>
                                <input
                                  type="checkbox"
                                  disabled={!canDial}
                                  checked={checked}
                                  onChange={() => toggleSelect(r.id)}
                                  title={canDial ? "Select for batch call / save" : "No phone"}
                                  style={{ width: 16, height: 16, cursor: canDial ? "pointer" : "default", opacity: canDial ? 1 : 0.35 }}
                                />
                              </td>
                              {headers.map((h) => {
                                const field = headerToField(h);
                                const hi = cellHi(r, field);
                                if (field && editableFields.has(field)) {
                                  const v = field === "phone" ? (rowPhone(r) || r.phone || "") : (r[field] || "");
                                  return (
                                    <td key={h} style={{ padding: "6px 8px", borderBottom: `1px solid ${C.borderLight}`, background: hi ? C.cobaltSoft : undefined }}>
                                      <input
                                        value={v}
                                        onChange={(e) => patchRowField(r.id, field, e.target.value)}
                                        placeholder={h}
                                        style={{
                                          width: "100%",
                                          minWidth: field === "phone" ? 120 : 90,
                                          height: 32,
                                          border: `1px solid ${C.border}`,
                                          borderRadius: 8,
                                          padding: "0 8px",
                                          fontSize: 12.5,
                                          fontFamily: FONT_BODY,
                                          background: "#fff",
                                          boxSizing: "border-box",
                                        }}
                                      />
                                    </td>
                                  );
                                }
                                return (
                                  <td key={h} style={{ padding: "10px 14px", borderBottom: `1px solid ${C.borderLight}`, color: C.textInk, background: hi ? C.cobaltSoft : undefined, fontWeight: hi ? 700 : 400 }}>{cellValue(r, h)}</td>
                                );
                              })}
                              {extras.map((h) => {
                                const key = h.toLowerCase() === "contact" ? "contact" : h.toLowerCase();
                                const hi = cellHi(r, key);
                                if (editableFields.has(key)) {
                                  const v = key === "phone" ? (rowPhone(r) || r.phone || "") : (r[key] || "");
                                  return (
                                    <td key={"x_" + h} style={{ padding: "6px 8px", borderBottom: `1px solid ${C.borderLight}`, background: hi ? C.cobaltSoft : undefined }}>
                                      <input
                                        value={v}
                                        onChange={(e) => patchRowField(r.id, key, e.target.value)}
                                        placeholder={h}
                                        style={{
                                          width: "100%",
                                          minWidth: 90,
                                          height: 32,
                                          border: `1px solid ${C.border}`,
                                          borderRadius: 8,
                                          padding: "0 8px",
                                          fontSize: 12.5,
                                          fontFamily: FONT_BODY,
                                          background: "#fff",
                                          boxSizing: "border-box",
                                        }}
                                      />
                                    </td>
                                  );
                                }
                                return (
                                  <td key={"x_" + h} style={{ padding: "10px 14px", borderBottom: `1px solid ${C.borderLight}`, color: extraValue(r, h) ? C.textInk : C.slateLight, background: hi ? C.cobaltSoft : undefined, fontWeight: hi ? 700 : 400 }}>
                                    {extraValue(r, h)}
                                  </td>
                                );
                              })}
                              <td style={{ padding: "8px 10px", borderBottom: `1px solid ${C.borderLight}`, whiteSpace: "nowrap" }}>
                                {canDial ? (
                                  <div style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
                                    <button type="button" disabled={busy === "direct"} onClick={() => callOneRow({ ...r, phone })} style={miniAct()} title="AI call via Twilio">
                                      <Phone size={12} /> Call
                                    </button>
                                    <button type="button" onClick={() => openChannel("sms", phone, r.contact || r.name, r.company || brandForMsg())} style={miniAct()} title="Open SMS">
                                      <MessageSquare size={12} /> Text
                                    </button>
                                    <button type="button" onClick={() => openChannel("whatsapp", phone, r.contact || r.name, r.company || brandForMsg())} style={miniAct()} title="Open WhatsApp">
                                      WA
                                    </button>
                                    <button type="button" onClick={() => { upsertSavedContact({ phone, name: r.contact || r.name, company: r.company, email: r.email, source: "list" }); showToast("Saved contact"); }} style={miniAct()} title="Save number">
                                      <Bookmark size={12} />
                                    </button>
                                  </div>
                                ) : (
                                  <span style={{ color: C.slateLight, fontSize: 11 }}>No phone</span>
                                )}
                              </td>
                              <td style={{ padding: "10px 14px", borderBottom: `1px solid ${C.borderLight}`, fontWeight: 700 }}>{r.callTimes || 0}</td>
                              <td style={{ padding: "10px 14px", borderBottom: `1px solid ${C.borderLight}`, color: r.lastOutcome ? C.textInk : C.slateLight }}>{r.lastOutcome || "not called"}</td>
                              <td style={{ padding: "8px 6px", borderBottom: `1px solid ${C.borderLight}` }}>
                                <button type="button" onClick={() => removeRow(r.id)} title="Remove row" style={{ ...miniAct(), color: C.red }}>
                                  <Trash2 size={12} />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div style={{ ...card(), display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexShrink: 0 }}>
                  <Sparkles size={16} color={C.cobalt} />
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
                      <div style={{ width: `${Math.round((findProgress.done / Math.max(findProgress.total, 1)) * 100)}%`, height: "100%", background: C.cobalt }} />
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
                                  <button type="button" title="Copy" onClick={() => copyMsg(m.text, m.id)} style={{ ...iconMini, color: copiedId === m.id ? C.cobalt : C.slate, opacity: 1, minWidth: copiedId === m.id ? 58 : 26, fontSize: 10, fontWeight: 800, gap: 3 }}>
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
                    {busy === "chat" ? <div style={{ fontSize: 12, color: C.cobalt, fontWeight: 700 }}>Thinking…</div> : null}
                    <div ref={chatEnd} />
                  </div>
                )}
                <form onSubmit={(e) => { e.preventDefault(); sendChat(e); }} style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <input value={chatInput} onChange={(e) => setChatInput(e.target.value)} placeholder="New list… find companies… or find missing" disabled={busy === "chat" || busy === "find"} style={{ ...fieldStyle(), flex: 1 }} />
                  <button type="submit" disabled={busy === "chat" || busy === "find" || !chatInput.trim()} style={{ height: 40, width: 44, border: "none", borderRadius: 10, background: C.cobalt, color: "#fff", cursor: "pointer", boxShadow: "0 4px 12px rgba(52,87,213,0.25)" }}>
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
                  <div key={id} style={{ ...card(), borderColor: takenId === id ? C.red : listeningId === id ? C.cobalt : C.border, borderWidth: 1.5 }}>
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
                        <button type="button" onClick={() => toggleListen(id)} style={{ height: 38, padding: "0 12px", borderRadius: 9, border: `1px solid ${listeningId === id ? C.cobalt : C.border}`, background: listeningId === id ? C.cobaltSoft : "#fff", color: listeningId === id ? C.cobalt : C.textInk, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontWeight: 700 }}>
                          <Headphones size={14} /> {listeningId === id ? "Stop listen" : "Listen"}
                        </button>
                        <button type="button" onClick={() => toggleTakeover(id)} style={{ height: 38, padding: "0 12px", borderRadius: 9, border: `1px solid ${C.border}`, background: takenId === id ? C.redSoft : "#fff", cursor: "pointer", fontWeight: 700 }}>
                          {takenId === id ? "Hand back to AI" : "Take over"}
                        </button>
                        <button type="button" onClick={() => bookMeeting(id)} title="Books from what was said on this call (time + email in transcript) onto the real calendar" style={{ height: 38, padding: "0 12px", borderRadius: 9, border: "none", background: C.green, color: "#fff", cursor: "pointer", fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
                          <Calendar size={14} /> Book from call
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

          {page === "logs" && (
            <div style={{ display: "grid", gap: 14 }}>
              <div style={{ ...card(), display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
                <div style={{ position: "relative", flex: "1 1 220px", minWidth: 180 }}>
                  <Search size={14} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: C.slate }} />
                  <input
                    value={logQuery}
                    onChange={(e) => setLogQuery(e.target.value)}
                    placeholder="Search name, company, mission…"
                    style={{ ...fieldStyle(), paddingLeft: 34, height: 40 }}
                  />
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {[
                    ["all", "All"],
                    ["contacted", "Contacted"],
                    ["meeting_booked", "Booked"],
                    ["left_voicemail", "Voicemail"],
                    ["no_answer", "No answer"],
                    ["failed", "Failed"],
                    ["canceled", "Cancelled"],
                  ].map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setLogOutcome(id)}
                      style={{
                        height: 34,
                        padding: "0 12px",
                        borderRadius: 999,
                        border: `1px solid ${logOutcome === id ? C.ink : C.border}`,
                        background: logOutcome === id ? C.ink : "#fff",
                        color: logOutcome === id ? "#fff" : C.textInk,
                        fontWeight: 700,
                        fontSize: 12,
                        cursor: "pointer",
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div style={{ fontSize: 12, color: C.slate, marginLeft: "auto" }}>
                  {filteredLogs.length} of {logs.length}
                </div>
              </div>

              {!filteredLogs.length ? (
                <div style={{ ...card(), padding: 48, textAlign: "center", color: C.slate }}>
                  {logs.length ? "No logs match this filter." : "No logs yet. Ended calls land here."}
                </div>
              ) : filteredLogs.map((l) => {
                const open = openLogId === l.id;
                const name = logDisplayName(l);
                const outcome = String(l.outcome || "ended").replace(/_/g, " ");
                const lines = Array.isArray(l.transcript) ? l.transcript : [];
                const preview = lines.slice(0, open ? lines.length : 3);
                const outcomeColor =
                  /booked|meeting/i.test(outcome) ? C.green
                    : /voicemail|no.?answer/i.test(outcome) ? C.amber || "#B45309"
                    : /fail|reject/i.test(outcome) ? C.red
                    : C.cobalt;
                return (
                  <div
                    key={l.id}
                    style={{
                      ...card(),
                      padding: 0,
                      overflow: "hidden",
                      border: `1.5px solid ${open ? C.ink : C.border}`,
                      boxShadow: open ? "0 10px 28px rgba(18,20,28,0.08)" : "0 4px 14px rgba(18,20,28,0.04)",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => setOpenLogId(open ? "" : l.id)}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        border: "none",
                        background: "transparent",
                        padding: "16px 18px",
                        cursor: "pointer",
                        display: "grid",
                        gap: 8,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
                        <div>
                          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18, color: C.ink }}>{name}</div>
                          <div style={{ marginTop: 4, fontSize: 12.5, color: C.slate }}>
                            {[l.canonicalName && l.canonicalName !== name ? l.canonicalName : "", l.duration, l.startedAt || l.endedAt]
                              .filter(Boolean)
                              .join(" · ")}
                          </div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{
                            fontSize: 11,
                            fontWeight: 800,
                            letterSpacing: "0.02em",
                            textTransform: "uppercase",
                            color: outcomeColor,
                            background: `${outcomeColor}18`,
                            padding: "5px 10px",
                            borderRadius: 999,
                          }}>
                            {outcome}
                          </span>
                          {open ? <ChevronUp size={16} color={C.slate} /> : <ChevronDown size={16} color={C.slate} />}
                        </div>
                      </div>
                      {l.mission ? (
                        <div style={{ fontSize: 12, color: C.slateLight }}>{l.mission}</div>
                      ) : null}
                    </button>
                    <div style={{
                      borderTop: `1px solid ${C.border}`,
                      background: open ? "linear-gradient(180deg, #FAFAF8 0%, #F6F5F1 100%)" : "#FAFAF8",
                      padding: "12px 18px 16px",
                      fontFamily: FONT_MONO,
                      fontSize: 12,
                      color: C.textInk,
                      display: "grid",
                      gap: 8,
                      maxHeight: open ? 360 : 110,
                      overflow: "auto",
                    }}>
                      {!preview.length ? (
                        <div style={{ color: C.slate }}>No transcript captured.</div>
                      ) : preview.map((t, i) => {
                        const who = typeof t === "string" ? (t.startsWith("Prospect") || t.startsWith("them") ? "them" : "ai") : (t.who || "ai");
                        const text = typeof t === "string" ? t.replace(/^(AI|Prospect|Them|System):\s*/i, "") : (t.text || "");
                        const isAi = who === "ai" || who === "assistant";
                        return (
                          <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                            <span style={{
                              flexShrink: 0,
                              width: 54,
                              fontSize: 10,
                              fontWeight: 800,
                              letterSpacing: "0.04em",
                              textTransform: "uppercase",
                              color: isAi ? C.cobalt : C.textInk,
                              paddingTop: 2,
                            }}>
                              {isAi ? "Sam" : "Them"}
                            </span>
                            <span style={{ lineHeight: 1.45 }}>{text}</span>
                          </div>
                        );
                      })}
                      {!open && lines.length > 3 ? (
                        <button
                          type="button"
                          onClick={() => setOpenLogId(l.id)}
                          style={{ border: "none", background: "transparent", color: C.cobalt, fontWeight: 700, fontSize: 12, cursor: "pointer", textAlign: "left", padding: 0 }}
                        >
                          Show full transcript ({lines.length} lines) →
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {page === "schedule" && (
            <CallingSchedule
              schedule={schedule}
              meetings={meetings}
              profile={profile}
              focusFilter={scheduleFocus}
              onFocusConsumed={() => setScheduleFocus("")}
              onSaved={async () => { await refreshSchedule(); await refreshMeetings(); }}
              onCall={(item) => {
                setDirect({ phone: item.phone || "", name: item.prospect || "" });
                goPage("list");
              }}
              onToast={showToast}
              onNote={pushNote}
            />
          )}

          {page === "ai" && (
            <div style={{ maxWidth: 1080 }}>
              {isValidElement(aiKeysPanel)
                ? cloneElement(aiKeysPanel, { notifications, setNotifications, embedded: true })
                : (aiKeysPanel || (
                <div style={card()}>
                  <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, marginBottom: 8 }}>Open platform AI keys</div>
                  <div style={{ color: C.slate, fontSize: 13, marginBottom: 12 }}>Chat and Find missing use the Voice AI keys. Paste them in the common config.</div>
                  <button type="button" onClick={() => onOpenCommonAi && onOpenCommonAi()} style={{ height: 40, padding: "0 16px", border: "none", borderRadius: 10, background: C.ink, color: "#fff", fontWeight: 700, cursor: "pointer" }}>Open AI config</button>
                </div>
              ))}
            </div>
          )}

          {page === "company" && (
            <div>
              {isValidElement(companyPanel)
                ? cloneElement(companyPanel, { notifications, setNotifications, voiceName, setVoiceName, onDirtyChange: setCompanyDirty })
                : (
                <div style={{ display: "grid", gap: 14, maxWidth: 640 }}>
                  <div style={card()}>
                    <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, marginBottom: 6 }}>Call voice</div>
                    <label style={{ fontSize: 12, fontWeight: 700, color: C.slate }}>
                      Voice
                      <select value={voiceName} onChange={(e) => setVoiceName(e.target.value)} style={{ ...fieldStyle(), marginTop: 6 }}>
                        <option value="ara-uk">Ara UK (British, female)</option>
                        <option value="eve-uk">Eve UK (British, female)</option>
                        <option value="ara">Ara (female)</option>
                        <option value="eve">Eve (female)</option>
                        <option value="rex-uk">Rex UK — Sam (British, male)</option>
                        <option value="rex">Rex — Sam (male)</option>
                        <option value="leo">Leo (male)</option>
                      </select>
                    </label>
                  </div>
                  <div style={{ ...card(), display: "grid", gap: 12 }}>
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
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {unsavedLeaveTarget && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 100000,
            background: "rgba(15, 23, 42, 0.65)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
          onClick={() => setUnsavedLeaveTarget(null)}
        >
          <div
            style={{
              background: "#ffffff",
              borderRadius: 16,
              width: "100%",
              maxWidth: 460,
              boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(226, 232, 240, 0.8)",
              padding: 24,
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
              <div
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 12,
                  background: "#FEF3C7",
                  border: "1px solid #FDE68A",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  color: "#D97706",
                }}
              >
                <AlertTriangle size={22} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17, color: "#0F172A", lineHeight: 1.3 }}>
                  Unsaved changes
                </div>
                <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: "#475569", marginTop: 6, lineHeight: 1.5 }}>
                  You have unsaved changes in Company profile. If you leave now without saving, your recent edits will be lost.
                </div>
              </div>
              <button
                type="button"
                onClick={() => setUnsavedLeaveTarget(null)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#94A3B8",
                  cursor: "pointer",
                  padding: 4,
                  borderRadius: 6,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <X size={18} />
              </button>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                alignItems: "center",
                gap: 8,
                marginTop: 8,
                paddingTop: 16,
                borderTop: "1px solid #F1F5F9",
              }}
            >
              <button
                type="button"
                onClick={() => setUnsavedLeaveTarget(null)}
                style={{
                  padding: "8px 14px",
                  borderRadius: 8,
                  border: "1px solid #E2E8F0",
                  background: "#ffffff",
                  color: "#475569",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: FONT_BODY,
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleLeaveConfirm}
                style={{
                  padding: "8px 14px",
                  borderRadius: 8,
                  border: "1px solid #FCA5A5",
                  background: "#FEF2F2",
                  color: "#DC2626",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: FONT_BODY,
                }}
              >
                Leave without saving
              </button>
              <button
                type="button"
                onClick={handleSaveAndLeaveWorkspace}
                style={{
                  padding: "8px 18px",
                  borderRadius: 8,
                  border: "none",
                  background: "linear-gradient(135deg, #2a47ae 0%, #1a2d7a 100%)",
                  color: "#ffffff",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: FONT_BODY,
                  boxShadow: "0 4px 12px rgba(42, 71, 174, 0.25)",
                }}
              >
                Save changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* In-Browser LiveKit WebRTC Voice Call Modal */}
      <LiveKitBrowserCallModal
        isOpen={liveKitModalOpen}
        onClose={() => setLiveKitModalOpen(false)}
        prospectName={liveKitTarget.name}
        prospectPhone={liveKitTarget.phone}
        companyName={liveKitTarget.company}
        onCallEnded={() => {
          if (refreshLive) refreshLive();
        }}
      />
    </div>
  );
}
