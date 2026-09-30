import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, Pause, Play, Plus, Trash2, X } from "lucide-react";
import { api } from "../../api/apiClient";
import { C, FONT_BODY, FONT_DISPLAY, HUB_PAPER } from "../../tokens";
import { formatOrgTime, orgToday, tzLabel, useOrg } from "../../org/orgSettings";
import { useEscapeLayer } from "./escapeLayers";

// Schedules: post right now, once, or on a repeating pattern. The server makes the posts a
// couple of weeks ahead, the AI writes them, and each one still needs approval.

const CHANNELS = [
  { id: "linkedin", label: "LinkedIn" },
  { id: "x", label: "X" },
  { id: "facebook", label: "Facebook" },
  { id: "instagram", label: "Instagram" },
  { id: "threads", label: "Threads" },
];
const DAY_NAMES = { MO: "Mon", TU: "Tue", WE: "Wed", TH: "Thu", FR: "Fri", SA: "Sat", SU: "Sun" };
const WEEK_ORDER = {
  monday: ["MO", "TU", "WE", "TH", "FR", "SA", "SU"],
  sunday: ["SU", "MO", "TU", "WE", "TH", "FR", "SA"],
  saturday: ["SA", "SU", "MO", "TU", "WE", "TH", "FR"],
};
const TABS = [
  { id: "content", label: "Content" },
  { id: "schedule", label: "Schedule" },
  { id: "approval", label: "Approval" },
  { id: "email", label: "Email" },
];

function blankForm(today) {
  return {
    id: "",
    name: "",
    plan: "",
    channels: ["linkedin"],
    makeImage: true,
    frequency: "recurring",
    pattern: "weekly",
    weekdays: [],
    monthDay: "",
    customDates: [],
    sameBrief: true,
    dateTopics: {},
    date: today,
    time: "10:00",
    startDate: today,
    endDate: "",
    approverEmails: "",
    resultEmails: "",
    retryCount: 1,
    retryDelayMin: 5,
  };
}

function formFromSchedule(s) {
  return {
    id: s.id,
    name: s.name || "",
    plan: s.plan || "",
    channels: s.channels || [],
    makeImage: s.makeImage !== false,
    frequency: s.frequency || "recurring",
    pattern: s.pattern || "weekly",
    weekdays: s.weekdays || [],
    monthDay: s.monthDay || "",
    customDates: s.customDates || [],
    sameBrief: !Object.keys(s.dateTopics || {}).length,
    dateTopics: s.dateTopics || {},
    date: s.startDate || "",
    time: s.time || "10:00",
    startDate: s.startDate || "",
    endDate: s.endDate || "",
    approverEmails: (s.approverEmails || []).join(", "),
    resultEmails: (s.resultEmails || []).join(", "),
    retryCount: s.retryCount == null ? 1 : s.retryCount,
    retryDelayMin: s.retryDelayMin || 5,
  };
}

function payloadOf(form) {
  return {
    name: form.name,
    plan: form.plan,
    channels: form.channels,
    makeImage: form.makeImage,
    frequency: form.frequency,
    pattern: form.pattern,
    weekdays: form.weekdays,
    monthDay: form.monthDay ? Number(form.monthDay) : null,
    customDates: form.customDates,
    // Topics are kept while "same brief" is ticked (untick to get them back) but not sent.
    dateTopics: form.frequency === "recurring" && !form.sameBrief ? form.dateTopics : {},
    date: form.date,
    time: form.time,
    startDate: form.frequency === "once" ? form.date : form.startDate,
    endDate: form.endDate,
    approverEmails: form.approverEmails,
    resultEmails: form.resultEmails,
    retryCount: Number(form.retryCount),
    retryDelayMin: Number(form.retryDelayMin),
  };
}

function dayText(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return iso;
  const wd = d.toLocaleDateString("en-GB", { weekday: "short" });
  return wd + " " + d.getDate() + " " + d.toLocaleDateString("en-GB", { month: "short" });
}

