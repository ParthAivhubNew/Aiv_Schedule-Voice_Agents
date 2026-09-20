import React, { useEffect, useMemo, useState } from "react";
import {
  Calendar,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  MapPin,
  MessageCircle,
  Phone,
  PhoneCall,
  Trash2,
  Video,
  X,
} from "lucide-react";
import { api } from "../api/apiClient";
import { C, FONT_BODY, FONT_DISPLAY } from "../tokens";
import { MeetingInvitePreview } from "../components/MeetingInvitePreview";

const FALLBACK_KINDS = [
  { id: "phone", label: "Phone call", hint: "We dial them", Icon: Phone, color: C.cobalt },
  { id: "video", label: "Video meeting", hint: "Join URL", Icon: Video, color: C.teal },
  { id: "in_person", label: "In person", hint: "Address", Icon: MapPin, color: C.amber },
];

const KIND_ICON = { phone: Phone, video: Video, in_person: MapPin };
const KIND_COLOR = { phone: C.cobalt, video: C.teal, in_person: C.amber };

function kindsFromPolicy(policy) {
  const types = (policy && policy.meeting_types) || [];
  const enabled = types.filter((t) => t && t.enabled !== false && t.id);
  if (!enabled.length) return FALLBACK_KINDS;
  return enabled.map((t) => ({
    id: t.id,
    label: t.label || t.id,
    hint: t.hint || "",
    Icon: KIND_ICON[t.id] || PhoneCall,
    color: KIND_COLOR[t.id] || C.cobalt,
    default_platform: t.default_platform,
  }));
}

function notifyFromPolicy(policy) {
  const ch = ((policy && policy.notify_channels) || []).filter((n) => n && n.enabled !== false);
  return ch;
}

const SLOT_STEP = 30;

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
    boxSizing: "border-box",
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

function digitsInPhone(raw) {
  return String(raw || "").replace(/\D/g, "");
}

function looksLikeUrl(v) {
  const s = String(v || "").trim();
  return /^https?:\/\//i.test(s) || /^www\./i.test(s) || (/meet\.|zoom\.|teams\.|cal\.com|jit\.si/i.test(s) && !/\s/.test(s));
}

function extractUrl(raw) {
  const s = String(raw || "");
  const m = s.match(/https?:\/\/[^\s]+/i) || s.match(/\b(?:meet|zoom|teams|cal|jit)[^\s]+/i);
  return m ? m[0] : "";
}

function inferKind(s) {
  // WhatsApp is notify-only — never a meeting type
  if (s.kind === "whatsapp") return "phone";
  if (s.kind && ["phone", "video", "in_person"].includes(s.kind)) return s.kind;
  const m = String(s.mission || s.kind || s.format || "").toLowerCase();
  if (m.includes("video") || m.includes("meet") || m.includes("zoom") || m.includes("teams")) return "video";
  if (m.includes("person") || m.includes("office") || m.includes("cafe")) return "in_person";
  if (s.videoLink || s.video_link || extractUrl(s.mission)) return "video";
  return "phone";
}

function enrich(s) {
  const kind = inferKind(s);
  const videoLink = s.videoLink || s.video_link || extractUrl(s.mission) || "";
  const phone = s.phone || s.honoredQuote || s.honored_quote || "";
  return { ...s, kind, videoLink, phone, whatsappTo: s.whatsappTo || s.whatsapp_to || phone };
}

function kindMeta(kind, kinds) {
  const list = kinds && kinds.length ? kinds : FALLBACK_KINDS;
  return list.find((k) => k.id === kind) || list[0];
}

function formatWhenLabel(day, time) {
  const d = String(day || "").trim();
  const t = String(time || "").trim();
  if (!d && !t) return "—";
  try {
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      const nice = new Date(d + "T12:00:00").toLocaleDateString("en-GB", {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
      });
      return t ? `${nice} · ${t}` : nice;
    }
  } catch (_) {}
  return t ? `${d} · ${t}` : d;
}

function splitNotes(notes) {
  const raw = String(notes || "").trim();
  if (!raw) return { main: "", meta: "" };
  const m = raw.match(/\[([^\]]+)\]\s*$/);
  if (m) {
    return { main: raw.slice(0, m.index).trim(), meta: m[1].trim() };
  }
  return { main: raw, meta: "" };
}

function DetailRow({ icon: Icon, label, children }) {
  if (!children) return null;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "92px 1fr", gap: 10, alignItems: "start", padding: "10px 0", borderBottom: `1px solid ${C.border}` }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.slateLight, letterSpacing: "0.04em", textTransform: "uppercase", display: "flex", alignItems: "center", gap: 5, paddingTop: 2 }}>
        {Icon ? <Icon size={12} /> : null} {label}
      </div>
      <div style={{ fontSize: 13.5, color: C.ink, fontWeight: 600, lineHeight: 1.4, wordBreak: "break-word" }}>{children}</div>
    </div>
  );
}

function statusChipStyle(status, cancelled) {
  if (cancelled) return { bg: "#FEF2F2", fg: "#991B1B", border: "#FECACA" };
  const s = String(status || "").toLowerCase();
  if (s === "completed" || s === "done") return { bg: "#ECFDF5", fg: "#047857", border: "#A7F3D0" };
  if (s === "upcoming" || s === "booked" || s === "confirmed") return { bg: C.cobaltSoft || "#EAEEFC", fg: C.cobalt || "#3457D5", border: "#BFD5FA" };
  return { bg: "#F1F5F9", fg: "#475569", border: "#E2E8F0" };
}

function isCancelled(s) {
  const st = String(s?.status || "").toLowerCase();
  return st === "cancelled" || st === "canceled";
}

