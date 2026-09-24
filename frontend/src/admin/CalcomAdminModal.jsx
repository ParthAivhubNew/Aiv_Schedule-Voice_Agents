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
  Code2,
  Bell,
  Sliders,
  QrCode,
  Download,
  CalendarDays,
  Send,
  Eye,
  Laptop,
  Server,
  KeyRound,
  Inbox,
  Workflow
} from "lucide-react";
import { C, FONT_DISPLAY, FONT_BODY, FONT_MONO, meetingTimeLabel } from "../tokens";
import { api } from "../api/apiClient";
import { MeetingInvitePreview } from "../components/MeetingInvitePreview";

export function CalcomAdminModal({ isOpen, onClose, operator, initialTab = "accounts" }) {
  const [activeTab, setActiveTab] = useState(initialTab || "accounts");
  const [loading, setLoading] = useState(false);
  const [overview, setOverview] = useState(null);
  const [bookings, setBookings] = useState([]);
  const [eventTypes, setEventTypes] = useState([]);
  const [settings, setSettings] = useState(null);
  const [statusInfo, setStatusInfo] = useState(null);
  const [accounts, setAccounts] = useState([]);

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

  // Reschedule Modal State
  const [reschedulingBooking, setReschedulingBooking] = useState(null);
  const [rescheduleDate, setRescheduleDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 2);
    return d.toISOString().split("T")[0];
  });
  const [rescheduleSlots, setRescheduleSlots] = useState([]);
  const [rescheduleSlot, setRescheduleSlot] = useState(null);
  const [rescheduleReason, setRescheduleReason] = useState("");
  const [reschedulingLoading, setReschedulingLoading] = useState(false);

  // Cancellation Modal
  const [cancellingBooking, setCancellingBooking] = useState(null);
  const [cancelReason, setCancelReason] = useState("");

  // Event Type Modal State
  const [showEventModal, setShowEventModal] = useState(false);
  const [eventForm, setEventForm] = useState({
    title: "",
    slug: "",
    length: 15,
    description: "",
    locationType: "google_meet",
    color: "#10B981"
  });

  // Embed Modal State
  const [embedEventSlug, setEmbedEventSlug] = useState("15-min-discovery");
  const [embedCodeType, setEmbedCodeType] = useState("inline");

  // Communication Accounts Modal State
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [editingAccount, setEditingAccount] = useState(null);
  const [accountForm, setAccountForm] = useState({
    id: "",
    provider: "google",
    name: "",
    email: "",
    senderName: "",
    password: "",
    smtpHost: "smtp.gmail.com",
    smtpPort: 587,
    useTls: true,
    syncCalendar: true,
    sendInvites: true,
    isPrimary: true
  });
  const [accountTesting, setAccountTesting] = useState(false);
  const [accountTestResult, setAccountTestResult] = useState(null);
  const [disconnectAccount, setDisconnectAccount] = useState(null);
  const [disconnectBusy, setDisconnectBusy] = useState(false);

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  // Notifications
  const [copiedId, setCopiedId] = useState(null);
  const [saveMessage, setSaveMessage] = useState("");
  const [calApiKey, setCalApiKey] = useState("");
  const [calBaseUrl, setCalBaseUrl] = useState("");
  const [showDeveloperOptions, setShowDeveloperOptions] = useState(false);

  // Working Hours State
  const [workingSchedule, setWorkingSchedule] = useState({
    days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
    start: "09:00",
    end: "17:30",
    timezone: "Europe/London",
    prospectTimezoneOverride: "",
    hoursByDay: {},
    slotStep: 15,
    flexMinutes: 0,
    bufferBefore: 5,
    bufferAfter: 5
  });

  useEffect(() => {
    const allowed = new Set(["accounts", "embeds", "webConsole", "settings"]);
    const next = allowed.has(initialTab) ? initialTab : "accounts";
    setActiveTab(next);
  }, [initialTab, isOpen]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [ov, bk, et, st, cs, acc] = await Promise.all([
        api.getCalcomOverview().catch(() => null),
        api.getCalcomBookings().catch(() => []),
        api.getCalcomEventTypes().catch(() => []),
        api.getCalcomSettings().catch(() => null),
        api.testCalcomConnection().catch(() => null),
        api.getCalcomAccounts().catch(() => [])
      ]);

      if (ov) setOverview(ov);
      if (bk) setBookings(bk);
      if (et) setEventTypes(et);
      if (acc && acc.length) setAccounts(acc);
      if (st) {
        setSettings(st);
        setHostEmail(st.host_email || operator?.email || "admin@aivhub.io");
        setCalApiKey(st.api_key || "");
        setCalBaseUrl(st.base_url || "");
        setWorkingSchedule({
          days: st.working_days || ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
          start: st.working_hours_start || "09:00",
          end: st.working_hours_end || "17:30",
          timezone: st.timezone || "Europe/London",
          prospectTimezoneOverride: st.prospect_timezone_override || "",
          hoursByDay: st.working_hours_by_day || {},
          slotStep: st.slot_step_minutes || 15,
          flexMinutes: st.flex_minutes || 0,
          bufferBefore: st.buffer_before ?? 5,
          bufferAfter: st.buffer_after ?? 5
        });
      }
      if (cs) setStatusInfo(cs);
    } catch (e) {
      console.error("Error loading calcom data:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && selectedDate) {
      fetchSlots(selectedDate, selectedEventType);
    }
  }, [isOpen, selectedDate, selectedEventType]);

  const fetchSlots = async (date, slug) => {
    setSlotsLoading(true);
    try {
      const res = await api.getCalcomSlots(date, slug);
      if (res && res.slots) {
        setSlots(res.slots);
        if (res.slots.length > 0) {
          const firstAvail = res.slots.find(s => s.available);
          setSelectedSlot(firstAvail ? firstAvail.time : res.slots[0].time);
        }
      }
    } catch (e) {
      setSlots([]);
    } finally {
      setSlotsLoading(false);
    }
  };

  const fetchRescheduleSlots = async (date, slug) => {
    try {
      const res = await api.getCalcomSlots(date, slug || "15-min-discovery");
      if (res && res.slots) {
        setRescheduleSlots(res.slots);
        const firstAvail = res.slots.find(s => s.available);
        setRescheduleSlot(firstAvail ? firstAvail.time : (res.slots[0]?.time || "10:00"));
      }
    } catch (_) {
      setRescheduleSlots([]);
    }
  };

  const handleCopy = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2500);
  };

  const handleSaveSettings = async (customPayload) => {
    setLoading(true);
    setSaveMessage("");
    try {
      const payload = customPayload || {
        ...settings,
        host_email: hostEmail,
        working_days: workingSchedule.days,
        working_hours_start: workingSchedule.start,
        working_hours_end: workingSchedule.end,
        timezone: workingSchedule.timezone,
        prospect_timezone_override: workingSchedule.prospectTimezoneOverride || "",
        working_hours_by_day: workingSchedule.hoursByDay || {},
        slot_step_minutes: workingSchedule.slotStep || 15,
        flex_minutes: workingSchedule.flexMinutes || 0,
        buffer_before: workingSchedule.bufferBefore,
        buffer_after: workingSchedule.bufferAfter
      };
      const res = await api.saveCalcomSettings(payload);
      const sync = res?.sync;
      if (sync?.success) {
        setSaveMessage(sync.message || "Settings saved. Cal.com event types synced!");
      } else {
        setSaveMessage("Settings saved successfully!");
      }
      setTimeout(() => setSaveMessage(""), 6000);
      await loadData();
    } catch (err) {
      setSaveMessage("Error saving settings.");
    } finally {
      setLoading(false);
    }
  };

  const handleSyncEventTypes = async () => {
    setLoading(true);
    setSaveMessage("");
    try {
      const res = await api.syncCalcomEventTypes();
      if (res?.success) {
        setSaveMessage(res.message || "Event types synced with Cal.com.");
      } else {
        setSaveMessage(`Error: ${res?.error || "Cal.com sync failed."}`);
      }
      setTimeout(() => setSaveMessage(""), 8000);
      await loadData();
    } catch (err) {
      setSaveMessage(`Error: ${err?.message || "Cal.com sync failed."}`);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateBooking = async (e) => {
    e.preventDefault();
    if (!prospectName || !attendeeEmail || !selectedSlot) {
      alert("Please fill in attendee name, email, and choose a time slot.");
      return;
    }
    setBookingInProgress(true);
    try {
      const res = await api.bookCalcomMeeting({
        prospectName,
        attendeeEmail,
        date: selectedDate,
        time: selectedSlot,
        hostEmail: hostEmail || operator?.email || "admin@aivhub.io",
        eventTypeSlug: selectedEventType,
        notes: bookingNotes
      });
      setBookingSuccessModal(res);
      setProspectName("");
      setAttendeeEmail("");
      setBookingNotes("");
      await loadData();
    } catch (err) {
      alert(err.message || "Failed to book meeting.");
    } finally {
      setBookingInProgress(false);
    }
  };

  const handleConfirmReschedule = async () => {
    if (!reschedulingBooking || !rescheduleDate || !rescheduleSlot) return;
    setReschedulingLoading(true);
    try {
      await api.rescheduleCalcomBooking(
        reschedulingBooking.id,
        rescheduleDate,
        rescheduleSlot,
        rescheduleReason || "Rescheduled by host via Admin Center"
      );
      setReschedulingBooking(null);
      await loadData();
    } catch (err) {
      alert(err.message || "Failed to reschedule meeting.");
    } finally {
      setReschedulingLoading(false);
    }
  };

  const handleConfirmCancel = async () => {
    if (!cancellingBooking) return;
    try {
      await api.cancelCalcomBooking(cancellingBooking.id, cancelReason || "Cancelled by host");
      setCancellingBooking(null);
      setCancelReason("");
      await loadData();
    } catch (err) {
      alert(err.message || "Failed to cancel booking.");
    }
  };

  const handleCreateEventType = async (e) => {
    e.preventDefault();
    if (!eventForm.title.trim()) return;
    const slug = eventForm.slug.trim() || eventForm.title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    try {
      await api.createCalcomEventType({
        ...eventForm,
        slug
      });
      setShowEventModal(false);
      setEventForm({
        title: "",
        slug: "",
        length: 15,
        description: "",
        locationType: "google_meet",
        color: "#10B981"
      });
      await loadData();
    } catch (err) {
      alert(err.message || "Failed to create event type.");
    }
  };

  const handleDeleteEventType = async (id) => {
    if (!confirm("Are you sure you want to delete this event type?")) return;
    try {
      await api.deleteCalcomEventType(id);
      await loadData();
    } catch (err) {
      alert("Failed to delete event type.");
    }
  };

  // Communication Accounts Handlers (Supports multiple accounts per provider)
  const handleOpenAccountModal = (provider = "google", existingAcc = null) => {
    setEditingAccount(existingAcc);
    setAccountTestResult(null);
    if (existingAcc) {
      const cfg = existingAcc.config || {};
      setAccountForm({
        id: existingAcc.id,
        provider: cfg.provider || provider,
        name: existingAcc.name || `${provider === "google" ? "Google / Gmail" : (provider === "outlook" ? "Microsoft Outlook" : "Custom SMTP")} Account`,
        email: cfg.email || "",
        senderName: cfg.sender_name || "",
        password: "",
        smtpHost: cfg.host || (provider === "google" ? "smtp.gmail.com" : (provider === "outlook" ? "smtp.office365.com" : "mail.company.com")),
        smtpPort: cfg.port || 587,
        useTls: cfg.use_tls ?? true,
        syncCalendar: cfg.sync_calendar ?? true,
        sendInvites: cfg.send_invites ?? true,
        isPrimary: cfg.is_primary ?? false
      });
    } else {
      const providerMatches = accounts.filter(a => (a.config?.provider || "").toLowerCase() === provider.toLowerCase());
      const count = providerMatches.length;
      const defaultLabel = provider === "google"
        ? (count > 0 ? `Google Account #${count + 1}` : "Google / Gmail & Calendar")
        : (provider === "outlook"
          ? (count > 0 ? `Outlook Account #${count + 1}` : "Microsoft Outlook / 365")
          : (count > 0 ? `Custom SMTP #${count + 1}` : "Custom SMTP Server"));

      setAccountForm({
        id: "",
        provider: provider,
        name: defaultLabel,
        email: count === 0 ? (operator?.email || "admin@aivhub.io") : "",
        senderName: operator?.name || "Admin Operator",
        password: "",
        smtpHost: provider === "google" ? "smtp.gmail.com" : (provider === "outlook" ? "smtp.office365.com" : "mail.company.com"),
        smtpPort: 587,
        useTls: true,
        syncCalendar: true,
        sendInvites: true,
        isPrimary: accounts.length === 0
      });
    }
    setShowAccountModal(true);
  };

  const handleSetPrimaryAccount = async (acc) => {
    try {
      await api.saveCalcomAccount({
        id: acc.id,
        provider: acc.config?.provider || "google",
        name: acc.name,
        status: acc.status || "connected",
        email: acc.config?.email,
        senderName: acc.config?.sender_name,
        config: {
          ...acc.config,
          is_primary: true
        }
      });
      if (acc.config?.email) setHostEmail(acc.config.email);
      await loadData();
    } catch (err) {
      alert("Failed to set primary account.");
    }
  };

  const handleTestAccount = async () => {
    if (!accountForm.email) {
      alert("Enter the Gmail address first.");
      return;
    }
    if (!accountForm.password && !accountForm.id) {
      alert("Gmail needs a 16-character App Password. Normal Gmail password is rejected.");
      return;
    }
    setAccountTesting(true);
    setAccountTestResult(null);
    try {
      const saved = await api.saveCalcomAccount({
        id: accountForm.id || undefined,
        provider: accountForm.provider,
        name: accountForm.name || `${accountForm.provider.toUpperCase()} Account`,
        status: "connected",
        email: accountForm.email,
        senderName: accountForm.senderName,
        password: accountForm.password,
        config: {
          email: accountForm.email,
          sender_name: accountForm.senderName,
          host: accountForm.smtpHost || (accountForm.provider === "google" ? "smtp.gmail.com" : "smtp.office365.com"),
          port: accountForm.smtpPort || 587,
          use_tls: accountForm.useTls,
          sync_calendar: accountForm.syncCalendar,
          send_invites: accountForm.sendInvites,
          is_primary: accountForm.isPrimary,
        },
      });
      const accId = saved?.account?.id || accountForm.id;
      if (accId) setAccountForm((f) => ({ ...f, id: accId }));
      const res = await api.testCalcomAccount(accId);
      setAccountTestResult({
        success: !!res.success,
        message: res.message || res.error || (res.success ? "SMTP login OK." : "Test failed."),
      });
      await loadData();
    } catch (err) {
      setAccountTestResult({
        success: false,
        message: err.message || "Failed to verify connection. Check the app password.",
      });
    } finally {
      setAccountTesting(false);
    }
  };

  const handleSaveAccount = async (e) => {
    e.preventDefault();
    if (!accountForm.email) {
      alert("Email is required.");
      return;
    }
    try {
      await api.saveCalcomAccount({
        id: accountForm.id || undefined,
        provider: accountForm.provider,
        name: accountForm.name || `${accountForm.provider.toUpperCase()} Account`,
        status: "connected",
        email: accountForm.email,
        senderName: accountForm.senderName,
        password: accountForm.password,
        config: {
          email: accountForm.email,
          sender_name: accountForm.senderName,
          host: accountForm.smtpHost,
          port: accountForm.smtpPort,
          use_tls: accountForm.useTls,
          sync_calendar: accountForm.syncCalendar,
          send_invites: accountForm.sendInvites,
          is_primary: accountForm.isPrimary
        }
      });
      setShowAccountModal(false);
      await loadData();
    } catch (err) {
      alert("Failed to save communication account.");
    }
  };

  const handleDeleteAccount = (id) => {
    const acc = accounts.find((a) => a.id === id) || { id };
    setDisconnectAccount(acc);
  };

  const handleConfirmDisconnect = async () => {
    if (!disconnectAccount?.id) return;
    setDisconnectBusy(true);
    try {
      await api.deleteCalcomAccount(disconnectAccount.id);
      setDisconnectAccount(null);
      setSaveMessage("Account disconnected.");
      setTimeout(() => setSaveMessage(""), 2500);
      await loadData();
    } catch (err) {
      setSaveMessage(err?.message || "Failed to disconnect account.");
      setTimeout(() => setSaveMessage(""), 4000);
    } finally {
      setDisconnectBusy(false);
    }
  };

  if (!isOpen) return null;

  const filteredBookings = bookings.filter(b => {
    const matchesSearch =
      (b.prospect || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
      (b.attendeeEmail || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
      (b.id || "").toLowerCase().includes(searchQuery.toLowerCase());
    if (statusFilter === "all") return matchesSearch;
    return matchesSearch && b.status === statusFilter;
  });

  const appBaseUrl = typeof window !== "undefined" ? window.location.origin : "";
  const calcomPublicUrl = typeof window !== "undefined" ? `${window.location.protocol}//${window.location.hostname}:3000` : "";
  const primaryAccount = accounts.find(a => a.config?.is_primary) || accounts[0];

  return (
    <div
      onClick={onClose}
      style={{
      position: "fixed",
      inset: 0,
      background: "rgba(15, 23, 42, 0.68)",
      backdropFilter: "blur(6px)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 130,
      padding: 16,
      cursor: "pointer"
    }}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
        background: "#FFFFFF",
        borderRadius: 20,
        width: "100%",
        maxWidth: 1240,
        height: "92vh",
        display: "flex",
        flexDirection: "column",
        boxShadow: "0 28px 80px rgba(0,0,0,0.25)",
        border: "1px solid #E2E8F0",
        overflow: "hidden",
        cursor: "default"
      }}>
        {/* Top Header */}
        <div style={{
          padding: "16px 24px",
          borderBottom: "1px solid #E2E8F0",
          background: "#FAFAFA",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between"
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              background: "#10B981",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#FFFFFF",
              boxShadow: "0 4px 12px rgba(16, 185, 129, 0.25)"
            }}>
              <CalendarCheck size={22} />
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 700, color: "#0F172A" }}>
                  Calendar & meetings
                </span>
                <span style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "2px 8px",
                  borderRadius: 6,
                  background: "#ECFDF5",
                  color: "#059669",
                  border: "1px solid #A7F3D0"
                }}>
                  <span style={{ width: 6, height: 6, borderRadius: 999, background: "#10B981" }} />
                  Admin Engine Active
                </span>
              </div>
              <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: "#64748B" }}>
                Full-stack meeting mail: communication accounts, embeds, host sync. Bookings & slots live in Calling → Schedule.
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              onClick={() => window.open(calcomPublicUrl, "_blank")}
              title="Open full Cal.com web application in new tab"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "7px 12px",
                borderRadius: 8,
                border: "1px solid #CBD5E1",
                background: "#FFFFFF",
                fontSize: 12,
                fontWeight: 600,
                color: "#334155",
                cursor: "pointer"
              }}
            >
              <ExternalLink size={14} />
              Open Cal.com Web App
            </button>

            <button
              onClick={loadData}
              disabled={loading}
              title="Refresh Data"
              style={{
                padding: 8,
                borderRadius: 8,
                border: "1px solid #CBD5E1",
                background: "#FFFFFF",
                cursor: "pointer",
                color: "#475569"
              }}
            >
              <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
            </button>

            <button
              onClick={onClose}
              style={{
                padding: 8,
                borderRadius: 8,
                border: "none",
                background: "#F1F5F9",
                cursor: "pointer",
                color: "#475569"
              }}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "8px 20px",
          borderBottom: "1px solid #E2E8F0",
          background: "#FFFFFF",
          overflowX: "auto"
        }}>
          {[
            { id: "accounts", label: `Invite mail (${accounts.filter(a => a.status === "connected").length})`, icon: Mail, highlight: true },
            { id: "embeds", label: "Embeds & Sharing", icon: Code2 },
            { id: "webConsole", label: "Live Cal.com Web App", icon: Globe },
            { id: "settings", label: "Host Sync & Engine", icon: Settings }
          ].map(tab => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  padding: "8px 14px",
                  borderRadius: 9,
                  border: "none",
                  background: active ? (tab.highlight ? "#EFF6FF" : "#F0FDF4") : "transparent",
                  color: active ? (tab.highlight ? "#2563EB" : "#059669") : "#64748B",
                  fontWeight: active ? 700 : 500,
                  fontSize: 13,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  transition: "all 0.15s ease"
                }}
              >
                <Icon size={16} color={active ? (tab.highlight ? "#2563EB" : "#059669") : "#64748B"} />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Content Area */}
        <div style={{ flex: 1, overflowY: "auto", padding: 24, background: "#F8FAFC" }}>
          
          {/* TAB 1: OVERVIEW */}
          {/* TAB 1: EXECUTIVE OVERVIEW — removed */}
          {false && activeTab === "overview" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
              {/* Stat KPI Grid */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
                {[
                  { label: "Total Booked Meetings", val: overview?.totalBookings || bookings.length, icon: CalendarCheck, color: "#10B981" },
                  { label: "Upcoming Appointments", val: overview?.upcomingCount || bookings.filter(b => b.status === "upcoming").length, icon: Clock, color: "#3B82F6" },
                  { label: "Connected Accounts", val: accounts.filter(a => a.status === "connected").length, icon: Mail, color: "#2563EB" },
                  { label: "Active Event Types", val: overview?.eventTypesCount || eventTypes.length, icon: Layers, color: "#8B5CF6" }
                ].map((s, idx) => {
                  const Icon = s.icon;
                  return (
                    <div key={idx} style={{
                      background: "#FFFFFF",
                      borderRadius: 14,
                      padding: 20,
                      border: "1px solid #E2E8F0",
                      boxShadow: "0 2px 6px rgba(0,0,0,0.03)"
                    }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                        <span style={{ fontSize: 13, color: "#64748B", fontWeight: 600 }}>{s.label}</span>
                        <div style={{ width: 34, height: 34, borderRadius: 8, background: `${s.color}15`, display: "flex", alignItems: "center", justifyContent: "center", color: s.color }}>
                          <Icon size={18} />
                        </div>
                      </div>
                      <div style={{ fontFamily: FONT_DISPLAY, fontSize: 28, fontWeight: 800, color: "#0F172A" }}>
                        {s.val}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Communication Account Quick Banner */}
              <div style={{
                background: "linear-gradient(135deg, #EFF6FF 0%, #F0FDF4 100%)",
                borderRadius: 14,
                border: "1px solid #BFDBFE",
                padding: 18,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between"
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 10, background: "#2563EB", display: "flex", alignItems: "center", justifyContent: "center", color: "#FFF" }}>
                    <Mail size={22} />
                  </div>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: "#1E3A8A" }}>
                      Primary Communication Channel: {primaryAccount?.config?.email || hostEmail || "admin@aivhub.io"}
                    </div>
                    <div style={{ fontSize: 12, color: "#3B82F6", marginTop: 2 }}>
                      Connected via <strong>{primaryAccount?.name || "Google / Gmail"}</strong>. Automatically sends meeting invites, synchronizes calendars, and creates Google Meet / Teams video rooms.
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <button
                    onClick={() => setActiveTab("accounts")}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      background: "#2563EB",
                      color: "#FFFFFF",
                      border: "none",
                      padding: "8px 16px",
                      borderRadius: 8,
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: "pointer"
                    }}
                  >
                    <Mail size={15} />
                    Manage Accounts (Gmail/Outlook)
                  </button>
                  <button
                    onClick={() => setActiveTab("directBook")}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      background: "#FFFFFF",
                      color: "#059669",
                      border: "1px solid #A7F3D0",
                      padding: "8px 16px",
                      borderRadius: 8,
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: "pointer"
                    }}
                  >
                    <Plus size={15} />
                    Book Meeting
                  </button>
                </div>
              </div>

              {/* Upcoming Meetings Quick Glance */}
              <div style={{ background: "#FFFFFF", borderRadius: 14, border: "1px solid #E2E8F0", padding: 20 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: "#0F172A" }}>Upcoming Bookings</div>
                    <div style={{ fontSize: 12, color: "#64748B" }}>Next confirmed video calls and meetings</div>
                  </div>
                  <button
                    onClick={() => setActiveTab("bookings")}
                    style={{ background: "none", border: "none", color: "#10B981", fontSize: 13, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}
                  >
                    View All Bookings <ArrowRight size={14} />
                  </button>
                </div>

                {bookings.filter(b => b.status === "upcoming").length === 0 ? (
                  <div style={{ padding: "32px 0", textAlign: "center", color: "#94A3B8" }}>
                    <Calendar size={36} style={{ margin: "0 auto 8px auto", opacity: 0.5 }} />
                    <div>No upcoming meetings scheduled. Use the Direct Scheduler to book one!</div>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {bookings.filter(b => b.status === "upcoming").slice(0, 4).map(m => (
                      <div key={m.id} style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "12px 16px",
                        borderRadius: 10,
                        border: "1px solid #E2E8F0",
                        background: "#F8FAFC"
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                          <div style={{ width: 40, height: 40, borderRadius: 8, background: "#ECFDF5", display: "flex", alignItems: "center", justifyContent: "center", color: "#059669", fontWeight: 700, fontSize: 12 }}>
                            {m.time}
                          </div>
                          <div>
                            <div style={{ fontSize: 14, fontWeight: 700, color: "#0F172A" }}>{m.prospect}</div>
                            <div style={{ fontSize: 12, color: "#64748B" }}>
                              {m.attendeeEmail} &bull; {meetingTimeLabel(m)} ({m.duration || "15 min"})
                            </div>
                          </div>
                        </div>
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
                                background: "#10B981",
                                color: "#FFF",
                                padding: "6px 12px",
                                borderRadius: 7,
                                fontSize: 12,
                                fontWeight: 600,
                                textDecoration: "none"
                              }}
                            >
                              <Video size={13} />
                              Join Meet
                            </a>
                          )}
                          <button
                            onClick={() => {
                              setReschedulingBooking(m);
                              setRescheduleDate(m.date);
                              fetchRescheduleSlots(m.date, m.eventTypeSlug);
                            }}
                            style={{
                              padding: "6px 12px",
                              borderRadius: 7,
                              border: "1px solid #CBD5E1",
                              background: "#FFFFFF",
                              fontSize: 12,
                              fontWeight: 600,
                              color: "#334155",
                              cursor: "pointer"
                            }}
                          >
                            Reschedule
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: COMMUNICATION ACCOUNTS (GMAIL, OUTLOOK, SMTP - MULTIPLE ACCOUNTS SUPPORTED) */}
          {activeTab === "accounts" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              {/* Top Header & Provider Action Buttons */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "#0F172A" }}>
                    Invite mail accounts ({accounts.filter(a => a.status === "connected" || a.config?.email).length} active)
                  </div>
                  <div style={{ fontSize: 12, color: "#64748B" }}>
                    Gmail, Outlook, or SMTP — used to send meeting invites and calendar links.
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    onClick={() => handleOpenAccountModal("google")}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "8px 14px",
                      borderRadius: 8,
                      border: "none",
                      background: "#EA4335",
                      color: "#FFF",
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: "pointer"
                    }}
                  >
                    <Plus size={14} />
                    + Add Gmail / Google Account
                  </button>
                  <button
                    onClick={() => handleOpenAccountModal("outlook")}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "8px 14px",
                      borderRadius: 8,
                      border: "none",
                      background: "#0078D4",
                      color: "#FFF",
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: "pointer"
                    }}
                  >
                    <Plus size={14} />
                    + Add Outlook / 365 Account
                  </button>
                  <button
                    onClick={() => handleOpenAccountModal("smtp")}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "8px 14px",
                      borderRadius: 8,
                      border: "1px solid #CBD5E1",
                      background: "#FFF",
                      color: "#334155",
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: "pointer"
                    }}
                  >
                    <Server size={14} />
                    + Add Custom SMTP
                  </button>
                </div>
              </div>

              {/* Dynamic Connected Accounts Grid */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16 }}>
                {accounts.filter(a => a.status === "connected" || a.config?.email).map((acc) => {
                  const cfg = acc.config || {};
                  const provider = (cfg.provider || "google").toLowerCase();
                  const isPrimary = cfg.is_primary ?? false;
                  const isGoogle = provider === "google";
                  const isOutlook = provider === "outlook";
                  const isSmtp = provider === "smtp";

                  const themeColor = isGoogle ? "#EA4335" : (isOutlook ? "#0078D4" : "#7C3AED");
                  const themeBg = isGoogle ? "#FEF2F2" : (isOutlook ? "#EFF6FF" : "#F5F3FF");
                  const themeBorder = isGoogle ? "#FECACA" : (isOutlook ? "#BFDBFE" : "#DDD6FE");

                  return (
                    <div
                      key={acc.id}
                      style={{
                        background: "#FFFFFF",
                        borderRadius: 16,
                        border: isPrimary ? `2px solid ${themeColor}` : "1px solid #E2E8F0",
                        padding: 20,
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "space-between",
                        boxShadow: isPrimary ? "0 4px 14px rgba(0,0,0,0.06)" : "0 2px 6px rgba(0,0,0,0.02)",
                        position: "relative"
                      }}
                    >
                      <div>
                        {/* Card Header */}
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <div style={{
                              width: 38,
                              height: 38,
                              borderRadius: 10,
                              background: themeBg,
                              border: `1px solid ${themeBorder}`,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              color: themeColor,
                              fontWeight: 800,
                              fontSize: 16
                            }}>
                              {isGoogle ? "G" : (isOutlook ? "O" : <Server size={18} />)}
                            </div>
                            <div>
                              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                <span style={{ fontSize: 15, fontWeight: 700, color: "#0F172A" }}>
                                  {acc.name || (isGoogle ? "Google Workspace" : (isOutlook ? "Microsoft Outlook" : "Custom SMTP"))}
                                </span>
                              </div>
                              <div style={{ fontSize: 11, color: "#64748B" }}>
                                {isGoogle ? "Google Calendar & Meet" : (isOutlook ? "Outlook Calendar & Teams" : "Corporate Mail Server")}
                              </div>
                            </div>
                          </div>

                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            {isPrimary ? (
                              <span style={{
                                fontSize: 11,
                                fontWeight: 700,
                                padding: "3px 8px",
                                borderRadius: 6,
                                background: "#FEF3C7",
                                color: "#B45309",
                                border: "1px solid #FDE68A",
                                display: "flex",
                                alignItems: "center",
                                gap: 4
                              }}>
                                ★ Primary Host
                              </span>
                            ) : (
                              <button
                                onClick={() => handleSetPrimaryAccount(acc)}
                                style={{
                                  fontSize: 11,
                                  fontWeight: 600,
                                  padding: "3px 8px",
                                  borderRadius: 6,
                                  background: "#F1F5F9",
                                  color: "#475569",
                                  border: "1px solid #CBD5E1",
                                  cursor: "pointer"
                                }}
                              >
                                Set as Primary
                              </button>
                            )}
                            <span style={{
                              fontSize: 11,
                              fontWeight: 700,
                              padding: "3px 8px",
                              borderRadius: 6,
                              background: "#ECFDF5",
                              color: "#059669"
                            }}>
                              ● Connected
                            </span>
                          </div>
                        </div>

                        {/* Connected Mail Address */}
                        <div style={{ background: "#F8FAFC", borderRadius: 10, padding: 12, marginBottom: 12, border: "1px solid #E2E8F0" }}>
                          <div style={{ fontSize: 11, color: "#64748B", marginBottom: 3 }}>CONNECTED EMAIL ADDRESS:</div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: "#0F172A", fontFamily: FONT_MONO }}>
                            {cfg.email || "No email specified"}
                          </div>
                          {cfg.sender_name && (
                            <div style={{ fontSize: 11, color: "#475569", marginTop: 2 }}>
                              Sender Name: <strong>{cfg.sender_name}</strong>
                            </div>
                          )}
                        </div>

                        {/* Capabilities checkmarks */}
                        <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 14 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#334155" }}>
                            <Check size={14} color="#10B981" />
                            <span><strong>Outgoing Invites:</strong> {cfg.send_invites !== false ? "Active (Sends from this address)" : "Disabled"}</span>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#334155" }}>
                            <Check size={14} color="#10B981" />
                            <span><strong>Calendar Sync:</strong> {cfg.sync_calendar !== false ? "Active (Avoids Conflicts)" : "Disabled"}</span>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#334155" }}>
                            <Check size={14} color="#10B981" />
                            <span><strong>Video Conferencing:</strong> {isGoogle ? "Google Meet Rooms" : (isOutlook ? "Microsoft Teams" : "Direct Video Link")}</span>
                          </div>
                        </div>
                      </div>

                      {/* Card Footer Actions */}
                      <div style={{ display: "flex", alignItems: "center", gap: 8, borderTop: "1px solid #F1F5F9", paddingTop: 12 }}>
                        <button
                          onClick={() => handleOpenAccountModal(provider, acc)}
                          style={{
                            flex: 1,
                            padding: "7px 12px",
                            borderRadius: 8,
                            border: "1px solid #CBD5E1",
                            background: "#FFF",
                            fontSize: 12,
                            fontWeight: 600,
                            color: "#334155",
                            cursor: "pointer"
                          }}
                        >
                          Configure / Edit
                        </button>
                        <button
                          onClick={handleTestAccount}
                          disabled={accountTesting}
                          style={{
                            padding: "7px 14px",
                            borderRadius: 8,
                            border: "1px solid #A7F3D0",
                            background: "#ECFDF5",
                            color: "#059669",
                            fontSize: 12,
                            fontWeight: 700,
                            cursor: "pointer"
                          }}
                        >
                          {accountTesting ? "Testing..." : "Test Sync"}
                        </button>
                        <button
                          onClick={() => handleDeleteAccount(acc.id)}
                          style={{
                            padding: "7px 12px",
                            borderRadius: 8,
                            border: "1px solid #FECDD3",
                            background: "#FFF1F2",
                            color: "#E11D48",
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: "pointer"
                          }}
                        >
                          Disconnect
                        </button>
                      </div>
                    </div>
                  );
                })}

                {/* Quick Add Another Account Card */}
                <div style={{
                  border: "2px dashed #CBD5E1",
                  borderRadius: 16,
                  padding: 24,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  textAlign: "center",
                  background: "#FAFAFA",
                  minHeight: 220
                }}>
                  <div style={{ width: 44, height: 44, borderRadius: 12, background: "#EFF6FF", display: "flex", alignItems: "center", justifyContent: "center", color: "#2563EB", marginBottom: 10 }}>
                    <Plus size={22} />
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#0F172A", marginBottom: 4 }}>
                    Add another invite mail account
                  </div>
                  <div style={{ fontSize: 12, color: "#64748B", marginBottom: 14, maxWidth: 280 }}>
                    You can connect multiple Gmail, Outlook, or SMTP accounts for different team members or departments.
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      onClick={() => handleOpenAccountModal("google")}
                      style={{ padding: "6px 12px", borderRadius: 6, background: "#EA4335", color: "#FFF", fontSize: 11, fontWeight: 700, border: "none", cursor: "pointer" }}
                    >
                      + Google
                    </button>
                    <button
                      onClick={() => handleOpenAccountModal("outlook")}
                      style={{ padding: "6px 12px", borderRadius: 6, background: "#0078D4", color: "#FFF", fontSize: 11, fontWeight: 700, border: "none", cursor: "pointer" }}
                    >
                      + Outlook
                    </button>
                    <button
                      onClick={() => handleOpenAccountModal("smtp")}
                      style={{ padding: "6px 12px", borderRadius: 6, background: "#7C3AED", color: "#FFF", fontSize: 11, fontWeight: 700, border: "none", cursor: "pointer" }}
                    >
                      + SMTP
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: BOOKINGS & MEETINGS */}
          {/* TAB: BOOKINGS — removed; use Calling → Schedule */}
          {false && activeTab === "bookings" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Search & Filter Bar */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, maxWidth: 400, background: "#FFF", border: "1px solid #CBD5E1", borderRadius: 10, padding: "8px 12px" }}>
                  <Search size={16} color="#94A3B8" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search attendee, email, or booking ID..."
                    style={{ border: "none", outline: "none", width: "100%", fontSize: 13 }}
                  />
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {["all", "upcoming", "completed", "cancelled"].map(st => (
                    <button
                      key={st}
                      onClick={() => setStatusFilter(st)}
                      style={{
                        padding: "6px 14px",
                        borderRadius: 8,
                        border: statusFilter === st ? "1px solid #10B981" : "1px solid #CBD5E1",
                        background: statusFilter === st ? "#ECFDF5" : "#FFF",
                        color: statusFilter === st ? "#059669" : "#475569",
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: "pointer",
                        textTransform: "capitalize"
                      }}
                    >
                      {st} ({bookings.filter(b => st === "all" ? true : b.status === st).length})
                    </button>
                  ))}
                  <button
                    onClick={() => setActiveTab("directBook")}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "7px 14px",
                      borderRadius: 8,
                      border: "none",
                      background: "#10B981",
                      color: "#FFF",
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: "pointer",
                      marginLeft: 6
                    }}
                  >
                    <Plus size={14} />
                    New Booking
                  </button>
                </div>
              </div>

              {/* Bookings List */}
              {filteredBookings.length === 0 ? (
                <div style={{ background: "#FFF", borderRadius: 14, padding: "48px 0", textAlign: "center", color: "#94A3B8", border: "1px solid #E2E8F0" }}>
                  <Calendar size={40} style={{ margin: "0 auto 10px auto", opacity: 0.5 }} />
                  <div style={{ fontSize: 15, fontWeight: 600, color: "#64748B" }}>No bookings found</div>
                  <div style={{ fontSize: 12 }}>Try adjusting your search filters or book a meeting directly.</div>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {filteredBookings.map(b => (
                    <div
                      key={b.id}
                      style={{
                        background: "#FFFFFF",
                        borderRadius: 14,
                        border: "1px solid #E2E8F0",
                        padding: 18,
                        boxShadow: "0 1px 3px rgba(0,0,0,0.02)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        flexWrap: "wrap",
                        gap: 16
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 14, minWidth: 320 }}>
                        <div style={{
                          width: 44,
                          height: 44,
                          borderRadius: 10,
                          background: b.status === "cancelled" ? "#FFE4E6" : (b.status === "completed" ? "#EFF6FF" : "#ECFDF5"),
                          color: b.status === "cancelled" ? "#E11D48" : (b.status === "completed" ? "#2563EB" : "#059669"),
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontWeight: 700,
                          fontSize: 13,
                          flexShrink: 0
                        }}>
                          {b.time}
                        </div>
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 15, fontWeight: 700, color: "#0F172A" }}>{b.prospect}</span>
                            <span style={{
                              fontSize: 11,
                              fontWeight: 700,
                              padding: "2px 7px",
                              borderRadius: 5,
                              textTransform: "capitalize",
                              background: b.status === "cancelled" ? "#FFE4E6" : (b.status === "completed" ? "#EFF6FF" : "#ECFDF5"),
                              color: b.status === "cancelled" ? "#E11D48" : (b.status === "completed" ? "#2563EB" : "#059669")
                            }}>
                              {b.status}
                            </span>
                            <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: "#94A3B8" }}>
                              Ref: {b.calcomBookingId || b.id}
                            </span>
                          </div>
                          <div style={{ fontSize: 12, color: "#475569", marginTop: 4, display: "flex", alignItems: "center", gap: 12 }}>
                            <span><strong>Attendee:</strong> {b.attendeeEmail || "N/A"}</span>
                            <span>&bull;</span>
                            <span><strong>Host:</strong> {b.hostEmail || hostEmail}</span>
                            <span>&bull;</span>
                            <span><strong>Date:</strong> {b.date} ({b.duration || "15 min"})</span>
                          </div>
                          {b.prep && (
                            <div style={{ fontSize: 11, color: "#64748B", marginTop: 4, fontStyle: "italic" }}>
                              Notes: {b.prep}
                            </div>
                          )}
                          {b.cancellationReason && (
                            <div style={{ fontSize: 11, color: "#E11D48", marginTop: 4 }}>
                              Cancellation Reason: {b.cancellationReason}
                            </div>
                          )}
                        </div>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {b.videoLink && b.status !== "cancelled" && (
                          <a
                            href={b.videoLink}
                            target="_blank"
                            rel="noreferrer"
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 6,
                              background: "#10B981",
                              color: "#FFF",
                              padding: "7px 14px",
                              borderRadius: 8,
                              fontSize: 12,
                              fontWeight: 700,
                              textDecoration: "none"
                            }}
                          >
                            <Video size={14} />
                            Join Video Call
                          </a>
                        )}

                        {b.status === "upcoming" && (
                          <button
                            onClick={() => {
                              setReschedulingBooking(b);
                              setRescheduleDate(b.date);
                              fetchRescheduleSlots(b.date, b.eventTypeSlug);
                            }}
                            style={{
                              padding: "7px 12px",
                              borderRadius: 8,
                              border: "1px solid #CBD5E1",
                              background: "#FFFFFF",
                              fontSize: 12,
                              fontWeight: 600,
                              color: "#334155",
                              cursor: "pointer"
                            }}
                          >
                            Reschedule
                          </button>
                        )}

                        <a
                          href={`/api/calcom/bookings/${b.id}/ics`}
                          download
                          title="Download iCalendar file (.ics)"
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 5,
                            padding: "7px 10px",
                            borderRadius: 8,
                            border: "1px solid #CBD5E1",
                            background: "#FFFFFF",
                            fontSize: 12,
                            fontWeight: 600,
                            color: "#475569",
                            textDecoration: "none"
                          }}
                        >
                          <Download size={14} />
                          .ICS
                        </a>

                        {b.status === "upcoming" && (
                          <button
                            onClick={() => setCancellingBooking(b)}
                            style={{
                              padding: "7px 12px",
                              borderRadius: 8,
                              border: "1px solid #FECDD3",
                              background: "#FFF1F2",
                              fontSize: 12,
                              fontWeight: 600,
                              color: "#E11D48",
                              cursor: "pointer"
                            }}
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 4: DIRECT SCHEDULER & SLOTS */}
          {/* TAB: DIRECT BOOK — removed */}
          {false && activeTab === "directBook" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
              {/* Left Column: Date & Slot Inspector */}
              <div style={{ background: "#FFFFFF", borderRadius: 16, border: "1px solid #E2E8F0", padding: 20 }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#0F172A", marginBottom: 4 }}>
                  1. Choose Date & Available Slot
                </div>
                <div style={{ fontSize: 12, color: "#64748B", marginBottom: 16 }}>
                  Live slot conflict checking based on working hours and current bookings.
                </div>

                <div style={{ marginBottom: 16 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "#475569", display: "block", marginBottom: 6 }}>
                    Select Event Type
                  </label>
                  <select
                    value={selectedEventType}
                    onChange={(e) => setSelectedEventType(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "9px 12px",
                      borderRadius: 8,
                      border: "1px solid #CBD5E1",
                      fontSize: 13,
                      outline: "none"
                    }}
                  >
                    {eventTypes.map(et => (
                      <option key={et.id} value={et.slug}>
                        {et.title} ({et.length} min) - {et.locationType || "Google Meet"}
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ marginBottom: 16 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "#475569", display: "block", marginBottom: 6 }}>
                    Select Date
                  </label>
                  <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
                    {[
                      { label: "Today", days: 0 },
                      { label: "Tomorrow", days: 1 },
                      { label: "+2 Days", days: 2 },
                      { label: "Next Monday", days: (8 - new Date().getDay()) % 7 || 7 }
                    ].map(p => {
                      const d = new Date();
                      d.setDate(d.getDate() + p.days);
                      const iso = d.toISOString().split("T")[0];
                      const isSel = selectedDate === iso;
                      return (
                        <button
                          key={p.label}
                          type="button"
                          onClick={() => setSelectedDate(iso)}
                          style={{
                            padding: "5px 10px",
                            borderRadius: 6,
                            fontSize: 11,
                            fontWeight: 600,
                            border: isSel ? "1px solid #10B981" : "1px solid #CBD5E1",
                            background: isSel ? "#ECFDF5" : "#FFF",
                            color: isSel ? "#059669" : "#475569",
                            cursor: "pointer"
                          }}
                        >
                          {p.label}
                        </button>
                      );
                    })}
                  </div>
                  <input
                    type="date"
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "9px 12px",
                      borderRadius: 8,
                      border: "1px solid #CBD5E1",
                      fontSize: 13,
                      outline: "none"
                    }}
                  />
                </div>

                <div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: "#475569" }}>
                      Available Slots for {selectedDate}
                    </label>
                    {slotsLoading && <span style={{ fontSize: 11, color: "#10B981" }}>Checking availability...</span>}
                  </div>

                  {slots.length === 0 ? (
                    <div style={{ padding: 20, textAlign: "center", color: "#94A3B8", background: "#F8FAFC", borderRadius: 8 }}>
                      No slots available for this date. Select another day.
                    </div>
                  ) : (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, maxHeight: 220, overflowY: "auto", padding: 4 }}>
                      {slots.map(s => {
                        const isSelected = selectedSlot === s.time;
                        return (
                          <button
                            key={s.time}
                            type="button"
                            disabled={!s.available}
                            onClick={() => setSelectedSlot(s.time)}
                            style={{
                              padding: "8px 4px",
                              borderRadius: 8,
                              fontSize: 12,
                              fontWeight: 600,
                              textAlign: "center",
                              border: isSelected ? "2px solid #10B981" : (s.available ? "1px solid #CBD5E1" : "1px solid #F1F5F9"),
                              background: isSelected ? "#10B981" : (s.available ? "#FFF" : "#F8FAFC"),
                              color: isSelected ? "#FFF" : (s.available ? "#0F172A" : "#CBD5E1"),
                              cursor: s.available ? "pointer" : "not-allowed"
                            }}
                          >
                            {s.time}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column: Prospect & Host Details */}
              <div style={{ background: "#FFFFFF", borderRadius: 16, border: "1px solid #E2E8F0", padding: 20 }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#0F172A", marginBottom: 4 }}>
                  2. Attendee & Booking Details
                </div>
                <div style={{ fontSize: 12, color: "#64748B", marginBottom: 16 }}>
                  An automated Google Meet video link will be generated and dispatched.
                </div>

                <form onSubmit={handleCreateBooking} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: "#475569", display: "block", marginBottom: 5 }}>
                      Attendee Full Name *
                    </label>
                    <input
                      type="text"
                      required
                      value={prospectName}
                      onChange={(e) => setProspectName(e.target.value)}
                      placeholder="e.g. Sarah Jenkins (Acme Corp)"
                      style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: 13, outline: "none" }}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: "#475569", display: "block", marginBottom: 5 }}>
                      Attendee Email Address *
                    </label>
                    <input
                      type="email"
                      required
                      value={attendeeEmail}
                      onChange={(e) => setAttendeeEmail(e.target.value)}
                      placeholder="sarah.jenkins@acme.co.uk"
                      style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: 13, outline: "none" }}
                    />
                  </div>

                  <div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 5 }}>
                      <label style={{ fontSize: 12, fontWeight: 600, color: "#475569" }}>
                        Host & Calendar Organizer Account
                      </label>
                      <button
                        type="button"
                        onClick={() => setActiveTab("accounts")}
                        style={{ background: "none", border: "none", color: "#2563EB", fontSize: 11, fontWeight: 600, cursor: "pointer" }}
                      >
                        + Manage Accounts ({accounts.filter(a => a.status === "connected" || a.config?.email).length})
                      </button>
                    </div>
                    {accounts.filter(a => a.status === "connected" && a.config?.email).length > 0 ? (
                      <select
                        value={hostEmail}
                        onChange={(e) => setHostEmail(e.target.value)}
                        style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: 13, outline: "none", background: "#FFF" }}
                      >
                        {accounts.filter(a => a.status === "connected" && a.config?.email).map(acc => (
                          <option key={acc.id} value={acc.config.email}>
                            {acc.name || acc.config.provider} — {acc.config.email} {acc.config.is_primary ? "★ (Primary Host)" : ""}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="email"
                        value={hostEmail}
                        onChange={(e) => setHostEmail(e.target.value)}
                        placeholder="admin@aivhub.io"
                        style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: 13, outline: "none" }}
                      />
                    )}
                  </div>

                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: "#475569", display: "block", marginBottom: 5 }}>
                      Meeting Agenda / Notes
                    </label>
                    <textarea
                      rows={3}
                      value={bookingNotes}
                      onChange={(e) => setBookingNotes(e.target.value)}
                      placeholder="e.g. Discuss AI Voice Agent deployment and pricing roadmap..."
                      style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: 13, outline: "none" }}
                    />
                  </div>

                  <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 10, padding: 12 }}>
                    <div style={{ fontSize: 12, color: "#334155" }}>
                      <strong>Summary:</strong> {selectedDate} at {selectedSlot || "—"} ({selectedEventType})
                    </div>
                    <div style={{ fontSize: 11, color: "#64748B", marginTop: 4 }}>
                      Platform: <strong>Google Meet</strong> &bull; Host: <strong>{hostEmail}</strong>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={bookingInProgress || !selectedSlot}
                    style={{
                      background: "#10B981",
                      color: "#FFFFFF",
                      border: "none",
                      padding: "12px",
                      borderRadius: 10,
                      fontSize: 14,
                      fontWeight: 700,
                      cursor: bookingInProgress ? "not-allowed" : "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                      marginTop: 6
                    }}
                  >
                    {bookingInProgress ? (
                      <RefreshCw size={16} className="animate-spin" />
                    ) : (
                      <CheckCircle2 size={16} />
                    )}
                    {bookingInProgress ? "Booking & Generating Meet Link..." : "Confirm & Book Slot"}
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* TAB 5: EVENT TYPES */}
          {/* TAB: EVENT TYPES — removed */}
          {false && activeTab === "eventTypes" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "#0F172A" }}>Event Types Studio</div>
                  <div style={{ fontSize: 12, color: "#64748B" }}>
                    Configure booking links, durations, locations, and embed widgets.
                  </div>
                </div>
                <button
                  onClick={() => setShowEventModal(true)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "8px 16px",
                    borderRadius: 8,
                    border: "none",
                    background: "#10B981",
                    color: "#FFF",
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: "pointer"
                  }}
                >
                  <Plus size={15} />
                  New Event Type
                </button>
              </div>

              {/* Event Types Grid */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
                {eventTypes.map(et => {
                  const directLink = `${appBaseUrl}/book/${et.slug}`;
                  return (
                    <div
                      key={et.id}
                      style={{
                        background: "#FFFFFF",
                        borderRadius: 14,
                        border: "1px solid #E2E8F0",
                        padding: 20,
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "space-between",
                        boxShadow: "0 2px 5px rgba(0,0,0,0.02)"
                      }}
                    >
                      <div>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                          <span style={{
                            fontSize: 11,
                            fontWeight: 700,
                            padding: "3px 8px",
                            borderRadius: 6,
                            background: `${et.color || "#10B981"}15`,
                            color: et.color || "#10B981"
                          }}>
                            {et.length} min
                          </span>
                          <span style={{ fontSize: 11, color: "#64748B", display: "flex", alignItems: "center", gap: 4 }}>
                            <Video size={13} /> {et.locationType || "Google Meet"}
                          </span>
                        </div>

                        <div style={{ fontSize: 16, fontWeight: 700, color: "#0F172A", marginBottom: 6 }}>
                          {et.title}
                        </div>
                        <div style={{ fontSize: 12, color: "#64748B", lineHeight: 1.4, marginBottom: 14, minHeight: 34 }}>
                          {et.description || "Direct booking link with automated Google Meet video room."}
                        </div>

                        <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 8, padding: "6px 10px", marginBottom: 14 }}>
                          <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: "#475569" }}>
                            /{et.slug}
                          </span>
                        </div>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: "1px solid #F1F5F9", paddingTop: 12, gap: 6 }}>
                        <button
                          onClick={() => handleCopy(directLink, et.id)}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 5,
                            padding: "6px 10px",
                            borderRadius: 7,
                            border: "1px solid #CBD5E1",
                            background: "#FFF",
                            fontSize: 11,
                            fontWeight: 600,
                            color: "#334155",
                            cursor: "pointer"
                          }}
                        >
                          {copiedId === et.id ? <Check size={12} color="#10B981" /> : <Copy size={12} />}
                          {copiedId === et.id ? "Copied!" : "Copy Link"}
                        </button>

                        <button
                          onClick={() => {
                            setEmbedEventSlug(et.slug);
                            setActiveTab("embeds");
                          }}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 5,
                            padding: "6px 10px",
                            borderRadius: 7,
                            border: "1px solid #CBD5E1",
                            background: "#FFF",
                            fontSize: 11,
                            fontWeight: 600,
                            color: "#334155",
                            cursor: "pointer"
                          }}
                        >
                          <Code2 size={12} />
                          Embed
                        </button>

                        {eventTypes.length > 1 && (
                          <button
                            onClick={() => handleDeleteEventType(et.id)}
                            style={{
                              padding: "6px 8px",
                              borderRadius: 7,
                              border: "1px solid #FECDD3",
                              background: "#FFF1F2",
                              color: "#E11D48",
                              cursor: "pointer"
                            }}
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 6: AVAILABILITY & WORKING HOURS */}
          {/* TAB: AVAILABILITY — removed; hours in Calling Company / Schedule */}
          {false && activeTab === "availability" && (
            <div style={{ background: "#FFFFFF", borderRadius: 16, border: "1px solid #E2E8F0", padding: 24, maxWidth: 840 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#0F172A", marginBottom: 4 }}>
                Availability
              </div>
              <div style={{ fontSize: 12, color: "#64748B", marginBottom: 20 }}>
                Working days and hours. Call rules live under Calling → Company → Call Script & Rules.
              </div>

              {saveMessage && (
                <div style={{ padding: "10px 14px", borderRadius: 8, background: "#ECFDF5", border: "1px solid #A7F3D0", color: "#065F46", fontSize: 13, marginBottom: 16 }}>
                  {saveMessage}
                </div>
              )}

              <div style={{ fontSize: 14, fontWeight: 700, color: "#0F172A", marginBottom: 12, marginTop: 8 }}>
                Working days & hours
              </div>

              <div style={{ marginBottom: 20 }}>
                <label style={{ fontSize: 13, fontWeight: 600, color: "#334155", display: "block", marginBottom: 8 }}>
                  Active Working Days
                </label>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map(day => {
                    const active = workingSchedule.days.includes(day);
                    return (
                      <button
                        key={day}
                        type="button"
                        onClick={() => {
                          const next = active
                            ? workingSchedule.days.filter(d => d !== day)
                            : [...workingSchedule.days, day];
                          setWorkingSchedule({ ...workingSchedule, days: next });
                        }}
                        style={{
                          padding: "8px 14px",
                          borderRadius: 8,
                          fontSize: 12,
                          fontWeight: 600,
                          border: active ? "1px solid #10B981" : "1px solid #CBD5E1",
                          background: active ? "#ECFDF5" : "#FFF",
                          color: active ? "#059669" : "#64748B",
                          cursor: "pointer"
                        }}
                      >
                        {day}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 20 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "#475569", display: "block", marginBottom: 6 }}>
                    Day Start Time
                  </label>
                  <input
                    type="time"
                    value={workingSchedule.start}
                    onChange={(e) => setWorkingSchedule({ ...workingSchedule, start: e.target.value })}
                    style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: 13 }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "#475569", display: "block", marginBottom: 6 }}>
                    Day End Time
                  </label>
                  <input
                    type="time"
                    value={workingSchedule.end}
                    onChange={(e) => setWorkingSchedule({ ...workingSchedule, end: e.target.value })}
                    style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: 13 }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "#475569", display: "block", marginBottom: 6 }}>
                    Host Timezone
                  </label>
                  <select
                    value={workingSchedule.timezone}
                    onChange={(e) => setWorkingSchedule({ ...workingSchedule, timezone: e.target.value })}
                    style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: 13 }}
                  >
                    <option value="Europe/London">Europe/London (GMT/BST)</option>
                    <option value="America/New_York">America/New_York (EST/EDT)</option>
                    <option value="America/Chicago">America/Chicago (CST/CDT)</option>
                    <option value="America/Los_Angeles">America/Los_Angeles (PST/PDT)</option>
                    <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
                    <option value="UTC">UTC Universal</option>
                  </select>
                  <div style={{ fontSize: 11, color: "#64748B", marginTop: 6 }}>
                    Worker diary times. Each saved meeting is stamped with this zone.
                  </div>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "#475569", display: "block", marginBottom: 6 }}>
                    Slot step
                  </label>
                  <select
                    value={workingSchedule.slotStep || 15}
                    onChange={(e) => setWorkingSchedule({ ...workingSchedule, slotStep: parseInt(e.target.value, 10) || 15 })}
                    style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: 13 }}
                  >
                    <option value={15}>Every 15 minutes</option>
                    <option value={30}>Every 30 minutes</option>
                    <option value={45}>Every 45 minutes</option>
                    <option value={60}>Every 60 minutes</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "#475569", display: "block", marginBottom: 6 }}>
                    Flex after close
                  </label>
                  <select
                    value={workingSchedule.flexMinutes || 0}
                    onChange={(e) => setWorkingSchedule({ ...workingSchedule, flexMinutes: parseInt(e.target.value, 10) || 0 })}
                    style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: 13 }}
                  >
                    <option value={0}>None — hard close</option>
                    <option value={15}>+15 min if they ask late</option>
                    <option value={30}>+30 min if they ask late</option>
                    <option value={45}>+45 min if they ask late</option>
                    <option value={60}>+60 min if they ask late</option>
                  </select>
                  <div style={{ fontSize: 11, color: "#64748B", marginTop: 6 }}>
                    Agent still prefers core hours. Flex only unlocks a little extra if they push past close.
                  </div>
                </div>
              </div>

              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 8 }}>Per-day hours (optional)</div>
                <div style={{ fontSize: 11, color: "#64748B", marginBottom: 10 }}>
                  Leave blank to use the default start/end. Set Friday 09:00–15:00 if that day is shorter.
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {(workingSchedule.days || []).map((day) => {
                    const spec = (workingSchedule.hoursByDay || {})[day] || {};
                    return (
                      <div key={day} style={{ display: "grid", gridTemplateColumns: "120px 1fr 1fr 72px", gap: 8, alignItems: "center" }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "#334155" }}>{day}</div>
                        <input
                          type="time"
                          value={spec.start || workingSchedule.start}
                          onChange={(e) => {
                            const next = { ...(workingSchedule.hoursByDay || {}), [day]: { ...spec, start: e.target.value, end: spec.end || workingSchedule.end } };
                            setWorkingSchedule({ ...workingSchedule, hoursByDay: next });
                          }}
                          style={{ padding: "6px 8px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: 12 }}
                        />
                        <input
                          type="time"
                          value={spec.end || workingSchedule.end}
                          onChange={(e) => {
                            const next = { ...(workingSchedule.hoursByDay || {}), [day]: { start: spec.start || workingSchedule.start, end: e.target.value } };
                            setWorkingSchedule({ ...workingSchedule, hoursByDay: next });
                          }}
                          style={{ padding: "6px 8px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: 12 }}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const next = { ...(workingSchedule.hoursByDay || {}) };
                            delete next[day];
                            setWorkingSchedule({ ...workingSchedule, hoursByDay: next });
                          }}
                          style={{ border: "1px solid #E2E8F0", background: "#fff", borderRadius: 8, fontSize: 11, fontWeight: 600, color: "#64748B", padding: "6px 0", cursor: "pointer" }}
                        >
                          Reset
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div style={{ marginBottom: 20 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#475569", display: "block", marginBottom: 6 }}>
                  Test: treat callers as this timezone (optional)
                </label>
                <select
                  value={workingSchedule.prospectTimezoneOverride || ""}
                  onChange={(e) => setWorkingSchedule({ ...workingSchedule, prospectTimezoneOverride: e.target.value })}
                  style={{ width: "100%", maxWidth: 480, padding: "8px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: 13 }}
                >
                  <option value="">Auto — from phone number / mission (recommended)</option>
                  <option value="Europe/London">Force Europe/London</option>
                  <option value="Europe/Paris">Force Europe/Paris</option>
                  <option value="Europe/Berlin">Force Europe/Berlin</option>
                  <option value="Asia/Kolkata">Force Asia/Kolkata (IST)</option>
                  <option value="America/New_York">Force America/New_York</option>
                </select>
                <div style={{ fontSize: 11, color: "#64748B", marginTop: 6 }}>
                  Operator-only. Client never hears a timezone. Leave Auto unless you are testing a region.
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "#475569", display: "block", marginBottom: 6 }}>
                    Pre-Meeting Buffer (minutes)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={60}
                    value={workingSchedule.bufferBefore}
                    onChange={(e) => setWorkingSchedule({ ...workingSchedule, bufferBefore: parseInt(e.target.value) || 0 })}
                    style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: 13 }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "#475569", display: "block", marginBottom: 6 }}>
                    Post-Meeting Buffer (minutes)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={60}
                    value={workingSchedule.bufferAfter}
                    onChange={(e) => setWorkingSchedule({ ...workingSchedule, bufferAfter: parseInt(e.target.value) || 0 })}
                    style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: 13 }}
                  />
                </div>
              </div>

              <button
                onClick={() => handleSaveSettings()}
                disabled={loading}
                style={{
                  background: "#10B981",
                  color: "#FFF",
                  border: "none",
                  padding: "10px 24px",
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: "pointer"
                }}
              >
                Save Availability
              </button>
            </div>
          )}

          {/* TAB 7: EMBEDS & SHARING */}
          {activeTab === "embeds" && (
            <div style={{ background: "#FFFFFF", borderRadius: 16, border: "1px solid #E2E8F0", padding: 24, maxWidth: 900 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#0F172A", marginBottom: 4 }}>
                Website Embeds & Public Booking Widgets
              </div>
              <div style={{ fontSize: 12, color: "#64748B", marginBottom: 20 }}>
                Embed Cal.com booking directly into your company website, landing page, or portal.
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#475569", display: "block", marginBottom: 6 }}>
                  Choose Event Type to Embed
                </label>
                <select
                  value={embedEventSlug}
                  onChange={(e) => setEmbedEventSlug(e.target.value)}
                  style={{ width: "100%", maxWidth: 360, padding: "8px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: 13 }}
                >
                  {eventTypes.map(et => (
                    <option key={et.id} value={et.slug}>{et.title} (/{et.slug})</option>
                  ))}
                </select>
              </div>

              <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
                <button
                  type="button"
                  onClick={() => setEmbedCodeType("inline")}
                  style={{
                    padding: "8px 16px",
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 600,
                    border: embedCodeType === "inline" ? "1px solid #10B981" : "1px solid #CBD5E1",
                    background: embedCodeType === "inline" ? "#ECFDF5" : "#FFF",
                    color: embedCodeType === "inline" ? "#059669" : "#475569",
                    cursor: "pointer"
                  }}
                >
                  Inline Responsive Iframe
                </button>

                <button
                  type="button"
                  onClick={() => setEmbedCodeType("popup")}
                  style={{
                    padding: "8px 16px",
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 600,
                    border: embedCodeType === "popup" ? "1px solid #10B981" : "1px solid #CBD5E1",
                    background: embedCodeType === "popup" ? "#ECFDF5" : "#FFF",
                    color: embedCodeType === "popup" ? "#059669" : "#475569",
                    cursor: "pointer"
                  }}
                >
                  Floating "Book Meeting" Button Script
                </button>
              </div>

              <div style={{ position: "relative", marginBottom: 20 }}>
                <pre style={{
                  background: "#0F172A",
                  color: "#F8FAFC",
                  padding: 16,
                  borderRadius: 10,
                  fontSize: 12,
                  fontFamily: FONT_MONO,
                  overflowX: "auto",
                  whiteSpace: "pre-wrap"
                }}>
                  {embedCodeType === "inline"
                    ? `<!-- AIVHub Cal.com Inline Booking Embed -->
<iframe
  src="${appBaseUrl}/book/${embedEventSlug}?embed=true"
  width="100%"
  height="650px"
  frameborder="0"
  style="border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.08);"
  allow="camera; microphone"
></iframe>`
                    : `<!-- AIVHub Cal.com Floating Popup Button -->
<script>
  (function (C, A, L) {
    let p = function (a, ar) { a.q.push(ar); };
    let d = C.document;
    C.Cal = C.Cal || function () { let cal = C.Cal; let ar = arguments; if (!cal.loaded) { cal.ns = {}; cal.q = cal.q || []; d.head.appendChild(d.createElement("script")).src = A; cal.loaded = true; } if (ar[0] === L) { const api = function () { p(api, arguments); }; const namespace = ar[1]; api.q = api.q || []; return typeof namespace === "string" ? (cal.ns[namespace] = api) : p(cal, ar); } p(cal, ar); };
  })(window, "${calcomPublicUrl}/embed/embed.js", "init");
  Cal("init", { origin: "${calcomPublicUrl}" });
  Cal("floatingButton", { calLink: "${embedEventSlug}" });
</script>`
                  }
                </pre>
                <button
                  onClick={() => handleCopy(
                    embedCodeType === "inline"
                      ? `<iframe src="${appBaseUrl}/book/${embedEventSlug}?embed=true" width="100%" height="650px" frameborder="0" style="border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.08);" allow="camera; microphone"></iframe>`
                      : `<script src="${calcomPublicUrl}/embed/embed.js"></script>`,
                    "embed_code"
                  )}
                  style={{
                    position: "absolute",
                    top: 10,
                    right: 10,
                    background: "#1E293B",
                    color: "#F8FAFC",
                    border: "1px solid #334155",
                    padding: "5px 10px",
                    borderRadius: 6,
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 4
                  }}
                >
                  {copiedId === "embed_code" ? <Check size={12} color="#10B981" /> : <Copy size={12} />}
                  {copiedId === "embed_code" ? "Copied" : "Copy Code"}
                </button>
              </div>

              <div style={{ background: "#F8FAFC", borderRadius: 10, border: "1px solid #E2E8F0", padding: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#0F172A", marginBottom: 4 }}>
                  Direct Shareable Link:
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <code style={{ fontFamily: FONT_MONO, fontSize: 12, color: "#10B981", flex: 1, background: "#FFF", padding: "8px 12px", borderRadius: 6, border: "1px solid #CBD5E1" }}>
                    {`${appBaseUrl}/book/${embedEventSlug}`}
                  </code>
                  <button
                    onClick={() => handleCopy(`${appBaseUrl}/book/${embedEventSlug}`, "direct_share")}
                    style={{
                      padding: "8px 14px",
                      borderRadius: 6,
                      background: "#10B981",
                      color: "#FFF",
                      border: "none",
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: "pointer"
                    }}
                  >
                    {copiedId === "direct_share" ? "Copied!" : "Copy Link"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 8: WORKFLOWS — hidden; use Calling → Schedule for bookings */}
          {false && activeTab === "workflows" && (
            <div style={{ background: "#FFFFFF", borderRadius: 16, border: "1px solid #E2E8F0", padding: 24, maxWidth: 840 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#0F172A", marginBottom: 4 }}>
                Automated Workflows & Communication Triggers
              </div>
              <div style={{ fontSize: 12, color: "#64748B", marginBottom: 20 }}>
                Control automated confirmation emails, calendar invite attachments, and meeting reminders.
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 24 }}>
                {[
                  { id: "conf_attendee", title: "Instant Booking Confirmation to Attendee", desc: "Dispatches calendar invite (.ics) and Google Meet video link immediately upon booking." },
                  { id: "conf_host", title: "Booking Notification & Calendar Event to Host", desc: "Adds the appointment to host email calendar and issues an in-app operator alert." },
                  { id: "reminder_24h", title: "24-Hour Pre-Meeting Reminder", desc: "Sends an email reminder to attendee 24 hours prior to scheduled start." },
                  { id: "reminder_1h", title: "1-Hour Pre-Meeting Notification", desc: "Sends a quick SMS or email reminder 1 hour prior to join call." }
                ].map((wf) => (
                  <div
                    key={wf.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "14px 16px",
                      borderRadius: 10,
                      border: "1px solid #E2E8F0",
                      background: "#F8FAFC"
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: "#0F172A" }}>{wf.title}</div>
                      <div style={{ fontSize: 12, color: "#64748B", marginTop: 2 }}>{wf.desc}</div>
                    </div>
                    <span style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      padding: "4px 10px",
                      borderRadius: 6,
                      background: "#ECFDF5",
                      color: "#059669",
                      fontSize: 12,
                      fontWeight: 700
                    }}>
                      <Check size={13} /> Active
                    </span>
                  </div>
                ))}
              </div>

              <div style={{ background: "#F1F5F9", borderRadius: 10, padding: 16, border: "1px solid #E2E8F0" }}>
                <MeetingInvitePreview />
              </div>
            </div>
          )}

          {/* TAB 9: LIVE CAL.COM WEB APP */}
          {activeTab === "webConsole" && (
            <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#FFF", padding: "12px 18px", borderRadius: 12, border: "1px solid #E2E8F0" }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#0F172A" }}>
                    Live Cal.com Web Application Console
                  </div>
                  <div style={{ fontSize: 12, color: "#64748B" }}>
                    Embedded Cal.com dashboard ({calcomPublicUrl}).
                  </div>
                </div>
                <button
                  onClick={() => window.open(calcomPublicUrl, "_blank")}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "6px 12px",
                    borderRadius: 7,
                    border: "1px solid #CBD5E1",
                    background: "#10B981",
                    color: "#FFF",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer"
                  }}
                >
                  <ExternalLink size={13} />
                  Open in New Window
                </button>
              </div>

              <div style={{ flex: 1, borderRadius: 12, overflow: "hidden", border: "1px solid #CBD5E1", background: "#FFF", minHeight: 520 }}>
                <iframe
                  src={calcomPublicUrl}
                  title="Cal.com Live Web App"
                  style={{ width: "100%", height: "100%", border: "none" }}
                />
              </div>
            </div>
          )}

          {/* TAB 10: SETTINGS & HOST SYNC */}
          {activeTab === "settings" && (
            <div style={{ display: "grid", gap: 16, maxWidth: 840 }}>
              <MeetingInvitePreview />

              {/* Engine Status Banner */}
              <div style={{ background: "#ECFDF5", border: "1px solid #A7F3D0", borderRadius: 14, padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ width: 38, height: 38, borderRadius: 10, background: "#10B981", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff" }}>
                    <CalendarCheck size={20} />
                  </div>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, color: "#0F172A" }}>
                        AIVHub Managed Cal.com Engine
                      </span>
                      <span style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                        fontSize: 11,
                        fontWeight: 700,
                        padding: "2px 8px",
                        borderRadius: 999,
                        background: "#D1FAE5",
                        color: "#065F46",
                        border: "1px solid #6EE7B7"
                      }}>
                        <span style={{ width: 6, height: 6, borderRadius: 999, background: "#10B981" }} />
                        Pre-Configured & Active
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: "#64748B", marginTop: 2 }}>
                      Built directly into your workspace. Host mail, embeds, and calendar invites — bookings live in Calling → Schedule.
                    </div>
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <span style={{ fontSize: 11.5, color: "#059669", fontWeight: 700 }}>
                    Auto-Connected
                  </span>
                </div>
              </div>

            <div style={{ background: "#FFFFFF", borderRadius: 16, border: "1px solid #E2E8F0", padding: 24 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#0F172A", marginBottom: 4 }}>
                Operator Host Synchronization & Engine Config
              </div>
              <div style={{ fontSize: 12, color: "#64748B", marginBottom: 20 }}>
                Manage your primary host organizer credentials and optional developer connection keys.
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 20 }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 5 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: "#475569" }}>
                      Host Mail ID (Email Address)
                    </label>
                    <button
                      type="button"
                      onClick={() => setHostEmail(primaryAccount?.config?.email || operator?.email || "admin@aivhub.io")}
                      style={{ background: "none", border: "none", color: "#10B981", fontSize: 11, fontWeight: 600, cursor: "pointer" }}
                    >
                      Sync With Primary Account ({primaryAccount?.config?.email || operator?.email || "admin@aivhub.io"})
                    </button>
                  </div>
                  <input
                    type="email"
                    value={hostEmail}
                    onChange={(e) => setHostEmail(e.target.value)}
                    placeholder="e.g. sales@yourcompany.com or admin@aivhub.io"
                    style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: 13 }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "#475569", display: "block", marginBottom: 5 }}>
                    Host Display Name
                  </label>
                  <input
                    type="text"
                    value={settings?.host_name || operator?.name || "Admin Operator"}
                    onChange={(e) => setSettings({ ...settings, host_name: e.target.value })}
                    placeholder="e.g. Admin Operator"
                    style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: 13 }}
                  />
                </div>
              </div>

              {/* Collapsible Advanced Developer Settings */}
              <div style={{ border: "1px solid #E2E8F0", borderRadius: 10, padding: "12px 16px", background: "#F8FAFC", marginBottom: 20 }}>
                <button
                  type="button"
                  onClick={() => setShowDeveloperOptions(!showDeveloperOptions)}
                  style={{
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: "#475569",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: 0,
                    width: "100%",
                    textAlign: "left"
                  }}
                >
                  <span>{showDeveloperOptions ? "▼" : "▶"}</span>
                  <span>Advanced Developer Options (Custom External Cal.com Instance)</span>
                </button>

                {showDeveloperOptions && (
                  <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #E2E8F0" }}>
                    <div style={{ fontSize: 12, color: "#64748B", marginBottom: 12 }}>
                      Only configure these if you are connecting an external cloud Cal.com enterprise account. The default AIVHub engine is already active and requires zero credentials.
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 14 }}>
                      <div>
                        <label style={{ fontSize: 11.5, fontWeight: 600, color: "#475569", display: "block", marginBottom: 4 }}>
                          Custom Cal.com API Key
                        </label>
                        <input
                          type="password"
                          value={calApiKey}
                          onChange={(e) => setCalApiKey(e.target.value)}
                          placeholder="cal_live_xxxxxxxx (optional)"
                          style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: 6, border: "1px solid #CBD5E1", fontSize: 12, fontFamily: FONT_MONO }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: 11.5, fontWeight: 600, color: "#475569", display: "block", marginBottom: 4 }}>
                          Custom Base URL
                        </label>
                        <input
                          type="text"
                          value={calBaseUrl}
                          onChange={(e) => setCalBaseUrl(e.target.value)}
                          placeholder="https://api.cal.com/v2 (self-hosted: http://your-host/api/v1)"
                          style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: 6, border: "1px solid #CBD5E1", fontSize: 12, fontFamily: FONT_MONO }}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <button
                  onClick={handleSyncEventTypes}
                  disabled={loading}
                  style={{
                    background: "#EFF6FF",
                    color: "#1D4ED8",
                    border: "1px solid #BFDBFE",
                    padding: "10px 18px",
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: "pointer"
                  }}
                >
                  Sync Cal.com Event Types
                </button>
                <button
                  onClick={() => handleSaveSettings({
                    ...settings,
                    host_email: hostEmail,
                    host_name: settings?.host_name || operator?.name || "Admin Operator",
                    api_key: calApiKey,
                    base_url: calBaseUrl
                  })}
                  disabled={loading}
                  style={{
                    background: "#10B981",
                    color: "#FFF",
                    border: "none",
                    padding: "10px 24px",
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: "pointer"
                  }}
                >
                  {loading ? "Saving..." : "Save Host Configuration"}
                </button>

                {saveMessage && (
                  <span style={{ fontSize: 13, fontWeight: 600, color: saveMessage.includes("Error") ? "#EF4444" : "#10B981" }}>
                    {saveMessage}
                  </span>
                )}
              </div>
            </div>
            </div>
          )}
        </div>
      </div>

      {/* CONNECT COMMUNICATION ACCOUNT MODAL */}
      {showAccountModal && (
        <div
          onClick={() => setShowAccountModal(false)}
          style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.65)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 145,
          padding: 16,
          cursor: "pointer"
        }}>
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: "#FFF", borderRadius: 18, width: "100%", maxWidth: 540, padding: 26, boxShadow: "0 24px 70px rgba(0,0,0,0.3)", cursor: "default" }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: "#EFF6FF", display: "flex", alignItems: "center", justifyContent: "center", color: "#2563EB" }}>
                  <Mail size={18} />
                </div>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "#0F172A" }}>
                    Connect invite mail
                  </div>
                  <div style={{ fontSize: 11, color: "#64748B" }}>
                    Sync email invitations & calendar availability
                  </div>
                </div>
              </div>
              <button onClick={() => setShowAccountModal(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "#64748B" }}><X size={18} /></button>
            </div>

            {/* Provider Selector Buttons */}
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              {[
                { id: "google", label: "Google / Gmail", color: "#EA4335" },
                { id: "outlook", label: "Microsoft Outlook", color: "#0078D4" },
                { id: "smtp", label: "Custom SMTP", color: "#7C3AED" }
              ].map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setAccountForm({
                    ...accountForm,
                    provider: p.id,
                    smtpHost: p.id === "google" ? "smtp.gmail.com" : (p.id === "outlook" ? "smtp.office365.com" : "mail.company.com")
                  })}
                  style={{
                    flex: 1,
                    padding: "8px 4px",
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 600,
                    border: accountForm.provider === p.id ? `2px solid ${p.color}` : "1px solid #CBD5E1",
                    background: accountForm.provider === p.id ? `${p.color}15` : "#FFF",
                    color: accountForm.provider === p.id ? p.color : "#475569",
                    cursor: "pointer"
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <form onSubmit={handleSaveAccount} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#475569", display: "block", marginBottom: 4 }}>
                  Account Label / Nickname *
                </label>
                <input
                  type="text"
                  required
                  value={accountForm.name}
                  onChange={(e) => setAccountForm({ ...accountForm, name: e.target.value })}
                  placeholder="e.g. Sales Outreach, Support Desk, Personal VIP"
                  style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: 13 }}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#475569", display: "block", marginBottom: 4 }}>
                  Email Address *
                </label>
                <input
                  type="email"
                  required
                  value={accountForm.email}
                  onChange={(e) => setAccountForm({ ...accountForm, email: e.target.value })}
                  placeholder={accountForm.provider === "google" ? "user@gmail.com / user@company.com" : "user@outlook.com"}
                  style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: 13 }}
                />
              </div>

              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#475569", display: "block", marginBottom: 4 }}>
                  Sender Display Name
                </label>
                <input
                  type="text"
                  value={accountForm.senderName}
                  onChange={(e) => setAccountForm({ ...accountForm, senderName: e.target.value })}
                  placeholder="e.g. Jitendra S."
                  style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: 13 }}
                />
              </div>

              {accountForm.provider === "smtp" ? (
                <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: "#475569", display: "block", marginBottom: 4 }}>SMTP Host</label>
                    <input
                      type="text"
                      value={accountForm.smtpHost}
                      onChange={(e) => setAccountForm({ ...accountForm, smtpHost: e.target.value })}
                      placeholder="mail.yourcompany.com"
                      style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: 13 }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: "#475569", display: "block", marginBottom: 4 }}>Port</label>
                    <input
                      type="number"
                      value={accountForm.smtpPort}
                      onChange={(e) => setAccountForm({ ...accountForm, smtpPort: parseInt(e.target.value) || 587 })}
                      style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: 13 }}
                    />
                  </div>
                </div>
              ) : (
                <div style={{ background: "#FFF7ED", border: "1px solid #FED7AA", borderRadius: 8, padding: "10px 12px", fontSize: 12, color: "#9A3412", lineHeight: 1.5 }}>
                  <b>Gmail will not accept your normal password.</b> Use an App Password:
                  <ol style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                    <li>Open <a href="https://myaccount.google.com/security" target="_blank" rel="noreferrer">Google Account → Security</a></li>
                    <li>Turn on <b>2-Step Verification</b></li>
                    <li>Search <b>App passwords</b> → generate one for Mail</li>
                    <li>Paste the 16-character code below. SMTP host is smtp.gmail.com:587</li>
                  </ol>
                </div>
              )}

              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#475569", display: "block", marginBottom: 4 }}>
                  {accountForm.provider === "google" ? "Gmail App Password (required)" : "Password or App Password"}
                </label>
                <input
                  type="password"
                  value={accountForm.password}
                  onChange={(e) => setAccountForm({ ...accountForm, password: e.target.value })}
                  placeholder={accountForm.provider === "google" ? "16-character app password" : "••••••••••••"}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: 13 }}
                />
              </div>

              {/* Toggles */}
              <div style={{ display: "flex", flexDirection: "column", gap: 8, background: "#F8FAFC", padding: 12, borderRadius: 10, border: "1px solid #E2E8F0" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#334155", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={accountForm.syncCalendar}
                    onChange={(e) => setAccountForm({ ...accountForm, syncCalendar: e.target.checked })}
                  />
                  <span>Sync Calendar Events (Real-time conflict checking)</span>
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#334155", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={accountForm.sendInvites}
                    onChange={(e) => setAccountForm({ ...accountForm, sendInvites: e.target.checked })}
                  />
                  <span>Send Meeting Confirmation & Video Invites from this Account</span>
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#334155", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={accountForm.isPrimary}
                    onChange={(e) => setAccountForm({ ...accountForm, isPrimary: e.target.checked })}
                  />
                  <span>Set as Default Primary Scheduling Channel</span>
                </label>
              </div>

              {accountTestResult && (
                <div style={{
                  padding: "10px 12px",
                  borderRadius: 8,
                  fontSize: 12,
                  background: accountTestResult.success ? "#ECFDF5" : "#FFF1F2",
                  border: accountTestResult.success ? "1px solid #A7F3D0" : "1px solid #FECDD3",
                  color: accountTestResult.success ? "#065F46" : "#E11D48"
                }}>
                  {accountTestResult.message}
                </div>
              )}

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                <button
                  type="button"
                  onClick={handleTestAccount}
                  disabled={accountTesting}
                  style={{
                    padding: "8px 14px",
                    borderRadius: 8,
                    border: "1px solid #CBD5E1",
                    background: "#FFF",
                    fontSize: 12,
                    fontWeight: 600,
                    color: "#334155",
                    cursor: "pointer"
                  }}
                >
                  {accountTesting ? "Verifying..." : "Test Connection"}
                </button>

                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => setShowAccountModal(false)}
                    style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #CBD5E1", background: "#FFF", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    style={{ padding: "8px 18px", borderRadius: 8, border: "none", background: "#10B981", color: "#FFF", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                  >
                    Save & Activate
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reschedule Modal */}
      {reschedulingBooking && (
        <div style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.6)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 140,
          padding: 16
        }}>
          <div style={{ background: "#FFF", borderRadius: 16, width: "100%", maxWidth: 480, padding: 24, boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#0F172A" }}>Reschedule Meeting</div>
              <button onClick={() => setReschedulingBooking(null)} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
            </div>
            <div style={{ fontSize: 13, color: "#64748B", marginBottom: 16 }}>
              Rescheduling for <strong>{reschedulingBooking.prospect}</strong> ({reschedulingBooking.attendeeEmail}).
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 18 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#475569", display: "block", marginBottom: 4 }}>New Date</label>
                <input
                  type="date"
                  value={rescheduleDate}
                  onChange={(e) => {
                    setRescheduleDate(e.target.value);
                    fetchRescheduleSlots(e.target.value, reschedulingBooking.eventTypeSlug);
                  }}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: 13 }}
                />
              </div>

              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#475569", display: "block", marginBottom: 4 }}>New Time Slot</label>
                <select
                  value={rescheduleSlot || ""}
                  onChange={(e) => setRescheduleSlot(e.target.value)}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: 13 }}
                >
                  {rescheduleSlots.filter(s => s.available).map(s => (
                    <option key={s.time} value={s.time}>{s.time}</option>
                  ))}
                  {rescheduleSlots.filter(s => s.available).length === 0 && (
                    <option value="10:00">10:00 AM</option>
                  )}
                </select>
              </div>

              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#475569", display: "block", marginBottom: 4 }}>Reason for Rescheduling (Optional)</label>
                <input
                  type="text"
                  value={rescheduleReason}
                  onChange={(e) => setRescheduleReason(e.target.value)}
                  placeholder="e.g. Host schedule conflict, moved to afternoon"
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: 13 }}
                />
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button
                onClick={() => setReschedulingBooking(null)}
                style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #CBD5E1", background: "#FFF", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmReschedule}
                disabled={reschedulingLoading}
                style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "#10B981", color: "#FFF", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
              >
                {reschedulingLoading ? "Rescheduling..." : "Confirm Reschedule"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Confirmation Modal */}
      {cancellingBooking && (
        <div style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.6)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 140,
          padding: 16
        }}>
          <div style={{ background: "#FFF", borderRadius: 16, width: "100%", maxWidth: 440, padding: 24, boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#E11D48", marginBottom: 6 }}>Cancel Booking</div>
            <div style={{ fontSize: 13, color: "#64748B", marginBottom: 14 }}>
              Are you sure you want to cancel the meeting with <strong>{cancellingBooking.prospect}</strong>?
            </div>
            <div style={{ marginBottom: 18 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#475569", display: "block", marginBottom: 4 }}>Cancellation Reason</label>
              <input
                type="text"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="e.g. Prospect requested to cancel"
                style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: 13 }}
              />
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button
                onClick={() => setCancellingBooking(null)}
                style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #CBD5E1", background: "#FFF", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
              >
                Keep Booking
              </button>
              <button
                onClick={handleConfirmCancel}
                style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "#E11D48", color: "#FFF", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
              >
                Confirm Cancellation
              </button>
            </div>
          </div>
        </div>
      )}

      {disconnectAccount && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 150,
            padding: 16,
          }}
          onClick={() => !disconnectBusy && setDisconnectAccount(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#FFF",
              borderRadius: 16,
              width: "100%",
              maxWidth: 440,
              padding: 24,
              boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
              fontFamily: FONT_BODY,
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 700, color: "#E11D48", marginBottom: 6 }}>Disconnect account</div>
            <div style={{ fontSize: 13, color: "#64748B", marginBottom: 18, lineHeight: 1.45 }}>
              Remove{" "}
              <strong style={{ color: "#0F172A" }}>
                {disconnectAccount.email || disconnectAccount.name || "this communication account"}
              </strong>
              ? Meeting invites stop sending from this mailbox until you reconnect.
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button
                type="button"
                disabled={disconnectBusy}
                onClick={() => setDisconnectAccount(null)}
                style={{
                  padding: "8px 14px",
                  borderRadius: 8,
                  border: "1px solid #CBD5E1",
                  background: "#FFF",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: disconnectBusy ? "default" : "pointer",
                }}
              >
                Keep connected
              </button>
              <button
                type="button"
                disabled={disconnectBusy}
                onClick={handleConfirmDisconnect}
                style={{
                  padding: "8px 16px",
                  borderRadius: 8,
                  border: "none",
                  background: "#E11D48",
                  color: "#FFF",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: disconnectBusy ? "default" : "pointer",
                  opacity: disconnectBusy ? 0.7 : 1,
                }}
              >
                {disconnectBusy ? "Disconnecting…" : "Disconnect"}
              </button>
            </div>
          </div>
        </div>
      )}

      {saveMessage ? (
        <div
          style={{
            position: "fixed",
            bottom: 28,
            left: "50%",
            transform: "translateX(-50%)",
            background: C.ink || "#0F172A",
            color: "#fff",
            padding: "10px 18px",
            borderRadius: 10,
            fontSize: 13,
            fontWeight: 600,
            zIndex: 200,
            boxShadow: "0 12px 32px rgba(15,23,42,0.28)",
            fontFamily: FONT_BODY,
          }}
        >
          {saveMessage}
        </div>
      ) : null}

      {/* Booking Success Dialog */}
      {bookingSuccessModal && (
        <div style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.6)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 145,
          padding: 16
        }}>
          <div style={{ background: "#FFF", borderRadius: 16, width: "100%", maxWidth: 480, padding: 24, boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: "#ECFDF5", display: "flex", alignItems: "center", justifyContent: "center", color: "#059669", margin: "0 auto 12px auto" }}>
              <CheckCircle2 size={24} />
            </div>
            <div style={{ textAlign: "center", fontSize: 18, fontWeight: 700, color: "#0F172A", marginBottom: 4 }}>
              Meeting Successfully Confirmed!
            </div>
            <div style={{ textAlign: "center", fontSize: 13, color: "#64748B", marginBottom: 16 }}>
              Booked with <strong>{bookingSuccessModal.prospect}</strong> on <strong>{bookingSuccessModal.date} at {bookingSuccessModal.time}</strong>.
            </div>

            <div style={{ background: "#F8FAFC", borderRadius: 10, padding: 14, border: "1px solid #E2E8F0", marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: "#475569", marginBottom: 6 }}>
                <strong>Google Meet Video Room:</strong>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <code style={{ fontSize: 11, color: "#059669", flex: 1, background: "#FFF", padding: "6px 8px", borderRadius: 6, border: "1px solid #CBD5E1" }}>
                  {bookingSuccessModal.videoLink}
                </code>
                <button
                  onClick={() => handleCopy(bookingSuccessModal.videoLink, "meet_success")}
                  style={{ padding: "6px 10px", borderRadius: 6, background: "#10B981", color: "#FFF", border: "none", fontSize: 11, fontWeight: 600, cursor: "pointer" }}
                >
                  {copiedId === "meet_success" ? "Copied" : "Copy"}
                </button>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "center", gap: 10 }}>
              <button
                onClick={() => setBookingSuccessModal(null)}
                style={{ padding: "9px 24px", borderRadius: 8, background: "#0F172A", color: "#FFF", border: "none", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Event Type Modal */}
      {showEventModal && (
        <div style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.6)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 140,
          padding: 16
        }}>
          <div style={{ background: "#FFF", borderRadius: 16, width: "100%", maxWidth: 480, padding: 24, boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#0F172A" }}>Create New Event Type</div>
              <button onClick={() => setShowEventModal(false)} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
            </div>

            <form onSubmit={handleCreateEventType} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#475569", display: "block", marginBottom: 4 }}>Title *</label>
                <input
                  type="text"
                  required
                  value={eventForm.title}
                  onChange={(e) => setEventForm({ ...eventForm, title: e.target.value })}
                  placeholder="e.g. 60 Min Strategy Session"
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: 13 }}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "#475569", display: "block", marginBottom: 4 }}>Duration (min)</label>
                  <select
                    value={eventForm.length}
                    onChange={(e) => setEventForm({ ...eventForm, length: parseInt(e.target.value) || 15 })}
                    style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: 13 }}
                  >
                    <option value={15}>15 minutes</option>
                    <option value={20}>20 minutes</option>
                    <option value={30}>30 minutes</option>
                    <option value={45}>45 minutes</option>
                    <option value={60}>60 minutes</option>
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "#475569", display: "block", marginBottom: 4 }}>Location</label>
                  <select
                    value={eventForm.locationType}
                    onChange={(e) => setEventForm({ ...eventForm, locationType: e.target.value })}
                    style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: 13 }}
                  >
                    <option value="google_meet">Google Meet</option>
                    <option value="cal_video">Cal Video</option>
                    <option value="zoom">Zoom</option>
                    <option value="phone">Phone Call</option>
                  </select>
                </div>
              </div>

              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#475569", display: "block", marginBottom: 4 }}>Description</label>
                <textarea
                  rows={2}
                  value={eventForm.description}
                  onChange={(e) => setEventForm({ ...eventForm, description: e.target.value })}
                  placeholder="Outline meeting purpose and takeaways..."
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: 13 }}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
                <button
                  type="button"
                  onClick={() => setShowEventModal(false)}
                  style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #CBD5E1", background: "#FFF", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "#10B981", color: "#FFF", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                >
                  Create Event Type
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
