import React, { useState, useEffect } from "react";
import {
  CalendarCheck,
  Calendar,
  Clock,
  Video,
  CheckCircle2,
  AlertCircle,
  Link2,
  Copy,
  Check,
  Plus,
  Trash2,
  ExternalLink,
  ChevronRight,
  ChevronLeft,
  Mail,
  User,
  Settings,
  RefreshCw,
  X,
  Search,
  Filter,
  ArrowRight,
  ShieldCheck,
  Sparkles,
  Layers,
  Globe,
  LogOut,
  Building2
} from "lucide-react";
import { C, FONT_DISPLAY, FONT_BODY, FONT_MONO, HUB_PAPER, initialsFromName, meetingTimeLabel } from "../tokens";
import { api } from "../api/apiClient";

export function CalcomSchedulerPlugin({ operator, onBackToHub, onLogout, profile, commonAi, onOpenCommonAi }) {
  const [activeTab, setActiveTab] = useState("bookings"); // "bookings" | "eventTypes" | "directBook" | "availability" | "comms"
  const [loading, setLoading] = useState(false);
  const [overview, setOverview] = useState(null);
  const [bookings, setBookings] = useState([]);
  const [eventTypes, setEventTypes] = useState([]);
  const [settings, setSettings] = useState(null);
  const [statusInfo, setStatusInfo] = useState(null);

  // Direct Booking State
  const [selectedDate, setSelectedDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split("T")[0];
  });
  const [selectedEventType, setSelectedEventType] = useState("15-min-discovery");
  const [slots, setSlots] = useState([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState(null);

  const [prospectName, setProspectName] = useState("");
  const [attendeeEmail, setAttendeeEmail] = useState("");
  const [hostEmail, setHostEmail] = useState("");
  const [bookingNotes, setBookingNotes] = useState("");
  const [bookingInProgress, setBookingInProgress] = useState(false);
  const [bookingSuccessModal, setBookingSuccessModal] = useState(null);

  // Event Type Modal State
  const [showEventModal, setShowEventModal] = useState(false);
  const [editingEvent, setEditingEvent] = useState(null);
  const [eventForm, setEventForm] = useState({
    title: "",
    slug: "",
    length: 15,
    description: "",
    locationType: "google_meet",
    color: "#10B981"
  });

  // Cancellation Modal
  const [cancellingBooking, setCancellingBooking] = useState(null);
  const [cancelReason, setCancelReason] = useState("");

  // Copy notification
  const [copiedId, setCopiedId] = useState(null);

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const loadData = async () => {
    setLoading(true);
    try {
      const [ovRes, bkRes, etRes, stRes, connRes] = await Promise.allSettled([
        api.getCalcomOverview(),
        api.getCalcomBookings(),
        api.getCalcomEventTypes(),
        api.getCalcomSettings(),
        api.testCalcomConnection()
      ]);

      if (ovRes.status === "fulfilled") setOverview(ovRes.value);
      if (bkRes.status === "fulfilled") setBookings(bkRes.value);
      if (etRes.status === "fulfilled") setEventTypes(etRes.value);
      if (stRes.status === "fulfilled") {
        setSettings(stRes.value);
        if (stRes.value?.host_email) {
          setHostEmail(stRes.value.host_email);
        }
      }
      if (connRes.status === "fulfilled") setStatusInfo(connRes.value);
    } catch (e) {
      console.error("Error loading calcom data:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (!selectedDate) return;
    setSlotsLoading(true);
    setSelectedSlot(null);
    api.getCalcomSlots(selectedDate, selectedEventType)
      .then((res) => {
        setSlots(res?.slots || []);
      })
      .catch((err) => {
        console.error("Failed to load slots:", err);
        setSlots([]);
      })
      .finally(() => {
        setSlotsLoading(false);
      });
  }, [selectedDate, selectedEventType]);

  const handleCopy = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleCreateOrUpdateEventType = async (e) => {
    e.preventDefault();
    try {
      await api.createCalcomEventType({
        id: editingEvent ? editingEvent.id : undefined,
        ...eventForm
      });
      setShowEventModal(false);
      setEditingEvent(null);
      setEventForm({ title: "", slug: "", length: 15, description: "", locationType: "google_meet", color: "#10B981" });
      loadData();
    } catch (err) {
      alert(`Failed to save event type: ${err.message}`);
    }
  };

  const handleDeleteEventType = async (id) => {
    if (!window.confirm("Are you sure you want to delete this event type?")) return;
    try {
      await api.deleteCalcomEventType(id);
      loadData();
    } catch (err) {
      alert(`Failed to delete event type: ${err.message}`);
    }
  };

  const handleDirectBook = async (e) => {
    e.preventDefault();
    if (!selectedSlot) {
      alert("Please select a time slot first.");
      return;
    }
    if (!prospectName.trim() || !attendeeEmail.trim()) {
      alert("Please enter Attendee Name and Attendee Email.");
      return;
    }

    setBookingInProgress(true);
    try {
      const res = await api.bookCalcomMeeting({
        prospectName: prospectName.trim(),
        attendeeEmail: attendeeEmail.trim(),
        date: selectedDate,
        time: selectedSlot.time,
        hostEmail: hostEmail.trim() || settings?.host_email || "admin@aivhub.io",
        eventTypeSlug: selectedEventType,
        notes: bookingNotes.trim(),
        platform: "Google Meet",
        missionName: "Direct Scheduler"
      });

      setBookingSuccessModal(res);
      setProspectName("");
      setAttendeeEmail("");
      setBookingNotes("");
      setSelectedSlot(null);
      loadData();
    } catch (err) {
      alert(`Booking failed: ${err.message}`);
    } finally {
      setBookingInProgress(false);
    }
  };

  const handleConfirmCancel = async () => {
    if (!cancellingBooking) return;
    try {
      await api.cancelCalcomBooking(cancellingBooking.id, cancelReason || "Cancelled by host");
      setCancellingBooking(null);
      setCancelReason("");
      loadData();
    } catch (err) {
      alert(`Cancellation failed: ${err.message}`);
    }
  };

  const filteredBookings = bookings.filter((b) => {
    if (statusFilter !== "all" && b.status !== statusFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        b.prospect?.toLowerCase().includes(q) ||
        b.attendeeEmail?.toLowerCase().includes(q) ||
        b.hostEmail?.toLowerCase().includes(q) ||
        b.date?.includes(q) ||
        b.videoLink?.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div style={{ minHeight: "100vh", background: HUB_PAPER, fontFamily: FONT_BODY, display: "flex", flexDirection: "column" }}>
      {/* Top Header */}
      <header style={{ background: "#fff", borderBottom: `1px solid ${C.border}`, padding: "14px 32px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <button
            onClick={onBackToHub}
            style={{ display: "flex", alignItems: "center", gap: 6, border: `1px solid ${C.border}`, background: "#fff", borderRadius: 8, padding: "7px 12px", fontSize: 12.5, fontWeight: 600, color: C.slate, cursor: "pointer" }}
          >
            <ChevronLeft size={15} /> Back to Hub
          </button>
          <div style={{ height: 24, width: 1, background: C.border }} />
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 34, height: 34, borderRadius: 9, background: "linear-gradient(135deg, #10B981, #059669)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", boxShadow: "0 2px 8px rgba(16,185,129,0.25)" }}>
              <CalendarCheck size={18} />
            </div>
            <div>
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17, color: C.ink, display: "flex", alignItems: "center", gap: 8 }}>
                Meeting Scheduler (Cal.com)
                <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "#ECFDF5", color: "#059669", border: "1px solid #A7F3D0" }}>
                  v2.4
                </span>
              </div>
              <div style={{ fontSize: 11.5, color: C.slate }}>
                Direct appointment booking, event types management & automated Google Meet links
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {/* Host Mail ID Badge */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#F8FAFC", border: `1px solid ${C.border}`, borderRadius: 8, padding: "6px 12px", fontSize: 12 }}>
            <Mail size={14} color={C.slate} />
            <span style={{ color: C.slate }}>Host Mail:</span>
            <strong style={{ color: C.ink }}>{settings?.host_email || "admin@aivhub.io"}</strong>
          </div>

          {/* Connection Status Pill */}
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            background: statusInfo?.api_valid ? "#ECFDF5" : "#EFF6FF",
            border: `1px solid ${statusInfo?.api_valid ? "#A7F3D0" : "#BFDBFE"}`,
            borderRadius: 8,
            padding: "6px 12px",
            fontSize: 12,
            color: statusInfo?.api_valid ? "#065F46" : "#1E40AF"
          }}>
            <span style={{ width: 7, height: 7, borderRadius: 999, background: statusInfo?.api_valid ? "#10B981" : "#3B82F6" }} />
            <span>{statusInfo?.api_valid ? "Cal.com API Connected" : "Native Engine Active"}</span>
          </div>

          {/* Open Universal Config */}
          <button
            onClick={onOpenCommonAi}
            style={{ display: "flex", alignItems: "center", gap: 6, border: `1px solid ${C.border}`, background: "#fff", borderRadius: 8, padding: "7px 12px", fontSize: 12.5, fontWeight: 600, color: C.ink, cursor: "pointer" }}
            title="Configure Cal.com API key, host mail, and working hours"
          >
            <Settings size={14} color={C.cobalt} />
            Configure
          </button>

          <button
            onClick={onLogout}
            style={{ display: "flex", alignItems: "center", gap: 6, border: `1px solid ${C.border}`, background: "#fff", borderRadius: 8, padding: "7px 12px", fontSize: 12.5, fontWeight: 600, color: C.slate, cursor: "pointer" }}
          >
            <LogOut size={14} />
          </button>
        </div>
      </header>

      {/* Metrics Ribbon */}
      <div style={{ background: "#fff", borderBottom: `1px solid ${C.border}`, padding: "14px 32px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 16 }}>
          <div style={{ background: HUB_PAPER, border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 14px" }}>
            <div style={{ fontSize: 11.5, color: C.slate, fontWeight: 600 }}>Total Bookings</div>
            <div style={{ fontFamily: FONT_DISPLAY, fontSize: 20, fontWeight: 700, color: C.ink, marginTop: 2 }}>
              {overview?.totalBookings ?? bookings.length}
            </div>
          </div>
          <div style={{ background: HUB_PAPER, border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 14px" }}>
            <div style={{ fontSize: 11.5, color: "#059669", fontWeight: 600 }}>Upcoming Meetings</div>
            <div style={{ fontFamily: FONT_DISPLAY, fontSize: 20, fontWeight: 700, color: "#059669", marginTop: 2 }}>
              {overview?.upcomingCount ?? bookings.filter(b => b.status === "upcoming").length}
            </div>
          </div>
          <div style={{ background: HUB_PAPER, border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 14px" }}>
            <div style={{ fontSize: 11.5, color: C.cobalt, fontWeight: 600 }}>Completed / Converted</div>
            <div style={{ fontFamily: FONT_DISPLAY, fontSize: 20, fontWeight: 700, color: C.cobalt, marginTop: 2 }}>
              {overview?.completedCount ?? bookings.filter(b => b.status === "completed").length}
            </div>
          </div>
          <div style={{ background: HUB_PAPER, border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 14px" }}>
            <div style={{ fontSize: 11.5, color: "#6366F1", fontWeight: 600 }}>Event Types</div>
            <div style={{ fontFamily: FONT_DISPLAY, fontSize: 20, fontWeight: 700, color: "#6366F1", marginTop: 2 }}>
              {eventTypes.length}
            </div>
          </div>
          <div style={{ background: HUB_PAPER, border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 14px" }}>
            <div style={{ fontSize: 11.5, color: C.slate, fontWeight: 600 }}>Working Schedule</div>
            <div style={{ fontFamily: FONT_DISPLAY, fontSize: 13, fontWeight: 700, color: C.ink, marginTop: 4 }}>
              {settings?.working_hours_start || "09:00"}–{settings?.working_hours_end || "17:30"} {settings?.timezone || "Europe/London"}
            </div>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div style={{ display: "flex", gap: 6, padding: "0 32px", borderBottom: `1px solid ${C.border}`, background: "#fff" }}>
        {[
          { id: "bookings", label: `Upcoming Meetings (${bookings.filter(b => b.status === "upcoming").length})`, icon: Video },
          { id: "directBook", label: "1-Click Direct Booking & Slots", icon: CalendarCheck },
          { id: "eventTypes", label: `Event Types (${eventTypes.length})`, icon: Layers },
          { id: "availability", label: "Availability & Working Hours", icon: Clock },
          { id: "comms", label: "Email Notifications Log", icon: Mail },
        ].map((t) => {
          const Icon = t.icon;
          const active = activeTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "14px 18px",
                border: "none",
                borderBottom: active ? "3px solid #10B981" : "3px solid transparent",
                background: "transparent",
                color: active ? "#065F46" : C.slate,
                fontFamily: FONT_BODY,
                fontSize: 13,
                fontWeight: active ? 700 : 500,
                cursor: "pointer",
                transition: "all 0.15s",
              }}
            >
              <Icon size={16} color={active ? "#10B981" : C.slate} />
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* Main Content Area */}
      <main style={{ flex: 1, padding: "28px 32px", overflowY: "auto" }}>
        
        {/* TAB 1: BOOKINGS LIST */}
        {activeTab === "bookings" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Search & Actions Bar */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, maxWidth: 500 }}>
                <div style={{ position: "relative", width: "100%" }}>
                  <Search size={15} style={{ position: "absolute", left: 12, top: 11, color: C.slateLight }} />
                  <input
                    type="text"
                    placeholder="Search by attendee name, attendee email, host email, date..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "8px 12px 8px 36px",
                      borderRadius: 8,
                      border: `1px solid ${C.border}`,
                      fontSize: 13,
                      fontFamily: FONT_BODY,
                      outline: "none"
                    }}
                  />
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ display: "flex", background: "#fff", border: `1px solid ${C.border}`, borderRadius: 8, padding: 3 }}>
                  {["all", "upcoming", "completed", "cancelled"].map((st) => (
                    <button
                      key={st}
                      onClick={() => setStatusFilter(st)}
                      style={{
                        border: "none",
                        background: statusFilter === st ? "#10B981" : "transparent",
                        color: statusFilter === st ? "#fff" : C.slate,
                        padding: "5px 12px",
                        borderRadius: 6,
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: "pointer",
                        textTransform: "capitalize"
                      }}
                    >
                      {st}
                    </button>
                  ))}
                </div>

                <button
                  onClick={() => setActiveTab("directBook")}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    background: "#10B981",
                    color: "#fff",
                    border: "none",
                    borderRadius: 8,
                    padding: "8px 16px",
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: "pointer",
                    boxShadow: "0 2px 8px rgba(16,185,129,0.25)"
                  }}
                >
                  <Plus size={15} /> Book New Meeting
                </button>
              </div>
            </div>

            {/* Bookings Grid / Table */}
            {filteredBookings.length === 0 ? (
              <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, padding: "48px 24px", textAlign: "center" }}>
                <CalendarCheck size={40} color={C.slateLight} style={{ margin: "0 auto 12px" }} />
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, color: C.ink }}>No scheduled meetings found</div>
                <div style={{ fontSize: 13, color: C.slate, marginTop: 4 }}>
                  Use the 1-Click Direct Booking tab or book from the Lead Gen and Voice plugins.
                </div>
                <button
                  onClick={() => setActiveTab("directBook")}
                  style={{
                    marginTop: 16,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    background: "#10B981",
                    color: "#fff",
                    border: "none",
                    borderRadius: 8,
                    padding: "8px 18px",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer"
                  }}
                >
                  <Plus size={15} /> Book a Meeting Now
                </button>
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
                {filteredBookings.map((m) => {
                  const isUpcoming = m.status === "upcoming";
                  const isCancelled = m.status === "cancelled";
                  return (
                    <div
                      key={m.id}
                      style={{
                        background: "#fff",
                        border: `1px solid ${isCancelled ? "#FEE2E2" : C.border}`,
                        borderRadius: 12,
                        padding: "16px 20px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 16,
                        boxShadow: C.shadowCard
                      }}
                    >
                      {/* Left Date/Time Badge */}
                      <div style={{ display: "flex", alignItems: "center", gap: 16, minWidth: 260 }}>
                        <div style={{
                          width: 54,
                          height: 54,
                          borderRadius: 10,
                          background: isCancelled ? "#FEF2F2" : "#ECFDF5",
                          border: `1px solid ${isCancelled ? "#FCA5A5" : "#A7F3D0"}`,
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          justifyContent: "center"
                        }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color: isCancelled ? "#DC2626" : "#059669", textTransform: "uppercase" }}>
                            {m.date ? new Date(m.date).toLocaleString('en-US', { month: 'short' }) : "MEET"}
                          </span>
                          <span style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 700, color: isCancelled ? "#DC2626" : "#065F46" }}>
                            {m.date ? m.date.split("-")[2] : "--"}
                          </span>
                        </div>

                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, color: C.ink }}>
                              {m.prospect}
                            </span>
                            <span style={{
                              fontSize: 11,
                              fontWeight: 700,
                              padding: "2px 7px",
                              borderRadius: 6,
                              background: isCancelled ? "#FEE2E2" : (isUpcoming ? "#ECFDF5" : "#F1F5F9"),
                              color: isCancelled ? "#DC2626" : (isUpcoming ? "#059669" : C.slate)
                            }}>
                              {m.status}
                            </span>
                          </div>
                          
                          {/* Attendee Email Highlighted */}
                          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: C.slate, marginTop: 3 }}>
                            <Mail size={12} color={C.cobalt} />
                            <span>Attendee:</span>
                            <strong style={{ color: C.ink, fontFamily: FONT_MONO, fontSize: 11.5 }}>
                              {m.attendeeEmail || "no-email-provided@aivhub.io"}
                            </strong>
                          </div>

                          {/* Host Email Highlighted */}
                          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: C.slate, marginTop: 2 }}>
                            <User size={12} color={C.slate} />
                            <span>Host: {m.host}</span>
                            <span>•</span>
                            <span style={{ fontFamily: FONT_MONO, fontSize: 11 }}>{m.hostEmail || settings?.host_email}</span>
                          </div>
                        </div>
                      </div>

                      {/* Middle: Timing & Platform Details */}
                      <div style={{ flex: 1, padding: "0 16px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 12.5, color: C.ink, fontWeight: 600 }}>
                          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                            <Clock size={14} color={C.slate} /> {meetingTimeLabel(m)} ({m.duration || "15 min"})
                          </span>
                          <span>•</span>
                          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                            <Video size={14} color="#10B981" /> {m.platform || "Google Meet"}
                          </span>
                        </div>
                        <div style={{ fontSize: 11.5, color: C.slate, marginTop: 4 }}>
                          Ref: <code style={{ fontFamily: FONT_MONO, background: "#F1F5F9", padding: "1px 5px", borderRadius: 4 }}>{m.calcomBookingId || m.id}</code>
                          {m.prep && <span style={{ marginLeft: 8 }}>— {m.prep}</span>}
                          {m.cancellationReason && (
                            <span style={{ color: "#DC2626", marginLeft: 8 }}>
                              Cancelled: "{m.cancellationReason}"
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Right: Actions */}
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {m.videoLink && (
                          <a
                            href={m.videoLink}
                            target="_blank"
                            rel="noreferrer"
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 6,
                              background: "#ECFDF5",
                              color: "#059669",
                              border: "1px solid #A7F3D0",
                              borderRadius: 8,
                              padding: "7px 14px",
                              fontSize: 12.5,
                              fontWeight: 700,
                              textDecoration: "none",
                              cursor: "pointer"
                            }}
                          >
                            <Video size={14} /> Join Google Meet <ExternalLink size={12} />
                          </a>
                        )}

                        <button
                          onClick={() => handleCopy(m.videoLink || m.id, m.id)}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                            border: `1px solid ${C.border}`,
                            background: "#fff",
                            borderRadius: 8,
                            padding: "7px 10px",
                            fontSize: 12,
                            color: C.slate,
                            cursor: "pointer"
                          }}
                          title="Copy Link"
                        >
                          {copiedId === m.id ? <Check size={14} color="#10B981" /> : <Copy size={14} />}
                        </button>

                        {isUpcoming && (
                          <button
                            onClick={() => {
                              setCancellingBooking(m);
                              setCancelReason("");
                            }}
                            style={{
                              border: "1px solid #FECACA",
                              background: "#FEF2F2",
                              color: "#DC2626",
                              borderRadius: 8,
                              padding: "7px 12px",
                              fontSize: 12,
                              fontWeight: 600,
                              cursor: "pointer"
                            }}
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB 2: DIRECT BOOK & SLOTS */}
        {activeTab === "directBook" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: 24 }}>
            <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 14, padding: "22px 24px" }}>
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, color: C.ink, marginBottom: 14 }}>
                1. Select Date & Event Type
              </div>

              <label style={{ fontSize: 12, fontWeight: 600, color: C.slate, display: "block", marginBottom: 6 }}>
                Meeting Type
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 18 }}>
                {eventTypes.map((et) => {
                  const selected = selectedEventType === et.slug;
                  return (
                    <button
                      key={et.slug}
                      type="button"
                      onClick={() => setSelectedEventType(et.slug)}
                      style={{
                        border: selected ? "2px solid #10B981" : `1px solid ${C.border}`,
                        background: selected ? "#ECFDF5" : "#fff",
                        borderRadius: 8,
                        padding: "10px 8px",
                        textAlign: "center",
                        cursor: "pointer",
                        transition: "all 0.15s"
                      }}
                    >
                      <div style={{ fontFamily: FONT_DISPLAY, fontSize: 13, fontWeight: 700, color: selected ? "#065F46" : C.ink }}>
                        {et.length} Mins
                      </div>
                      <div style={{ fontSize: 11, color: C.slate, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {et.title}
                      </div>
                    </button>
                  );
                })}
              </div>

              <label style={{ fontSize: 12, fontWeight: 600, color: C.slate, display: "block", marginBottom: 6 }}>
                Meeting Date
              </label>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "9px 12px",
                  borderRadius: 8,
                  border: `1px solid ${C.border}`,
                  fontFamily: FONT_BODY,
                  fontSize: 13,
                  fontWeight: 600,
                  marginBottom: 10
                }}
              />

              <div style={{ display: "flex", gap: 6, marginBottom: 20 }}>
                {[
                  { label: "Today", days: 0 },
                  { label: "Tomorrow", days: 1 },
                  { label: "+2 Days", days: 2 },
                  { label: "Next Mon", days: (8 - new Date().getDay()) % 7 || 7 },
                ].map((q) => {
                  const target = new Date();
                  target.setDate(target.getDate() + q.days);
                  const dtStr = target.toISOString().split("T")[0];
                  return (
                    <button
                      key={q.label}
                      type="button"
                      onClick={() => setSelectedDate(dtStr)}
                      style={{
                        flex: 1,
                        padding: "5px 8px",
                        borderRadius: 6,
                        border: `1px solid ${selectedDate === dtStr ? "#10B981" : C.border}`,
                        background: selectedDate === dtStr ? "#ECFDF5" : "#fff",
                        color: selectedDate === dtStr ? "#059669" : C.slate,
                        fontSize: 11.5,
                        fontWeight: 600,
                        cursor: "pointer"
                      }}
                    >
                      {q.label}
                    </button>
                  );
                })}
              </div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: C.ink }}>
                  Available Slots ({slots.filter(s => s.available).length})
                </span>
                <span style={{ fontSize: 11, color: C.slate }}>
                  Timezone: {settings?.timezone || "Europe/London"}
                </span>
              </div>

              {slotsLoading ? (
                <div style={{ padding: "30px", textAlign: "center", color: C.slate, fontSize: 13 }}>
                  <RefreshCw size={18} className="spin" style={{ margin: "0 auto 8px" }} />
                  Calculating slot availability...
                </div>
              ) : slots.length === 0 ? (
                <div style={{ padding: "24px", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 8, textAlign: "center", color: "#DC2626", fontSize: 12.5 }}>
                  No open slots on this date (weekend or non-working day).
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, maxHeight: 250, overflowY: "auto", paddingRight: 4 }}>
                  {slots.map((s) => {
                    const isSelected = selectedSlot?.time === s.time;
                    return (
                      <button
                        key={s.time}
                        type="button"
                        disabled={!s.available}
                        onClick={() => setSelectedSlot(s)}
                        style={{
                          border: isSelected ? "2px solid #10B981" : `1px solid ${C.border}`,
                          background: isSelected ? "#10B981" : (s.available ? "#fff" : "#F8FAFC"),
                          color: isSelected ? "#fff" : (s.available ? C.ink : C.slateLight),
                          padding: "8px 6px",
                          borderRadius: 7,
                          fontFamily: FONT_MONO,
                          fontSize: 12,
                          fontWeight: 700,
                          cursor: s.available ? "pointer" : "not-allowed",
                          opacity: s.available ? 1 : 0.45,
                          transition: "all 0.1s"
                        }}
                      >
                        {s.displayTime || s.time}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <form onSubmit={handleDirectBook} style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 14, padding: "22px 24px", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, color: C.ink, marginBottom: 4 }}>
                  2. Attendee & Meeting Details
                </div>
                <div style={{ fontSize: 12, color: C.slate, marginBottom: 18 }}>
                  Meeting confirmation & Google Meet invite will be automatically dispatched to attendee and host mail IDs.
                </div>

                <div style={{ background: selectedSlot ? "#ECFDF5" : "#F8FAFC", border: `1px solid ${selectedSlot ? "#A7F3D0" : C.border}`, borderRadius: 10, padding: "12px 16px", marginBottom: 18, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: selectedSlot ? "#059669" : C.slate, textTransform: "uppercase" }}>
                      Selected Slot
                    </div>
                    <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, color: C.ink, marginTop: 2 }}>
                      {selectedSlot ? `${selectedDate} at ${selectedSlot.displayTime || selectedSlot.time}` : "No slot selected yet"}
                    </div>
                  </div>
                  {selectedSlot && (
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#059669", background: "#fff", padding: "4px 8px", borderRadius: 6, border: "1px solid #A7F3D0" }}>
                      Ready to Book
                    </span>
                  )}
                </div>

                <div style={{ marginBottom: 14 }}>
                  <label style={{ fontSize: 12, fontWeight: 700, color: C.ink, display: "block", marginBottom: 5 }}>
                    Attendee Name *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Sarah Jenkins"
                    value={prospectName}
                    onChange={(e) => setProspectName(e.target.value)}
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      padding: "9px 12px",
                      borderRadius: 8,
                      border: `1px solid ${C.border}`,
                      fontSize: 13,
                      fontFamily: FONT_BODY
                    }}
                  />
                </div>

                <div style={{ marginBottom: 14 }}>
                  <label style={{ fontSize: 12, fontWeight: 700, color: C.ink, display: "block", marginBottom: 5 }}>
                    Attendee Email (Mail ID) *
                  </label>
                  <input
                    type="email"
                    required
                    placeholder="sarah.jenkins@acme-logistics.co.uk"
                    value={attendeeEmail}
                    onChange={(e) => setAttendeeEmail(e.target.value)}
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      padding: "9px 12px",
                      borderRadius: 8,
                      border: `1px solid ${C.border}`,
                      fontSize: 13,
                      fontFamily: FONT_MONO,
                      fontWeight: 500
                    }}
                  />
                </div>

                <div style={{ marginBottom: 14 }}>
                  <label style={{ fontSize: 12, fontWeight: 700, color: C.ink, display: "block", marginBottom: 5 }}>
                    Host Organizer Mail ID
                  </label>
                  <input
                    type="email"
                    placeholder="admin@aivhub.io"
                    value={hostEmail}
                    onChange={(e) => setHostEmail(e.target.value)}
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      padding: "9px 12px",
                      borderRadius: 8,
                      border: `1px solid ${C.border}`,
                      fontSize: 13,
                      fontFamily: FONT_MONO,
                      background: "#F8FAFC"
                    }}
                  />
                  <div style={{ fontSize: 11, color: C.slate, marginTop: 3 }}>
                    Organizer invites and reply-to notifications will be attached to this address.
                  </div>
                </div>

                <div style={{ marginBottom: 14 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: C.slate, display: "block", marginBottom: 5 }}>
                    Meeting Notes / Objective (Optional)
                  </label>
                  <textarea
                    rows={2}
                    placeholder="e.g. Discuss AI dispatch automation roadmap and Mid-Market pricing..."
                    value={bookingNotes}
                    onChange={(e) => setBookingNotes(e.target.value)}
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      padding: "8px 12px",
                      borderRadius: 8,
                      border: `1px solid ${C.border}`,
                      fontSize: 12.5,
                      fontFamily: FONT_BODY,
                      resize: "vertical"
                    }}
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={!selectedSlot || bookingInProgress}
                style={{
                  width: "100%",
                  padding: "12px",
                  borderRadius: 8,
                  border: "none",
                  background: (!selectedSlot || bookingInProgress) ? C.slateLight : "#10B981",
                  color: "#fff",
                  fontFamily: FONT_DISPLAY,
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: (!selectedSlot || bookingInProgress) ? "not-allowed" : "pointer",
                  boxShadow: "0 2px 10px rgba(16,185,129,0.25)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  marginTop: 10
                }}
              >
                {bookingInProgress ? (
                  <>
                    <RefreshCw size={16} className="spin" /> Booking Meeting & Generating Google Meet...
                  </>
                ) : (
                  <>
                    <CalendarCheck size={16} /> Confirm & Schedule Meeting
                  </>
                )}
              </button>
            </form>
          </div>
        )}

        {/* TAB 3: EVENT TYPES */}
        {activeTab === "eventTypes" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, color: C.ink }}>
                  Cal.com Event Types
                </div>
                <div style={{ fontSize: 12.5, color: C.slate, marginTop: 2 }}>
                  Pre-configured meeting templates with customized durations, descriptions, and Google Meet locations.
                </div>
              </div>

              <button
                onClick={() => {
                  setEditingEvent(null);
                  setEventForm({ title: "", slug: "", length: 15, description: "", locationType: "google_meet", color: "#10B981" });
                  setShowEventModal(true);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  background: "#10B981",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  padding: "8px 16px",
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: "pointer"
                }}
              >
                <Plus size={15} /> Add Event Type
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
              {eventTypes.map((et) => (
                <div
                  key={et.id}
                  style={{
                    background: "#fff",
                    border: `1px solid ${C.border}`,
                    borderRadius: 12,
                    padding: "18px 20px",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    boxShadow: C.shadowCard
                  }}
                >
                  <div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ width: 10, height: 10, borderRadius: 999, background: et.color || "#10B981" }} />
                        <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, color: C.ink }}>
                          {et.title}
                        </span>
                      </div>
                      <span style={{ fontSize: 11.5, fontWeight: 700, padding: "2px 8px", borderRadius: 6, background: "#ECFDF5", color: "#059669", border: "1px solid #A7F3D0" }}>
                        {et.length} Mins
                      </span>
                    </div>

                    <div style={{ fontSize: 12.5, color: C.slate, lineHeight: 1.5, marginBottom: 14 }}>
                      {et.description || "No description provided."}
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 12, color: C.slate }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <Video size={13} color="#10B981" /> Google Meet
                      </span>
                      <span>•</span>
                      <span style={{ fontFamily: FONT_MONO, color: C.ink, fontSize: 11.5 }}>
                        /book/{et.slug}
                      </span>
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 18, paddingTop: 14, borderTop: `1px solid ${C.border}` }}>
                    <button
                      onClick={() => handleCopy(`${window.location.origin}/book/${et.slug}`, et.id)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        border: `1px solid ${C.border}`,
                        background: "#fff",
                        borderRadius: 6,
                        padding: "5px 10px",
                        fontSize: 12,
                        fontWeight: 600,
                        color: C.ink,
                        cursor: "pointer"
                      }}
                    >
                      {copiedId === et.id ? <Check size={13} color="#10B981" /> : <Copy size={13} />}
                      <span>{copiedId === et.id ? "Copied!" : "Copy Link"}</span>
                    </button>

                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <button
                        onClick={() => {
                          setSelectedEventType(et.slug);
                          setActiveTab("directBook");
                        }}
                        style={{
                          border: "none",
                          background: "#ECFDF5",
                          color: "#059669",
                          borderRadius: 6,
                          padding: "5px 10px",
                          fontSize: 12,
                          fontWeight: 700,
                          cursor: "pointer"
                        }}
                      >
                        Book Slot
                      </button>
                      <button
                        onClick={() => handleDeleteEventType(et.id)}
                        style={{
                          border: "none",
                          background: "transparent",
                          color: "#DC2626",
                          padding: 5,
                          cursor: "pointer"
                        }}
                        title="Delete Event Type"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 4: AVAILABILITY */}
        {activeTab === "availability" && (
          <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 14, padding: "24px 28px", maxWidth: 800 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
              <div>
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17, color: C.ink }}>
                  Active Availability & Working Hours
                </div>
                <div style={{ fontSize: 12.5, color: C.slate, marginTop: 2 }}>
                  Calculated dynamically across all direct booking requests and Cal.com API queries.
                </div>
              </div>
              <button
                onClick={onOpenCommonAi}
                style={{ display: "flex", alignItems: "center", gap: 6, border: `1px solid ${C.border}`, background: "#fff", borderRadius: 8, padding: "7px 14px", fontSize: 12.5, fontWeight: 600, color: C.cobalt, cursor: "pointer" }}
              >
                <Settings size={14} /> Edit in Universal Config
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, marginBottom: 24 }}>
              <div style={{ background: HUB_PAPER, border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 16px" }}>
                <div style={{ fontSize: 12, color: C.slate, fontWeight: 600 }}>Daily Working Window</div>
                <div style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 700, color: C.ink, marginTop: 4 }}>
                  {settings?.working_hours_start || "09:00"} — {settings?.working_hours_end || "17:30"}
                </div>
                <div style={{ fontSize: 11.5, color: C.slate, marginTop: 2 }}>
                  Standard business operating window
                </div>
              </div>

              <div style={{ background: HUB_PAPER, border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 16px" }}>
                <div style={{ fontSize: 12, color: C.slate, fontWeight: 600 }}>Workspace Timezone</div>
                <div style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 700, color: C.ink, marginTop: 4 }}>
                  {settings?.timezone || "Europe/London"}
                </div>
                <div style={{ fontSize: 11.5, color: C.slate, marginTop: 2 }}>
                  All slot calculations normalized to this zone
                </div>
              </div>
            </div>

            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, marginBottom: 8 }}>Active Working Days</div>
              <div style={{ display: "flex", gap: 8 }}>
                {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((d) => {
                  const active = (settings?.working_days || ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]).includes(d);
                  return (
                    <div
                      key={d}
                      style={{
                        padding: "8px 14px",
                        borderRadius: 8,
                        border: `1px solid ${active ? "#A7F3D0" : C.border}`,
                        background: active ? "#ECFDF5" : "#F8FAFC",
                        color: active ? "#065F46" : C.slateLight,
                        fontSize: 12.5,
                        fontWeight: 700
                      }}
                    >
                      {d}
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={{ background: "#F8FAFC", border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>Buffer Periods</div>
                <div style={{ fontSize: 12, color: C.slate, marginTop: 2 }}>
                  {settings?.buffer_before || 5} mins before meeting • {settings?.buffer_after || 5} mins after meeting
                </div>
              </div>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: "#059669", background: "#ECFDF5", padding: "4px 8px", borderRadius: 6 }}>
                Active Guardrail
              </span>
            </div>
          </div>
        )}

        {/* TAB 5: COMMS */}
        {activeTab === "comms" && (
          <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 14, padding: "24px 28px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
              <div>
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17, color: C.ink }}>
                  Meeting Email Communications Log
                </div>
                <div style={{ fontSize: 12.5, color: C.slate, marginTop: 2 }}>
                  Audit record of calendar invites and confirmation notifications delivered to attendees and host.
                </div>
              </div>
              <button
                onClick={loadData}
                style={{ display: "flex", alignItems: "center", gap: 6, border: `1px solid ${C.border}`, background: "#fff", borderRadius: 8, padding: "6px 12px", fontSize: 12, color: C.slate, cursor: "pointer" }}
              >
                <RefreshCw size={13} /> Refresh Log
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {bookings.slice(0, 10).map((b) => (
                <div
                  key={b.id}
                  style={{
                    background: HUB_PAPER,
                    border: `1px solid ${C.border}`,
                    borderRadius: 10,
                    padding: "12px 16px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between"
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: "#ECFDF5", color: "#059669", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Mail size={16} />
                    </div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>
                        Calendar Invite: {b.prospect}
                      </div>
                      <div style={{ fontSize: 11.5, color: C.slate, marginTop: 2 }}>
                        Delivered to Attendee: <strong style={{ color: C.ink }}>{b.attendeeEmail || "default@example.com"}</strong> • Host: <strong style={{ color: C.ink }}>{b.hostEmail || settings?.host_email}</strong>
                      </div>
                    </div>
                  </div>

                  <div style={{ textAlign: "right" }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#059669", background: "#ECFDF5", border: "1px solid #A7F3D0", padding: "3px 8px", borderRadius: 6 }}>
                      Delivered
                    </span>
                    <div style={{ fontSize: 11, color: C.slate, marginTop: 3 }}>
                      {b.date} {b.time}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

      </main>

      {/* Booking Success Modal */}
      {bookingSuccessModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 16, width: 520, padding: "28px 32px", boxShadow: "0 24px 48px rgba(0,0,0,0.2)" }}>
            <div style={{ width: 48, height: 48, borderRadius: 12, background: "#ECFDF5", color: "#059669", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
              <CheckCircle2 size={28} />
            </div>

            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 20, color: C.ink, textAlign: "center", marginBottom: 6 }}>
              Meeting Successfully Confirmed!
            </div>
            <div style={{ fontSize: 13, color: C.slate, textAlign: "center", marginBottom: 22 }}>
              The meeting has been recorded and Google Meet details generated.
            </div>

            <div style={{ background: HUB_PAPER, border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8, marginBottom: 20, fontSize: 12.5 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: C.slate }}>Attendee:</span>
                <strong style={{ color: C.ink }}>{bookingSuccessModal.prospect} ({bookingSuccessModal.attendeeEmail})</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: C.slate }}>Host Mail ID:</span>
                <strong style={{ color: C.ink }}>{bookingSuccessModal.hostEmail}</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: C.slate }}>Date & Time:</span>
                <strong style={{ color: C.ink }}>{bookingSuccessModal.date} at {bookingSuccessModal.time}</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: C.slate }}>Booking UID:</span>
                <code style={{ fontFamily: FONT_MONO, color: C.cobalt }}>{bookingSuccessModal.bookingId}</code>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 8, borderTop: `1px solid ${C.border}` }}>
                <span style={{ color: C.slate }}>Google Meet Link:</span>
                <a
                  href={bookingSuccessModal.videoLink}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "#059669", fontWeight: 700, display: "flex", alignItems: "center", gap: 4, textDecoration: "none" }}
                >
                  Launch Meet <ExternalLink size={12} />
                </a>
              </div>
            </div>

            <button
              onClick={() => {
                setBookingSuccessModal(null);
                setActiveTab("bookings");
              }}
              style={{
                width: "100%",
                padding: "11px",
                background: "#10B981",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                fontFamily: FONT_DISPLAY,
                fontSize: 14,
                fontWeight: 700,
                cursor: "pointer"
              }}
            >
              View in Scheduled Meetings
            </button>
          </div>
        </div>
      )}

      {/* Cancellation Modal */}
      {cancellingBooking && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 16, width: 460, padding: "24px 28px" }}>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17, color: C.ink, marginBottom: 6 }}>
              Cancel Scheduled Meeting
            </div>
            <div style={{ fontSize: 12.5, color: C.slate, marginBottom: 16 }}>
              Are you sure you want to cancel the meeting with <strong>{cancellingBooking.prospect}</strong> on {cancellingBooking.date}?
            </div>

            <label style={{ fontSize: 12, fontWeight: 600, color: C.ink, display: "block", marginBottom: 5 }}>
              Cancellation Reason
            </label>
            <textarea
              rows={3}
              placeholder="e.g. Schedule conflict, client requested reschedule..."
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "8px 12px",
                borderRadius: 8,
                border: `1px solid ${C.border}`,
                fontSize: 12.5,
                fontFamily: FONT_BODY,
                marginBottom: 18
              }}
            />

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button
                type="button"
                onClick={() => setCancellingBooking(null)}
                style={{ padding: "8px 16px", borderRadius: 8, border: `1px solid ${C.border}`, background: "#fff", fontSize: 12.5, fontWeight: 600, color: C.slate, cursor: "pointer" }}
              >
                Keep Meeting
              </button>
              <button
                type="button"
                onClick={handleConfirmCancel}
                style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "#DC2626", color: "#fff", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}
              >
                Confirm Cancellation
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit Event Type Modal */}
      {showEventModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, padding: 16 }}>
          <form onSubmit={handleCreateOrUpdateEventType} style={{ background: "#fff", borderRadius: 16, width: 480, padding: "24px 28px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17, color: C.ink }}>
                {editingEvent ? "Edit Event Type" : "Create New Event Type"}
              </div>
              <button type="button" onClick={() => setShowEventModal(false)} style={{ border: "none", background: "transparent", cursor: "pointer", color: C.slate }}>
                <X size={18} />
              </button>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: C.ink, display: "block", marginBottom: 5 }}>Title *</label>
              <input
                type="text"
                required
                placeholder="e.g. 20 Min Consultation"
                value={eventForm.title}
                onChange={(e) => setEventForm({ ...eventForm, title: e.target.value })}
                style={{ width: "100%", boxSizing: "border-box", padding: "8px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13 }}
              />
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: C.ink, display: "block", marginBottom: 5 }}>Duration (Minutes) *</label>
              <select
                value={eventForm.length}
                onChange={(e) => setEventForm({ ...eventForm, length: parseInt(e.target.value, 10) })}
                style={{ width: "100%", boxSizing: "border-box", padding: "8px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13 }}
              >
                <option value={15}>15 Minutes</option>
                <option value={20}>20 Minutes</option>
                <option value={30}>30 Minutes</option>
                <option value={45}>45 Minutes</option>
                <option value={60}>60 Minutes</option>
              </select>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: C.slate, display: "block", marginBottom: 5 }}>Description</label>
              <textarea
                rows={3}
                placeholder="Brief summary of agenda and meeting scope..."
                value={eventForm.description}
                onChange={(e) => setEventForm({ ...eventForm, description: e.target.value })}
                style={{ width: "100%", boxSizing: "border-box", padding: "8px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 12.5 }}
              />
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18 }}>
              <button
                type="button"
                onClick={() => setShowEventModal(false)}
                style={{ padding: "8px 16px", borderRadius: 8, border: `1px solid ${C.border}`, background: "#fff", fontSize: 12.5, fontWeight: 600, color: C.slate, cursor: "pointer" }}
              >
                Cancel
              </button>
              <button
                type="submit"
                style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "#10B981", color: "#fff", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}
              >
                Save Event Type
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