function cancelWhoLabel(reason) {
  const r = String(reason || "").toLowerCase();
  if (!r) return "Cancelled";
  if (/prospect|attendee|caller|guest|they/.test(r)) return "Cancelled by prospect";
  if (/host|operator|admin|agent|supervisor|user/.test(r)) return "Cancelled by host";
  return "Cancelled";
}

function eventChipStyle(ev, kinds) {
  const cancelled = isCancelled(ev);
  const meta = kindMeta(ev.kind, kinds);
  if (cancelled) {
    return {
      fontSize: 10,
      fontWeight: 700,
      color: "#991B1B",
      background: "#FEF2F2",
      borderLeft: "3px solid #EF4444",
      borderRadius: 5,
      padding: "3px 5px",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
      textDecoration: "line-through",
      opacity: 0.95,
    };
  }
  return {
    fontSize: 10,
    fontWeight: 700,
    color: C.ink,
    background: "#fff",
    borderLeft: `3px solid ${meta.color || C.cobalt}`,
    borderRadius: 5,
    padding: "3px 5px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };
}


function pad(n) {
  return String(n).padStart(2, "0");
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function toISODate(raw) {
  const s = String(raw || "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const parsed = Date.parse(s);
  if (!Number.isNaN(parsed)) {
    const d = new Date(parsed);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  return "";
}

function normTime(raw) {
  const s = String(raw || "").trim();
  const m = s.match(/(\d{1,2}):(\d{2})/);
  if (!m) return "";
  return `${pad(Math.min(23, Number(m[1])))}:${pad(Math.min(59, Number(m[2])))}`;
}

function isToday(day) {
  return toISODate(day) === todayISO();
}

function hrefFor(link) {
  const s = String(link || "").trim();
  if (!s) return "";
  return /^https?:/i.test(s) ? s : "https://" + s.replace(/^\/+/, "");
}

function monthLabel(year, month) {
  return new Date(year, month, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

function buildMonthCells(year, month) {
  const first = new Date(year, month, 1);
  const daysIn = new Date(year, month + 1, 0).getDate();
  const padDays = (first.getDay() + 6) % 7;
  const cells = [];
  for (let i = 0; i < padDays; i++) cells.push(null);
  for (let d = 1; d <= daysIn; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function parseHM(hm) {
  const m = String(hm || "09:00").match(/(\d{1,2}):(\d{2})/);
  if (!m) return 9 * 60;
  return Number(m[1]) * 60 + Number(m[2]);
}

function minutesToHM(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${pad(h)}:${pad(m)}`;
}

function buildDaySlots(startHM, endHM, step = SLOT_STEP) {
  const start = parseHM(startHM);
  const end = parseHM(endHM);
  const out = [];
  for (let t = start; t < end; t += step) out.push(minutesToHM(t));
  return out;
}

function eventISO(item) {
  return toISODate(item.day || item.date || item.prospectDate || "");
}

function eventTime(item) {
  return normTime(item.time || item.prospectTime || "");
}

const emptyPlan = () => ({
  prospect: "",
  phone: "",
  email: "",
  day: todayISO(),
  time: "10:00",
  kind: "phone",
  videoLink: "",
  platform: "Google Meet",
  address: "",
  notes: "",
  notifyWhatsapp: false,
});

export function CallingSchedule({
  schedule,
  meetings = [],
  profile,
  focusFilter = "",
  onFocusConsumed,
  onSaved,
  onCall,
  onToast,
  onNote,
}) {
  const now = new Date();
  const [plan, setPlan] = useState(emptyPlan);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState("");
  const [openBooked, setOpenBooked] = useState("");
  const [saving, setSaving] = useState(false);
  const [waStatus, setWaStatus] = useState(null);
  const [waBusy, setWaBusy] = useState(false);
  const [copied, setCopied] = useState("");
  const [cal, setCal] = useState({ year: now.getFullYear(), month: now.getMonth() });
  const [selectedDay, setSelectedDay] = useState(todayISO());
  const [dayExpanded, setDayExpanded] = useState(false);
  const [invitePreviewOpen, setInvitePreviewOpen] = useState(false);
  const [bookingPolicy, setBookingPolicy] = useState(null);

  const kinds = useMemo(() => kindsFromPolicy(bookingPolicy), [bookingPolicy]);
  const notifyChannels = useMemo(() => notifyFromPolicy(bookingPolicy), [bookingPolicy]);
  const waNotifyEnabled = notifyChannels.some((n) => n.id === "whatsapp");

  useEffect(() => {
    if (focusFilter === "list") {
      setFilter("list");
      if (onFocusConsumed) onFocusConsumed();
    }
  }, [focusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    api.getWhatsappStatus().then(setWaStatus).catch(() => setWaStatus({ mode: "wa_me", configured: false }));
    api.getCalcomSettings()
      .then((s) => {
        if (s && s.booking_policy) setBookingPolicy(s.booking_policy);
        const def = (s && s.booking_policy && s.booking_policy.default_meeting_type) || "phone";
        setPlan((p) => ({ ...p, kind: def }));
      })
      .catch(() => {});
  }, []);

  const workStart = (profile && (profile.weekdayStart || profile.workingHoursStart)) || "09:00";
  const workEnd = (profile && (profile.weekdayEnd || profile.workingHoursEnd)) || "17:30";
  const daySlots = useMemo(() => buildDaySlots(workStart, workEnd), [workStart, workEnd]);

  const items = useMemo(() => {
    const fromSchedule = (schedule || []).map((s) => enrich({ ...s, source: "schedule" }));
    const fromMeetings = (meetings || []).map((m) => enrich({
      id: m.id || `mtg_${m.prospect}_${m.date}_${m.time}`,
      prospect: m.prospect || m.attendee || "Meeting",
      day: m.date || m.prospectDate || "",
      time: m.time || m.prospectTime || "",
      kind: (m.format === "phone" ? "phone" : m.format === "in_person" ? "in_person" : "video"),
      videoLink: m.videoLink || m.video_link || "",
      platform: m.platform || "",
      phone: m.dialIn || m.phone || "",
      email: m.attendeeEmail || m.attendee_email || "",
      notes: m.prep || m.mission || "",
      status: m.status || "upcoming",
      cancellationReason: m.cancellationReason || m.cancellation_reason || "",
      source: "meeting",
    }));
    const seen = new Set();
    const merged = [];
    [...fromSchedule, ...fromMeetings].forEach((e) => {
      const key = e.id || `${eventISO(e)}_${eventTime(e)}_${e.prospect}`;
      if (seen.has(key)) return;
      seen.add(key);
      merged.push(e);
    });
    return merged;
  }, [schedule, meetings]);

  const open = items.find((s) => s.id === openId) || null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((s) => {
      if (filter === "today" && !isToday(s.day || s.date)) return false;
      if (filter === "calls" && s.kind !== "phone") return false;
      if (filter === "video" && s.kind !== "video") return false;
      if (filter === "notified" && !s.notifyWhatsapp) return false;
      if (q && !`${s.prospect} ${s.mission || ""} ${s.phone} ${s.day || s.date}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, filter, query]);

  const counts = {
    all: items.length,
    today: items.filter((s) => isToday(s.day || s.date)).length,
    video: items.filter((s) => s.kind === "video").length,
    notified: items.filter((s) => s.notifyWhatsapp).length,
  };

  const byDay = useMemo(() => {
    const map = {};
    filtered.forEach((s) => {
      const iso = eventISO(s);
      if (!iso) return;
      if (!map[iso]) map[iso] = [];
      map[iso].push(s);
    });
    Object.keys(map).forEach((k) => {
      map[k].sort((a, b) => eventTime(a).localeCompare(eventTime(b)));
    });
    return map;
  }, [filtered]);

  const cells = useMemo(() => buildMonthCells(cal.year, cal.month), [cal.year, cal.month]);
  const selectedEvents = byDay[selectedDay] || [];
  const bookedTimes = new Set(selectedEvents.map((e) => eventTime(e)).filter(Boolean));

  const patch = (k, v) => setPlan((p) => ({ ...p, [k]: v }));

  const pickFreeSlot = (iso, time) => {
    setSelectedDay(iso);
    setPlan((p) => ({ ...p, day: iso, time }));
    onToast(`Slot ${time} on ${iso} — finish the form on the left.`);
  };

  const savePlan = async () => {
    if (!plan.prospect.trim() || !plan.day.trim() || !plan.time.trim()) {
      onToast("Need name, day, and time.");
      return;
    }
    if (plan.kind === "phone" && digitsInPhone(plan.phone).length < 7) {
      onToast("Phone callback needs a number.");
      return;
    }
    if (plan.notifyWhatsapp && digitsInPhone(plan.phone).length < 7) {
      onToast("WhatsApp confirmation needs a mobile number.");
      return;
    }
    if (plan.kind === "video" && !plan.videoLink.trim() && /zoom|teams|google/i.test(plan.platform)) {
      onToast("Paste the video meeting link, or switch platform to Jitsi for an auto room.");
      return;
    }
    setSaving(true);
    try {
      const meetingKind = plan.kind === "whatsapp" ? "phone" : plan.kind;
      const res = await api.createScheduleItem({
        day: plan.day.trim(),
        time: plan.time.trim(),
        prospect: plan.prospect.trim(),
        kind: meetingKind,
        phone: plan.phone.trim() || undefined,
        email: plan.email.trim() || undefined,
        videoLink: plan.videoLink.trim() || undefined,
        video_link: plan.videoLink.trim() || undefined,
        platform: meetingKind === "video" ? plan.platform : undefined,
        address: plan.address.trim() || undefined,
        notes: plan.notes.trim() || undefined,
        notifyWhatsapp: plan.notifyWhatsapp,
        notify_whatsapp: plan.notifyWhatsapp,
        whatsappTo: plan.notifyWhatsapp ? plan.phone.trim() : undefined,
        honored_quote: plan.phone.trim() || undefined,
        window: `${workStart}–${workEnd}`,
        status: "queued",
        mission: "",
      });
      onNote(`Scheduled ${kindMeta(plan.kind, kinds).label.toLowerCase()} with ${plan.prospect} · ${plan.day} ${plan.time}`, "success");
      if (plan.notifyWhatsapp && res && res.whatsapp && !res.whatsapp.sent && res.whatsapp.waMeUrl) {
        window.open(res.whatsapp.waMeUrl, "_blank", "noopener");
        onToast("WhatsApp draft opened — tap send.");
      }
      setSelectedDay(toISODate(plan.day) || selectedDay);
      setPlan(emptyPlan());
      if (onSaved) await onSaved();
      if (res && res.id) setOpenId(res.id);
    } catch (e) {
      onToast(e.message || "Schedule failed");
    } finally {
      setSaving(false);
    }
  };

  const sendWa = async (item) => {
    const to = item.whatsappTo || item.phone;
    if (digitsInPhone(to).length < 7) {
      onToast("Add a mobile number first.");
      return;
    }
    setWaBusy(true);
    try {
      const res = await api.sendScheduleWhatsapp(item.id, { to });
      if (res.sent) {
        onToast("WhatsApp sent.");
        onNote(`WhatsApp sent to ${item.prospect}`, "success");
      } else if (res.waMeUrl) {
        window.open(res.waMeUrl, "_blank", "noopener");
        onToast(res.error ? `Opened WhatsApp (${res.error})` : "WhatsApp draft opened — tap send.");
      } else {
        onToast(res.error || "WhatsApp failed");
      }
    } catch (e) {
      const digits = digitsInPhone(to);
      const text = `Hi ${item.prospect}, confirming ${kindMeta(item.kind, kinds).label.toLowerCase()} on ${item.day} at ${item.time}.${item.videoLink ? " Join: " + item.videoLink : ""}`;
      if (digits.length >= 7) {
        window.open(`https://wa.me/${digits}?text=${encodeURIComponent(text)}`, "_blank", "noopener");
        onToast("WhatsApp draft opened.");
      } else {
        onToast(e.message || "WhatsApp failed");
      }
    } finally {
      setWaBusy(false);
    }
  };

  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
      window.setTimeout(() => setCopied(""), 1400);
    } catch (_) {
      onToast("Copy failed");
    }
  };

  const markDone = async (item) => {
    try {
      if (item.source === "meeting") {
        onToast("Mark outcomes from Booked for meeting records.");
        return;
      }
      await api.updateScheduleItem(item.id, { status: "completed", honored: true });
      onToast("Marked done.");
      if (onSaved) await onSaved();
    } catch (e) {
      onToast(e.message || "Update failed");
    }
  };

  const remove = async (item) => {
    try {
      if (item.source === "meeting") {
        onToast("Remove meetings from Booked.");
        return;
      }
      await api.deleteScheduleItem(item.id);
      setOpenId("");
      onToast("Removed from schedule.");
      if (onSaved) await onSaved();
    } catch (e) {
      onToast(e.message || "Delete failed");
    }
  };

  const Label = ({ children }) => (
    <div style={{ fontSize: 12, fontWeight: 700, color: C.slate, marginBottom: 6 }}>{children}</div>
  );

  const selectedLabel = selectedDay
    ? new Date(selectedDay + "T12:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })
    : "";

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(300px, 400px) 1fr", gap: 16, alignItems: "start" }}>
      <div style={{ ...card(), position: "sticky", top: 0 }}>
        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, marginBottom: 4 }}>Park a call or meeting</div>
        <div style={{ fontSize: 12, color: C.slate, marginBottom: 14 }}>Name, when, how. Click a free slot on the calendar to fill day & time.</div>

        <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(kinds.length, 3)}, 1fr)`, gap: 8, marginBottom: 14 }}>
          {kinds.map((k) => {
            const active = plan.kind === k.id;
            const Icon = k.Icon;
            return (
              <button
                key={k.id}
                type="button"
                onClick={() => patch("kind", k.id)}
                style={{
                  textAlign: "left",
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: `1.5px solid ${active ? C.ink : C.border}`,
                  background: active ? C.ink : "#fff",
                  color: active ? "#fff" : C.textInk,
                  cursor: "pointer",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 13 }}>
                  <Icon size={14} /> {k.label}
                </div>
                <div style={{ fontSize: 11, marginTop: 3, opacity: 0.75 }}>{k.hint}</div>
              </button>
            );
          })}
        </div>

        <Label>Who</Label>
        <input value={plan.prospect} onChange={(e) => patch("prospect", e.target.value)} placeholder="Name" style={{ ...fieldStyle(), marginBottom: 12 }} />

        <Label>Phone</Label>
        <input value={plan.phone} onChange={(e) => patch("phone", e.target.value)} placeholder="+44…" style={{ ...fieldStyle(), marginBottom: 12 }} />

        <Label>Email (optional)</Label>
        <input value={plan.email} onChange={(e) => patch("email", e.target.value)} placeholder="invite@…" style={{ ...fieldStyle(), marginBottom: 12 }} />

        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr", gap: 8, marginBottom: 12 }}>
          <div>
            <Label>Day</Label>
            <input type="date" value={plan.day} onChange={(e) => { patch("day", e.target.value); setSelectedDay(e.target.value); }} style={fieldStyle()} />
          </div>
          <div>
            <Label>Time</Label>
            <input type="time" value={plan.time} onChange={(e) => patch("time", e.target.value)} style={fieldStyle()} />
          </div>
        </div>

        {plan.kind === "video" && (
          <div style={{ background: C.paper || C.paperSoft, borderRadius: 12, padding: 12, marginBottom: 12, border: `1px solid ${C.border}` }}>
            <Label>Video platform</Label>
            <select value={plan.platform} onChange={(e) => patch("platform", e.target.value)} style={{ ...fieldStyle(), marginBottom: 10 }}>
              <option>Google Meet</option>
              <option>Zoom</option>
              <option>Microsoft Teams</option>
              <option>Jitsi (auto room)</option>
              <option>Cal.com</option>
            </select>
            <Label>Meeting join URL</Label>
            <input
              value={plan.videoLink}
              onChange={(e) => patch("videoLink", e.target.value)}
              placeholder={/jitsi/i.test(plan.platform) ? "Leave blank to auto-create a Jitsi room" : "https://meet.google.com/…"}
              style={fieldStyle()}
            />
            <div style={{ fontSize: 11, color: C.slate, marginTop: 6 }}>
              {/jitsi/i.test(plan.platform)
                ? "Empty link → we mint a unique Jitsi room when you save."
                : "Paste the Meet / Zoom / Teams / Cal.com link. Required for those platforms."}
            </div>
          </div>
        )}

        {plan.kind === "in_person" && (
          <div style={{ marginBottom: 12 }}>
            <Label>Address</Label>
            <input value={plan.address} onChange={(e) => patch("address", e.target.value)} placeholder="Office / cafe" style={fieldStyle()} />
          </div>
        )}

        <Label>Notes</Label>
        <textarea value={plan.notes} onChange={(e) => patch("notes", e.target.value)} rows={2} placeholder="Topic, what to bring…" style={{ ...fieldStyle(), height: "auto", padding: 10, marginBottom: 12, resize: "vertical" }} />

        {waNotifyEnabled ? (
        <label style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 14, cursor: "pointer" }}>
          <input type="checkbox" checked={plan.notifyWhatsapp} onChange={(e) => patch("notifyWhatsapp", e.target.checked)} style={{ marginTop: 3 }} />
          <span>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.textInk }}>
              {notifyChannels.find((n) => n.id === "whatsapp")?.label || "Send WhatsApp confirmation"}
            </div>
            <div style={{ fontSize: 11.5, color: C.slate, marginTop: 2 }}>
              {notifyChannels.find((n) => n.id === "whatsapp")?.hint
                || (waStatus?.configured
                  ? "Notify channel — not a meeting type. Message goes from the server."
                  : "Notify channel — not a meeting type. Opens WhatsApp with time and join link ready.")}
            </div>
          </span>
        </label>
        ) : null}

        <button type="button" disabled={saving} onClick={savePlan} style={{ height: 42, border: "none", borderRadius: 10, background: C.ink, color: "#fff", fontWeight: 700, cursor: "pointer", width: "100%" }}>
          {saving ? "Saving…" : "Add to schedule"}
        </button>
      </div>

      <div style={{ display: "grid", gap: 12, minWidth: 0 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {[
            ["all", `All (${counts.all})`],
            ["today", `Today (${counts.today})`],
            ["calls", "Calls"],
            ["video", `Video (${counts.video})`],
            ["notified", `WA notified (${counts.notified})`],
            ["list", `List view (${(meetings || []).length})`],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              style={{
                height: 34,
                padding: "0 12px",
                borderRadius: 999,
                border: `1px solid ${filter === id ? C.ink : C.border}`,
                background: filter === id ? C.ink : "#fff",
                color: filter === id ? "#fff" : C.slate,
                fontWeight: 700,
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setInvitePreviewOpen(true)}
            style={{
              height: 34,
              padding: "0 12px",
              borderRadius: 999,
              border: `1px solid ${C.border}`,
              background: "#fff",
              color: C.ink,
              fontWeight: 700,
              fontSize: 12,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <MessageCircle size={13} /> Email preview
          </button>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search…" style={{ ...fieldStyle(), width: 160, height: 34, marginLeft: "auto" }} />
        </div>

        {filter === "list" ? (
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16 }}>Bookings</div>
            <div style={{ fontSize: 12, color: C.slate, marginBottom: 4 }}>Confirmed meetings — was the Booked tab.</div>
            {!(meetings || []).length ? (
              <div style={{ ...card(), padding: 40, textAlign: "center", color: C.slate }}>No bookings yet.</div>
            ) : (meetings || []).filter((m) => {
              const q = query.trim().toLowerCase();
              if (!q) return true;
              return `${m.prospect || ""} ${m.attendee || ""} ${m.date || ""} ${m.time || ""}`.toLowerCase().includes(q);
            }).map((m) => {
              const kindId = m.format === "phone" ? "phone" : m.format === "in_person" ? "in_person" : "video";
              const meta = kindMeta(kindId, kinds);
              const Icon = meta.Icon;
              const when = [m.date, m.time].filter(Boolean).join(" ");
              const join = m.videoLink || m.video_link || "";
              const open = openBooked === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setOpenBooked(open ? "" : m.id)}
                  style={{ ...card(), textAlign: "left", cursor: "pointer", border: `1.5px solid ${open ? C.ink : C.border}`, width: "100%" }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16 }}>{m.prospect || m.attendee || "Meeting"}</div>
                    <span style={{ fontSize: 11, fontWeight: 800, color: C.cobalt, background: C.cobaltSoft, padding: "4px 8px", borderRadius: 999 }}>{m.status || "upcoming"}</span>
                  </div>
                  <div style={{ marginTop: 10, fontSize: 13, color: C.textInk, display: "grid", gap: 6 }}>
                    <div><Calendar size={13} style={{ verticalAlign: "middle" }} /> {when || "—"}</div>
                    <div><Icon size={13} style={{ verticalAlign: "middle" }} /> {meta.label}{m.platform ? ` · ${m.platform}` : ""}</div>
                    {m.channel ? <div style={{ color: C.slate }}>Channel: {m.channel}</div> : null}
                  </div>
                  {open && (
                    <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
                      {join ? (
                        <a href={hrefFor(join)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ display: "inline-block", color: C.cobalt, fontWeight: 700, fontSize: 13, wordBreak: "break-all" }}>{join}</a>
                      ) : (
                        <div style={{ fontSize: 12, color: C.slateLight }}>No join URL yet.</div>
                      )}
                    </div>
                  )}
                  {!open ? <div style={{ marginTop: 10, fontSize: 11, fontWeight: 700, color: C.cobalt }}>Open →</div> : null}
                </button>
              );
            })}
          </div>
        ) : (
        <>
        <div style={{ ...card(), padding: 16 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, gap: 10, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18, color: C.ink }}>
                {monthLabel(cal.year, cal.month)}
              </div>
              <div style={{ fontSize: 12, color: C.slate, marginTop: 2 }}>
                Booked vs free · window {workStart}–{workEnd} · click a day for popup
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                type="button"
                onClick={() => setCal((c) => (c.month === 0 ? { year: c.year - 1, month: 11 } : { year: c.year, month: c.month - 1 }))}
                style={calNavBtn}
              >
                <ChevronLeft size={16} />
              </button>
              <button
                type="button"
                onClick={() => { const n = new Date(); setCal({ year: n.getFullYear(), month: n.getMonth() }); setSelectedDay(todayISO()); }}
                style={{ ...calNavBtn, width: "auto", padding: "0 12px", fontSize: 12, fontWeight: 700 }}
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => setCal((c) => (c.month === 11 ? { year: c.year + 1, month: 0 } : { year: c.year, month: c.month + 1 }))}
                style={calNavBtn}
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 6, marginBottom: 6 }}>
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
              <div key={d} style={{ fontSize: 11, fontWeight: 700, color: C.slateLight, textAlign: "center", padding: "4px 0", minWidth: 0, overflow: "hidden" }}>{d}</div>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 6 }}>
            {cells.map((day, i) => {
              if (!day) return <div key={"e" + i} style={{ minHeight: 92, minWidth: 0 }} />;
              const key = `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
              const dayEvents = byDay[key] || [];
              const cancelledCount = dayEvents.filter(isCancelled).length;
              const isSel = selectedDay === key;
              const isTod = key === todayISO();
              const weekend = day.getDay() === 0 || day.getDay() === 6;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setSelectedDay(key);
                    setPlan((p) => ({ ...p, day: key }));
                    setDayExpanded(true);
                  }}
                  style={{
                    minHeight: 92,
                    minWidth: 0,
                    width: "100%",
                    boxSizing: "border-box",
                    overflow: "hidden",
                    textAlign: "left",
                    background: isSel ? C.cobaltSoft : weekend ? "#FAFAF8" : "#fff",
                    border: `1.5px solid ${isSel ? C.cobalt : isTod ? C.cobalt : C.border}`,
                    borderRadius: 10,
                    padding: 8,
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: C.ink }}>{day.getDate()}</span>
                    {dayEvents.length ? (
                      <span style={{ fontSize: 9, fontWeight: 800, color: cancelledCount ? "#B91C1C" : C.cobalt, background: "#fff", padding: "2px 6px", borderRadius: 999 }}>
                        {dayEvents.length} · {cancelledCount ? `${cancelledCount}×` : "booked"}
                      </span>
                    ) : (
                      <span style={{ fontSize: 9, fontWeight: 700, color: C.slateLight }}>open</span>
                    )}
                  </div>
                  {dayEvents.slice(0, 3).map((ev) => (
                    <div
                      key={ev.id}
                      onClick={(e) => { e.stopPropagation(); setOpenId(ev.id); setSelectedDay(key); setDayExpanded(true); }}
                      style={eventChipStyle(ev, kinds)}
                      title={isCancelled(ev) ? `${cancelWhoLabel(ev.cancellationReason)} · ${ev.prospect}` : `${eventTime(ev)} · ${ev.prospect}`}
                    >
                      {isCancelled(ev) ? "✕ " : ""}{eventTime(ev)} · {ev.prospect}
                    </div>
                  ))}
                  {dayEvents.length > 3 ? (
                    <div style={{ fontSize: 10, color: C.slate, fontWeight: 600 }}>+{dayEvents.length - 3} more — open day</div>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ ...card(), padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", marginBottom: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16 }}>{selectedLabel || "Pick a day"}</div>
              <div style={{ fontSize: 12, color: C.slate, marginTop: 2 }}>
                {selectedEvents.length} booked · {Math.max(0, daySlots.length - bookedTimes.size)} free slots in window
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, fontSize: 11, fontWeight: 700 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: 99, background: C.cobalt }} /> Free</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: 99, background: C.ink }} /> Booked</span>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 8 }}>
            {daySlots.map((slot) => {
              const hit = selectedEvents.find((e) => eventTime(e) === slot);
              if (hit) {
                const meta = kindMeta(hit.kind, kinds);
                const Icon = meta.Icon;
                const cancelled = isCancelled(hit);
                return (
                  <button
                    key={slot}
                    type="button"
                    onClick={() => setOpenId(hit.id)}
                    style={{
                      textAlign: "left",
                      border: `1px solid ${cancelled ? "#FECACA" : C.border}`,
                      background: cancelled ? "#FEF2F2" : C.ink,
                      color: cancelled ? "#991B1B" : "#fff",
                      borderRadius: 10,
                      padding: "10px 12px",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 800, textDecoration: cancelled ? "line-through" : "none" }}>{slot}</div>
                    <div style={{ fontSize: 11, marginTop: 4, opacity: 0.9, display: "flex", alignItems: "center", gap: 4 }}>
                      <Icon size={11} /> {cancelled ? cancelWhoLabel(hit.cancellationReason) : hit.prospect}
                    </div>
                  </button>
                );
              }
              return (
                <button
                  key={slot}
                  type="button"
                  onClick={() => pickFreeSlot(selectedDay, slot)}
                  style={{
                    textAlign: "left",
                    border: `1.5px dashed ${C.cobalt}`,
                    background: C.cobaltSoft,
                    color: C.ink,
                    borderRadius: 10,
                    padding: "10px 12px",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 800 }}>{slot}</div>
                  <div style={{ fontSize: 11, marginTop: 4, color: C.cobalt, fontWeight: 700 }}>Free · park here</div>
                </button>
              );
            })}
          </div>

          {!daySlots.length ? (
            <div style={{ color: C.slate, fontSize: 13, padding: 12 }}>Set company working hours to show slots.</div>
          ) : null}
        </div>
        </>
        )}
      </div>

      {invitePreviewOpen ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(18,20,28,0.4)",
            zIndex: 75,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            padding: 20,
          }}
          onClick={() => setInvitePreviewOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 680,
              maxWidth: "100%",
              maxHeight: "min(860px, calc(100vh - 40px))",
              overflow: "auto",
              borderRadius: 16,
              boxShadow: "0 24px 64px rgba(18,20,28,0.28)",
              background: "#fff",
            }}
          >
            <div style={{ display: "flex", justifyContent: "flex-end", padding: "8px 10px 0" }}>
              <button
                type="button"
                onClick={() => setInvitePreviewOpen(false)}
                style={{ border: "none", background: "transparent", cursor: "pointer" }}
              >
                <X size={18} />
              </button>
            </div>
            <div style={{ padding: "0 14px 14px" }}>
              <MeetingInvitePreview
                prospectName={plan.who || undefined}
                date={plan.day || undefined}
                time={plan.time || undefined}
              />
            </div>
          </div>
        </div>
      ) : null}

      {dayExpanded ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(18,20,28,0.4)",
            zIndex: 70,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            padding: 20,
          }}
          onClick={() => setDayExpanded(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 640,
              maxWidth: "100%",
              height: "min(720px, calc(100vh - 40px))",
              background: "#fff",
              borderRadius: 16,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              boxShadow: "0 24px 64px rgba(18,20,28,0.28)",
              fontFamily: FONT_BODY,
            }}
          >
            <div
              style={{
                padding: "14px 18px",
                borderBottom: `1px solid ${C.border}`,
                background: "#fff",
                display: "flex",
                alignItems: "center",
                gap: 10,
                flexShrink: 0,
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18 }}>{selectedLabel}</div>
                <div style={{ fontSize: 12.5, color: C.slate, marginTop: 2 }}>
                  {selectedEvents.length
                    ? `${selectedEvents.length} meeting${selectedEvents.length === 1 ? "" : "s"} · click one for details`
                    : "No meetings — free day"}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDayExpanded(false)}
                style={{ border: "none", background: "transparent", cursor: "pointer" }}
              >
                <X size={18} />
              </button>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 14, display: "grid", gap: 10, alignContent: "start" }}>
              {!selectedEvents.length ? (
                <div style={{ padding: 36, textAlign: "center", color: C.slate, fontSize: 13 }}>No meetings on this day.</div>
              ) : (
                [...selectedEvents]
                  .sort((a, b) => eventTime(a).localeCompare(eventTime(b)))
                  .map((ev) => {
                    const meta = kindMeta(ev.kind, kinds);
                    const Icon = meta.Icon;
                    const cancelled = isCancelled(ev);
                    return (
                      <button
                        key={ev.id}
                        type="button"
                        onClick={() => setOpenId(ev.id)}
                        style={{
                          textAlign: "left",
                          padding: "14px 16px",
                          borderRadius: 12,
                          border: `1.5px solid ${cancelled ? "#FECACA" : C.border}`,
                          background: cancelled ? "#FEF2F2" : "#fff",
                          cursor: "pointer",
                          display: "grid",
                          gap: 6,
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                          <div style={{
                            fontFamily: FONT_DISPLAY,
                            fontWeight: 700,
                            fontSize: 16,
                            color: cancelled ? "#991B1B" : C.ink,
                            textDecoration: cancelled ? "line-through" : "none",
                          }}>
                            {eventTime(ev)} · {ev.prospect}
                          </div>
                          {cancelled ? (
                            <span style={{ fontSize: 11, fontWeight: 800, color: "#991B1B", background: "#FEE2E2", padding: "4px 8px", borderRadius: 999 }}>
                              {cancelWhoLabel(ev.cancellationReason)}
                            </span>
                          ) : (
                            <span style={{ fontSize: 11, fontWeight: 800, color: C.cobalt, background: C.cobaltSoft, padding: "4px 8px", borderRadius: 999 }}>
                              {ev.status || "booked"}
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 13, color: C.slate, display: "flex", gap: 8, alignItems: "center" }}>
                          <Icon size={14} /> {meta.label}{ev.platform ? ` · ${ev.platform}` : ""}
                        </div>
                        {cancelled && ev.cancellationReason ? (
                          <div style={{ fontSize: 12, color: "#B91C1C" }}>{ev.cancellationReason}</div>
                        ) : null}
                      </button>
                    );
                  })
              )}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4, paddingBottom: 4 }}>
                <span style={{ fontSize: 11, color: C.slate }}>Legend:</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: C.ink }}>● Active</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#991B1B" }}>● Cancelled (red / strike)</span>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {open && (() => {
        const meta = kindMeta(open.kind, kinds);
        const Icon = meta.Icon;
        const cancelled = isCancelled(open);
        const chip = statusChipStyle(open.status, cancelled);
        const notes = splitNotes(open.notes);
        const when = formatWhenLabel(open.day || open.date, open.time);
        const statusLabel = cancelled
          ? cancelWhoLabel(open.cancellationReason)
          : (open.status || "upcoming");
        return (
        <div
          onClick={() => setOpenId("")}
          style={{ position: "fixed", inset: 0, background: "rgba(18,20,28,0.35)", zIndex: 80, display: "flex", justifyContent: "flex-end" }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(420px, 100%)",
              height: "100%",
              background: "#fff",
              boxShadow: "-16px 0 40px rgba(18,20,28,0.18)",
              display: "flex",
              flexDirection: "column",
              fontFamily: FONT_BODY,
            }}
          >
            <div style={{ padding: "18px 20px 14px", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 22, color: C.ink, lineHeight: 1.2 }}>
                    {open.prospect || "Meeting"}
                  </div>
                  <div style={{ fontSize: 13, color: C.slate, marginTop: 6, display: "flex", alignItems: "center", gap: 6 }}>
                    <Icon size={14} color={meta.color || C.slate} /> {meta.label}{open.platform ? ` · ${open.platform}` : ""}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                  <span style={{
                    fontSize: 11,
                    fontWeight: 800,
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                    padding: "5px 9px",
                    borderRadius: 999,
                    background: chip.bg,
                    color: chip.fg,
                    border: `1px solid ${chip.border}`,
                  }}>
                    {statusLabel}
                  </span>
                  <button
                    type="button"
                    onClick={() => setOpenId("")}
                    style={{ border: "none", background: C.paperSoft || "#F1F5F9", borderRadius: 8, width: 32, height: 32, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
            </div>

            <div style={{ flex: 1, overflow: "auto", padding: "8px 20px 20px" }}>
              <div style={{ marginBottom: 8 }}>
                <DetailRow icon={Calendar} label="When">{when}</DetailRow>
                {open.phone ? <DetailRow icon={Phone} label="Phone">{open.phone}</DetailRow> : null}
                {open.email ? <DetailRow label="Email">{open.email}</DetailRow> : null}
                {open.address ? <DetailRow icon={MapPin} label="Where">{open.address}</DetailRow> : null}
              </div>

              {notes.main || notes.meta || (cancelled && open.cancellationReason) ? (
                <div style={{ marginTop: 12, padding: 14, borderRadius: 12, background: cancelled ? "#FEF2F2" : "#F8FAFC", border: `1px solid ${cancelled ? "#FECACA" : C.border}` }}>
                  <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", color: cancelled ? "#991B1B" : C.slateLight, marginBottom: 6 }}>
                    {cancelled ? "Cancellation" : "Notes"}
                  </div>
                  {notes.main ? (
                    <div style={{ fontSize: 13, color: C.ink, lineHeight: 1.45 }}>{notes.main}</div>
                  ) : null}
                  {notes.meta ? (
                    <div style={{ fontSize: 12, color: C.slate, lineHeight: 1.4, marginTop: notes.main ? 8 : 0 }}>
                      {notes.meta}
                    </div>
                  ) : null}
                  {cancelled && open.cancellationReason && !notes.meta ? (
                    <div style={{ fontSize: 12, color: "#991B1B", lineHeight: 1.4 }}>{open.cancellationReason}</div>
                  ) : null}
                </div>
              ) : null}

              {open.kind === "video" ? (
                <div style={{ marginTop: 16, padding: 14, borderRadius: 12, border: `1px solid ${C.border}`, background: "#fff" }}>
                  <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", color: C.slateLight, marginBottom: 8 }}>
                    Join link
                  </div>
                  {open.videoLink ? (
                    <>
                      <div style={{ fontSize: 12.5, color: C.cobalt, fontWeight: 600, wordBreak: "break-all", lineHeight: 1.4, marginBottom: 12 }}>
                        {open.videoLink}
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <a
                          href={hrefFor(open.videoLink)}
                          target="_blank"
                          rel="noreferrer"
                          style={{ flex: 1, height: 38, padding: "0 12px", borderRadius: 9, background: C.ink, color: "#fff", fontWeight: 700, fontSize: 12.5, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, textDecoration: "none" }}
                        >
                          <ExternalLink size={13} /> Join now
                        </a>
                        <button
                          type="button"
                          onClick={() => copy(open.videoLink)}
                          style={{ height: 38, padding: "0 12px", borderRadius: 9, border: `1px solid ${C.border}`, background: "#fff", fontWeight: 700, fontSize: 12.5, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}
                        >
                          {copied === open.videoLink ? <Check size={13} /> : <Copy size={13} />} {copied === open.videoLink ? "Copied" : "Copy"}
                        </button>
                      </div>
                    </>
                  ) : open.source !== "meeting" ? (
                    <VideoLinkEditor item={open} onSaved={onSaved} onToast={onToast} />
                  ) : (
                    <div style={{ fontSize: 12.5, color: C.slate }}>No join URL on this meeting yet.</div>
                  )}
                </div>
              ) : null}
            </div>

            <div style={{ padding: "14px 20px 18px", borderTop: `1px solid ${C.border}`, display: "grid", gap: 8, flexShrink: 0, background: "#fff" }}>
              {digitsInPhone(open.phone).length >= 7 ? (
                <button type="button" onClick={() => onCall(open)} style={actionBtn(C.cobalt, "#fff")}>
                  <PhoneCall size={14} /> Call now
                </button>
              ) : null}
              {open.source !== "meeting" ? (
                <button type="button" disabled={waBusy} onClick={() => sendWa(open)} style={actionBtn("#25D366", "#fff")}>
                  <MessageCircle size={14} /> {waBusy ? "Opening…" : "WhatsApp"}
                </button>
              ) : null}
              <div style={{ display: "flex", gap: 8 }}>
                {open.status !== "completed" && open.source !== "meeting" ? (
                  <button type="button" onClick={() => markDone(open)} style={{ ...actionBtn("#fff", C.ink, true), flex: 1 }}>
                    <Check size={14} /> Done
                  </button>
                ) : null}
                {open.source !== "meeting" ? (
                  <button type="button" onClick={() => remove(open)} style={{ ...actionBtn(C.redSoft, C.red), flex: 1 }}>
                    <Trash2 size={14} /> Remove
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
        );
      })()}
    </div>
  );
}

