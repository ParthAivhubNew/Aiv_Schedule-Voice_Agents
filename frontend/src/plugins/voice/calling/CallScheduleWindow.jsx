import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, Pause, Play, Plus, Trash2, X } from "lucide-react";
import { api } from "../../../api/apiClient";
import { C, FONT_DISPLAY, HUB_PAPER } from "../../../tokens";
import { formatOrgTime, orgToday, tzLabel, useOrg } from "../../../org/orgSettings";
import { useEscapeLayer } from "../../scheduler/escapeLayers";
import {
  Chips, DAY_NAMES, Field, Note, Row, Segmented, WEEK_ORDER, dayText, dialog, input, longDay, overlay, priBtn, secBtn,
} from "../../scheduler/ScheduleWindow";

// Call schedules: dial a Call list right now, once, or on a repeating pattern, at one or more times a day.
// The server starts each run at its time, so nothing has to stay open in a browser.

const TABS = [
  { id: "calls", label: "Calls" },
  { id: "schedule", label: "Schedule" },
  { id: "history", label: "History" },
];
const MAX_TIMES = 6;

function blankForm(today) {
  return {
    id: "", name: "", listId: "", fromNumber: "", concurrency: 1, frequency: "recurring", pattern: "weekly",
    weekdays: [], monthDay: "", customDates: [], date: today, times: ["10:00"], startDate: today, endDate: "",
  };
}

function formFromSchedule(s) {
  return {
    id: s.id, name: s.name || "", listId: s.listId || "", fromNumber: s.fromNumber || "", concurrency: s.concurrency || 1,
    frequency: s.frequency || "recurring", pattern: s.pattern || "weekly", weekdays: s.weekdays || [],
    monthDay: s.monthDay || "", customDates: s.customDates || [], date: s.startDate || "",
    times: s.times && s.times.length ? s.times : ["10:00"], startDate: s.startDate || "", endDate: s.endDate || "",
  };
}

function payloadOf(form) {
  return {
    name: form.name, listId: form.listId, fromNumber: form.fromNumber, concurrency: Number(form.concurrency) || 1,
    frequency: form.frequency, pattern: form.pattern, weekdays: form.weekdays,
    monthDay: form.monthDay ? Number(form.monthDay) : null, customDates: form.customDates,
    date: form.date, times: form.times, startDate: form.frequency === "once" ? form.date : form.startDate, endDate: form.endDate,
  };
}

// "2026-10-30 09:30" -> "Fri 30 Oct · 9:30 am"
function slotText(slot, timeFormat) {
  const [d, t] = String(slot).split(" ");
  return t ? dayText(d) + " · " + formatOrgTime(t, timeFormat) : slot;
}

function ruleText(s, timeFormat) {
  const at = (s.times || []).map((t) => formatOrgTime(t, timeFormat)).join(", ");
  if (s.frequency === "now") return "Dialled right now";
  if (s.frequency === "once") return "Once · " + dayText(s.startDate) + " · " + at;
  if (s.pattern === "daily") return "Daily · " + at;
  if (s.pattern === "weekly") return "Weekly · " + (s.weekdays || []).map((d) => DAY_NAMES[d]).join(", ") + " · " + at;
  if (s.pattern === "monthly") return "Monthly · day " + s.monthDay + " · " + at;
  return (s.customDates || []).length + " dates · " + at;
}

function statusPill(s) {
  if (s.status === "paused") return { text: "Paused", color: C.slate };
  if (s.status === "ended") return { text: "Ended", color: C.slate };
  return { text: "Active", color: C.teal };
}