function longDay(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function ruleText(s, timeFormat) {
  const at = formatOrgTime(s.time, timeFormat);
  if (s.frequency === "now") return "Right now";
  if (s.frequency === "once") return "Once · " + dayText(s.startDate) + " · " + at;
  if (s.pattern === "daily") return "Daily · " + at;
  if (s.pattern === "weekly") return "Weekly · " + (s.weekdays || []).map((d) => DAY_NAMES[d]).join(", ") + " · " + at;
  if (s.pattern === "monthly") return "Monthly · day " + s.monthDay + " · " + at;
  return (s.customDates || []).length + " dates · " + at;
}

function statusPill(s) {
  if (s.status === "paused") return { text: "Paused", color: C.slate };
  if (s.status === "ended") return { text: "Ended", color: C.slate };
  if (s.frequency !== "recurring" && s.posts > 0) return { text: "Made", color: C.teal };
  return { text: "Active", color: C.teal };
}

export function ScheduleWindow({ open, onClose, onChanged }) {
  const org = useOrg();
  const today = orgToday(org.timezone);
  const [list, setList] = useState([]);
  const [form, setForm] = useState(() => blankForm(today));
  const [tab, setTab] = useState("content");
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [dateToAdd, setDateToAdd] = useState("");
  const [topicToAdd, setTopicToAdd] = useState("");
  const [pasteList, setPasteList] = useState("");
  const [pasteNote, setPasteNote] = useState(null);
  const [topicPaste, setTopicPaste] = useState("");
  const [topicNote, setTopicNote] = useState("");

  useEscapeLayer(open, 1, onClose);

  const loadList = useCallback(async () => {
    try {
      const res = await api.listSchedules();
      setList((res && res.schedules) || []);
    } catch (_) {
      setList([]);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    loadList();
    setMessage("");
  }, [open, loadList]);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  // Custom dates, each with an optional topic of its own.
  const addDates = (pairs) => {
    setForm((f) => {
      const topics = { ...(f.dateTopics || {}) };
      let gotTopic = false;
      pairs.forEach(([d, t]) => {
        if (String(t || "").trim()) {
          topics[d] = String(t).trim();
          gotTopic = true;
        }
      });
      return {
        ...f,
        customDates: [...new Set([...f.customDates, ...pairs.map(([d]) => d)])].sort(),
        dateTopics: topics,
        sameBrief: gotTopic ? false : f.sameBrief,
      };
    });
  };
  // Pasted topics fill the dates that have none yet, in date order.
  const fillTopicsInOrder = (dates) => {
    const lines = topicPaste.split("\n").map((l) => l.trim()).filter(Boolean);
    const topics = { ...(form.dateTopics || {}) };
    let used = 0;
    dates.forEach((d) => {
      if (used < lines.length && !String(topics[d] || "").trim()) {
        topics[d] = lines[used];
        used += 1;
      }
    });
    set({ dateTopics: topics });
    setTopicPaste(lines.slice(used).join("\n"));
    setTopicNote(used < lines.length
      ? "Filled " + used + ". " + (lines.length - used) + " left over: every date already has a topic."
      : "Filled " + used + " date" + (used === 1 ? "" : "s") + ".");
  };

  const removeDate = (d) => {
    setForm((f) => {
      const topics = { ...(f.dateTopics || {}) };
      delete topics[d];
      return { ...f, customDates: f.customDates.filter((x) => x !== d), dateTopics: topics };
    });
  };
  const addPasted = () => {
    const pairs = [];
    const bad = [];
    pasteList.split("\n").map((l) => l.trim()).filter(Boolean).forEach((line) => {
      const m = line.match(/^(\d{4}-\d{2}-\d{2})\s*[-–—:|,]?\s*(.*)$/);
      if (m && !Number.isNaN(new Date(m[1] + "T00:00:00").getTime())) pairs.push([m[1], m[2]]);
      else bad.push(line);
    });
    if (pairs.length) addDates(pairs);
    setPasteList(bad.join("\n"));
    setPasteNote(bad.length
      ? { ok: false, text: "Added " + pairs.length + ". These lines need a date like 2026-10-02 first." }
      : { ok: true, text: "Added " + pairs.length + " date" + (pairs.length === 1 ? "" : "s") + "." });
  };

  // Show which dates the schedule would post on, as the user fills it in.
  useEffect(() => {
    if (!open) return undefined;
    // With a topic per date the brief is optional; the preview still lists the dates so each
    // can get its topic.
    const topicsMode = form.frequency === "recurring" && !form.sameBrief;
    if (!form.name.trim() || (!form.plan.trim() && !topicsMode)) {
      setPreview(null);
      setPreviewError("");
      return undefined;
    }
    const t = window.setTimeout(async () => {
      try {
        const res = await api.previewSchedule(payloadOf(form));
        setPreview(res && res.schedule);
        setPreviewError("");
      } catch (e) {
        setPreview(null);
        setPreviewError(e.message || "Check the schedule.");
      }
    }, 450);
    return () => window.clearTimeout(t);
  }, [open, form]);

  const pick = (s) => {
    setForm(s ? formFromSchedule(s) : blankForm(today));
    setTab("content");
    setMessage("");
  };

  const save = async () => {
    setSaving(true);
    setMessage("");
    try {
      const res = form.id
        ? await api.saveSchedule(form.id, payloadOf(form))
        : await api.createSchedule(payloadOf(form));
      const sched = res && res.schedule;
      if (sched) setForm(formFromSchedule(sched));
      await loadList();
      const made = sched ? sched.posts : 0;
      const note = form.id
        ? "Saved." + (res.replaced ? " " + res.replaced + " upcoming post" + (res.replaced === 1 ? " was" : "s were") + " replaced to match." : "")
        : "Schedule saved. " + made + " post" + (made === 1 ? " is" : "s are") + " being written now; each one needs approval.";
      setMessage(note);
      if (onChanged) onChanged(note);
    } catch (e) {
      setMessage(e.message || "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async () => {
    const s = list.find((x) => x.id === form.id);
    if (!s) return;
    try {
      const res = await api.setScheduleStatus(s.id, s.status === "paused" ? "active" : "paused");
      await loadList();
      const note = s.status === "paused"
        ? "Running again."
        : "Paused." + (res.removed ? " " + res.removed + " upcoming unapproved post" + (res.removed === 1 ? " was" : "s were") + " removed." : "");
      setMessage(note);
      if (onChanged) onChanged(note);
    } catch (e) {
      setMessage(e.message || "Could not change it.");
    }
  };

  const remove = async () => {
    if (!form.id) return;
    if (!window.confirm("Delete this schedule? Its upcoming posts that nobody approved or edited are removed. Posted, approved and hand-edited posts stay on the calendar.")) return;
    try {
      const res = await api.deleteSchedule(form.id);
      await loadList();
      pick(null);
      const note = "Schedule deleted." + (res.removed ? " " + res.removed + " upcoming post" + (res.removed === 1 ? " was" : "s were") + " removed." : "");
      setMessage(note);
      if (onChanged) onChanged(note);
    } catch (e) {
      setMessage(e.message || "Could not delete it.");
    }
  };

  const weekOrder = WEEK_ORDER[org.weekStart] || WEEK_ORDER.monday;
  const current = list.find((x) => x.id === form.id);

  const topicsMode = form.frequency === "recurring" && !form.sameBrief;
  // The dates that can get their own topic: the picked custom dates, or every date to come.
  const topicDates = !topicsMode ? [] : form.pattern === "dates"
    ? form.customDates.filter((d) => d >= today)
    : ((preview && preview.allDates) || []);
  const topicCount = topicDates.filter((d) => String((form.dateTopics || {})[d] || "").trim()).length;
  const topicsMissing = topicsMode && !form.plan.trim() ? topicDates.length - topicCount : 0;
  const summary = useMemo(() => {
    if (previewError) return { tone: "warn", text: previewError };
    if (!preview) return { tone: "idle", text: "Name the schedule and say what to post about to see the dates." };
    if (form.frequency === "now") return { tone: "ok", text: "One post, written now and posted as soon as it is approved." };
    const n = preview.upcomingCount;
    if (!n) return { tone: "warn", text: "No dates fall between the start and end date." };
    if (topicsMissing) {
      return { tone: "warn", text: topicsMissing + " of " + topicDates.length + " dates still need a topic. Give each one a topic, or write a background brief that covers them." };
    }
    const first = (preview.upcoming || []).map(dayText).join(", ");
    const channels = (form.channels || []).length;
    const perDate = channels > 1 ? " × " + channels + " channels" : "";
    return {
      tone: "ok",
      text: n + " date" + (n === 1 ? "" : "s") + perDate + ": " + first + (n > (preview.upcoming || []).length ? ", …" : "")
        + (form.frequency === "recurring" ? " · ends " + longDay(preview.endDate) : "")
        + (topicCount ? " · " + topicCount + " with their own topic" : ""),
    };
  }, [preview, previewError, form.frequency, form.channels, topicCount, topicsMissing, topicDates.length]);

  if (!open) return null;

  return (
    <div style={overlay} onClick={onClose}>
      <div role="dialog" aria-label="Schedules" style={dialog} onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: "14px 18px", borderBottom: `1px solid ${C.border}`, background: "#fff", display: "flex", alignItems: "center", gap: 10 }}>
          <CalendarClock size={18} color={C.teal} />
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18 }}>Schedules</div>
            <div style={{ fontSize: 12, color: C.slate }}>Times in {tzLabel(org.timezone)}. Every post needs approval before it goes live.</div>
          </div>
          <button type="button" onClick={onClose} title="Close" style={{ border: "none", background: "transparent", cursor: "pointer" }}><X size={18} /></button>
        </div>

        <div style={{ flex: 1, minHeight: 0, display: "flex", flexWrap: "wrap" }}>
          <div style={{ width: 250, flexGrow: 1, maxWidth: "100%", borderRight: `1px solid ${C.border}`, background: HUB_PAPER, padding: 12, overflowY: "auto", boxSizing: "border-box", maxHeight: "100%" }}>
            <button type="button" onClick={() => pick(null)} style={{ ...priBtn, width: "100%", justifyContent: "center", marginBottom: 10 }}>
              <Plus size={14} /> New schedule
            </button>
            {!list.length ? <div style={{ fontSize: 12, color: C.slate, padding: 4 }}>No schedules yet.</div> : null}
            {list.map((s) => {
              const pill = statusPill(s);
              const on = s.id === form.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => pick(s)}
                  style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 11px", marginBottom: 6, borderRadius: 10, border: `1px solid ${on ? C.teal : C.border}`, background: on ? "#EAF5F3" : "#fff", cursor: "pointer", fontFamily: FONT_BODY }}
                >
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <span style={{ fontWeight: 700, fontSize: 13, color: C.ink, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: pill.color }}>{pill.text}</span>
                  </div>
                  <div style={{ fontSize: 11.5, color: C.slate, marginTop: 2 }}>{ruleText(s, org.timeFormat)}</div>
                  <div style={{ fontSize: 11, color: C.slateLight, marginTop: 2 }}>
                    {s.posts} post{s.posts === 1 ? "" : "s"} made{s.frequency === "recurring" && s.endDate ? " · until " + dayText(s.endDate) : ""}
                  </div>
                </button>
              );
            })}
          </div>

          <div style={{ flex: "999 1 420px", minWidth: 0, display: "flex", flexDirection: "column", maxHeight: "100%" }}>
            <div style={{ display: "flex", gap: 4, padding: "10px 16px 0", borderBottom: `1px solid ${C.border}`, background: "#fff", overflowX: "auto" }}>
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  style={{ height: 36, padding: "0 14px", border: "none", borderBottom: `2px solid ${tab === t.id ? C.teal : "transparent"}`, background: "transparent", color: tab === t.id ? C.ink : C.slate, fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: FONT_BODY }}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 16, background: "#fff" }}>
              {current && current.status === "ended" ? (
                <Note tone="warn">{current.endedReason || "This schedule has ended."} Change the end date and save to run it again.</Note>
              ) : null}
              {form.id ? (
                <Note>Saving changes replaces upcoming posts that nobody approved or edited by hand. Approved and hand-edited posts stay as they are.</Note>
              ) : null}

              {tab === "content" ? (
                <>
                  <Field label="Name">
                    <input aria-label="Schedule name" value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Weekly operations tips" style={input} />
                  </Field>
                  {form.frequency === "recurring" ? (
                    <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, color: C.ink, cursor: "pointer", marginBottom: 12 }}>
                      <input type="checkbox" aria-label="Same brief for every post" checked={form.sameBrief} onChange={(e) => set({ sameBrief: e.target.checked })} style={{ marginTop: 2 }} />
                      <span>
                        <b>Same brief for every post</b>
                        <span style={{ display: "block", fontSize: 12, color: C.slate }}>The AI writes a new angle each time. Untick to give each date its own topic.</span>
                      </span>
                    </label>
                  ) : null}
                  <Field
                    label={topicsMode ? "Background for all posts (optional)" : "What should the posts be about?"}
                    hint={topicsMode
                      ? "Used as context for every post, and as the topic for any date you leave empty."
                      : "Each post gets its own angle within this. The AI avoids repeating earlier posts."}
                  >
                    <textarea aria-label="What to post about" value={form.plan} onChange={(e) => set({ plan: e.target.value })} rows={topicsMode ? 3 : 5} placeholder="e.g. Practical tips that help small teams run operations with less admin. Mix how-tos, lessons and one product mention a month." style={{ ...input, height: "auto", padding: 10, resize: "vertical" }} />
                  </Field>
                  {topicsMode ? (
                    form.pattern === "dates" ? (
                      <Note>Set each date's topic next to it on the Schedule tab (Custom dates).</Note>
                    ) : (
                      <Field label={"Topic for each date · " + topicCount + " of " + topicDates.length + " set"}>
                        {!topicDates.length ? (
                          <div style={{ fontSize: 12.5, color: C.slate }}>Set the pattern and dates on the Schedule tab; the dates show up here.</div>
                        ) : (
                          <>
                            <details style={{ marginBottom: 8 }}>
                              <summary style={{ fontSize: 12.5, color: C.teal, fontWeight: 700, cursor: "pointer" }}>Paste topics in order</summary>
                              <textarea
                                aria-label="Paste topics in order"
                                value={topicPaste}
                                onChange={(e) => setTopicPaste(e.target.value)}
                                rows={5}
                                placeholder={"One topic per line. They fill the dates without a topic, in date order.\nOnboarding checklist\nWhy spreadsheets break"}
                                style={{ ...input, height: "auto", padding: 10, marginTop: 6, fontSize: 12.5, resize: "vertical" }}
                              />
                              <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
                                <button type="button" disabled={!topicPaste.trim()} onClick={() => fillTopicsInOrder(topicDates)} style={secBtn}>Fill dates</button>
                                {topicNote ? <span style={{ fontSize: 12, color: C.teal }}>{topicNote}</span> : null}
                              </div>
                            </details>
                            <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 320, overflowY: "auto", paddingRight: 4 }}>
                              {topicDates.map((d) => (
                                <div key={d} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                  <span style={{ width: 96, flexShrink: 0, fontSize: 12.5, fontWeight: 700, color: C.ink }}>{dayText(d)}</span>
                                  <input
                                    aria-label={"Topic for " + d}
                                    value={(form.dateTopics || {})[d] || ""}
                                    onChange={(e) => set({ dateTopics: { ...(form.dateTopics || {}), [d]: e.target.value } })}
                                    placeholder={form.plan.trim() ? "Follows the background brief" : "Topic for this post"}
                                    style={{ ...input, height: 34 }}
                                  />
                                </div>
                              ))}
                            </div>
                          </>
                        )}
                      </Field>
                    )
                  ) : null}
                  <Field label="Channels" hint="With more than one, each date gets the same post on every channel.">
                    <Chips options={CHANNELS} value={form.channels} onChange={(v) => set({ channels: v })} />
                  </Field>
                  <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: C.ink, cursor: "pointer" }}>
                    <input type="checkbox" checked={form.makeImage} onChange={(e) => set({ makeImage: e.target.checked })} />
                    Create an image for each post
                  </label>
                </>
              ) : null}

              {tab === "schedule" ? (
                <>
                  <Field label="Frequency">
                    <Segmented
                      value={form.frequency}
                      onChange={(v) => set({ frequency: v })}
                      options={[{ id: "now", label: "Right now" }, { id: "once", label: "Once" }, { id: "recurring", label: "Recurring" }]}
                    />
                  </Field>
                  {form.frequency === "now" ? (
                    <Note>Written now and posted as soon as it is approved. If nobody approves it within a day it is skipped.</Note>
                  ) : null}
                  {form.frequency === "once" ? (
                    <Row>
                      <Field label="Date"><input type="date" aria-label="Date" min={today} value={form.date} onChange={(e) => set({ date: e.target.value })} style={input} /></Field>
                      <Field label="Time"><input type="time" aria-label="Time" value={form.time} onChange={(e) => set({ time: e.target.value })} style={input} /></Field>
                    </Row>
                  ) : null}
                  {form.frequency === "recurring" ? (
                    <>
                      <Field label="Pattern">
                        <Segmented
                          value={form.pattern}
                          onChange={(v) => set({ pattern: v })}
                          options={[{ id: "daily", label: "Daily" }, { id: "weekly", label: "Weekly" }, { id: "monthly", label: "Monthly" }, { id: "dates", label: "Custom dates" }]}
                        />
                      </Field>
                      {form.pattern === "weekly" ? (
                        <Field label="On">
                          <Chips options={weekOrder.map((d) => ({ id: d, label: DAY_NAMES[d] }))} value={form.weekdays} onChange={(v) => set({ weekdays: v })} />
                        </Field>
                      ) : null}
                      {form.pattern === "monthly" ? (
                        <Field label="Day of the month" hint="On shorter months a 31st posts on the last day.">
                          <input type="number" aria-label="Day of the month" min={1} max={31} value={form.monthDay} onChange={(e) => set({ monthDay: e.target.value })} placeholder={String(new Date(form.startDate + "T00:00:00").getDate() || 1)} style={{ ...input, width: 100 }} />
                        </Field>
                      ) : null}
                      {form.pattern === "dates" ? (
                        <Field label="Dates and topics" hint="Each date can have its own topic. Dates left without one follow the brief on the Content tab.">
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                            <input type="date" aria-label="Date to add" min={today} value={dateToAdd} onChange={(e) => setDateToAdd(e.target.value)} style={{ ...input, width: 170 }} />
                            {topicsMode ? (
                              <input aria-label="Topic for that date" value={topicToAdd} onChange={(e) => setTopicToAdd(e.target.value)} placeholder="Topic for that post (optional)" style={{ ...input, flex: "1 1 200px", width: "auto" }} />
                            ) : null}
                            <button type="button" disabled={!dateToAdd} onClick={() => { addDates([[dateToAdd, topicToAdd]]); setDateToAdd(""); setTopicToAdd(""); }} style={secBtn}>
                              Add date
                            </button>
                          </div>
                          <details style={{ marginTop: 8 }}>
                            <summary style={{ fontSize: 12.5, color: C.teal, fontWeight: 700, cursor: "pointer" }}>Paste many dates and topics</summary>
                            <textarea
                              aria-label="Paste dates and topics"
                              value={pasteList}
                              onChange={(e) => setPasteList(e.target.value)}
                              rows={5}
                              placeholder={"One per line, date first:\n2026-10-02 Onboarding checklist\n2026-10-05 Why spreadsheets break"}
                              style={{ ...input, height: "auto", padding: 10, marginTop: 6, fontSize: 12.5, resize: "vertical" }}
                            />
                            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}>
                              <button type="button" disabled={!pasteList.trim()} onClick={addPasted} style={secBtn}>Add all</button>
                              {pasteNote ? <span style={{ fontSize: 12, color: pasteNote.ok ? C.teal : C.red }}>{pasteNote.text}</span> : null}
                            </div>
                          </details>
                          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
                            {form.customDates.map((d) => (
                              <div key={d} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ width: 96, flexShrink: 0, fontSize: 12.5, fontWeight: 700, color: C.ink }}>{dayText(d)}</span>
                                {topicsMode ? (
                                  <input
                                    aria-label={"Topic for " + d}
                                    value={(form.dateTopics || {})[d] || ""}
                                    onChange={(e) => set({ dateTopics: { ...(form.dateTopics || {}), [d]: e.target.value } })}
                                    placeholder={form.plan.trim() ? "Follows the brief" : "Topic for this post"}
                                    style={{ ...input, height: 34 }}
                                  />
                                ) : <span style={{ flex: 1 }} />}
                                <button type="button" aria-label={"Remove " + d} onClick={() => removeDate(d)} style={{ border: "none", background: "transparent", cursor: "pointer", padding: 4, display: "flex", color: C.slate }}>
                                  <X size={14} />
                                </button>
                              </div>
                            ))}
                          </div>
                        </Field>
                      ) : null}
                      <Row>
                        {form.pattern !== "dates" ? (
                          <>
                            <Field label="Starts"><input type="date" aria-label="Start date" value={form.startDate} onChange={(e) => set({ startDate: e.target.value })} style={input} /></Field>
                            <Field label="Ends" hint={form.endDate ? "" : "Default: 3 months after the start."}>
                              <input type="date" aria-label="End date" value={form.endDate} onChange={(e) => set({ endDate: e.target.value })} style={input} />
                            </Field>
                          </>
                        ) : null}
                        <Field label="Time"><input type="time" aria-label="Time" value={form.time} onChange={(e) => set({ time: e.target.value })} style={input} /></Field>
                      </Row>
                      <Note>Two weeks before the end you get an email to keep it going. If you do nothing, it ends on its end date.</Note>
                    </>
                  ) : null}
                  {form.frequency !== "now" ? (
                    <Field label="If publishing fails">
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 13, color: C.ink }}>
                        Try again
                        <select aria-label="Retries" value={form.retryCount} onChange={(e) => set({ retryCount: Number(e.target.value) })} style={{ ...input, width: 70 }}>
                          {[0, 1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
                        </select>
                        time{Number(form.retryCount) === 1 ? "" : "s"}, waiting
                        <input type="number" aria-label="Minutes between retries" min={1} max={120} value={form.retryDelayMin} onChange={(e) => set({ retryDelayMin: e.target.value })} style={{ ...input, width: 80 }} />
                        minutes
                      </div>
                    </Field>
                  ) : null}
                </>
              ) : null}

              {tab === "approval" ? (
                <>
                  <Note>Every post needs approval before it goes live. Approvers get one email per batch of posts with a link to approve or reject each one. The creator can also approve in the Approvals window. A post not approved by its time is skipped.</Note>
                  <Field label="Organisation approvers" hint="Set in Company Profile or the Approvals window.">
                    <div style={{ fontSize: 13, color: (org.approverEmails || []).length ? C.ink : C.slate }}>
                      {(org.approverEmails || []).join(", ") || "None set: approval emails are off, approve in the app."}
                    </div>
                  </Field>
                  <Field label="Approvers for this schedule (optional)" hint="Leave empty to use the organisation approvers. Separate emails with commas.">
                    <input aria-label="Schedule approvers" value={form.approverEmails} onChange={(e) => set({ approverEmails: e.target.value })} placeholder={(org.approverEmails || []).join(", ") || "name@company.com"} style={input} />
                  </Field>
                </>
              ) : null}

              {tab === "email" ? (
                <>
                  <Field label="Send results to" hint="Who hears what was posted, what failed and what missed approval, plus the end-of-schedule reminder. Leave empty for the organisation approvers.">
                    <input aria-label="Results email" value={form.resultEmails} onChange={(e) => set({ resultEmails: e.target.value })} placeholder={(org.approverEmails || []).join(", ") || "owner@company.com"} style={input} />
                  </Field>
                  <Note>One email after each publishing round, not one per post.</Note>
                </>
              ) : null}
            </div>

            <div style={{ borderTop: `1px solid ${C.border}`, padding: "10px 16px", background: "#fff" }}>
              <div style={{ fontSize: 12.5, color: summary.tone === "warn" ? C.red : summary.tone === "ok" ? C.ink : C.slate, marginBottom: 8, lineHeight: 1.4 }}>
                {summary.text}
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                {current ? (
                  <>
                    {current.status !== "ended" && current.frequency === "recurring" ? (
                      <button type="button" onClick={toggleStatus} style={secBtn}>
                        {current.status === "paused" ? <><Play size={13} /> Resume</> : <><Pause size={13} /> Pause</>}
                      </button>
                    ) : null}
                    <button type="button" onClick={remove} style={{ ...secBtn, color: "#B42318", borderColor: "#F3D1CD" }}>
                      <Trash2 size={13} /> Delete
                    </button>
                  </>
                ) : null}
                <div style={{ flex: 1, fontSize: 12, color: C.teal, fontWeight: 600 }}>{message}</div>
                <button type="button" onClick={save} disabled={saving || !!previewError || !preview} style={{ ...priBtn, opacity: saving || previewError || !preview ? 0.6 : 1 }}>
                  {saving ? "Saving…" : form.id ? "Save changes" : form.frequency === "now" ? "Write it now" : "Save schedule"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <div style={{ marginBottom: 14, flex: 1, minWidth: 140 }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: C.slate, marginBottom: 6 }}>{label}</div>
      {children}
      {hint ? <div style={{ fontSize: 11.5, color: C.slateLight, marginTop: 5 }}>{hint}</div> : null}
    </div>
  );
}