const calNavBtn = {
  width: 36,
  height: 36,
  borderRadius: 10,
  border: `1px solid ${C.border}`,
  background: "#fff",
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  color: C.ink,
};

function actionBtn(bg, color, border) {
  return {
    height: 42,
    borderRadius: 10,
    border: border ? `1px solid ${C.border}` : "none",
    background: bg,
    color,
    fontWeight: 700,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    fontSize: 13,
    width: "100%",
  };
}

function VideoLinkEditor({ item, onSaved, onToast }) {
  const [link, setLink] = useState(item.videoLink || "");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    const v = link.trim();
    if (!v || !looksLikeUrl(v)) {
      onToast("Paste a real join URL.");
      return;
    }
    setSaving(true);
    try {
      await api.updateScheduleItem(item.id, { videoLink: v, video_link: v });
      onToast("Join URL saved.");
      if (onSaved) await onSaved();
    } catch (e) {
      onToast(e.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };
  return (
    <div>
      <div style={{ fontSize: 12, color: C.slate, marginBottom: 8 }}>This booking has no join URL. Paste one:</div>
      <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://meet.google.com/…" style={{ ...fieldStyle(), marginBottom: 8 }} />
      <button type="button" disabled={saving} onClick={save} style={{ height: 36, padding: "0 12px", border: "none", borderRadius: 8, background: C.ink, color: "#fff", fontWeight: 700, cursor: "pointer" }}>
        {saving ? "Saving…" : "Save join URL"}
      </button>
    </div>
  );
}