export function CallScheduleWindow({ open, onClose, onChanged }) {
  const org = useOrg();
  const today = orgToday(org.timezone);
  const [list, setList] = useState([]);
  const [lists, setLists] = useState([]);
  const [numbers, setNumbers] = useState([]);
  const [form, setForm] = useState(() => blankForm(today));
  const [tab, setTab] = useState("calls");
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [dateToAdd, setDateToAdd] = useState("");

  useEscapeLayer(open, 1, onClose);

  const loadList = useCallback(async () => {
    try {
      const res = await api.listCallSchedules();
      setList((res && res.schedules) || []);
    } catch (_) {
      setList([]);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    loadList();
    setMessage("");
    api.getCallLists().then((r) => setLists((r && r.lists) || [])).catch(() => setLists([]));
    api.getNumbers().then((r) => setNumbers(Array.isArray(r) ? r.filter((n) => n.usableByMe) : [])).catch(() => setNumbers([]));
  }, [open, loadList]);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const setTime = (i, v) => setForm((f) => ({ ...f, times: f.times.map((t, j) => (j === i ? v : t)) }));
  const addTime = () => setForm((f) => {
    const last = f.times[f.times.length - 1] || "09:00";
    const [h, m] = last.split(":").map(Number);
    const next = String(Math.min(23, (h || 9) + 2)).padStart(2, "0") + ":" + String(m || 0).padStart(2, "0");
    return { ...f, times: [...f.times, next] };
  });
  const removeTime = (i) => setForm((f) => ({ ...f, times: f.times.filter((_, j) => j !== i) }));
  const addDate = () => {
    if (!dateToAdd) return;
    set({ customDates: [...new Set([...form.customDates, dateToAdd])].sort() });
    setDateToAdd("");
  };

  // The call times the schedule would have, as the user fills it in.
  useEffect(() => {
    if (!open) return undefined;
    if (!form.name.trim() || !form.listId) {
      setPreview(null);
      setPreviewError("");
      return undefined;
    }
    const t = window.setTimeout(async () => {
      try {
        const res = await api.previewCallSchedule(payloadOf(form));
        if (res && res.ok) {
          setPreview(res);
          setPreviewError("");
        } else {
          setPreview(null);
          setPreviewError((res && res.message) || "Check the schedule.");
        }
      } catch (e) {
        setPreview(null);
        setPreviewError(e.message || "Check the schedule.");
      }
    }, 400);
    return () => window.clearTimeout(t);
  }, [open, form]);

  const pick = (s) => {
    setForm(s ? formFromSchedule(s) : blankForm(today));
    setTab(s ? "schedule" : "calls");
    setMessage("");
  };

  const save = async () => {
    setSaving(true);
    setMessage("");
    try {
      const res = form.id ? await api.saveCallSchedule(form.id, payloadOf(form)) : await api.createCallSchedule(payloadOf(form));
      const sched = res && res.schedule;
      if (sched && sched.frequency !== "now") setForm(formFromSchedule(sched));
      if (sched && sched.frequency === "now") setForm(blankForm(today));
      await loadList();
      const note = (res && res.message) || "Saved.";
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
      const res = await api.setCallScheduleStatus(s.id, s.status === "paused" ? "active" : "paused");
      await loadList();
      setMessage(res.message || "");
      if (onChanged) onChanged(res.message || "");
    } catch (e) {
      setMessage(e.message || "Could not change it.");
    }
  };

  const remove = async () => {
    if (!form.id) return;
    if (!window.confirm("Delete this schedule? Calls already placed stay in your call log; no more are placed.")) return;
    try {
      const res = await api.deleteCallSchedule(form.id);
      await loadList();
      pick(null);
      setMessage(res.message || "Deleted.");
      if (onChanged) onChanged(res.message || "Deleted.");
    } catch (e) {
      setMessage(e.message || "Could not delete it.");
    }
  };

  const weekOrder = WEEK_ORDER[org.weekStart] || WEEK_ORDER.monday;
  const current = list.find((x) => x.id === form.id);
  const picked = lists.find((l) => l.id === form.listId);

  const summary = useMemo(() => {
    if (previewError) return { tone: "warn", text: previewError };
    if (!preview) return { tone: "idle", text: "Name the schedule and pick a Call list to see the call times." };
    if (form.frequency === "now") return { tone: "ok", text: "Dials " + (picked ? picked.count + " contact" + (picked.count === 1 ? "" : "s") : "the list") + " as soon as you save." };
    if (!preview.count) return { tone: "warn", text: "No call times fall between the start and end date." };
    const first = (preview.slots || []).slice(0, 4).map((x) => slotText(x, org.timeFormat)).join(", ");
    return {
      tone: "ok",
      text: preview.count + " call time" + (preview.count === 1 ? "" : "s") + " coming up: " + first + (preview.count > 4 ? ", …" : ""),
    };
  }, [preview, previewError, form.frequency, picked, org.timeFormat]);

  if (!open) return null;

  const timesField = (
    <Field label={form.frequency === "once" ? "Time" : "Call times"} hint={form.frequency === "once" ? "" : "Each time, the whole list is dialled. Add more to call the same list several times a day."}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {form.times.map((t, i) => (
          <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="time" aria-label={"Call time " + (i + 1)} value={t} onChange={(e) => setTime(i, e.target.value)} style={{ ...input, width: 140 }} />
            {form.times.length > 1 ? (
              <button type="button" aria-label={"Remove call time " + (i + 1)} onClick={() => removeTime(i)} style={{ border: "none", background: "transparent", cursor: "pointer", padding: 4, display: "flex", color: C.slate }}>
                <X size={14} />
              </button>
            ) : null}
          </div>
        ))}
        {form.times.length < MAX_TIMES ? (
          <div><button type="button" onClick={addTime} style={secBtn}><Plus size={13} /> Add another time</button></div>
        ) : null}
      </div>
    </Field>
  );

  return (
    <div style={overlay} onClick={onClose}>
      <div role="dialog" aria-label="Call schedules" style={dialog} onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: "14px 18px", borderBottom: `1px solid ${C.border}`, background: "#fff", display: "flex", alignItems: "center", gap: 10 }}>
          <CalendarClock size={18} color={C.cobalt} />
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18 }}>Call schedules</div>
            <div style={{ fontSize: 12, color: C.slate }}>Times in {tzLabel(org.timezone)}. Calls start on their own and use your call minutes.</div>
          </div>
          <button type="button" onClick={onClose} title="Close" aria-label="Close" style={{ border: "none", background: "transparent", cursor: "pointer" }}><X size={18} /></button>
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
                  style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 11px", marginBottom: 6, borderRadius: 10, border: `1px solid ${on ? C.cobalt : C.border}`, background: on ? C.cobaltSoft : "#fff", cursor: "pointer", fontFamily: "inherit" }}
                >
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <span style={{ fontWeight: 700, fontSize: 13, color: C.ink, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: pill.color }}>{pill.text}</span>
                  </div>
                  <div style={{ fontSize: 11.5, color: C.slate, marginTop: 2 }}>{ruleText(s, org.timeFormat)}</div>
                  <div style={{ fontSize: 11, color: C.slateLight, marginTop: 2 }}>
                    {s.listName || "List deleted"}{s.upcoming && s.upcoming[0] ? " · next " + slotText(s.upcoming[0], org.timeFormat) : ""}
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
                  style={{ height: 36, padding: "0 14px", border: "none", borderBottom: `2px solid ${tab === t.id ? C.cobalt : "transparent"}`, background: "transparent", color: tab === t.id ? C.ink : C.slate, fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 16, background: "#fff" }}>
              {current && current.status === "ended" ? (
                <Note tone="warn">{current.endedReason || "This schedule has ended."} Change the dates and save to run it again.</Note>
              ) : null}

              {tab === "calls" ? (
                <>
                  <Field label="Name">
                    <input aria-label="Schedule name" value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Morning follow-ups" style={input} />
                  </Field>
                  <Field label="Call list" hint={picked ? picked.count + " contact" + (picked.count === 1 ? "" : "s") + " on this list." : "The people to call. Make lists on the Call list page."}>
                    <select aria-label="Call list" value={form.listId} onChange={(e) => set({ listId: e.target.value })} style={input}>
                      <option value="">Pick a list…</option>
                      {lists.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.count})</option>)}
                    </select>
                  </Field>
                  {numbers.length > 1 ? (
                    <Field label="Call from">
                      <select aria-label="Call from" value={form.fromNumber} onChange={(e) => set({ fromNumber: e.target.value })} style={input}>
                        <option value="">My default number</option>
                        {numbers.map((n) => <option key={n.id} value={n.e164}>{n.label ? n.label + " · " + n.e164 : n.e164}</option>)}
                      </select>
                    </Field>
                  ) : null}
                  <Field label="Calls at once" hint="Two lines at once is the most. Contacts wait for a free line.">
                    <Segmented value={Number(form.concurrency)} onChange={(v) => set({ concurrency: v })} options={[{ id: 1, label: "1" }, { id: 2, label: "2" }]} />
                  </Field>
                  <Note>The AI makes each call the way it does for a list you start by hand. If call minutes run out, the list pauses and carries on after a top-up. A run that comes due while Outreach is off for more than 45 minutes is skipped, not made late.</Note>
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
                  {form.frequency === "now" ? <Note>The list is dialled as soon as you save. Nothing is kept to repeat.</Note> : null}
                  {form.frequency === "once" ? (
                    <>
                      <Field label="Date"><input type="date" aria-label="Date" min={today} value={form.date} onChange={(e) => set({ date: e.target.value })} style={{ ...input, width: 190 }} /></Field>
                      {timesField}
                    </>
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
                        <Field label="Day of the month" hint="On shorter months a 31st calls on the last day.">
                          <input type="number" aria-label="Day of the month" min={1} max={31} value={form.monthDay} onChange={(e) => set({ monthDay: e.target.value })} style={{ ...input, width: 120 }} />
                        </Field>
                      ) : null}
                      {form.pattern === "dates" ? (
                        <Field label="Dates">
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                            <input type="date" aria-label="Date to add" min={today} value={dateToAdd} onChange={(e) => setDateToAdd(e.target.value)} style={{ ...input, width: 170 }} />
                            <button type="button" disabled={!dateToAdd} onClick={addDate} style={secBtn}>Add date</button>
                          </div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                            {form.customDates.map((d) => (
                              <span key={d} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 6px 4px 10px", borderRadius: 99, border: `1px solid ${C.border}`, fontSize: 12.5, fontWeight: 700 }}>
                                {dayText(d)}
                                <button type="button" aria-label={"Remove " + d} onClick={() => set({ customDates: form.customDates.filter((x) => x !== d) })} style={{ border: "none", background: "transparent", cursor: "pointer", padding: 2, display: "flex", color: C.slate }}>
                                  <X size={13} />
                                </button>
                              </span>
                            ))}
                          </div>
                        </Field>
                      ) : null}
                      {form.pattern !== "dates" ? (
                        <Row>
                          <Field label="Starts"><input type="date" aria-label="Start date" value={form.startDate} onChange={(e) => set({ startDate: e.target.value })} style={input} /></Field>
                          <Field label="Ends" hint={form.endDate ? "" : "Default: 3 months after the start."}>
                            <input type="date" aria-label="End date" value={form.endDate} onChange={(e) => set({ endDate: e.target.value })} style={input} />
                          </Field>
                        </Row>
                      ) : null}
                      {timesField}
                    </>
                  ) : null}
                </>
              ) : null}

              {tab === "history" ? (
                !current ? (
                  <Note>Save a schedule first. Each run is listed here with what happened.</Note>
                ) : !(current.runs || []).length ? (
                  <Note>Nothing has run yet.{current.upcoming && current.upcoming[0] ? " Next: " + slotText(current.upcoming[0], org.timeFormat) + "." : ""}</Note>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {current.runs.map((r, i) => (
                      <div key={i} style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: "9px 11px", fontSize: 12.5 }}>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <b style={{ flex: 1 }}>{slotText(r.slot, org.timeFormat)}</b>
                          <span style={{ fontWeight: 700, color: r.ok ? C.teal : C.red }}>{r.ok ? "Started" : "Not dialled"}</span>
                        </div>
                        <div style={{ color: C.slate, marginTop: 3 }}>{r.message}</div>
                      </div>
                    ))}
                  </div>
                )
              ) : null}
            </div>

            <div style={{ borderTop: `1px solid ${C.border}`, padding: "10px 16px", background: "#fff" }}>
              <div style={{ fontSize: 12.5, color: summary.tone === "warn" ? C.red : summary.tone === "ok" ? C.ink : C.slate, marginBottom: 8, lineHeight: 1.4 }}>
                {summary.text}{summary.tone === "ok" && preview && preview.count && form.frequency === "recurring" && form.endDate ? " · ends " + longDay(form.endDate) : ""}
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                {current ? (
                  <>
                    {current.status !== "ended" ? (
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
                  {saving ? "Saving…" : form.id ? "Save changes" : form.frequency === "now" ? "Call now" : "Save schedule"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