function Row({ children }) {
  return <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>{children}</div>;
}

function Note({ children, tone }) {
  return (
    <div style={{ fontSize: 12.5, lineHeight: 1.45, color: C.ink, background: tone === "warn" ? (C.amberSoft || "#FCEFDA") : HUB_PAPER, border: `1px solid ${C.border}`, borderRadius: 10, padding: "8px 10px", marginBottom: 14 }}>
      {children}
    </div>
  );
}

function Segmented({ value, onChange, options }) {
  return (
    <div style={{ display: "inline-flex", gap: 3, background: HUB_PAPER, borderRadius: 10, padding: 3, flexWrap: "wrap" }}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          style={{ height: 32, padding: "0 12px", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 12.5, fontFamily: FONT_BODY, background: value === o.id ? "#fff" : "transparent", color: value === o.id ? C.ink : C.slate, boxShadow: value === o.id ? "0 1px 3px rgba(18,20,28,0.08)" : "none" }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Chips({ options, value, onChange }) {
  const on = new Set(value || []);
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={on.has(o.id)}
          onClick={() => onChange(on.has(o.id) ? (value || []).filter((x) => x !== o.id) : [...(value || []), o.id])}
          style={{ height: 32, padding: "0 12px", borderRadius: 99, cursor: "pointer", fontWeight: 700, fontSize: 12.5, fontFamily: FONT_BODY, border: `1px solid ${on.has(o.id) ? C.teal : C.border}`, background: on.has(o.id) ? "#EAF5F3" : "#fff", color: on.has(o.id) ? C.teal : C.slate }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const overlay = { position: "fixed", inset: 0, background: "rgba(18,20,28,0.4)", zIndex: 60, display: "flex", justifyContent: "center", alignItems: "center", padding: 16 };
const dialog = {
  width: "min(1040px, 100%)",
  height: "min(760px, calc(100vh - 32px))",
  background: "#fff",
  borderRadius: 16,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  boxShadow: "0 24px 64px rgba(18,20,28,0.28)",
  fontFamily: FONT_BODY,
  color: C.ink,
};
const input = { width: "100%", height: 38, borderRadius: 9, border: `1px solid ${C.border}`, padding: "0 10px", fontFamily: FONT_BODY, fontSize: 13, boxSizing: "border-box", background: "#fff", color: C.ink };
const secBtn = { display: "inline-flex", alignItems: "center", gap: 6, height: 36, padding: "0 12px", borderRadius: 9, border: `1px solid ${C.border}`, background: "#fff", color: C.ink, fontWeight: 700, fontSize: 12.5, cursor: "pointer", fontFamily: FONT_BODY };
const priBtn = { ...secBtn, border: "none", background: C.ink, color: "#fff" };
